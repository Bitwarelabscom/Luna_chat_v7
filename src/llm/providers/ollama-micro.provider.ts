import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

const OLLAMA_URL = config.ollamaMicro?.url || 'http://10.0.0.3:11434';
const DEFAULT_NUM_CTX = config.ollamaMicro?.numCtx ?? 4096;
const MAX_CONCURRENT = 4;

// Semaphore to limit concurrent requests
let activeCount = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => waitQueue.push(resolve));
}

function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) {
    next();
  } else {
    activeCount--;
  }
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; numCtx?: number } = {}
): Promise<CompletionResult> {
  await acquireSlot();
  try {
    const mapped = messages.map(m => ({ role: m.role, content: m.content }));
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: mapped,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 50,
          num_ctx: options.numCtx ?? DEFAULT_NUM_CTX,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama Micro completion failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
      total_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
    };

    const promptTokens = data.prompt_eval_count || 0;
    const completionTokens = data.eval_count || 0;
    const totalMs = data.total_duration ? Math.round(data.total_duration / 1e6) : 0;
    const evalMs = data.eval_duration ? Math.round(data.eval_duration / 1e6) : 0;
    const tokPerSec = evalMs > 0 ? Math.round((completionTokens / evalMs) * 1000) : 0;

    logger.info('Ollama Micro completion done', {
      model,
      promptTokens,
      completionTokens,
      totalMs,
      tokPerSec,
    });

    return {
      content: data.message?.content || '',
      tokensUsed: promptTokens + completionTokens,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      model,
      provider: 'ollama_micro',
    };
  } catch (error) {
    logger.error('Ollama Micro completion failed', { error: (error as Error).message, model });
    throw error;
  } finally {
    releaseSlot();
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; numCtx?: number } = {}
): AsyncGenerator<StreamChunk> {
  await acquireSlot();
  try {
    const mapped = messages.map(m => ({ role: m.role, content: m.content }));
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: mapped,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 50,
          num_ctx: options.numCtx ?? DEFAULT_NUM_CTX,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama Micro stream failed: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let tokensUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;

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
            inputTokens = data.prompt_eval_count || 0;
            outputTokens = data.eval_count || 0;
            tokensUsed = inputTokens + outputTokens;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    yield { type: 'done', tokensUsed, inputTokens, outputTokens };
  } catch (error) {
    logger.error('Ollama Micro stream failed', { error: (error as Error).message, model });
    throw error;
  } finally {
    releaseSlot();
  }
}

export function isConfigured(): boolean {
  return !!OLLAMA_URL && config.ollamaMicro?.enabled !== false;
}
