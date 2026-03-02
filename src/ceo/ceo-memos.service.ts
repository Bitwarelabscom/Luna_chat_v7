import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// ============================================================
// Types
// ============================================================

export type MemoType = 'decision' | 'insight' | 'status_update' | 'task_result';
export type MemoDeptSlug = 'economy' | 'marketing' | 'development' | 'research' | 'ceo';

export interface CeoMemo {
  id: string;
  userId: string;
  departmentSlug: MemoDeptSlug;
  memoType: MemoType;
  title: string;
  content: string;
  relatedTaskId: string | null;
  sessionId: string | null;
  createdAt: string;
}

// ============================================================
// Helpers
// ============================================================

function mapMemoRow(row: Record<string, unknown>): CeoMemo {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    departmentSlug: row.department_slug as MemoDeptSlug,
    memoType: row.memo_type as MemoType,
    title: row.title as string,
    content: row.content as string,
    relatedTaskId: row.related_task_id as string | null,
    sessionId: row.session_id as string | null,
    createdAt: String(row.created_at),
  };
}

// ============================================================
// CRUD
// ============================================================

export async function createMemo(
  userId: string,
  data: {
    departmentSlug: MemoDeptSlug;
    memoType?: MemoType;
    title: string;
    content: string;
    relatedTaskId?: string;
    sessionId?: string;
  }
): Promise<CeoMemo> {
  const result = await pool.query(
    `INSERT INTO ceo_memos (user_id, department_slug, memo_type, title, content, related_task_id, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      data.departmentSlug,
      data.memoType || 'status_update',
      data.title,
      data.content,
      data.relatedTaskId || null,
      data.sessionId || null,
    ]
  );
  return mapMemoRow(result.rows[0] as Record<string, unknown>);
}

export async function listMemos(
  userId: string,
  filters?: { department?: string; type?: string; since?: string; limit?: number }
): Promise<CeoMemo[]> {
  const conditions = ['user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  if (filters?.department) {
    conditions.push(`department_slug = $${idx++}`);
    params.push(filters.department);
  }
  if (filters?.type) {
    conditions.push(`memo_type = $${idx++}`);
    params.push(filters.type);
  }
  if (filters?.since) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.since);
  }

  const limit = filters?.limit || 50;
  conditions.push(`TRUE`); // no-op to simplify join
  const result = await pool.query(
    `SELECT * FROM ceo_memos WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`,
    params
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapMemoRow);
}

export async function searchMemos(
  userId: string,
  query: string,
  limit = 10
): Promise<CeoMemo[]> {
  const pattern = `%${query}%`;
  const result = await pool.query(
    `SELECT * FROM ceo_memos
     WHERE user_id = $1 AND (title ILIKE $2 OR content ILIKE $2)
     ORDER BY created_at DESC LIMIT $3`,
    [userId, pattern, limit]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapMemoRow);
}

export async function getRecentMemos(
  userId: string,
  deptSlug?: string,
  limit = 10
): Promise<CeoMemo[]> {
  if (deptSlug) {
    const result = await pool.query(
      `SELECT * FROM ceo_memos
       WHERE user_id = $1 AND department_slug = $2
       ORDER BY created_at DESC LIMIT $3`,
      [userId, deptSlug, limit]
    );
    return (result.rows as Array<Record<string, unknown>>).map(mapMemoRow);
  }
  const result = await pool.query(
    `SELECT * FROM ceo_memos
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapMemoRow);
}

/**
 * Get recent memos from OTHER departments (for cross-dept context injection)
 */
export async function getCrossDeptMemos(
  userId: string,
  excludeDept: string,
  limit = 5
): Promise<CeoMemo[]> {
  const result = await pool.query(
    `SELECT * FROM ceo_memos
     WHERE user_id = $1 AND department_slug != $2
       AND memo_type IN ('decision', 'insight', 'task_result')
     ORDER BY created_at DESC LIMIT $3`,
    [userId, excludeDept, limit]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapMemoRow);
}

/**
 * Detect if a message looks like a decision and auto-create a memo
 */
export function looksLikeDecision(content: string): boolean {
  if (content.length < 50) return false;
  const keywords = [
    'decided', 'decision', 'we will', 'approved', 'going with',
    'strategy is', 'plan is to', 'agreed on', 'conclusion',
    'recommend', 'final answer', 'action item', 'next step',
  ];
  const lower = content.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

/**
 * Extract a title from decision content (first sentence or first 80 chars)
 */
export function extractDecisionTitle(content: string): string {
  const firstSentence = content.match(/^[^.!?\n]+[.!?]/);
  if (firstSentence && firstSentence[0].length <= 120) {
    return firstSentence[0].trim();
  }
  return content.slice(0, 80).trim() + (content.length > 80 ? '...' : '');
}

logger.info('CEO Memos service loaded');
