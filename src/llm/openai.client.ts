import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { SearchResult } from '../types/index.js';
import type { ProviderId } from './types.js';
import * as anthropicProvider from './providers/anthropic.provider.js';

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
        // Anthropic tool calling is handled separately via native provider
        // This error only triggers if someone tries to use the OpenAI client directly
        throw new Error('Anthropic should be routed through createChatCompletion, not getClient directly.');
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
  reasoning?: boolean;  // For xAI Grok 4.1 Fast reasoning models
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
    reasoning,
  } = options;

  const modelToUse = model || config.openai.model;

  // Route Sanhedrin to native provider (no tool support)
  if (provider === 'sanhedrin') {
    if (tools && tools.length > 0) {
      throw new Error('Sanhedrin provider does not support tool calling. Use a different provider for voice chat.');
    }
    const sanhedrinProvider = await import('./providers/sanhedrin.provider.js');
    const result = await sanhedrinProvider.createCompletion(
      modelToUse,
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      { temperature, maxTokens }
    );
    return {
      content: result.content,
      tokensUsed: result.tokensUsed,
      promptTokens: 0,
      completionTokens: 0,
      toolCalls: undefined,
      finishReason: 'stop',
    };
  }

  // Route Anthropic to native provider (required for tool calling, also works without tools)
  if (provider === 'anthropic') {
    if (tools && tools.length > 0) {
      logger.debug('Routing to native Anthropic provider for tool calling', { model: modelToUse });
      const result = await anthropicProvider.createCompletionWithTools(
        modelToUse,
        messages as anthropicProvider.ToolMessage[],
        tools as anthropicProvider.OpenAITool[],
        { temperature, maxTokens }
      );
      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        toolCalls: result.toolCalls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
        finishReason: result.finishReason,
      };
    } else {
      // No tools - use regular Anthropic completion
      logger.debug('Routing to native Anthropic provider (no tools)', { model: modelToUse });
      const result = await anthropicProvider.createCompletion(
        modelToUse,
        messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
        { temperature, maxTokens }
      );
      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
        promptTokens: result.inputTokens || 0,
        completionTokens: result.outputTokens || 0,
        toolCalls: undefined,
        finishReason: 'stop',
      };
    }
  }

  const client = getClient(provider);

  try {
    // Use max_completion_tokens for OpenAI (newer models), max_tokens for others
    // Skip temperature for OpenAI gpt-5 and o4 models (only supports default)
    const skipTemperature = modelToUse.includes('gpt-5') || modelToUse.includes('o4-') || modelToUse.startsWith('o4');
    const tokenParam = provider === 'openai'
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

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

    const response = await client.chat.completions.create({
      model: modelToUse,
      messages: formattedMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools,
      ...(skipTemperature ? {} : { temperature }),
      ...tokenParam,
      // Add reasoning for xAI fast/reasoning models (enabled by default, can be disabled)
      ...(isXAIReasoning && { reasoning: { enabled: reasoning !== false } }),
    } as any);

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

export const browserVisualSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_visual_search',
    description: 'Search the web visually by opening the browser window for the user to watch in real-time. Use this for news, current events, or when the user wants to see you browsing. The browser window will open and show live navigation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
        searchEngine: {
          type: 'string',
          enum: ['google', 'google_news', 'bing'],
          description: 'Which search engine to use. Default is google_news for news queries.',
        },
      },
      required: ['query'],
    },
  },
};

export const youtubeSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'youtube_search',
    description: 'Search YouTube for videos. ALWAYS use this tool when the user mentions videos, YouTube, watching, or playing video content. Examples: "play me a video", "find a video about...", "show me a YouTube video", "search YouTube for...", "I want to watch...", "play something". This tool works and should be used for any video-related request.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query for YouTube videos',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default: 3, max: 5)',
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
- coder-claude: SENIOR ENGINEER - Use for HIGH COMPLEXITY: architecture, refactoring, debugging hard errors, security-critical code
- coder-gemini: RAPID PROTOTYPER - Use for HIGH VOLUME/SPEED: simple scripts, unit tests, log analysis, code explanations, boilerplate
- writer: Creative writing, professional writing, editing, content creation
- analyst: Data analysis, calculations, statistics, insights
- planner: Task breakdown, project planning, organizing complex goals

