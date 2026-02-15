import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

const OLLAMA_URL = config.ollamaTertiary?.url || 'http://10.0.0.30:11434';
const OLLAMA_TERTIARY_NUM_CTX = config.ollamaTertiary?.numCtx ?? 65536;

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; numCtx?: number } = {}
): Promise<CompletionResult> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
          num_ctx: options.numCtx ?? OLLAMA_TERTIARY_NUM_CTX,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama Tertiary completion failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: data.message?.content || '',
      tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0),
      model,
      provider: 'ollama_tertiary',
    };
  } catch (error) {
    logger.error('Ollama Tertiary completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; numCtx?: number } = {}
): AsyncGenerator<StreamChunk> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
          num_ctx: options.numCtx ?? OLLAMA_TERTIARY_NUM_CTX,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama Tertiary stream failed: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let tokensUsed = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as {
            message?: { content: string };
            done: boolean;
            eval_count?: number;
            prompt_eval_count?: number;
          };

          if (data.message?.content) {
            yield { type: 'content', content: data.message.content };
          }

          if (data.done) {
            tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('Ollama Tertiary stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!OLLAMA_URL && config.ollamaTertiary?.enabled !== false;
}
