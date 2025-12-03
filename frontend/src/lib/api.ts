// In production (empty NEXT_PUBLIC_API_URL), API calls go through nginx at /luna-chat/api
// In development, API calls go directly to the backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = API_URL ? '' : '/luna-chat';

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
  constructor(public status: number, message: string) {
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
    throw new ApiError(response.status, error.error || 'Request failed');
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
  mode: 'assistant' | 'companion';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageMetrics {
  promptTokens: number;
  completionTokens: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  toolsUsed: string[];
  model: string;
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

  editMessage: (sessionId: string, messageId: string, content: string) =>
    api<Message>(`/api/chat/sessions/${sessionId}/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    }),
};

// Streaming helper
export async function* streamMessage(
  sessionId: string,
  message: string
): AsyncGenerator<{ type: 'content' | 'done' | 'status'; content?: string; status?: string; messageId?: string; metrics?: MessageMetrics }> {
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
): AsyncGenerator<{ type: 'content' | 'done' | 'status'; content?: string; status?: string; messageId?: string; metrics?: MessageMetrics }> {
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

export type ThemeType = 'dark' | 'retro' | 'light' | 'cyberpunk' | 'nord' | 'solarized';

export interface UserSettings {
  theme?: ThemeType;
  crtFlicker?: boolean;
  language?: string;
  notifications?: boolean;
  defaultMode?: 'assistant' | 'companion';
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
};

// Email API
export interface Email {
  id: string;
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
}

export const calendarApi = {
  getEvents: (days = 7, limit = 20) =>
    api<{ events: CalendarEvent[] }>(`/api/abilities/calendar/events?days=${days}&limit=${limit}`),

  getToday: () =>
    api<{ events: CalendarEvent[] }>('/api/abilities/calendar/today'),

  getConnections: () =>
    api<{ connections: { id: string; provider: string; isActive: boolean }[] }>('/api/abilities/calendar/connections'),
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

  start: () =>
    api<{ success: boolean; session: AutonomousSession }>('/api/autonomous/start', { method: 'POST' }),

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

export { ApiError };
