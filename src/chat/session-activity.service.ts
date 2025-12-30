/**
 * Session Activity Tracking Service
 *
 * Tracks chat session activity to enable automatic memory consolidation
 * when sessions become inactive (5 minute timeout).
 */

import { redis } from '../db/redis.js';
import * as memorycoreClient from '../memory/memorycore.client.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Redis key prefix for session activity tracking
const ACTIVITY_PREFIX = 'session:activity:';
const ACTIVITY_TTL = 60 * 60; // 1 hour TTL (cleanup old entries)

// Session inactivity timeout in milliseconds (5 minutes)
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

interface SessionActivity {
  chatSessionId: string;
  userId: string;
  lastActivityAt: number; // Unix timestamp in ms
  messageCount: number;
}

/**
 * Record session activity when a message is sent/received
 */
export async function recordActivity(chatSessionId: string, userId: string): Promise<void> {
  const key = `${ACTIVITY_PREFIX}${chatSessionId}`;

  try {
    const existing = await redis.get(key);
    const now = Date.now();

    const activity: SessionActivity = existing
      ? { ...JSON.parse(existing), lastActivityAt: now, messageCount: JSON.parse(existing).messageCount + 1 }
      : { chatSessionId, userId, lastActivityAt: now, messageCount: 1 };

    await redis.setex(key, ACTIVITY_TTL, JSON.stringify(activity));

    logger.debug('Session activity recorded', { chatSessionId, userId, messageCount: activity.messageCount });
  } catch (error) {
    logger.warn('Failed to record session activity', {
      chatSessionId,
      error: (error as Error).message
    });
  }
}

/**
 * Get all sessions that have been inactive for longer than the timeout
 */
export async function getInactiveSessions(): Promise<SessionActivity[]> {
  const inactiveSessions: SessionActivity[] = [];
  const now = Date.now();

  try {
    // Scan for all activity keys
    const keys = await scanKeys(`${ACTIVITY_PREFIX}*`);

    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (!data) continue;

        const activity: SessionActivity = JSON.parse(data);
        const inactiveMs = now - activity.lastActivityAt;

        if (inactiveMs >= INACTIVITY_TIMEOUT_MS) {
          inactiveSessions.push(activity);
        }
      } catch (err) {
        logger.warn('Failed to parse session activity', { key, error: (err as Error).message });
      }
    }

    return inactiveSessions;
  } catch (error) {
    logger.error('Failed to get inactive sessions', { error: (error as Error).message });
    return [];
  }
}

/**
 * Remove session activity tracking (called after consolidation)
 */
export async function clearActivity(chatSessionId: string): Promise<void> {
  try {
    await redis.del(`${ACTIVITY_PREFIX}${chatSessionId}`);
    logger.debug('Session activity cleared', { chatSessionId });
  } catch (error) {
    logger.warn('Failed to clear session activity', {
      chatSessionId,
      error: (error as Error).message
    });
  }
}

/**
 * End a session due to inactivity and trigger consolidation
 */
export async function endInactiveSession(activity: SessionActivity): Promise<boolean> {
  try {
    // Trigger MemoryCore consolidation
    await memorycoreClient.endChatSession(activity.chatSessionId);

    // Clear the activity tracking
    await clearActivity(activity.chatSessionId);

    logger.info('Inactive session consolidated', {
      chatSessionId: activity.chatSessionId,
      userId: activity.userId,
      messageCount: activity.messageCount,
      inactiveFor: `${Math.round((Date.now() - activity.lastActivityAt) / 1000)}s`,
    });

    return true;
  } catch (error) {
    logger.error('Failed to end inactive session', {
      chatSessionId: activity.chatSessionId,
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * End a session explicitly (e.g., browser close)
 */
export async function endSessionExplicitly(chatSessionId: string, userId: string): Promise<boolean> {
  try {
    // Get activity data if exists
    const key = `${ACTIVITY_PREFIX}${chatSessionId}`;
    const data = await redis.get(key);

    // Trigger MemoryCore consolidation
    await memorycoreClient.endChatSession(chatSessionId);

    // Clear activity tracking
    await clearActivity(chatSessionId);

    logger.info('Session explicitly ended', {
      chatSessionId,
      userId,
      hadActivity: !!data,
    });

    return true;
  } catch (error) {
    logger.error('Failed to end session explicitly', {
      chatSessionId,
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Process all inactive sessions - called by job runner
 */
export async function processInactiveSessions(): Promise<number> {
  if (!config.memorycore.enabled) return 0;

  const inactiveSessions = await getInactiveSessions();

  if (inactiveSessions.length === 0) {
    return 0;
  }

  logger.info('Processing inactive sessions', { count: inactiveSessions.length });

  let consolidated = 0;
  for (const activity of inactiveSessions) {
    const success = await endInactiveSession(activity);
    if (success) consolidated++;
  }

  return consolidated;
}

/**
 * Helper to scan Redis keys matching a pattern
 */
async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');

  return keys;
}

export default {
  recordActivity,
  getInactiveSessions,
  clearActivity,
  endInactiveSession,
  endSessionExplicitly,
  processInactiveSessions,
};
