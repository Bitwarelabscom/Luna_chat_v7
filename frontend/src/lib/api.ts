import type { DisplayContent } from '@/types/display';

// In production (empty NEXT_PUBLIC_API_URL), API calls go through nginx at /api
// In development, API calls go directly to the backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '';

// Export prefix for static media URLs
export const getMediaUrl = (path: string): string => {
  // If path already has prefix or is absolute URL, return as-is
  if (path.startsWith(API_PREFIX) || path.startsWith('http')) {
    return path;
  }
  return `${API_PREFIX}${path}`;
};

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  let response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  // Handle token refresh
  if (response.status === 401) {
    const refreshed = await fetch(`${API_URL}${API_PREFIX}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken: null }), // body ignored if cookie exists
    }).then(r => r.ok).catch(() => false);

    if (refreshed) {
      response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
      });
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || 'Request failed', error.code);
  }

  // Handle 204 No Content (e.g., DELETE responses)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api<{
      user: { id: string; email: string; displayName: string | null };
    }>('/api/auth/login', { method: 'POST', body: { email, password } }),

  register: (email: string, password: string, displayName?: string) =>
    api<{
      user: { id: string; email: string; displayName: string | null };
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
  mode: 'assistant' | 'companion' | 'voice';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LLMCallBreakdown {
  node: string;      // plan, draft, critique, repair
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  cost: number;
  durationMs?: number;
}

export interface RouteInfo {
  route: 'nano' | 'pro' | 'pro+tools';
  confidence: 'estimate' | 'verified';
  class: 'chat' | 'transform' | 'factual' | 'actionable';
}

export interface MessageMetrics {
  promptTokens: number;
  completionTokens: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  toolsUsed: string[];
  model: string;
  // Layered agent breakdown
  llmBreakdown?: LLMCallBreakdown[];
  totalCost?: number;
  // Router-First Architecture provenance
  routeInfo?: RouteInfo;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokensUsed: number;
  createdAt: string;
  metrics?: MessageMetrics;
}

export interface StartupResponse {
  message: Message;
  suggestions: string[];
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

  createSession: (data?: { title?: string; mode?: 'assistant' | 'companion' | 'voice' }) =>
    api<Session>('/api/chat/sessions', { method: 'POST', body: data || {} }),

  updateSession: (id: string, data: { title?: string; mode?: 'assistant' | 'companion' | 'voice'; isArchived?: boolean }) =>
    api<Session>(`/api/chat/sessions/${id}`, { method: 'PATCH', body: data }),

  deleteSession: (id: string) =>
    api<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),

  // End session and trigger memory consolidation (called on browser close)
  endSession: (id: string) =>
    api<{ success: boolean }>(`/api/chat/sessions/${id}/end`, { method: 'POST' }),

  sendMessage: (sessionId: string, message: string) =>
    api<{ messageId: string; content: string; tokensUsed: number }>(`/api/chat/sessions/${sessionId}/send`, {
      method: 'POST',
      body: { message, stream: false },
    }),

  editMessage: (sessionId: string, messageId: string, content: string) =>
    api<Message>(`/api/chat/sessions/${sessionId}/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    }),

  getSessionStartup: (sessionId: string) =>
    api<StartupResponse>(`/api/chat/sessions/${sessionId}/startup`, { method: 'POST' }),
};

// Streaming helper
export async function* streamMessage(
  sessionId: string,
  message: string
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action' | 'reasoning' | 'background_refresh'; content?: string; status?: string; messageId?: string; metrics?: MessageMetrics; action?: string; url?: string }> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/sessions/${sessionId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
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

// Regenerate message streaming helper
export async function* regenerateMessage(
  sessionId: string,
  messageId: string
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'reasoning'; content?: string; status?: string; messageId?: string; metrics?: MessageMetrics }> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/sessions/${sessionId}/messages/${messageId}/regenerate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to regenerate message');
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

// TTS helper - returns audio blob
export async function synthesizeSpeech(text: string): Promise<Blob> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'TTS failed' }));
    throw new ApiError(response.status, error.error || 'TTS failed');
  }

  return response.blob();
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

export interface DailyTokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<string, { input: number; output: number; cache: number; total: number; cost: number }>;
}

export interface ModelPeriodStats {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  cost: number;
}

