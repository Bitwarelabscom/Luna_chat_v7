/**
 * Voice Chat Service
 *
 * A separate chat service for Voice Luna - focused on fast, conversational responses.
 * NO access to user memories, personality, email, calendar, or heavy tools.
 *
 * This service bypasses the layered agent for ~3-5 second response times
 * (vs 30+ seconds with the layered agent).
 */

import {
  createChatCompletion,
  type ChatMessage,
} from '../llm/openai.client.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import { getVoicePrompt } from '../persona/voice.persona.js';
import { search as searxngSearch } from '../search/searxng.client.js';
import { fetchPage } from '../search/webfetch.service.js';
import { pool as db } from '../db/index.js';
import logger from '../utils/logger.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as calendarService from '../abilities/calendar.service.js';
import * as emailService from '../abilities/email.service.js';
import * as loadContextHandler from '../context/load-context.handler.js';

// Voice-specific tools - minimal set for fast responses
const webSearchTool = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for current information, news, facts, or answers to questions',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },
};

const fetchUrlTool = {
  type: 'function' as const,
  function: {
    name: 'fetch_url',
    description: 'Fetch and read content from a specific URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch content from',
        },
      },
      required: ['url'],
    },
  },
};

// Todo tools
const listTodosTool = {
  type: 'function' as const,
  function: {
    name: 'list_todos',
    description: 'Get the user\'s pending tasks and todos',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const createTodoTool = {
  type: 'function' as const,
  function: {
    name: 'create_todo',
    description: 'Create a new task or todo item',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The task title or description',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Priority level (default: medium)',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO format (optional)',
        },
      },
      required: ['title'],
    },
  },
};

const completeTodoTool = {
  type: 'function' as const,
  function: {
    name: 'complete_todo',
    description: 'Mark a task as completed',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to complete',
        },
      },
      required: ['taskId'],
    },
  },
};

const updateTodoTool = {
  type: 'function' as const,
  function: {
    name: 'update_todo',
    description: 'Update a task\'s details',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        title: {
          type: 'string',
          description: 'New title (optional)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'New priority (optional)',
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format (optional)',
        },
      },
      required: ['taskId'],
    },
  },
};

const deleteTodoTool = {
  type: 'function' as const,
  function: {
    name: 'delete_todo',
    description: 'Delete a task',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to delete',
        },
      },
      required: ['taskId'],
    },
  },
};

// Calendar tools
const getCalendarTodayTool = {
  type: 'function' as const,
  function: {
    name: 'get_calendar_today',
    description: 'Get today\'s calendar events',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const getCalendarUpcomingTool = {
  type: 'function' as const,
  function: {
    name: 'get_calendar_upcoming',
    description: 'Get upcoming calendar events for the next 7 days',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const createCalendarEventTool = {
  type: 'function' as const,
  function: {
    name: 'create_calendar_event',
    description: 'Create a new calendar event',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Event title',
        },
        startTime: {
          type: 'string',
          description: 'Start time in ISO format',
        },
        endTime: {
          type: 'string',
          description: 'End time in ISO format',
        },
        location: {
          type: 'string',
          description: 'Event location (optional)',
        },
        description: {
          type: 'string',
          description: 'Event description (optional)',
        },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },
};

const updateCalendarEventTool = {
  type: 'function' as const,
  function: {
    name: 'update_calendar_event',
    description: 'Update a calendar event',
    parameters: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The ID of the event to update',
        },
        title: {
          type: 'string',
          description: 'New title (optional)',
        },
        startTime: {
          type: 'string',
          description: 'New start time in ISO format (optional)',
        },
        endTime: {
          type: 'string',
          description: 'New end time in ISO format (optional)',
        },
        location: {
          type: 'string',
          description: 'New location (optional)',
        },
      },
      required: ['eventId'],
    },
  },
};

const deleteCalendarEventTool = {
  type: 'function' as const,
  function: {
    name: 'delete_calendar_event',
    description: 'Delete a calendar event',
    parameters: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The ID of the event to delete',
        },
      },
      required: ['eventId'],
    },
  },
};

// Email tools
const checkEmailTool = {
  type: 'function' as const,
  function: {
    name: 'check_email',
    description: 'Check Luna\'s inbox for recent or unread emails',
    parameters: {
      type: 'object',
      properties: {
        unreadOnly: {
          type: 'boolean',
          description: 'Only show unread emails (default: false)',
        },
      },
      required: [],
    },
  },
};

const readEmailTool = {
  type: 'function' as const,
  function: {
    name: 'read_email',
    description: 'Read a specific email by its UID',
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to read',
        },
      },
      required: ['uid'],
    },
  },
};

