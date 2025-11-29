// LLM Provider Types

export type ProviderId = 'openai' | 'groq' | 'anthropic' | 'xai';

export interface LLMProvider {
  id: ProviderId;
  name: string;
  models: ModelConfig[];
  enabled: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapability[];
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

export type ModelCapability = 'chat' | 'code' | 'analysis' | 'creative' | 'fast';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface CompletionResult {
  content: string;
  tokensUsed: number;
  model: string;
  provider: ProviderId;
}

export interface StreamChunk {
  type: 'content' | 'done';
  content?: string;
  tokensUsed?: number;
}

// Available providers and models registry
export const PROVIDERS: LLMProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    enabled: true,
    models: [
      {
        id: 'gpt-5.1-chat-latest',
        name: 'GPT-5.1 Chat',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
      },
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'fast'],
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'analysis'],
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    enabled: true,
    models: [
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
      },
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
      },
      {
        id: 'mixtral-8x7b-32768',
        name: 'Mixtral 8x7B',
        contextWindow: 32768,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'fast'],
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    enabled: true,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    enabled: true,
    models: [
      {
        id: 'grok-2-latest',
        name: 'Grok 2',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
      },
      {
        id: 'grok-2-mini',
        name: 'Grok 2 Mini',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'fast'],
      },
    ],
  },
];

// Task types that can have configurable models
export type ConfigurableTask =
  | 'main_chat'
  | 'agent:researcher'
  | 'agent:coder'
  | 'agent:writer'
  | 'agent:analyst'
  | 'agent:planner';

export interface TaskModelConfig {
  taskType: ConfigurableTask;
  displayName: string;
  description: string;
  defaultProvider: ProviderId;
  defaultModel: string;
}

export const CONFIGURABLE_TASKS: TaskModelConfig[] = [
  {
    taskType: 'main_chat',
    displayName: 'Main Chat',
    description: 'The primary conversation model for Luna',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.1-chat-latest',
  },
  {
    taskType: 'agent:researcher',
    displayName: 'Researcher Agent',
    description: 'Deep analysis and research tasks',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    taskType: 'agent:coder',
    displayName: 'Coder Agent',
    description: 'Code generation and debugging',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    taskType: 'agent:writer',
    displayName: 'Writer Agent',
    description: 'Creative writing and content creation',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.1-chat-latest',
  },
  {
    taskType: 'agent:analyst',
    displayName: 'Analyst Agent',
    description: 'Data analysis and insights',
    defaultProvider: 'groq',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    taskType: 'agent:planner',
    displayName: 'Planner Agent',
    description: 'Task planning and orchestration',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.1-chat-latest',
  },
];

// Helper to get provider by ID
export function getProvider(id: ProviderId): LLMProvider | undefined {
  return PROVIDERS.find(p => p.id === id);
}

// Helper to get model by provider and model ID
export function getModel(providerId: ProviderId, modelId: string): ModelConfig | undefined {
  const provider = getProvider(providerId);
  return provider?.models.find(m => m.id === modelId);
}

// Helper to get default config for a task
export function getDefaultTaskConfig(taskType: ConfigurableTask): { provider: ProviderId; model: string } {
  const task = CONFIGURABLE_TASKS.find(t => t.taskType === taskType);
  if (!task) {
    return { provider: 'openai', model: 'gpt-5.1-chat-latest' };
  }
  return { provider: task.defaultProvider, model: task.defaultModel };
}
