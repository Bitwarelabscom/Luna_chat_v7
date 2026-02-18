import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { SearchResult } from '../types/index.js';
import type { ProviderId } from './types.js';
import * as anthropicProvider from './providers/anthropic.provider.js';
import { activityHelpers } from '../activity/activity.service.js';

// Provider clients cache
const clients: Partial<Record<ProviderId, OpenAI>> = {};

function getClient(provider: ProviderId = 'openai'): OpenAI {
  if (!clients[provider]) {
    logger.info('Creating OpenAI client for provider', { provider });
    switch (provider) {
      case 'openai':
        clients.openai = new OpenAI({ apiKey: config.openai.apiKey });
        break;
      case 'groq':
        if (!config.groq?.apiKey) throw new Error('Groq API key not configured');
        clients.groq = new OpenAI({
          apiKey: config.groq.apiKey,
          baseURL: 'https://api.groq.com/openai/v1',
        });
        break;
      case 'xai':
        if (!config.xai?.apiKey) throw new Error('xAI API key not configured');
        clients.xai = new OpenAI({
          apiKey: config.xai.apiKey,
          baseURL: 'https://api.x.ai/v1',
        });
        break;
      case 'openrouter':
        if (!config.openrouter?.apiKey) throw new Error('OpenRouter API key not configured');
        clients.openrouter = new OpenAI({
          apiKey: config.openrouter.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'X-Title': 'Luna Chat',
          },
        });
        break;
      case 'moonshot':
        if (!config.moonshot?.apiKey) throw new Error('Moonshot API key not configured');
        clients.moonshot = new OpenAI({
          apiKey: config.moonshot.apiKey,
          baseURL: 'https://api.moonshot.ai/v1',
        });
        break;
      case 'ollama':
        clients.ollama = new OpenAI({
          apiKey: 'ollama', // Not used but required by SDK
          baseURL: `${config.ollama.url}/v1`,
        });
        break;
      case 'ollama_secondary':
        if (!config.ollamaSecondary?.url) throw new Error('Ollama Secondary URL not configured');
        clients.ollama_secondary = new OpenAI({
          apiKey: 'ollama',
          baseURL: `${config.ollamaSecondary.url}/v1`,
        });
        break;
      case 'ollama_tertiary':
        if (!config.ollamaTertiary?.url) throw new Error('Ollama Tertiary URL not configured');
        clients.ollama_tertiary = new OpenAI({
          apiKey: 'ollama',
          baseURL: `${config.ollamaTertiary.url}/v1`,
        });
        break;
      case 'anthropic':
        // Anthropic tool calling is handled separately via native provider
        // This error only triggers if someone tries to use the OpenAI client directly
        throw new Error('Anthropic should be routed through createChatCompletion, not getClient directly.');
      case 'google':
        // Google Gemini uses different API format, not OpenAI-compatible
        throw new Error('Google Gemini is not supported for chat with tool calling. Use OpenAI, Groq, xAI, or OpenRouter.');
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
  return clients[provider]!;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

/**
 * Logging context for automatic activity logging
 */
export interface LLMLoggingContext {
  userId: string;
  sessionId?: string;
  turnId?: string;
  source: string;  // 'voice-chat', 'trading-chat', 'chat', 'agents', etc.
  nodeName: string;  // Specific node name for the activity log
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  provider?: ProviderId;
  model?: string;
  reasoning?: boolean;  // For xAI Grok 4.1 Fast reasoning models
  loggingContext?: LLMLoggingContext;  // Optional logging context for activity tracking
  response_format?: OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'];
}

export interface ChatCompletionResult {
  content: string;
  reasoning?: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  finishReason: string;
}

export async function createChatCompletion(
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const {
    messages,
    tools,
    temperature = 0.7,
    maxTokens,
    provider = 'openai',
    model,
    reasoning,
    loggingContext,
    response_format,
  } = options;
  const resolvedMaxTokens = maxTokens ?? (provider === 'ollama_tertiary' ? 8192 : 4096);
  const tertiaryNumCtx = config.ollamaTertiary?.numCtx ?? 65536;

  const modelToUse = model || config.openai.model;
  const startTime = Date.now();

  // Helper to log LLM call if logging context is provided
  const logActivity = (result: ChatCompletionResult) => {
    if (loggingContext) {
      const durationMs = Date.now() - startTime;
      activityHelpers.logLLMCall(
        loggingContext.userId,
        loggingContext.sessionId,
        loggingContext.turnId,
        loggingContext.nodeName,
        modelToUse,
        provider,
        {
          input: result.promptTokens,
          output: result.completionTokens,
        },
        durationMs,
        undefined, // cost
        undefined, // reasoning
        {
          // Full request details for debugging/optimization
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            tool_calls: m.tool_calls,
            tool_call_id: m.tool_call_id,
          })),
          tools: tools?.map(t => ({
            name: t.function.name,
            description: t.function.description,
          })),
          temperature,
          maxTokens: resolvedMaxTokens,
          numCtx: provider === 'ollama_tertiary' ? tertiaryNumCtx : undefined,
          // Response details
          response: {
            content: result.content,
            finishReason: result.finishReason,
            toolCalls: result.toolCalls?.map(tc => ({
              name: tc.function.name,
              arguments: tc.function.arguments,
            })),
          },
        }
      ).catch(() => {}); // Non-blocking
    }
  };

  // Route Sanhedrin to native provider (no tool support)
  if (provider === 'sanhedrin') {
    if (tools && tools.length > 0) {
      throw new Error('Sanhedrin provider does not support tool calling. Use a different provider for voice chat.');
    }
    const sanhedrinProvider = await import('./providers/sanhedrin.provider.js');
    const result = await sanhedrinProvider.createCompletion(
      modelToUse,
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      { temperature, maxTokens: resolvedMaxTokens }
    );
    const completionResult: ChatCompletionResult = {
      content: result.content,
      tokensUsed: result.tokensUsed,
      promptTokens: 0,
      completionTokens: 0,
      toolCalls: undefined,
      finishReason: 'stop',
    };
    logActivity(completionResult);
    return completionResult;
  }

  // Route Moonshot to native provider (OpenAI SDK compatible but has its own stream handling)
  if (provider === 'moonshot') {
    const moonshotProvider = await import('./providers/moonshot.provider.js');
    const result = await moonshotProvider.createCompletion(
      modelToUse,
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      { temperature, maxTokens: resolvedMaxTokens }
    );
    const completionResult: ChatCompletionResult = {
      content: result.content,
      tokensUsed: result.tokensUsed,
      promptTokens: result.inputTokens || 0,
      completionTokens: result.outputTokens || 0,
      toolCalls: undefined, // Moonshot tool calling is limited, use native for now
      finishReason: 'stop',
    };
    logActivity(completionResult);
    return completionResult;
  }

  // Route Ollama to native provider (only if no tools, as native doesn't support them)
  if ((provider === 'ollama' || provider === 'ollama_secondary' || provider === 'ollama_tertiary') && (!tools || tools.length === 0)) {
    let ollamaProvider;
    if (provider === 'ollama') {
      ollamaProvider = await import('./providers/ollama.provider.js');
    } else if (provider === 'ollama_secondary') {
      ollamaProvider = await import('./providers/ollama-secondary.provider.js');
    } else {
      ollamaProvider = await import('./providers/ollama-tertiary.provider.js');
    }
    const result = await ollamaProvider.createCompletion(
      modelToUse,
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      provider === 'ollama_tertiary'
        ? { temperature, maxTokens: resolvedMaxTokens, numCtx: tertiaryNumCtx }
        : { temperature, maxTokens: resolvedMaxTokens }
    );
    const completionResult: ChatCompletionResult = {
      content: result.content,
      tokensUsed: result.tokensUsed,
      promptTokens: 0,
      completionTokens: 0,
      toolCalls: undefined,
      finishReason: 'stop',
    };
    logActivity(completionResult);
    return completionResult;
  }

  // Route Google AI to native provider (Gemini doesn't support tools via OpenAI SDK here yet)
  if (provider === 'google') {
    const googleProvider = await import('./providers/google.provider.js');
    const result = await googleProvider.createCompletion(
      modelToUse,
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      { temperature, maxTokens: resolvedMaxTokens }
    );
    const completionResult: ChatCompletionResult = {
      content: result.content,
      tokensUsed: result.tokensUsed,
      promptTokens: 0,
      completionTokens: 0,
      toolCalls: undefined,
      finishReason: 'stop',
    };
    logActivity(completionResult);
    return completionResult;
  }

  // Route Anthropic to native provider (required for tool calling, also works without tools)
  if (provider === 'anthropic') {
    if (tools && tools.length > 0) {
      logger.debug('Routing to native Anthropic provider for tool calling', { model: modelToUse });
      const result = await anthropicProvider.createCompletionWithTools(
        modelToUse,
        messages as anthropicProvider.ToolMessage[],
        tools as anthropicProvider.OpenAITool[],
        { temperature, maxTokens: resolvedMaxTokens }
      );
      const completionResult: ChatCompletionResult = {
        content: result.content,
        tokensUsed: result.tokensUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        toolCalls: result.toolCalls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
        finishReason: result.finishReason,
      };
      logActivity(completionResult);
      return completionResult;
    } else {
      // No tools - use regular Anthropic completion
      logger.debug('Routing to native Anthropic provider (no tools)', { model: modelToUse });
      const result = await anthropicProvider.createCompletion(
        modelToUse,
        messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
        { temperature, maxTokens: resolvedMaxTokens }
      );
      const completionResult: ChatCompletionResult = {
        content: result.content,
        tokensUsed: result.tokensUsed,
        promptTokens: result.inputTokens || 0,
        completionTokens: result.outputTokens || 0,
        toolCalls: undefined,
        finishReason: 'stop',
      };
      logActivity(completionResult);
      return completionResult;
    }
  }

  const client = getClient(provider);

  try {
    // Use max_completion_tokens for OpenAI (newer models), max_tokens for others
    // Skip temperature for OpenAI gpt-5 and o4 models (only supports default)
    const skipTemperature = modelToUse.includes('gpt-5') || modelToUse.includes('o4-') || modelToUse.startsWith('o4');
    
    const tokenParam = provider === 'openai'
      ? { max_completion_tokens: resolvedMaxTokens }
      : { max_tokens: resolvedMaxTokens };

    // xAI Grok 4.1 Fast supports reasoning mode
    const isXAIReasoning = provider === 'xai' &&
      (modelToUse.includes('fast') || modelToUse.includes('reasoning'));

    // Format messages for OpenAI API (handle tool calls and tool results)
    const formattedMessages = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id! };
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return { role: 'assistant' as const, content: m.content, tool_calls: m.tool_calls };
      }
      return { role: m.role, content: m.content };
    });

    const baseRequest = {
      model: modelToUse,
      messages: formattedMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      ...(tools ? { tools } : {}),
      ...(skipTemperature ? {} : { temperature }),
      ...tokenParam,
      response_format,
      // Add reasoning for xAI fast/reasoning models (enabled by default, can be disabled)
      ...(isXAIReasoning && { reasoning: { enabled: reasoning !== false } }),
    } as any;

    let response = await client.chat.completions.create(baseRequest);
    let choice = (response as any)?.choices?.[0];

    // OpenRouter can occasionally return malformed/empty completion payloads for free models.
    // Retry once without tools to avoid hard-failing the chat turn.
    if (!choice && provider === 'openrouter' && modelToUse.includes(':free') && tools && tools.length > 0) {
      logger.warn('OpenRouter returned no choices, retrying completion without tools', {
        provider,
        model: modelToUse,
        toolsCount: tools.length,
      });
      response = await client.chat.completions.create({
        ...baseRequest,
        tools: undefined,
      });
      choice = (response as any)?.choices?.[0];
    }

    if (!choice || !choice.message) {
      const providerError = (response as any)?.error?.message;
      throw new Error(
        providerError
          ? `${provider} completion returned invalid response: ${providerError}`
          : `${provider} completion returned invalid response (missing choices[0])`
      );
    }

    const completionResult: ChatCompletionResult = {
      content: choice.message.content || '',
      reasoning: (choice.message as any).reasoning_content || (choice.message as any).reasoning,
      tokensUsed: response.usage?.total_tokens || 0,
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      toolCalls: choice.message.tool_calls,
      finishReason: choice.finish_reason || 'stop',
    };
    logActivity(completionResult);
    return completionResult;
  } catch (error) {
    const err = error as any;
    const errorMessage = String(err.message || '');

    // OpenRouter free models can intermittently fail with upstream endpoint errors.
    // Fall back to a reliable OpenAI model so chat requests do not hard-fail.
    const shouldFallbackFromOpenRouter =
      provider === 'openrouter' &&
      modelToUse.includes(':free') &&
      (
        errorMessage.includes('No endpoints found matching your data policy') ||
        errorMessage.includes('Upstream error from OpenInference') ||
        errorMessage.includes('Error from model endpoint') ||
        errorMessage.includes('missing choices[0]')
      );

    if (shouldFallbackFromOpenRouter) {
      const fallbackModel = 'gpt-5-nano';
      logger.warn('OpenRouter free model failed, falling back to OpenAI', {
        fromProvider: provider,
        fromModel: modelToUse,
        toProvider: 'openai',
        toModel: fallbackModel,
        error: errorMessage,
      });
      return createChatCompletion({
        ...options,
        provider: 'openai',
        model: fallbackModel,
      });
    }

    logger.error('Chat completion error', {
      error: errorMessage,
      status: err.status,
      code: err.code,
      type: err.type,
      provider,
      model: modelToUse,
    });
    throw error;
  }
}

