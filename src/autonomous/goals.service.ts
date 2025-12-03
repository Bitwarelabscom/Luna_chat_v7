import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface Goal {
  id: string;
  userId: string;
  goalType: 'user_focused' | 'self_improvement' | 'relationship' | 'research';
  title: string;
  description: string | null;
  targetMetric: TargetMetric | null;
  status: 'active' | 'completed' | 'paused' | 'abandoned';
  priority: number;
  dueDate: Date | null;
  parentGoalId: string | null;
  createdBy: 'luna' | 'user';
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TargetMetric {
  type: 'count' | 'frequency' | 'milestone';
  target: number;
  current: number;
}

export interface Achievement {
  id: string;
  userId: string;
  goalId: string | null;
  title: string;
  description: string | null;
  achievementType: 'goal_completed' | 'milestone' | 'discovery' | 'improvement' | 'insight';
  journalEntry: string | null;
  metadata: Record<string, unknown> | null;
  celebrated: boolean;
  createdAt: Date;
}

export interface CreateGoalInput {
  goalType: Goal['goalType'];
  title: string;
  description?: string;
  targetMetric?: TargetMetric;
  priority?: number;
  dueDate?: Date | string;
  parentGoalId?: string;
  createdBy?: 'luna' | 'user';
}

export interface UpdateGoalInput {
  title?: string;
  description?: string;
  targetMetric?: TargetMetric;
  status?: Goal['status'];
  priority?: number;
  dueDate?: Date | string | null;
}

export interface GoalFilters {
  status?: Goal['status'];
  goalType?: Goal['goalType'];
  createdBy?: 'luna' | 'user';
  limit?: number;
  offset?: number;
}

export interface AchievementFilters {
  achievementType?: Achievement['achievementType'];
  celebrated?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================
// Goals CRUD
// ============================================

export async function createGoal(userId: string, input: CreateGoalInput): Promise<Goal> {
  const result = await pool.query(
    `INSERT INTO autonomous_goals (user_id, goal_type, title, description, target_metric, priority, due_date, parent_goal_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId,
      input.goalType,
      input.title,
      input.description || null,
      input.targetMetric ? JSON.stringify(input.targetMetric) : null,
      input.priority ?? 5,
      input.dueDate || null,
      input.parentGoalId || null,
      input.createdBy ?? 'user',
    ]
  );

  logger.info('Goal created', { userId, goalId: result.rows[0].id, title: input.title });

  return mapGoalRow(result.rows[0]);
}

export async function getGoal(goalId: string, userId: string): Promise<Goal | null> {
  const result = await pool.query(
    `SELECT * FROM autonomous_goals WHERE id = $1 AND user_id = $2`,
    [goalId, userId]
  );

  return result.rows.length > 0 ? mapGoalRow(result.rows[0]) : null;
}

export async function getGoals(userId: string, filters: GoalFilters = {}): Promise<Goal[]> {
  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.goalType) {
    conditions.push(`goal_type = $${paramIndex++}`);
    params.push(filters.goalType);
  }

  if (filters.createdBy) {
    conditions.push(`created_by = $${paramIndex++}`);
    params.push(filters.createdBy);
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const result = await pool.query(
    `SELECT * FROM autonomous_goals
     WHERE ${conditions.join(' AND ')}
     ORDER BY priority DESC, created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows.map(mapGoalRow);
}

export async function updateGoal(goalId: string, userId: string, input: UpdateGoalInput): Promise<Goal | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    params.push(input.title);
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(input.description);
  }

  if (input.targetMetric !== undefined) {
    updates.push(`target_metric = $${paramIndex++}`);
    params.push(input.targetMetric ? JSON.stringify(input.targetMetric) : null);
  }

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    params.push(input.status);

    if (input.status === 'completed') {
      updates.push(`completed_at = NOW()`);
    }
  }

  if (input.priority !== undefined) {
    updates.push(`priority = $${paramIndex++}`);
    params.push(input.priority);
  }

  if (input.dueDate !== undefined) {
    updates.push(`due_date = $${paramIndex++}`);
    params.push(input.dueDate);
  }

  if (updates.length === 0) {
    return getGoal(goalId, userId);
  }

  params.push(goalId, userId);

  const result = await pool.query(
    `UPDATE autonomous_goals
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
     RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }

  const goal = mapGoalRow(result.rows[0]);

  // Create achievement if goal was completed
  if (input.status === 'completed') {
    await createAchievement(userId, {
      goalId: goal.id,
      title: `Completed: ${goal.title}`,
      description: goal.description ?? undefined,
      achievementType: 'goal_completed',
      journalEntry: `Luna completed the goal "${goal.title}" successfully.`,
    });
  }

  return goal;
}

export async function deleteGoal(goalId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM autonomous_goals WHERE id = $1 AND user_id = $2`,
    [goalId, userId]
  );

  return result.rowCount !== null && result.rowCount > 0;
}

// ============================================
// Goal Progress
// ============================================