export interface EnhancedStats {
  tokens: {
    today: ModelPeriodStats;
    thisWeek: ModelPeriodStats;
    thisMonth: ModelPeriodStats;
    total: ModelPeriodStats;
  };
  byModel: Record<string, {
    today: ModelPeriodStats;
    thisWeek: ModelPeriodStats;
    thisMonth: ModelPeriodStats;
    total: ModelPeriodStats;
  }>;
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
    costPer1kInput?: number;
    costPer1kOutput?: number;
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

// TTS Settings Types
export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TtsSettings {
  engine: 'elevenlabs' | 'openai';
  openaiVoice: OpenAIVoice;
}

// Coder Settings Types
export type ProviderId = 'openai' | 'groq' | 'anthropic' | 'xai' | 'openrouter' | 'ollama' | 'google';

export interface TriggerWords {
  claude: string[];
  gemini: string[];
  api: string[];
}

export interface CoderSettings {
  userId: string;
  claudeCliEnabled: boolean;
  geminiCliEnabled: boolean;
  coderApiEnabled: boolean;
  coderApiProvider: ProviderId | null;
  coderApiModel: string | null;
  triggerWords: TriggerWords;
  defaultCoder: 'claude' | 'gemini' | 'api';
}

export type ThemeType = 'dark' | 'retro' | 'light' | 'cyberpunk' | 'nord' | 'solarized';

export type TimeFormat = '12h' | '24h';
export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type UnitSystem = 'metric' | 'imperial';

export interface UserSettings {
  theme?: ThemeType;
  crtFlicker?: boolean;
  language?: string;
  notifications?: boolean;
  defaultMode?: 'assistant' | 'companion' | 'voice';
  // Locale settings
  timeFormat?: TimeFormat;
  dateFormat?: DateFormat;
  unitSystem?: UnitSystem;
  currency?: string;
  timezone?: string;
}

// System Metrics Types
export interface SystemMetrics {
  cpu: {
    percent: number;
    cores: number;
    model: string;
    loadAvg: number[];
  };
  memory: {
    percent: number;
    total: number;
    used: number;
    free: number;
  };
  network: {
    rx: number;
    tx: number;
  };
  uptime: number;
  platform: string;
  hostname: string;
}

export const settingsApi = {
  // System Metrics
  getSystemMetrics: () =>
    api<SystemMetrics>('/api/settings/system'),

  // User Settings
  updateUserSettings: (settings: UserSettings) =>
    api<{ success: boolean; settings: UserSettings }>('/api/settings/user', { method: 'PUT', body: settings }),

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

  // Daily token usage (for header display, resets at midnight)
  getDailyTokens: () =>
    api<DailyTokenStats>('/api/settings/daily-tokens'),

  // Enhanced stats with model breakdown by time period and costs
  getEnhancedStats: () =>
    api<{ stats: EnhancedStats }>('/api/settings/enhanced-stats'),

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
    api<{ providers: LLMProvider[]; tasks: TaskModelConfig[]; source?: string }>('/api/settings/models/live'),

  getStaticModels: () =>
    api<{ providers: LLMProvider[]; tasks: TaskModelConfig[] }>('/api/settings/models/available'),

  refreshModels: () =>
    api<{ success: boolean; providers: LLMProvider[]; tasks: TaskModelConfig[] }>('/api/settings/models/refresh', { method: 'POST' }),

  getUserModelConfigs: () =>
    api<{ configs: UserModelConfig[] }>('/api/settings/models'),

  setModelConfig: (taskType: string, provider: string, model: string) =>
    api<{ success: boolean }>(`/api/settings/models/${encodeURIComponent(taskType)}`, {
      method: 'PUT',
      body: { provider, model },
    }),

  resetModelConfigs: () =>
    api<{ success: boolean }>('/api/settings/models', { method: 'DELETE' }),

  // TTS Settings
  getTtsSettings: () =>
    api<{ settings: TtsSettings; availableVoices: string[] }>('/api/settings/tts'),

  updateTtsSettings: (settings: Partial<TtsSettings>) =>
    api<{ success: boolean; settings: TtsSettings }>('/api/settings/tts', { method: 'PUT', body: settings }),

  // Coder Settings
  getCoderSettings: () =>
    api<CoderSettings>('/api/settings/coder'),

  updateCoderSettings: (updates: Partial<Omit<CoderSettings, 'userId'>>) =>
    api<CoderSettings>('/api/settings/coder', { method: 'PUT', body: updates }),

  resetCoderSettings: () =>
    api<{ success: boolean }>('/api/settings/coder', { method: 'DELETE' }),
};

// Integrations API
export interface OAuthConnection {
  provider: string;
  connected: boolean;
  email?: string;
  expiresAt?: string;
}

export interface EmailStatus {
  enabled: boolean;
  smtp: { configured: boolean; connected: boolean };
  imap: { configured: boolean; connected: boolean };
  approvedRecipients: string[];
}

export const integrationsApi = {
  getOAuthStatus: () =>
    api<{ connections: OAuthConnection[] }>('/api/integrations/oauth/status'),

  disconnectOAuth: (provider: string) =>
    api<{ success: boolean }>(`/api/integrations/oauth/${provider}`, { method: 'DELETE' }),

  getEmailStatus: () =>
    api<EmailStatus>('/api/email/status'),
};

// Luna Media API (Videos + Generated Images)
export interface LunaMediaSelection {
  type: 'video' | 'image';
  url: string;
  mood: string;
  trigger?: string;
  isSpecial?: boolean;
  loopSet?: string;
}

export interface AvatarState {
  currentSet: string;
  lastVideoIndex: number;
  isPlayingSpecial: boolean;
  specialQueue: string[];
}

export const lunaMediaApi = {
  selectMedia: (response: string, mood: string) =>
    api<LunaMediaSelection>(`/api/abilities/luna/media?response=${encodeURIComponent(response)}&mood=${encodeURIComponent(mood)}`),

  getVideos: () =>
    api<{ videos: string[] }>('/api/abilities/luna/videos'),

  getCachedImages: () =>
    api<{ images: string[] }>('/api/abilities/luna/cached-images'),

  generateImage: (mood: string) =>
    api<{ url: string; cached: boolean; generated_at: string }>('/api/abilities/luna/generate-image', {
      method: 'POST',
      body: { mood },
    }),

  // Avatar (loop-based video system)
  getAvatarState: () =>
    api<{ state: AvatarState }>('/api/abilities/luna/avatar/state'),

  getNextVideo: (set?: string) =>
    api<LunaMediaSelection>(`/api/abilities/luna/avatar/next${set ? `?set=${set}` : ''}`),

  getLoopSets: () =>
    api<{ loopSets: Record<string, number> }>('/api/abilities/luna/avatar/loop-sets'),

  getSpecialGestures: () =>
    api<{ specials: string[] }>('/api/abilities/luna/avatar/specials'),

  queueSpecialGesture: (gesture: string) =>
    api<{ queued: boolean; video: LunaMediaSelection }>('/api/abilities/luna/avatar/special', {
      method: 'POST',
      body: { gesture },
    }),

  finishSpecialGesture: () =>
    api<{ success: boolean }>('/api/abilities/luna/avatar/special/finish', {
      method: 'POST',
    }),

  setMood: (mood: string) =>
    api<{ loopSet: string }>('/api/abilities/luna/avatar/mood', {
      method: 'POST',
      body: { mood },
    }),
};

// Email API
export interface Email {
  id: string;
  uid?: number;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  read: boolean;
}

export const emailApi = {
  getInbox: (limit = 10) =>
    api<{ emails: Email[] }>(`/api/email/inbox?limit=${limit}`),

  getUnread: () =>
    api<{ count: number; emails: Email[] }>('/api/email/unread'),

  getStatus: () =>
    api<EmailStatus>('/api/email/status'),

  getEmail: (uid: number) =>
    api<{ email: Email }>(`/api/email/${uid}`),

  deleteEmail: (uid: number) =>
    api<{ message: string; uid: number }>(`/api/email/${uid}`, { method: 'DELETE' }),

  markRead: (uid: number, isRead: boolean) =>
    api<{ message: string; uid: number; isRead: boolean }>(`/api/email/${uid}/read`, {
      method: 'PUT',
      body: JSON.stringify({ isRead }),
    }),

  reply: (uid: number, body: string) =>
    api<{ message: string; messageId?: string }>(`/api/email/${uid}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};

// Workspace API
export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStats {
  totalFiles: number;
  totalSize: number;
  scripts: number;
}

export const workspaceApi = {
  listFiles: () =>
    api<WorkspaceFile[]>('/api/abilities/workspace'),

  getStats: () =>
    api<WorkspaceStats>('/api/abilities/workspace/stats'),

  getFile: (filename: string) =>
    api<{ content: string; filename: string }>(`/api/abilities/workspace/file/${encodeURIComponent(filename)}`),

  createFile: (filename: string, content: string) =>
    api<{ success: boolean; filename: string }>('/api/abilities/workspace', { method: 'POST', body: { filename, content } }),

  updateFile: (filename: string, content: string) =>
    api<WorkspaceFile>(`/api/abilities/workspace/file/${encodeURIComponent(filename)}`, { method: 'PUT', body: { content } }),

  deleteFile: (filename: string) =>
    api<{ success: boolean }>(`/api/abilities/workspace/file/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  // Upload requires FormData - use uploadFile helper below
};

// Upload workspace file using FormData
export async function uploadWorkspaceFile(file: File): Promise<WorkspaceFile> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}${API_PREFIX}/api/abilities/workspace/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new ApiError(response.status, error.error || 'Upload failed');
  }

  return response.json();
}

// Documents API
export interface Document {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  chunksCount: number;
}

export const documentsApi = {
  list: () =>
    api<{ documents: Document[] }>('/api/abilities/documents'),

  delete: (id: string) =>
    api<{ success: boolean }>(`/api/abilities/documents/${id}`, { method: 'DELETE' }),

  // Upload requires FormData, handle separately
};

// Calendar API
export interface CalendarEvent {
  id: string;
  externalId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  location?: string;
  isAllDay: boolean;
  reminderMinutes?: number | null;
}

export interface CalendarStatus {
  enabled: boolean;
  connected: boolean;
  eventCount: number;
  lastSync: string | null;
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  location?: string;
  isAllDay?: boolean;
  reminderMinutes?: number | null;
}

export const calendarApi = {
  getEvents: (days = 7, limit = 20) =>
    api<{ events: CalendarEvent[] }>(`/api/abilities/calendar/events?days=${days}&limit=${limit}`),

  getToday: () =>
    api<{ events: CalendarEvent[] }>('/api/abilities/calendar/today'),

  getConnections: () =>
    api<{ connections: { id: string; provider: string; isActive: boolean }[] }>('/api/abilities/calendar/connections'),

  getStatus: () =>
    api<CalendarStatus>('/api/abilities/calendar/status'),

  getEvent: (id: string) =>
    api<CalendarEvent>(`/api/abilities/calendar/events/${id}`),

  createEvent: (input: CreateCalendarEventInput) =>
    api<CalendarEvent>('/api/abilities/calendar/events', {
      method: 'POST',
      body: input,
    }),

  updateEvent: (id: string, input: Partial<CreateCalendarEventInput>) =>
    api<CalendarEvent>(`/api/abilities/calendar/events/${id}`, {
      method: 'PUT',
      body: input,
    }),

  deleteEvent: (id: string) =>
    api<void>(`/api/abilities/calendar/events/${id}`, {
      method: 'DELETE',
    }),
};

// Tasks API
export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export const tasksApi = {
  list: () =>
    api<{ tasks: Task[] }>('/api/abilities/tasks'),

  create: (data: { title: string; description?: string; priority?: string; dueDate?: string }) =>
    api<{ task: Task }>('/api/abilities/tasks', { method: 'POST', body: data }),

  update: (id: string, data: { title?: string; description?: string; priority?: string; dueDate?: string }) =>
    api<{ task: Task }>(`/api/abilities/tasks/${id}`, { method: 'PUT', body: data }),

  updateStatus: (id: string, status: string) =>
    api<{ task: Task }>(`/api/abilities/tasks/${id}/status`, { method: 'PUT', body: { status } }),

  delete: (id: string) =>
    api<{ success: boolean }>(`/api/abilities/tasks/${id}`, { method: 'DELETE' }),
};

