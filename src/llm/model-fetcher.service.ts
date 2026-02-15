// Model Fetcher Service - Dynamically fetch models from provider APIs
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { ModelConfig, LLMProvider } from './types.js';

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface AnthropicModel {
  type: string;
  id: string;
  display_name: string;
  created_at: string;
}

interface GroqModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  active: boolean;
  context_window: number;
}

interface GoogleModel {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
}

interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  top_provider?: {
    max_completion_tokens: number;
  };
}

interface XAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

// Known model pricing (per 1K tokens) - fallback when API doesn't provide it
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'o1-preview': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
  'o3-mini': { input: 0.0011, output: 0.0044 },
  // Anthropic
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku': { input: 0.0008, output: 0.004 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  // Google
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  // xAI
  'grok-4.1-fast': { input: 0.0002, output: 0.0005 },
  'grok-4.1': { input: 0.002, output: 0.005 },
  'grok-4-fast': { input: 0.0002, output: 0.0005 },
  'grok-4': { input: 0.002, output: 0.005 },
  'grok-2': { input: 0.002, output: 0.01 },
  'grok-2-mini': { input: 0.0002, output: 0.001 },
  'grok-beta': { input: 0.005, output: 0.015 },
};

// Helper to find pricing for a model
function findPricing(modelId: string): { input?: number; output?: number } {
  // Direct match
  if (MODEL_PRICING[modelId]) {
    return MODEL_PRICING[modelId];
  }

  // Partial match
  for (const [key, value] of Object.entries(MODEL_PRICING)) {
    if (modelId.includes(key) || key.includes(modelId)) {
      return value;
    }
  }

  return {};
}

// Helper to determine model capabilities from name
function inferCapabilities(modelId: string, modelName?: string): ModelConfig['capabilities'] {
  const name = (modelName || modelId).toLowerCase();
  const capabilities: ModelConfig['capabilities'] = ['chat'];

  if (name.includes('code') || name.includes('coder') || name.includes('codex')) {
    capabilities.push('code');
  }
  if (name.includes('opus') || name.includes('pro') || name.includes('4o') ||
      name.includes('grok-2') || name.includes('gemini-1.5-pro') || name.includes('gemini-2.5-pro') ||
      name.includes('kimi')) {
    capabilities.push('analysis', 'creative');
  }
  if (name.includes('mini') || name.includes('flash') || name.includes('instant') ||
      name.includes('haiku') || name.includes('nano') || name.includes('fast')) {
    capabilities.push('fast');
  }
  if (name.includes('sonnet') || name.includes('4o')) {
    capabilities.push('code', 'analysis');
  }

  return [...new Set(capabilities)] as ModelConfig['capabilities'];
}

// Fetch OpenAI models
async function fetchOpenAIModels(): Promise<ModelConfig[]> {
  if (!config.openai.apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
      },
    });

    if (!response.ok) {
      logger.warn('Failed to fetch OpenAI models', { status: response.status });
      return [];
    }

    const data = await response.json() as { data: OpenAIModel[] };

    // Filter to chat models only
    const chatModels = data.data.filter(m =>
      (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4') || m.id.startsWith('chatgpt')) &&
      !m.id.includes('instruct') &&
      !m.id.includes('vision') &&
      !m.id.includes('audio') &&
      !m.id.includes('realtime') &&
      !m.id.includes('search') &&
      !m.id.includes('tts') &&
      !m.id.includes('whisper') &&
      !m.id.includes('dall-e') &&
      !m.id.includes('embedding')
    );

    return chatModels.map(m => {
      const pricing = findPricing(m.id);
      return {
        id: m.id,
        name: formatModelName(m.id, 'openai'),
        contextWindow: getContextWindow(m.id),
        maxOutputTokens: getMaxOutputTokens(m.id),
        capabilities: inferCapabilities(m.id),
        costPer1kInput: pricing.input,
        costPer1kOutput: pricing.output,
      };
    }).sort((a, b) => {
      // Sort by model family then capability
      const aScore = getModelSortScore(a.id);
      const bScore = getModelSortScore(b.id);
      return bScore - aScore;
    });
  } catch (error) {
    logger.error('Error fetching OpenAI models', { error: (error as Error).message });
    return [];
  }
}

