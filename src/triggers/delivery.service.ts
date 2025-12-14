import { pool } from '../db/index.js';
import * as sessionService from '../chat/session.service.js';
import * as triggerService from './trigger.service.js';
import * as telegramService from './telegram.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

interface UserSubscriber {
  userId: string;
  callback: (data: TriggerEvent) => void;
}

// Notification categories
export type NotificationCategory = 'trading' | 'reminders' | 'email' | 'autonomous';

// Navigation target for notifications
export interface NotificationNavigationTarget {
  appId: string;
  context?: Record<string, unknown>;
}

// Enhanced notification payload
export interface NotificationPayload {
  category: NotificationCategory;
  title: string;
  message: string;
  priority: number; // 1-10
  eventType?: string;
  navigationTarget?: NotificationNavigationTarget;
}

// Activity payload for activity window
export interface ActivityPayload {
  id: string;
  category: string;
  eventType: string;
  level: string;
  title: string;
  message?: string;
  details?: Record<string, unknown>;
  source?: string;
  durationMs?: number;
  createdAt: Date;
}

export interface TriggerEvent {
  type: 'new_message' | 'trigger_delivered' | 'ping' | 'notification' | 'activity';
  triggerId?: string;
  sessionId?: string;
  message?: string;
  timestamp: Date;
  // Enhanced notification data
  notification?: NotificationPayload;
  // Activity data for activity window
  activity?: ActivityPayload;
}

// ============================================
// In-Memory User Subscribers (SSE)
// ============================================

const userSubscribers: Map<string, Set<UserSubscriber['callback']>> = new Map();

/**
 * Add a subscriber for user events
 */
export function addUserSubscriber(userId: string, callback: UserSubscriber['callback']): void {
  if (!userSubscribers.has(userId)) {
    userSubscribers.set(userId, new Set());
  }
  userSubscribers.get(userId)!.add(callback);
  logger.debug('User subscriber added', { userId, subscriberCount: userSubscribers.get(userId)!.size });
}

/**
 * Remove a subscriber
 */
export function removeUserSubscriber(userId: string, callback: UserSubscriber['callback']): void {
  const subscribers = userSubscribers.get(userId);
  if (subscribers) {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      userSubscribers.delete(userId);
    }
    logger.debug('User subscriber removed', { userId, subscriberCount: subscribers?.size || 0 });
  }
}

/**
 * Check if user has active subscribers (online)
 */
export function isUserOnline(userId: string): boolean {
  const subscribers = userSubscribers.get(userId);
  return subscribers !== undefined && subscribers.size > 0;
}

/**
 * Broadcast event to user's subscribers
 */
export function broadcastToUser(userId: string, event: TriggerEvent): void {
  const subscribers = userSubscribers.get(userId);
  if (subscribers) {
    for (const callback of subscribers) {
      try {
        callback(event);
      } catch (error) {
        logger.error('Failed to broadcast to subscriber', { userId, error: (error as Error).message });
      }
    }
  }
}

// ============================================
// Delivery Methods
// ============================================

/**
 * Deliver trigger to chat
 */
async function deliverToChat(trigger: triggerService.PendingTrigger): Promise<string> {
  // Get or create Luna Updates session
  const sessionResult = await pool.query(
    `SELECT get_or_create_luna_updates_session($1) as session_id`,
    [trigger.userId]
  );

  const sessionId = sessionResult.rows[0].session_id;

  // Add Luna's proactive message
  await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: trigger.message,
  });

  logger.info('Trigger delivered to chat', {
    triggerId: trigger.id,
    userId: trigger.userId,
    sessionId,
  });

  // Broadcast to user if online
  broadcastToUser(trigger.userId, {
    type: 'new_message',
    triggerId: trigger.id,
    sessionId,
    message: trigger.message,
    timestamp: new Date(),
  });

  return sessionId;
}

/**
 * Deliver trigger via SSE only (no persistent message)
 */
async function deliverToSSE(trigger: triggerService.PendingTrigger): Promise<void> {
  if (!isUserOnline(trigger.userId)) {
    // User not online, fall back to chat
    logger.debug('User not online for SSE, falling back to chat', {
      triggerId: trigger.id,
      userId: trigger.userId,
    });
    await deliverToChat(trigger);
    return;
  }

  broadcastToUser(trigger.userId, {
    type: 'trigger_delivered',
    triggerId: trigger.id,
    message: trigger.message,
    timestamp: new Date(),
  });

  logger.info('Trigger delivered via SSE', {
    triggerId: trigger.id,
    userId: trigger.userId,
  });
}

/**
 * Deliver trigger via push notification
 * Note: Full implementation requires web-push library and VAPID keys
 */
