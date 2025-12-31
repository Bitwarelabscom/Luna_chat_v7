'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useActivityStore, type Activity, type ActivityCategory, type ActivityLevel } from '@/lib/activity-store';

// SSE event types from the backend
interface SSEEvent {
  type: 'connected' | 'ping' | 'new_message' | 'trigger_delivered' | 'notification' | 'activity';
  timestamp: Date;
  activity?: {
    id: string;
    category: ActivityCategory;
    eventType: string;
    level: ActivityLevel;
    title: string;
    message?: string;
    details?: Record<string, unknown>;
    source?: string;
    durationMs?: number;
    sessionId?: string;
    turnId?: string;
    createdAt: string | Date;
  };
}

interface UseActivityStreamOptions {
  // Whether to auto-connect on mount
  autoConnect?: boolean;
  // Fetch historical activities on connect
  fetchHistory?: boolean;
  // Max historical items to fetch
  historyLimit?: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_BASE = `${API_URL}/api`;

export function useActivityStream(options: UseActivityStreamOptions = {}) {
  const {
    autoConnect = true,
    fetchHistory = true,
    historyLimit = 200, // Increased from 50 for better history visibility
  } = options;

  const {
    addActivity,
    loadActivities,
    setSSEConnected,
    setSSEError,
    setTodayStats,
  } = useActivityStore();

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch historical activities from API
  const fetchActivities = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/activity?limit=${historyLimit}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.status}`);
      }

      const data = await response.json();

      if (data.activities) {
        const normalized: Activity[] = data.activities.map((a: Activity) => ({
          ...a,
          createdAt: new Date(a.createdAt),
        }));
        loadActivities(normalized);
      }

      // Update today stats if provided
      if (data.todayStats) {
        setTodayStats(data.todayStats);
      }
    } catch (error) {
      console.error('[Activity] Failed to fetch history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [historyLimit, loadActivities, setTodayStats]);

  // Connect to SSE stream
  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current || eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    isConnectingRef.current = true;

    // Use the existing triggers/live SSE endpoint (activity events are sent there)
    const eventSource = new EventSource(`${API_BASE}/triggers/live`, {
      withCredentials: true,
    });

    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setSSEConnected(true);
      setSSEError(null);
      reconnectAttemptsRef.current = 0;
      isConnectingRef.current = false;
      console.log('[Activity] SSE connected');

      // Fetch historical activities after connect
      if (fetchHistory) {
        fetchActivities();
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);

        // Handle activity events
        if (data.type === 'activity' && data.activity) {
          const activity: Activity = {
            ...data.activity,
            createdAt: new Date(data.activity.createdAt),
          };
          addActivity(activity);
        }

        // Connected/ping events - no action needed for activity stream
      } catch (error) {
        console.error('[Activity] Failed to parse SSE event:', error);
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

      console.log(`[Activity] SSE disconnected, reconnecting in ${delay}ms...`);
      setSSEError(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);

      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };
  }, [addActivity, fetchActivities, fetchHistory, setSSEConnected, setSSEError]);

  // Disconnect from SSE
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

  // Refresh activities from API
  const refresh = useCallback(async () => {
    await fetchActivities();
  }, [fetchActivities]);

  // Clear all activities (API + local)
  const clearAll = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/activity`, {
        method: 'DELETE',
        credentials: 'include',
      });
      useActivityStore.getState().clearActivities();
    } catch (error) {
      console.error('[Activity] Failed to clear activities:', error);
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    connect,
    disconnect,
    refresh,
    clearAll,
    isLoading,
    isConnected: useActivityStore((state) => state.sseConnected),
    error: useActivityStore((state) => state.sseError),
    activities: useActivityStore((state) => state.activities),
    filteredActivities: useActivityStore.getState().getFilteredActivities(),
    todayStats: useActivityStore((state) => state.todayStats),
  };
}

export default useActivityStream;
