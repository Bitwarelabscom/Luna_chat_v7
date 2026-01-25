import { pool } from '../db/index.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import { createChatCompletion } from '../llm/openai.client.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface ResearchCollection {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  goalId: string | null;
  sessionId: string | null;
  status: 'active' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export type ResearchSourceType = 'web_page' | 'search_result' | 'rss_article' | 'document' | 'user_input';

export interface ResearchItem {
  id: string;
  collectionId: string;
  userId: string;
  sourceType: ResearchSourceType;
  sourceUrl: string | null;
  title: string | null;
  content: string | null;
  summary: string | null;
  keyFindings: string[];
  relevanceScore: number;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateCollectionInput {
  title: string;
  description?: string;
  goalId?: string;
  sessionId?: string;
}

export interface CreateResearchItemInput {
  sourceType: ResearchSourceType;
  sourceUrl?: string;
  title?: string;
  content?: string;
  summary?: string;
  keyFindings?: string[];
  relevanceScore?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ============================================
// Collection Management
// ============================================

export async function createCollection(
  userId: string,
  input: CreateCollectionInput
): Promise<ResearchCollection> {
  const result = await pool.query(
    `INSERT INTO research_collections
     (user_id, title, description, goal_id, session_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, input.title, input.description || null, input.goalId || null, input.sessionId || null]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create research collection');
  }

  const row = result.rows[0];
  logger.info('Research collection created', {
    collectionId: row.id,
    userId,
    title: input.title,
  });

  return mapCollection(row);
}

export async function getCollection(
  collectionId: string,
  userId: string
): Promise<ResearchCollection | null> {
  const result = await pool.query(
    `SELECT * FROM research_collections WHERE id = $1 AND user_id = $2`,
    [collectionId, userId]
  );

  return result.rows.length > 0 ? mapCollection(result.rows[0]) : null;
}

export async function getCollections(
  userId: string,
  filters?: { status?: ResearchCollection['status']; goalId?: string; sessionId?: string; limit?: number }
): Promise<ResearchCollection[]> {
  let sql = `SELECT * FROM research_collections WHERE user_id = $1`;
  const params: (string | number)[] = [userId];

  if (filters?.status) {
    params.push(filters.status);
    sql += ` AND status = $${params.length}`;
  }

  if (filters?.goalId) {
    params.push(filters.goalId);
    sql += ` AND goal_id = $${params.length}`;
  }

  if (filters?.sessionId) {
    params.push(filters.sessionId);
    sql += ` AND session_id = $${params.length}`;
  }

  sql += ` ORDER BY updated_at DESC`;

  if (filters?.limit) {
    params.push(filters.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const result = await pool.query(sql, params);

  return result.rows.map(mapCollection);
}

export async function updateCollection(
  collectionId: string,
  userId: string,
  updates: { title?: string; description?: string; status?: ResearchCollection['status'] }
): Promise<ResearchCollection | null> {
  const setClauses: string[] = [];
  const params: (string | number)[] = [collectionId, userId];

  if (updates.title !== undefined) {
    params.push(updates.title);
    setClauses.push(`title = $${params.length}`);
  }

  if (updates.description !== undefined) {
    params.push(updates.description);
    setClauses.push(`description = $${params.length}`);
  }

  if (updates.status !== undefined) {
    params.push(updates.status);
    setClauses.push(`status = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return getCollection(collectionId, userId);
  }

  setClauses.push('updated_at = NOW()');

  const result = await pool.query(
    `UPDATE research_collections
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    params
  );

  return result.rows.length > 0 ? mapCollection(result.rows[0]) : null;
}

export async function deleteCollection(
  collectionId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM research_collections WHERE id = $1 AND user_id = $2`,
    [collectionId, userId]
  );

  return result.rowCount === 1;
}

export async function linkCollectionToGoal(
  collectionId: string,
  userId: string,
  goalId: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE research_collections
     SET goal_id = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [collectionId, userId, goalId]
  );

  return result.rowCount === 1;
}

// ============================================
// Research Item Management
// ============================================

export async function addResearchItem(
  collectionId: string,
  userId: string,
  input: CreateResearchItemInput
): Promise<ResearchItem> {
  // Generate embedding if content is provided
  let embedding: number[] | null = null;
  const textForEmbedding = [input.title, input.summary, input.content]
    .filter(Boolean)
    .join('\n\n')
    .substring(0, 8000);

  if (textForEmbedding.length > 0) {
    try {
      const result = await generateEmbedding(textForEmbedding);
      embedding = result.embedding;
    } catch (error) {
      logger.warn('Failed to generate embedding for research item', { error });
    }
  }

  const embeddingValue = embedding ? `[${embedding.join(',')}]` : null;

  const result = await pool.query(
    `INSERT INTO research_items
     (collection_id, user_id, source_type, source_url, title, content, summary, key_findings, relevance_score, tags, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector)
     RETURNING *`,
    [
      collectionId,
      userId,
      input.sourceType,
      input.sourceUrl || null,
      input.title || null,
      input.content || null,
      input.summary || null,
      input.keyFindings || null,
      input.relevanceScore ?? 0.5,
      input.tags || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      embeddingValue,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create research item');
  }

  // Update collection timestamp
  await pool.query(
    `UPDATE research_collections SET updated_at = NOW() WHERE id = $1`,
    [collectionId]
  );

  const row = result.rows[0];
  logger.debug('Research item added', {
    itemId: row.id,
    collectionId,
    sourceType: input.sourceType,
  });

  return mapItem(row);
}

export async function getCollectionItems(
  collectionId: string,
  userId: string,
  limit = 50
): Promise<ResearchItem[]> {
  const result = await pool.query(
    `SELECT ri.* FROM research_items ri
     JOIN research_collections rc ON ri.collection_id = rc.id
     WHERE ri.collection_id = $1 AND rc.user_id = $2
     ORDER BY ri.relevance_score DESC, ri.created_at DESC
     LIMIT $3`,
    [collectionId, userId, limit]
  );

  return result.rows.map(mapItem);
}

export async function searchResearch(
  userId: string,
  queryText: string,
  options?: { collectionId?: string; limit?: number }
): Promise<Array<ResearchItem & { similarity: number }>> {
  const { collectionId, limit = 10 } = options || {};

  // Generate embedding for query
  let queryEmbedding: number[];
  try {
    const result = await generateEmbedding(queryText);
    queryEmbedding = result.embedding;
  } catch (error) {
    logger.error('Failed to generate search embedding', { error });
    return [];
  }

  const embeddingValue = `[${queryEmbedding.join(',')}]`;

  let sql = `
    SELECT ri.*, 1 - (ri.embedding <=> $1::vector) AS similarity
    FROM research_items ri
    JOIN research_collections rc ON ri.collection_id = rc.id
    WHERE rc.user_id = $2
    AND ri.embedding IS NOT NULL
  `;
  const params: (string | number)[] = [embeddingValue, userId];

  if (collectionId) {
    params.push(collectionId);
    sql += ` AND ri.collection_id = $${params.length}`;
  }

  sql += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pool.query(sql, params);

  return result.rows.map(row => ({
    ...mapItem(row),
    similarity: row.similarity,
  }));
}

export async function deleteResearchItem(
  itemId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM research_items ri
     USING research_collections rc
     WHERE ri.id = $1 AND ri.collection_id = rc.id AND rc.user_id = $2`,
    [itemId, userId]
  );

  return result.rowCount === 1;
}

// ============================================
// Collection Summarization
// ============================================

export async function summarizeCollection(
  collectionId: string,
  userId: string
): Promise<string> {
  const collection = await getCollection(collectionId, userId);
  if (!collection) {
    throw new Error('Collection not found');
  }

  const items = await getCollectionItems(collectionId, userId, 20);
  if (items.length === 0) {
    return 'This research collection is empty.';
  }

  // Build context from items
  let context = `Research Collection: ${collection.title}\n`;
  if (collection.description) {
    context += `Description: ${collection.description}\n`;
  }
  context += `\n## Research Items:\n\n`;

  for (const item of items) {
    context += `### ${item.title || 'Untitled'}\n`;
    if (item.sourceUrl) {
      context += `Source: ${item.sourceUrl}\n`;
    }
    if (item.summary) {
      context += `Summary: ${item.summary}\n`;
    }
    if (item.keyFindings && item.keyFindings.length > 0) {
      context += `Key Findings:\n`;
      for (const finding of item.keyFindings) {
        context += `- ${finding}\n`;
      }
    }
    context += '\n';
  }

  // Truncate if too long
  if (context.length > 12000) {
    context = context.substring(0, 12000) + '...[truncated]';
  }

  const result = await createChatCompletion({
    messages: [
      {
        role: 'system',
        content: 'You are an AI assistant creating research summaries. Synthesize the research items into a coherent summary that highlights key themes, findings, and insights.',
      },
      {
        role: 'user',
        content: `Summarize this research collection:\n\n${context}`,
      },
    ],
    maxTokens: 1500,
    loggingContext: {
      userId,
      source: 'research',
      nodeName: 'collection_summary',
    },
  });

  return result.content || 'Unable to generate summary.';
}

// ============================================
// Context Formatting
// ============================================

export function formatCollectionForContext(
  collection: ResearchCollection,
  items: ResearchItem[],
  maxLength = 4000
): string {
  let text = `## Research: ${collection.title}\n`;
  if (collection.description) {
    text += `${collection.description}\n`;
  }
  text += '\n';

  for (const item of items) {
    const itemText = formatItemForContext(item);
    if (text.length + itemText.length > maxLength) {
      text += '...[more items available]\n';
      break;
    }
    text += itemText;
  }

  return text;
}

function formatItemForContext(item: ResearchItem): string {
  let text = `### ${item.title || 'Untitled'}\n`;

  if (item.summary) {
    text += `${item.summary}\n`;
  }

  if (item.keyFindings && item.keyFindings.length > 0) {
    text += 'Key findings:\n';
    for (const finding of item.keyFindings) {
      text += `- ${finding}\n`;
    }
  }

  if (item.sourceUrl) {
    text += `Source: ${item.sourceUrl}\n`;
  }

  text += '\n';
  return text;
}

export async function formatActiveResearchForContext(
  userId: string,
  maxLength = 4000
): Promise<string> {
  const collections = await getCollections(userId, { status: 'active', limit: 3 });

  if (collections.length === 0) {
    return '';
  }

  let text = '## Active Research\n\n';
  const perCollectionLimit = Math.floor(maxLength / collections.length);

  for (const collection of collections) {
    const items = await getCollectionItems(collection.id, userId, 5);
    const collectionText = formatCollectionForContext(collection, items, perCollectionLimit);
    text += collectionText;
  }

  return text;
}

// ============================================
// Helpers
// ============================================

function mapCollection(row: {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  goal_id: string | null;
  session_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}): ResearchCollection {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    goalId: row.goal_id,
    sessionId: row.session_id,
    status: row.status as ResearchCollection['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: {
  id: string;
  collection_id: string;
  user_id: string;
  source_type: string;
  source_url: string | null;
  title: string | null;
  content: string | null;
  summary: string | null;
  key_findings: string[] | null;
  relevance_score: number;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}): ResearchItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    userId: row.user_id,
    sourceType: row.source_type as ResearchSourceType,
    sourceUrl: row.source_url,
    title: row.title,
    content: row.content,
    summary: row.summary,
    keyFindings: row.key_findings || [],
    relevanceScore: row.relevance_score,
    tags: row.tags || [],
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}
