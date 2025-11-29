import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { SearchResult } from '../types/index.js';
import type { ProviderId } from './types.js';

// Provider clients cache
const clients: Partial<Record<ProviderId, OpenAI>> = {};

function getClient(provider: ProviderId = 'openai'): OpenAI {
  if (!clients[provider]) {
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
      case 'anthropic':
        // Anthropic uses different API format, not OpenAI-compatible for tool calling
        throw new Error('Anthropic is not supported for chat with tool calling. Use OpenAI, Groq, or xAI.');
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

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  provider?: ProviderId;
  model?: string;
}

export interface ChatCompletionResult {
  content: string;
  tokensUsed: number;
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
    maxTokens = 4096,
    provider = 'openai',
    model,
  } = options;

  const client = getClient(provider);
  const modelToUse = model || config.openai.model;

  try {
    // Use max_completion_tokens for OpenAI (newer models), max_tokens for others
    // Also skip temperature for OpenAI gpt-5 models (only supports default)
    const isGpt5 = modelToUse.includes('gpt-5');
    const tokenParam = provider === 'openai'
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

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

    const response = await client.chat.completions.create({
      model: modelToUse,
      messages: formattedMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools,
      ...(isGpt5 ? {} : { temperature }),
      ...tokenParam,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      toolCalls: choice.message.tool_calls,
      finishReason: choice.finish_reason || 'stop',
    };
  } catch (error) {
    logger.error('Chat completion error', {
      error: (error as Error).message,
      provider,
      model: modelToUse,
    });
    throw error;
  }
}

export async function* streamChatCompletion(
  options: ChatCompletionOptions
): AsyncGenerator<{ content: string; done: boolean; tokensUsed?: number }> {
  const {
    messages,
    tools,
    temperature = 0.7,
    maxTokens = 4096,
    provider = 'openai',
    model,
  } = options;

  const client = getClient(provider);
  const modelToUse = model || config.openai.model;

  try {
    // Use max_completion_tokens for OpenAI (newer models), max_tokens for others
    // Also skip temperature for OpenAI gpt-5 models (only supports default)
    const isGpt5 = modelToUse.includes('gpt-5');
    const tokenParam = provider === 'openai'
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

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
      ...(isGpt5 ? {} : { temperature }),
      ...tokenParam,
      stream: true,
      stream_options: { include_usage: true },
    });

    let tokensUsed = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
      }

      if (delta?.content) {
        yield { content: delta.content, done: false };
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { content: '', done: true, tokensUsed };
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

// Tool definitions for function calling
export const searchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current information, news, or facts. Use when you need up-to-date information or when the user asks about recent events.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
      },
      required: ['query'],
    },
  },
};

export const delegateToAgentTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'delegate_to_agent',
    description: `Delegate a specialized task to an expert agent. Available agents:
- researcher: Deep research, information gathering, fact-finding
- coder: Code writing, debugging, code explanation, programming help
- writer: Creative writing, professional writing, editing, content creation
- analyst: Data analysis, calculations, statistics, insights
- planner: Task breakdown, project planning, organizing complex goals

Use this when a task requires specialized expertise that would benefit from focused attention.`,
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: ['researcher', 'coder', 'writer', 'analyst', 'planner'],
          description: 'The specialist agent to delegate to',
        },
        task: {
          type: 'string',
          description: 'Clear description of what the agent should do',
        },
        context: {
          type: 'string',
          description: 'Optional additional context to help the agent',
        },
      },
      required: ['agent', 'task'],
    },
  },
};

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

export default { createChatCompletion, streamChatCompletion, searchTool, delegateToAgentTool, formatSearchResultsForContext, formatAgentResultForContext };
