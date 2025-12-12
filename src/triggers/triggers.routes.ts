import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as triggerService from './trigger.service.js';
import * as deliveryService from './delivery.service.js';
import * as checkinsService from '../abilities/checkins.service.js';
import * as telegramService from './telegram.service.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================
// Server-Sent Events (SSE) for Live Updates
// ============================================

/**
 * GET /api/triggers/live
 * SSE endpoint for receiving real-time trigger notifications
 */
router.get('/live', (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date() })}\n\n`);

  // Keep-alive ping every 30 seconds
  const pingInterval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: new Date() })}\n\n`);
  }, 30000);

  // Subscriber callback
  const callback = (data: deliveryService.TriggerEvent) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error('Failed to send SSE event', { userId, error: (error as Error).message });
    }
  };

  // Register subscriber
  deliveryService.addUserSubscriber(userId, callback);

  logger.info('User connected to trigger SSE', { userId });

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    deliveryService.removeUserSubscriber(userId, callback);
    logger.info('User disconnected from trigger SSE', { userId });
  });
});

// ============================================
// Notification Preferences
// ============================================

/**
 * GET /api/triggers/preferences
 * Get user's notification preferences
 */
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const preferences = await triggerService.getNotificationPreferences(req.user!.userId);
    res.json(preferences);
  } catch (error) {
    logger.error('Failed to get notification preferences', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

const updatePreferencesSchema = z.object({
  enableChatNotifications: z.boolean().optional(),
  enablePushNotifications: z.boolean().optional(),
  enableEmailDigest: z.boolean().optional(),
  enableTelegram: z.boolean().optional(),
  persistTelegramToChat: z.boolean().optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  enableReminders: z.boolean().optional(),
  enableCheckins: z.boolean().optional(),
  enableInsights: z.boolean().optional(),
  enableAchievements: z.boolean().optional(),
});

/**
 * PUT /api/triggers/preferences
 * Update user's notification preferences
 */
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const updates = updatePreferencesSchema.parse(req.body);
    const preferences = await triggerService.updateNotificationPreferences(req.user!.userId, updates);
    res.json(preferences);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to update notification preferences', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// ============================================
// Check-in Schedules (Triggers)
// ============================================

/**
 * GET /api/triggers/schedules
 * Get user's trigger schedules
 */
router.get('/schedules', async (req: Request, res: Response) => {
  try {
    const schedules = await checkinsService.getCheckinSchedules(req.user!.userId);
    res.json({ schedules });
  } catch (error) {
    logger.error('Failed to get schedules', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get schedules' });
  }
});

/**
 * GET /api/triggers/schedules/builtin
 * Get built-in schedule templates
 */
router.get('/schedules/builtin', (_req: Request, res: Response) => {
  const builtins = checkinsService.getBuiltInCheckins();
  res.json({ builtins });
});

const createScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  triggerType: z.enum(['time', 'pattern', 'event']),
  triggerConfig: z.object({
    cron: z.string().optional(),
    timezone: z.string().optional(),
    pattern: z.string().optional(),
    conditions: z.record(z.unknown()).optional(),
    eventType: z.string().optional(),
  }),
  promptTemplate: z.string().min(1).max(1000),
  isEnabled: z.boolean().optional(),
});

/**
 * POST /api/triggers/schedules
 * Create a new trigger schedule
 */
router.post('/schedules', async (req: Request, res: Response) => {
  try {
    const data = createScheduleSchema.parse(req.body);
    const schedule = await checkinsService.createCheckinSchedule(req.user!.userId, data);
    res.status(201).json(schedule);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to create schedule', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  triggerConfig: z.object({
    cron: z.string().optional(),
    timezone: z.string().optional(),
    pattern: z.string().optional(),
    conditions: z.record(z.unknown()).optional(),
    eventType: z.string().optional(),
  }).optional(),
  promptTemplate: z.string().min(1).max(1000).optional(),
  isEnabled: z.boolean().optional(),
});

