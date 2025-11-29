import OpenAI from 'openai';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return client;
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const openai = getClient();

  try {
    // Skip temperature for gpt-5 models (only supports default)
    const isGpt5 = model.includes('gpt-5');
    const response = await openai.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      ...(isGpt5 ? {} : { temperature: options.temperature ?? 0.7 }),
      max_completion_tokens: options.maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      model,
      provider: 'openai',
    };
  } catch (error) {
    logger.error('OpenAI completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const openai = getClient();

  try {
    // Skip temperature for gpt-5 models (only supports default)
    const isGpt5 = model.includes('gpt-5');
    const stream = await openai.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      ...(isGpt5 ? {} : { temperature: options.temperature ?? 0.7 }),
      max_completion_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let tokensUsed = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield { type: 'content', content };
      }

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('OpenAI stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.openai.apiKey;
}
