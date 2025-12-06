import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as checkinsService from '../abilities/checkins.service.js';
import * as insightsService from '../autonomous/insights.service.js';

// ============================================
// Types
// ============================================

export interface PendingTrigger {
  id: string;
  userId: string;
  scheduleId: string | null;
  triggerSource: 'schedule' | 'webhook' | 'event' | 'pattern' | 'insight';
  triggerType: string;
  payload: Record<string, unknown>;
  message: string;
  status: 'pending' | 'processing' | 'delivered' | 'failed';
  deliveryMethod: 'chat' | 'push' | 'sse' | 'telegram';
  targetSessionId: string | null;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt: Date | null;
  deliveredAt: Date | null;
  errorMessage: string | null;
}

export interface EnqueueTriggerInput {
  userId: string;
  scheduleId?: string;
  triggerSource: PendingTrigger['triggerSource'];
  triggerType: string;
  payload?: Record<string, unknown>;
  message: string;
  deliveryMethod?: PendingTrigger['deliveryMethod'];
  targetSessionId?: string;
  priority?: number;
}

export interface NotificationPreferences {
  enableChatNotifications: boolean;
  enablePushNotifications: boolean;
  enableEmailDigest: boolean;
  enableTelegram: boolean;
  persistTelegramToChat: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  enableReminders: boolean;
  enableCheckins: boolean;
  enableInsights: boolean;
  enableAchievements: boolean;
}

// ============================================
// Pattern Detectors
// ============================================

interface PatternDetector {
  name: string;
  check: (userId: string) => Promise<{ triggered: boolean; data?: Record<string, unknown> }>;
}

const patternDetectors: PatternDetector[] = [
  {
    name: 'mood_low',
    async check(userId: string) {
      const result = await pool.query(
        `SELECT sentiment FROM mood_entries
         WHERE user_id = $1 AND detected_at > NOW() - INTERVAL '24 hours'
         ORDER BY detected_at DESC LIMIT 3`,
        [userId]
      );

      if (result.rows.length >= 2) {
        const avgSentiment = result.rows.reduce((sum: number, r: { sentiment: number }) => sum + r.sentiment, 0) / result.rows.length;
        if (avgSentiment < -0.3) {
          return { triggered: true, data: { avgSentiment, entryCount: result.rows.length } };
        }
      }
      return { triggered: false };
    },
  },
  {
    name: 'long_absence',
    async check(userId: string) {
      const result = await pool.query(
        `SELECT MAX(created_at) as last_activity FROM messages m
         JOIN sessions s ON m.session_id = s.id
         WHERE s.user_id = $1`,
        [userId]
      );

      if (result.rows[0]?.last_activity) {
        const lastActivity = new Date(result.rows[0].last_activity);
        const daysSince = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince >= 3) {
          return { triggered: true, data: { daysSince: Math.floor(daysSince), lastActivity } };
        }
      }
      return { triggered: false };
    },
  },
  {
    name: 'high_productivity',
    async check(userId: string) {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM task_history
         WHERE user_id = $1
           AND completed_at IS NOT NULL
           AND completed_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      );

      const count = parseInt(result.rows[0]?.count || '0', 10);
      if (count >= 5) {
        return { triggered: true, data: { tasksCompleted: count } };
      }
      return { triggered: false };
    },
  },
];

// ============================================
// Trigger Queue Management
// ============================================

/**
 * Add a trigger to the pending queue
 */
