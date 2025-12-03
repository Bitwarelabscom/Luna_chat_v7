import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

function convertMessages(messages: ChatMessage[]): { contents: GeminiContent[]; systemInstruction?: { parts: { text: string }[] } } {
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents: GeminiContent[] = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const result: { contents: GeminiContent[]; systemInstruction?: { parts: { text: string }[] } } = { contents };

  if (systemMessages.length > 0) {
    result.systemInstruction = {
      parts: [{ text: systemMessages.map(m => m.content).join('\n\n') }],
    };
  }

  return result;
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  try {
    const { contents, systemInstruction } = convertMessages(messages);

    const response = await fetch(
      `${BASE_URL}/models/${model}:generateContent?key=${config.google?.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          systemInstruction,
          generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI completion failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as GeminiResponse;

    return {
      content: data.candidates[0]?.content?.parts[0]?.text || '',
      tokensUsed: data.usageMetadata?.totalTokenCount || 0,
      model,
      provider: 'google',
    };
  } catch (error) {
    logger.error('Google AI completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  try {
    const { contents, systemInstruction } = convertMessages(messages);

    const response = await fetch(
      `${BASE_URL}/models/${model}:streamGenerateContent?key=${config.google?.apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          systemInstruction,
          generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI stream failed: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let tokensUsed = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr) {
            try {
              const data = JSON.parse(jsonStr) as GeminiResponse;
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                yield { type: 'content', content: text };
              }
              if (data.usageMetadata?.totalTokenCount) {
                tokensUsed = data.usageMetadata.totalTokenCount;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    }

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('Google AI stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.google?.apiKey;
}
