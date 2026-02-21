import { api } from './core';

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

export type BackgroundLlmFeatureId =
  | 'mood_analysis'
  | 'context_summary'
  | 'memory_curation'
  | 'friend_summary'
  | 'friend_fact_extraction'
  | 'intent_detection'
  | 'news_filter'
  | 'research_synthesis'
  | 'session_gap_analysis'
  | 'knowledge_verification';

export interface BackgroundLlmFeatureMeta {
  id: BackgroundLlmFeatureId;
  label: string;
  description: string;
}

export interface FeatureModelSelection {
  provider: ProviderId;
  model: string;
}

export interface BackgroundFeatureModelConfig {
  primary: FeatureModelSelection;
  fallback: FeatureModelSelection;
}

export type BackgroundLlmSettings = Record<BackgroundLlmFeatureId, BackgroundFeatureModelConfig>;

// TTS Settings Types
export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TtsSettings {
  engine: 'elevenlabs' | 'openai';
  openaiVoice: OpenAIVoice;
}

// Coder Settings Types
export type ProviderId = 'openai' | 'groq' | 'anthropic' | 'xai' | 'openrouter' | 'ollama' | 'ollama_secondary' | 'ollama_tertiary' | 'google' | 'sanhedrin' | 'moonshot';

export interface TriggerWords {
  claude: string[];
  gemini: string[];
  api: string[];
  codex: string[];
}

export interface CoderSettings {
  userId: string;
  claudeCliEnabled: boolean;
  geminiCliEnabled: boolean;
  codexCliEnabled: boolean;
  coderApiEnabled: boolean;
  coderApiProvider: ProviderId | null;
  coderApiModel: string | null;
  triggerWords: TriggerWords;
  defaultCoder: 'claude' | 'gemini' | 'api' | 'codex';
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

  // Background LLM Settings
  getBackgroundLlmSettings: () =>
    api<{
      settings: BackgroundLlmSettings;
      features: BackgroundLlmFeatureMeta[];
      providers: LLMProvider[];
    }>('/api/settings/background-llm'),

  updateBackgroundLlmSettings: (settings: Partial<BackgroundLlmSettings>) =>
    api<{ success: boolean; settings: BackgroundLlmSettings }>('/api/settings/background-llm', {
      method: 'PUT',
      body: { settings },
    }),

  // TTS Settings
  getTtsSettings: () =>
    api<{ settings: TtsSettings; availableVoices: string[] }>('/api/settings/tts'),

  updateTtsSettings: (settings: Partial<TtsSettings>) =>
    api<{ success: boolean; settings: TtsSettings }>('/api/settings/tts', { method: 'PUT', body: settings }),

  // Coder Settings
  getCoderSettings: () =>
    api<{ settings: CoderSettings; defaultTriggerWords: TriggerWords }>('/api/settings/coder'),

  updateCoderSettings: (updates: Partial<Omit<CoderSettings, 'userId'>>) =>
    api<{ success: boolean; settings: CoderSettings }>('/api/settings/coder', { method: 'PUT', body: updates }),

  resetCoderSettings: () =>
    api<{ success: boolean }>('/api/settings/coder', { method: 'DELETE' }),
};
