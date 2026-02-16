import { api } from './core';

// ============================================
// Triggers API - Proactive Notifications
// ============================================

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

export interface TelegramStatus {
  isConfigured: boolean;
  connection: {
    chatId: number;
    username: string | null;
    firstName: string | null;
    isActive: boolean;
    linkedAt: string;
    lastMessageAt: string | null;
  } | null;
  botInfo: {
    username: string;
    firstName: string;
  } | null;
  setupInstructions: string | null;
}

export interface TelegramLinkCode {
  code: string;
  expiresInMinutes: number;
  botUsername: string | null;
  linkUrl: string | null;
}

export interface TriggerSchedule {
  id: string;
  name: string;
  triggerType: 'time' | 'pattern' | 'event';
  triggerConfig: {
    cron?: string;
    timezone?: string;
    pattern?: string;
    conditions?: Record<string, unknown>;
    eventType?: string;
  };
  promptTemplate: string;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  createdAt: string;
}

export interface BuiltinSchedule {
  name: string;
  triggerType: 'time' | 'pattern' | 'event';
  triggerConfig: {
    cron?: string;
    timezone?: string;
    pattern?: string;
    conditions?: Record<string, unknown>;
    eventType?: string;
  };
  promptTemplate: string;
  isEnabled: boolean;
}

export interface TriggerHistoryItem {
  id: string;
  triggerSource: string;
  triggerType: string;
  messageSent: string;
  deliveryMethod: string;
  userResponded: boolean;
  createdAt: string;
}

export interface PushSubscriptionInfo {
  id: string;
  endpoint: string;
  deviceName: string | null;
  createdAt: string;
}

export const triggersApi = {
  // Notification Preferences
  getPreferences: () =>
    api<NotificationPreferences>('/api/triggers/preferences'),

  updatePreferences: (preferences: Partial<NotificationPreferences>) =>
    api<NotificationPreferences>('/api/triggers/preferences', { method: 'PUT', body: preferences }),

  // Schedules
  getSchedules: () =>
    api<{ schedules: TriggerSchedule[] }>('/api/triggers/schedules'),

  getBuiltinSchedules: () =>
    api<{ builtins: BuiltinSchedule[] }>('/api/triggers/schedules/builtin'),

  createSchedule: (schedule: {
    name: string;
    triggerType: 'time' | 'pattern' | 'event';
    triggerConfig: TriggerSchedule['triggerConfig'];
    promptTemplate: string;
    isEnabled?: boolean;
  }) =>
    api<TriggerSchedule>('/api/triggers/schedules', { method: 'POST', body: schedule }),

  updateSchedule: (id: string, updates: Partial<{
    name: string;
    triggerConfig: TriggerSchedule['triggerConfig'];
    promptTemplate: string;
    isEnabled: boolean;
  }>) =>
    api<TriggerSchedule>(`/api/triggers/schedules/${id}`, { method: 'PUT', body: updates }),

  deleteSchedule: (id: string) =>
    api<{ success: boolean }>(`/api/triggers/schedules/${id}`, { method: 'DELETE' }),

  // History
  getHistory: (limit = 20) =>
    api<{ history: TriggerHistoryItem[] }>(`/api/triggers/history?limit=${limit}`),

  getPendingCount: () =>
    api<{ count: number }>('/api/triggers/pending/count'),

  // Push Subscriptions
  subscribePush: (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    deviceName?: string;
  }) =>
    api<{ success: boolean }>('/api/triggers/push/subscribe', { method: 'POST', body: subscription }),

  unsubscribePush: (endpoint: string) =>
    api<{ success: boolean }>('/api/triggers/push/unsubscribe', { method: 'DELETE', body: { endpoint } }),

  getPushSubscriptions: () =>
    api<{ subscriptions: PushSubscriptionInfo[] }>('/api/triggers/push/subscriptions'),

  // Test
  sendTestTrigger: (message?: string, deliveryMethod?: 'chat' | 'push' | 'sse' | 'telegram') =>
    api<{ success: boolean; message: string }>('/api/triggers/test', {
      method: 'POST',
      body: { message, deliveryMethod },
    }),

  // Send notification (for testing the notification panel)
  sendNotification: (notification: {
    category: 'trading' | 'reminders' | 'email' | 'autonomous';
    title: string;
    message: string;
    priority?: number;
    eventType?: string;
  }) =>
    api<{ success: boolean; message: string }>('/api/triggers/notification', {
      method: 'POST',
      body: notification,
    }),

  // Telegram
  getTelegramStatus: () =>
    api<TelegramStatus>('/api/triggers/telegram/status'),

  generateTelegramLinkCode: () =>
    api<TelegramLinkCode>('/api/triggers/telegram/link', { method: 'POST' }),

  unlinkTelegram: () =>
    api<{ success: boolean; message: string }>('/api/triggers/telegram/unlink', { method: 'DELETE' }),

  sendTelegramTest: () =>
    api<{ success: boolean; message: string }>('/api/triggers/telegram/test', { method: 'POST' }),

  // Trading Telegram (separate bot for Trader Luna)
  getTradingTelegramStatus: () =>
    api<TelegramStatus>('/api/triggers/trading-telegram/status'),

  generateTradingTelegramLinkCode: () =>
    api<TelegramLinkCode>('/api/triggers/trading-telegram/link', { method: 'POST' }),

  unlinkTradingTelegram: () =>
    api<{ success: boolean; message: string }>('/api/triggers/trading-telegram/unlink', { method: 'DELETE' }),

  sendTradingTelegramTest: () =>
    api<{ success: boolean; message: string }>('/api/triggers/trading-telegram/test', { method: 'POST' }),
};
