import OpenAI from 'openai';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const EMBEDDING_MODEL = 'text-embedding-3-small';

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

/**
 * Generate embedding for text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // Limit to ~8k chars to stay within token limits
    });

    return {
      embedding: response.data[0].embedding,
      tokensUsed: response.usage?.total_tokens || 0,
    };
  } catch (error) {
    logger.error('Failed to generate embedding', { error: (error as Error).message });
    throw error;
  }
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
};
