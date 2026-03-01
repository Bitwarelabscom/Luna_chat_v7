import crypto from 'crypto';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import type { OpenAITool, OpenAIToolCall, ToolMessage, ToolCompletionResult } from './anthropic.provider.js';
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

// Parts that support text, function calls, and function responses
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContentWithTools {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface GeminiResponseWithTools {
  candidates?: Array<{
    content: { parts: GeminiPart[] };
    finishReason: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
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

// ============================================
// Tool Calling Support
// ============================================

/**
 * Convert OpenAI tool format to Gemini functionDeclarations
 */
function convertToolsToGemini(tools: OpenAITool[]): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> {
  const declarations: GeminiFunctionDeclaration[] = tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description || '',
    ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}),
  }));
  return [{ functionDeclarations: declarations }];
}

/**
 * Convert messages with tool calls/results to Gemini format.
 *
 * Handles: system extraction, assistant tool_calls -> functionCall parts,
 * tool results -> functionResponse parts (batched for consecutive results),
 * and regular user/assistant text messages.
 */
function convertToolMessagesToGemini(
  messages: ToolMessage[]
): { contents: GeminiContentWithTools[]; systemInstruction?: { parts: { text: string }[] } } {
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  // Build tool_call_id -> function_name lookup (Gemini functionResponse needs name, not id)
  const toolCallIdToName: Record<string, string> = {};
  for (const msg of chatMessages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallIdToName[tc.id] = tc.function.name;
      }
    }
  }

  const contents: GeminiContentWithTools[] = [];
  let pendingToolResponses: GeminiPart[] = [];

  const flushToolResponses = () => {
    if (pendingToolResponses.length > 0) {
      // Batch into a single user message (Gemini rejects consecutive same-role)
      contents.push({ role: 'user', parts: pendingToolResponses });
      pendingToolResponses = [];
    }
  };

  for (const msg of chatMessages) {
    if (msg.role === 'tool') {
      // Accumulate tool responses
      const funcName = toolCallIdToName[msg.tool_call_id || ''] || 'unknown';
      let responseObj: Record<string, unknown>;
      try {
        responseObj = JSON.parse(msg.content);
      } catch {
        responseObj = { result: msg.content };
      }
      pendingToolResponses.push({
        functionResponse: { name: funcName, response: responseObj },
      });
    } else {
      // Flush any pending tool responses before a non-tool message
      flushToolResponses();

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant with tool calls -> model with functionCall parts
        const parts: GeminiPart[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
            },
          });
        }
        contents.push({ role: 'model', parts });
      } else {
        // Regular user or assistant message
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content || '' }],
        });
      }
    }
  }

  // Flush remaining tool responses
  flushToolResponses();

  const result: { contents: GeminiContentWithTools[]; systemInstruction?: { parts: { text: string }[] } } = { contents };

  if (systemMessages.length > 0) {
    result.systemInstruction = {
      parts: [{ text: systemMessages.map(m => m.content).join('\n\n') }],
    };
  }

  return result;
}

/**
 * Extract tool calls from Gemini response parts into OpenAI-compatible format.
 * Gemini does not return tool call IDs, so we generate synthetic ones.
 */
function extractGeminiToolCalls(parts: GeminiPart[]): OpenAIToolCall[] {
  const toolCalls: OpenAIToolCall[] = [];
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${crypto.randomUUID()}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }
  return toolCalls;
}

/**
 * Create completion with tool calling support.
 * Converts OpenAI tool format to Gemini native function calling.
 */
export async function createCompletionWithTools(
  model: string,
  messages: ToolMessage[],
  tools: OpenAITool[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<ToolCompletionResult> {
  try {
    const { contents, systemInstruction } = convertToolMessagesToGemini(messages);
    const geminiTools = convertToolsToGemini(tools);

    const response = await fetch(
      `${BASE_URL}/models/${model}:generateContent?key=${config.google?.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction,
          tools: geminiTools,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI tool completion failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as GeminiResponseWithTools;

    // Check for prompt-level blocks
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
    }

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('Gemini returned no response candidates');
    }

    const candidate = data.candidates[0];
    const finishReason = candidate.finishReason;

    // Check for safety/recitation blocks
    if (finishReason === 'SAFETY') {
      throw new Error('Gemini blocked response due to safety filters');
    } else if (finishReason === 'RECITATION') {
      throw new Error('Gemini blocked response due to recitation concerns');
    }

    const parts = candidate.content?.parts || [];

    // Extract text content
    const textContent = parts
      .filter(p => p.text)
      .map(p => p.text!)
      .join('');

    // Extract tool calls
    const toolCalls = extractGeminiToolCalls(parts);

    // Gemini always returns "STOP" even for function calls - detect via parts
    let mappedFinishReason = 'stop';
    if (toolCalls.length > 0) {
      mappedFinishReason = 'tool_calls';
    } else if (finishReason === 'MAX_TOKENS') {
      mappedFinishReason = 'length';
    }

    const promptTokens = data.usageMetadata?.promptTokenCount || 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;

    logger.debug('Google tool completion', {
      model,
      toolCallCount: toolCalls.length,
      finishReason: mappedFinishReason,
      promptTokens,
      completionTokens,
    });

    return {
      content: textContent,
      tokensUsed: data.usageMetadata?.totalTokenCount || 0,
      promptTokens,
      completionTokens,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: mappedFinishReason,
    };
  } catch (error) {
    logger.error('Google AI tool completion failed', { error: (error as Error).message, model });
    throw error;
  }
}
