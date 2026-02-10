import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  };
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

    // Check for prompt-level blocks
    if (data.promptFeedback?.blockReason) {
      const reason = data.promptFeedback.blockReason;
      const ratings = data.promptFeedback.safetyRatings || [];
      logger.warn('Gemini prompt blocked', {
        model,
        blockReason: reason,
        safetyRatings: ratings,
      });
      throw new Error(`Gemini blocked the prompt: ${reason}`);
    }

    // Check for missing candidates
    if (!data.candidates || data.candidates.length === 0) {
      logger.warn('Gemini returned no candidates', {
        model,
        promptFeedback: data.promptFeedback,
        usageMetadata: data.usageMetadata,
      });
      throw new Error('Gemini returned no response candidates');
    }

    const candidate = data.candidates[0];
    const finishReason = candidate.finishReason;

    // Check for non-STOP finish reasons
    if (finishReason !== 'STOP' && finishReason !== 'stop') {
      logger.warn('Gemini finished with non-STOP reason', {
        model,
        finishReason,
        safetyRatings: candidate.safetyRatings,
        content: candidate.content?.parts?.[0]?.text?.substring(0, 100) || '(empty)',
      });

      if (finishReason === 'SAFETY') {
        throw new Error(`Gemini blocked response due to safety filters`);
      } else if (finishReason === 'RECITATION') {
        throw new Error(`Gemini blocked response due to recitation concerns`);
      } else {
        throw new Error(`Gemini stopped generation: ${finishReason}`);
      }
    }

    const content = candidate.content?.parts?.[0]?.text || '';

    // Log warning if we got empty content despite STOP finish reason
    if (!content) {
      logger.warn('Gemini returned empty content despite STOP finish reason', {
        model,
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        finishReason,
      });
    }

    return {
      content,
      tokensUsed: data.usageMetadata?.totalTokenCount || 0,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
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

              // Check for prompt-level blocks
              if (data.promptFeedback?.blockReason) {
                const reason = data.promptFeedback.blockReason;
                logger.warn('Gemini prompt blocked (streaming)', {
                  model,
                  blockReason: reason,
                });
                throw new Error(`Gemini blocked the prompt: ${reason}`);
              }

              const candidate = data.candidates?.[0];
              if (candidate) {
                const finishReason = candidate.finishReason;

                // Check for problematic finish reasons
                if (finishReason && finishReason !== 'STOP' && finishReason !== 'stop') {
                  logger.warn('Gemini stream finished with non-STOP reason', {
                    model,
                    finishReason,
                  });

                  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
                    throw new Error(`Gemini blocked response: ${finishReason}`);
                  }
                }

                const text = candidate.content?.parts?.[0]?.text;
                if (text) {
                  yield { type: 'content', content: text };
                }
              }

              if (data.usageMetadata?.totalTokenCount) {
                tokensUsed = data.usageMetadata.totalTokenCount;
              }
            } catch (error) {
              // Re-throw our custom errors, skip malformed JSON
              if (error instanceof Error && error.message.includes('Gemini')) {
                throw error;
              }
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
