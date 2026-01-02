import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

/**
 * Cacheable system prompt block for Anthropic prompt caching
 * When cache=true, the block gets cache_control: {type: 'ephemeral'} marker
 */
export interface CacheableSystemBlock {
  text: string;
  cache: boolean;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropic?.apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

// Convert our message format to Anthropic's format (legacy - single string system)
function convertMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
} {
  let system: string | undefined;
  const converted: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      converted.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return { system, messages: converted };
}

/**
 * Convert messages with cache-optimized system blocks
 * Uses Anthropic's content block format with cache_control markers
 */
function convertMessagesWithCacheBlocks(
  messages: ChatMessage[],
  systemBlocks: CacheableSystemBlock[]
): {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
} {
  // Convert system blocks to Anthropic format with cache_control markers
  const system = systemBlocks.map(block => {
    const textBlock: Anthropic.TextBlockParam & { cache_control?: { type: 'ephemeral' } } = {
      type: 'text',
      text: block.text,
    };
    // Add cache_control to blocks that should be cached
    if (block.cache) {
      textBlock.cache_control = { type: 'ephemeral' };
    }
    return textBlock;
  });

  // Convert conversation messages (filter out any system messages)
  const converted: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role !== 'system') {
      converted.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return { system, messages: converted };
}

/**
 * Log cache metrics for monitoring optimization effectiveness
 */
function logCacheMetrics(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
  hasCacheBlocks: boolean
): void {
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const hitRate = usage.input_tokens > 0
    ? ((cacheRead / usage.input_tokens) * 100).toFixed(1)
    : '0.0';

  logger.info('Anthropic cache metrics', {
    model,
    hitRate: `${hitRate}%`,
    cacheRead,
    cacheWrite,
    totalInput: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheBlocksEnabled: hasCacheBlocks,
  });
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    systemBlocks?: CacheableSystemBlock[];
  } = {}
): Promise<CompletionResult> {
  const anthropic = getClient();

  let system: string | Anthropic.TextBlockParam[] | undefined;
  let convertedMessages: Anthropic.MessageParam[];

  // Use cache-optimized blocks if provided, otherwise fall back to legacy
  if (options.systemBlocks && options.systemBlocks.length > 0) {
    const result = convertMessagesWithCacheBlocks(messages, options.systemBlocks);
    system = result.system;
    convertedMessages = result.messages;
  } else {
    const result = convertMessages(messages);
    system = result.system;
    convertedMessages = result.messages;
  }

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: options.maxTokens || 4096,
      system: system as any, // Type assertion needed for mixed string/block types
      messages: convertedMessages,
      temperature: options.temperature ?? 0.7,
    });

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('');

    // Extract cache tokens if available (from prompt caching)
    const usage = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    const cacheTokens = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);

    // Log cache metrics
    logCacheMetrics(model, usage, !!options.systemBlocks);

    return {
      content,
      tokensUsed: usage.input_tokens + usage.output_tokens,
      model,
      provider: 'anthropic',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheTokens,
    };
  } catch (error) {
    logger.error('Anthropic completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    systemBlocks?: CacheableSystemBlock[];
  } = {}
): AsyncGenerator<StreamChunk> {
  const anthropic = getClient();

  let system: string | Anthropic.TextBlockParam[] | undefined;
  let convertedMessages: Anthropic.MessageParam[];

  // Use cache-optimized blocks if provided, otherwise fall back to legacy
  if (options.systemBlocks && options.systemBlocks.length > 0) {
    const result = convertMessagesWithCacheBlocks(messages, options.systemBlocks);
    system = result.system;
    convertedMessages = result.messages;
  } else {
    const result = convertMessages(messages);
    system = result.system;
    convertedMessages = result.messages;
  }

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: options.maxTokens || 4096,
      system: system as any, // Type assertion needed for mixed string/block types
      messages: convertedMessages,
      temperature: options.temperature ?? 0.7,
    });

    let tokensUsed = 0;

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'content', content: delta.text };
        }
      }

      if (event.type === 'message_delta') {
        const usage = (event as { usage?: { output_tokens: number } }).usage;
        if (usage) {
          tokensUsed = usage.output_tokens;
        }
      }
    }

    // Get final message for accurate token count
    const finalMessage = await stream.finalMessage();
    const finalUsage = finalMessage.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    tokensUsed = finalUsage.input_tokens + finalUsage.output_tokens;
    const cacheTokens = (finalUsage.cache_read_input_tokens || 0) + (finalUsage.cache_creation_input_tokens || 0);

    // Log cache metrics
    logCacheMetrics(model, finalUsage, !!options.systemBlocks);

    yield {
      type: 'done',
      tokensUsed,
      inputTokens: finalUsage.input_tokens,
      outputTokens: finalUsage.output_tokens,
      cacheTokens,
    };
  } catch (error) {
    logger.error('Anthropic stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.anthropic?.apiKey;
}

// ============================================
// Tool Calling Support
// ============================================

/**
 * OpenAI-compatible tool definition
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * OpenAI-compatible tool call
 */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Message with potential tool calls/results
 */
export interface ToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/**
 * Result from tool-enabled completion
 */
export interface ToolCompletionResult {
  content: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls?: OpenAIToolCall[];
  finishReason: string;
}

/**
 * Convert OpenAI tool format to Anthropic tool format
 */
function convertToolsToAnthropic(tools: OpenAITool[]): Anthropic.Tool[] {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description || '',
    input_schema: (tool.function.parameters || { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Convert messages with tool calls/results to Anthropic format
 */
function convertToolMessagesToAnthropic(
  messages: ToolMessage[]
): Anthropic.MessageParam[] {
  const converted: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    // Skip system messages (handled separately)
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      // Tool result - Anthropic expects this as a user message with tool_result block
      converted.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id!,
          content: msg.content,
        }],
      });
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant message with tool calls
      const content: Anthropic.ContentBlockParam[] = [];

      // Add text content if present
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add tool use blocks
      for (const toolCall of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || '{}'),
        });
      }

      converted.push({ role: 'assistant', content });
    } else {
      // Regular message
      converted.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return converted;
}

