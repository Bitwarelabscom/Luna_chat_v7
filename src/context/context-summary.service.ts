/**
 * Context Summary Service
 * Redis storage layer for session and intent summaries
 * Enables on-demand context loading without bloating initial prompts
 */

import { redis } from '../db/redis.js';
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import {
  SessionSummary,
  IntentContextSummary,
  ContextSearchResult,
  SessionSummaryBrief,
  IntentContextBrief,
  CONTEXT_REDIS_KEYS,
  CONTEXT_TTLS,
  MAX_RECENT_SESSIONS,
} from './context-summary.types.js';

// ============================================
// Session Summary Operations
// ============================================

/**
 * Store a session summary in Redis
 */
export async function storeSessionSummary(summary: SessionSummary): Promise<void> {
  try {
    const key = CONTEXT_REDIS_KEYS.SESSION_SUMMARY(summary.userId, summary.sessionId);

    // Store the summary with TTL
    await redis.setex(key, CONTEXT_TTLS.SESSION_SUMMARY, JSON.stringify(summary));

    // Add to recent sessions list
    await addToRecentSessions(summary.userId, summary.sessionId);

    // Update search index with keywords
    await updateSearchIndex(summary.userId, {
      type: 'session',
      id: summary.sessionId,
      keywords: [...summary.keywords, ...summary.topics],
      title: summary.title,
      snippet: summary.oneLiner,
      timestamp: summary.endedAt,
    });

    // Track in PostgreSQL for analytics
    await trackSummaryMetadata(
      summary.userId,
      'session',
      summary.sessionId,
      key,
      summary.keywords,
      CONTEXT_TTLS.SESSION_SUMMARY
    );

    logger.debug('Stored session summary', {
      userId: summary.userId,
      sessionId: summary.sessionId,
      keywords: summary.keywords.length,
    });
  } catch (error) {
    logger.error('Failed to store session summary', {
      error: (error as Error).message,
      sessionId: summary.sessionId,
    });
    throw error;
  }
}

/**
 * Get a session summary from Redis
 */
export async function getSessionSummary(
  userId: string,
  sessionId: string
): Promise<SessionSummary | null> {
  try {
    const key = CONTEXT_REDIS_KEYS.SESSION_SUMMARY(userId, sessionId);
    const data = await redis.get(key);

    if (!data) {
      // Try fallback to PostgreSQL session_logs
      return await getSessionSummaryFallback(userId, sessionId);
    }

    const summary = JSON.parse(data) as SessionSummary;

    // Convert date strings back to Date objects
    summary.startedAt = new Date(summary.startedAt);
    summary.endedAt = new Date(summary.endedAt);
    summary.generatedAt = new Date(summary.generatedAt);

    return summary;
  } catch (error) {
    logger.error('Failed to get session summary', {
      error: (error as Error).message,
      sessionId,
    });
    return null;
  }
}

/**
 * Fallback to PostgreSQL session_logs when Redis doesn't have the summary
 */
