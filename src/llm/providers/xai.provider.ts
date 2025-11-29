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

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const xai = getClient();

  try {
    const response = await xai.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      model,
      provider: 'xai',
    };
  } catch (error) {
    logger.error('xAI completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const xai = getClient();

  try {
    const stream = await xai.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
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
    logger.error('xAI stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.xai?.apiKey;
}
