import Groq from 'groq-sdk';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    if (!config.groq?.apiKey) {
      throw new Error('Groq API key not configured');
    }
    client = new Groq({ apiKey: config.groq.apiKey });
  }
  return client;
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const groq = getClient();

  try {
    const response = await groq.chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      model,
      provider: 'groq',
    };
  } catch (error) {
    logger.error('Groq completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const groq = getClient();

  try {
    const stream = await groq.chat.completions.create({
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

      // Groq includes usage in the final chunk
      if (chunk.x_groq?.usage) {
        tokensUsed = chunk.x_groq.usage.total_tokens;
      }
    }

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('Groq stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.groq?.apiKey;
}