async function getSessionSummaryFallback(
  userId: string,
  sessionId: string
): Promise<SessionSummary | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM session_logs WHERE user_id = $1 AND session_id = $2`,
      [userId, sessionId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    // Create basic summary from session_logs data
    const summary: SessionSummary = {
      sessionId: row.session_id,
      userId: row.user_id,
      title: row.summary?.split('.')[0] || 'Chat session',
      oneLiner: row.summary || 'Session completed',
      topics: row.topics || [],
      keywords: row.topics || [],
      summary: row.summary || 'Session completed',
      decisions: [],
      openQuestions: [],
      actionItems: [],
      moodArc: row.mood || 'neutral',
      energyEnd: row.energy || 'medium',
      artifacts: [],
      intentsActive: [],
      intentsResolved: [],
      messageCount: row.message_count || 0,
      toolsUsed: row.tools_used || [],
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : new Date(),
      generatedAt: new Date(),
    };

    return summary;
  } catch (error) {
    logger.warn('Session summary fallback failed', {
      error: (error as Error).message,
      sessionId,
    });
    return null;
  }
}

// ============================================
// Intent Summary Operations
// ============================================

/**
 * Store an intent context summary in Redis
 */
export async function storeIntentSummary(summary: IntentContextSummary): Promise<void> {
  try {
    const key = CONTEXT_REDIS_KEYS.INTENT_SUMMARY(summary.userId, summary.intentId);

    // Determine TTL based on intent status
    let ttl: number;
    switch (summary.status) {
      case 'active':
      case 'suspended':
        ttl = CONTEXT_TTLS.INTENT_ACTIVE;
        break;
      case 'resolved':
        ttl = CONTEXT_TTLS.INTENT_RESOLVED;
        break;
      case 'decayed':
        ttl = CONTEXT_TTLS.INTENT_DECAYED;
        break;
      default:
        ttl = CONTEXT_TTLS.INTENT_RESOLVED;
    }

    // Store with or without TTL
    if (ttl === -1) {
      await redis.set(key, JSON.stringify(summary));
    } else {
      await redis.setex(key, ttl, JSON.stringify(summary));
    }

    // Update search index
    const keywords = [
      summary.label.toLowerCase(),
      ...summary.label.toLowerCase().split(/\s+/),
      summary.type,
      ...summary.blockers.map(b => b.toLowerCase()),
    ];

    await updateSearchIndex(summary.userId, {
      type: 'intent',
      id: summary.intentId,
      keywords,
      title: summary.label,
      snippet: summary.goal,
      timestamp: summary.lastTouchedAt,
    });

    // Track in PostgreSQL
    await trackSummaryMetadata(
      summary.userId,
      'intent',
      summary.intentId,
      key,
      keywords,
      ttl === -1 ? null : ttl
    );

    logger.debug('Stored intent summary', {
      userId: summary.userId,
      intentId: summary.intentId,
      status: summary.status,
    });
  } catch (error) {
    logger.error('Failed to store intent summary', {
      error: (error as Error).message,
      intentId: summary.intentId,
    });
    throw error;
  }
}

/**
 * Get an intent context summary from Redis
 */
export async function getIntentSummary(
  userId: string,
  intentId: string
): Promise<IntentContextSummary | null> {
  try {
    const key = CONTEXT_REDIS_KEYS.INTENT_SUMMARY(userId, intentId);
    const data = await redis.get(key);

    if (!data) {
      // Try fallback to PostgreSQL user_intents
      return await getIntentSummaryFallback(userId, intentId);
    }

    const summary = JSON.parse(data) as IntentContextSummary;

    // Convert date strings
    summary.createdAt = new Date(summary.createdAt);
    summary.lastTouchedAt = new Date(summary.lastTouchedAt);
    summary.generatedAt = new Date(summary.generatedAt);
    summary.relatedSessions = summary.relatedSessions.map(s => ({
      ...s,
      touchedAt: new Date(s.touchedAt),
    }));

    return summary;
  } catch (error) {
    logger.error('Failed to get intent summary', {
      error: (error as Error).message,
      intentId,
    });
    return null;
  }
}

/**
 * Fallback to PostgreSQL user_intents
 */
async function getIntentSummaryFallback(
  userId: string,
  intentId: string
): Promise<IntentContextSummary | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM user_intents WHERE id = $1 AND user_id = $2`,
      [intentId, userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    const summary: IntentContextSummary = {
      intentId: row.id,
      userId: row.user_id,
      type: row.type,
      label: row.label,
      goal: row.goal,
      status: row.status,
      priority: row.priority,
      contextSummary: row.goal,
      decisions: [],
      approachesTried: row.tried_approaches || [],
      currentApproach: row.current_approach,
      blockers: row.blockers || [],
      relatedSessions: [],
      createdAt: new Date(row.created_at),
      lastTouchedAt: new Date(row.last_touched_at),
      touchCount: row.touch_count || 0,
      generatedAt: new Date(),
    };

    return summary;
  } catch (error) {
    logger.warn('Intent summary fallback failed', {
      error: (error as Error).message,
      intentId,
    });
    return null;
  }
}

// ============================================
// Recent Sessions Operations
// ============================================

/**
 * Add a session to the recent sessions list
 */