// Autonomous Mode API
export interface AutonomousConfig {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  sessionIntervalMinutes: number;
  maxDailySessions: number;
  rssCheckIntervalMinutes: number;
  idleTimeoutMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousSession {
  id: string;
  userId: string;
  status: 'active' | 'completed' | 'paused' | 'failed';
  currentPhase: 'polaris' | 'aurora' | 'vega' | 'sol' | 'act' | null;
  startedAt: string;
  endedAt: string | null;
  sessionType: string;
  summary: string | null;
  insightsGenerated: string[];
  loopCount: number;
  createdAt: string;
}

export interface AutonomousStatus {
  status: 'active' | 'inactive';
  currentSession: AutonomousSession | null;
  config: AutonomousConfig | null;
  todaySessionCount: number;
}

export interface CouncilMember {
  id: string;
  name: string;
  displayName: string;
  role: string;
  personality: string;
  functionDescription: string;
  avatarEmoji: string;
  color: string;
  loopOrder: number;
}

export interface CouncilDeliberation {
  id: string;
  autonomousSessionId: string;
  userId: string;
  topic: string;
  loopNumber: number;
  conversationData: Array<{
    speaker: string;
    message: string;
    timestamp: string;
    phase: string;
  }>;
  participants: string[];
  summary: string | null;
  decision: string | null;
  actionTaken: string | null;
  insights: string[];
  createdAt: string;
}

export interface Goal {
  id: string;
  userId: string;
  goalType: 'user_focused' | 'self_improvement' | 'relationship' | 'research';
  title: string;
  description: string | null;
  targetMetric: { type: string; target: number; current: number } | null;
  status: 'active' | 'completed' | 'paused' | 'abandoned';
  priority: number;
  dueDate: string | null;
  parentGoalId: string | null;
  createdBy: 'luna' | 'user';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Achievement {
  id: string;
  userId: string;
  goalId: string | null;
  title: string;
  description: string | null;
  achievementType: 'goal_completed' | 'milestone' | 'discovery' | 'improvement' | 'insight';
  journalEntry: string | null;
  metadata: Record<string, unknown> | null;
  celebrated: boolean;
  createdAt: string;
}

export interface RssFeed {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  category: string | null;
  isActive: boolean;
  lastChecked: string | null;
  lastError: string | null;
  errorCount: number;
  createdAt: string;
}

export interface RssArticle {
  id: string;
  feedId: string;
  userId: string;
  title: string;
  url: string | null;
  summary: string | null;
  lunaSummary: string | null;
  relevanceScore: number;
  relevanceReason: string | null;
  isInteresting: boolean;
  sharedWithUser: boolean;
  publishedAt: string | null;
  fetchedAt: string;
}

export interface ProactiveInsight {
  id: string;
  userId: string;
  sourceType: 'council_deliberation' | 'rss_article' | 'goal_progress' | 'pattern_discovery' | 'achievement';
  sourceId: string | null;
  insightTitle: string;
  insightContent: string;
  priority: number;
  expiresAt: string | null;
  sharedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export const autonomousApi = {
  // Status & Control
  getStatus: () =>
    api<AutonomousStatus>('/api/autonomous/status'),

  start: (data?: { taskDescription?: string }) =>
    api<{ success: boolean; session: AutonomousSession }>('/api/autonomous/start', { method: 'POST', body: data || {} }),

  stop: () =>
    api<{ success: boolean; session: AutonomousSession | null }>('/api/autonomous/stop', { method: 'POST' }),

  // Configuration
  getConfig: () =>
    api<{ config: AutonomousConfig }>('/api/autonomous/config'),

  updateConfig: (config: Partial<Omit<AutonomousConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>) =>
    api<{ config: AutonomousConfig }>('/api/autonomous/config', { method: 'PUT', body: config }),

  // Sessions
  getSessions: (limit = 20, offset = 0) =>
    api<{ sessions: AutonomousSession[] }>(`/api/autonomous/sessions?limit=${limit}&offset=${offset}`),

  getSession: (id: string) =>
    api<AutonomousSession>(`/api/autonomous/sessions/${id}`),

  // Council
  getCouncilMembers: () =>
    api<{ members: CouncilMember[] }>('/api/autonomous/council'),

  // Deliberations
  getDeliberations: (limit = 10, offset = 0) =>
    api<{ deliberations: CouncilDeliberation[] }>(`/api/autonomous/deliberations?limit=${limit}&offset=${offset}`),

  getDeliberation: (id: string) =>
    api<CouncilDeliberation>(`/api/autonomous/deliberations/${id}`),

  getSessionDeliberations: (sessionId: string) =>
    api<{ deliberations: CouncilDeliberation[] }>(`/api/autonomous/sessions/${sessionId}/deliberations`),

  // Goals
  getGoals: (filters?: { status?: string; type?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.type) params.set('type', filters.type);
    const query = params.toString();
    return api<{ goals: Goal[] }>(`/api/autonomous/goals${query ? `?${query}` : ''}`);
  },

  createGoal: (data: Pick<Goal, 'goalType' | 'title'> & Partial<Pick<Goal, 'description' | 'targetMetric' | 'priority' | 'dueDate' | 'parentGoalId'>> & { createdBy?: 'user' | 'luna' }) =>
    api<{ goal: Goal }>('/api/autonomous/goals', { method: 'POST', body: data }),

  updateGoal: (id: string, data: Partial<Pick<Goal, 'title' | 'description' | 'targetMetric' | 'status' | 'priority' | 'dueDate'>>) =>
    api<{ goal: Goal }>(`/api/autonomous/goals/${id}`, { method: 'PUT', body: data }),

  deleteGoal: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/goals/${id}`, { method: 'DELETE' }),

  getGoalStats: () =>
    api<{ stats: { total: number; active: number; completed: number; paused: number; byType: Record<string, number> } }>('/api/autonomous/goals/stats'),

  // Achievements
  getAchievements: (limit = 50, offset = 0) =>
    api<{ achievements: Achievement[] }>(`/api/autonomous/achievements?limit=${limit}&offset=${offset}`),

  celebrateAchievement: (id: string) =>
    api<{ achievement: Achievement }>(`/api/autonomous/achievements/${id}/celebrate`, { method: 'POST' }),

  // RSS Feeds
  getFeeds: () =>
    api<{ feeds: RssFeed[] }>('/api/autonomous/rss/feeds'),

  addFeed: (url: string, category?: string) =>
    api<{ feed: RssFeed }>('/api/autonomous/rss/feeds', { method: 'POST', body: { url, category } }),

  deleteFeed: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/rss/feeds/${id}`, { method: 'DELETE' }),

  addDefaultFeeds: () =>
    api<{ feeds: RssFeed[] }>('/api/autonomous/rss/feeds/defaults', { method: 'POST' }),

  fetchFeeds: () =>
    api<{ success: boolean; articlesAdded: number }>('/api/autonomous/rss/fetch', { method: 'POST' }),

  getArticles: (options?: { interesting?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.interesting) params.set('interesting', 'true');
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<{ articles: RssArticle[] }>(`/api/autonomous/rss/articles${query ? `?${query}` : ''}`);
  },

  // Insights
  getInsights: (options?: { unshared?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.unshared) params.set('unshared', 'true');
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<{ insights: ProactiveInsight[] }>(`/api/autonomous/insights${query ? `?${query}` : ''}`);
  },

  markInsightShared: (id: string) =>
    api<{ insight: ProactiveInsight }>(`/api/autonomous/insights/${id}/shared`, { method: 'POST' }),

  dismissInsight: (id: string) =>
    api<{ insight: ProactiveInsight }>(`/api/autonomous/insights/${id}/dismiss`, { method: 'POST' }),

  // User Availability
  getAvailability: () =>
    api<{ available: boolean }>('/api/autonomous/availability'),

  setAvailability: (available: boolean) =>
    api<{ available: boolean }>('/api/autonomous/availability', { method: 'PUT', body: { available } }),

  // Questions
  getPendingQuestions: () =>
    api<{ questions: AutonomousQuestion[] }>('/api/autonomous/questions'),

  answerQuestion: (questionId: string, response: string) =>
    api<{ question: AutonomousQuestion }>(`/api/autonomous/questions/${questionId}/answer`, { method: 'POST', body: { response } }),

  dismissQuestion: (questionId: string) =>
    api<{ question: AutonomousQuestion }>(`/api/autonomous/questions/${questionId}/dismiss`, { method: 'POST' }),

