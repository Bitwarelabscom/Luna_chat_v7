/**
 * Session Log Service
 *
 * Provides cross-session continuity by:
 * 1. Creating log entries when sessions start
 * 2. Updating logs with message counts
 * 3. Finalizing logs with summaries when sessions go idle
 * 4. Providing recent session context for new sessions
 */

import { query, queryOne } from '../db/postgres.js';
import { createCompletion } from '../llm/router.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import { config } from '../config/index.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as contextSummaryService from '../context/context-summary.service.js';
import type { SessionSummary, SessionArtifact } from '../context/context-summary.types.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface SessionLogEntry {
  id: string;
  userId: string;
  sessionId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  mode: string;
  summary: string | null;
  mood: string | null;
  energy: string | null;
  openTasksCount: number;
  topics: string[] | null;
  toolsUsed: string[] | null;
  messageCount: number;
}

interface DbSessionLog {
  id: string;
  user_id: string;
  session_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  mode: string;
  summary: string | null;
  mood: string | null;
  energy: string | null;
  open_tasks_count: number;
  topics: string[] | null;
  tools_used: string[] | null;
  message_count: number;
}

function mapDbToEntry(row: DbSessionLog): SessionLogEntry {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    mode: row.mode,
    summary: row.summary,
    mood: row.mood,
    energy: row.energy,
    openTasksCount: row.open_tasks_count,
    topics: row.topics,
    toolsUsed: row.tools_used,
    messageCount: row.message_count,
  };
}

// ============================================
// Core Functions
// ============================================

/**
 * Create a new session log entry when a session starts
 */
