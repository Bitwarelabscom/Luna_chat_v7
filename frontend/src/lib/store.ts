import { create } from 'zustand';
import { authApi, chatApi, type Session, type Message } from './api';

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
    const { user, accessToken, refreshToken } = await authApi.login(email, password);
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ user, isAuthenticated: true });
  },

  register: async (email, password, displayName) => {
    const { user, accessToken, refreshToken } = await authApi.register(email, password, displayName);
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore errors
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      const user = await authApi.me();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      set({ user: null, isAuthenticated: false, isLoading: false });
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
  createSession: (mode?: 'assistant' | 'companion') => Promise<Session>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string, id: string) => void;
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

  deleteSession: async (id) => {
    await chatApi.deleteSession(id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
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

  addAssistantMessage: (content, id) => {
    const message: Message = {
      id,
      sessionId: get().currentSession?.id || '',
      role: 'assistant',
      content,
      tokensUsed: 0,
      createdAt: new Date().toISOString(),
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