export async function updateGoalProgress(
  goalId: string,
  userId: string,
  progress: number
): Promise<Goal | null> {
  const goal = await getGoal(goalId, userId);
  if (!goal || !goal.targetMetric) {
    return goal;
  }

  const newMetric: TargetMetric = {
    ...goal.targetMetric,
    current: progress,
  };

  // Check if goal should be completed
  const isCompleted = newMetric.current >= newMetric.target;

  return updateGoal(goalId, userId, {
    targetMetric: newMetric,
    status: isCompleted ? 'completed' : 'active',
  });
}

export async function incrementGoalProgress(goalId: string, userId: string, amount = 1): Promise<Goal | null> {
  const goal = await getGoal(goalId, userId);
  if (!goal || !goal.targetMetric) {
    return goal;
  }

  const newProgress = goal.targetMetric.current + amount;
  return updateGoalProgress(goalId, userId, newProgress);
}

// ============================================
// Achievements
// ============================================

export interface CreateAchievementInput {
  goalId?: string;
  title: string;
  description?: string;
  achievementType: Achievement['achievementType'];
  journalEntry?: string;
  metadata?: Record<string, unknown>;
}

export async function createAchievement(userId: string, input: CreateAchievementInput): Promise<Achievement> {
  const result = await pool.query(
    `INSERT INTO achievements (user_id, goal_id, title, description, achievement_type, journal_entry, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      input.goalId || null,
      input.title,
      input.description || null,
      input.achievementType,
      input.journalEntry || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  logger.info('Achievement created', { userId, title: input.title, type: input.achievementType });

  return mapAchievementRow(result.rows[0]);
}

export async function getAchievements(userId: string, filters: AchievementFilters = {}): Promise<Achievement[]> {
  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (filters.achievementType) {
    conditions.push(`achievement_type = $${paramIndex++}`);
    params.push(filters.achievementType);
  }

  if (filters.celebrated !== undefined) {
    conditions.push(`celebrated = $${paramIndex++}`);
    params.push(filters.celebrated);
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const result = await pool.query(
    `SELECT * FROM achievements
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows.map(mapAchievementRow);
}

export async function getAchievement(achievementId: string, userId: string): Promise<Achievement | null> {
  const result = await pool.query(
    `SELECT * FROM achievements WHERE id = $1 AND user_id = $2`,
    [achievementId, userId]
  );

  return result.rows.length > 0 ? mapAchievementRow(result.rows[0]) : null;
}

export async function markAchievementCelebrated(achievementId: string, userId: string): Promise<Achievement | null> {
  const result = await pool.query(
    `UPDATE achievements SET celebrated = true WHERE id = $1 AND user_id = $2 RETURNING *`,
    [achievementId, userId]
  );

  return result.rows.length > 0 ? mapAchievementRow(result.rows[0]) : null;
}

export async function getUncelebratedAchievements(userId: string): Promise<Achievement[]> {
  return getAchievements(userId, { celebrated: false });
}

// ============================================
// Stats
// ============================================

export async function getGoalStats(userId: string): Promise<{
  total: number;
  active: number;
  completed: number;
  paused: number;
  byType: Record<string, number>;
}> {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'active') as active,
       COUNT(*) FILTER (WHERE status = 'completed') as completed,
       COUNT(*) FILTER (WHERE status = 'paused') as paused,
       goal_type,
       COUNT(*) FILTER (WHERE status = 'active') as type_count
     FROM autonomous_goals
     WHERE user_id = $1
     GROUP BY GROUPING SETS ((), (goal_type))`,
    [userId]
  );

  const stats = {
    total: 0,
    active: 0,
    completed: 0,
    paused: 0,
    byType: {} as Record<string, number>,
  };

  for (const row of result.rows) {
    if (row.goal_type === null) {
      stats.total = parseInt(row.total, 10);
      stats.active = parseInt(row.active, 10);
      stats.completed = parseInt(row.completed, 10);
      stats.paused = parseInt(row.paused, 10);
    } else {
      stats.byType[row.goal_type] = parseInt(row.type_count, 10);
    }
  }

  return stats;
}

// ============================================
// Helpers
// ============================================

function mapGoalRow(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    goalType: row.goal_type as Goal['goalType'],
    title: row.title as string,
    description: row.description as string | null,
    targetMetric: row.target_metric as TargetMetric | null,
    status: row.status as Goal['status'],
    priority: row.priority as number,
    dueDate: row.due_date ? new Date(row.due_date as string) : null,
    parentGoalId: row.parent_goal_id as string | null,
    createdBy: row.created_by as Goal['createdBy'],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}

function mapAchievementRow(row: Record<string, unknown>): Achievement {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    goalId: row.goal_id as string | null,
    title: row.title as string,
    description: row.description as string | null,
    achievementType: row.achievement_type as Achievement['achievementType'],
    journalEntry: row.journal_entry as string | null,
    metadata: row.metadata as Record<string, unknown> | null,
    celebrated: row.celebrated as boolean,
    createdAt: new Date(row.created_at as string),
  };
}
