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

const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const MAX_INPUT_CHARS = 30000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

/**
 * Create a cache key from text (hash first 1000 chars for efficiency)
 */
function getCacheKey(text: string): string {
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
 * Generate embedding for text using OpenRouter API
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
  const requestPromise = generateEmbeddingInternal(text, cacheKey);
  inFlightRequests.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Generate embeddings for multiple texts in a single API call
 */
export async function generateEmbeddingBatch(
  texts: string[],
  options: { chunkSize?: number } = {}
): Promise<EmbeddingResult[]> {
  const { chunkSize = 32 } = options;

  if (texts.length === 0) return [];
  if (texts.length === 1) return [await generateEmbedding(texts[0])];

  const results: EmbeddingResult[] = new Array(texts.length);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];
  const now = Date.now();

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const cacheKey = getCacheKey(texts[i]);
    const cached = embeddingCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < EMBEDDING_CACHE_TTL_MS) {
      results[i] = { embedding: cached.embedding, tokensUsed: 0 };
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  if (uncachedTexts.length === 0) return results;

  // Process uncached texts in chunks
  for (let start = 0; start < uncachedTexts.length; start += chunkSize) {
    const chunk = uncachedTexts.slice(start, start + chunkSize);
    const chunkResults = await callOpenRouterBatch(chunk);

    for (let j = 0; j < chunkResults.length; j++) {
      const originalIndex = uncachedIndices[start + j];
      results[originalIndex] = chunkResults[j];

      // Cache each result
      const cacheKey = getCacheKey(texts[originalIndex]);
      embeddingCache.set(cacheKey, {
        embedding: chunkResults[j].embedding,
        timestamp: Date.now(),
      });
    }

    // Small delay between chunks to avoid rate limiting
    if (start + chunkSize < uncachedTexts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (embeddingCache.size > EMBEDDING_CACHE_MAX_SIZE / 2) {
    cleanExpiredCache();
  }

  return results;
}

/**
 * Call OpenRouter embeddings API with batch input
 */
async function callOpenRouterBatch(texts: string[]): Promise<EmbeddingResult[]> {
  const model = config.openrouter?.embeddingModel ?? 'qwen/qwen3-embedding-8b';
  const dimensions = config.openrouter?.embeddingDimensions ?? 1024;
  const apiKey = config.openrouter?.apiKey;

  if (!apiKey) {
    throw new Error('OpenRouter API key not configured for embeddings');
  }

  const truncatedTexts = texts.map(t => t.slice(0, MAX_INPUT_CHARS));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: truncatedTexts.length === 1 ? truncatedTexts[0] : truncatedTexts,
          dimensions,
        }),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('OpenRouter embedding rate limited, retrying', { attempt, delayMs });
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter embedding failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        usage?: { prompt_tokens?: number; total_tokens?: number };
      };

      // Sort by index to maintain input order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      const tokensUsed = data.usage?.total_tokens ?? 0;
      const tokensPerText = Math.ceil(tokensUsed / texts.length);

      return sorted.map(item => ({
        embedding: item.embedding,
        tokensUsed: tokensPerText,
      }));
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const errorMessage = (error as Error).message;

      if (!isLastAttempt && !errorMessage.includes('API key not configured')) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('OpenRouter embedding failed, retrying', {
          attempt,
          delayMs,
          error: errorMessage,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // Last attempt failed - try Ollama fallback
      if (config.ollama?.url) {
        logger.warn('OpenRouter embedding failed, falling back to Ollama', {
          error: errorMessage,
        });
        return fallbackToOllama(truncatedTexts);
      }

      throw error;
    }
  }

  throw new Error('OpenRouter embedding failed after all retries');
}

/**
 * Fallback to Ollama for embeddings if OpenRouter is unreachable
 */
