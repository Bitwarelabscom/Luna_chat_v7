import type { ProviderId, ChatMessage, CompletionResult, StreamChunk } from './types.js';
import * as openaiProvider from './providers/openai.provider.js';
import * as groqProvider from './providers/groq.provider.js';
import * as anthropicProvider from './providers/anthropic.provider.js';
import * as xaiProvider from './providers/xai.provider.js';
import * as openrouterProvider from './providers/openrouter.provider.js';
import * as ollamaProvider from './providers/ollama.provider.js';
import * as googleProvider from './providers/google.provider.js';
import logger from '../utils/logger.js';

interface ProviderModule {
  createCompletion: (
    model: string,
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ) => Promise<CompletionResult>;
  streamCompletion: (
    model: string,
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ) => AsyncGenerator<StreamChunk>;
  isConfigured: () => boolean;
}

const providers: Record<ProviderId, ProviderModule> = {
  openai: openaiProvider,
  groq: groqProvider,
  anthropic: anthropicProvider,
  xai: xaiProvider,
  openrouter: openrouterProvider,
  ollama: ollamaProvider,
  google: googleProvider,
};

function getProvider(providerId: ProviderId): ProviderModule {
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Provider ${providerId} is not configured (missing API key)`);
  }
  return provider;
}

/**
 * Create a chat completion using the specified provider and model
 */
export async function createCompletion(
  providerId: ProviderId,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const provider = getProvider(providerId);

  logger.debug('LLM request', { provider: providerId, model, messageCount: messages.length });

  const result = await provider.createCompletion(model, messages, options);

  logger.debug('LLM response', { provider: providerId, model, tokensUsed: result.tokensUsed });

  return result;
}

/**
 * Stream a chat completion using the specified provider and model
 */
export async function* streamCompletion(
  providerId: ProviderId,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const provider = getProvider(providerId);

  logger.debug('LLM stream request', { provider: providerId, model, messageCount: messages.length });

  yield* provider.streamCompletion(model, messages, options);
}

/**
 * Check if a provider is configured and available
 */
export function isProviderAvailable(providerId: ProviderId): boolean {
  const provider = providers[providerId];
  return provider?.isConfigured() ?? false;
}

/**
 * Get list of available (configured) providers
 */
export function getAvailableProviders(): ProviderId[] {
  return (Object.keys(providers) as ProviderId[]).filter(id => providers[id].isConfigured());
}

export default {
  createCompletion,
  streamCompletion,
  isProviderAvailable,
  getAvailableProviders,
};
