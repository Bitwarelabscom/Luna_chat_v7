import type { ProviderId, ChatMessage, CompletionResult, StreamChunk } from './types.js';
import * as openaiProvider from './providers/openai.provider.js';
import * as groqProvider from './providers/groq.provider.js';
import * as anthropicProvider from './providers/anthropic.provider.js';
import type { CacheableSystemBlock } from './providers/anthropic.provider.js';
import * as xaiProvider from './providers/xai.provider.js';
import * as openrouterProvider from './providers/openrouter.provider.js';
import * as ollamaProvider from './providers/ollama.provider.js';
import * as ollamaSecondaryProvider from './providers/ollama-secondary.provider.js';
import * as ollamaTertiaryProvider from './providers/ollama-tertiary.provider.js';
import * as googleProvider from './providers/google.provider.js';
import * as sanhedrinProvider from './providers/sanhedrin.provider.js';
import * as moonshotProvider from './providers/moonshot.provider.js';
import logger from '../utils/logger.js';
import { activityHelpers } from '../activity/activity.service.js';
import { pool } from '../db/postgres.js';

// Providers to skip for llm_call_logs (local/free, no per-token cost)
const EXCLUDED_PROVIDERS: Set<ProviderId> = new Set(['ollama', 'ollama_secondary', 'ollama_tertiary', 'sanhedrin']);

interface LLMCallLogData {
  userId?: string;
  sessionId?: string;
  source: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  reasoningTokens: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

function logToDb(data: LLMCallLogData): void {
  pool.query(
    `INSERT INTO llm_call_logs
       (user_id, session_id, source, provider, model,
        input_tokens, output_tokens, cache_tokens, reasoning_tokens,
        duration_ms, success, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      data.userId ?? null,
      data.sessionId ?? null,
      data.source,
      data.provider,
      data.model,
      data.inputTokens,
      data.outputTokens,
      data.cacheTokens,
      data.reasoningTokens,
      data.durationMs,
      data.success,
      data.errorMessage ?? null,
    ]
  ).catch(() => {}); // Non-blocking, never throws
}

/**
 * Optional logging context for activity tracking
 */
export interface LLMLoggingContext {
  userId: string;
  sessionId?: string;
  turnId?: string;
  source: string;
  nodeName: string;
}

interface ProviderModule {
  createCompletion: (
    model: string,
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number; systemBlocks?: CacheableSystemBlock[] }
  ) => Promise<CompletionResult>;
  streamCompletion: (
    model: string,
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number; systemBlocks?: CacheableSystemBlock[] }
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
  ollama_secondary: ollamaSecondaryProvider,
  ollama_tertiary: ollamaTertiaryProvider,
  google: googleProvider,
  sanhedrin: sanhedrinProvider,
  moonshot: moonshotProvider,
};

function getProvider(providerId: ProviderId): ProviderModule {
  const provider = providers[providerId];
  if (!provider) {
    logger.error('Provider lookup failed', { providerId, availableProviders: Object.keys(providers) });
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Provider ${providerId} is not configured (missing API key)`);
  }
  return provider;
}

/**
 * Create a chat completion using the specified provider and model
 * For Anthropic, systemBlocks can be passed for prompt caching
 * Optional loggingContext for activity tracking
 */