  // Session Notes
  getSessionNotes: (sessionId: string) =>
    api<{ notes: SessionNote[] }>(`/api/autonomous/sessions/${sessionId}/notes`),

  // Research Collections
  getResearch: () =>
    api<{ collections: ResearchCollection[] }>('/api/autonomous/research'),

  createResearch: (title: string, description?: string, goalId?: string) =>
    api<{ collection: ResearchCollection }>('/api/autonomous/research', { method: 'POST', body: { title, description, goalId } }),

  getResearchItems: (collectionId: string) =>
    api<{ items: ResearchItem[] }>(`/api/autonomous/research/${collectionId}/items`),

  // Web Fetch
  fetchPage: (url: string, summarize = false, prompt?: string) =>
    api<{ page: FetchedPage; summary?: string }>('/api/autonomous/webfetch', { method: 'POST', body: { url, summarize, prompt } }),
};

// Question type for Luna asking user
export interface AutonomousQuestion {
  id: string;
  sessionId: string;
  userId: string;
  question: string;
  context: string | null;
  priority: number;
  status: 'pending' | 'answered' | 'dismissed' | 'expired';
  askedAt: string;
  answeredAt: string | null;
  userResponse: string | null;
  expiresAt: string | null;
  relatedGoalId: string | null;
  createdAt: string;
}

// Session note type
export interface SessionNote {
  id: string;
  sessionId: string;
  userId: string;
  noteType: 'planning' | 'observation' | 'finding' | 'decision' | 'question' | 'summary';
  title: string | null;
  content: string;
  phase: string | null;
  relatedGoalId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Research collection type
export interface ResearchCollection {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  goalId: string | null;
  sessionId: string | null;
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// Research item type
export interface ResearchItem {
  id: string;
  collectionId: string;
  userId: string;
  sourceType: 'web_page' | 'search_result' | 'rss_article' | 'document' | 'user_input';
  sourceUrl: string | null;
  title: string | null;
  content: string | null;
  summary: string | null;
  keyFindings: string[];
  relevanceScore: number;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Fetched page type
export interface FetchedPage {
  id: string;
  url: string;
  title: string | null;
  content: string;
  author: string | null;
  publishedDate: string | null;
  wordCount: number;
  fetchedAt: string;
  fromCache: boolean;
  metadata: Record<string, unknown> | null;
}

// Friend types
export interface FriendPersonality {
  id: string;
  userId: string;
  name: string;
  personality: string;
  systemPrompt: string;
  avatarEmoji: string;
  color: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FriendConversation {
  id: string;
  sessionId: string;
  userId: string;
  topic: string;
  triggerType: 'pattern' | 'interest' | 'fact' | 'random';
  friendId: string;
  messages: Array<{
    speaker: string;
    message: string;
    timestamp: string;
  }>;
  summary: string | null;
  factsExtracted: string[];
  roundCount: number;
  createdAt: string;
}

// Friends API
export const friendsApi = {
  // Get all friends
  getFriends: () =>
    api<{ friends: FriendPersonality[] }>('/api/autonomous/friends'),

  // Create custom friend
  createFriend: (data: {
    name: string;
    personality: string;
    systemPrompt: string;
    avatarEmoji?: string;
    color?: string;
  }) =>
    api<{ friend: FriendPersonality }>('/api/autonomous/friends', { method: 'POST', body: data }),

  // Update custom friend
  updateFriend: (id: string, data: Partial<{
    name: string;
    personality: string;
    systemPrompt: string;
    avatarEmoji: string;
    color: string;
  }>) =>
    api<{ friend: FriendPersonality }>(`/api/autonomous/friends/${id}`, { method: 'PUT', body: data }),

  // Delete custom friend
  deleteFriend: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/friends/${id}`, { method: 'DELETE' }),

  // Start a friend discussion
  startDiscussion: (data?: { friendId?: string; topic?: string; rounds?: number }) =>
    api<{ conversation: FriendConversation }>('/api/autonomous/friends/discuss', { method: 'POST', body: data || {} }),

  // Get recent discussions
  getDiscussions: (limit = 10) =>
    api<{ discussions: FriendConversation[] }>(`/api/autonomous/friends/discussions?limit=${limit}`),

  // Get specific discussion
  getDiscussion: (id: string) =>
    api<{ discussion: FriendConversation }>(`/api/autonomous/friends/discussions/${id}`),

  // Delete a discussion
  deleteDiscussion: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/friends/discussions/${id}`, { method: 'DELETE' }),
};

// Friend discussion streaming event types
export interface FriendDiscussionEvent {
  type: 'start' | 'message' | 'round_complete' | 'generating_summary' | 'summary' | 'extracting_facts' | 'facts' | 'complete' | 'error';
  conversationId?: string;
  friend?: { name: string; avatarEmoji: string; color: string };
  topic?: string;
  message?: { speaker: string; message: string; timestamp: string };
  round?: number;
  totalRounds?: number;
  summary?: string;
  facts?: string[];
  error?: string;
}

// Streaming friend discussion helper
export async function* streamFriendDiscussion(
  data?: { friendId?: string; topic?: string; rounds?: number }
): AsyncGenerator<FriendDiscussionEvent> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/autonomous/friends/discuss/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data || {}),
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to start streaming discussion');
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
          const parsed = JSON.parse(data) as FriendDiscussionEvent;
          yield parsed;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Facts / Memory API
export interface UserFact {
  id: string;
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  lastMentioned: string;
  mentionCount: number;
}

export interface FactCorrection {
  id: string;
  factKey: string;
  oldValue: string | null;
  newValue: string | null;
  correctionType: 'delete' | 'update';
  reason: string | null;
  createdAt: string;
}

export const factsApi = {
  // Get all user facts
  getFacts: (options?: { category?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.category) params.set('category', options.category);
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<UserFact[]>(`/api/abilities/facts${query ? `?${query}` : ''}`);
  },

  // Search facts
  searchFacts: (query: string) =>
    api<UserFact[]>(`/api/abilities/facts/search?q=${encodeURIComponent(query)}`),

  // Get a single fact
  getFact: (id: string) =>
    api<UserFact>(`/api/abilities/facts/${id}`),

  // Update a fact
  updateFact: (id: string, value: string, reason?: string) =>
    api<{ success: boolean; oldValue: string; newValue: string }>(`/api/abilities/facts/${id}`, {
      method: 'PUT',
      body: { value, reason },
    }),

  // Delete a fact
  deleteFact: (id: string, reason?: string) =>
    api<{ success: boolean }>(`/api/abilities/facts/${id}`, {
      method: 'DELETE',
      body: reason ? { reason } : undefined,
    }),

  // Get correction history
  getCorrectionHistory: (options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const query = params.toString();
    return api<FactCorrection[]>(`/api/abilities/facts/history${query ? `?${query}` : ''}`);
  },
};

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

// MCP (Model Context Protocol) API
export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transportType: 'http' | 'stdio';
  // HTTP transport
  url: string | null;
  headers: Record<string, string>;
  // Stdio transport
  commandPath: string | null;
  commandArgs: string[];
  envVars: Record<string, string>;
  workingDirectory: string | null;
  // Status
  isEnabled: boolean;
  isConnected: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  errorCount: number;
  toolCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  title: string | null;
  description: string;
  inputSchema: object;
  isEnabled: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  discoveredAt: string;
}

export interface McpServerWithTools extends McpServer {
  tools: McpTool[];
}

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  category: string;
  icon?: string;
}

export interface McpTestResult {
  success: boolean;
  serverInfo?: { name: string; version: string };
  toolCount?: number;
  error?: string;
}

export interface McpServerCreateData {
  name: string;
  description?: string;
  transportType?: 'http' | 'stdio';
  // HTTP transport
  url?: string;
  headers?: Record<string, string>;
  // Stdio transport
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
}

export interface McpServerUpdateData {
  name?: string;
  description?: string;
  transportType?: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
  isEnabled?: boolean;
}

export interface McpTestConnectionData {
  transportType: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
}

export const mcpApi = {
  // Servers
  getServers: () =>
    api<{ servers: McpServerWithTools[] }>('/api/mcp/servers'),

  createServer: (data: McpServerCreateData) =>
    api<{ server: McpServerWithTools }>('/api/mcp/servers', { method: 'POST', body: data }),

  getServer: (id: string) =>
    api<{ server: McpServerWithTools }>(`/api/mcp/servers/${id}`),

  updateServer: (id: string, data: McpServerUpdateData) =>
    api<{ server: McpServer }>(`/api/mcp/servers/${id}`, { method: 'PUT', body: data }),

  deleteServer: (id: string) =>
    api<{ success: boolean }>(`/api/mcp/servers/${id}`, { method: 'DELETE' }),

  // Tools
  discoverTools: (serverId: string) =>
    api<{ tools: McpTool[] }>(`/api/mcp/servers/${serverId}/discover`, { method: 'POST' }),

  getServerTools: (serverId: string) =>
    api<{ tools: McpTool[] }>(`/api/mcp/servers/${serverId}/tools`),

  updateTool: (toolId: string, data: { isEnabled: boolean }) =>
    api<{ tool: McpTool }>(`/api/mcp/tools/${toolId}`, { method: 'PUT', body: data }),

  // Test
  testConnection: (data: McpTestConnectionData) =>
    api<McpTestResult>('/api/mcp/test', { method: 'POST', body: data }),

  // Presets
  getPresets: () =>
    api<{ presets: McpPreset[] }>('/api/mcp/presets'),

  addPreset: (presetId: string) =>
    api<{ server: McpServerWithTools }>('/api/mcp/presets/add', { method: 'POST', body: { presetId } }),
};

// Trading API Types
export type ExchangeType = 'binance' | 'crypto_com';

export interface TradingSettings {
  userId: string;
  binanceConnected: boolean; // Deprecated - use exchangeConnected
  exchangeConnected: boolean;
  activeExchange: ExchangeType | null;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  requireStopLoss: boolean;
  defaultStopLossPct: number;
  allowedSymbols: string[];
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  // Paper trading mode
  paperMode: boolean;
  paperBalanceUsdc: number;
  // Stop confirmation threshold for ACTIVE tab
  stopConfirmationThresholdUsd: number;
  // Margin trading (Crypto.com only)
  marginEnabled: boolean;
  leverage: number;
}

export interface MarginPosition {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  marginUsed: number;
}

export interface MarginAccountInfo {
  totalEquity: number;
  availableMargin: number;
  usedMargin: number;
  marginRatio: number;
}

// Advanced Signal Settings (V2 Features)
export interface AdvancedSignalSettings {
  userId: string;
  featurePreset: 'basic' | 'intermediate' | 'pro';
  enableMtfConfluence: boolean;
  mtfHigherTimeframe: string;
  enableVwapEntry: boolean;
  vwapAnchorType: string;
  enableAtrStops: boolean;
  atrPeriod: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;
  enableBtcFilter: boolean;
  btcDumpThreshold: number;
  btcLookbackMinutes: number;
  enableLiquiditySweep: boolean;
  sweepWickRatio: number;
  sweepVolumeMultiplier: number;
}

// Active Trade Types (ACTIVE Tab)
export interface ActiveTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnlDollar: number;
  pnlPercent: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  trailingStopPct: number | null;
  trailingStopPrice: number | null;
  timeInTrade: number; // milliseconds since entry
  source: 'manual' | 'bot' | 'research';
  botId: string | null;
  binanceOrderId: string | null;
  status: 'filled' | 'pending' | 'new';
  type: 'position' | 'pending_order';
  filledAt: Date | null;
  createdAt: Date;
}

export interface ActiveTradesResponse {
  openPositions: ActiveTrade[];
  pendingOrders: ActiveTrade[];
}

export interface UpdateTradeSLTPParams {
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  trailingStopPct?: number | null;
}

export interface StopTradeResponse {
  success: boolean;
  requiresConfirmation?: boolean;
  tradeValue?: number;
  error?: string;
}

// Paper Portfolio Types
export interface PaperHolding {
  asset: string;
  symbol: string;
  amount: number;
  valueUsdc: number;
  price: number;
  priceChange24h: number;
  allocationPct: number;
}

export interface PaperPortfolio {
  totalValueUsdc: number;
  availableUsdc: number;
  holdings: PaperHolding[];
  dailyPnl: number;
  dailyPnlPct: number;
}

export interface PaperTradeRecord {
  id: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  total: number;
  fee: number;
  source: string;
  createdAt: string;
}

export interface PortfolioHolding {
  symbol: string;
  asset: string;
  amount: number;
  valueUsdt: number;
  price: number;
  priceChange24h: number;
  allocationPct: number;
}

export interface Portfolio {
  totalValueUsdt: number;
  availableUsdt: number;
  holdings: PortfolioHolding[];
  dailyPnl: number;
  dailyPnlPct: number;
}

export interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
}

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export interface TradeRecord {
  id: string;
  userId: string;
  botId: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  quantity: number;
  price: number | null;
  filledPrice: number | null;
  total: number | null;
  fee: number;
  feeAsset: string | null;
  status: string;
  binanceOrderId: string | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  notes: string | null;
  createdAt: Date;
  filledAt: Date | null;
}