export async function* streamChatCompletion(
  options: ChatCompletionOptions
): AsyncGenerator<{ type: 'content' | 'reasoning' | 'done'; content?: string; done: boolean; tokensUsed?: number; promptTokens?: number; completionTokens?: number }> {
  const {
    messages,
    tools,
    temperature = 0.7,
    maxTokens,
    provider = 'openai',
    model,
  } = options;
  const resolvedMaxTokens = maxTokens ?? (provider === 'ollama_tertiary' ? 8192 : 4096);

  const client = getClient(provider);
  const modelToUse = model || config.openai.model;

  try {
    // Use max_completion_tokens for OpenAI (newer models), max_tokens for others
    // Skip temperature for OpenAI gpt-5 and o4 models (only supports default)
    // Moonshot reasoning models require temperature 1.0
    const isMoonshotReasoning = provider === 'moonshot' && (modelToUse.includes('thinking') || modelToUse.includes('k2.5'));
    const skipTemperature = modelToUse.includes('gpt-5') || modelToUse.includes('o4-') || modelToUse.includes('o1-') || modelToUse.includes('o3-') || modelToUse.startsWith('o4') || isMoonshotReasoning;
    
    const tokenParam = provider === 'openai'
      ? { max_completion_tokens: resolvedMaxTokens }
      : { max_tokens: resolvedMaxTokens };

    // Format messages for OpenAI API (handle tool calls and tool results)
    const formattedMessages = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id! };
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return { role: 'assistant' as const, content: m.content, tool_calls: m.tool_calls };
      }
      return { role: m.role, content: m.content };
    });

    const stream = await client.chat.completions.create({
      model: modelToUse,
      messages: formattedMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools,
      ...(skipTemperature ? (isMoonshotReasoning ? { temperature: 1 } : {}) : { temperature }),
      ...tokenParam,
      stream: true,
      stream_options: { include_usage: true },
    });

    let tokensUsed = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as any;

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
        promptTokens = chunk.usage.prompt_tokens || 0;
        completionTokens = chunk.usage.completion_tokens || 0;
      }

      // Handle reasoning content (OpenAI o1/o3, xAI Grok)
      const reasoningContent = delta?.reasoning_content || delta?.reasoning;
      if (reasoningContent) {
        yield { type: 'reasoning', content: reasoningContent, done: false };
      }

      if (delta?.content) {
        yield { type: 'content', content: delta.content, done: false };
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { type: 'done', content: '', done: true, tokensUsed, promptTokens, completionTokens };
      }
    }
  } catch (error) {
    logger.error('Streaming error', {
      error: (error as Error).message,
      provider,
      model: modelToUse,
    });
    throw error;
  }
}

export function formatSearchResultsForContext(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const formatted = results
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.url}`)
    .join('\n\n');

  return `\n\n---\nSearch Results:\n${formatted}\n---\n`;
}

export function formatAgentResultForContext(agentName: string, result: string, success: boolean): string {
  if (!success) {
    return `\n\n---\nAgent "${agentName}" encountered an error: ${result}\n---\n`;
  }
  return `\n\n---\nResponse from ${agentName} specialist:\n${result}\n---\n`;
}

export default {
  createChatCompletion,
  streamChatCompletion,
  formatSearchResultsForContext,
  formatAgentResultForContext,
};