export async function createSessionLog(
  userId: string,
  sessionId: string,
  mode: string
): Promise<string> {
  try {
    // Get current open tasks count
    let openTasksCount = 0;
    try {
      const tasks = await tasksService.getTasks(userId, { status: 'pending', limit: 100 });
      openTasksCount = tasks.length;
    } catch {
      // Ignore task fetch errors
    }

    const result = await queryOne<{ id: string }>(
      `INSERT INTO session_logs (user_id, session_id, mode, open_tasks_count)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, sessionId, mode, openTasksCount]
    );

    if (!result) {
      throw new Error('Failed to create session log');
    }

    logger.debug('Session log created', { sessionId, logId: result.id });
    return result.id;
  } catch (error) {
    logger.error('Failed to create session log', {
      error: (error as Error).message,
      sessionId,
    });
    throw error;
  }
}

/**
 * Update session log with incremental data
 */
export async function updateSessionLog(
  sessionId: string,
  updates: {
    messageCount?: number;
    toolsUsed?: string[];
  }
): Promise<void> {
  try {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.messageCount !== undefined) {
      setClauses.push(`message_count = $${paramIndex++}`);
      values.push(updates.messageCount);
    }

    if (updates.toolsUsed && updates.toolsUsed.length > 0) {
      // Append to existing tools, avoiding duplicates
      setClauses.push(`tools_used = ARRAY(SELECT DISTINCT unnest(COALESCE(tools_used, ARRAY[]::text[]) || $${paramIndex++}::text[]))`);
      values.push(updates.toolsUsed);
    }

    if (values.length === 0) return;

    values.push(sessionId);

    await query(
      `UPDATE session_logs SET ${setClauses.join(', ')}
       WHERE session_id = $${paramIndex} AND ended_at IS NULL`,
      values
    );
  } catch (error) {
    logger.error('Failed to update session log', {
      error: (error as Error).message,
      sessionId,
    });
    // Don't throw - updates are non-critical
  }
}

/**
 * Append a manual note to an existing session's summary
 * Called by Luna during conversations to add context for future reference
 */
export async function appendToSummary(
  sessionId: string,
  note: string
): Promise<void> {
  try {
    // Limit note length and append to existing summary
    const trimmedNote = note.slice(0, 200);
    await query(
      `UPDATE session_logs
       SET summary = CASE
         WHEN summary IS NULL OR summary = '' THEN $1
         ELSE summary || ' | ' || $1
       END,
       updated_at = NOW()
       WHERE session_id = $2`,
      [trimmedNote, sessionId]
    );
    logger.debug('Appended note to session summary', { sessionId, note: trimmedNote });
  } catch (error) {
    logger.error('Failed to append to summary', {
      error: (error as Error).message,
      sessionId,
    });
  }
}

/**
 * Finalize a session log with summary and analysis
 */
export async function finalizeSessionLog(
  sessionId: string,
  summary: string,
  mood: string,
  energy: string,
  topics: string[]
): Promise<void> {
  try {
    await query(
      `UPDATE session_logs
       SET ended_at = NOW(),
           summary = $1,
           mood = $2,
           energy = $3,
           topics = $4,
           updated_at = NOW()
       WHERE session_id = $5 AND ended_at IS NULL`,
      [summary, mood, energy, topics, sessionId]
    );

    logger.debug('Session log finalized', { sessionId, mood, energy });
  } catch (error) {
    logger.error('Failed to finalize session log', {
      error: (error as Error).message,
      sessionId,
    });
  }
}

/**
 * Get recent session logs for a user
 */
export async function getRecentSessionLogs(
  userId: string,
  limit: number = 3
): Promise<SessionLogEntry[]> {
  try {
    const rows = await query<DbSessionLog>(
      `SELECT * FROM session_logs
       WHERE user_id = $1 AND ended_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return rows.map(mapDbToEntry);
  } catch (error) {
    logger.error('Failed to get recent session logs', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * Get unfinalized session logs that are idle (for background job)
 */
export async function getIdleUnfinalizedLogs(
  idleHours: number = 0.5
): Promise<Array<{ sessionId: string; userId: string }>> {
  try {
    // Convert hours to minutes for more precise control
    const idleMinutes = Math.round(idleHours * 60);
    const rows = await query<{ session_id: string; user_id: string }>(
      `SELECT session_id, user_id FROM session_logs
       WHERE ended_at IS NULL
         AND session_id IS NOT NULL
         AND updated_at < NOW() - INTERVAL '${idleMinutes} minutes'`,
      []
    );

    return rows.map(r => ({ sessionId: r.session_id, userId: r.user_id }));
  } catch (error) {
    logger.error('Failed to get idle unfinalized logs', {
      error: (error as Error).message,
    });
    return [];
  }
}

// ============================================
// Formatting
// ============================================

/**
 * Format session logs for injection into system prompt
 */
export function formatLogsForContext(logs: SessionLogEntry[]): string {
  if (logs.length === 0) return '';

  const lines = logs.map(log => {
    const timeAgo = formatTimeAgo(log.startedAt);
    const summary = log.summary || 'No summary';
    const moodStr = log.mood ? `, mood: ${log.mood}` : '';
    const energyStr = log.energy ? `, energy: ${log.energy}` : '';

    return `- ${timeAgo} | ${summary}${moodStr}${energyStr}`;
  });

  return `[Recent Sessions]\n${lines.join('\n')}\n[End Recent Sessions]`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    return 'Just now';
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `Yesterday ${time}`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${dateStr} ${time}`;
  }
}

// ============================================
// Session Analysis (for finalization)
// ============================================

const ANALYSIS_PROMPT = `Analyze this chat session and provide:
1. A one-sentence summary (max 15 words) of the main topic and outcome
2. User's mood: positive, neutral, negative, or mixed
3. User's energy level: high, medium, or low
4. Main topics discussed (1-3 keywords)

Respond in this exact JSON format:
{"summary": "...", "mood": "...", "energy": "...", "topics": ["...", "..."]}

Chat messages:
`;

/**
 * Analyze a session's messages to generate summary, mood, and energy
 */
export async function analyzeSession(
  messages: Array<{ role: string; content: string }>
): Promise<{
  summary: string;
  mood: string;
  energy: string;
  topics: string[];
}> {
  try {
    // Format messages for analysis (limit to avoid token overflow)
    const formatted = messages
      .slice(-20) // Last 20 messages
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
      [{ role: 'user', content: ANALYSIS_PROMPT + formatted }],
      { temperature: 0.3, maxTokens: 5000 }
    );

    const content = response.content || '';

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || 'Session completed',
        mood: parsed.mood || 'neutral',
        energy: parsed.energy || 'medium',
        topics: parsed.topics || [],
      };
    }

    return {
      summary: 'Session completed',
      mood: 'neutral',
      energy: 'medium',
      topics: [],
    };
  } catch (error) {
    logger.error('Failed to analyze session', { error: (error as Error).message });
    return {
      summary: 'Session completed',
      mood: 'neutral',
      energy: 'medium',
      topics: [],
    };
  }
}

// ============================================
// Detailed Session Summary (for context loading)
// ============================================

const DETAILED_ANALYSIS_PROMPT = `Analyze this chat session in depth and extract structured information.

For the session below, provide:
1. title: A short title (5-10 words) describing the main topic
2. oneLiner: A one-sentence summary (max 15 words)
3. summary: A 2-3 sentence summary of what happened
4. topics: Array of 2-5 topic keywords
5. keywords: Array of 5-10 search keywords (names, technical terms, etc.)
6. decisions: Array of decisions made during the session (empty if none)
7. openQuestions: Array of unresolved questions or topics (empty if none)
8. actionItems: Array of tasks/todos mentioned (empty if none)
9. moodArc: Brief description of emotional trajectory (e.g., "started frustrated, ended satisfied")
10. artifacts: Array of things created (files, code, tasks, etc.)

Respond in this exact JSON format:
{
  "title": "...",
  "oneLiner": "...",
  "summary": "...",
  "topics": ["..."],
  "keywords": ["..."],
  "decisions": ["..."],
  "openQuestions": ["..."],
  "actionItems": ["..."],
  "moodArc": "...",
  "artifacts": [{"type": "file|code|task|knowledge|calendar_event|email", "name": "...", "description": "..."}]
}

Chat messages:
`;

/**
 * Generate a detailed session summary for context loading
 * This is richer than the basic analyzeSession and stores to Redis
 */
export async function generateDetailedSessionSummary(
  sessionId: string,
  userId: string,
  messages: Array<{ role: string; content: string }>,
  intentsActive: string[] = [],
  intentsResolved: string[] = [],
  toolsUsed: string[] = [],
  startedAt: Date,
  endedAt: Date
): Promise<SessionSummary | null> {
  try {
    // Format messages for analysis (limit to avoid token overflow)
    const formatted = messages
      .slice(-30) // Last 30 messages for more context
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const response = await createBackgroundCompletionWithFallback({
      userId,
      sessionId,
      feature: 'context_summary',
      messages: [{ role: 'user', content: DETAILED_ANALYSIS_PROMPT + formatted }],
      temperature: 0.3,
      maxTokens: 5000,
      loggingContext: {
        userId,
        sessionId,
        source: 'session-log',
        nodeName: 'detailed_summary',
      },
    });

    const content = response.content || '';

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Failed to parse detailed session summary', { sessionId });
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Build the full summary
    const summary: SessionSummary = {
      sessionId,
      userId,
      title: parsed.title || 'Chat session',
      oneLiner: parsed.oneLiner || parsed.summary?.split('.')[0] || 'Session completed',
      topics: parsed.topics || [],
      keywords: parsed.keywords || [],
      summary: parsed.summary || 'Session completed',
      decisions: parsed.decisions || [],
      openQuestions: parsed.openQuestions || [],
      actionItems: parsed.actionItems || [],
      moodArc: parsed.moodArc || 'neutral',
      energyEnd: inferEnergy(parsed.moodArc),
      artifacts: (parsed.artifacts || []).map((a: SessionArtifact) => ({
        type: a.type || 'code',
        name: a.name || 'Unknown',
        description: a.description,
      })),
      intentsActive,
      intentsResolved,
      messageCount: messages.length,
      toolsUsed,
      startedAt,
      endedAt,
      generatedAt: new Date(),
    };

    // Store in Redis
    await contextSummaryService.storeSessionSummary(summary);

    logger.info('Generated detailed session summary', {
      sessionId,
      title: summary.title,
      decisions: summary.decisions.length,
      actionItems: summary.actionItems.length,
    });

    return summary;
  } catch (error) {
    logger.error('Failed to generate detailed session summary', {
      error: (error as Error).message,
      sessionId,
    });
    return null;
  }
}

/**
 * Infer energy level from mood arc description
 */
function inferEnergy(moodArc: string): 'high' | 'medium' | 'low' {
  const lower = (moodArc || '').toLowerCase();

  if (/excit|energi|enthus|happy|satisf|accomplish/i.test(lower)) {
    return 'high';
  }
  if (/tired|exhaust|frustrat|drain|low|sad|confus/i.test(lower)) {
    return 'low';
  }
  return 'medium';
}

export default {
  createSessionLog,
  updateSessionLog,
  appendToSummary,
  finalizeSessionLog,
  getRecentSessionLogs,
  getIdleUnfinalizedLogs,
  formatLogsForContext,
  analyzeSession,
  generateDetailedSessionSummary,
};
