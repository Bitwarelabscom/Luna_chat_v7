import { pool } from '../db/index.js';
import { redis } from '../db/redis.js';
import { createCompletion } from '../llm/router.js';
import logger from '../utils/logger.js';

type SuggestionMode = 'assistant' | 'companion';

const SUGGESTION_TTL_SECONDS = 15 * 60;
const MAX_RECENT_MESSAGES = 10;
const DEFAULT_SUGGESTION_COUNT = 5;

interface RecentMessageRow {
  content: string;
}

interface ActiveUserRow {
  user_id: string;
}

function getCacheKey(userId: string, mode: SuggestionMode): string {
  return `suggestions:${userId}:${mode}`;
}

function buildPrompt(mode: SuggestionMode, recentTopics: string): string {
  if (mode === 'assistant') {
    return `You generate brief practical task suggestions.
Recent user context: ${recentTopics}
Generate ${DEFAULT_SUGGESTION_COUNT} short conversation starters as a JSON array of strings.
Focus on: productivity, learning, problem-solving, creative projects, daily tasks.
Keep each suggestion under 12 words. Return ONLY valid JSON array, no other text.`;
  }

  return `You generate brief philosophical conversation starters.
Recent topics discussed: ${recentTopics}
Generate ${DEFAULT_SUGGESTION_COUNT} short philosophical questions as a JSON array of strings.
Focus on: consciousness, ethics, existence, identity, free will, meaning, time, knowledge.
Keep each question under 12 words. Return ONLY valid JSON array, no other text.
Example: ["Does free will truly exist?","What makes an experience real?"]`;
}

function normalizeSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (cleaned.length > 0) deduped.add(cleaned);
    if (deduped.size >= 6) break;
  }

  return [...deduped];
}

function parseSuggestions(content: string): string[] {
  const trimmed = content.trim();

  try {
    return normalizeSuggestions(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];

    try {
      return normalizeSuggestions(JSON.parse(trimmed.slice(start, end + 1)));
    } catch {
      return [];
    }
  }
}

async function getRecentTopics(userId: string): Promise<string> {
  const result = await pool.query<RecentMessageRow>(
    `SELECT m.content
     FROM messages m
     JOIN sessions s ON s.id = m.session_id
     WHERE s.user_id = $1
       AND m.role = 'user'
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [userId, MAX_RECENT_MESSAGES]
  );

  if (result.rows.length === 0) {
    return 'No recent topics.';
  }

  return result.rows
    .map((row) => row.content.trim().replace(/\s+/g, ' ').slice(0, 180))
    .filter(Boolean)
    .join(' | ');
}

export async function generateSuggestions(userId: string, mode: SuggestionMode): Promise<string[]> {
  const cacheKey = getCacheKey(userId, mode);

  try {
    const recentTopics = await getRecentTopics(userId);
    const prompt = buildPrompt(mode, recentTopics);
    const completion = await createCompletion(
      'ollama',
      'phi3:mini',
      [{ role: 'user', content: prompt }],
      { temperature: 0.7, maxTokens: 220 }
    );

    const suggestions = parseSuggestions(completion.content);
    if (suggestions.length === 0) {
      logger.warn('Suggestion generation returned empty or invalid JSON', { userId, mode });
      return [];
    }

    try {
      await redis.setex(cacheKey, SUGGESTION_TTL_SECONDS, JSON.stringify(suggestions));
    } catch (error) {
      logger.warn('Failed to cache suggestions in Redis', {
        userId,
        mode,
        error: (error as Error).message,
      });
    }

    return suggestions;
  } catch (error) {
    logger.warn('Suggestion generation failed', {
      userId,
      mode,
      error: (error as Error).message,
    });
    return [];
  }
}

export async function getSuggestions(userId: string, mode: SuggestionMode): Promise<string[]> {
  const cacheKey = getCacheKey(userId, mode);

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = normalizeSuggestions(JSON.parse(cached));
      if (parsed.length > 0) return parsed;
    }
  } catch (error) {
    logger.warn('Failed to read suggestions from Redis', {
      userId,
      mode,
      error: (error as Error).message,
    });
  }

  return generateSuggestions(userId, mode);
}

export async function generateForAllActiveUsers(): Promise<void> {
  try {
    const result = await pool.query<ActiveUserRow>(
      `SELECT DISTINCT user_id
       FROM sessions
       WHERE updated_at > NOW() - INTERVAL '24 hours'`
    );

    for (const row of result.rows) {
      void generateSuggestions(row.user_id, 'companion').catch((error) => {
        logger.warn('Failed to refresh suggestions for user', {
          userId: row.user_id,
          error: (error as Error).message,
        });
      });
    }

    logger.debug('Queued suggestion refresh for active users', { usersQueued: result.rows.length });
  } catch (error) {
    logger.error('Failed to queue active-user suggestions', {
      error: (error as Error).message,
    });
  }
}