/**
 * PUT /api/triggers/schedules/:scheduleId
 * Update a trigger schedule
 */
router.put('/schedules/:scheduleId', async (req: Request, res: Response) => {
  try {
    const updates = updateScheduleSchema.parse(req.body);
    const schedule = await checkinsService.updateCheckinSchedule(
      req.user!.userId,
      req.params.scheduleId,
      updates
    );

    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    res.json(schedule);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to update schedule', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

/**
 * DELETE /api/triggers/schedules/:scheduleId
 * Delete a trigger schedule
 */
router.delete('/schedules/:scheduleId', async (req: Request, res: Response) => {
  try {
    const deleted = await checkinsService.deleteCheckinSchedule(req.user!.userId, req.params.scheduleId);

    if (!deleted) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete schedule', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// ============================================
// Trigger History
// ============================================

/**
 * GET /api/triggers/history
 * Get user's trigger history
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await triggerService.getTriggerHistory(req.user!.userId, limit);
    res.json({ history });
  } catch (error) {
    logger.error('Failed to get trigger history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/**
 * GET /api/triggers/pending/count
 * Get count of pending triggers for badge display
 */
router.get('/pending/count', async (req: Request, res: Response) => {
  try {
    const count = await triggerService.getPendingTriggerCount(req.user!.userId);
    res.json({ count });
  } catch (error) {
    logger.error('Failed to get pending count', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// ============================================
// Push Subscriptions
// ============================================

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  deviceName: z.string().optional(),
});

/**
 * POST /api/triggers/push/subscribe
 * Register a push subscription
 */
router.post('/push/subscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint, keys, deviceName } = pushSubscriptionSchema.parse(req.body);

    await deliveryService.registerPushSubscription(
      req.user!.userId,
      { endpoint, keys },
      deviceName,
      req.headers['user-agent']
    );

    res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to register push subscription', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to register subscription' });
  }
});

/**
 * DELETE /api/triggers/push/unsubscribe
 * Remove a push subscription
 */
router.delete('/push/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      res.status(400).json({ error: 'Endpoint required' });
      return;
    }

    await deliveryService.removePushSubscription(req.user!.userId, endpoint);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to remove push subscription', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

/**
 * GET /api/triggers/push/subscriptions
 * Get user's push subscriptions
 */
router.get('/push/subscriptions', async (req: Request, res: Response) => {
  try {
    const subscriptions = await deliveryService.getPushSubscriptions(req.user!.userId);
    res.json({ subscriptions });
  } catch (error) {
    logger.error('Failed to get push subscriptions', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
});

// ============================================
// Manual Trigger (for testing)
// ============================================

/**
 * POST /api/triggers/test
 * Manually trigger a test notification (dev/testing only)
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { message, deliveryMethod } = req.body;

    await deliveryService.sendDirectMessage(req.user!.userId, message || 'This is a test notification from Luna!', {
      deliveryMethod: deliveryMethod || 'chat',
      priority: 5,
    });

    res.json({ success: true, message: 'Test trigger sent' });
  } catch (error) {
    logger.error('Failed to send test trigger', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to send test trigger' });
  }
});

const notificationSchema = z.object({
  category: z.enum(['trading', 'reminders', 'email', 'autonomous']),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  priority: z.number().min(1).max(10).optional(),
  eventType: z.string().optional(),
});

/**
 * POST /api/triggers/notification
 * Send a notification to the current user (for testing the notification system)
 */
router.post('/notification', async (req: Request, res: Response) => {
  try {
    const data = notificationSchema.parse(req.body);

    await deliveryService.sendNotification(req.user!.userId, {
      category: data.category,
      title: data.title,
      message: data.message,
      priority: data.priority || 5,
      eventType: data.eventType,
      navigationTarget: {
        appId: data.category === 'trading' ? 'trading' :
               data.category === 'reminders' ? 'todo' :
               data.category === 'email' ? 'email' : 'chat',
      },
    });

    res.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to send notification', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ============================================
// Telegram Integration
// ============================================

/**
 * GET /api/triggers/telegram/status
 * Get Telegram connection status and bot info
 */
router.get('/telegram/status', async (req: Request, res: Response) => {
  try {
    const isConfigured = telegramService.isConfigured();
    const connection = await telegramService.getTelegramConnection(req.user!.userId);
    const botInfo = isConfigured ? await telegramService.getBotInfo() : null;

    res.json({
      isConfigured,
      connection: connection ? {
        chatId: connection.chatId,
        username: connection.username,
        firstName: connection.firstName,
        isActive: connection.isActive,
        linkedAt: connection.linkedAt,
        lastMessageAt: connection.lastMessageAt,
      } : null,
      botInfo,
      setupInstructions: !isConfigured ? telegramService.getSetupInstructions() : null,
    });
  } catch (error) {
    logger.error('Failed to get Telegram status', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Telegram status' });
  }
});

/**
 * POST /api/triggers/telegram/link
 * Generate a link code for connecting Telegram
 */
router.post('/telegram/link', async (req: Request, res: Response) => {
  try {
    if (!telegramService.isConfigured()) {
      res.status(400).json({
        error: 'Telegram not configured',
        setupInstructions: telegramService.getSetupInstructions(),
      });
      return;
    }

    const code = await telegramService.generateLinkCode(req.user!.userId);
    const botInfo = await telegramService.getBotInfo();

    res.json({
      code,
      expiresInMinutes: 10,
      botUsername: botInfo?.username,
      linkUrl: botInfo ? `https://t.me/${botInfo.username}?start=${code}` : null,
    });
  } catch (error) {
    logger.error('Failed to generate Telegram link code', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to generate link code' });
  }
});

/**
 * DELETE /api/triggers/telegram/unlink
 * Unlink Telegram from user account
 */
router.delete('/telegram/unlink', async (req: Request, res: Response) => {
  try {
    const unlinked = await telegramService.unlinkTelegram(req.user!.userId);

    if (unlinked) {
      res.json({ success: true, message: 'Telegram unlinked successfully' });
    } else {
      res.status(404).json({ error: 'No Telegram connection found' });
    }
  } catch (error) {
    logger.error('Failed to unlink Telegram', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to unlink Telegram' });
  }
});

/**
 * POST /api/triggers/telegram/test
 * Send a test message via Telegram
 */
router.post('/telegram/test', async (req: Request, res: Response) => {
  try {
    const connection = await telegramService.getTelegramConnection(req.user!.userId);

    if (!connection) {
      res.status(404).json({ error: 'No Telegram connection found' });
      return;
    }

    const success = await telegramService.sendTelegramMessage(
      connection.chatId,
      'This is a test message from Luna! Your Telegram connection is working correctly.'
    );

    if (success) {
      res.json({ success: true, message: 'Test message sent' });
    } else {
      res.status(500).json({ error: 'Failed to send test message' });
    }
  } catch (error) {
    logger.error('Failed to send Telegram test message', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to send test message' });
  }
});

// ============================================
// Telegram Webhook (no auth - comes from Telegram)
// ============================================

// Create separate router for webhook
export const telegramWebhookRouter = Router();

/**
 * POST /api/triggers/telegram/webhook
 * Receive updates from Telegram (no authentication)
 */
telegramWebhookRouter.post('/telegram/webhook', async (req: Request, res: Response) => {
  try {
    // Always respond 200 OK quickly to Telegram
    res.status(200).json({ ok: true });

    // Process update asynchronously
    await telegramService.processUpdate(req.body);
  } catch (error) {
    logger.error('Failed to process Telegram webhook', { error: (error as Error).message });
    // Still return 200 to prevent Telegram from retrying
  }
});

export default router;
