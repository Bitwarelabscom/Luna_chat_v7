import { create } from 'zustand';
import { authApi, chatApi, type Session, type Message, type MessageMetrics } from './api';

interface User {
  id: string;
  email: string;
  displayName: string | null;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    const { user } = await authApi.login(email, password);
    set({ user, isAuthenticated: true });
  },

  register: async (email, password, displayName) => {
    const { user } = await authApi.register(email, password, displayName);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore errors
    }
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    try {
      const user = await authApi.me();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));

interface BrowserAction {
  type: 'open' | 'close';
  url?: string;
}

interface VideoAction {
  type: 'open';
  videos: Array<{ id: string; title: string; channelTitle: string; thumbnail: string; duration: string; isLive: boolean }>;
  query: string;
}

interface MediaAction {
  type: 'search' | 'play';
  items: Array<any>;
  query: string;
  source: 'youtube' | 'jellyfin' | 'local';
}

interface ChatState {
  sessions: Session[];
  archivedSessions: Session[];
  currentSession: (Session & { messages: Message[] }) | null;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  streamingContent: string;
  reasoningContent: string;  // For xAI Grok thinking output
  statusMessage: string;
  // Startup state
  startupSuggestions: string[];
  isLoadingStartup: boolean;
  // Browser action for visual browsing
  browserAction: BrowserAction | null;
  // Video action for YouTube search results
  videoAction: VideoAction | null;
  // Media action for Jellyfin/unified media
  mediaAction: MediaAction | null;

  loadSessions: () => Promise<void>;
  loadArchivedSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createSession: (mode?: 'assistant' | 'companion' | 'voice' | 'dj_luna') => Promise<Session>;
  archiveSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string, id: string, metrics?: MessageMetrics) => void;
  updateMessage: (id: string, content: string) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  setReasoningContent: (content: string) => void;
  appendReasoningContent: (content: string) => void;
  setIsSending: (isSending: boolean) => void;
  setStatusMessage: (status: string) => void;
  clearCurrentSession: () => void;
  removeMessagesFrom: (messageId: string) => void;
  // Startup actions
  setStartupSuggestions: (suggestions: string[]) => void;
  clearStartupSuggestions: () => void;
  setIsLoadingStartup: (loading: boolean) => void;
  // Browser action
  setBrowserAction: (action: BrowserAction | null) => void;
  // Video action
  setVideoAction: (action: VideoAction | null) => void;
  // Media action
  setMediaAction: (action: MediaAction | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  archivedSessions: [],
  currentSession: null,
  isLoadingSessions: false,
  isLoadingMessages: false,
  isSending: false,
  streamingContent: '',
  reasoningContent: '',
  statusMessage: '',
  startupSuggestions: [],
  isLoadingStartup: false,
  browserAction: null,
  videoAction: null,
  mediaAction: null,

  loadSessions: async () => {
    set({ isLoadingSessions: true });
    try {
      const { sessions } = await chatApi.getSessions({ limit: 50 });
      set({ sessions });
    } finally {
      set({ isLoadingSessions: false });
    }
  },

  loadArchivedSessions: async () => {
    try {
      const { sessions } = await chatApi.getSessions({ limit: 50, archived: true });
      set({ archivedSessions: sessions });
    } catch {
      // Ignore errors
    }
  },

  loadSession: async (id) => {
    set({ isLoadingMessages: true, streamingContent: '' });
    try {
      const session = await chatApi.getSession(id);
      set({ currentSession: session });
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  createSession: async (mode = 'assistant') => {
    const session = await chatApi.createSession({ mode });
    set((state) => ({
      sessions: [session, ...state.sessions],
    }));
    return session;
  },

  archiveSession: async (id) => {
    await chatApi.updateSession(id, { isArchived: true });
    set((state) => {
      const session = state.sessions.find((s) => s.id === id);
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        archivedSessions: session ? [{ ...session, isArchived: true }, ...state.archivedSessions] : state.archivedSessions,
        currentSession: state.currentSession?.id === id ? null : state.currentSession,
      };
    });
  },

  restoreSession: async (id) => {
    await chatApi.updateSession(id, { isArchived: false });
    set((state) => {
      const session = state.archivedSessions.find((s) => s.id === id);
      return {
        archivedSessions: state.archivedSessions.filter((s) => s.id !== id),
        sessions: session ? [{ ...session, isArchived: false }, ...state.sessions] : state.sessions,
      };
    });
  },

  deleteSession: async (id) => {
    await chatApi.deleteSession(id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      archivedSessions: state.archivedSessions.filter((s) => s.id !== id),
      currentSession: state.currentSession?.id === id ? null : state.currentSession,
    }));
  },

  renameSession: async (id, title) => {
    await chatApi.updateSession(id, { title });
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
      currentSession:
        state.currentSession?.id === id ? { ...state.currentSession, title } : state.currentSession,
    }));
  },

  addUserMessage: (content) => {
    const message: Message = {
      id: `temp-${Date.now()}`,
      sessionId: get().currentSession?.id || '',
      role: 'user',
      content,
      tokensUsed: 0,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      currentSession: state.currentSession
        ? { ...state.currentSession, messages: [...state.currentSession.messages, message] }
        : null,
    }));
  },

  addAssistantMessage: (content, id, metrics) => {
    const message: Message = {
      id,
      sessionId: get().currentSession?.id || '',
      role: 'assistant',
      content,
      tokensUsed: metrics?.promptTokens && metrics?.completionTokens
        ? metrics.promptTokens + metrics.completionTokens
        : 0,
      createdAt: new Date().toISOString(),
      metrics,
    };
    set((state) => ({
      currentSession: state.currentSession
        ? { ...state.currentSession, messages: [...state.currentSession.messages, message] }
        : null,
      streamingContent: '',
    }));
  },

  updateMessage: (id, content) => {
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            messages: state.currentSession.messages.map((m) =>
              m.id === id ? { ...m, content } : m
            ),
          }
        : null,
    }));
  },

  removeMessagesFrom: (messageId) => {
    set((state) => {
      if (!state.currentSession) return state;
      const idx = state.currentSession.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;
      return {
        currentSession: {
          ...state.currentSession,
          messages: state.currentSession.messages.slice(0, idx),
        },
      };
    });
  },

  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),
  setReasoningContent: (content) => set({ reasoningContent: content }),
  appendReasoningContent: (content) =>
    set((state) => ({ reasoningContent: state.reasoningContent + content })),
  setIsSending: (isSending) => set({ isSending }),
  setStatusMessage: (status) => set({ statusMessage: status }),
  clearCurrentSession: () => set({ currentSession: null, streamingContent: '', reasoningContent: '', statusMessage: '', startupSuggestions: [] }),
  // Startup actions
  setStartupSuggestions: (suggestions) => set({ startupSuggestions: suggestions }),
  clearStartupSuggestions: () => set({ startupSuggestions: [] }),
  setIsLoadingStartup: (loading) => set({ isLoadingStartup: loading }),
  // Browser action
  setBrowserAction: (action) => set({ browserAction: action }),
  // Video action
  setVideoAction: (action) => set({ videoAction: action }),
  setMediaAction: (action) => set({ mediaAction: action }),
}));
