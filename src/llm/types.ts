// LLM Provider Types

export type ProviderId = 'openai' | 'groq' | 'anthropic' | 'xai' | 'openrouter' | 'ollama' | 'ollama_secondary' | 'ollama_tertiary' | 'google' | 'sanhedrin' | 'moonshot';

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
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
}

export interface StreamChunk {
  type: 'content' | 'done' | 'reasoning';  // 'reasoning' for xAI Grok thinking output
  content?: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
}

// Available providers and models registry
export const PROVIDERS: LLMProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    enabled: true,
    models: [
      // GPT-5.1 Series (Latest)
      {
        id: 'gpt-5.1-chat-latest',
        name: 'GPT-5.1',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.00125,
        costPer1kOutput: 0.01,
      },
      {
        id: 'gpt-5.1-codex',
        name: 'GPT-5.1 Codex',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0.00125,
        costPer1kOutput: 0.01,
      },
      // GPT-5 Series
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.00025,
        costPer1kOutput: 0.002,
      },
      {
        id: 'gpt-5-nano',
        name: 'GPT-5 Nano',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0.00005,
        costPer1kOutput: 0.0004,
      },
      // GPT-4.1 Series
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.002,
        costPer1kOutput: 0.008,
      },
      {
        id: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.0004,
        costPer1kOutput: 0.0016,
      },
      {
        id: 'gpt-4.1-nano',
        name: 'GPT-4.1 Nano',
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0.0001,
        costPer1kOutput: 0.0004,
      },
      // GPT-4o Series
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.0025,
        costPer1kOutput: 0.01,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
      },
      // o3/o4 Reasoning
      {
        id: 'o3',
        name: 'o3 (Reasoning)',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0.002,
        costPer1kOutput: 0.008,
      },
      {
        id: 'o4-mini',
        name: 'o4 Mini (Reasoning)',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        capabilities: ['chat', 'code', 'analysis', 'fast'],
        costPer1kInput: 0.0011,
        costPer1kOutput: 0.0044,
      },
      // Excluded expensive models:
      // gpt-5-pro: $15/$120, o1: $15/$60, o1-pro: $150/$600, o3-pro: $20/$80
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    enabled: true,
    models: [
      // Production Models
      {
        id: 'openai/gpt-oss-120b',
        name: 'GPT-OSS 120B',
        contextWindow: 131072,
        maxOutputTokens: 65536,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
      },
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.00059,
        costPer1kOutput: 0.00079,
      },
      {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B',
        contextWindow: 131072,
        maxOutputTokens: 65536,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.000075,
        costPer1kOutput: 0.0003,
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant',
        contextWindow: 131072,
        maxOutputTokens: 131072,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0.00005,
        costPer1kOutput: 0.00008,
      },
      // Groq Compound (Agentic)
      {
        id: 'groq/compound',
        name: 'Groq Compound',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
      },
      {
        id: 'groq/compound-mini',
        name: 'Groq Compound Mini',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
      },
      // Preview Models (subject to change)
      {
        id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        name: 'Llama 4 Maverick 17B (Preview)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
      },
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        name: 'Llama 4 Scout 17B (Preview)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
      },
      {
        id: 'moonshotai/kimi-k2-instruct',
        name: 'Kimi K2 Instruct (Preview)',
        contextWindow: 131072,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'analysis'],
      },
      {
        id: 'qwen/qwen3-32b',
        name: 'Qwen3 32B (Preview)',
        contextWindow: 131072,
        maxOutputTokens: 40960,
        capabilities: ['chat', 'code', 'analysis'],
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    enabled: true,
    models: [
      // Claude 4.5 Series (Latest)
      {
        id: 'claude-opus-4-5-20251101',
        name: 'Claude Opus 4.5',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.005,
        costPer1kOutput: 0.025,
      },
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.001,
        costPer1kOutput: 0.005,
      },
      // Claude 4 Series
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      },
      // Claude 3.5 Series (Legacy)
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0.0008,
        costPer1kOutput: 0.004,
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    enabled: true,
    models: [
      // Grok 4.1 Fast Series
      {
        id: 'grok-4-1-fast',
        name: 'Grok 4.1 Fast',
        contextWindow: 256000,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative', 'fast'],
        costPer1kInput: 0.0002,
        costPer1kOutput: 0.0005,
      },
      {
        id: 'grok-4-1-fast-non-reasoning-latest',
        name: 'Grok 4.1 Fast Non-Reasoning',
        contextWindow: 256000,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'fast'],
        costPer1kInput: 0.0002,
        costPer1kOutput: 0.0005,
      },
      // Grok 4 Series
      {
        id: 'grok-4',
        name: 'Grok 4',
        contextWindow: 256000,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      },
      // Grok 3 Series
      {
        id: 'grok-3',
        name: 'Grok 3',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      },
      {
        id: 'grok-3-mini',
        name: 'Grok 3 Mini',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.0003,
        costPer1kOutput: 0.0005,
      },
      // Grok 2 Series (Legacy)
      {
        id: 'grok-2-1212',
        name: 'Grok 2',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0.002,
        costPer1kOutput: 0.01,
      },
      {
        id: 'grok-imagine-image',
        name: 'Grok Imagine',
        contextWindow: 0,
        maxOutputTokens: 0,
        capabilities: ['creative'],
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (Free)',
    enabled: true,
    models: [
      // Top Tier - Flagship Models
      {
        id: 'x-ai/grok-4.1-fast:free',
        name: 'Grok 4.1 Fast (Free)',
        contextWindow: 2000000,
        maxOutputTokens: 30000,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'google/gemini-2.0-flash-exp:free',
        name: 'Gemini 2.0 Flash Exp (Free)',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'nousresearch/hermes-3-llama-3.1-405b:free',
        name: 'Hermes 3 405B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen/qwen3-235b-a22b:free',
        name: 'Qwen3 235B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen/qwen3-coder:free',
        name: 'Qwen3 Coder 480B (Free)',
        contextWindow: 262000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Llama 3.3 70B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      // Mid Tier - Strong Models
      {
        id: 'moonshotai/kimi-k2:free',
        name: 'Kimi K2 (Free)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'kwaipilot/kat-coder-pro:free',
        name: 'KAT-Coder-Pro (Free)',
        contextWindow: 256000,
        maxOutputTokens: 32768,
        capabilities: ['chat', 'code'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'alibaba/tongyi-deepresearch-30b-a3b:free',
        name: 'Tongyi DeepResearch 30B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'google/gemma-3-27b-it:free',
        name: 'Gemma 3 27B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'mistralai/mistral-small-3.1-24b-instruct:free',
        name: 'Mistral Small 3.1 24B (Free)',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
        name: 'Dolphin Mistral 24B Venice (Free)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'creative'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'openai/gpt-oss-20b:free',
        name: 'GPT-OSS 20B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      // Reasoning/Chimera Models
      {
        id: 'tngtech/tng-r1t-chimera:free',
        name: 'TNG R1T Chimera (Free)',
        contextWindow: 163840,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'tngtech/deepseek-r1t-chimera:free',
        name: 'DeepSeek R1T Chimera (Free)',
        contextWindow: 163840,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'tngtech/deepseek-r1t2-chimera:free',
        name: 'DeepSeek R1T2 Chimera (Free)',
        contextWindow: 163840,
        maxOutputTokens: 16384,
        capabilities: ['chat', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      // Vision Models
      {
        id: 'nvidia/nemotron-nano-12b-v2-vl:free',
        name: 'Nemotron Nano 12B VL (Free)',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'nvidia/nemotron-nano-9b-v2:free',
        name: 'Nemotron Nano 9B (Free)',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      // Smaller/Fast Models
      {
        id: 'google/gemma-3-12b-it:free',
        name: 'Gemma 3 12B (Free)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'meituan/longcat-flash-chat:free',
        name: 'LongCat Flash (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'z-ai/glm-4.5-air:free',
        name: 'GLM 4.5 Air (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen/qwen3-4b:free',
        name: 'Qwen3 4B (Free)',
        contextWindow: 40960,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'google/gemma-3-4b-it:free',
        name: 'Gemma 3 4B (Free)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'meta-llama/llama-3.2-3b-instruct:free',
        name: 'Llama 3.2 3B (Free)',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'mistralai/mistral-7b-instruct:free',
        name: 'Mistral 7B (Free)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'google/gemma-3n-e4b-it:free',
        name: 'Gemma 3n 4B (Free)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'google/gemma-3n-e2b-it:free',
        name: 'Gemma 3n 2B (Free)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    enabled: true,
    models: [
      {
        id: 'qwen2.5:1.5b',
        name: 'Qwen 2.5 1.5B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen2.5:3b',
        name: 'Qwen 2.5 3B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen2.5:7b',
        name: 'Qwen 2.5 7B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'llama3.2:3b',
        name: 'Llama 3.2 3B',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'gemma2:2b',
        name: 'Gemma 2 2B',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'phi3:mini',
        name: 'Phi-3 Mini',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
    ],
  },
  {
    id: 'ollama_secondary',
    name: 'Ollama (Remote 10.0.0.3)',
    enabled: true,
    models: [
      {
        id: 'qwen2.5:1.5b',
        name: 'Qwen 2.5 1.5B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen2.5:3b',
        name: 'Qwen 2.5 3B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen2.5:7b',
        name: 'Qwen 2.5 7B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'llama3.2:3b',
        name: 'Llama 3.2 3B',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'gemma2:2b',
        name: 'Gemma 2 2B',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'phi3:mini',
        name: 'Phi-3 Mini',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
    ],
  },
  {
    id: 'ollama_tertiary',
    name: 'Ollama (Remote 10.0.0.30)',
    enabled: true,
    models: [
      {
        id: 'qwen2.5:1.5b',
        name: 'Qwen 2.5 1.5B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen2.5:3b',
        name: 'Qwen 2.5 3B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'qwen2.5:7b',
        name: 'Qwen 2.5 7B',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'llama3.2:3b',
        name: 'Llama 3.2 3B',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'gemma2:2b',
        name: 'Gemma 2 2B',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'phi3:mini',
        name: 'Phi-3 Mini',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google AI (Gemini)',
    enabled: true,
    models: [
      // Gemini 3 - Latest
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro (Preview)',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.002,
        costPer1kOutput: 0.012,
      },
      // Gemini 2.5 - Current Generation
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.00125,
        costPer1kOutput: 0.01,
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextWindow: 1048576,
        maxOutputTokens: 65535,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.0003,
        costPer1kOutput: 0.0025,
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.000075,
        costPer1kOutput: 0.0003,
      },
      // Gemini 2.0 - Previous Generation
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0.0001,
        costPer1kOutput: 0.0004,
      },
      {
        id: 'gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash Lite',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'fast'],
        costPer1kInput: 0.000075,
        costPer1kOutput: 0.0003,
      },
    ],
  },
  {
    id: 'sanhedrin',
    name: 'Sanhedrin (CLI Agents)',
    enabled: true,
    models: [
      {
        id: 'claude-code',
        name: 'Claude Code (CLI)',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'gemini-cli',
        name: 'Gemini CLI',
        contextWindow: 1000000,
        maxOutputTokens: 32000,
        capabilities: ['chat', 'code', 'analysis'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'codex-cli',
        name: 'Codex CLI',
        contextWindow: 128000,
        maxOutputTokens: 16000,
        capabilities: ['chat', 'code'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
      {
        id: 'ollama',
        name: 'Ollama (via Sanhedrin)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0,
        costPer1kOutput: 0,
      },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    enabled: true,
    models: [
      {
        id: 'moonshot-v1-128k',
        name: 'Moonshot V1 128K',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.0084, // Approximate in USD (60 RMB per 1M tokens)
        costPer1kOutput: 0.0084,
      },
      {
        id: 'moonshot-v1-32k',
        name: 'Moonshot V1 32K',
        contextWindow: 32000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'code', 'analysis', 'creative'],
        costPer1kInput: 0.0034, // Approximate in USD (24 RMB per 1M tokens)
        costPer1kOutput: 0.0034,
      },
      {
        id: 'moonshot-v1-8k',
        name: 'Moonshot V1 8K',
        contextWindow: 8000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'code', 'fast'],
        costPer1kInput: 0.0017, // Approximate in USD (12 RMB per 1M tokens)
        costPer1kOutput: 0.0017,
      },
    ],
  },
];

// Task types that can have configurable models
export type ConfigurableTask =
  | 'main_chat'
  | 'council'
  | 'agent:researcher'
  | 'agent:coder'
  | 'agent:writer'
  | 'agent:analyst'
  | 'agent:planner'
  | 'friend'
  | 'smalltalk'
  | 'fast_llm'
  | 'fast_plan'
  | 'fast_draft'
  | 'image_generation'
  | 'rpg_architect'
  | 'rpg_character_forge'
  | 'rpg_narrator'
  | 'rpg_adjudicator'
  | 'ceo_luna'
  | 'dj_luna';

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
    taskType: 'council',
    displayName: 'Autonomous Council',
    description: 'Internal council deliberations (Polaris, Aurora, Vega, Sol)',
    defaultProvider: 'groq',
    defaultModel: 'llama-3.3-70b-versatile',
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
    defaultProvider: 'openrouter',
    defaultModel: 'qwen/qwen3-coder:free',
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
  {
    taskType: 'friend',
    displayName: 'Friend Discussions',
    description: 'Luna\'s conversations with AI friends about patterns',
    defaultProvider: 'ollama',
    defaultModel: 'llama3.2:3b',
  },
  {
    taskType: 'smalltalk',
    displayName: 'Smalltalk & Quick Replies',
    description: 'Simple greetings, acknowledgments, and casual chat',
    defaultProvider: 'xai',
    defaultModel: 'grok-4-1-fast-non-reasoning-latest',
  },
  {
    taskType: 'fast_llm',
    displayName: 'Voice Chat',
    description: 'Model for voice conversations - optimized for speed',
    defaultProvider: 'xai',
    defaultModel: 'grok-4-1-fast',
  },
  {
    taskType: 'fast_plan',
    displayName: 'Fast Planner',
    description: 'Quick planning for sub-5s responses (fast path)',
    defaultProvider: 'google',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    taskType: 'fast_draft',
    displayName: 'Fast Generator',
    description: 'Quick draft generation for sub-5s responses (fast path)',
    defaultProvider: 'xai',
    defaultModel: 'grok-4-1-fast',
  },
  {
    taskType: 'image_generation',
    displayName: 'Image Generation',
    description: 'Model used for generating images from text descriptions',
    defaultProvider: 'openai',
    defaultModel: 'gpt-image-1-mini',
  },
  {
    taskType: 'rpg_architect',
    displayName: 'RPG World Architect',
    description: 'Generates RPG world setup and world suggestions',
    defaultProvider: 'ollama',
    defaultModel: 'qwen2.5:7b',
  },
  {
    taskType: 'rpg_character_forge',
    displayName: 'RPG Character Forge',
    description: 'Generates RPG cast and character details',
    defaultProvider: 'ollama',
    defaultModel: 'qwen2.5:7b',
  },
  {
    taskType: 'rpg_narrator',
    displayName: 'RPG Narrator',
    description: 'Creates short narration for RPG action outcomes',
    defaultProvider: 'ollama',
    defaultModel: 'llama3.2:3b',
  },
  {
    taskType: 'rpg_adjudicator',
    displayName: 'RPG Adjudicator',
    description: 'Adjudicates custom RPG actions and stat deltas',
    defaultProvider: 'ollama',
    defaultModel: 'qwen2.5:7b',
  },
  {
    taskType: 'ceo_luna',
    displayName: 'CEO Luna',
    description: 'CEO Luna business operations and strategy - always use pro or higher model',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.2-chat-latest',
  },
  {
    taskType: 'dj_luna',
    displayName: 'DJ Luna',
    description: 'DJ Luna music production and lyrics - always use pro or higher model',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.2-chat-latest',
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
