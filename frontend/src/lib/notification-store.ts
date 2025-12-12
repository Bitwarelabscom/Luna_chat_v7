'use client';

import { create } from 'zustand';
import { type AppId } from '@/components/os/app-registry';

// Notification category types
export type NotificationCategory = 'trading' | 'reminders' | 'email' | 'autonomous';

// Priority levels
export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationNavigationTarget {
  appId: AppId;
  context?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  priority: NotificationPriority;
  priorityValue: number; // 1-10 numeric value
  timestamp: Date;
  read: boolean;
  dismissed: boolean;
  navigationTarget?: NotificationNavigationTarget;
  sourceType: 'sse' | 'poll' | 'push' | 'local';
  sourceId?: string;
  expiresAt?: Date;
}

// Map priority values to priority levels
export function getPriorityLevel(value: number): NotificationPriority {
  if (value >= 9) return 'critical';
  if (value >= 7) return 'high';
  if (value >= 4) return 'medium';
  return 'low';
}

// Category display configuration
export const categoryConfig: Record<NotificationCategory, { label: string; color: string }> = {
  trading: { label: 'Trading', color: 'emerald' },
  reminders: { label: 'Reminders', color: 'amber' },
  email: { label: 'Email', color: 'blue' },
  autonomous: { label: 'Luna', color: 'purple' },
};

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  unreadByCategory: Record<NotificationCategory, number>;

  // SSE connection state
  sseConnected: boolean;
  sseError: string | null;

  // UI state
  hasUrgentUnread: boolean;
  isDropdownOpen: boolean;
  activeFilter: NotificationCategory | 'all';

  // Actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read' | 'dismissed'>) => void;
  markRead: (id: string) => void;
  markAllRead: (category?: NotificationCategory) => void;
  dismiss: (id: string) => void;
  dismissAll: (category?: NotificationCategory) => void;
  clearExpired: () => void;

  // SSE management
  setSSEConnected: (connected: boolean) => void;
  setSSEError: (error: string | null) => void;

  // UI actions
  setDropdownOpen: (open: boolean) => void;
  setActiveFilter: (filter: NotificationCategory | 'all') => void;

  // Bulk updates (from SSE/polling)
  syncNotifications: (notifications: Notification[]) => void;
}

function generateId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function computeUnreadCount(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read && !n.dismissed).length;
}

function computeUnreadByCategory(notifications: Notification[]): Record<NotificationCategory, number> {
  const counts: Record<NotificationCategory, number> = {
    trading: 0,
    reminders: 0,
    email: 0,
    autonomous: 0,
  };

  for (const n of notifications) {
    if (!n.read && !n.dismissed) {
      counts[n.category]++;
    }
  }

  return counts;
}

function computeHasUrgent(notifications: Notification[]): boolean {
  return notifications.some((n) => !n.read && !n.dismissed && n.priorityValue >= 8);
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  unreadByCategory: {
    trading: 0,
    reminders: 0,
    email: 0,
    autonomous: 0,
  },
  sseConnected: false,
  sseError: null,
  hasUrgentUnread: false,
  isDropdownOpen: false,
  activeFilter: 'all',

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: generateId(),
      timestamp: new Date(),
      read: false,
      dismissed: false,
    };

    set((state) => {
      // Avoid duplicates by sourceId
      if (notification.sourceId && state.notifications.some((n) => n.sourceId === notification.sourceId)) {
        return state;
      }

      const updated = [newNotification, ...state.notifications].slice(0, 100); // Keep max 100
      return {
        notifications: updated,
        unreadCount: computeUnreadCount(updated),
        unreadByCategory: computeUnreadByCategory(updated),
        hasUrgentUnread: computeHasUrgent(updated),
      };
    });
  },

  markRead: (id) => {
    set((state) => {
      const updated = state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      return {
        notifications: updated,
        unreadCount: computeUnreadCount(updated),
        unreadByCategory: computeUnreadByCategory(updated),
        hasUrgentUnread: computeHasUrgent(updated),
      };
    });
  },

  markAllRead: (category) => {
    set((state) => {
      const updated = state.notifications.map((n) => {
        if (category && n.category !== category) return n;
        return { ...n, read: true };
      });
      return {
        notifications: updated,
        unreadCount: computeUnreadCount(updated),
        unreadByCategory: computeUnreadByCategory(updated),
        hasUrgentUnread: computeHasUrgent(updated),
      };
    });
  },

  dismiss: (id) => {
    set((state) => {
      const updated = state.notifications.map((n) => (n.id === id ? { ...n, dismissed: true } : n));
      return {
        notifications: updated,
        unreadCount: computeUnreadCount(updated),
        unreadByCategory: computeUnreadByCategory(updated),
        hasUrgentUnread: computeHasUrgent(updated),
      };
    });
  },

  dismissAll: (category) => {
    set((state) => {
      const updated = state.notifications.map((n) => {
        if (category && n.category !== category) return n;
        return { ...n, dismissed: true };
      });
      return {
        notifications: updated,
        unreadCount: computeUnreadCount(updated),
        unreadByCategory: computeUnreadByCategory(updated),
        hasUrgentUnread: computeHasUrgent(updated),
      };
    });
  },

  clearExpired: () => {
    set((state) => {
      const now = new Date();
      const updated = state.notifications.filter((n) => !n.expiresAt || n.expiresAt > now);
      return {
        notifications: updated,
        unreadCount: computeUnreadCount(updated),
        unreadByCategory: computeUnreadByCategory(updated),
        hasUrgentUnread: computeHasUrgent(updated),
      };
    });
  },

  setSSEConnected: (connected) => set({ sseConnected: connected }),
  setSSEError: (error) => set({ sseError: error }),

  setDropdownOpen: (open) => set({ isDropdownOpen: open }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),

  syncNotifications: (notifications) => {
    set({
      notifications,
      unreadCount: computeUnreadCount(notifications),
      unreadByCategory: computeUnreadByCategory(notifications),
      hasUrgentUnread: computeHasUrgent(notifications),
    });
  },
}));

export default useNotificationStore;
