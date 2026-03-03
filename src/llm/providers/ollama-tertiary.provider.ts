import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

const OLLAMA_URL = config.ollamaTertiary?.url || 'http://10.0.0.30:11434';
const OLLAMA_TERTIARY_NUM_CTX = config.ollamaTertiary?.numCtx ?? 32768;
const MAX_CONCURRENT = 2;

// Semaphore to limit concurrent Ollama requests (single GPU serializes internally)
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
  options: { temperature?: number; maxTokens?: number; numCtx?: number; think?: boolean } = {}
): Promise<CompletionResult> {
  await acquireSlot();
  try {
    const mapped = messages.map(m => ({ role: m.role, content: m.content }));
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: mapped,
        stream: false,
        think: options.think ?? false,
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
      message: { content: string; thinking?: string };
      eval_count?: number;
      prompt_eval_count?: number;
      total_duration?: number;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
    };

    const promptTokens = data.prompt_eval_count || 0;
    const completionTokens = data.eval_count || 0;
    const totalMs = data.total_duration ? Math.round(data.total_duration / 1e6) : 0;
    const promptMs = data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : 0;
    const evalMs = data.eval_duration ? Math.round(data.eval_duration / 1e6) : 0;
    const tokPerSec = evalMs > 0 ? Math.round((completionTokens / evalMs) * 1000) : 0;

    // Extract thinking from Ollama's native thinking field or <think> tags in content
    let content = data.message?.content || '';
    let thinking = data.message?.thinking || '';
    if (!thinking && content.includes('<think>')) {
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>\s*/, '').trim();
      }
    }

    logger.info('Ollama Tertiary completion done', {
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      totalMs,
      promptMs,
      evalMs,
      tokPerSec,
      hasThinking: !!thinking,
    });

    return {
      content,
      thinking: thinking || undefined,
      tokensUsed: promptTokens + completionTokens,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      model,
      provider: 'ollama_tertiary',
    };
  } catch (error) {
    logger.error('Ollama Tertiary completion failed', { error: (error as Error).message, model });
    throw error;
  } finally {
    releaseSlot();
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; numCtx?: number; think?: boolean } = {}
): AsyncGenerator<StreamChunk> {
  await acquireSlot();
  try {
    const mapped = messages.map(m => ({ role: m.role, content: m.content }));
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: mapped,
        stream: true,
        think: options.think ?? false,
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
            message?: { content: string; thinking?: string };
            done: boolean;
            eval_count?: number;
            prompt_eval_count?: number;
          };

          // Ollama returns thinking in a separate field when think: true
          if (data.message?.thinking) {
            yield { type: 'reasoning', content: data.message.thinking };
          }

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
    logger.error('Ollama Tertiary stream failed', { error: (error as Error).message, model });
    throw error;
  } finally {
    releaseSlot();
  }
}

export function isConfigured(): boolean {
  return !!OLLAMA_URL && config.ollamaTertiary?.enabled !== false;
}
