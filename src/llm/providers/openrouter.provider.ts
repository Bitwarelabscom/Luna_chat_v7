import OpenAI from 'openai';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openrouter?.apiKey || '',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://luna-chat.bitwarelabs.com',
        'X-Title': 'Luna Chat',
      },
    });
  }
  return client;
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const openrouter = getClient();

  try {
    const response = await openrouter.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      model,
      provider: 'openrouter',
    };
  } catch (error) {
    logger.error('OpenRouter completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const openrouter = getClient();

  try {
    const stream = await openrouter.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stream: true,
    });

    let tokensUsed = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield { type: 'content', content };
      }

      // OpenRouter may include usage in final chunk
      if ((chunk as unknown as { usage?: { total_tokens: number } }).usage) {
        tokensUsed = (chunk as unknown as { usage: { total_tokens: number } }).usage.total_tokens;
      }
    }

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('OpenRouter stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.openrouter?.apiKey;
}
