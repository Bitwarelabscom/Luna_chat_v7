'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useNotificationStore, type NotificationCategory, getPriorityLevel } from '@/lib/notification-store';
import { type AppId } from '@/components/os/app-registry';

// SSE event types from the backend
interface TriggerEvent {
  type: 'connected' | 'ping' | 'new_message' | 'trigger_delivered' | 'notification';
  triggerId?: string;
  sessionId?: string;
  message?: string;
  timestamp: Date;
  // Extended notification payload
  notification?: {
    category: NotificationCategory;
    title: string;
    message: string;
    priority: number;
    eventType?: string;
    navigationTarget?: {
      appId: AppId;
      context?: Record<string, unknown>;
    };
  };
}

// Map backend event types to notification categories
function inferCategory(eventType: string): NotificationCategory {
  if (eventType.startsWith('trading.') || eventType.includes('trade') || eventType.includes('order')) {
    return 'trading';
  }
  if (eventType.startsWith('reminder.') || eventType.startsWith('calendar.') || eventType.includes('task')) {
    return 'reminders';
  }
  if (eventType.startsWith('email.') || eventType.includes('mail')) {
    return 'email';
  }
  if (eventType.startsWith('autonomous.') || eventType.includes('question') || eventType.includes('insight')) {
    return 'autonomous';
  }
  // Default to autonomous for Luna messages
  return 'autonomous';
}

// Map event types to navigation targets
function getNavigationTarget(eventType: string): { appId: AppId; context?: Record<string, unknown> } | undefined {
  const mappings: Record<string, { appId: AppId; context?: Record<string, unknown> }> = {
    // Trading
    'trading.stop_loss_triggered': { appId: 'trading', context: { tab: 'positions' } },
    'trading.take_profit_hit': { appId: 'trading', context: { tab: 'positions' } },
    'trading.order_filled': { appId: 'trading', context: { tab: 'trades' } },
    'trading.scalping_opportunity': { appId: 'trading', context: { tab: 'research' } },
    'trading.position_closed': { appId: 'trading', context: { tab: 'positions' } },
    // Reminders & Calendar
    'reminder.due': { appId: 'todo' },
    'calendar.event_soon': { appId: 'calendar' },
    'calendar.event_now': { appId: 'calendar' },
    'task.overdue': { appId: 'todo' },
    'task.due_soon': { appId: 'todo' },
    // Email
    'email.new': { appId: 'email' },
    'email.unread_count': { appId: 'email' },
    // Autonomous
    'autonomous.question': { appId: 'chat' },
    'autonomous.research_complete': { appId: 'activity' },
    'autonomous.insight_ready': { appId: 'activity' },
  };

  return mappings[eventType];
}

export function useNotificationStream() {
  const {
    addNotification,
    setSSEConnected,
    setSSEError,
    clearExpired,
  } = useNotificationStore();

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current || eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    isConnectingRef.current = true;

    // Use the existing SSE endpoint
    const eventSource = new EventSource('/luna-chat/api/triggers/live', {
      withCredentials: true,
    });

    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setSSEConnected(true);
      setSSEError(null);
      reconnectAttemptsRef.current = 0;
      isConnectingRef.current = false;
      console.log('[Notifications] SSE connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data: TriggerEvent = JSON.parse(event.data);

        // Handle different event types
        switch (data.type) {
          case 'connected':
            console.log('[Notifications] Connection confirmed');
            break;

          case 'ping':
            // Heartbeat - no action needed
            break;

          case 'new_message':
          case 'trigger_delivered': {
            // Convert legacy events to notifications
            const eventType = data.notification?.eventType || 'autonomous.message';
            const category = data.notification?.category || inferCategory(eventType);
            const priority = data.notification?.priority || 5;

            addNotification({
              category,
              title: data.notification?.title || 'New Message',
              message: data.notification?.message || data.message || 'You have a new notification',
              priority: getPriorityLevel(priority),
              priorityValue: priority,
              navigationTarget: data.notification?.navigationTarget || getNavigationTarget(eventType),
              sourceType: 'sse',
              sourceId: data.triggerId,
            });
            break;
          }

          case 'notification': {
            // Direct notification event (new format)
            if (data.notification) {
              const { category, title, message, priority, eventType, navigationTarget } = data.notification;
              addNotification({
                category,
                title,
                message,
                priority: getPriorityLevel(priority),
                priorityValue: priority,
                navigationTarget: navigationTarget || (eventType ? getNavigationTarget(eventType) : undefined),
                sourceType: 'sse',
                sourceId: data.triggerId,
              });
            }
            break;
          }
        }
      } catch (error) {
        console.error('[Notifications] Failed to parse SSE event:', error);
      }
    };

    eventSource.onerror = () => {
      setSSEConnected(false);
      isConnectingRef.current = false;
      eventSource.close();
      eventSourceRef.current = null;

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      reconnectAttemptsRef.current++;

      console.log(`[Notifications] SSE disconnected, reconnecting in ${delay}ms...`);
      setSSEError(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);

      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };
  }, [addNotification, setSSEConnected, setSSEError]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    isConnectingRef.current = false;
    setSSEConnected(false);
  }, [setSSEConnected]);

  useEffect(() => {
    connect();

    // Clear expired notifications periodically
    const cleanupInterval = setInterval(clearExpired, 60000);

    return () => {
      disconnect();
      clearInterval(cleanupInterval);
    };
  }, [connect, disconnect, clearExpired]);

  return {
    connect,
    disconnect,
    isConnected: useNotificationStore((state) => state.sseConnected),
    error: useNotificationStore((state) => state.sseError),
  };
}

export default useNotificationStream;