CODING AGENT DECISION MATRIX:
| Task | Agent |
|------|-------|
| "Refactor the auth system" | coder-claude |
| "Debug this race condition" | coder-claude |
| "Review for security issues" | coder-claude |
| "Analyze this error log" | coder-gemini |
| "Write unit tests" | coder-gemini |
| "Create a simple utility script" | coder-gemini |
| "Explain what this code does" | coder-gemini |

Default: coder-claude for production code, coder-gemini for tests/scripts/docs.
The coding agents can execute code, create files/folders in the workspace, and persist work across sessions.`,
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: ['researcher', 'coder-claude', 'coder-gemini', 'writer', 'analyst', 'planner'],
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

export const readEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'read_email',
    description: `Read the full content of a specific email by its UID. Use when the user wants to see the full details of an email, or when you need to read an email before replying.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to read (obtained from check_email results)',
        },
      },
      required: ['uid'],
    },
  },
};

export const deleteEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'delete_email',
    description: `Delete an email by its UID. IMPORTANT: Always confirm with the user before deleting. This action is permanent and cannot be undone.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to delete',
        },
      },
      required: ['uid'],
    },
  },
};

export const replyEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'reply_email',
    description: `Reply to an email. This will compose and send a reply with proper email threading. Use when the user asks you to respond to or reply to an email. Always confirm the reply content with the user before sending.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to reply to',
        },
        body: {
          type: 'string',
          description: 'The reply message content. Compose a helpful, professional reply as Luna.',
        },
      },
      required: ['uid', 'body'],
    },
  },
};

export const markEmailReadTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'mark_email_read',
    description: `Mark an email as read or unread. Use when the user wants to change the read status of an email.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to update',
        },
        isRead: {
          type: 'boolean',
          description: 'Set to true to mark as read, false to mark as unread',
        },
      },
      required: ['uid', 'isRead'],
    },
  },
};

export const sendTelegramTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'send_telegram',
    description: `Send a message to the user via Telegram. Use this when you want to send them a reminder, follow-up, or important information to their phone. Only works if the user has Telegram connected.`,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to send via Telegram',
        },
      },
      required: ['message'],
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

export const fetchUrlTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'fetch_url',
    description: `Fetch and read the content of a specific URL/webpage. Use when the user asks you to read, fetch, or get content from a specific URL. This retrieves the text content of the page for analysis.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to fetch (must start with http:// or https://)',
        },
      },
      required: ['url'],
    },
  },
};

// Todo management tools
export const listTodosTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_todos',
    description: `List the user's todo items. Shows pending, in-progress, and optionally completed todos with their status, priority, due dates, and notes.`,
    parameters: {
      type: 'object',
      properties: {
        includeCompleted: {
          type: 'boolean',
          description: 'If true, include completed todos. Default: false (only active todos)',
        },
      },
      required: [],
    },
  },
};