// Trading Rule Types (Visual Builder)
export interface RuleConditionRecord {
  id: string;
  type: 'price' | 'indicator' | 'time' | 'change';
  symbol?: string;
  indicator?: string;
  timeframe?: string;
  operator: string;
  value: number;
}

export interface RuleActionRecord {
  id: string;
  type: 'buy' | 'sell' | 'alert';
  symbol?: string;
  amountType: 'quote' | 'base' | 'percent';
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface TradingRuleRecord {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionLogic: 'AND' | 'OR';
  conditions: RuleConditionRecord[];
  actions: RuleActionRecord[];
  maxExecutions?: number;
  cooldownMinutes?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BotType = 'grid' | 'dca' | 'rsi' | 'ma_crossover' | 'macd' | 'breakout' | 'mean_reversion' | 'momentum' | 'custom';

export interface BotConfig {
  id: string;
  userId: string;
  name: string;
  type: BotType;
  symbol: string;
  config: Record<string, unknown>;
  status: 'running' | 'stopped' | 'error' | 'paused';
  lastError: string | null;
  totalProfit: number;
  totalTrades: number;
  winRate: number;
  marketType: 'spot' | 'alpha';
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
}

// Alpha Token Types
export interface AlphaToken {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  chain: string;
  contractAddress?: string;
  logoUrl?: string;
}

export interface AlphaHolding {
  symbol: string;
  name: string;
  amount: number;
  valueUsdt: number;
  price: number;
  priceChange24h: number;
  chain: string;
  marketCap: number;
  liquidity: number;
}

export interface CombinedPortfolio {
  spot: Portfolio | null;
  alpha: AlphaHolding[];
  totalValueUsdt: number;
}

// Bot Template Types
export interface BotParameterDefinition {
  name: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  required: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string }>;
  description: string;
  helpText?: string;
}

export interface BotExampleScenario {
  title: string;
  description: string;
  config: Record<string, unknown>;
  expectedOutcome: string;
}

export interface BotTemplate {
  type: BotType;
  name: string;
  icon: string;
  shortDescription: string;
  description: string;
  howItWorks: string;
  bestFor: string[];
  risks: string[];
  parameters: BotParameterDefinition[];
  examples: BotExampleScenario[];
  tips: string[];
  warnings: string[];
  recommendedSettings: {
    conservative: Record<string, unknown>;
    moderate: Record<string, unknown>;
    aggressive: Record<string, unknown>;
  };
}

export interface ResearchSettings {
  executionMode: 'auto' | 'confirm' | 'manual';
  paperLiveMode: 'paper' | 'live';
  enableAutoDiscovery: boolean;
  autoDiscoveryLimit: number;
  customSymbols: string[];
  minConfidence: number;
  // Exit order settings
  stopLossPct: number;
  takeProfitPct: number;
  takeProfit2Pct: number | null;
  trailingStopPct: number | null;
  positionSizeUsdt: number;
  positionPct: number; // Position size as % of portfolio for live mode
  maxPositions: number; // Max concurrent positions
}

export interface AutoTradingSettings {
  enabled: boolean;
  maxPositions: number;
  rsiThreshold: number;
  volumeMultiplier: number;
  minPositionPct: number;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  symbolCooldownMinutes: number;
  minProfitPct: number;
  // Fixed USD position sizing
  minPositionUsd?: number;
  maxPositionUsd?: number;
  strategy: 'rsi_oversold' | 'trend_following' | 'mean_reversion' | 'momentum' | 'btc_correlation';
  strategyMode: 'manual' | 'auto';
  excludedSymbols: string[];
  excludeTop10: boolean;
  btcTrendFilter: boolean;
  btcMomentumBoost: boolean;
  btcCorrelationSkip: boolean;
  currentStrategy?: 'rsi_oversold' | 'trend_following' | 'mean_reversion' | 'momentum' | 'btc_correlation';
  // Dual-mode settings
  dualModeEnabled?: boolean;
  conservativeCapitalPct?: number;
  aggressiveCapitalPct?: number;
  trailingEnabled?: boolean;
  trailActivationPct?: number;
  trailDistancePct?: number;
  initialStopLossPct?: number;
  conservativeSymbols?: string[];
  aggressiveSymbols?: string[];
  conservativeMinConfidence?: number;
  aggressiveMinConfidence?: number;
}

export interface AutoTradingState {
  isRunning: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  dailyPnlUsd: number;
  dailyPnlPct: number;
  consecutiveLosses: number;
  activePositions: number;
  tradesCount: number;
  winsCount: number;
  lossesCount: number;
}

export interface MarketRegime {
  regime: 'trending' | 'ranging' | 'volatile' | 'mixed';
  confidence: number;
  btcTrend?: string;
}

export interface StrategyInfo {
  id: string;
  meta: {
    id: string;
    name: string;
    description: string;
    suitableRegimes: string[];
    requiredIndicators: string[];
  };
  performance?: {
    winRate: number;
    totalTrades: number;
    avgProfit: number;
  };
}

export interface OrphanPosition {
  symbol: string;
  asset: string;
  amount: number;
  valueUsd: number;
  currentPrice: number;
  hasActiveTrade: boolean;
  trailingStopAdded: boolean;
}

export interface ReconciliationResult {
  orphanPositions: OrphanPosition[];
  missingFromPortfolio: string[];
  reconciled: number;
  lastReconcileAt: string;
}

export interface ResearchSignal {
  id: string;
  symbol: string;
  price: number;
  rsi1m?: number;
  rsi5m?: number;
  rsi15m?: number;
  priceDropPct?: number;
  volumeRatio?: number;
  confidence: number;
  reasons: string[];
  status: 'pending' | 'executed' | 'skipped' | 'expired' | 'failed';
  executionMode: string;
  paperLiveMode: string;
  createdAt: string;
  indicators?: {
    rsi: { value1m: number; value5m: number; value15m: number };
    macd: { value: number; signal: number; histogram: number; crossover: string | null };
    bollinger: { percentB: number; squeeze: boolean };
    ema: { trend: string; crossover: string | null };
    volume: { ratio: number; spike: boolean };
  };
  confidenceBreakdown?: {
    rsi: number;
    macd: number;
    bollinger: number;
    ema: number;
    volume: number;
    priceAction: number;
    total: number;
  };
}

export interface ResearchMetrics {
  research: {
    totalSignals: number;
    executed: number;
    skipped: number;
    expired: number;
    successRate: number;
    avgConfidence: number;
  };
  scalping: {
    paper: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
    live: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
    patterns: { key: string; winRate: number; trades: number; modifier: number }[];
  };
}

// Indicator Settings
export interface IndicatorWeights {
  rsi: number;
  macd: number;
  bollinger: number;
  ema: number;
  volume: number;
  priceAction: number;
}

export interface IndicatorSettings {
  userId: string;
  preset: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  enableRsi: boolean;
  enableMacd: boolean;
  enableBollinger: boolean;
  enableEma: boolean;
  enableVolume: boolean;
  enablePriceAction: boolean;
  weights: IndicatorWeights;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStddev: number;
  emaShort: number;
  emaMedium: number;
  emaLong: number;
  volumeAvgPeriod: number;
  volumeSpikeThreshold: number;
  minConfidence: number;
}

export interface IndicatorPreset {
  weights: IndicatorWeights;
  minConfidence: number;
}

export interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}

