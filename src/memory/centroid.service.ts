/**
 * Rolling Embedding Centroid Service
 *
 * Maintains a per-session rolling centroid in Redis using exponential moving average.
 * The centroid captures the conversation's thematic trajectory over time.
 */

import { redis } from '../db/redis.js';
import logger from '../utils/logger.js';

const CENTROID_PREFIX = 'session:centroid:';
const CENTROID_TTL = 60 * 60 * 8; // 8 hours
const ALPHA = 0.3; // EMA decay factor - higher = more weight to recent

/**
 * Update the rolling centroid for a session with a new embedding.
 * Returns the updated centroid.
 *
 * centroid_new = alpha * embedding + (1 - alpha) * centroid_old
 */
export async function update(sessionId: string, embedding: number[]): Promise<number[]> {
  const key = `${CENTROID_PREFIX}${sessionId}`;

  try {
    const existing = await redis.get(key);

    let centroid: number[];

    if (existing) {
      const prev: number[] = JSON.parse(existing);
      // EMA update
      centroid = embedding.map((val, i) => ALPHA * val + (1 - ALPHA) * (prev[i] || 0));
    } else {
      // First message: centroid = embedding
      centroid = [...embedding];
    }

    await redis.setex(key, CENTROID_TTL, JSON.stringify(centroid));
    return centroid;
  } catch (error) {
    logger.debug('Centroid update failed, returning raw embedding', { error: (error as Error).message });
    return embedding;
  }
}

/**
 * Get the current centroid for a session without updating.
 */
export async function get(sessionId: string): Promise<number[] | null> {
  const key = `${CENTROID_PREFIX}${sessionId}`;

  try {
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as number[];
  } catch (error) {
    logger.debug('Centroid get failed', { error: (error as Error).message });
    return null;
  }
}

/**
 * Clear centroid for a session (called on session end).
 */
export async function clear(sessionId: string): Promise<void> {
  try {
    await redis.del(`${CENTROID_PREFIX}${sessionId}`);
  } catch (error) {
    logger.debug('Centroid clear failed', { error: (error as Error).message });
  }
}

export default { update, get, clear };
