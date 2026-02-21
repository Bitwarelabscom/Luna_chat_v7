import type { CompletionResult, ChatMessage, ProviderId } from './types.js';
import { createCompletion, type LLMLoggingContext } from './router.js';
import {
  getBackgroundFeatureModelConfig,
  type BackgroundLlmFeature,
  DEFAULT_BACKGROUND_LLM_SETTINGS,
} from '../settings/background-llm-settings.service.js';
import logger from '../utils/logger.js';

interface BackgroundCompletionOptions {
  userId?: string;
  sessionId?: string;
  feature: BackgroundLlmFeature;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  loggingContext?: LLMLoggingContext;
}

async function runModel(
  provider: ProviderId,
  model: string,
  options: BackgroundCompletionOptions
): Promise<CompletionResult> {
  return createCompletion(provider, model, options.messages, {
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    loggingContext: options.loggingContext,
  });
}

export async function createBackgroundCompletionWithFallback(
  options: BackgroundCompletionOptions
): Promise<CompletionResult> {
  const fallbackDefaults = DEFAULT_BACKGROUND_LLM_SETTINGS[options.feature];
  const configured = options.userId
    ? await getBackgroundFeatureModelConfig(options.userId, options.feature)
    : fallbackDefaults;

  const primary = configured.primary;
  const fallback = configured.fallback;

  try {
    const primaryResult = await runModel(primary.provider, primary.model, options);
    if (primaryResult.content && primaryResult.content.trim().length > 0) {
      return primaryResult;
    }
    throw new Error('Primary returned empty response');
  } catch (primaryError) {
    const primaryMessage = (primaryError as Error).message;
    logger.warn('Primary background model failed, trying fallback', {
      feature: options.feature,
      primaryProvider: primary.provider,
      primaryModel: primary.model,
      fallbackProvider: fallback.provider,
      fallbackModel: fallback.model,
      error: primaryMessage,
      userId: options.userId,
      sessionId: options.sessionId,
    });

    if (primary.provider === fallback.provider && primary.model === fallback.model) {
      throw primaryError;
    }

    try {
      const fallbackResult = await runModel(fallback.provider, fallback.model, options);
      if (fallbackResult.content && fallbackResult.content.trim().length > 0) {
        return fallbackResult;
      }
      throw new Error('Fallback returned empty response');
    } catch (fallbackError) {
      const fallbackMessage = (fallbackError as Error).message;
      throw new Error(
        `Background LLM failed for feature "${options.feature}". Primary: ${primaryMessage}. Fallback: ${fallbackMessage}`
      );
    }
  }
}
