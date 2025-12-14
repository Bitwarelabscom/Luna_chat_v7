import OpenAI from 'openai';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

// xAI uses OpenAI-compatible API
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.xai?.apiKey) {
      throw new Error('xAI API key not configured');
    }
    client = new OpenAI({
      apiKey: config.xai.apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
  }
  return client;
}

// Check if model supports reasoning (Grok 4.1 Fast, Grok 4 Fast, or explicit reasoning models)
function isReasoningModel(model: string): boolean {
  const id = model.toLowerCase();
  return id.includes('fast') || id.includes('reasoning');
}

export interface XAICompletionOptions {
  temperature?: number;
  maxTokens?: number;
  reasoning?: boolean;  // Enable/disable reasoning for supported models
}

export interface XAICompletionResult extends CompletionResult {
  reasoningDetails?: string[];  // Thinking steps from the model
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: XAICompletionOptions = {}
): Promise<XAICompletionResult> {
  const xai = getClient();

  try {
    // Enable reasoning by default for reasoning-capable models
    const enableReasoning = isReasoningModel(model) && (options.reasoning !== false);

    const response = await xai.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      // Add reasoning parameter for supported models
      ...(enableReasoning && {
        reasoning: { enabled: true }
      }),
    } as any);  // Cast to any for xAI-specific parameters

    // Extract reasoning details if present (xAI-specific response field)
    const choice = response.choices[0] as any;
    const reasoningDetails = choice?.message?.reasoning_details;

    if (reasoningDetails) {
      logger.debug('xAI reasoning received', { model, steps: reasoningDetails.length });
    }

    return {
      content: choice?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      model,
      provider: 'xai',
      reasoningDetails: reasoningDetails || undefined,
    };
  } catch (error) {
    logger.error('xAI completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: XAICompletionOptions = {}
): AsyncGenerator<StreamChunk> {
  const xai = getClient();

  try {
    // Enable reasoning by default for reasoning-capable models
    const enableReasoning = isReasoningModel(model) && (options.reasoning !== false);

    const stream = await xai.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      // Add reasoning parameter for supported models
      ...(enableReasoning && {
        reasoning: { enabled: true }
      }),
    } as any) as unknown as AsyncIterable<any>;  // Cast to async iterable for xAI-specific response

    let tokensUsed = 0;

    for await (const chunk of stream) {
      const choice = (chunk as any).choices[0];

      // Check for reasoning content (comes before main content for thinking models)
      const reasoningContent = choice?.delta?.reasoning_content;
      if (reasoningContent) {
        yield { type: 'reasoning', content: reasoningContent };
      }

      // Regular content
      const content = choice?.delta?.content;
      if (content) {
        yield { type: 'content', content };
      }

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('xAI stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.xai?.apiKey;
}