async function fallbackToOllama(texts: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (const text of texts) {
    try {
      const response = await fetch(`${config.ollama.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.embeddingModel ?? 'bge-m3',
          input: text.slice(0, 8000),
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama fallback failed: ${response.status}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      results.push({ embedding: data.embeddings[0], tokensUsed: 0 });
    } catch (error) {
      logger.error('Ollama fallback also failed', { error: (error as Error).message });
      throw error;
    }
  }

  return results;
}

/**
 * Generate embedding from OpenRouter (single text, internal)
 */
async function generateEmbeddingInternal(text: string, cacheKey: string): Promise<EmbeddingResult> {
  try {
    const [result] = await callOpenRouterBatch([text]);

    // Store in cache
    embeddingCache.set(cacheKey, { embedding: result.embedding, timestamp: Date.now() });

    if (embeddingCache.size > EMBEDDING_CACHE_MAX_SIZE / 2) {
      cleanExpiredCache();
    }

    return result;
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
 * Store message embedding in database with retry for FK race condition
 */
export async function storeMessageEmbedding(
  messageId: string,
  userId: string,
  sessionId: string,
  content: string,
  role: string,
  intentId?: string | null,
  enrichment?: { emotionalValence?: number; attentionScore?: number }
): Promise<void> {
  const maxRetries = 3;
  const retryDelayMs = 500;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { embedding } = await generateEmbedding(content);

      // Format embedding as PostgreSQL vector string
      const vectorString = `[${embedding.join(',')}]`;

      await pool.query(
        `INSERT INTO message_embeddings (message_id, user_id, session_id, content, role, embedding, intent_id, emotional_valence, attention_score)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [messageId, userId, sessionId, content, role, vectorString, intentId || null, enrichment?.emotionalValence ?? null, enrichment?.attentionScore ?? null]
      );

      logger.debug('Stored message embedding', { messageId, userId, intentId });
      return; // Success - exit function
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Check if it's a foreign key violation (message not yet committed)
      if (errorMessage.includes('foreign key constraint') && attempt < maxRetries) {
        logger.debug('Message not yet committed, retrying embedding storage', {
          messageId,
          attempt,
          nextRetryMs: retryDelayMs
        });
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }

      // Log error but don't throw - embedding storage is not critical
      logger.error('Failed to store memory', {
        error: errorMessage,
        messageId
      });
      return;
    }
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
    intentId?: string | null;
  } = {}
): Promise<SimilarMessage[]> {
  const { limit = 5, threshold = 0.7, excludeSessionId, intentId } = options;

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

    const params: (string | number | null)[] = [vectorString, userId, threshold];

    if (excludeSessionId) {
      queryText += ` AND session_id != $4`;
      params.push(excludeSessionId);
    }

    if (intentId) {
      queryText += ` AND (intent_id = $${params.length + 1} OR intent_id IS NULL)`;
      params.push(intentId);
    }

    queryText += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await pool.query(queryText, params as any[]);

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
  sentiment: string = 'neutral',
  intentId?: string | null
): Promise<void> {
  try {
    const { embedding } = await generateEmbedding(summary);
    const vectorString = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO conversation_summaries
         (session_id, user_id, summary, topics, key_points, sentiment, embedding, message_count, intent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)
       ON CONFLICT (session_id) DO UPDATE SET
         summary = EXCLUDED.summary,
         topics = EXCLUDED.topics,
         key_points = EXCLUDED.key_points,
         sentiment = EXCLUDED.sentiment,
         embedding = EXCLUDED.embedding,
         message_count = EXCLUDED.message_count,
         intent_id = EXCLUDED.intent_id,
         updated_at = NOW()`,
      [sessionId, userId, summary, topics, keyPoints, sentiment, vectorString, messageCount, intentId || null]
    );

    logger.debug('Stored conversation summary', { sessionId, userId, intentId });
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
  limit: number = 3,
  intentId?: string | null
): Promise<Array<{
  sessionId: string;
  summary: string;
  topics: string[];
  similarity: number;
  updatedAt: Date;
}>> {
  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    let queryText = `
      SELECT
        session_id,
        summary,
        topics,
        1 - (embedding <=> $1::vector) as similarity,
        updated_at
      FROM conversation_summaries
      WHERE user_id = $2
        AND 1 - (embedding <=> $1::vector) > 0.6
    `;

    const params: (string | number | null)[] = [vectorString, userId];

    if (intentId) {
      queryText += ` AND (intent_id = $${params.length + 1} OR intent_id IS NULL)`;
      params.push(intentId);
    }

    queryText += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await pool.query(queryText, params as any[]);

    return result.rows.map((row: Record<string, unknown>) => ({
      sessionId: row.session_id as string,
      summary: row.summary as string,
      topics: (row.topics as string[]) || [],
      similarity: parseFloat(row.similarity as string),
      updatedAt: row.updated_at as Date,
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
  generateEmbeddingBatch,
  storeMessageEmbedding,
  searchSimilarMessages,
  storeConversationSummary,
  searchSimilarConversations,
  getEmbeddingCacheStats,
};