/**
 * Extract tool calls from Anthropic response
 */
function extractToolCalls(content: Anthropic.ContentBlock[]): OpenAIToolCall[] {
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of content) {
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  return toolCalls;
}

/**
 * Create completion with tool calling support
 * Converts OpenAI tool format to Anthropic native format
 */
export async function createCompletionWithTools(
  model: string,
  messages: ToolMessage[],
  tools: OpenAITool[],
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<ToolCompletionResult> {
  const anthropic = getClient();

  // Extract system message
  const systemMessage = messages.find(m => m.role === 'system');
  const systemPrompt = systemMessage?.content;

  // Convert messages and tools
  const convertedMessages = convertToolMessagesToAnthropic(messages);
  const convertedTools = convertToolsToAnthropic(tools);

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: convertedMessages,
      tools: convertedTools,
      temperature: options.temperature ?? 0.7,
    });

    // Extract text content
    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('');

    // Extract tool calls
    const toolCalls = extractToolCalls(response.content);

    // Map Anthropic stop reasons to OpenAI format
    let finishReason = 'stop';
    if (response.stop_reason === 'tool_use') {
      finishReason = 'tool_calls';
    } else if (response.stop_reason === 'max_tokens') {
      finishReason = 'length';
    }

    const usage = response.usage;

    logger.debug('Anthropic tool completion', {
      model,
      toolCallCount: toolCalls.length,
      finishReason,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });

    return {
      content: textContent,
      tokensUsed: usage.input_tokens + usage.output_tokens,
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
    };
  } catch (error) {
    logger.error('Anthropic tool completion failed', {
      error: (error as Error).message,
      model,
    });
    throw error;
  }
}
