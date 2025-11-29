import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

export interface CheckinSchedule {
  id: string;
  name: string;
  triggerType: 'time' | 'pattern' | 'event';
  triggerConfig: TriggerConfig;
  promptTemplate: string;
  isEnabled: boolean;
  lastTriggeredAt?: Date;
  nextTriggerAt?: Date;
  createdAt: Date;
}

export interface TriggerConfig {
  // For time-based triggers
  cron?: string; // Cron expression
  timezone?: string;

  // For pattern-based triggers
  pattern?: string; // e.g., 'daily_morning', 'weekly_goals', 'mood_low'
  conditions?: Record<string, unknown>;

  // For event-based triggers
  eventType?: string; // e.g., 'session_end', 'task_due', 'long_absence'
}

export interface CheckinHistory {
  id: string;
  scheduleId?: string;
  triggerReason: string;
  messageSent: string;
  userResponded: boolean;
  responseSessionId?: string;
  createdAt: Date;
}

// Built-in check-in templates
const BUILT_IN_CHECKINS: Array<Omit<CheckinSchedule, 'id' | 'createdAt' | 'lastTriggeredAt' | 'nextTriggerAt'>> = [
  {
    name: 'Morning Check-in',
    triggerType: 'time',
    triggerConfig: { cron: '0 9 * * *', timezone: 'local' },
    promptTemplate: 'Good morning! How are you feeling today? Anything on your mind or goals for the day?',
    isEnabled: false,
  },
  {
    name: 'Weekly Goals Review',
    triggerType: 'time',
    triggerConfig: { cron: '0 10 * * 1', timezone: 'local' }, // Monday 10am
    promptTemplate: "It's Monday! Let's review your goals for the week. What would you like to focus on?",
    isEnabled: false,
  },
  {
    name: 'Task Reminder',
    triggerType: 'event',
    triggerConfig: { eventType: 'task_due' },
    promptTemplate: 'Just a heads up - you have a task coming up: {task_title}. Would you like to work on it?',
    isEnabled: true,
  },
  {
    name: 'Long Absence',
    triggerType: 'pattern',
    triggerConfig: { pattern: 'long_absence', conditions: { days: 3 } },
    promptTemplate: "Hey! It's been a few days since we chatted. How have you been?",
    isEnabled: false,
  },
  {
    name: 'Low Mood Support',
    triggerType: 'pattern',
    triggerConfig: { pattern: 'mood_low', conditions: { threshold: -0.5, consecutive: 2 } },
    promptTemplate: "I noticed you might be going through a tough time. I'm here if you want to talk about anything.",
    isEnabled: false,
  },
];

/**
 * Get built-in check-in templates
 */
export function getBuiltInCheckins(): typeof BUILT_IN_CHECKINS {
  return BUILT_IN_CHECKINS;
}

/**
 * Create a check-in schedule
 */
