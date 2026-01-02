import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

// Sanhedrin A2A Protocol types
interface SanhedrinMessage {
  role: 'user' | 'agent';
  parts: Array<{ text: string }>;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: 'message/send' | 'message/stream';
  params: {
    message: SanhedrinMessage;
  };
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    task: {
      id: string;
      status: {
        state: string;
      };
      artifacts?: Array<{
        parts: Array<{ text?: string }>;
      }>;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

function getBaseUrl(): string {
  return config.sanhedrin?.baseUrl || 'http://localhost:8000';
}

function getTimeout(): number {
  return config.sanhedrin?.timeout || 120000;
}

/**
 * Convert Luna Chat messages to Sanhedrin prompt format.
 * Combines system and user messages into a single prompt.
 */
function formatMessagesForSanhedrin(messages: ChatMessage[]): string {
  const parts: string[] = [];

  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    parts.push(`[System Instructions]\n${systemMsg.content}`);
  }

  // Add conversation messages
  for (const msg of messages.filter(m => m.role !== 'system')) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    parts.push(`\n[${role}]\n${msg.content}`);
  }

  return parts.join('\n');
}

/**
 * Extract text content from Sanhedrin response artifacts
 */
function extractContentFromResponse(response: JSONRPCResponse): string {
  if (response.error) {
    throw new Error(`Sanhedrin error: ${response.error.message}`);
  }

  const artifacts = response.result?.task?.artifacts || [];
  const textParts: string[] = [];

  for (const artifact of artifacts) {
    for (const part of artifact.parts) {
      if (part.text) {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join('\n');
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  _options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const baseUrl = getBaseUrl();
  const timeout = getTimeout();

  // Convert messages to Sanhedrin format
  const prompt = formatMessagesForSanhedrin(messages);

  const request: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ text: prompt }],
      },
    },
  };

  logger.debug('Sanhedrin request', { baseUrl, model, promptLength: prompt.length });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/a2a`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Sanhedrin HTTP error: ${response.status} ${response.statusText}`);
    }

    const jsonResponse = await response.json() as JSONRPCResponse;
    const content = extractContentFromResponse(jsonResponse);

    logger.debug('Sanhedrin response received', { model, contentLength: content.length });

    return {
      content,
      tokensUsed: 0, // Sanhedrin doesn't provide token counts
      model,
      provider: 'sanhedrin',
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      logger.error('Sanhedrin request timeout', { timeout, model });
      throw new Error(`Sanhedrin request timed out after ${timeout}ms`);
    }
    logger.error('Sanhedrin completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  _options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const baseUrl = getBaseUrl();
  const timeout = getTimeout();

  // Convert messages to Sanhedrin format
  const prompt = formatMessagesForSanhedrin(messages);

  const request: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/stream',
    params: {
      message: {
        role: 'user',
        parts: [{ text: prompt }],
      },
    },
  };

  logger.debug('Sanhedrin stream request', { baseUrl, model });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/a2a/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Sanhedrin HTTP error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done', tokensUsed: 0 };
            return;
          }

          try {
            const event = JSON.parse(data);

            // Handle task.artifact events with content
            if (event.type === 'task.artifact' && event.artifact?.parts) {
              for (const part of event.artifact.parts) {
                if (part.text) {
                  yield { type: 'content', content: part.text };
                }
              }
            }

            // Handle task.status events
            if (event.type === 'task.status') {
              if (event.status?.state === 'completed') {
                yield { type: 'done', tokensUsed: 0 };
                return;
              }
              if (event.status?.state === 'failed') {
                throw new Error(event.status.message || 'Task failed');
              }
            }
          } catch (parseError) {
            // Skip malformed JSON
            logger.debug('SSE parse error', { line, error: (parseError as Error).message });
          }
        }
      }
    }

    yield { type: 'done', tokensUsed: 0 };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      logger.error('Sanhedrin stream timeout', { timeout, model });
      throw new Error(`Sanhedrin stream timed out after ${timeout}ms`);
    }
    logger.error('Sanhedrin stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.sanhedrin?.baseUrl && config.sanhedrin?.enabled !== false;
}
