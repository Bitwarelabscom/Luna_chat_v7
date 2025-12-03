import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export interface EmbeddingResult {
  embedding: number[];
  tokensUsed: number;
}

export interface SimilarMessage {
  messageId: string;
  sessionId: string;
  content: string;
  role: string;
  similarity: number;
  createdAt: Date;
}

// ============================================
// Embedding Cache with TTL
// OPTIMIZATION: Prevents duplicate embedding generation for the same text
// ============================================

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EMBEDDING_CACHE_MAX_SIZE = 100;
const embeddingCache = new Map<string, CacheEntry>();

// In-flight requests to prevent duplicate concurrent calls
const inFlightRequests = new Map<string, Promise<EmbeddingResult>>();

/**
 * Create a cache key from text (hash first 1000 chars for efficiency)
 */
function getCacheKey(text: string): string {
  // Use first 1000 chars as key (most queries are short)
  return text.slice(0, 1000);
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of embeddingCache.entries()) {
    if (now - entry.timestamp > EMBEDDING_CACHE_TTL_MS) {
      embeddingCache.delete(key);
    }
  }
  // Also enforce max size (LRU-ish: remove oldest entries)
  if (embeddingCache.size > EMBEDDING_CACHE_MAX_SIZE) {
    const entries = Array.from(embeddingCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, embeddingCache.size - EMBEDDING_CACHE_MAX_SIZE);
    for (const [key] of toRemove) {
      embeddingCache.delete(key);
    }
  }
}

/**
 * Generate embedding for text using Ollama
 * OPTIMIZED: Uses cache to prevent duplicate embedding generation
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const cacheKey = getCacheKey(text);
  const now = Date.now();

  // Check cache first
  const cached = embeddingCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < EMBEDDING_CACHE_TTL_MS) {
    logger.debug('Embedding cache hit', { keyLength: cacheKey.length });
    return { embedding: cached.embedding, tokensUsed: 0 };
  }

  // Check for in-flight request to prevent duplicate concurrent calls
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    logger.debug('Embedding request coalesced', { keyLength: cacheKey.length });
    return inFlight;
  }

  // Create the request promise
  const requestPromise = generateEmbeddingFromOllama(text, cacheKey);
  inFlightRequests.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Actually generate embedding from Ollama (internal function)
 */
async function generateEmbeddingFromOllama(text: string, cacheKey: string): Promise<EmbeddingResult> {
  try {
    const response = await fetch(`${config.ollama.url}/api/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ollama.embeddingModel,
        input: text.slice(0, 8000), // Limit to ~8k chars
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    const embedding = data.embeddings[0];

    // Store in cache
    embeddingCache.set(cacheKey, { embedding, timestamp: Date.now() });

    // Clean expired entries periodically
    if (embeddingCache.size > EMBEDDING_CACHE_MAX_SIZE / 2) {
      cleanExpiredCache();
    }

    return {
      embedding,
      tokensUsed: 0, // Ollama doesn't report token usage for embeddings
    };
  } catch (error) {
    logger.error('Failed to generate embedding', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get embedding cache stats (for monitoring)
 */
export function getEmbeddingCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return {
    size: embeddingCache.size,
    maxSize: EMBEDDING_CACHE_MAX_SIZE,
    ttlMs: EMBEDDING_CACHE_TTL_MS,
  };
}

/**
 * Store message embedding in database
 */
export async function storeMessageEmbedding(
  messageId: string,
  userId: string,
  sessionId: string,
  content: string,
  role: string
): Promise<void> {
  try {
    const { embedding } = await generateEmbedding(content);

    // Format embedding as PostgreSQL vector string
    const vectorString = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO message_embeddings (message_id, user_id, session_id, content, role, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       ON CONFLICT DO NOTHING`,
      [messageId, userId, sessionId, content, role, vectorString]
    );

    logger.debug('Stored message embedding', { messageId, userId });
  } catch (error) {
    logger.error('Failed to store message embedding', {
      error: (error as Error).message,
      messageId
    });
    // Don't throw - embedding storage is not critical
  }
}

/**
 * Search for similar messages using vector similarity
 */
export async function searchSimilarMessages(
  query: string,
  userId: string,
  options: {
    limit?: number;
    threshold?: number;
    excludeSessionId?: string;
  } = {}
): Promise<SimilarMessage[]> {
  const { limit = 5, threshold = 0.7, excludeSessionId } = options;

  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    let queryText = `
      SELECT
        message_id,
        session_id,
        content,
        role,
        1 - (embedding <=> $1::vector) as similarity,
        created_at
      FROM message_embeddings
      WHERE user_id = $2
        AND 1 - (embedding <=> $1::vector) > $3
    `;

    const params: (string | number)[] = [vectorString, userId, threshold];

    if (excludeSessionId) {
      queryText += ` AND session_id != $4`;
      params.push(excludeSessionId);
    }

    queryText += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(queryText, params);

    return result.rows.map((row: Record<string, unknown>) => ({
      messageId: row.message_id as string,
      sessionId: row.session_id as string,
      content: row.content as string,
      role: row.role as string,
      similarity: parseFloat(row.similarity as string),
      createdAt: row.created_at as Date,
    }));
  } catch (error) {
    logger.error('Failed to search similar messages', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Store conversation summary embedding
 */
export async function storeConversationSummary(
  sessionId: string,
  userId: string,
  summary: string,
  topics: string[],
  keyPoints: string[],
  messageCount: number,
  sentiment: string = 'neutral'
): Promise<void> {
  try {
    const { embedding } = await generateEmbedding(summary);
    const vectorString = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO conversation_summaries
         (session_id, user_id, summary, topics, key_points, sentiment, embedding, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)
       ON CONFLICT (session_id) DO UPDATE SET
         summary = EXCLUDED.summary,
         topics = EXCLUDED.topics,
         key_points = EXCLUDED.key_points,
         sentiment = EXCLUDED.sentiment,
         embedding = EXCLUDED.embedding,
         message_count = EXCLUDED.message_count,
         updated_at = NOW()`,
      [sessionId, userId, summary, topics, keyPoints, sentiment, vectorString, messageCount]
    );

    logger.debug('Stored conversation summary', { sessionId, userId });
  } catch (error) {
    logger.error('Failed to store conversation summary', {
      error: (error as Error).message,
      sessionId
    });
  }
}

/**
 * Search for similar conversations by summary
 */
export async function searchSimilarConversations(
  query: string,
  userId: string,
  limit: number = 3
): Promise<Array<{
  sessionId: string;
  summary: string;
  topics: string[];
  similarity: number;
}>> {
  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    const result = await pool.query(
      `SELECT
        session_id,
        summary,
        topics,
        1 - (embedding <=> $1::vector) as similarity
      FROM conversation_summaries
      WHERE user_id = $2
        AND 1 - (embedding <=> $1::vector) > 0.6
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
      [vectorString, userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      sessionId: row.session_id as string,
      summary: row.summary as string,
      topics: (row.topics as string[]) || [],
      similarity: parseFloat(row.similarity as string),
    }));
  } catch (error) {
    logger.error('Failed to search similar conversations', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

export default {
  generateEmbedding,
  storeMessageEmbedding,
  searchSimilarMessages,
  storeConversationSummary,
  searchSimilarConversations,
  getEmbeddingCacheStats,
};
