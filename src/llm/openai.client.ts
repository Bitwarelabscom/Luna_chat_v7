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
      case 'openrouter':
        if (!config.openrouter?.apiKey) throw new Error('OpenRouter API key not configured');
        clients.openrouter = new OpenAI({
          apiKey: config.openrouter.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'https://luna-chat.bitwarelabs.com',
            'X-Title': 'Luna Chat',
          },
        });
        break;
      case 'anthropic':
        // Anthropic uses different API format, not OpenAI-compatible for tool calling
        throw new Error('Anthropic is not supported for chat with tool calling. Use OpenAI, Groq, xAI, or OpenRouter.');
      case 'google':
        // Google Gemini uses different API format, not OpenAI-compatible
        throw new Error('Google Gemini is not supported for chat with tool calling. Use OpenAI, Groq, xAI, or OpenRouter.');
      case 'ollama':
        // Ollama doesn't support tool calling in the same way
        throw new Error('Ollama is not supported for chat with tool calling. Use OpenAI, Groq, xAI, or OpenRouter.');
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
    maxTokens = 4096,
    provider = 'openai',
    model,
  } = options;

  const client = getClient(provider);
  const modelToUse = model || config.openai.model;

  try {
    // Use max_completion_tokens for OpenAI (newer models), max_tokens for others
    // Skip temperature for OpenAI gpt-5 and o4 models (only supports default)
    const skipTemperature = modelToUse.includes('gpt-5') || modelToUse.includes('o4-') || modelToUse.startsWith('o4');
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
      ...(skipTemperature ? {} : { temperature }),
      ...tokenParam,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
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
): AsyncGenerator<{ content: string; done: boolean; tokensUsed?: number; promptTokens?: number; completionTokens?: number }> {
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
    // Skip temperature for OpenAI gpt-5 and o4 models (only supports default)
    const skipTemperature = modelToUse.includes('gpt-5') || modelToUse.includes('o4-') || modelToUse.startsWith('o4');
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
      ...(skipTemperature ? {} : { temperature }),
      ...tokenParam,
      stream: true,
      stream_options: { include_usage: true },
    });

    let tokensUsed = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
        promptTokens = chunk.usage.prompt_tokens || 0;
        completionTokens = chunk.usage.completion_tokens || 0;
      }

      if (delta?.content) {
        yield { content: delta.content, done: false };
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { content: '', done: true, tokensUsed, promptTokens, completionTokens };
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
- coder: Code writing, debugging, code explanation, programming help (can save scripts to workspace)
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

// Workspace tools for file management and execution
export const workspaceWriteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_write',
    description: `Save a file to the user's persistent workspace. Useful for saving scripts, notes, data files, or code that the user might want to use again later. Supported file types: .py, .js, .ts, .sh, .json, .txt, .md, .csv, .xml, .yaml, .yml, .html, .css, .sql, .r, .ipynb`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to save (e.g., "analysis.py", "data.json", "notes.md")',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['filename', 'content'],
    },
  },
};

export const workspaceExecuteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_execute',
    description: `Execute a script file from the user's workspace in a sandboxed environment. Returns the output of the script. Supported: .py (Python), .js (JavaScript/Node.js), .sh (Shell)`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to execute (e.g., "analysis.py", "script.js")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional command-line arguments to pass to the script',
        },
      },
      required: ['filename'],
    },
  },
};

export const workspaceListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_list',
    description: `List all files in the user's workspace. Shows file names, sizes, and last modified dates.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const workspaceReadTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_read',
    description: `Read the contents of a file from the user's workspace.`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to read',
        },
      },
      required: ['filename'],
    },
  },
};

export const sendEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'send_email',
    description: `Send an email from Luna's email account (luna@bitwarelabs.com). IMPORTANT: Can ONLY send to @bitwarelabs.com email addresses. Use this when asked to email someone, send a message, or communicate via email. Always confirm with the user before sending.`,
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'The recipient email address (must be @bitwarelabs.com)',
        },
        subject: {
          type: 'string',
          description: 'The email subject line',
        },
        body: {
          type: 'string',
          description: 'The email body content. Sign off as Luna.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
};

export const checkEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'check_email',
    description: `Check Luna's email inbox (luna@bitwarelabs.com) for new or recent messages. Use when asked about emails, inbox, or messages.`,
    parameters: {
      type: 'object',
      properties: {
        unreadOnly: {
          type: 'boolean',
          description: 'If true, only return unread emails. Default: true',
        },
      },
      required: [],
    },
  },
};

export const searchDocumentsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_documents',
    description: `Search the user's uploaded documents (PDFs, text files) for relevant information. Use when the user asks about their documents, files, or wants to find information in their uploaded content.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant document content',
        },
      },
      required: ['query'],
    },
  },
};

export const suggestGoalTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'suggest_goal',
    description: `Suggest creating a goal when the user explicitly expresses a clear desire, intention, or aspiration. ONLY use when:
- User says "I want to...", "I'm planning to...", "I need to...", "I'd like to...", "My goal is to..."
- The intent is clear and actionable (not hypothetical or casual mention)
Do NOT use for casual mentions like "it would be nice" or hypothetical scenarios.
This will create a confirmation prompt for the user to approve.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short, clear goal title (e.g., "Learn Python", "Exercise 3x/week")',
        },
        description: {
          type: 'string',
          description: 'Optional longer description of the goal',
        },
        goalType: {
          type: 'string',
          enum: ['user_focused', 'self_improvement', 'relationship', 'research'],
          description: 'The type of goal: user_focused (helping user), self_improvement (personal growth), relationship (connection with user), research (learning topics)',
        },
      },
      required: ['title', 'goalType'],
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

export default {
  createChatCompletion,
  streamChatCompletion,
  searchTool,
  delegateToAgentTool,
  workspaceWriteTool,
  workspaceExecuteTool,
  workspaceListTool,
  workspaceReadTool,
  sendEmailTool,
  checkEmailTool,
  searchDocumentsTool,
  suggestGoalTool,
  formatSearchResultsForContext,
  formatAgentResultForContext,
};