async function deliverToPush(trigger: triggerService.PendingTrigger): Promise<void> {
  // Get user's push subscriptions
  const result = await pool.query(
    `SELECT * FROM push_subscriptions
     WHERE user_id = $1 AND is_active = true`,
    [trigger.userId]
  );

  if (result.rows.length === 0) {
    // No push subscriptions, fall back to chat
    logger.debug('No push subscriptions, falling back to chat', {
      triggerId: trigger.id,
      userId: trigger.userId,
    });
    await deliverToChat(trigger);
    return;
  }

  // For now, log that we would send push notifications
  // Full implementation would use web-push library:
  //
  // import webpush from 'web-push';
  // for (const sub of result.rows) {
  //   await webpush.sendNotification(
  //     { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
  //     JSON.stringify({ title: 'Luna', body: trigger.message, triggerId: trigger.id })
  //   );
  // }

  logger.info('Push notification would be sent', {
    triggerId: trigger.id,
    userId: trigger.userId,
    subscriptionCount: result.rows.length,
  });

  // Also deliver to chat for persistence
  await deliverToChat(trigger);
}

/**
 * Deliver trigger via Telegram
 */
async function deliverToTelegram(trigger: triggerService.PendingTrigger): Promise<void> {
  // Get user's Telegram connection
  const connection = await telegramService.getTelegramConnection(trigger.userId);

  if (!connection || !connection.isActive) {
    // No Telegram connection, fall back to chat
    logger.debug('No Telegram connection, falling back to chat', {
      triggerId: trigger.id,
      userId: trigger.userId,
    });
    await deliverToChat(trigger);
    return;
  }

  // Send via Telegram
  const success = await telegramService.sendTelegramMessage(
    connection.chatId,
    trigger.message,
    { disableNotification: false }
  );

  if (success) {
    // Update last message time
    await telegramService.updateLastMessageTime(trigger.userId);

    logger.info('Trigger delivered via Telegram', {
      triggerId: trigger.id,
      userId: trigger.userId,
      chatId: connection.chatId,
    });
  } else {
    // Telegram failed, fall back to chat
    logger.warn('Telegram delivery failed, falling back to chat', {
      triggerId: trigger.id,
      userId: trigger.userId,
    });
    await deliverToChat(trigger);
  }

  // Also deliver to chat for persistence (optional based on user preference)
  const prefs = await triggerService.getNotificationPreferences(trigger.userId);
  if (prefs?.persistTelegramToChat !== false) {
    await deliverToChat(trigger);
  }
}

/**
 * Main delivery function
 */
export async function deliverTrigger(trigger: triggerService.PendingTrigger): Promise<void> {
  try {
    await triggerService.markTriggerProcessing(trigger.id);

    let sessionId: string | undefined;

    switch (trigger.deliveryMethod) {
      case 'chat':
        sessionId = await deliverToChat(trigger);
        break;
      case 'sse':
        await deliverToSSE(trigger);
        break;
      case 'push':
        await deliverToPush(trigger);
        break;
      case 'telegram':
        await deliverToTelegram(trigger);
        break;
      default:
        sessionId = await deliverToChat(trigger);
    }

    await triggerService.markTriggerDelivered(trigger.id, sessionId);

    logger.info('Trigger delivered successfully', {
      triggerId: trigger.id,
      userId: trigger.userId,
      method: trigger.deliveryMethod,
    });
  } catch (error) {
    const errorMessage = (error as Error).message;
    await triggerService.markTriggerFailed(trigger.id, errorMessage);

    logger.error('Failed to deliver trigger', {
      triggerId: trigger.id,
      userId: trigger.userId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Process all pending triggers in the queue
 */
export async function processTriggerQueue(): Promise<number> {
  const pendingTriggers = await triggerService.getPendingTriggers(20);
  let delivered = 0;

  for (const trigger of pendingTriggers) {
    try {
      await deliverTrigger(trigger);
      delivered++;
    } catch (error) {
      // Error already logged in deliverTrigger
      // Continue with next trigger
    }
  }

  return delivered;
}

/**
 * Send a direct message to user (for immediate notifications)
 */
export async function sendDirectMessage(
  userId: string,
  message: string,
  options?: {
    sessionId?: string;
    deliveryMethod?: 'chat' | 'sse' | 'push';
    priority?: number;
  }
): Promise<void> {
  const trigger = await triggerService.enqueueTrigger({
    userId,
    triggerSource: 'event',
    triggerType: 'direct_message',
    message,
    deliveryMethod: options?.deliveryMethod || 'chat',
    targetSessionId: options?.sessionId,
    priority: options?.priority || 5,
  });

  // Deliver immediately
  await deliverTrigger(trigger);
}

// ============================================
// Push Subscription Management
// ============================================

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Register a push subscription for a user
 */
export async function registerPushSubscription(
  userId: string,
  subscription: PushSubscription,
  deviceName?: string,
  userAgent?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, endpoint)
     DO UPDATE SET p256dh = $3, auth = $4, is_active = true, last_used = NOW()`,
    [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, deviceName, userAgent]
  );

  logger.info('Push subscription registered', { userId, endpoint: subscription.endpoint.substring(0, 50) });
}

/**
 * Remove a push subscription
 */
export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await pool.query(
    `UPDATE push_subscriptions SET is_active = false WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint]
  );

  logger.info('Push subscription removed', { userId });
}

/**
 * Get user's push subscriptions
 */
export async function getPushSubscriptions(userId: string): Promise<Array<{
  id: string;
  endpoint: string;
  deviceName: string | null;
  createdAt: Date;
}>> {
  const result = await pool.query(
    `SELECT id, endpoint, device_name, created_at
     FROM push_subscriptions
     WHERE user_id = $1 AND is_active = true`,
    [userId]
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    endpoint: row.endpoint as string,
    deviceName: row.device_name as string | null,
    createdAt: row.created_at as Date,
  }));
}

