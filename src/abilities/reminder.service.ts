import { pool } from '../db/index.js';
import * as triggerService from '../triggers/trigger.service.js';
import * as deliveryService from '../triggers/delivery.service.js';
import logger from '../utils/logger.js';

export interface QuickReminder {
  id: string;
  userId: string;
  message: string;
  remindAt: Date;
  createdAt: Date;
  deliveredAt: Date | null;
}

/**
 * Create a new quick reminder
 */
export async function createReminder(
  userId: string,
  message: string,
  delayMinutes: number
): Promise<QuickReminder> {
  const remindAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO quick_reminders (user_id, message, remind_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, message, remind_at, created_at, delivered_at`,
    [userId, message, remindAt]
  );

  const row = result.rows[0];
  logger.info('Quick reminder created', {
    reminderId: row.id,
    userId,
    message,
    delayMinutes,
    remindAt: remindAt.toISOString(),
  });

  return {
    id: row.id,
    userId: row.user_id,
    message: row.message,
    remindAt: row.remind_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

/**
 * List pending reminders for a user
 */
export async function listReminders(userId: string): Promise<QuickReminder[]> {
  const result = await pool.query(
    `SELECT id, user_id, message, remind_at, created_at, delivered_at
     FROM quick_reminders
     WHERE user_id = $1 AND delivered_at IS NULL
     ORDER BY remind_at ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    message: row.message,
    remindAt: row.remind_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  }));
}

/**
 * Cancel a reminder by ID
 */
export async function cancelReminder(
  userId: string,
  reminderId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM quick_reminders
     WHERE id = $1 AND user_id = $2 AND delivered_at IS NULL
     RETURNING id`,
    [reminderId, userId]
  );

  if (result.rowCount && result.rowCount > 0) {
    logger.info('Quick reminder cancelled', { reminderId, userId });
    return true;
  }
  return false;
}

/**
 * Get all pending reminders that are due
 */
export async function getPendingReminders(): Promise<QuickReminder[]> {
  const result = await pool.query(
    `SELECT id, user_id, message, remind_at, created_at, delivered_at
     FROM quick_reminders
     WHERE remind_at <= NOW() AND delivered_at IS NULL
     ORDER BY remind_at ASC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    message: row.message,
    remindAt: row.remind_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  }));
}

/**
 * Mark a reminder as delivered
 */
export async function markDelivered(reminderId: string): Promise<void> {
  await pool.query(
    `UPDATE quick_reminders SET delivered_at = NOW() WHERE id = $1`,
    [reminderId]
  );
}

/**
 * Format reminder message for Telegram
 */
export function formatReminderMessage(reminder: QuickReminder): string {
  const minutesAgo = Math.round(
    (Date.now() - reminder.createdAt.getTime()) / (60 * 1000)
  );

  let timeLabel: string;
  if (minutesAgo < 1) {
    timeLabel = 'just now';
  } else if (minutesAgo === 1) {
    timeLabel = '1 minute ago';
  } else if (minutesAgo < 60) {
    timeLabel = `${minutesAgo} minutes ago`;
  } else {
    const hours = Math.floor(minutesAgo / 60);
    timeLabel = hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  return `Reminder: ${reminder.message}\n\n(Set ${timeLabel})`;
}

/**
 * Process pending quick reminders and deliver via Telegram
 */
export async function processQuickReminders(): Promise<number> {
  const pendingReminders = await getPendingReminders();
  let delivered = 0;

  for (const reminder of pendingReminders) {
    try {
      // Check if user has Telegram enabled
      const prefs = await triggerService.getNotificationPreferences(reminder.userId);

      if (!prefs.enableTelegram) {
        logger.debug('Skipping quick reminder - Telegram not enabled', {
          userId: reminder.userId,
          reminderId: reminder.id,
        });
        // Mark as delivered anyway to avoid retrying
        await markDelivered(reminder.id);
        continue;
      }

      const message = formatReminderMessage(reminder);

      // Send real-time notification via SSE
      await deliveryService.sendReminderNotification(
        reminder.userId,
        'Reminder',
        reminder.message,
        9, // High priority for user-set reminders
        'todo'
      );

      // Also enqueue for Telegram delivery if enabled
      if (prefs.enableTelegram) {
        await triggerService.enqueueTrigger({
          userId: reminder.userId,
          triggerSource: 'event',
          triggerType: 'quick_reminder',
          payload: {
            reminderId: reminder.id,
            message: reminder.message,
          },
          message,
          deliveryMethod: 'telegram',
          priority: 9,
        });
      }

      await markDelivered(reminder.id);
      delivered++;

      logger.info('Quick reminder delivered', {
        reminderId: reminder.id,
        userId: reminder.userId,
      });
    } catch (error) {
      logger.error('Failed to process quick reminder', {
        error: (error as Error).message,
        reminderId: reminder.id,
        userId: reminder.userId,
      });
    }
  }

  return delivered;
}

/**
 * Cleanup old delivered reminders (older than 7 days)
 */
export async function cleanupOldReminders(): Promise<number> {
  try {
    const result = await pool.query(`
      DELETE FROM quick_reminders
      WHERE delivered_at IS NOT NULL
        AND delivered_at < NOW() - INTERVAL '7 days'
    `);
    const deleted = result.rowCount || 0;
    if (deleted > 0) {
      logger.info('Cleaned up old quick reminders', { deleted });
    }
    return deleted;
  } catch (error) {
    logger.error('Failed to cleanup old quick reminders', {
      error: (error as Error).message,
    });
    return 0;
  }
}

export default {
  createReminder,
  listReminders,
  cancelReminder,
  getPendingReminders,
  markDelivered,
  formatReminderMessage,
  processQuickReminders,
  cleanupOldReminders,
};