export interface ConditionalOrderAction {
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amountType: 'quantity' | 'percentage' | 'quote';
  amount: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStopPct?: number;
  trailingStopDollar?: number;
}

export interface ConditionalOrder {
  id: string;
  userId: string;
  symbol: string;
  condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
  triggerPrice: number;
  action: ConditionalOrderAction;
  status: 'active' | 'triggered' | 'cancelled' | 'expired';
  expiresAt?: string;
  triggeredAt?: string;
  createdAt: string;
}

export interface CreateConditionalOrderParams {
  symbol: string;
  condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
  triggerPrice: number;
  action: ConditionalOrderAction;
  expiresInHours?: number;
}

// Trading API
export const tradingApi = {
  // Connection
  connect: (
    apiKey: string,
    apiSecret: string,
    exchange: ExchangeType = 'binance',
    marginEnabled: boolean = false,
    leverage: number = 1
  ) =>
    api<{ success: boolean; canTrade: boolean; error?: string }>('/api/trading/connect', {
      method: 'POST',
      body: { apiKey, apiSecret, exchange, marginEnabled, leverage },
    }),

  disconnect: () =>
    api<{ success: boolean }>('/api/trading/disconnect', { method: 'POST' }),

  getExchangeType: () =>
    api<{ exchange: ExchangeType | null }>('/api/trading/exchange'),

  // Margin Trading (Crypto.com only)
  getMarginLeverage: () =>
    api<{ leverage: number }>('/api/trading/margin/leverage'),

  setMarginLeverage: (leverage: number) =>
    api<{ success: boolean; leverage: number }>('/api/trading/margin/leverage', {
      method: 'PUT',
      body: { leverage },
    }),

  getMarginBalance: () =>
    api<MarginAccountInfo>('/api/trading/margin/balance'),

  getMarginPositions: () =>
    api<{ positions: MarginPosition[] }>('/api/trading/margin/positions'),

  placeMarginOrder: (params: {
    symbol: string;
    side: 'long' | 'short';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number;
    price?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
  }) =>
    api<TradeRecord>('/api/trading/margin/order', { method: 'POST', body: params }),

  closeMarginPosition: (symbol: string, side: 'long' | 'short') =>
    api<TradeRecord>('/api/trading/margin/close', { method: 'POST', body: { symbol, side } }),

  // Settings
  getSettings: () =>
    api<TradingSettings>('/api/trading/settings'),

  updateSettings: (updates: Partial<Omit<TradingSettings, 'userId' | 'binanceConnected'>>) =>
    api<TradingSettings>('/api/trading/settings', { method: 'PUT', body: updates }),

  // Portfolio & Prices
  getPortfolio: () =>
    api<Portfolio>('/api/trading/portfolio'),

  getPrices: (symbols?: string[]) =>
    api<PriceData[]>(`/api/trading/prices${symbols ? `?symbols=${symbols.join(',')}` : ''}`),

  getKlines: (symbol: string, interval: string, limit?: number) =>
    api<Kline[]>(`/api/trading/klines/${symbol}?interval=${interval}${limit ? `&limit=${limit}` : ''}`),

  // Trading
  getTrades: (limit?: number) =>
    api<TradeRecord[]>(`/api/trading/trades${limit ? `?limit=${limit}` : ''}`),

  placeOrder: (params: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    notes?: string;
  }) =>
    api<TradeRecord>('/api/trading/order', { method: 'POST', body: params }),

  cancelOrder: (tradeId: string) =>
    api<{ success: boolean }>(`/api/trading/order/${tradeId}`, { method: 'DELETE' }),

  getStats: (days?: number) =>
    api<TradingStats>(`/api/trading/stats${days ? `?days=${days}` : ''}`),

  // Active Trades (ACTIVE Tab)
  getActiveTrades: () =>
    api<ActiveTradesResponse>('/api/trading/active'),

  updateTradeSLTP: (tradeId: string, params: UpdateTradeSLTPParams) =>
    api<TradeRecord>(`/api/trading/trades/${tradeId}/exits`, { method: 'PATCH', body: params }),

  partialClose: (tradeId: string, quantity: number) =>
    api<TradeRecord>(`/api/trading/trades/${tradeId}/partial-close`, { method: 'POST', body: { quantity } }),

  stopTrade: (tradeId: string, skipConfirmation?: boolean) =>
    api<StopTradeResponse>(`/api/trading/trades/${tradeId}/stop`, {
      method: 'POST',
      body: { skipConfirmation: skipConfirmation || false },
    }),

  // Bots
  getBots: () =>
    api<BotConfig[]>('/api/trading/bots'),

  createBot: (config: {
    name: string;
    type: BotType;
    symbol: string;
    config: Record<string, unknown>;
    marketType?: 'spot' | 'alpha';
  }) =>
    api<BotConfig>('/api/trading/bots', { method: 'POST', body: config }),

  updateBotStatus: (botId: string, status: 'running' | 'stopped' | 'paused') =>
    api<{ success: boolean }>(`/api/trading/bots/${botId}/status`, { method: 'PATCH', body: { status } }),

  deleteBot: (botId: string) =>
    api<{ success: boolean }>(`/api/trading/bots/${botId}`, { method: 'DELETE' }),

  // Bot Templates
  getBotTemplates: () =>
    api<{ templates: BotTemplate[] }>('/api/trading/bots/templates'),

  getBotTemplate: (type: BotType) =>
    api<{ template: BotTemplate }>(`/api/trading/bots/templates/${type}`),

  getRecommendedBotSettings: (type: BotType, symbol: string, riskProfile?: 'conservative' | 'moderate' | 'aggressive') =>
    api<{ settings: Record<string, unknown>; analysis: string }>('/api/trading/bots/recommended', {
      method: 'POST',
      body: { type, symbol, riskProfile },
    }),

  // Alpha Tokens
  getAlphaTokens: (limit?: number) =>
    api<{ tokens: AlphaToken[] }>(`/api/trading/alpha/tokens${limit ? `?limit=${limit}` : ''}`),

  getAlphaPrices: (symbols: string[]) =>
    api<{ prices: Array<{ symbol: string; price: number; change24h: number }> }>(`/api/trading/alpha/prices?symbols=${symbols.join(',')}`),

  searchAlphaTokens: (query: string) =>
    api<{ tokens: AlphaToken[] }>(`/api/trading/alpha/search?q=${encodeURIComponent(query)}`),

  getHotAlphaTokens: () =>
    api<{ tokens: AlphaToken[] }>('/api/trading/alpha/hot'),

  getTopAlphaByVolume: (limit?: number) =>
    api<{ tokens: AlphaToken[] }>(`/api/trading/alpha/top-volume${limit ? `?limit=${limit}` : ''}`),

  // Combined Portfolio (Spot + Alpha)
  getCombinedPortfolio: () =>
    api<CombinedPortfolio>('/api/trading/portfolio/combined'),

  // Trading Chat
  createChatSession: () =>
    api<{ sessionId: string }>('/api/trading/chat/session', { method: 'POST' }),

  getChatMessages: (sessionId: string) =>
    api<Array<{ role: string; content: string }>>(`/api/trading/chat/session/${sessionId}/messages`),

  sendChatMessage: (sessionId: string, message: string) =>
    api<{ messageId: string; content: string; tokensUsed: number; display?: DisplayContent; tradeExecuted?: boolean }>(
      `/api/trading/chat/session/${sessionId}/send`,
      { method: 'POST', body: { message } }
    ),

  // Research Mode
  getResearchSettings: () =>
    api<ResearchSettings>('/api/trading/research/settings'),

  updateResearchSettings: (updates: Partial<ResearchSettings>) =>
    api<ResearchSettings>('/api/trading/research/settings', { method: 'PUT', body: updates }),

  getResearchSignals: (limit?: number) =>
    api<ResearchSignal[]>(`/api/trading/research/signals${limit ? `?limit=${limit}` : ''}`),

  getResearchMetrics: (days?: number) =>
    api<ResearchMetrics>(`/api/trading/research/metrics${days ? `?days=${days}` : ''}`),

  getTopPairs: (limit?: number) =>
    api<{ pairs: string[] }>(`/api/trading/research/top-pairs${limit ? `?limit=${limit}` : ''}`),

  executeSignal: (signalId: string) =>
    api<{ success: boolean; result?: string }>(`/api/trading/research/execute/${signalId}`, { method: 'POST' }),

  confirmSignal: (signalId: string, action: 'execute' | 'skip') =>
    api<{ success: boolean; result?: string }>(`/api/trading/research/confirm/${signalId}`, {
      method: 'POST',
      body: { action },
    }),

  // Indicator Settings
  getIndicatorSettings: () =>
    api<IndicatorSettings>('/api/trading/research/indicators'),

  updateIndicatorSettings: (updates: Partial<Omit<IndicatorSettings, 'userId'>>) =>
    api<IndicatorSettings>('/api/trading/research/indicators', { method: 'PUT', body: updates }),

  getIndicatorPresets: () =>
    api<Record<string, IndicatorPreset>>('/api/trading/research/indicators/presets'),

  applyIndicatorPreset: (preset: 'conservative' | 'balanced' | 'aggressive') =>
    api<IndicatorSettings>('/api/trading/research/indicators/preset', { method: 'POST', body: { preset } }),

  // Trade Rules (Conditional Orders)
  getRules: (status?: string) =>
    api<ConditionalOrder[]>(`/api/trading/rules${status ? `?status=${status}` : ''}`),

  createRule: (params: CreateConditionalOrderParams) =>
    api<ConditionalOrder>('/api/trading/rules', { method: 'POST', body: params }),

  cancelRule: (id: string) =>
    api<{ success: boolean }>(`/api/trading/rules/${id}`, { method: 'DELETE' }),

  // Paper Trading
  getPaperPortfolio: () =>
    api<PaperPortfolio>('/api/trading/paper-portfolio'),

  resetPaperPortfolio: () =>
    api<{ success: boolean; portfolio: PaperPortfolio }>('/api/trading/paper-portfolio/reset', { method: 'POST' }),

  getPaperTrades: (limit?: number, source?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit.toString());
    if (source) params.set('source', source);
    const query = params.toString();
    return api<PaperTradeRecord[]>(`/api/trading/paper-trades${query ? `?${query}` : ''}`);
  },

  // Advanced Signal Settings (V2 Features)
  getAdvancedSettings: () =>
    api<AdvancedSignalSettings>('/api/trading/settings/advanced'),

  updateAdvancedSettings: (updates: Partial<Omit<AdvancedSignalSettings, 'userId'>>) =>
    api<AdvancedSignalSettings>('/api/trading/settings/advanced', { method: 'PUT', body: updates }),

  applyFeaturePreset: (preset: 'basic' | 'intermediate' | 'pro') =>
    api<AdvancedSignalSettings>('/api/trading/settings/preset', { method: 'PUT', body: { preset } }),

  getFeaturePresets: () =>
    api<{
      presets: Record<string, { enableMtfConfluence: boolean; enableVwapEntry: boolean; enableAtrStops: boolean; enableBtcFilter: boolean; enableLiquiditySweep: boolean }>;
      descriptions: Record<string, string>;
    }>('/api/trading/settings/presets'),

  // Auto Trading
  getAutoTradingSettings: () =>
    api<{ settings: AutoTradingSettings }>('/api/trading/auto/settings').then(r => r.settings),

  updateAutoTradingSettings: (updates: Partial<AutoTradingSettings>) =>
    api<{ success: boolean; settings: AutoTradingSettings }>('/api/trading/auto/settings', { method: 'PUT', body: updates }),

  getAutoTradingState: () =>
    api<{ state: AutoTradingState }>('/api/trading/auto/state'),

  startAutoTrading: () =>
    api<{ success: boolean; state: AutoTradingState }>('/api/trading/auto/start', { method: 'POST' }),

  stopAutoTrading: () =>
    api<{ success: boolean; state: AutoTradingState }>('/api/trading/auto/stop', { method: 'POST' }),

  getMarketRegime: () =>
    api<{ regime: MarketRegime }>('/api/trading/auto/regime'),

  getAutoTradingStrategies: () =>
    api<{ strategies: StrategyInfo[] }>('/api/trading/auto/strategies'),

  reconcilePortfolio: () =>
    api<ReconciliationResult>('/api/trading/auto/reconcile', { method: 'POST' }),

  // Trading Rules (Visual Builder)
  getTradingRules: () =>
    api<{ rules: TradingRuleRecord[] }>('/api/trading/trading-rules'),

  saveTradingRule: (rule: TradingRuleRecord) =>
    api<{ success: boolean; rule: TradingRuleRecord }>('/api/trading/trading-rules', {
      method: rule.id ? 'PUT' : 'POST',
      body: rule,
    }),

  deleteTradingRule: (id: string) =>
    api<{ success: boolean }>(`/api/trading/trading-rules/${id}`, { method: 'DELETE' }),
};