export const createTodoTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_todo',
    description: `Create a new todo item for the user. Use when the user asks you to add something to their todo list, remind them about something, or when they mention a task they need to do.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The todo title - what needs to be done',
        },
        notes: {
          type: 'string',
          description: 'Optional notes or additional details about the todo',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Priority level. Default: medium',
        },
        dueDate: {
          type: 'string',
          description: 'Optional due date in ISO format (YYYY-MM-DD) or natural language like "tomorrow", "next week"',
        },
      },
      required: ['title'],
    },
  },
};

export const completeTodoTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'complete_todo',
    description: `Mark a todo item as completed. Use when the user says they finished a task, completed something, or asks you to check off an item.`,
    parameters: {
      type: 'object',
      properties: {
        todoId: {
          type: 'string',
          description: 'The ID of the todo to complete. Get this from list_todos first.',
        },
        title: {
          type: 'string',
          description: 'Alternative: the title/text of the todo to complete (will match partially)',
        },
      },
      required: [],
    },
  },
};

export const updateTodoTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_todo',
    description: `Update a todo item - add or modify notes, change priority, update due date, or change status. Use when the user wants to add details to a todo or modify it.`,
    parameters: {
      type: 'object',
      properties: {
        todoId: {
          type: 'string',
          description: 'The ID of the todo to update. Get this from list_todos first.',
        },
        title: {
          type: 'string',
          description: 'Alternative: the title/text of the todo to update (will match partially)',
        },
        notes: {
          type: 'string',
          description: 'New notes to set (replaces existing notes)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'New priority level',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'New status',
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format or natural language',
        },
      },
      required: [],
    },
  },
};

export const sessionNoteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'session_note',
    description: 'Add a note about this session for future reference. Use to record important context like user mood, key topics discussed, action items, or anything you want to remember for the next session. Notes appear in startup greetings.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'Brief note about the session (max 200 characters). Examples: "User feeling stressed about work", "Discussed vacation plans", "Follow up on project deadline"',
        },
      },
      required: ['note'],
    },
  },
};

export const createReminderTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_reminder',
    description: 'Set a quick reminder to notify the user via Telegram after a specified time. Use when user says things like "remind me in X minutes about Y" or "set a reminder for...".',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'What to remind about (the reminder message)',
        },
        delay_minutes: {
          type: 'number',
          description: 'Number of minutes from now to send the reminder',
        },
      },
      required: ['message', 'delay_minutes'],
    },
  },
};

export const listRemindersTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_reminders',
    description: 'List all pending reminders for the user. Use when user asks "what reminders do I have?" or wants to see their upcoming reminders.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export const cancelReminderTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'cancel_reminder',
    description: 'Cancel a pending reminder by its ID. Use when user wants to cancel or remove a reminder.',
    parameters: {
      type: 'object',
      properties: {
        reminder_id: {
          type: 'string',
          description: 'The ID of the reminder to cancel',
        },
      },
      required: ['reminder_id'],
    },
  },
};

// Browser automation tools
export const browserNavigateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_navigate',
    description: `Navigate a browser to a URL. Use this when you need to visit a webpage for interactive browsing, form filling, or when fetch_url doesn't work (JavaScript-heavy sites, SPAs). Returns page title and URL on success.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to navigate to (must start with http:// or https://)',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'When to consider navigation complete. Default: domcontentloaded',
        },
      },
      required: ['url'],
    },
  },
};

export const browserScreenshotTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_screenshot',
    description: `Take a screenshot of a webpage. Use for visual analysis, debugging, or when you need to see what the page looks like. Returns a base64-encoded image.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to and screenshot',
        },
        fullPage: {
          type: 'boolean',
          description: 'If true, capture the entire scrollable page. Default: false (viewport only)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to screenshot a specific element instead of the page',
        },
      },
      required: ['url'],
    },
  },
};

export const browserClickTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_click',
    description: `Click an element on a webpage by CSS selector. Use for buttons, links, or any clickable element.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to first',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href*=signup]")',
        },
      },
      required: ['url', 'selector'],
    },
  },
};

export const browserFillTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_fill',
    description: `Fill a form field with text on a webpage. Clears existing content first. Use for input fields, textareas, and contenteditable elements.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to first',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the input field (e.g., "input[name=email]", "#username", "textarea.comment")',
        },
        value: {
          type: 'string',
          description: 'The text to fill into the field',
        },
      },
      required: ['url', 'selector', 'value'],
    },
  },
};

export const browserExtractTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_extract',
    description: `Extract content from a webpage. Returns page text, title, and links. Better than fetch_url for JavaScript-rendered content.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to and extract content from',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to extract specific elements. If not provided, extracts main page content.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return when using selector. Default: 10',
        },
      },
      required: ['url'],
    },
  },
};