// Fetch Anthropic models
async function fetchAnthropicModels(): Promise<ModelConfig[]> {
  if (!config.anthropic?.apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      logger.warn('Failed to fetch Anthropic models', { status: response.status });
      return [];
    }

    const data = await response.json() as { data: AnthropicModel[] };

    return data.data
      .filter(m => m.type === 'model')
      .map(m => {
        const pricing = findPricing(m.id);
        return {
          id: m.id,
          name: m.display_name || formatModelName(m.id, 'anthropic'),
          contextWindow: getContextWindow(m.id),
          maxOutputTokens: getMaxOutputTokens(m.id),
          capabilities: inferCapabilities(m.id, m.display_name),
          costPer1kInput: pricing.input,
          costPer1kOutput: pricing.output,
        };
      }).sort((a, b) => {
        const aScore = getModelSortScore(a.id);
        const bScore = getModelSortScore(b.id);
        return bScore - aScore;
      });
  } catch (error) {
    logger.error('Error fetching Anthropic models', { error: (error as Error).message });
    return [];
  }
}

// Fetch Google AI models
async function fetchGoogleModels(): Promise<ModelConfig[]> {
  if (!config.google?.apiKey) {
    return [];
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${config.google.apiKey}`);

    if (!response.ok) {
      logger.warn('Failed to fetch Google models', { status: response.status });
      return [];
    }

    const data = await response.json() as { models: GoogleModel[] };

    // Filter to chat/generateContent models
    const chatModels = data.models.filter(m =>
      m.supportedGenerationMethods?.includes('generateContent') &&
      (m.name.includes('gemini') || m.name.includes('learnlm'))
    );

    return chatModels.map(m => {
      const modelId = m.name.replace('models/', '');
      const pricing = findPricing(modelId);
      return {
        id: modelId,
        name: m.displayName || formatModelName(modelId, 'google'),
        contextWindow: m.inputTokenLimit || 32000,
        maxOutputTokens: m.outputTokenLimit || 8192,
        capabilities: inferCapabilities(modelId, m.displayName),
        costPer1kInput: pricing.input,
        costPer1kOutput: pricing.output,
      };
    }).sort((a, b) => {
      const aScore = getModelSortScore(a.id);
      const bScore = getModelSortScore(b.id);
      return bScore - aScore;
    });
  } catch (error) {
    logger.error('Error fetching Google models', { error: (error as Error).message });
    return [];
  }
}

// Fetch xAI models
async function fetchXAIModels(): Promise<ModelConfig[]> {
  if (!config.xai?.apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://api.x.ai/v1/models', {
      headers: {
        'Authorization': `Bearer ${config.xai.apiKey}`,
      },
    });

    if (!response.ok) {
      logger.warn('Failed to fetch xAI models', { status: response.status });
      return [];
    }

    const data = await response.json() as { data: XAIModel[] };

    // Filter to grok models
    const grokModels = data.data.filter(m =>
      m.id.includes('grok') &&
      !m.id.includes('vision')
    );

    return grokModels.map(m => {
      const pricing = findPricing(m.id);
      return {
        id: m.id,
        name: formatModelName(m.id, 'xai'),
        contextWindow: getContextWindow(m.id),
        maxOutputTokens: getMaxOutputTokens(m.id),
        capabilities: inferCapabilities(m.id),
        costPer1kInput: pricing.input,
        costPer1kOutput: pricing.output,
      };
    }).sort((a, b) => {
      const aScore = getModelSortScore(a.id);
      const bScore = getModelSortScore(b.id);
      return bScore - aScore;
    });
  } catch (error) {
    logger.error('Error fetching xAI models', { error: (error as Error).message });
    return [];
  }
}

// Fetch Groq models
async function fetchGroqModels(): Promise<ModelConfig[]> {
  if (!config.groq?.apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${config.groq.apiKey}`,
      },
    });

    if (!response.ok) {
      logger.warn('Failed to fetch Groq models', { status: response.status });
      return [];
    }

    const data = await response.json() as { data: GroqModel[] };

    // Filter to active chat models
    const chatModels = data.data.filter(m =>
      m.active !== false &&
      !m.id.includes('whisper') &&
      !m.id.includes('guard') &&
      !m.id.includes('tool-use')
    );

    return chatModels.map(m => ({
      id: m.id,
      name: formatModelName(m.id, 'groq'),
      contextWindow: m.context_window || 32000,
      maxOutputTokens: Math.min(m.context_window || 8192, 32768),
      capabilities: inferCapabilities(m.id),
      costPer1kInput: 0, // Groq has complex pricing, mark as minimal
      costPer1kOutput: 0,
    })).sort((a, b) => {
      const aScore = getModelSortScore(a.id);
      const bScore = getModelSortScore(b.id);
      return bScore - aScore;
    });
  } catch (error) {
    logger.error('Error fetching Groq models', { error: (error as Error).message });
    return [];
  }
}