// Voice Luna API (Fast voice chat - bypasses layered agent)
export interface VoiceMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface VoiceChatResponse {
  messageId: string;
  content: string;
  tokensUsed: number;
}

export const voiceApi = {
  // Create or get existing voice session
  createSession: () =>
    api<{ sessionId: string }>('/api/voice/session', { method: 'POST' }),

  // Get session messages
  getMessages: (sessionId: string, limit = 50) =>
    api<VoiceMessage[]>(`/api/voice/session/${sessionId}/messages?limit=${limit}`),

  // Send message (non-streaming for fast TTS)
  sendMessage: (sessionId: string, message: string) =>
    api<VoiceChatResponse>(`/api/voice/session/${sessionId}/send`, {
      method: 'POST',
      body: { message },
    }),

  // Delete session
  deleteSession: (sessionId: string) =>
    api<{ success: boolean }>(`/api/voice/session/${sessionId}`, { method: 'DELETE' }),
};

// Spotify API
export interface SpotifyStatus {
  isLinked: boolean;
  spotifyId: string | null;
  displayName: string | null;
}

export interface SpotifyAuthUrl {
  url: string;
  stateToken: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: Array<{ url: string; width: number; height: number }>;
  uri: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  durationMs: number;
  uri: string;
  previewUrl: string | null;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  progressMs: number | null;
  item: SpotifyTrack | null;
  device: SpotifyDevice | null;
  shuffleState: boolean;
  repeatState: string;
}

