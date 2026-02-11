import { pool } from '../db/index.js';
import * as triggerService from '../triggers/trigger.service.js';
import * as deliveryService from '../triggers/delivery.service.js';
import logger from '../utils/logger.js';

export interface PendingCalendarReminder {
  eventId: string;
  eventCacheId: string;
  userId: string;
  title: string;
  startAt: Date;
  location?: string;
  reminderMinutes: number;
  reminderTime: Date;
}

/**
 * Get calendar events with pending reminders
 * Checks for events where reminder_time (startAt - reminderMinutes) is within the next 2 minutes
 * and hasn't been sent yet
 */
export async function getPendingCalendarReminders(): Promise<PendingCalendarReminder[]> {
  try {
    const result = await pool.query(`
      SELECT
        ce.id as event_cache_id,
        ce.external_id as event_id,
        cc.user_id,
        ce.title,
        ce.start_at,
        ce.location,
        ce.reminder_minutes,
        ce.start_at - (ce.reminder_minutes * INTERVAL '1 minute') as reminder_time
      FROM calendar_events_cache ce
      JOIN calendar_connections cc ON cc.id = ce.connection_id
      WHERE ce.reminder_minutes IS NOT NULL
        AND ce.reminder_minutes >= 0
        AND ce.start_at > NOW()
        AND ce.start_at - (ce.reminder_minutes * INTERVAL '1 minute') <= NOW() + INTERVAL '2 minutes'
        AND ce.start_at - (ce.reminder_minutes * INTERVAL '1 minute') > NOW() - INTERVAL '1 minute'
        AND NOT EXISTS (
          SELECT 1 FROM calendar_reminder_sent crs
          WHERE crs.event_id = ce.id
            AND crs.reminder_time = ce.start_at - (ce.reminder_minutes * INTERVAL '1 minute')
        )
    `);

    return result.rows.map((row) => ({
      eventCacheId: row.event_cache_id,
      eventId: row.event_id,
      userId: row.user_id,
      title: row.title,
      startAt: row.start_at,
      location: row.location,
      reminderMinutes: row.reminder_minutes,
      reminderTime: row.reminder_time,
    }));
  } catch (error) {
    logger.error('Failed to get pending calendar reminders', { error: (error as Error).message });
    return [];
  }
}

/**
 * Mark a reminder as sent to prevent duplicate notifications
 */
export async function markReminderSent(
  eventCacheId: string,
  userId: string,
  reminderTime: Date
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO calendar_reminder_sent (event_id, user_id, reminder_time)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, reminder_time) DO NOTHING`,
      [eventCacheId, userId, reminderTime]
    );
  } catch (error) {
    logger.error('Failed to mark reminder as sent', { error: (error as Error).message, eventCacheId });
  }
}

/**
 * Format reminder message in Swedish locale
 */
export function formatReminderMessage(reminder: PendingCalendarReminder): string {
  const timeStr = reminder.startAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = reminder.startAt.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });

  let message = `Reminder: ${reminder.title}\n\nStarts at ${timeStr} (${dateStr})`;
  if (reminder.location) {
    message += `\nLocation: ${reminder.location}`;
  }

  // Format the reminder time nicely
  const mins = reminder.reminderMinutes;
  let timeLabel: string;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (remainingMins === 0) {
      timeLabel = hours === 1 ? '1 hour' : `${hours} hours`;
    } else {
      timeLabel = `${hours}h ${remainingMins}min`;
    }
  } else {
    timeLabel = `${mins} minute${mins !== 1 ? 's' : ''}`;
  }

  message += `\n\nThis is your ${timeLabel} reminder.`;

  return message;
}

/**
 * Process pending calendar reminders and enqueue for delivery
 */
export async function processCalendarReminders(): Promise<number> {
  const pendingReminders = await getPendingCalendarReminders();
  let enqueued = 0;

  for (const reminder of pendingReminders) {
    try {
      // Get user's notification preferences
      const prefs = await triggerService.getNotificationPreferences(reminder.userId);

      // Only send if user has Telegram enabled and reminders enabled
      if (!prefs.enableTelegram) {
        logger.debug('Skipping calendar reminder - Telegram not enabled', {
          userId: reminder.userId,
          eventId: reminder.eventId
        });
        // Still mark as sent to avoid retrying
        await markReminderSent(reminder.eventCacheId, reminder.userId, reminder.reminderTime);
        continue;
      }

      if (!prefs.enableReminders) {
        logger.debug('Skipping calendar reminder - reminders disabled', {
          userId: reminder.userId,
          eventId: reminder.eventId
        });
        await markReminderSent(reminder.eventCacheId, reminder.userId, reminder.reminderTime);
        continue;
      }

      const message = formatReminderMessage(reminder);

      // Send real-time notification via SSE
      const timeStr = reminder.startAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      await deliveryService.sendReminderNotification(
        reminder.userId,
        `Upcoming: ${reminder.title}`,
        `Starts at ${timeStr}${reminder.location ? ` - ${reminder.location}` : ''}`,
        8, // High priority for time-sensitive reminders
        'calendar'
      );

      // Also enqueue for Telegram delivery if enabled
      if (prefs.enableTelegram) {
        await triggerService.enqueueTrigger({
          userId: reminder.userId,
          triggerSource: 'event',
          triggerType: 'calendar_reminder',
          payload: {
            eventId: reminder.eventId,
            eventTitle: reminder.title,
            startAt: reminder.startAt.toISOString(),
            reminderMinutes: reminder.reminderMinutes,
          },
          message,
          deliveryMethod: 'telegram',
          priority: 8,
        });
      }

      // Mark as sent
      await markReminderSent(reminder.eventCacheId, reminder.userId, reminder.reminderTime);
      enqueued++;

      logger.info('Calendar reminder enqueued', {
        eventId: reminder.eventId,
        userId: reminder.userId,
        reminderMinutes: reminder.reminderMinutes,
        startAt: reminder.startAt.toISOString(),
      });
    } catch (error) {
      logger.error('Failed to process calendar reminder', {
        error: (error as Error).message,
        eventId: reminder.eventId,
        userId: reminder.userId,
      });
    }
  }

  return enqueued;
}

/**
 * Clean up old sent reminder records (older than 7 days)
 */
export async function cleanupOldReminderRecords(): Promise<number> {
  try {
    const result = await pool.query(`
      DELETE FROM calendar_reminder_sent
      WHERE sent_at < NOW() - INTERVAL '7 days'
    `);
    const deleted = result.rowCount || 0;
    if (deleted > 0) {
      logger.info('Cleaned up old calendar reminder records', { deleted });
    }
    return deleted;
  } catch (error) {
    logger.error('Failed to cleanup old reminder records', { error: (error as Error).message });
    return 0;
  }
}

export default {
  getPendingCalendarReminders,
  markReminderSent,
  formatReminderMessage,
  processCalendarReminders,
  cleanupOldReminderRecords,
};