// Fetch Moonshot AI models
async function fetchMoonshotModels(): Promise<ModelConfig[]> {
  if (!config.moonshot?.apiKey) {
    logger.debug('Moonshot AI API key not configured, skipping fetch');
    return [];
  }

  try {
    const response = await fetch('https://api.moonshot.ai/v1/models', {
      headers: {
        'Authorization': `Bearer ${config.moonshot.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('Failed to fetch Moonshot models', { status: response.status, error: errorText });
      return [];
    }

    const data = await response.json() as { data: any[] };
    logger.debug('Fetched Moonshot models', { count: data.data.length });

    return data.data.map(m => {
      const pricing = findPricing(m.id);
      return {
        id: m.id,
        name: formatModelName(m.id, 'moonshot'),
        contextWindow: getContextWindow(m.id),
        maxOutputTokens: getMaxOutputTokens(m.id),
        capabilities: inferCapabilities(m.id),
        costPer1kInput: pricing.input,
        costPer1kOutput: pricing.output,
      };
    }).sort((a, b) => {
      const aScore = getModelSortScore(a.id);
      const bScore = getModelSortScore(b.id);
      return bScore - aScore;
    });
  } catch (error) {
    logger.error('Error fetching Moonshot models', { error: (error as Error).message });
    return [];
  }
}

// Fetch Ollama models (generic)
async function fetchOllamaModelsGeneric(url: string, name: string): Promise<ModelConfig[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { models: any[] };

    return data.models.map(m => ({
      id: m.name,
      name: formatModelName(m.name, name),
      contextWindow: 32768, // Ollama default
      maxOutputTokens: 8192,
      capabilities: inferCapabilities(m.name),
      costPer1kInput: 0,
      costPer1kOutput: 0,
    }));
  } catch {
    return [];
  }
}

async function fetchOllamaModels(): Promise<ModelConfig[]> {
  return fetchOllamaModelsGeneric(config.ollama.url, 'ollama');
}

async function fetchOllamaSecondaryModels(): Promise<ModelConfig[]> {
  if (!config.ollamaSecondary?.url) return [];
  return fetchOllamaModelsGeneric(config.ollamaSecondary.url, 'ollama_secondary');
}

async function fetchOllamaTertiaryModels(): Promise<ModelConfig[]> {
  if (!config.ollamaTertiary?.url) return [];
  return fetchOllamaModelsGeneric(config.ollamaTertiary.url, 'ollama_tertiary');
}

// Fetch OpenRouter models (with pricing!)
async function fetchOpenRouterModels(): Promise<ModelConfig[]> {
  if (!config.openrouter?.apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${config.openrouter.apiKey}`,
      },
    });

    if (!response.ok) {
      logger.warn('Failed to fetch OpenRouter models', { status: response.status });
      return [];
    }

    const data = await response.json() as { data: OpenRouterModel[] };

    // Filter to free models or commonly used ones
    return data.data
      .filter(m =>
        !m.id.includes('/extended') &&
        !m.id.includes(':beta')
      )
      .map(m => {
        // OpenRouter pricing is per token, convert to per 1K
        const inputPrice = parseFloat(m.pricing?.prompt || '0') * 1000;
        const outputPrice = parseFloat(m.pricing?.completion || '0') * 1000;

        return {
          id: m.id,
          name: m.name || formatModelName(m.id, 'openrouter'),
          contextWindow: m.context_length || 32000,
          maxOutputTokens: m.top_provider?.max_completion_tokens || 8192,
          capabilities: inferCapabilities(m.id, m.name),
          costPer1kInput: inputPrice,
          costPer1kOutput: outputPrice,
        };
      })
      .sort((a, b) => {
        // Sort free models first, then by name
        const aFree = (a.costPer1kInput || 0) === 0;
        const bFree = (b.costPer1kInput || 0) === 0;
        if (aFree !== bFree) return aFree ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (error) {
    logger.error('Error fetching OpenRouter models', { error: (error as Error).message });
    return [];
  }
}

// Helper to format model names
function formatModelName(modelId: string, provider: string): string {
  // Remove provider prefix if present
  let name = modelId;

  if (provider === 'openrouter') {
    // OpenRouter format: provider/model-name
    const parts = modelId.split('/');
    if (parts.length > 1) {
      name = parts.slice(1).join('/');
    }
  }

  // Capitalize and format
  return name
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Gpt/g, 'GPT')
    .replace(/Grok/g, 'Grok')
    .replace(/Claude/g, 'Claude')
    .replace(/Gemini/g, 'Gemini')
    .replace(/Llama/g, 'Llama')
    .replace(/Qwen/g, 'Qwen');
}

// Helper to get context window for known models
function getContextWindow(modelId: string): number {
  const id = modelId.toLowerCase();

  // OpenAI
  if (id.includes('gpt-4o')) return 128000;
  if (id.includes('gpt-4-turbo')) return 128000;
  if (id.includes('gpt-4')) return 8192;
  if (id.includes('gpt-3.5')) return 16385;
  if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return 200000;

  // Anthropic
  if (id.includes('claude')) return 200000;

  // Google
  if (id.includes('gemini-1.5') || id.includes('gemini-2')) return 1048576;
  if (id.includes('gemini')) return 32000;

  // xAI - Grok 4.1 Fast has 2M context
  if (id.includes('grok-4.1') || id.includes('grok-4-fast')) return 2000000;
  if (id.includes('grok-4')) return 131072;
  if (id.includes('grok')) return 131072;

  // Default
  return 32000;
}

// Helper to get max output tokens
function getMaxOutputTokens(modelId: string): number {
  const id = modelId.toLowerCase();

  // OpenAI
  if (id.includes('gpt-4o')) return 16384;
  if (id.includes('o1') || id.includes('o3')) return 100000;
  if (id.includes('gpt-4')) return 8192;
  if (id.includes('gpt-3.5')) return 4096;

  // Anthropic
  if (id.includes('claude-3')) return 8192;
  if (id.includes('claude')) return 4096;

  // Google
  if (id.includes('gemini-1.5-pro') || id.includes('gemini-2')) return 8192;
  if (id.includes('gemini-1.5-flash')) return 8192;

  // xAI - Grok 4.1 Fast has 30K max output
  if (id.includes('grok-4.1-fast') || id.includes('grok-4-fast')) return 30000;
  if (id.includes('grok')) return 32768;

  // Default
  return 8192;
}

// Helper to sort models by importance/capability
function getModelSortScore(modelId: string): number {
  const id = modelId.toLowerCase();
  let score = 0;

  // Latest versions get higher scores
  if (id.includes('4o') || id.includes('4.5') || id.includes('5.1') || id.includes('2.5')) score += 100;
  if (id.includes('opus')) score += 90;
  if (id.includes('pro')) score += 80;
  if (id.includes('sonnet')) score += 70;
  if (id.includes('4-turbo') || id.includes('2.0')) score += 60;
  if (id.includes('flash')) score += 50;
  if (id.includes('mini')) score += 40;
  if (id.includes('haiku') || id.includes('nano')) score += 30;
  if (id.includes('3.5')) score += 20;

  return score;
}

// Fetch Sanhedrin models (local A2A server)
async function fetchSanhedrinModels(): Promise<ModelConfig[]> {
  if (!config.sanhedrin?.enabled || !config.sanhedrin?.baseUrl) {
    return [];
  }

  try {
    const response = await fetch(`${config.sanhedrin.baseUrl}/health`);
    if (!response.ok) {
      return [];
    }

    // Sanhedrin is healthy, return static model list
    return [
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
    ];
  } catch {
    return [];
  }
}

// Main function to fetch all models from all providers
export async function fetchAllModels(): Promise<LLMProvider[]> {
  logger.info('Fetching models from all providers...');

  const [openai, anthropic, google, xai, groq, openrouter, sanhedrin, moonshot, ollama, ollamaSecondary, ollamaTertiary] = await Promise.all([
    fetchOpenAIModels(),
    fetchAnthropicModels(),
    fetchGoogleModels(),
    fetchXAIModels(),
    fetchGroqModels(),
    fetchOpenRouterModels(),
    fetchSanhedrinModels(),
    fetchMoonshotModels(),
    fetchOllamaModels(),
    fetchOllamaSecondaryModels(),
    fetchOllamaTertiaryModels(),
  ]);

  const providers: LLMProvider[] = [];

  if (openai.length > 0) {
    providers.push({
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      models: openai,
    });
  }

  if (anthropic.length > 0) {
    providers.push({
      id: 'anthropic',
      name: 'Anthropic',
      enabled: true,
      models: anthropic,
    });
  }

  if (google.length > 0) {
    providers.push({
      id: 'google',
      name: 'Google AI (Gemini)',
      enabled: true,
      models: google,
    });
  }

  if (xai.length > 0) {
    providers.push({
      id: 'xai',
      name: 'xAI (Grok)',
      enabled: true,
      models: xai,
    });
  }

  if (groq.length > 0) {
    providers.push({
      id: 'groq',
      name: 'Groq',
      enabled: true,
      models: groq,
    });
  }

  if (moonshot.length > 0) {
    providers.push({
      id: 'moonshot',
      name: 'Moonshot AI (Kimi)',
      enabled: true,
      models: moonshot,
    });
  }

  if (ollamaTertiary.length > 0 || config.ollamaTertiary?.enabled) {
    logger.info('Pushing ollama_tertiary provider', { models: ollamaTertiary.length, enabled: config.ollamaTertiary?.enabled });
    providers.push({
      id: 'ollama_tertiary',
      name: 'Ollama (Remote 10.0.0.30)',
      enabled: true,
      models: ollamaTertiary.length > 0 ? ollamaTertiary : [
        {
          id: 'unreachable',
          name: 'Status: Unreachable (Check 10.0.0.30:11434)',
          contextWindow: 0,
          maxOutputTokens: 0,
          capabilities: ['chat'],
        }
      ],
    });
  }

  if (ollama.length > 0 || config.ollama.url) {
    providers.push({
      id: 'ollama',
      name: 'Ollama (Local)',
      enabled: true,
      models: ollama,
    });
  }

  if (ollamaSecondary.length > 0 || config.ollamaSecondary?.enabled) {
    providers.push({
      id: 'ollama_secondary',
      name: 'Ollama (Remote 10.0.0.3)',
      enabled: true,
      models: ollamaSecondary,
    });
  }

  if (openrouter.length > 0) {
    providers.push({
      id: 'openrouter',
      name: 'OpenRouter',
      enabled: true,
      models: openrouter,
    });
  }

  if (sanhedrin.length > 0) {
    providers.push({
      id: 'sanhedrin',
      name: 'Sanhedrin (CLI Agents)',
      enabled: true,
      models: sanhedrin,
    });
  }

  logger.info('Fetched models from providers', {
    counts: {
      openai: openai.length,
      anthropic: anthropic.length,
      google: google.length,
      xai: xai.length,
      groq: groq.length,
      openrouter: openrouter.length,
      sanhedrin: sanhedrin.length,
      moonshot: moonshot.length,
      ollama: ollama.length,
      ollamaSecondary: ollamaSecondary.length,
      ollamaTertiary: ollamaTertiary.length,
    }
  });

  return providers;
}

// Cache for models (refresh every 5 minutes)
let cachedModels: LLMProvider[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedModels(): Promise<LLMProvider[]> {
  const now = Date.now();

  if (cachedModels && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedModels;
  }

  cachedModels = await fetchAllModels();
  cacheTimestamp = now;

  return cachedModels;
}

// Clear the cache (useful after config changes)
export function clearModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
}