export async function createCompletion(
  providerId: ProviderId,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; systemBlocks?: CacheableSystemBlock[]; loggingContext?: LLMLoggingContext } = {}
): Promise<CompletionResult> {
  logger.info('Router createCompletion called', { providerId, model });
  const provider = getProvider(providerId);
  const startTime = Date.now();

  logger.debug('LLM request', { provider: providerId, model, messageCount: messages.length });

  let result: CompletionResult;
  try {
    result = await provider.createCompletion(model, messages, options);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (options.loggingContext) {
      activityHelpers.logLLMCall(
        options.loggingContext.userId,
        options.loggingContext.sessionId,
        options.loggingContext.turnId,
        options.loggingContext.nodeName,
        model,
        providerId,
        {
          input: 0,
          output: 0,
          cache: 0,
        },
        durationMs,
        undefined,
        undefined,
        {
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          response: {
            content: '',
            finishReason: 'error',
          },
        }
      ).catch(() => {});
    }
    if (!EXCLUDED_PROVIDERS.has(providerId)) {
      logToDb({
        userId: options.loggingContext?.userId,
        sessionId: options.loggingContext?.sessionId,
        source: options.loggingContext?.source ?? options.loggingContext?.nodeName ?? 'router',
        provider: providerId,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        reasoningTokens: 0,
        durationMs,
        success: false,
        errorMessage: (err as Error).message?.slice(0, 500),
      });
    }
    throw err;
  }

  logger.debug('LLM response', { provider: providerId, model, tokensUsed: result.tokensUsed });

  const durationMs = Date.now() - startTime;

  // Log to llm_call_logs for all non-excluded providers (regardless of loggingContext)
  if (!EXCLUDED_PROVIDERS.has(providerId)) {
    logToDb({
      userId: options.loggingContext?.userId,
      sessionId: options.loggingContext?.sessionId,
      source: options.loggingContext?.source ?? options.loggingContext?.nodeName ?? 'router',
      provider: providerId,
      model,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cacheTokens: result.cacheTokens ?? 0,
      reasoningTokens: 0,
      durationMs,
      success: true,
    });
  }

  // Log to activity if context provided
  if (options.loggingContext) {
    activityHelpers.logLLMCall(
      options.loggingContext.userId,
      options.loggingContext.sessionId,
      options.loggingContext.turnId,
      options.loggingContext.nodeName,
      model,
      providerId,
      {
        input: result.inputTokens || 0,
        output: result.outputTokens || 0,
        cache: result.cacheTokens,
      },
      durationMs,
      undefined, // cost not available in CompletionResult
      undefined, // reasoning
      {
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        response: {
          content: result.content,
          finishReason: 'stop',
        },
      }
    ).catch(() => {}); // Non-blocking
  }

  return result;
}

/**
 * Stream a chat completion using the specified provider and model
 * For Anthropic, systemBlocks can be passed for prompt caching
 */
export async function* streamCompletion(
  providerId: ProviderId,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; systemBlocks?: CacheableSystemBlock[]; loggingContext?: LLMLoggingContext } = {}
): AsyncGenerator<StreamChunk> {
  const provider = getProvider(providerId);

  logger.debug('LLM stream request', { provider: providerId, model, messageCount: messages.length });

  const startTime = Date.now();
  let totalInput = 0;
  let totalOutput = 0;
  let totalCache = 0;

  try {
    for await (const chunk of provider.streamCompletion(model, messages, options)) {
      if (chunk.type === 'done') {
        totalInput += chunk.inputTokens ?? 0;
        totalOutput += chunk.outputTokens ?? 0;
        totalCache += chunk.cacheTokens ?? 0;
      }
      yield chunk;
    }
  } catch (err) {
    if (options.loggingContext) {
      activityHelpers.logLLMCall(
        options.loggingContext.userId,
        options.loggingContext.sessionId,
        options.loggingContext.turnId,
        options.loggingContext.nodeName,
        model,
        providerId,
        {
          input: totalInput,
          output: totalOutput,
          cache: totalCache,
        },
        Date.now() - startTime,
        undefined,
        undefined,
        {
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          response: {
            content: '',
            finishReason: 'error',
          },
        }
      ).catch(() => {});
    }
    if (!EXCLUDED_PROVIDERS.has(providerId)) {
      logToDb({
        userId: options.loggingContext?.userId,
        sessionId: options.loggingContext?.sessionId,
        source: options.loggingContext?.source ?? options.loggingContext?.nodeName ?? 'router',
        provider: providerId,
        model,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheTokens: totalCache,
        reasoningTokens: 0,
        durationMs: Date.now() - startTime,
        success: false,
        errorMessage: (err as Error).message?.slice(0, 500),
      });
    }
    throw err;
  }

  if (!EXCLUDED_PROVIDERS.has(providerId)) {
    logToDb({
      userId: options.loggingContext?.userId,
      sessionId: options.loggingContext?.sessionId,
      source: options.loggingContext?.source ?? options.loggingContext?.nodeName ?? 'router',
      provider: providerId,
      model,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheTokens: totalCache,
      reasoningTokens: 0,
      durationMs: Date.now() - startTime,
      success: true,
    });
  }

  if (options.loggingContext) {
    activityHelpers.logLLMCall(
      options.loggingContext.userId,
      options.loggingContext.sessionId,
      options.loggingContext.turnId,
      options.loggingContext.nodeName,
      model,
      providerId,
      {
        input: totalInput,
        output: totalOutput,
        cache: totalCache,
      },
      Date.now() - startTime,
      undefined,
      undefined,
      {
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        response: {
          content: '',
          finishReason: 'stop',
        },
      }
    ).catch(() => {});
  }
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

// Re-export CacheableSystemBlock for convenience
export type { CacheableSystemBlock };

export default {
  createCompletion,
  streamCompletion,
  isProviderAvailable,
  getAvailableProviders,
};