export const spotifyApi = {
  // Get connection status
  getStatus: () =>
    api<SpotifyStatus>('/api/abilities/spotify/status'),

  // Get authorization URL to start OAuth flow
  getAuthUrl: () =>
    api<SpotifyAuthUrl>('/api/abilities/spotify/authorize'),

  // Disconnect Spotify
  disconnect: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/disconnect', { method: 'DELETE' }),

  // Get current playback state
  getPlaybackStatus: () =>
    api<{ state: SpotifyPlaybackState | null }>('/api/abilities/spotify/playback'),

  // Playback controls
  play: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/play', { method: 'POST' }),

  pause: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/pause', { method: 'POST' }),

  skipNext: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/next', { method: 'POST' }),

  skipPrevious: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/previous', { method: 'POST' }),
};

// ==================== Projects API ====================

export interface ProjectQuestion {
  id: string;
  question: string;
  category: string;
  required: boolean;
}

export interface ProjectStep {
  id: string;
  stepNumber: number;
  description: string;
  stepType: string;
  filename?: string;
  requiresApproval: boolean;
  status: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProjectFile {
  id: string;
  filename: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  isGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  sessionId: string | null;
  name: string;
  description: string;
  type: 'web' | 'fullstack' | 'python' | 'node';
  status: 'planning' | 'questioning' | 'building' | 'paused' | 'review' | 'complete' | 'error';
  currentStep: number;
  plan: ProjectStep[];
  questions: ProjectQuestion[];
  answers: Record<string, unknown>;
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
}

export const projectsApi = {
  // List user's projects
  list: () =>
    api<{ projects: Project[] }>('/api/projects'),

  // Get single project
  get: (id: string) =>
    api<{ project: Project }>(`/api/projects/${id}`),

  // Get active project
  getActive: () =>
    api<{ project: Project | null }>('/api/projects/active'),

  // Create new project
  create: (data: { name: string; description?: string; type?: string; sessionId?: string }) =>
    api<{ project: Project }>('/api/projects', { method: 'POST', body: data }),

  // Update project status
  updateStatus: (id: string, status: string, currentStep?: number) =>
    api<{ success: boolean }>(`/api/projects/${id}/status`, {
      method: 'PUT',
      body: { status, currentStep },
    }),

  // Set project questions
  setQuestions: (id: string, questions: Omit<ProjectQuestion, 'id'>[]) =>
    api<{ success: boolean }>(`/api/projects/${id}/questions`, {
      method: 'POST',
      body: { questions },
    }),

  // Save answers
  saveAnswers: (id: string, answers: Record<string, unknown>) =>
    api<{ success: boolean }>(`/api/projects/${id}/answers`, {
      method: 'POST',
      body: { answers },
    }),

  // Set project plan
  setPlan: (id: string, steps: Omit<ProjectStep, 'id'>[]) =>
    api<{ success: boolean; steps: ProjectStep[] }>(`/api/projects/${id}/plan`, {
      method: 'POST',
      body: { steps },
    }),

  // Update step status
  updateStep: (id: string, stepNumber: number, status: string, result?: string, error?: string) =>
    api<{ success: boolean }>(`/api/projects/${id}/steps/${stepNumber}`, {
      method: 'PUT',
      body: { status, result, error },
    }),

  // Get project files
  getFiles: (id: string) =>
    api<{ files: ProjectFile[] }>(`/api/projects/${id}/files`),

  // Read project file
  getFile: (id: string, filename: string) =>
    api<{ content: string; filename: string }>(`/api/projects/${id}/files/${encodeURIComponent(filename)}`),

  // Write project file
  writeFile: (id: string, filename: string, content: string, fileType?: string) =>
    api<{ file: ProjectFile }>(`/api/projects/${id}/files`, {
      method: 'POST',
      body: { filename, content, fileType },
    }),

  // Delete project
  delete: (id: string) =>
    api<{ success: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
};

// Background API
export interface Background {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  backgroundType: 'generated' | 'uploaded' | 'preset';
  style: string | null;
  prompt: string | null;
  isActive: boolean;
  createdAt: string;
}

export const backgroundApi = {
  // Get all backgrounds for user
  getBackgrounds: () =>
    api<{ backgrounds: Background[] }>('/api/backgrounds'),

  // Get active background
  getActiveBackground: () =>
    api<{ background: Background | null }>('/api/backgrounds/active'),

  // Generate a new background
  generate: (prompt: string, style: string = 'custom', setActive: boolean = false) =>
    api<{ background: Background }>('/api/backgrounds/generate', {
      method: 'POST',
      body: { prompt, style, setActive },
    }),

  // Activate a background
  activate: (id: string) =>
    api<{ success: boolean; background: Background }>(`/api/backgrounds/${id}/activate`, { method: 'PUT' }),

  // Reset to default (no active background)
  reset: () =>
    api<{ success: boolean }>('/api/backgrounds/reset', { method: 'PUT' }),

  // Delete a background
  delete: (id: string) =>
    api<{ success: boolean }>(`/api/backgrounds/${id}`, { method: 'DELETE' }),
};

// Upload background image using FormData
export async function uploadBackgroundImage(file: File): Promise<Background> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}${API_PREFIX}/api/backgrounds/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new ApiError(response.status, error.error || 'Upload failed');
  }

  const data = await response.json();
  return data.background;
}

// Consciousness API (NeuralSleep Integration)
export interface ConsciousnessMetrics {
  phi: number;
  selfReferenceDepth: number;
  temporalIntegration: number;
  causalDensity: number;
  dynamicalComplexity?: number;
  consciousnessLevel?: string;
  isConscious?: boolean;
}

export interface ConsciousnessHistory {
  phi: number;
  selfReferenceDepth: number;
  temporalIntegration: number;
  causalDensity: number;
  dynamicalComplexity?: number;
  consciousnessLevel?: string;
  timestamp: string;
}

export interface ConsolidationEvent {
  id: string;
  userId: string;
  consolidationType: 'immediate' | 'daily' | 'weekly';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  episodicEventsProcessed?: number;
  patternsExtracted?: number;
  error?: string;
}

export const consciousnessApi = {
  // Get current consciousness metrics
  getMetrics: () =>
    api<{ metrics: ConsciousnessMetrics | null }>('/api/consciousness/metrics'),

  // Get consciousness history
  getHistory: (limit = 100, since?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (since) params.set('since', since);
    return api<{ history: ConsciousnessHistory[] }>(`/api/consciousness/history?${params}`);
  },

  // Trigger consciousness analysis
  analyze: () =>
    api<{ metrics: ConsciousnessMetrics }>('/api/consciousness/analyze', { method: 'POST' }),

  // Get consolidation logs
  getConsolidationLogs: (limit = 20) =>
    api<{ logs: ConsolidationEvent[] }>(`/api/consolidation/logs?limit=${limit}`),

  // Get MemoryCore health
  getHealth: () =>
    api<{ healthy: boolean; neuralsleep: boolean; message?: string }>('/api/consciousness/health'),
};

export { ApiError };
