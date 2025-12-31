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
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async () => {
    // Auto-login for trusted local network - no credentials needed
    const { user } = await authApi.autoLogin();
    set({ user, isAuthenticated: true, isLoading: false });
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
      // If not authenticated, try auto-login
      try {
        const { user } = await authApi.autoLogin();
        set({ user, isAuthenticated: true, isLoading: false });
      } catch {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    }
  },
}));

interface ChatState {
  sessions: Session[];
  currentSession: (Session & { messages: Message[] }) | null;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  streamingContent: string;
  statusMessage: string;

  loadSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createSession: (mode?: 'assistant' | 'companion' | 'voice') => Promise<Session>;
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string, id: string, metrics?: MessageMetrics) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  setIsSending: (isSending: boolean) => void;
  setStatusMessage: (status: string) => void;
  clearCurrentSession: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSession: null,
  isLoadingSessions: false,
  isLoadingMessages: false,
  isSending: false,
  streamingContent: '',
  statusMessage: '',

  loadSessions: async () => {
    set({ isLoadingSessions: true });
    try {
      const { sessions } = await chatApi.getSessions({ limit: 50 });
      set({ sessions });
    } finally {
      set({ isLoadingSessions: false });
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

  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),
  setIsSending: (isSending) => set({ isSending }),
  setStatusMessage: (status) => set({ statusMessage: status }),
  clearCurrentSession: () => set({ currentSession: null, streamingContent: '', statusMessage: '' }),
}));
