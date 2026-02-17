import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { formatRelativeTime } from '../memory/time-utils.js';

// ============================================
// Types
// ============================================

export interface ProactiveInsight {
  id: string;
  userId: string;
  sourceType: 'council_deliberation' | 'rss_article' | 'goal_progress' | 'pattern_discovery' | 'achievement';
  sourceId: string | null;
  insightTitle: string;
  insightContent: string;
  priority: number;
  expiresAt: Date | null;
  sharedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
}

export interface CreateInsightInput {
  sourceType: ProactiveInsight['sourceType'];
  sourceId?: string;
  insightTitle: string;
  insightContent: string;
  priority?: number;
  expiresAt?: Date;
}

export interface SessionLearning {
  id: string;
  userId: string;
  learningType: 'pattern' | 'preference' | 'improvement_area' | 'success_factor' | 'user_behavior';
  learningContent: string;
  confidence: number;
  sourceSessions: string[];
  appliedCount: number;
  successRate: number | null;
  lastApplied: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Proactive Insights
// ============================================

export async function createInsight(userId: string, input: CreateInsightInput): Promise<ProactiveInsight> {
  const result = await pool.query(
    `INSERT INTO proactive_insights (user_id, source_type, source_id, insight_title, insight_content, priority, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      input.sourceType,
      input.sourceId || null,
      input.insightTitle,
      input.insightContent,
      input.priority ?? 5,
      input.expiresAt || null,
    ]
  );

  logger.info('Insight created', { userId, title: input.insightTitle, sourceType: input.sourceType });

  return mapInsightRow(result.rows[0]);
}

export async function getInsight(insightId: string, userId: string): Promise<ProactiveInsight | null> {
  const result = await pool.query(
    `SELECT * FROM proactive_insights WHERE id = $1 AND user_id = $2`,
    [insightId, userId]
  );

  return result.rows.length > 0 ? mapInsightRow(result.rows[0]) : null;
}

export async function getInsights(
  userId: string,
  options: {
    unsharedOnly?: boolean;
    sourceType?: ProactiveInsight['sourceType'];
    limit?: number;
    offset?: number;
  } = {}
): Promise<ProactiveInsight[]> {
  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (options.unsharedOnly) {
    conditions.push('shared_at IS NULL');
    conditions.push('dismissed_at IS NULL');
    conditions.push('(expires_at IS NULL OR expires_at > NOW())');
  }

  if (options.sourceType) {
    conditions.push(`source_type = $${paramIndex++}`);
    params.push(options.sourceType);
  }

  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const result = await pool.query(
    `SELECT * FROM proactive_insights
     WHERE ${conditions.join(' AND ')}
     ORDER BY priority DESC, created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows.map(mapInsightRow);
}

export async function getPendingInsights(userId: string, limit = 5): Promise<ProactiveInsight[]> {
  return getInsights(userId, { unsharedOnly: true, limit });
}

export async function markInsightShared(insightId: string, userId: string): Promise<ProactiveInsight | null> {
  const result = await pool.query(
    `UPDATE proactive_insights SET shared_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [insightId, userId]
  );

  return result.rows.length > 0 ? mapInsightRow(result.rows[0]) : null;
}

export async function dismissInsight(insightId: string, userId: string): Promise<ProactiveInsight | null> {
  const result = await pool.query(
    `UPDATE proactive_insights SET dismissed_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [insightId, userId]
  );

  return result.rows.length > 0 ? mapInsightRow(result.rows[0]) : null;
}

export async function getHighPriorityInsight(userId: string): Promise<ProactiveInsight | null> {
  const insights = await getPendingInsights(userId, 1);
  return insights.length > 0 ? insights[0] : null;
}

// ============================================
// Session Learnings
// ============================================

export interface CreateLearningInput {
  learningType: SessionLearning['learningType'];
  learningContent: string;
  confidence?: number;
  sourceSessions?: string[];
}

export async function createLearning(userId: string, input: CreateLearningInput): Promise<SessionLearning> {
  const result = await pool.query(
    `INSERT INTO session_learnings (user_id, learning_type, learning_content, confidence, source_sessions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      userId,
      input.learningType,
      input.learningContent,
      input.confidence ?? 0.5,
      input.sourceSessions || [],
    ]
  );

  logger.info('Learning created', { userId, type: input.learningType });

  return mapLearningRow(result.rows[0]);
}

export async function getLearnings(
  userId: string,
  options: {
    learningType?: SessionLearning['learningType'];
    activeOnly?: boolean;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  } = {}
): Promise<SessionLearning[]> {
  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (options.learningType) {
    conditions.push(`learning_type = $${paramIndex++}`);
    params.push(options.learningType);
  }

  if (options.activeOnly !== false) {
    conditions.push('is_active = true');
  }

  if (options.minConfidence) {
    conditions.push(`confidence >= $${paramIndex++}`);
    params.push(options.minConfidence);
  }

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const result = await pool.query(
    `SELECT * FROM session_learnings
     WHERE ${conditions.join(' AND ')}
     ORDER BY confidence DESC, updated_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows.map(mapLearningRow);
}

export async function getActiveLearnings(userId: string, limit = 10): Promise<SessionLearning[]> {
  return getLearnings(userId, { activeOnly: true, minConfidence: 0.5, limit });
}

/**
 * Get active learnings formatted for inclusion in chat context.
 * Returns a string that can be added to the system prompt.
 */
export async function getActiveLearningsForContext(userId: string, limit = 10): Promise<string> {
  const learnings = await getLearnings(userId, {
    activeOnly: true,
    minConfidence: 0.5,
    limit,
  });

  if (learnings.length === 0) {
    return '';
  }

  const formatted = learnings.map(l => {
    const typeLabel = l.learningType.replace('_', ' ');
    const relTime = formatRelativeTime(l.updatedAt);
    const timeSuffix = relTime ? `, ${relTime}` : '';
    return `- [${typeLabel}] ${l.learningContent} (confidence: ${(l.confidence * 100).toFixed(0)}%${timeSuffix})`;
  });

  return formatted.join('\n');
}

export async function updateLearningConfidence(
  learningId: string,
  userId: string,
  confidenceDelta: number
): Promise<SessionLearning | null> {
  const result = await pool.query(
    `UPDATE session_learnings
     SET confidence = GREATEST(0, LEAST(1, confidence + $1))
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [confidenceDelta, learningId, userId]
  );

  return result.rows.length > 0 ? mapLearningRow(result.rows[0]) : null;
}

export async function recordLearningApplication(
  learningId: string,
  userId: string,
  wasSuccessful: boolean
): Promise<SessionLearning | null> {
  // Get current learning
  const current = await pool.query(
    `SELECT applied_count, success_rate FROM session_learnings WHERE id = $1 AND user_id = $2`,
    [learningId, userId]
  );

  if (current.rows.length === 0) {
    return null;
  }

  const appliedCount = current.rows[0].applied_count + 1;
  const currentSuccessRate = current.rows[0].success_rate ?? 0;
  const newSuccessRate = ((currentSuccessRate * (appliedCount - 1)) + (wasSuccessful ? 1 : 0)) / appliedCount;

  const result = await pool.query(
    `UPDATE session_learnings
     SET applied_count = $1, success_rate = $2, last_applied = NOW()
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [appliedCount, newSuccessRate, learningId, userId]
  );

  return result.rows.length > 0 ? mapLearningRow(result.rows[0]) : null;
}

export async function deactivateLearning(learningId: string, userId: string): Promise<SessionLearning | null> {
  const result = await pool.query(
    `UPDATE session_learnings SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING *`,
    [learningId, userId]
  );

  return result.rows.length > 0 ? mapLearningRow(result.rows[0]) : null;
}

// ============================================
// Learning Analysis
// ============================================

export async function findSimilarLearning(userId: string, content: string): Promise<SessionLearning | null> {
  // Simple text similarity search (could be enhanced with embeddings)
  const result = await pool.query(
    `SELECT * FROM session_learnings
     WHERE user_id = $1 AND is_active = true
       AND learning_content ILIKE $2
     ORDER BY confidence DESC
     LIMIT 1`,
    [userId, `%${content.slice(0, 50)}%`]
  );

  return result.rows.length > 0 ? mapLearningRow(result.rows[0]) : null;
}

export async function consolidateLearnings(userId: string): Promise<number> {
  // Find learnings that might be duplicates and consolidate them
  const result = await pool.query(
    `SELECT learning_type, array_agg(id) as ids, COUNT(*) as count
     FROM session_learnings
     WHERE user_id = $1 AND is_active = true
     GROUP BY learning_type, SUBSTRING(learning_content, 1, 100)
     HAVING COUNT(*) > 1`,
    [userId]
  );

  let consolidated = 0;

  for (const row of result.rows) {
    const ids = row.ids as string[];
    if (ids.length > 1) {
      // Keep the one with highest confidence, deactivate others
      const toDeactivate = ids.slice(1);
      await pool.query(
        `UPDATE session_learnings SET is_active = false WHERE id = ANY($1)`,
        [toDeactivate]
      );
      consolidated += toDeactivate.length;
    }
  }

  return consolidated;
}

// ============================================
// Insight Generation Helpers
// ============================================

export async function createGoalProgressInsight(
  userId: string,
  goalTitle: string,
  progress: number,
  target: number
): Promise<ProactiveInsight> {
  const percentage = Math.round((progress / target) * 100);

  return createInsight(userId, {
    sourceType: 'goal_progress',
    insightTitle: `Goal Progress: ${goalTitle}`,
    insightContent: `You have made ${percentage}% progress on your goal "${goalTitle}" (${progress}/${target}).`,
    priority: percentage >= 75 ? 7 : 5,
  });
}

export async function createPatternDiscoveryInsight(
  userId: string,
  pattern: string,
  description: string
): Promise<ProactiveInsight> {
  return createInsight(userId, {
    sourceType: 'pattern_discovery',
    insightTitle: `Pattern Discovered: ${pattern}`,
    insightContent: description,
    priority: 6,
  });
}

export async function createAchievementInsight(
  userId: string,
  achievementId: string,
  achievementTitle: string,
  journalEntry: string
): Promise<ProactiveInsight> {
  return createInsight(userId, {
    sourceType: 'achievement',
    sourceId: achievementId,
    insightTitle: `Achievement: ${achievementTitle}`,
    insightContent: journalEntry,
    priority: 8,
  });
}

// ============================================
// Helpers
// ============================================

function mapInsightRow(row: Record<string, unknown>): ProactiveInsight {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sourceType: row.source_type as ProactiveInsight['sourceType'],
    sourceId: row.source_id as string | null,
    insightTitle: row.insight_title as string,
    insightContent: row.insight_content as string,
    priority: row.priority as number,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    sharedAt: row.shared_at ? new Date(row.shared_at as string) : null,
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

function mapLearningRow(row: Record<string, unknown>): SessionLearning {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    learningType: row.learning_type as SessionLearning['learningType'],
    learningContent: row.learning_content as string,
    confidence: row.confidence as number,
    sourceSessions: (row.source_sessions as string[]) || [],
    appliedCount: row.applied_count as number,
    successRate: row.success_rate as number | null,
    lastApplied: row.last_applied ? new Date(row.last_applied as string) : null,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
