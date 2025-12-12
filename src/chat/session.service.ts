import { query, queryOne } from '../db/postgres.js';
import type { Session, SessionCreate, Message, MessageCreate } from '../types/index.js';
import { createCompletion } from '../llm/router.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

interface DbSession {
  id: string;
  user_id: string;
  title: string;
  mode: 'assistant' | 'companion' | 'voice';
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown>;
}

interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  model: string | null;
  provider: string | null;
  search_results: unknown;
  memory_context: unknown;
  created_at: Date;
}

function mapDbSession(row: DbSession): Session {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    mode: row.mode,
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata,
  };
}

function mapDbMessage(row: DbMessage): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    tokensUsed: row.tokens_used,
    model: row.model,
    searchResults: row.search_results,
    memoryContext: row.memory_context,
    createdAt: row.created_at,
  };
}

export async function createSession(data: SessionCreate): Promise<Session> {
  const session = await queryOne<DbSession>(
    `INSERT INTO sessions (user_id, title, mode)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.userId, data.title || 'New Chat', data.mode || 'assistant']
  );

  if (!session) {
    throw new Error('Failed to create session');
  }

  logger.debug('Session created', { sessionId: session.id, userId: data.userId });
  return mapDbSession(session);
}

export async function getSession(sessionId: string, userId: string): Promise<Session | null> {
  const session = await queryOne<DbSession>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  return session ? mapDbSession(session) : null;
}

export async function getUserSessions(
  userId: string,
  options?: { limit?: number; offset?: number; includeArchived?: boolean }
): Promise<Session[]> {
  const { limit = 50, offset = 0, includeArchived = false } = options || {};

  const archivedClause = includeArchived ? '' : 'AND is_archived = false';

  const sessions = await query<DbSession>(
    `SELECT * FROM sessions
     WHERE user_id = $1 ${archivedClause}
     ORDER BY updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return sessions.map(mapDbSession);
}

export async function updateSession(
  sessionId: string,
  userId: string,
  updates: { title?: string; mode?: 'assistant' | 'companion' | 'voice'; isArchived?: boolean }
): Promise<Session | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${paramIndex++}`);
    values.push(updates.title);
  }
  if (updates.mode !== undefined) {
    setClauses.push(`mode = $${paramIndex++}`);
    values.push(updates.mode);
  }
  if (updates.isArchived !== undefined) {
    setClauses.push(`is_archived = $${paramIndex++}`);
    values.push(updates.isArchived);
  }

  if (setClauses.length === 0) return getSession(sessionId, userId);

  values.push(sessionId, userId);

  const session = await queryOne<DbSession>(
    `UPDATE sessions SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
     RETURNING *`,
    values
  );

  return session ? mapDbSession(session) : null;
}

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
    [sessionId, userId]
  );
  return result.length > 0;
}

export async function getSessionMessages(
  sessionId: string,
  options?: { limit?: number; before?: Date }
): Promise<Message[]> {
  const { limit = 100, before } = options || {};

  let sql = 'SELECT * FROM messages WHERE session_id = $1';
  const params: unknown[] = [sessionId];

  if (before) {
    sql += ' AND created_at < $2';
    params.push(before);
  }

  sql += ' ORDER BY created_at ASC LIMIT $' + (params.length + 1);
  params.push(limit);

  const messages = await query<DbMessage>(sql, params);
  return messages.map(mapDbMessage);
}

export async function addMessage(data: MessageCreate): Promise<Message> {
  const message = await queryOne<DbMessage>(
    `INSERT INTO messages (session_id, role, content, tokens_used, input_tokens, output_tokens, cache_tokens, model, provider, search_results, memory_context, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      data.sessionId,
      data.role,
      data.content,
      data.tokensUsed || 0,
      data.inputTokens || 0,
      data.outputTokens || 0,
      data.cacheTokens || 0,
      data.model || null,
      data.provider || null,
      data.searchResults ? JSON.stringify(data.searchResults) : null,
      data.memoryContext ? JSON.stringify(data.memoryContext) : null,
      data.source || 'web',
    ]
  );

  if (!message) {
    throw new Error('Failed to add message');
  }

  // Update session's updated_at
  await query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [data.sessionId]);

  return mapDbMessage(message);
}

export async function updateMessage(
  messageId: string,
  sessionId: string,
  content: string
): Promise<Message | null> {
  const message = await queryOne<DbMessage>(
    `UPDATE messages SET content = $1
     WHERE id = $2 AND session_id = $3
     RETURNING *`,
    [content, messageId, sessionId]
  );

  if (!message) return null;

  // Update session's updated_at
  await query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);

  return mapDbMessage(message);
}

export async function deleteMessage(messageId: string, sessionId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM messages WHERE id = $1 AND session_id = $2',
    [messageId, sessionId]
  );

  if (result.length === 0) return false;

  // Update session's updated_at
  await query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);

  return true;
}

export async function generateSessionTitle(messages: Message[]): Promise<string> {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return 'New Chat';

  const content = firstUserMessage.content;

  // For short messages, use as-is
  if (content.length <= 40) return content;

  try {
    // Use local Ollama qwen2.5:3b to generate a concise title
    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
      [
        {
          role: 'system',
          content: 'Generate a short chat title (3-6 words max) summarizing the user message. Reply with ONLY the title, nothing else.'
        },
        { role: 'user', content: content },
      ],
      { temperature: 0.3, maxTokens: 100 }
    );

    const title = (response.content || '').trim().replace(/^["']|["']$/g, '');
    if (title && title.length > 0 && title.length <= 60) {
      return title;
    }
  } catch (error) {
    logger.debug('Failed to generate title with LLM, using fallback', { error: (error as Error).message });
  }

  // Fallback: truncate at word boundary
  const truncated = content.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

export default {
  createSession,
  getSession,
  getUserSessions,
  updateSession,
  deleteSession,
  getSessionMessages,
  addMessage,
  generateSessionTitle,
};