export async function enqueueTrigger(input: EnqueueTriggerInput): Promise<PendingTrigger> {
  const result = await pool.query(
    `INSERT INTO pending_triggers
     (user_id, schedule_id, trigger_source, trigger_type, payload, message, delivery_method, target_session_id, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.userId,
      input.scheduleId || null,
      input.triggerSource,
      input.triggerType,
      JSON.stringify(input.payload || {}),
      input.message,
      input.deliveryMethod || 'chat',
      input.targetSessionId || null,
      input.priority || 5,
    ]
  );

  logger.info('Trigger enqueued', {
    triggerId: result.rows[0].id,
    userId: input.userId,
    source: input.triggerSource,
    type: input.triggerType,
  });

  return mapTriggerRow(result.rows[0]);
}

/**
 * Get pending triggers ready to process
 */
export async function getPendingTriggers(limit: number = 20): Promise<PendingTrigger[]> {
  const result = await pool.query(
    `SELECT * FROM pending_triggers
     WHERE status = 'pending'
       AND attempts < max_attempts
     ORDER BY priority DESC, created_at ASC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(mapTriggerRow);
}

/**
 * Mark trigger as processing
 */
export async function markTriggerProcessing(triggerId: string): Promise<void> {
  await pool.query(
    `UPDATE pending_triggers
     SET status = 'processing', processed_at = NOW(), attempts = attempts + 1
     WHERE id = $1`,
    [triggerId]
  );
}

/**
 * Mark trigger as delivered
 */
export async function markTriggerDelivered(
  triggerId: string,
  sessionId?: string
): Promise<void> {
  await pool.query(
    `UPDATE pending_triggers
     SET status = 'delivered', delivered_at = NOW(), target_session_id = COALESCE($2, target_session_id)
     WHERE id = $1`,
    [triggerId, sessionId || null]
  );

  // Record in history
  const trigger = await getTrigger(triggerId);
  if (trigger) {
    await pool.query(
      `INSERT INTO trigger_history
       (user_id, trigger_id, schedule_id, trigger_source, trigger_type, message_sent, delivery_method, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        trigger.userId,
        triggerId,
        trigger.scheduleId,
        trigger.triggerSource,
        trigger.triggerType,
        trigger.message,
        trigger.deliveryMethod,
        sessionId || trigger.targetSessionId,
      ]
    );
  }
}

/**
 * Mark trigger as failed
 */
export async function markTriggerFailed(triggerId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE pending_triggers
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         error_message = $2
     WHERE id = $1`,
    [triggerId, error]
  );
}

/**
 * Get a single trigger
 */
export async function getTrigger(triggerId: string): Promise<PendingTrigger | null> {
  const result = await pool.query(
    `SELECT * FROM pending_triggers WHERE id = $1`,
    [triggerId]
  );

  return result.rows.length > 0 ? mapTriggerRow(result.rows[0]) : null;
}

// ============================================
// Trigger Processing
// ============================================

/**
 * Check and enqueue time-based triggers (cron schedules)
 */
export async function processTimeBasedTriggers(): Promise<number> {
  const pendingCheckins = await checkinsService.getPendingCheckins();
  let enqueued = 0;

  for (const checkin of pendingCheckins) {
    try {
      // Check if user has notifications enabled
      const prefs = await getNotificationPreferences(checkin.userId);
      if (!prefs.enableCheckins) continue;

      // Check quiet hours
      if (isInQuietHours(prefs)) continue;

      // Render message template
      const message = renderTemplate(checkin.promptTemplate, checkin.triggerConfig as Record<string, unknown>);

      await enqueueTrigger({
        userId: checkin.userId,
        scheduleId: checkin.id,
        triggerSource: 'schedule',
        triggerType: checkin.triggerType,
        payload: checkin.triggerConfig as Record<string, unknown>,
        message,
        deliveryMethod: prefs.enablePushNotifications ? 'push' : 'chat',
        priority: 6,
      });

      // Update schedule
      await checkinsService.recordCheckinTriggered(
        checkin.userId,
        checkin.id,
        'scheduled',
        message
      );

      enqueued++;
    } catch (error) {
      logger.error('Failed to process time-based trigger', {
        error: (error as Error).message,
        scheduleId: checkin.id,
      });
    }
  }

  return enqueued;
}

/**
 * Check and enqueue pattern-based triggers
 */
export async function processPatternTriggers(): Promise<number> {
  let enqueued = 0;

  // Get users with pattern-based checkins enabled
  const result = await pool.query(
    `SELECT DISTINCT cs.user_id, cs.id, cs.trigger_config, cs.prompt_template
     FROM checkin_schedules cs
     WHERE cs.trigger_type = 'pattern'
       AND cs.is_enabled = true
       AND (cs.last_triggered_at IS NULL OR cs.last_triggered_at < NOW() - INTERVAL '4 hours')`
  );

  for (const row of result.rows) {
    const patternName = row.trigger_config?.pattern;
    if (!patternName) continue;

    const detector = patternDetectors.find((d) => d.name === patternName);
    if (!detector) continue;

    try {
      const { triggered, data } = await detector.check(row.user_id);

      if (triggered) {
        const prefs = await getNotificationPreferences(row.user_id);
        if (!prefs.enableCheckins) continue;
        if (isInQuietHours(prefs)) continue;

        const message = renderTemplate(row.prompt_template, { ...row.trigger_config, ...data });

        await enqueueTrigger({
          userId: row.user_id,
          scheduleId: row.id,
          triggerSource: 'pattern',
          triggerType: patternName,
          payload: data || {},
          message,
          deliveryMethod: prefs.enablePushNotifications ? 'push' : 'chat',
          priority: 7, // Patterns are usually more important
        });

        // Update schedule
        await checkinsService.recordCheckinTriggered(row.user_id, row.id, patternName, message);

        enqueued++;
      }
    } catch (error) {
      logger.error('Failed to check pattern trigger', {
        error: (error as Error).message,
        pattern: patternName,
        userId: row.user_id,
      });
    }
  }

  return enqueued;
}

/**
 * Check and enqueue insight-based triggers
 */
export async function processInsightTriggers(): Promise<number> {
  let enqueued = 0;

  // Get unshared high-priority insights
  const result = await pool.query(
    `SELECT pi.*, u.id as user_id
     FROM proactive_insights pi
     JOIN users u ON pi.user_id = u.id
     WHERE pi.shared_at IS NULL
       AND pi.dismissed_at IS NULL
       AND pi.priority >= 7
       AND (pi.expires_at IS NULL OR pi.expires_at > NOW())
     ORDER BY pi.priority DESC, pi.created_at ASC
     LIMIT 10`
  );

  for (const row of result.rows) {
    try {
      const prefs = await getNotificationPreferences(row.user_id);
      if (!prefs.enableInsights) continue;
      if (isInQuietHours(prefs)) continue;

      const message = `${row.insight_title}\n\n${row.insight_content}`;

      await enqueueTrigger({
        userId: row.user_id,
        triggerSource: 'insight',
        triggerType: row.source_type,
        payload: { insightId: row.id },
        message,
        deliveryMethod: prefs.enablePushNotifications ? 'push' : 'chat',
        priority: row.priority,
      });

      // Mark insight as shared
      await insightsService.markInsightShared(row.id, row.user_id);

      enqueued++;
    } catch (error) {
      logger.error('Failed to process insight trigger', {
        error: (error as Error).message,
        insightId: row.id,
      });
    }
  }

  return enqueued;
}

/**
 * Fire an event-based trigger
 * Called by other services when events occur
 */
export async function fireEventTrigger(
  eventType: string,
  userId: string,
  eventData: Record<string, unknown>
): Promise<void> {
  // Find matching event-based schedules
  const result = await pool.query(
    `SELECT * FROM checkin_schedules
     WHERE user_id = $1
       AND trigger_type = 'event'
       AND trigger_config->>'eventType' = $2
       AND is_enabled = true`,
    [userId, eventType]
  );

  for (const row of result.rows) {
    try {
      const prefs = await getNotificationPreferences(userId);
      if (!prefs.enableReminders) continue;

      const message = renderTemplate(row.prompt_template, eventData);

      await enqueueTrigger({
        userId,
        scheduleId: row.id,
        triggerSource: 'event',
        triggerType: eventType,
        payload: eventData,
        message,
        deliveryMethod: prefs.enablePushNotifications ? 'push' : 'chat',
        priority: 8, // Events are usually urgent
      });

      await checkinsService.recordCheckinTriggered(userId, row.id, eventType, message);
    } catch (error) {
      logger.error('Failed to fire event trigger', {
        error: (error as Error).message,
        eventType,
        userId,
      });
    }
  }
}

// ============================================
// Notification Preferences
// ============================================

/**
 * Get user's notification preferences
 */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const result = await pool.query(
    `SELECT * FROM notification_preferences WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Return defaults
    return {
      enableChatNotifications: true,
      enablePushNotifications: false,
      enableEmailDigest: false,
      enableTelegram: false,
      persistTelegramToChat: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timezone: 'UTC',
      enableReminders: true,
      enableCheckins: true,
      enableInsights: true,
      enableAchievements: true,
    };
  }

  const row = result.rows[0];
  return {
    enableChatNotifications: row.enable_chat_notifications,
    enablePushNotifications: row.enable_push_notifications,
    enableEmailDigest: row.enable_email_digest,
    enableTelegram: row.enable_telegram ?? false,
    persistTelegramToChat: row.persist_telegram_to_chat ?? true,
    quietHoursEnabled: row.quiet_hours_enabled,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    timezone: row.timezone,
    enableReminders: row.enable_reminders,
    enableCheckins: row.enable_checkins,
    enableInsights: row.enable_insights,
    enableAchievements: row.enable_achievements,
  };
}

/**
 * Update user's notification preferences
 */
export async function updateNotificationPreferences(
  userId: string,
  updates: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  // Upsert preferences
  await pool.query(
    `INSERT INTO notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const setClauses: string[] = [];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  const columnMap: Record<keyof NotificationPreferences, string> = {
    enableChatNotifications: 'enable_chat_notifications',
    enablePushNotifications: 'enable_push_notifications',
    enableEmailDigest: 'enable_email_digest',
    enableTelegram: 'enable_telegram',
    persistTelegramToChat: 'persist_telegram_to_chat',
    quietHoursEnabled: 'quiet_hours_enabled',
    quietHoursStart: 'quiet_hours_start',
    quietHoursEnd: 'quiet_hours_end',
    timezone: 'timezone',
    enableReminders: 'enable_reminders',
    enableCheckins: 'enable_checkins',
    enableInsights: 'enable_insights',
    enableAchievements: 'enable_achievements',
  };

  for (const [key, value] of Object.entries(updates)) {
    const column = columnMap[key as keyof NotificationPreferences];
    if (column && value !== undefined) {
      setClauses.push(`${column} = $${paramIndex++}`);
      params.push(value);
    }
  }

  if (setClauses.length > 0) {
    await pool.query(
      `UPDATE notification_preferences SET ${setClauses.join(', ')} WHERE user_id = $1`,
      params
    );
  }

  return getNotificationPreferences(userId);
}

// ============================================
// Helpers
// ============================================

/**
 * Check if current time is within quiet hours
 */
function isInQuietHours(prefs: NotificationPreferences): boolean {
  if (!prefs.quietHoursEnabled) return false;

  // Simple check - could be enhanced with proper timezone handling
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const [startHour, startMinute] = prefs.quietHoursStart.split(':').map(Number);
  const [endHour, endMinute] = prefs.quietHoursEnd.split(':').map(Number);
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

/**
 * Render a message template with data
 */
function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = key.split('.').reduce((obj: Record<string, unknown>, k: string) => {
      return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[k] : undefined;
    }, data);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Map database row to PendingTrigger
 */
function mapTriggerRow(row: Record<string, unknown>): PendingTrigger {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    scheduleId: row.schedule_id as string | null,
    triggerSource: row.trigger_source as PendingTrigger['triggerSource'],
    triggerType: row.trigger_type as string,
    payload: (row.payload as Record<string, unknown>) || {},
    message: row.message as string,
    status: row.status as PendingTrigger['status'],
    deliveryMethod: row.delivery_method as PendingTrigger['deliveryMethod'],
    targetSessionId: row.target_session_id as string | null,
    priority: row.priority as number,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    createdAt: row.created_at as Date,
    processedAt: row.processed_at as Date | null,
    deliveredAt: row.delivered_at as Date | null,
    errorMessage: row.error_message as string | null,
  };
}

/**
 * Get trigger history for a user
 */
export async function getTriggerHistory(
  userId: string,
  limit: number = 20
): Promise<Array<{
  id: string;
  triggerSource: string;
  triggerType: string;
  messageSent: string;
  deliveryMethod: string;
  userResponded: boolean;
  createdAt: Date;
}>> {
  const result = await pool.query(
    `SELECT id, trigger_source, trigger_type, message_sent, delivery_method, user_responded, created_at
     FROM trigger_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    triggerSource: row.trigger_source as string,
    triggerType: row.trigger_type as string,
    messageSent: row.message_sent as string,
    deliveryMethod: row.delivery_method as string,
    userResponded: row.user_responded as boolean,
    createdAt: row.created_at as Date,
  }));
}

/**
 * Get pending trigger count for a user
 */
export async function getPendingTriggerCount(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM pending_triggers
     WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  return parseInt(result.rows[0]?.count || '0', 10);
}

export default {
  enqueueTrigger,
  getPendingTriggers,
  markTriggerProcessing,
  markTriggerDelivered,
  markTriggerFailed,
  getTrigger,
  processTimeBasedTriggers,
  processPatternTriggers,
  processInsightTriggers,
  fireEventTrigger,
  getNotificationPreferences,
  updateNotificationPreferences,
  getTriggerHistory,
  getPendingTriggerCount,
};