export async function createCheckinSchedule(
  userId: string,
  checkin: {
    name: string;
    triggerType: 'time' | 'pattern' | 'event';
    triggerConfig: TriggerConfig;
    promptTemplate: string;
    isEnabled?: boolean;
  }
): Promise<CheckinSchedule> {
  try {
    const nextTrigger = calculateNextTrigger(checkin.triggerType, checkin.triggerConfig);

    const result = await pool.query(
      `INSERT INTO checkin_schedules (user_id, name, trigger_type, trigger_config, prompt_template, is_enabled, next_trigger_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, trigger_type, trigger_config, prompt_template, is_enabled, last_triggered_at, next_trigger_at, created_at`,
      [userId, checkin.name, checkin.triggerType, JSON.stringify(checkin.triggerConfig), checkin.promptTemplate, checkin.isEnabled ?? true, nextTrigger]
    );

    logger.info('Created check-in schedule', { userId, name: checkin.name });
    return mapRowToSchedule(result.rows[0]);
  } catch (error) {
    logger.error('Failed to create check-in', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Get user's check-in schedules
 */
export async function getCheckinSchedules(userId: string): Promise<CheckinSchedule[]> {
  try {
    const result = await pool.query(
      `SELECT id, name, trigger_type, trigger_config, prompt_template, is_enabled, last_triggered_at, next_trigger_at, created_at
       FROM checkin_schedules
       WHERE user_id = $1
       ORDER BY is_enabled DESC, created_at DESC`,
      [userId]
    );
    return result.rows.map(mapRowToSchedule);
  } catch (error) {
    logger.error('Failed to get check-ins', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get pending check-ins that should be triggered
 */
export async function getPendingCheckins(): Promise<Array<CheckinSchedule & { userId: string }>> {
  try {
    const result = await pool.query(
      `SELECT cs.*, cs.user_id
       FROM checkin_schedules cs
       WHERE cs.is_enabled = true
         AND cs.next_trigger_at <= NOW()
         AND (cs.last_triggered_at IS NULL OR cs.last_triggered_at < NOW() - INTERVAL '1 hour')`
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      ...mapRowToSchedule(row),
      userId: row.user_id as string,
    }));
  } catch (error) {
    logger.error('Failed to get pending check-ins', { error: (error as Error).message });
    return [];
  }
}

/**
 * Record a triggered check-in
 */
export async function recordCheckinTriggered(
  userId: string,
  scheduleId: string,
  triggerReason: string,
  messageSent: string
): Promise<string> {
  try {
    // Record history
    const historyResult = await pool.query(
      `INSERT INTO checkin_history (schedule_id, user_id, trigger_reason, message_sent)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [scheduleId, userId, triggerReason, messageSent]
    );

    // Update schedule
    const schedule = await pool.query(
      `SELECT trigger_type, trigger_config FROM checkin_schedules WHERE id = $1`,
      [scheduleId]
    );

    if (schedule.rows.length > 0) {
      const nextTrigger = calculateNextTrigger(
        schedule.rows[0].trigger_type,
        schedule.rows[0].trigger_config
      );

      await pool.query(
        `UPDATE checkin_schedules SET last_triggered_at = NOW(), next_trigger_at = $2 WHERE id = $1`,
        [scheduleId, nextTrigger]
      );
    }

    return historyResult.rows[0].id;
  } catch (error) {
    logger.error('Failed to record check-in', { error: (error as Error).message, scheduleId });
    throw error;
  }
}

/**
 * Mark check-in as responded
 */
export async function markCheckinResponded(
  historyId: string,
  sessionId: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE checkin_history SET user_responded = true, response_session_id = $2 WHERE id = $1`,
      [historyId, sessionId]
    );
  } catch (error) {
    logger.error('Failed to mark check-in responded', { error: (error as Error).message, historyId });
  }
}

/**
 * Get check-in history
 */
export async function getCheckinHistory(
  userId: string,
  limit: number = 20
): Promise<CheckinHistory[]> {
  try {
    const result = await pool.query(
      `SELECT id, schedule_id, trigger_reason, message_sent, user_responded, response_session_id, created_at
       FROM checkin_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      scheduleId: row.schedule_id as string | undefined,
      triggerReason: row.trigger_reason as string,
      messageSent: row.message_sent as string,
      userResponded: row.user_responded as boolean,
      responseSessionId: row.response_session_id as string | undefined,
      createdAt: row.created_at as Date,
    }));
  } catch (error) {
    logger.error('Failed to get check-in history', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Update check-in schedule
 */
export async function updateCheckinSchedule(
  userId: string,
  scheduleId: string,
  updates: Partial<{
    name: string;
    triggerConfig: TriggerConfig;
    promptTemplate: string;
    isEnabled: boolean;
  }>
): Promise<CheckinSchedule | null> {
  try {
    const setClauses: string[] = [];
    const params: unknown[] = [userId, scheduleId];
    let paramIndex = 3;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(updates.name);
    }
    if (updates.triggerConfig !== undefined) {
      setClauses.push(`trigger_config = $${paramIndex++}`);
      params.push(JSON.stringify(updates.triggerConfig));
    }
    if (updates.promptTemplate !== undefined) {
      setClauses.push(`prompt_template = $${paramIndex++}`);
      params.push(updates.promptTemplate);
    }
    if (updates.isEnabled !== undefined) {
      setClauses.push(`is_enabled = $${paramIndex++}`);
      params.push(updates.isEnabled);
    }

    if (setClauses.length === 0) return null;

    const result = await pool.query(
      `UPDATE checkin_schedules
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $2 AND user_id = $1
       RETURNING id, name, trigger_type, trigger_config, prompt_template, is_enabled, last_triggered_at, next_trigger_at, created_at`,
      params
    );

    if (result.rows.length === 0) return null;
    return mapRowToSchedule(result.rows[0]);
  } catch (error) {
    logger.error('Failed to update check-in', { error: (error as Error).message, scheduleId });
    throw error;
  }
}

/**
 * Delete check-in schedule
 */
export async function deleteCheckinSchedule(userId: string, scheduleId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM checkin_schedules WHERE id = $1 AND user_id = $2`,
      [scheduleId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to delete check-in', { error: (error as Error).message, scheduleId });
    return false;
  }
}

/**
 * Calculate next trigger time
 */
function calculateNextTrigger(
  triggerType: string,
  config: TriggerConfig
): Date | null {
  const now = new Date();

  if (triggerType === 'time' && config.cron) {
    // Simple cron parsing for common patterns
    // Full cron parsing would need a library like 'cron-parser'
    const parts = config.cron.split(' ');
    if (parts.length >= 5) {
      const [minute, hour, , , dayOfWeek] = parts;

      const next = new Date(now);
      next.setSeconds(0);
      next.setMilliseconds(0);

      if (minute !== '*') next.setMinutes(parseInt(minute, 10));
      if (hour !== '*') next.setHours(parseInt(hour, 10));

      // If time has passed today, move to tomorrow
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }

      // Handle day of week
      if (dayOfWeek !== '*') {
        const targetDay = parseInt(dayOfWeek, 10);
        while (next.getDay() !== targetDay) {
          next.setDate(next.getDate() + 1);
        }
      }

      return next;
    }
  }

  if (triggerType === 'pattern') {
    // Pattern-based triggers are checked periodically, not scheduled
    return new Date(now.getTime() + 60 * 60 * 1000); // Check in 1 hour
  }

  if (triggerType === 'event') {
    // Event triggers don't have scheduled times
    return null;
  }

  return null;
}

function mapRowToSchedule(row: Record<string, unknown>): CheckinSchedule {
  return {
    id: row.id as string,
    name: row.name as string,
    triggerType: row.trigger_type as 'time' | 'pattern' | 'event',
    triggerConfig: row.trigger_config as TriggerConfig,
    promptTemplate: row.prompt_template as string,
    isEnabled: row.is_enabled as boolean,
    lastTriggeredAt: row.last_triggered_at as Date | undefined,
    nextTriggerAt: row.next_trigger_at as Date | undefined,
    createdAt: row.created_at as Date,
  };
}

export default {
  getBuiltInCheckins,
  createCheckinSchedule,
  getCheckinSchedules,
  getPendingCheckins,
  recordCheckinTriggered,
  markCheckinResponded,
  getCheckinHistory,
  updateCheckinSchedule,
  deleteCheckinSchedule,
};
