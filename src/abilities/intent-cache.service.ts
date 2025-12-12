/**
 * Intent Cache Service
 * Caches detected intents using semantic similarity to skip redundant LLM calls
 */

import { redis } from '../db/redis.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface CachedIntent {
  agentType: string;
  confidence: number;
  timestamp: number;
  queryHash: string;
}

export interface IntentCacheConfig {
  ttlSeconds: number;
  similarityThreshold: number;
  maxCacheSize: number;
}

interface CachedIntentData extends CachedIntent {
  embedding: number[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: IntentCacheConfig = {
  ttlSeconds: 3600, // 1 hour
  similarityThreshold: 0.92,
  maxCacheSize: 1000,
};

const INTENT_CACHE_PREFIX = 'intent_cache:';
const INTENT_INDEX_KEY = 'intent_cache_index';

// ============================================================================
// Intent Cache Class
// ============================================================================

export class IntentCache {
  private config: IntentCacheConfig;

  constructor(config: Partial<IntentCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get cached intent for a query using semantic similarity
   */
  async getCachedIntent(query: string): Promise<CachedIntent | null> {
    try {
      // Generate embedding for query
      const { embedding } = await generateEmbedding(query);

      // Get all cached intent keys from index
      const cachedKeys = await redis.smembers(INTENT_INDEX_KEY);

      if (cachedKeys.length === 0) {
        return null;
      }

      // Find most similar cached query
      let bestMatch: { key: string; similarity: number; data: CachedIntentData } | null = null;

      // Batch fetch cached intents (more efficient than individual gets)
      const pipeline = redis.pipeline();
      for (const key of cachedKeys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();

      if (!results) {
        return null;
      }

      for (let i = 0; i < cachedKeys.length; i++) {
        const result = results[i];
        if (!result || result[0] || !result[1]) continue;

        try {
          const data = JSON.parse(result[1] as string) as CachedIntentData;
          const similarity = this.cosineSimilarity(embedding, data.embedding);

          if (similarity >= this.config.similarityThreshold) {
            if (!bestMatch || similarity > bestMatch.similarity) {
              bestMatch = { key: cachedKeys[i], similarity, data };
            }
          }
        } catch {
          // Skip invalid entries
          continue;
        }
      }

      if (bestMatch) {
        logger.debug('Intent cache hit', {
          similarity: bestMatch.similarity.toFixed(3),
          agentType: bestMatch.data.agentType,
          confidence: bestMatch.data.confidence,
        });

        return {
          agentType: bestMatch.data.agentType,
          confidence: bestMatch.data.confidence,
          timestamp: bestMatch.data.timestamp,
          queryHash: bestMatch.data.queryHash,
        };
      }

      return null;
    } catch (error) {
      logger.warn('Intent cache lookup failed', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Cache an intent for a query
   */
  async cacheIntent(
    query: string,
    agentType: string,
    confidence: number
  ): Promise<void> {
    try {
      const { embedding } = await generateEmbedding(query);
      const queryHash = this.hashQuery(query);
      const key = `${INTENT_CACHE_PREFIX}${queryHash}`;

      const data: CachedIntentData = {
        agentType,
        confidence,
        timestamp: Date.now(),
        queryHash,
        embedding,
      };

      // Store the intent with TTL
      await redis.setex(key, this.config.ttlSeconds, JSON.stringify(data));

      // Add to index
      await redis.sadd(INTENT_INDEX_KEY, key);

      // Set expiry on index key (refresh on each write)
      await redis.expire(INTENT_INDEX_KEY, this.config.ttlSeconds * 2);

      logger.debug('Cached intent', {
        queryHash,
        agentType,
        confidence,
        queryPreview: query.slice(0, 50),
      });

      // Prune cache if needed
      await this.pruneCache();
    } catch (error) {
      logger.warn('Failed to cache intent', { error: (error as Error).message });
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Hash a query string for cache key
   */
  private hashQuery(query: string): string {
    return crypto
      .createHash('sha256')
      .update(query.toLowerCase().trim())
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Prune cache to stay under max size
   */
  private async pruneCache(): Promise<void> {
    try {
      const keys = await redis.smembers(INTENT_INDEX_KEY);

      if (keys.length <= this.config.maxCacheSize) {
        return;
      }

      // Get all with timestamps
      const keysWithAge: { key: string; timestamp: number }[] = [];

      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();

      if (!results) return;

      for (let i = 0; i < keys.length; i++) {
        const result = results[i];
        if (!result || result[0] || !result[1]) {
          // Key expired or invalid - remove from index
          await redis.srem(INTENT_INDEX_KEY, keys[i]);
          continue;
        }

        try {
          const data = JSON.parse(result[1] as string);
          keysWithAge.push({ key: keys[i], timestamp: data.timestamp });
        } catch {
          await redis.srem(INTENT_INDEX_KEY, keys[i]);
        }
      }

      // Sort by age (oldest first) and delete excess
      keysWithAge.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = keysWithAge.slice(0, keysWithAge.length - this.config.maxCacheSize);

      if (toDelete.length > 0) {
        const deletePipeline = redis.pipeline();
        for (const item of toDelete) {
          deletePipeline.del(item.key);
          deletePipeline.srem(INTENT_INDEX_KEY, item.key);
        }
        await deletePipeline.exec();

        logger.debug('Pruned intent cache', { deleted: toDelete.length });
      }
    } catch (error) {
      logger.warn('Cache pruning failed', { error: (error as Error).message });
    }
  }

  /**
   * Clear all cached intents (for testing/debugging)
   */
  async clearCache(): Promise<void> {
    try {
      const keys = await redis.smembers(INTENT_INDEX_KEY);

      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        for (const key of keys) {
          pipeline.del(key);
        }
        pipeline.del(INTENT_INDEX_KEY);
        await pipeline.exec();
      }

      logger.info('Intent cache cleared');
    } catch (error) {
      logger.warn('Failed to clear intent cache', { error: (error as Error).message });
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ size: number; oldestTimestamp: number | null }> {
    try {
      const keys = await redis.smembers(INTENT_INDEX_KEY);
      let oldestTimestamp: number | null = null;

      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        for (const key of keys) {
          pipeline.get(key);
        }
        const results = await pipeline.exec();

        if (results) {
          for (const result of results) {
            if (result && !result[0] && result[1]) {
              try {
                const data = JSON.parse(result[1] as string);
                if (!oldestTimestamp || data.timestamp < oldestTimestamp) {
                  oldestTimestamp = data.timestamp;
                }
              } catch {
                // Skip invalid entries
              }
            }
          }
        }
      }

      return { size: keys.length, oldestTimestamp };
    } catch {
      return { size: 0, oldestTimestamp: null };
    }
  }
}

// Singleton instance
export const intentCache = new IntentCache();