/**
 * Send a notification to user (bypasses trigger queue for real-time delivery)
 */
export async function sendNotification(
  userId: string,
  notification: NotificationPayload
): Promise<void> {
  const event: TriggerEvent = {
    type: 'notification',
    timestamp: new Date(),
    notification,
  };

  // If user is online, send via SSE immediately
  if (isUserOnline(userId)) {
    broadcastToUser(userId, event);
    logger.info('Notification sent via SSE', {
      userId,
      category: notification.category,
      title: notification.title,
    });
  } else {
    // User offline - optionally queue for later or send via other channels
    logger.debug('User offline, notification not delivered via SSE', {
      userId,
      category: notification.category,
    });
  }
}

/**
 * Send a trading notification
 */
export async function sendTradingNotification(
  userId: string,
  title: string,
  message: string,
  eventType: string,
  priority: number = 7,
  context?: Record<string, unknown>
): Promise<void> {
  await sendNotification(userId, {
    category: 'trading',
    title,
    message,
    priority,
    eventType,
    navigationTarget: {
      appId: 'trading',
      context,
    },
  });
}

/**
 * Send a reminder notification
 */
export async function sendReminderNotification(
  userId: string,
  title: string,
  message: string,
  priority: number = 8,
  appId: 'todo' | 'calendar' = 'todo'
): Promise<void> {
  await sendNotification(userId, {
    category: 'reminders',
    title,
    message,
    priority,
    eventType: appId === 'calendar' ? 'calendar.event_soon' : 'reminder.due',
    navigationTarget: { appId },
  });
}

/**
 * Send an email notification
 */
export async function sendEmailNotification(
  userId: string,
  title: string,
  message: string,
  priority: number = 5
): Promise<void> {
  await sendNotification(userId, {
    category: 'email',
    title,
    message,
    priority,
    eventType: 'email.new',
    navigationTarget: { appId: 'email' },
  });
}

/**
 * Send an autonomous/Luna notification
 */
export async function sendAutonomousNotification(
  userId: string,
  title: string,
  message: string,
  eventType: string = 'autonomous.message',
  priority: number = 6
): Promise<void> {
  await sendNotification(userId, {
    category: 'autonomous',
    title,
    message,
    priority,
    eventType,
    navigationTarget: { appId: 'chat' },
  });
}

/**
 * Broadcast an activity event to user's subscribers (for Activity Window)
 */
export function broadcastActivity(userId: string, activity: ActivityPayload): void {
  const subscribers = userSubscribers.get(userId);
  const subscriberCount = subscribers?.size || 0;

  logger.info('Broadcasting activity event', {
    userId,
    activityId: activity.id,
    category: activity.category,
    subscriberCount,
  });

  if (subscriberCount === 0) {
    return; // No subscribers, nothing to broadcast
  }

  const event: TriggerEvent = {
    type: 'activity',
    timestamp: new Date(),
    activity,
  };

  broadcastToUser(userId, event);
}

export default {
  addUserSubscriber,
  removeUserSubscriber,
  isUserOnline,
  broadcastToUser,
  broadcastActivity,
  deliverTrigger,
  processTriggerQueue,
  sendDirectMessage,
  sendNotification,
  sendTradingNotification,
  sendReminderNotification,
  sendEmailNotification,
  sendAutonomousNotification,
  registerPushSubscription,
  removePushSubscription,
  getPushSubscriptions,
};
