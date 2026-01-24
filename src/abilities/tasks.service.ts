import { pool } from '../db/index.js';
import * as taskPatterns from './task-patterns.service.js';
import logger from '../utils/logger.js';

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueAt?: Date;
  dueDate?: string | null;
  remindAt?: Date;
  recurrence?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  dueAt?: Date;
  remindAt?: Date;
  recurrence?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  sourceSessionId?: string;
}

/**
 * Create a new task
 */
export async function createTask(
  userId: string,
  input: CreateTaskInput
): Promise<Task> {
  try {
    const result = await pool.query(
      `INSERT INTO tasks (user_id, title, description, due_at, remind_at, recurrence, priority, source_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, due_at, remind_at, recurrence, priority, status, completed_at, created_at, updated_at`,
      [userId, input.title, input.description, input.dueAt, input.remindAt, input.recurrence, input.priority || 'medium', input.sourceSessionId]
    );

    const row = result.rows[0];
    const task = mapRowToTask(row);

    // Record task creation for pattern tracking
    taskPatterns.recordTaskAction(userId, task.id, 'created', {
      newDueAt: input.dueAt,
      newStatus: 'pending',
    }).catch(() => {});

    logger.info('Created task', { userId, title: input.title });
    return task;
  } catch (error) {
    logger.error('Failed to create task', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Get tasks for a user
 */
export async function getTasks(
  userId: string,
  options: {
    status?: string;
    priority?: string;
    upcoming?: boolean;
    limit?: number;
  } = {}
): Promise<Task[]> {
  const { status, priority, upcoming, limit = 50 } = options;

  try {
    let query = `
      SELECT id, title, description, due_at, remind_at, recurrence, priority, status, completed_at, created_at, updated_at
      FROM tasks
      WHERE user_id = $1
    `;
    const params: (string | number)[] = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (priority) {
      query += ` AND priority = $${paramIndex++}`;
      params.push(priority);
    }

    if (upcoming) {
      query += ` AND due_at IS NOT NULL AND due_at > NOW() AND status = 'pending'`;
    }

    query += ` ORDER BY
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      due_at ASC NULLS LAST,
      created_at DESC
      LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows.map(mapRowToTask);
  } catch (error) {
    logger.error('Failed to get tasks', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get tasks due for reminder
 */
export async function getTasksForReminder(): Promise<Array<Task & { userId: string }>> {
  try {
    const result = await pool.query(
      `SELECT t.*, t.user_id
       FROM tasks t
       WHERE t.remind_at <= NOW()
         AND t.remind_at > NOW() - INTERVAL '5 minutes'
         AND t.notification_sent = false
         AND t.status = 'pending'`
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      ...mapRowToTask(row),
      userId: row.user_id as string,
    }));
  } catch (error) {
    logger.error('Failed to get tasks for reminder', { error: (error as Error).message });
    return [];
  }
}

/**
 * Mark reminder as sent
 */
export async function markReminderSent(taskId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE tasks SET notification_sent = true WHERE id = $1`,
      [taskId]
    );
  } catch (error) {
    logger.error('Failed to mark reminder sent', { error: (error as Error).message, taskId });
  }
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  userId: string,
  taskId: string,
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
): Promise<Task | null> {
  try {
    // Get previous status for pattern tracking
    const prevResult = await pool.query(
      `SELECT status FROM tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    const previousStatus = prevResult.rows[0]?.status;

    const completedAt = status === 'completed' ? new Date() : null;

    const result = await pool.query(
      `UPDATE tasks
       SET status = $3, completed_at = $4, updated_at = NOW()
       WHERE id = $2 AND user_id = $1
       RETURNING id, title, description, due_at, remind_at, recurrence, priority, status, completed_at, created_at, updated_at`,
      [userId, taskId, status, completedAt]
    );

    if (result.rows.length === 0) return null;

    const task = mapRowToTask(result.rows[0]);

    // Record status change for pattern tracking
    const action: taskPatterns.TaskAction = status === 'completed' ? 'completed'
      : status === 'cancelled' ? 'cancelled'
      : status === 'in_progress' ? 'started'
      : 'created';

    taskPatterns.recordTaskAction(userId, taskId, action, {
      previousStatus,
      newStatus: status,
    }).catch(() => {});

    logger.info('Updated task status', { userId, taskId, status });
    return task;
  } catch (error) {
    logger.error('Failed to update task status', { error: (error as Error).message, userId, taskId });
    throw error;
  }
}

/**
 * Update task details
 */
export async function updateTask(
  userId: string,
  taskId: string,
  updates: Partial<CreateTaskInput>
): Promise<Task | null> {
  try {
    // Get previous values for pattern tracking
    const prevResult = await pool.query(
      `SELECT due_at, priority FROM tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    const previousDueAt = prevResult.rows[0]?.due_at;
    const previousPriority = prevResult.rows[0]?.priority;

    const setClauses: string[] = [];
    const params: unknown[] = [userId, taskId];
    let paramIndex = 3;

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(updates.description);
    }
    if (updates.dueAt !== undefined) {
      setClauses.push(`due_at = $${paramIndex++}`);
      params.push(updates.dueAt);
    }
    if (updates.remindAt !== undefined) {
      setClauses.push(`remind_at = $${paramIndex++}`);
      params.push(updates.remindAt);
      setClauses.push(`notification_sent = false`);
    }
    if (updates.recurrence !== undefined) {
      setClauses.push(`recurrence = $${paramIndex++}`);
      params.push(updates.recurrence);
    }
    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      params.push(updates.priority);
    }

    if (setClauses.length === 0) return null;

    const result = await pool.query(
      `UPDATE tasks
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $2 AND user_id = $1
       RETURNING id, title, description, due_at, remind_at, recurrence, priority, status, completed_at, created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) return null;

    const task = mapRowToTask(result.rows[0]);

    // Track postponement if due date was pushed back
    if (updates.dueAt && previousDueAt) {
      const prevDate = new Date(previousDueAt);
      const newDate = new Date(updates.dueAt);
      if (newDate > prevDate) {
        taskPatterns.recordTaskAction(userId, taskId, 'postponed', {
          previousDueAt: prevDate,
          newDueAt: newDate,
        }).catch(() => {});
      }
    }

    // Track priority changes
    if (updates.priority && previousPriority && updates.priority !== previousPriority) {
      taskPatterns.recordTaskAction(userId, taskId, 'priority_changed', {
        previousStatus: previousPriority,
        newStatus: updates.priority,
      }).catch(() => {});
    }

    return task;
  } catch (error) {
    logger.error('Failed to update task', { error: (error as Error).message, userId, taskId });
    throw error;
  }
}

/**
 * Delete a task
 */
export async function deleteTask(userId: string, taskId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to delete task', { error: (error as Error).message, userId, taskId });
    return false;
  }
}

/**
 * Parse natural language to task
 */
export function parseTaskFromText(text: string): Partial<CreateTaskInput> {
  const task: Partial<CreateTaskInput> = { title: text };

  // Parse due date patterns
  const today = /\b(today)\b/i;
  const tomorrow = /\b(tomorrow)\b/i;
  const nextWeek = /\bnext\s+week\b/i;
  const inDays = /\bin\s+(\d+)\s+days?\b/i;
  const atTime = /\bat\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?\b/i;

  const now = new Date();

  if (today.test(text)) {
    const due = new Date(now);
    due.setHours(17, 0, 0, 0); // Default to 5 PM (end of day)
    task.dueAt = due;
    task.title = text.replace(today, '').trim();
  } else if (tomorrow.test(text)) {
    const due = new Date(now);
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
    task.dueAt = due;
    task.title = text.replace(tomorrow, '').trim();
  } else if (nextWeek.test(text)) {
    const due = new Date(now);
    due.setDate(due.getDate() + 7);
    due.setHours(9, 0, 0, 0);
    task.dueAt = due;
    task.title = text.replace(nextWeek, '').trim();
  } else if (inDays.test(text)) {
    const match = text.match(inDays);
    if (match) {
      const days = parseInt(match[1], 10);
      // Validate: reject negative or zero days
      if (days > 0) {
        const due = new Date(now);
        due.setDate(due.getDate() + days);
        due.setHours(9, 0, 0, 0);
        task.dueAt = due;
        task.title = text.replace(inDays, '').trim();
      }
    }
  }

  // Parse time - handle both with and without existing date
  const timeMatch = text.match(atTime);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    // If no date was set, assume today
    if (!task.dueAt) {
      task.dueAt = new Date(now);
    }

    task.dueAt.setHours(hours, minutes, 0, 0);
    task.remindAt = new Date(task.dueAt);
    task.title = task.title?.replace(atTime, '').trim();
  }

  // Parse priority
  if (/\b(urgent|asap|critical)\b/i.test(text)) {
    task.priority = 'urgent';
    task.title = task.title?.replace(/\b(urgent|asap|critical)\b/i, '').trim();
  } else if (/\b(important|high\s*priority)\b/i.test(text)) {
    task.priority = 'high';
    task.title = task.title?.replace(/\b(important|high\s*priority)\b/i, '').trim();
  }

  // Clean up title
  task.title = task.title?.replace(/\s+/g, ' ').replace(/^(remind me to|remember to|don't forget to)/i, '').trim();

  return task;
}

/**
 * Format tasks for prompt
 */
export function formatTasksForPrompt(tasks: Task[]): string {
  if (tasks.length === 0) return '';

  const pending = tasks.filter(t => t.status === 'pending');
  if (pending.length === 0) return '';

  const formatted = pending.slice(0, 5).map(task => {
    let entry = `• ${task.title}`;
    if (task.priority === 'urgent' || task.priority === 'high') {
      entry += ` [${task.priority.toUpperCase()}]`;
    }
    if (task.dueAt) {
      const due = new Date(task.dueAt);
      const now = new Date();
      const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        entry += ` (OVERDUE)`;
      } else if (diffDays === 0) {
        entry += ` (due today)`;
      } else if (diffDays === 1) {
        entry += ` (due tomorrow)`;
      } else {
        entry += ` (due in ${diffDays} days)`;
      }
    }
    return entry;
  }).join('\n');

  return `[User's Tasks]\n${formatted}`;
}

function mapRowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | undefined,
    dueAt: row.due_at as Date | undefined,
    dueDate: row.due_at ? (row.due_at as Date).toISOString() : null,
    remindAt: row.remind_at as Date | undefined,
    recurrence: row.recurrence as string | undefined,
    priority: row.priority as 'low' | 'medium' | 'high' | 'urgent',
    status: row.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
    completedAt: row.completed_at as Date | undefined,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export default {
  createTask,
  getTasks,
  getTasksForReminder,
  markReminderSent,
  updateTaskStatus,
  updateTask,
  deleteTask,
  parseTaskFromText,
  formatTasksForPrompt,
};
