'use client';

import { create } from 'zustand';

// Activity categories matching backend
export type ActivityCategory =
  | 'llm_call'
  | 'tool_invoke'
  | 'memory_op'
  | 'state_event'
  | 'error'
  | 'background'
  | 'system';

export type ActivityLevel = 'info' | 'success' | 'warn' | 'error';

export interface Activity {
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
  createdAt: Date;
}

// Category display configuration
export const categoryConfig: Record<ActivityCategory, { label: string; icon: string; color: string }> = {
  llm_call: { label: 'LLM Call', icon: 'brain', color: 'purple' },
  tool_invoke: { label: 'Tool', icon: 'wrench', color: 'blue' },
  memory_op: { label: 'Memory', icon: 'database', color: 'green' },
  state_event: { label: 'State', icon: 'layers', color: 'amber' },
  error: { label: 'Error', icon: 'alert-circle', color: 'red' },
  background: { label: 'Background', icon: 'activity', color: 'gray' },
  system: { label: 'System', icon: 'settings', color: 'slate' },
};

// Level display configuration
export const levelConfig: Record<ActivityLevel, { color: string; bg: string }> = {
  info: { color: 'text-blue-400', bg: 'bg-blue-400/10' },
  success: { color: 'text-green-400', bg: 'bg-green-400/10' },
  warn: { color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  error: { color: 'text-red-400', bg: 'bg-red-400/10' },
};

interface ActivityState {
  activities: Activity[];
  maxItems: number;

  // SSE connection state
  sseConnected: boolean;
  sseError: string | null;

  // Filter state
  activeFilter: ActivityCategory | 'all';
  levelFilter: ActivityLevel | 'all';
  searchQuery: string;

  // Stats
  todayStats: {
    llmCalls: number;
    totalTokens: number;
    totalCost: number;
  };

  // Actions
  addActivity: (activity: Omit<Activity, 'id'> & { id?: string }) => void;
  clearActivities: () => void;
  setSSEConnected: (connected: boolean) => void;
  setSSEError: (error: string | null) => void;
  setActiveFilter: (filter: ActivityCategory | 'all') => void;
  setLevelFilter: (filter: ActivityLevel | 'all') => void;
  setSearchQuery: (query: string) => void;
  setTodayStats: (stats: ActivityState['todayStats']) => void;

  // Bulk load (from API)
  loadActivities: (activities: Activity[]) => void;

  // Computed getters (as functions for use outside hooks)
  getFilteredActivities: () => Activity[];
}

function generateId(): string {
  return `act-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  maxItems: 200,
  sseConnected: false,
  sseError: null,
  activeFilter: 'all',
  levelFilter: 'all',
  searchQuery: '',
  todayStats: {
    llmCalls: 0,
    totalTokens: 0,
    totalCost: 0,
  },

  addActivity: (activity) => {
    const newActivity: Activity = {
      ...activity,
      id: activity.id || generateId(),
      createdAt: activity.createdAt instanceof Date
        ? activity.createdAt
        : new Date(activity.createdAt),
    };

    set((state) => {
      // Avoid duplicates by id
      if (state.activities.some((a) => a.id === newActivity.id)) {
        return state;
      }

      // Add to front, keep max items
      const updated = [newActivity, ...state.activities].slice(0, state.maxItems);

      // Update today stats if LLM call
      let todayStats = state.todayStats;
      if (activity.category === 'llm_call' && activity.details) {
        const details = activity.details as {
          inputTokens?: number;
          outputTokens?: number;
          cost?: number
        };
        todayStats = {
          llmCalls: todayStats.llmCalls + 1,
          totalTokens: todayStats.totalTokens + (details.inputTokens || 0) + (details.outputTokens || 0),
          totalCost: todayStats.totalCost + (details.cost || 0),
        };
      }

      return {
        activities: updated,
        todayStats,
      };
    });
  },

  clearActivities: () => {
    set({ activities: [] });
  },

  setSSEConnected: (connected) => set({ sseConnected: connected }),
  setSSEError: (error) => set({ sseError: error }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setLevelFilter: (filter) => set({ levelFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setTodayStats: (stats) => set({ todayStats: stats }),

  loadActivities: (activities) => {
    const normalized = activities.map((a) => ({
      ...a,
      createdAt: a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt),
    }));
    set({ activities: normalized });
  },

  getFilteredActivities: () => {
    const state = get();
    return state.activities.filter((activity) => {
      // Category filter
      if (state.activeFilter !== 'all' && activity.category !== state.activeFilter) {
        return false;
      }
      // Level filter
      if (state.levelFilter !== 'all' && activity.level !== state.levelFilter) {
        return false;
      }
      // Search filter
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        const matchTitle = activity.title.toLowerCase().includes(query);
        const matchMessage = activity.message?.toLowerCase().includes(query);
        const matchSource = activity.source?.toLowerCase().includes(query);
        if (!matchTitle && !matchMessage && !matchSource) {
          return false;
        }
      }
      return true;
    });
  },
}));

export default useActivityStore;