export const browserWaitTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_wait',
    description: `Wait for an element to appear on a webpage. Use after navigation or actions that trigger page changes.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to first',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds. Default: 10000 (10 seconds)',
        },
      },
      required: ['url', 'selector'],
    },
  },
};

export const browserCloseTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_close',
    description: `Close the browser session. Use when done with browser automation to free resources.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const browserRenderHtmlTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_render_html',
    description: `Render HTML content and display it as a visual page. Use when you want to create and show the user a custom HTML page, visualization, chart, diagram, styled content, or any HTML-based visual. Perfect for creating interactive demonstrations, formatted reports, data visualizations, or presenting information in a visually appealing way. The HTML will be rendered in a browser and shown as an image to the user.`,
    parameters: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'Complete HTML content to render. Can include inline CSS and JavaScript. Should be a full HTML document with <html>, <head>, and <body> tags for best results.',
        },
        title: {
          type: 'string',
          description: 'Optional title for the page (will be shown in the caption)',
        },
      },
      required: ['html'],
    },
  },
};

// Image generation tool
export const generateImageTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: `Generate an image based on a text description using AI. Use when the user asks for an image, picture, illustration, artwork, or any visual to be created. Returns an image that will be displayed in chat.`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A detailed description of the image to generate. Be specific about style, colors, composition, and subjects.',
        },
      },
      required: ['prompt'],
    },
  },
};

// Desktop background generation tool
export const generateBackgroundTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_desktop_background',
    description: `Generate a desktop background/wallpaper image for Luna's UI. Use when the user asks for a new background, wallpaper, or wants to change/customize their desktop background. The generated background will be saved and can be set as active.`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A description of the background to generate. Examples: "sunset over mountains", "abstract purple and blue gradients", "minimalist geometric pattern".',
        },
        style: {
          type: 'string',
          enum: ['abstract', 'nature', 'artistic', 'custom'],
          description: 'The style of background: abstract (gradients, shapes), nature (landscapes, scenery), artistic (illustrations, creative), or custom (user-defined).',
        },
        setActive: {
          type: 'boolean',
          description: 'Whether to immediately set this as the active desktop background. Default is true.',
        },
      },
      required: ['prompt'],
    },
  },
};

// Research agent tool - uses Claude CLI for in-depth research
export const researchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'research',
    description: `Conduct in-depth research using Claude Opus 4.5. Use this for complex questions that require thorough investigation, web research, code analysis, document processing, or data analysis. The research agent can search the web, analyze information, and provide detailed findings. Results can optionally be saved to the user's workspace. Use "quick" depth for simple lookups (1-2 min) or "thorough" for comprehensive analysis (5-10 min).`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The research question or topic to investigate thoroughly',
        },
        depth: {
          type: 'string',
          enum: ['quick', 'thorough'],
          description: 'Research depth - "quick" for simple lookups, "thorough" for comprehensive analysis. Default: thorough',
        },
        save_to_file: {
          type: 'string',
          description: 'Optional filename to save research results in workspace (e.g., "market-analysis.md"). File will be saved in the research/ folder.',
        },
      },
      required: ['query'],
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
  readEmailTool,
  deleteEmailTool,
  replyEmailTool,
  markEmailReadTool,
  searchDocumentsTool,
  suggestGoalTool,
  fetchUrlTool,
  listTodosTool,
  createTodoTool,
  completeTodoTool,
  updateTodoTool,
  sessionNoteTool,
  createReminderTool,
  listRemindersTool,
  cancelReminderTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserFillTool,
  browserExtractTool,
  browserWaitTool,
  browserCloseTool,
  generateImageTool,
  generateBackgroundTool,
  formatSearchResultsForContext,
  formatAgentResultForContext,
};
