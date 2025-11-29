// In production (empty NEXT_PUBLIC_API_URL), API calls go through nginx at /luna-chat/api
// In development, API calls go directly to the backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = API_URL ? '' : '/luna-chat';

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_URL}${API_PREFIX}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const token = await getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  let response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle token refresh
  if (response.status === 401 && token) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      const newToken = await getAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || 'Request failed');
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api<{
      user: { id: string; email: string; displayName: string | null };
      accessToken: string;
      refreshToken: string;
    }>('/api/auth/login', { method: 'POST', body: { email, password } }),

  register: (email: string, password: string, displayName?: string) =>
    api<{
      user: { id: string; email: string; displayName: string | null };
      accessToken: string;
      refreshToken: string;
    }>('/api/auth/register', { method: 'POST', body: { email, password, displayName } }),

  logout: () => api<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () =>
    api<{
      id: string;
      email: string;
      displayName: string | null;
      settings: Record<string, unknown>;
    }>('/api/auth/me'),
};

// Chat API
export interface Session {
  id: string;
  userId: string;
  title: string;
  mode: 'assistant' | 'companion';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokensUsed: number;
  createdAt: string;
}

export const chatApi = {
  getSessions: (params?: { limit?: number; offset?: number; archived?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.archived) searchParams.set('archived', 'true');
    const query = searchParams.toString();
    return api<{ sessions: Session[] }>(`/api/chat/sessions${query ? `?${query}` : ''}`);
  },

  getSession: (id: string) =>
    api<Session & { messages: Message[] }>(`/api/chat/sessions/${id}`),

  createSession: (data?: { title?: string; mode?: 'assistant' | 'companion' }) =>
    api<Session>('/api/chat/sessions', { method: 'POST', body: data || {} }),

  updateSession: (id: string, data: { title?: string; mode?: 'assistant' | 'companion'; isArchived?: boolean }) =>
    api<Session>(`/api/chat/sessions/${id}`, { method: 'PATCH', body: data }),

  deleteSession: (id: string) =>
    api<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),

  sendMessage: (sessionId: string, message: string) =>
    api<{ messageId: string; content: string; tokensUsed: number }>(`/api/chat/sessions/${sessionId}/send`, {
      method: 'POST',
      body: { message, stream: false },
    }),
};

// Streaming helper
export async function* streamMessage(
  sessionId: string,
  message: string
): AsyncGenerator<{ type: 'content' | 'done' | 'status'; content?: string; status?: string; messageId?: string }> {
  const token = await getAccessToken();

  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/sessions/${sessionId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, stream: true }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to send message');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Settings API
export interface SavedPrompt {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  basePrompt: string;
  assistantAdditions: string | null;
  companionAdditions: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserStats {
  tokens: {
    total: number;
    thisMonth: number;
    thisWeek: number;
    today: number;
    byModel: Record<string, number>;
  };
  memory: {
    totalFacts: number;
    activeFacts: number;
    factsByCategory: Record<string, number>;
    totalEmbeddings: number;
    totalSummaries: number;
  };
  sessions: {
    total: number;
    archived: number;
    totalMessages: number;
  };
}

export interface BackupData {
  version: string;
  exportedAt: string;
  user: {
    email: string;
    displayName: string | null;
    settings: Record<string, unknown>;
  };
  savedPrompts: SavedPrompt[];
  sessions: Array<{
    id: string;
    title: string;
    mode: string;
    createdAt: string;
    messages: Array<{
      role: string;
      content: string;
      createdAt: string;
    }>;
  }>;
  facts: Array<{
    category: string;
    factKey: string;
    factValue: string;
    confidence: number;
  }>;
  conversationSummaries: Array<{
    sessionId: string;
    summary: string;
    topics: string[];
    sentiment: string;
    keyPoints: string[];
  }>;
}

// Model Configuration Types
export interface LLMProvider {
  id: string;
  name: string;
  enabled: boolean;
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    bestFor: string[];
  }>;
}

export interface TaskModelConfig {
  taskType: string;
  displayName: string;
  description: string;
  defaultProvider: string;
  defaultModel: string;
}

export interface UserModelConfig {
  taskType: string;
  provider: string;
  model: string;
}

export const settingsApi = {
  // Prompts
  getDefaultPrompts: () =>
    api<{ basePrompt: string; assistantMode: string; companionMode: string }>('/api/settings/prompts/defaults'),

  getSavedPrompts: () =>
    api<{ prompts: SavedPrompt[] }>('/api/settings/prompts'),

  getActivePrompt: () =>
    api<{ prompt: SavedPrompt | null }>('/api/settings/prompts/active'),

  setActivePrompt: (promptId: string | null) =>
    api<{ success: boolean }>('/api/settings/prompts/active', { method: 'PUT', body: { promptId } }),

  createPrompt: (data: {
    name: string;
    description?: string;
    basePrompt: string;
    assistantAdditions?: string;
    companionAdditions?: string;
    isDefault?: boolean;
  }) => api<{ prompt: SavedPrompt }>('/api/settings/prompts', { method: 'POST', body: data }),

  updatePrompt: (id: string, data: {
    name?: string;
    description?: string;
    basePrompt?: string;
    assistantAdditions?: string;
    companionAdditions?: string;
    isDefault?: boolean;
  }) => api<{ prompt: SavedPrompt }>(`/api/settings/prompts/${id}`, { method: 'PATCH', body: data }),

  deletePrompt: (id: string) =>
    api<{ success: boolean }>(`/api/settings/prompts/${id}`, { method: 'DELETE' }),

  // Stats
  getStats: () =>
    api<{ stats: UserStats }>('/api/settings/stats'),

  // Backup & Restore
  exportData: () =>
    api<BackupData>('/api/settings/backup'),

  importData: (data: BackupData) =>
    api<{ imported: { sessions: number; facts: number; prompts: number } }>('/api/settings/restore', { method: 'POST', body: data }),

  // Clear Data
  clearMemory: () =>
    api<{ deleted: { facts: number; embeddings: number; summaries: number } }>('/api/settings/memory', { method: 'DELETE' }),

  clearAllData: () =>
    api<{ deleted: { sessions: number; messages: number; facts: number; embeddings: number; summaries: number; prompts: number } }>('/api/settings/all-data', { method: 'DELETE' }),

  // Model Configuration
  getAvailableModels: () =>
    api<{ providers: LLMProvider[]; tasks: TaskModelConfig[] }>('/api/settings/models/available'),

  getUserModelConfigs: () =>
    api<{ configs: UserModelConfig[] }>('/api/settings/models'),

  setModelConfig: (taskType: string, provider: string, model: string) =>
    api<{ success: boolean }>(`/api/settings/models/${encodeURIComponent(taskType)}`, {
      method: 'PUT',
      body: { provider, model },
    }),

  resetModelConfigs: () =>
    api<{ success: boolean }>('/api/settings/models', { method: 'DELETE' }),
};

export { ApiError };