async function addToRecentSessions(userId: string, sessionId: string): Promise<void> {
  try {
    const key = CONTEXT_REDIS_KEYS.RECENT_SESSIONS(userId);

    // Add to front of list
    await redis.lpush(key, sessionId);

    // Trim to max size
    await redis.ltrim(key, 0, MAX_RECENT_SESSIONS - 1);

    // Set TTL
    await redis.expire(key, CONTEXT_TTLS.RECENT_SESSIONS_LIST);
  } catch (error) {
    logger.warn('Failed to add to recent sessions', {
      error: (error as Error).message,
      userId,
      sessionId,
    });
  }
}

/**
 * Get recent session IDs for a user
 */
export async function getRecentSessionIds(
  userId: string,
  limit: number = MAX_RECENT_SESSIONS
): Promise<string[]> {
  try {
    const key = CONTEXT_REDIS_KEYS.RECENT_SESSIONS(userId);
    return await redis.lrange(key, 0, limit - 1);
  } catch (error) {
    logger.error('Failed to get recent session IDs', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * Get recent session summaries for a user
 */
export async function getRecentSessions(
  userId: string,
  limit: number = 5
): Promise<SessionSummaryBrief[]> {
  try {
    const sessionIds = await getRecentSessionIds(userId, limit);
    const summaries: SessionSummaryBrief[] = [];

    for (const sessionId of sessionIds) {
      const summary = await getSessionSummary(userId, sessionId);
      if (summary) {
        summaries.push({
          sessionId: summary.sessionId,
          title: summary.title,
          oneLiner: summary.oneLiner,
          topics: summary.topics,
          startedAt: summary.startedAt,
        });
      }
    }

    return summaries;
  } catch (error) {
    logger.error('Failed to get recent sessions', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

// ============================================
// Search Index Operations
// ============================================

interface SearchIndexEntry {
  type: 'session' | 'intent';
  id: string;
  keywords: string[];
  title: string;
  snippet: string;
  timestamp: Date;
}

/**
 * Update the search index with an entry
 */
export async function updateSearchIndex(
  userId: string,
  entry: SearchIndexEntry
): Promise<void> {
  try {
    const key = CONTEXT_REDIS_KEYS.SEARCH_INDEX(userId);

    // Create ref object to store in index
    const ref = {
      type: entry.type,
      id: entry.id,
      title: entry.title,
      snippet: entry.snippet,
      timestamp: entry.timestamp.toISOString(),
    };

    // Add each keyword to the hash
    for (const keyword of entry.keywords) {
      const normalizedKeyword = keyword.toLowerCase().trim();
      if (!normalizedKeyword) continue;

      // Get existing refs for this keyword
      const existing = await redis.hget(key, normalizedKeyword);
      let refs: typeof ref[] = existing ? JSON.parse(existing) : [];

      // Remove any existing entry for this id
      refs = refs.filter(r => r.id !== entry.id);

      // Add new entry at front
      refs.unshift(ref);

      // Limit refs per keyword to 20
      refs = refs.slice(0, 20);

      await redis.hset(key, normalizedKeyword, JSON.stringify(refs));
    }

    // Set TTL
    await redis.expire(key, CONTEXT_TTLS.SEARCH_INDEX);
  } catch (error) {
    logger.warn('Failed to update search index', {
      error: (error as Error).message,
      userId,
      entryId: entry.id,
    });
  }
}

/**
 * Search context by query
 */
export async function searchContext(
  userId: string,
  query: string
): Promise<ContextSearchResult[]> {
  try {
    const key = CONTEXT_REDIS_KEYS.SEARCH_INDEX(userId);

    // Tokenize query into keywords
    const queryKeywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter(k => k.length > 2);  // Ignore very short words

    if (queryKeywords.length === 0) {
      return [];
    }

    // Collect all matching refs with scores
    const resultMap = new Map<string, {
      ref: { type: 'session' | 'intent'; id: string; title: string; snippet: string; timestamp: string };
      matches: number;
      keywords: string[];
    }>();

    for (const keyword of queryKeywords) {
      const refsJson = await redis.hget(key, keyword);
      if (!refsJson) continue;

      const refs = JSON.parse(refsJson) as {
        type: 'session' | 'intent';
        id: string;
        title: string;
        snippet: string;
        timestamp: string;
      }[];

      for (const ref of refs) {
        const existing = resultMap.get(ref.id);
        if (existing) {
          existing.matches++;
          if (!existing.keywords.includes(keyword)) {
            existing.keywords.push(keyword);
          }
        } else {
          resultMap.set(ref.id, {
            ref,
            matches: 1,
            keywords: [keyword],
          });
        }
      }
    }

    // Convert to results and sort by relevance
    const results: ContextSearchResult[] = Array.from(resultMap.values())
      .map(item => ({
        type: item.ref.type,
        id: item.ref.id,
        title: item.ref.title,
        snippet: item.ref.snippet,
        keywords: item.keywords,
        relevance: item.matches / queryKeywords.length,
        timestamp: new Date(item.ref.timestamp),
      }))
      .sort((a, b) => b.relevance - a.relevance || b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);  // Limit to 10 results

    return results;
  } catch (error) {
    logger.error('Failed to search context', {
      error: (error as Error).message,
      userId,
      query,
    });
    return [];
  }
}

// ============================================
// Active Intents Operations
// ============================================

/**
 * Get active intent summaries for a user
 */
export async function getActiveIntents(
  userId: string,
  limit: number = 5
): Promise<IntentContextBrief[]> {
  try {
    // Query active intents from PostgreSQL
    const result = await pool.query(
      `SELECT id, label, goal, status, current_approach, blockers
       FROM user_intents
       WHERE user_id = $1 AND status IN ('active', 'suspended')
       ORDER BY priority DESC, last_touched_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map(row => ({
      intentId: row.id,
      label: row.label,
      goal: row.goal,
      status: row.status,
      currentApproach: row.current_approach,
      blockers: row.blockers || [],
    }));
  } catch (error) {
    logger.error('Failed to get active intents', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

// ============================================
// Metadata Tracking (PostgreSQL)
// ============================================

/**
 * Track summary metadata in PostgreSQL for analytics
 */
async function trackSummaryMetadata(
  userId: string,
  summaryType: 'session' | 'intent',
  referenceId: string,
  redisKey: string,
  keywords: string[],
  ttlSeconds: number | null
): Promise<void> {
  try {
    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000)
      : null;

    await pool.query(
      `INSERT INTO context_summary_metadata
         (user_id, summary_type, reference_id, redis_key, keywords, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, summary_type, reference_id)
       DO UPDATE SET
         redis_key = $4,
         keywords = $5,
         expires_at = $6,
         generated_at = NOW()`,
      [userId, summaryType, referenceId, redisKey, keywords, expiresAt]
    );
  } catch (error) {
    // Table might not exist yet - log but don't fail
    logger.debug('Could not track summary metadata', {
      error: (error as Error).message,
      referenceId,
    });
  }
}

// ============================================
// Correction Operations
// ============================================

/**
 * Apply a correction to a summary
 */
export async function applySummaryCorrection(
  userId: string,
  type: 'session' | 'intent',
  id: string,
  field: 'decision' | 'approach' | 'blocker' | 'summary',
  correction: string
): Promise<{ success: boolean; previousValue?: string }> {
  try {
    if (type === 'session') {
      const summary = await getSessionSummary(userId, id);
      if (!summary) {
        return { success: false };
      }

      let previousValue: string | undefined;

      switch (field) {
        case 'decision':
          // Add correction as a new decision or replace if similar exists
          previousValue = summary.decisions.join('; ');
          summary.decisions.push(correction);
          break;
        case 'summary':
          previousValue = summary.summary;
          summary.summary = correction;
          summary.oneLiner = correction.split('.')[0] || correction.slice(0, 50);
          break;
        default:
          return { success: false };
      }

      await storeSessionSummary(summary);
      await logCorrection(userId, type, id, field, previousValue || '', correction);

      return { success: true, previousValue };
    } else {
      const summary = await getIntentSummary(userId, id);
      if (!summary) {
        return { success: false };
      }

      let previousValue: string | undefined;

      switch (field) {
        case 'decision':
          previousValue = summary.decisions.join('; ');
          summary.decisions.push(correction);
          break;
        case 'approach':
          previousValue = summary.currentApproach || '';
          summary.currentApproach = correction;
          if (!summary.approachesTried.includes(correction)) {
            summary.approachesTried.push(correction);
          }
          break;
        case 'blocker':
          previousValue = summary.blockers.join('; ');
          if (!summary.blockers.includes(correction)) {
            summary.blockers.push(correction);
          }
          break;
        case 'summary':
          previousValue = summary.contextSummary;
          summary.contextSummary = correction;
          break;
      }

      await storeIntentSummary(summary);
      await logCorrection(userId, type, id, field, previousValue || '', correction);

      return { success: true, previousValue };
    }
  } catch (error) {
    logger.error('Failed to apply summary correction', {
      error: (error as Error).message,
      type,
      id,
      field,
    });
    return { success: false };
  }
}

/**
 * Log a correction to PostgreSQL
 */
async function logCorrection(
  userId: string,
  summaryType: 'session' | 'intent',
  referenceId: string,
  field: string,
  originalValue: string,
  correctedValue: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO context_corrections
         (user_id, summary_type, reference_id, field_corrected, original_value, corrected_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, summaryType, referenceId, field, originalValue, correctedValue]
    );
  } catch (error) {
    // Table might not exist yet - log but don't fail
    logger.debug('Could not log correction', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Maintenance Operations
// ============================================

/**
 * Rebuild search index from stored summaries
 * Called by maintenance job if index is corrupted
 */
export async function rebuildSearchIndex(userId: string): Promise<number> {
  try {
    const key = CONTEXT_REDIS_KEYS.SEARCH_INDEX(userId);

    // Clear existing index
    await redis.del(key);

    let indexed = 0;

    // Rebuild from recent sessions
    const sessionIds = await getRecentSessionIds(userId, MAX_RECENT_SESSIONS);
    for (const sessionId of sessionIds) {
      const summary = await getSessionSummary(userId, sessionId);
      if (summary) {
        await updateSearchIndex(userId, {
          type: 'session',
          id: summary.sessionId,
          keywords: [...summary.keywords, ...summary.topics],
          title: summary.title,
          snippet: summary.oneLiner,
          timestamp: summary.endedAt,
        });
        indexed++;
      }
    }

    // Rebuild from active/suspended intents
    const intents = await getActiveIntents(userId, 20);
    for (const intent of intents) {
      const summary = await getIntentSummary(userId, intent.intentId);
      if (summary) {
        await updateSearchIndex(userId, {
          type: 'intent',
          id: summary.intentId,
          keywords: [
            summary.label.toLowerCase(),
            ...summary.label.toLowerCase().split(/\s+/),
            summary.type,
          ],
          title: summary.label,
          snippet: summary.goal,
          timestamp: summary.lastTouchedAt,
        });
        indexed++;
      }
    }

    logger.info('Rebuilt search index', { userId, indexed });
    return indexed;
  } catch (error) {
    logger.error('Failed to rebuild search index', {
      error: (error as Error).message,
      userId,
    });
    return 0;
  }
}

/**
 * Clean up expired summaries
 * Called by maintenance job
 */
export async function cleanupExpiredSummaries(): Promise<number> {
  try {
    // Clean up metadata for expired summaries
    const result = await pool.query(
      `DELETE FROM context_summary_metadata
       WHERE expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id`
    );

    const deleted = result.rowCount || 0;

    if (deleted > 0) {
      logger.info('Cleaned up expired summary metadata', { deleted });
    }

    return deleted;
  } catch (error) {
    logger.debug('Could not clean up summary metadata', {
      error: (error as Error).message,
    });
    return 0;
  }
}

export default {
  // Session operations
  storeSessionSummary,
  getSessionSummary,
  getRecentSessions,
  getRecentSessionIds,

  // Intent operations
  storeIntentSummary,
  getIntentSummary,
  getActiveIntents,

  // Search operations
  updateSearchIndex,
  searchContext,

  // Correction operations
  applySummaryCorrection,

  // Maintenance operations
  rebuildSearchIndex,
  cleanupExpiredSummaries,
};
