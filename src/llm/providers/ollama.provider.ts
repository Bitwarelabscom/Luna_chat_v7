import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; think?: boolean } = {}
): Promise<CompletionResult> {
  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        think: options.think ?? false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama completion failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      message: { content: string; thinking?: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

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

    return {
      content,
      thinking: thinking || undefined,
      tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0),
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
      model,
      provider: 'ollama',
    };
  } catch (error) {
    logger.error('Ollama completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; think?: boolean } = {}
): AsyncGenerator<StreamChunk> {
  try {
    const response = await fetch(`${config.ollama.url}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        think: options.think ?? false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama stream failed: ${response.status} ${errorText}`);
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
    logger.error('Ollama stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.ollama.url;
}
