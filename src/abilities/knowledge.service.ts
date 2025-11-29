import { pool } from '../db/index.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import logger from '../utils/logger.js';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category?: string;
  tags: string[];
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeInput {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  isPinned?: boolean;
}

/**
 * Create a new knowledge item
 */
export async function createKnowledgeItem(
  userId: string,
  input: CreateKnowledgeInput
): Promise<KnowledgeItem> {
  try {
    const { embedding } = await generateEmbedding(`${input.title}\n\n${input.content}`);
    const vectorString = `[${embedding.join(',')}]`;

    const result = await pool.query(
      `INSERT INTO knowledge_items (user_id, title, content, category, tags, is_pinned, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id, title, content, category, tags, is_pinned, created_at, updated_at`,
      [userId, input.title, input.content, input.category, input.tags || [], input.isPinned || false, vectorString]
    );

    const row = result.rows[0];
    logger.info('Created knowledge item', { userId, title: input.title });

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      tags: row.tags || [],
      isPinned: row.is_pinned,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    logger.error('Failed to create knowledge item', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Get all knowledge items for a user
 */
export async function getKnowledgeItems(
  userId: string,
  options: { category?: string; limit?: number; offset?: number } = {}
): Promise<KnowledgeItem[]> {
  const { category, limit = 50, offset = 0 } = options;

  try {
    let query = `
      SELECT id, title, content, category, tags, is_pinned, created_at, updated_at
      FROM knowledge_items
      WHERE user_id = $1
    `;
    const params: (string | number)[] = [userId];

    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }

    query += ` ORDER BY is_pinned DESC, updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      category: row.category as string | undefined,
      tags: (row.tags as string[]) || [],
      isPinned: row.is_pinned as boolean,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }));
  } catch (error) {
    logger.error('Failed to get knowledge items', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Search knowledge items by semantic similarity
 */
export async function searchKnowledge(
  userId: string,
  query: string,
  limit: number = 5
): Promise<Array<KnowledgeItem & { similarity: number }>> {
  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    const result = await pool.query(
      `SELECT id, title, content, category, tags, is_pinned, created_at, updated_at,
              1 - (embedding <=> $1::vector) as similarity
       FROM knowledge_items
       WHERE user_id = $2
         AND 1 - (embedding <=> $1::vector) > 0.5
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorString, userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      category: row.category as string | undefined,
      tags: (row.tags as string[]) || [],
      isPinned: row.is_pinned as boolean,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      similarity: parseFloat(row.similarity as string),
    }));
  } catch (error) {
    logger.error('Failed to search knowledge', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Update a knowledge item
 */
export async function updateKnowledgeItem(
  userId: string,
  itemId: string,
  updates: Partial<CreateKnowledgeInput>
): Promise<KnowledgeItem | null> {
  try {
    // Build dynamic update query
    const setClauses: string[] = [];
    const params: unknown[] = [userId, itemId];
    let paramIndex = 3;

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(updates.title);
    }
    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      params.push(updates.content);
    }
    if (updates.category !== undefined) {
      setClauses.push(`category = $${paramIndex++}`);
      params.push(updates.category);
    }
    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`);
      params.push(updates.tags);
    }
    if (updates.isPinned !== undefined) {
      setClauses.push(`is_pinned = $${paramIndex++}`);
      params.push(updates.isPinned);
    }

    if (setClauses.length === 0) return null;

    // Re-embed if content changed
    if (updates.title !== undefined || updates.content !== undefined) {
      const existingResult = await pool.query(
        `SELECT title, content FROM knowledge_items WHERE id = $1 AND user_id = $2`,
        [itemId, userId]
      );
      if (existingResult.rows.length > 0) {
        const title = updates.title || existingResult.rows[0].title;
        const content = updates.content || existingResult.rows[0].content;
        const { embedding } = await generateEmbedding(`${title}\n\n${content}`);
        setClauses.push(`embedding = $${paramIndex++}::vector`);
        params.push(`[${embedding.join(',')}]`);
      }
    }

    const result = await pool.query(
      `UPDATE knowledge_items
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $2 AND user_id = $1
       RETURNING id, title, content, category, tags, is_pinned, created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      tags: row.tags || [],
      isPinned: row.is_pinned,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    logger.error('Failed to update knowledge item', { error: (error as Error).message, userId, itemId });
    throw error;
  }
}

/**
 * Delete a knowledge item
 */
export async function deleteKnowledgeItem(userId: string, itemId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM knowledge_items WHERE id = $1 AND user_id = $2`,
      [itemId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to delete knowledge item', { error: (error as Error).message, userId, itemId });
    return false;
  }
}

/**
 * Format knowledge for prompt inclusion
 */
export function formatKnowledgeForPrompt(items: KnowledgeItem[]): string {
  if (items.length === 0) return '';

  const formatted = items.map(item => {
    let entry = `• ${item.title}`;
    if (item.category) entry += ` [${item.category}]`;
    entry += `\n  ${item.content.slice(0, 200)}${item.content.length > 200 ? '...' : ''}`;
    return entry;
  }).join('\n\n');

  return `[User's Knowledge Base]\n${formatted}`;
}

export default {
  createKnowledgeItem,
  getKnowledgeItems,
  searchKnowledge,
  updateKnowledgeItem,
  deleteKnowledgeItem,
  formatKnowledgeForPrompt,
};
