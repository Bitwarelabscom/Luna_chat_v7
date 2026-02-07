import OpenAI from 'openai';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.moonshot?.apiKey,
      baseURL: 'https://api.moonshot.cn/v1',
    });
  }
  return client;
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const moonshot = getClient();

  try {
    const response = await moonshot.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model,
      provider: 'moonshot',
    };
  } catch (error) {
    logger.error('Moonshot completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const moonshot = getClient();

  try {
    const stream = await moonshot.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let tokensUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield { type: 'content', content };
      }

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    yield {
      type: 'done',
      tokensUsed,
      inputTokens,
      outputTokens,
    };
  } catch (error) {
    logger.error('Moonshot stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.moonshot?.apiKey && config.moonshot?.enabled !== false;
}