const sendEmailTool = {
  type: 'function' as const,
  function: {
    name: 'send_email',
    description: 'Send an email from Luna\'s account (only to approved recipients)',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address',
        },
        subject: {
          type: 'string',
          description: 'Email subject',
        },
        body: {
          type: 'string',
          description: 'Email body text',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
};

const replyEmailTool = {
  type: 'function' as const,
  function: {
    name: 'reply_email',
    description: 'Reply to an email',
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to reply to',
        },
        body: {
          type: 'string',
          description: 'Reply body text',
        },
      },
      required: ['uid', 'body'],
    },
  },
};

const deleteEmailTool = {
  type: 'function' as const,
  function: {
    name: 'delete_email',
    description: 'Delete an email',
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

// Context loading tool
const loadContextTool = {
  type: 'function' as const,
  function: {
    name: 'load_context',
    description: `Load context from previous sessions or intents. Use when:
- User says "continue where we left off", "what were we working on"
- User references past work: "that thing we discussed", "the bug we fixed"
- User asks about decisions: "what did we decide about X"`,
    parameters: {
      type: 'object',
      properties: {
        intent_id: {
          type: 'string',
          description: 'Specific intent ID to load (from breadcrumbs)',
        },
        session_id: {
          type: 'string',
          description: 'Specific session ID to load',
        },
        query: {
          type: 'string',
          description: 'Search query to find relevant context by keywords',
        },
      },
      required: [],
    },
  },
};

const voiceTools = [
  webSearchTool,
  fetchUrlTool,
  // Todo tools
  listTodosTool,
  createTodoTool,
  completeTodoTool,
  updateTodoTool,
  deleteTodoTool,
  // Calendar tools
  getCalendarTodayTool,
  getCalendarUpcomingTool,
  createCalendarEventTool,
  updateCalendarEventTool,
  deleteCalendarEventTool,
  // Email tools
  checkEmailTool,
  readEmailTool,
  sendEmailTool,
  replyEmailTool,
  deleteEmailTool,
  // Context tools
  loadContextTool,
];

export interface VoiceChatInput {
  sessionId: string;
  userId: string;
  message: string;
}

export interface VoiceChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
}

/**
 * Get or create a voice session for the user
 */
export async function getOrCreateVoiceSession(userId: string): Promise<string> {
  // Check for existing active session (from last 24 hours)
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM voice_sessions
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new session
  const result = await db.query<{ id: string }>(
    `INSERT INTO voice_sessions (id, user_id)
     VALUES (gen_random_uuid(), $1)
     RETURNING id`,
    [userId]
  );

  return result.rows[0].id;
}

/**
 * Get voice session messages
 */
export async function getSessionMessages(
  sessionId: string,
  limit = 10
): Promise<Array<{ role: string; content: string }>> {
  const result = await db.query<{ role: string; content: string }>(
    `SELECT role, content FROM voice_messages
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return result.rows.reverse();
}

/**
 * Add message to voice session
 */
export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO voice_messages (id, session_id, role, content)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING id`,
    [sessionId, role, content]
  );

  return result.rows[0].id;
}

/**
 * Get user name for personalization (optional)
 */
async function getUserName(userId: string): Promise<string | null> {
  try {
    const result = await db.query<{ display_name: string | null }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.display_name || null;
  } catch {
    return null;
  }
}

/**
 * Process a voice chat message
 *
 * This is the fast path - direct LLM call without layered agent
 */
export async function processMessage(input: VoiceChatInput): Promise<VoiceChatOutput> {
  const { sessionId, userId, message } = input;
  const startTime = Date.now();

  // Get model config (use fast model for voice)
  let modelConfig = await getUserModelConfig(userId, 'fast_llm');

  // Voice chat requires tool support - fall back to xai/grok if provider doesn't support tools
  const providersWithToolSupport = ['anthropic', 'openai', 'groq', 'xai', 'openrouter'];
  if (!providersWithToolSupport.includes(modelConfig.provider)) {
    logger.info('Voice chat falling back to xai/grok (configured provider does not support tools)', {
      configuredProvider: modelConfig.provider,
      userId,
    });
    modelConfig = { provider: 'xai', model: 'grok-4.1-fast' };
  }

  logger.info('Voice chat using model', { provider: modelConfig.provider, model: modelConfig.model, userId });

  // Get user name for personalization
  const userName = await getUserName(userId);

  // Build system prompt
  const systemPrompt = getVoicePrompt({
    userName: userName || undefined,
  });

  // Get conversation history (only 10 messages for speed)
  const history = await getSessionMessages(sessionId, 10);

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add history
  for (const msg of history) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  // Save user message
  await addMessage(sessionId, 'user', message);

  // Call LLM with voice tools
  logger.debug('Voice LLM call starting', {
    sessionId,
    userId,
    provider: modelConfig.provider,
    model: modelConfig.model,
    messageCount: messages.length,
    toolCount: voiceTools.length,
  });

  let completion;
  try {
    completion = await createChatCompletion({
      messages,
      tools: voiceTools,
      provider: modelConfig.provider,
      model: modelConfig.model,
      maxTokens: 300, // Short responses for voice
      temperature: 0.7,
      loggingContext: {
        userId,
        sessionId,
        source: 'voice-chat',
        nodeName: 'voice_initial',
      },
    });
    logger.debug('Voice LLM call completed', {
      sessionId,
      hasToolCalls: !!(completion.toolCalls && completion.toolCalls.length > 0),
      toolCallCount: completion.toolCalls?.length || 0,
      tokensUsed: completion.tokensUsed,
      contentLength: completion.content?.length || 0,
    });
  } catch (llmError) {
    logger.error('Voice LLM call failed', {
      sessionId,
      userId,
      provider: modelConfig.provider,
      model: modelConfig.model,
      error: (llmError as Error).message,
      stack: (llmError as Error).stack,
    });
    throw llmError;
  }

  // Handle tool calls - max 2 iterations for speed
  let toolCallIterations = 0;
  const maxToolCallIterations = 2;

  while (completion.toolCalls && completion.toolCalls.length > 0 && toolCallIterations < maxToolCallIterations) {
    toolCallIterations++;

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls,
    } as ChatMessage);

    for (const toolCall of completion.toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      let toolResult: string;

      try {
        switch (toolCall.function.name) {
          case 'web_search': {
            const query = args.query as string;
            if (!query) {
              toolResult = 'Error: search query is required';
              break;
            }

            const searchResults = await searxngSearch(query, {
              engines: ['google', 'bing', 'duckduckgo'],
              categories: ['general', 'news'],
              maxResults: 3, // Only 3 for speed
            });

            if (searchResults.length === 0) {
              toolResult = `No results found for "${query}"`;
            } else {
              // Format concisely for voice
              toolResult = searchResults.map((r, i) =>
                `${i + 1}. ${r.title}: ${r.snippet || 'No description'}`
              ).join('\n');
            }
            break;
          }

          case 'fetch_url': {
            const url = args.url as string;
            if (!url) {
              toolResult = 'Error: URL is required';
              break;
            }

            try {
              const page = await fetchPage(url, { timeout: 5000 }); // 5s timeout for speed
              // Truncate content for voice context
              const truncatedContent = page.content.slice(0, 2000);
              toolResult = `Title: ${page.title || 'No title'}\n\nContent: ${truncatedContent}`;
            } catch (error) {
              toolResult = `Failed to fetch URL: ${(error as Error).message}`;
            }
            break;
          }

          // Todo tools
          case 'list_todos': {
            const tasks = await tasksService.getTasks(userId, { status: 'pending', limit: 5 });
            if (tasks.length === 0) {
              toolResult = 'No pending tasks found.';
            } else {
              toolResult = tasks.map((t, i) => {
                let entry = `${i + 1}. [${t.id.slice(0, 8)}] ${t.title}`;
                if (t.priority === 'urgent' || t.priority === 'high') {
                  entry += ` (${t.priority})`;
                }
                if (t.dueAt) {
                  const due = new Date(t.dueAt);
                  const now = new Date();
                  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  if (diffDays < 0) entry += ' - OVERDUE';
                  else if (diffDays === 0) entry += ' - due today';
                  else if (diffDays === 1) entry += ' - due tomorrow';
                }
                return entry;
              }).join('\n');
            }
            break;
          }

          case 'create_todo': {
            const title = args.title as string;
            if (!title) {
              toolResult = 'Error: task title is required';
              break;
            }
            const task = await tasksService.createTask(userId, {
              title,
              priority: args.priority || 'medium',
              dueAt: args.dueDate ? new Date(args.dueDate) : undefined,
            });
            toolResult = `Created task: ${task.title} (ID: ${task.id})`;
            break;
          }

          case 'complete_todo': {
            const taskId = args.taskId as string;
            if (!taskId) {
              toolResult = 'Error: task ID is required';
              break;
            }
            const task = await tasksService.updateTaskStatus(userId, taskId, 'completed');
            if (task) {
              toolResult = `Completed task: ${task.title}`;
            } else {
              toolResult = 'Task not found';
            }
            break;
          }

          case 'update_todo': {
            const taskId = args.taskId as string;
            if (!taskId) {
              toolResult = 'Error: task ID is required';
              break;
            }
            const updates: { title?: string; priority?: 'low' | 'medium' | 'high' | 'urgent'; dueAt?: Date } = {};
            if (args.title) updates.title = args.title;
            if (args.priority) updates.priority = args.priority;
            if (args.dueDate) updates.dueAt = new Date(args.dueDate);
            const task = await tasksService.updateTask(userId, taskId, updates);
            if (task) {
              toolResult = `Updated task: ${task.title}`;
            } else {
              toolResult = 'Task not found';
            }
            break;
          }

          case 'delete_todo': {
            const taskId = args.taskId as string;
            if (!taskId) {
              toolResult = 'Error: task ID is required';
              break;
            }
            const deleted = await tasksService.deleteTask(userId, taskId);
            toolResult = deleted ? 'Task deleted' : 'Task not found';
            break;
          }

          // Calendar tools
          case 'get_calendar_today': {
            const events = await calendarService.getTodayEvents(userId);
            if (events.length === 0) {
              toolResult = 'No events scheduled for today.';
            } else {
              toolResult = events.slice(0, 5).map((e, i) => {
                const start = new Date(e.startAt);
                const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                let entry = `${i + 1}. ${e.title} at ${timeStr}`;
                if (e.location) entry += ` (${e.location})`;
                return entry;
              }).join('\n');
            }
            break;
          }

          case 'get_calendar_upcoming': {
            const events = await calendarService.getUpcomingEvents(userId, { days: 7, limit: 5 });
            if (events.length === 0) {
              toolResult = 'No upcoming events in the next 7 days.';
            } else {
              toolResult = events.map((e, i) => {
                const start = new Date(e.startAt);
                const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                let entry = `${i + 1}. ${e.title} - ${dateStr} at ${timeStr}`;
                if (e.location) entry += ` (${e.location})`;
                return entry;
              }).join('\n');
            }
            break;
          }

          case 'create_calendar_event': {
            const title = args.title as string;
            const startTime = args.startTime as string;
            const endTime = args.endTime as string;
            if (!title || !startTime || !endTime) {
              toolResult = 'Error: title, startTime, and endTime are required';
              break;
            }
            try {
              const event = await calendarService.createEvent(userId, {
                title,
                startAt: new Date(startTime),
                endAt: new Date(endTime),
                location: args.location,
                description: args.description,
              });
              const start = new Date(event.startAt);
              const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              toolResult = `Created event: ${event.title} on ${dateStr} at ${timeStr} (ID: ${event.id})`;
            } catch (error) {
              toolResult = `Failed to create event: ${(error as Error).message}`;
            }
            break;
          }

          case 'update_calendar_event': {
            const eventId = args.eventId as string;
            if (!eventId) {
              toolResult = 'Error: event ID is required';
              break;
            }
            try {
              const updates: { title?: string; startAt?: Date; endAt?: Date; location?: string } = {};
              if (args.title) updates.title = args.title;
              if (args.startTime) updates.startAt = new Date(args.startTime);
              if (args.endTime) updates.endAt = new Date(args.endTime);
              if (args.location) updates.location = args.location;
              const event = await calendarService.updateEvent(userId, eventId, updates);
              toolResult = `Updated event: ${event.title}`;
            } catch (error) {
              toolResult = `Failed to update event: ${(error as Error).message}`;
            }
            break;
          }

          case 'delete_calendar_event': {
            const eventId = args.eventId as string;
            if (!eventId) {
              toolResult = 'Error: event ID is required';
              break;
            }
            try {
              await calendarService.deleteEvent(userId, eventId);
              toolResult = 'Event deleted';
            } catch (error) {
              toolResult = `Failed to delete event: ${(error as Error).message}`;
            }
            break;
          }

          // Email tools
          case 'check_email': {
            const unreadOnly = args.unreadOnly === true;
            const { emails: gatedEmails, quarantinedCount } = unreadOnly
              ? await emailService.getLunaUnreadEmailsGated(userId)
              : await emailService.checkLunaInboxGated(5, userId);
            if (gatedEmails.length === 0 && quarantinedCount === 0) {
              toolResult = unreadOnly ? 'No unread emails.' : 'Inbox is empty.';
            } else {
              toolResult = emailService.formatGatedInboxForPrompt(gatedEmails, quarantinedCount);
            }
            break;
          }

          case 'read_email': {
            const uid = args.uid as number;
            if (!uid) {
              toolResult = 'Error: email UID is required';
              break;
            }
            const gatedEmail = await emailService.fetchEmailByUidGated(uid, userId);
            if (gatedEmail) {
              toolResult = emailService.formatGatedEmailForPrompt(gatedEmail);
            } else {
              toolResult = 'Email was quarantined for security review or not found';
            }
            break;
          }

          case 'send_email': {
            const to = args.to as string;
            const subject = args.subject as string;
            const body = args.body as string;
            if (!to || !subject || !body) {
              toolResult = 'Error: to, subject, and body are required';
              break;
            }
            // Check if recipient is approved
            if (!emailService.canLunaEmailRecipient(to)) {
              toolResult = `Cannot send email to ${to} - recipient not in approved list`;
              break;
            }
            const result = await emailService.sendLunaEmail([to], subject, body);
            if (result.success) {
              toolResult = `Email sent to ${to}`;
            } else {
              toolResult = `Failed to send email: ${result.error || 'Unknown error'}`;
            }
            break;
          }

          case 'reply_email': {
            const uid = args.uid as number;
            const body = args.body as string;
            if (!uid || !body) {
              toolResult = 'Error: uid and body are required';
              break;
            }
            const result = await emailService.replyToEmail(uid, body);
            if (result.success) {
              toolResult = 'Reply sent';
            } else {
              toolResult = `Failed to reply: ${result.error || 'Unknown error'}`;
            }
            break;
          }

          case 'delete_email': {
            const uid = args.uid as number;
            if (!uid) {
              toolResult = 'Error: email UID is required';
              break;
            }
            const deleted = await emailService.deleteEmail(uid);
            toolResult = deleted ? 'Email deleted' : 'Failed to delete email';
            break;
          }

          case 'load_context': {
            const result = await loadContextHandler.handleLoadContext(userId, {
              intent_id: args.intent_id,
              session_id: args.session_id,
              query: args.query,
              depth: 'brief', // Voice needs brief responses
            });
            toolResult = loadContextHandler.formatLoadContextResult(result);
            break;
          }

          default:
            toolResult = `Unknown tool: ${toolCall.function.name}`;
        }
      } catch (error) {
        const err = error as Error;
        logger.error('Voice tool execution failed', {
          sessionId,
          userId,
          tool: toolCall.function.name,
          args: toolCall.function.arguments,
          error: err.message,
          stack: err.stack,
        });
        toolResult = `Error: ${err.message}`;
      }

      // Add tool result to conversation
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      } as ChatMessage);
    }

    // Get response after tool execution
    logger.debug('Voice LLM tool response call starting', {
      sessionId,
      iteration: toolCallIterations,
      messageCount: messages.length,
    });

    try {
      completion = await createChatCompletion({
        messages,
        tools: voiceTools,
        provider: modelConfig.provider,
        model: modelConfig.model,
        maxTokens: 300,
        temperature: 0.7,
        loggingContext: {
          userId,
          sessionId,
          source: 'voice-chat',
          nodeName: 'voice_tool_followup',
        },
      });
      logger.debug('Voice LLM tool response call completed', {
        sessionId,
        iteration: toolCallIterations,
        hasMoreToolCalls: !!(completion.toolCalls && completion.toolCalls.length > 0),
        contentLength: completion.content?.length || 0,
      });
    } catch (llmError) {
      logger.error('Voice LLM tool response call failed', {
        sessionId,
        userId,
        iteration: toolCallIterations,
        error: (llmError as Error).message,
        stack: (llmError as Error).stack,
      });
      throw llmError;
    }
  }

  // Handle empty response
  let responseContent = completion.content;
  if (!responseContent || responseContent.trim() === '') {
    logger.warn('Empty response from voice LLM', { sessionId, userId, toolCallIterations });
    responseContent = toolCallIterations > 0
      ? "I found some information but couldn't summarize it properly. Could you rephrase your question?"
      : "I'm not sure what to say to that. Could you try asking differently?";
  }

  // Save assistant response
  const assistantMessageId = await addMessage(sessionId, 'assistant', responseContent);

  const elapsed = Date.now() - startTime;
  logger.info('Voice message processed', {
    sessionId,
    userId,
    elapsed,
    toolCalls: toolCallIterations,
    tokens: completion.tokensUsed,
  });

  return {
    messageId: assistantMessageId,
    content: responseContent,
    tokensUsed: completion.tokensUsed || 0,
  };
}

/**
 * Delete a voice session and all its messages
 */
export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM voice_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
