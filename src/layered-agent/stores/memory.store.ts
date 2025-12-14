/**
 * Memory Store - pgvector Retrieval
 *
 * Wraps existing embedding service with metadata filtering
 * and topic-aware retrieval for the layered agent.
 */

import * as embeddingService from '../../memory/embedding.service.js';
import * as factsService from '../../memory/facts.service.js';
import * as sessionLogService from '../../chat/session-log.service.js';
import { query } from '../../db/postgres.js';
import type { AgentView } from '../schemas/events.js';
import logger from '../../utils/logger.js';

export interface MemorySearchOptions {
  limit?: number;
  threshold?: number;
  excludeSessionId?: string;
  topic?: string | null;
  tags?: string[];
}

export interface MemoryResult {
  content: string;
  role: string;
  similarity: number;
  sessionId: string;
  createdAt: Date;
}

/**
 * Search for relevant memories using vector similarity
 * Enhanced with topic and tag filtering
 */
export async function searchMemories(
  queryText: string,
  userId: string,
  options: MemorySearchOptions = {}
): Promise<MemoryResult[]> {
  const {
    limit = 8,
    threshold = 0.7,
    excludeSessionId,
    topic,
    tags,
  } = options;

  try {
    // Generate embedding for query
    const { embedding } = await embeddingService.generateEmbedding(queryText);
    const vectorString = `[${embedding.join(',')}]`;

    // Build query with optional filters
    let sql = `
      SELECT
        message_id,
        session_id,
        content,
        role,
        1 - (embedding <=> $1::vector) as similarity,
        created_at,
        tags,
        meta
      FROM message_embeddings
      WHERE user_id = $2
        AND 1 - (embedding <=> $1::vector) > $3
    `;
    const params: unknown[] = [vectorString, userId, threshold];
    let paramIndex = 4;

    if (excludeSessionId) {
      sql += ` AND session_id != $${paramIndex++}`;
      params.push(excludeSessionId);
    }

    // Topic filter using meta->>'topic' if available
    if (topic) {
      sql += ` AND (meta->>'topic' = $${paramIndex++} OR meta->>'topic' IS NULL)`;
      params.push(topic);
    }

    // Tags filter using array overlap
    if (tags && tags.length > 0) {
      sql += ` AND (tags && $${paramIndex++} OR tags IS NULL)`;
      params.push(tags);
    }

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIndex}`;
    params.push(limit);

    const rows = await query<{
      message_id: string;
      session_id: string;
      content: string;
      role: string;
      similarity: string;
      created_at: Date;
      tags: string[] | null;
      meta: Record<string, unknown> | null;
    }>(sql, params);

    return rows.map(row => ({
      content: row.content,
      role: row.role,
      similarity: parseFloat(row.similarity),
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));
  } catch (error) {
    logger.error('Failed to search memories', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * Search for relevant conversation summaries
 */
export async function searchConversations(
  queryText: string,
  userId: string,
  limit: number = 3
): Promise<Array<{
  sessionId: string;
  summary: string;
  topics: string[];
  similarity: number;
}>> {
  try {
    return await embeddingService.searchSimilarConversations(queryText, userId, limit);
  } catch (error) {
    logger.error('Failed to search conversations', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * Get user facts for context
 */
export async function getUserFacts(
  userId: string,
  limit: number = 30
): Promise<Array<{
  category: string;
  key: string;
  value: string;
  confidence: number;
}>> {
  try {
    const facts = await factsService.getUserFacts(userId, { limit });
    return facts.map(f => ({
      category: f.category,
      key: f.factKey,
      value: f.factValue,
      confidence: f.confidence,
    }));
  } catch (error) {
    logger.error('Failed to get user facts', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * Build complete memory context for a turn
 * Returns formatted strings ready for prompt injection
 */
export async function buildMemoryContext(
  userId: string,
  userInput: string,
  sessionId: string,
  agentView: AgentView
): Promise<{
  memories: string[];
  facts: string;
  conversations: string;
  recentActions: string;
}> {
  try {
    // Run all queries in parallel
    const [memories, facts, conversations, sessionLogs] = await Promise.all([
      // Search for relevant past messages
      searchMemories(userInput, userId, {
        limit: 8,
        threshold: 0.75,
        excludeSessionId: sessionId,
        topic: agentView.current_topic,
      }),
      // Get user facts
      getUserFacts(userId, 30),
      // Search for similar conversation summaries
      searchConversations(userInput, userId, 3),
      // Get recent session logs with tool actions
      sessionLogService.getRecentSessionLogs(userId, 5),
    ]);

    // Format memories as strings
    const memoryStrings = memories.map(m => {
      const role = m.role === 'user' ? 'User' : 'Luna';
      const truncated = m.content.length > 200
        ? m.content.slice(0, 200) + '...'
        : m.content;
      return `[${role}]: ${truncated}`;
    });

    // Format facts
    let factsString = '';
    if (facts.length > 0) {
      // Group by category
      const byCategory = facts.reduce((acc, f) => {
        if (!acc[f.category]) acc[f.category] = [];
        acc[f.category].push(`${f.key}: ${f.value}`);
        return acc;
      }, {} as Record<string, string[]>);

      const categoryLines = Object.entries(byCategory)
        .map(([cat, items]) => `${cat}: ${items.join(', ')}`);

      factsString = `[User Facts]\n${categoryLines.join('\n')}`;
    }

    // Format conversations
    let conversationsString = '';
    if (conversations.length > 0) {
      const convLines = conversations.map(c =>
        `- ${c.summary} (Topics: ${c.topics.join(', ')})`
      );
      conversationsString = `[Related Past Topics]\n${convLines.join('\n')}`;
    }

    // Format recent session actions (tool usage from legacy chat)
    let recentActionsString = '';
    const sessionsWithTools = sessionLogs.filter(
      log => log.toolsUsed && log.toolsUsed.length > 0
    );
    if (sessionsWithTools.length > 0) {
      const actionLines = sessionsWithTools.map(log => {
        const timeAgo = formatTimeAgo(log.startedAt);
        const summary = log.summary || 'Session completed';
        const tools = log.toolsUsed?.join(', ') || '';
        return `- ${timeAgo}: ${summary} (used: ${tools})`;
      });
      recentActionsString = `[Recent Actions Luna Performed]\n${actionLines.join('\n')}`;
    }

    return {
      memories: memoryStrings,
      facts: factsString,
      conversations: conversationsString,
      recentActions: recentActionsString,
    };
  } catch (error) {
    logger.error('Failed to build memory context', {
      error: (error as Error).message,
      userId,
      sessionId,
    });
    return {
      memories: [],
      facts: '',
      conversations: '',
      recentActions: '',
    };
  }
}

/**
 * Format time ago for session logs
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 5) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    const days = Math.floor(diffHours / 24);
    return `${days}d ago`;
  }
}

/**
 * Store a message embedding with metadata
 */
export async function storeMemory(
  messageId: string,
  userId: string,
  sessionId: string,
  content: string,
  role: string,
  meta?: {
    topic?: string;
    tags?: string[];
  }
): Promise<void> {
  try {
    const { embedding } = await embeddingService.generateEmbedding(content);
    const vectorString = `[${embedding.join(',')}]`;

    await query(
      `INSERT INTO message_embeddings (message_id, user_id, session_id, content, role, embedding, tags, meta)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        messageId,
        userId,
        sessionId,
        content,
        role,
        vectorString,
        meta?.tags || null,
        meta ? JSON.stringify(meta) : null,
      ]
    );

    logger.debug('Stored memory with metadata', {
      messageId,
      userId,
      topic: meta?.topic,
      tags: meta?.tags,
    });
  } catch (error) {
    logger.error('Failed to store memory', {
      error: (error as Error).message,
      messageId,
    });
    // Don't throw - memory storage is non-critical
  }
}

/**
 * Format memories for prompt injection
 */
export function formatMemoriesForPrompt(
  memories: string[],
  facts: string,
  conversations: string,
  recentActions?: string
): string {
  const parts: string[] = [];

  if (facts) {
    parts.push(facts);
  }

  // Recent actions first - most relevant for context continuity
  if (recentActions) {
    parts.push(recentActions);
  }

  if (memories.length > 0) {
    parts.push(`[Relevant Past Conversations]\n${memories.join('\n')}`);
  }

  if (conversations) {
    parts.push(conversations);
  }

  return parts.join('\n\n');
}

export default {
  searchMemories,
  searchConversations,
  getUserFacts,
  buildMemoryContext,
  storeMemory,
  formatMemoriesForPrompt,
};
