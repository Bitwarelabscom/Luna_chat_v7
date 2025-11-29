import * as knowledge from './knowledge.service.js';
import * as tasks from './tasks.service.js';
import * as sandbox from './sandbox.service.js';
import * as documents from './documents.service.js';
import * as tools from './tools.service.js';
import * as mood from './mood.service.js';
import * as agents from './agents.service.js';
import * as calendar from './calendar.service.js';
import * as email from './email.service.js';
import logger from '../utils/logger.js';

export interface AbilityContext {
  knowledge: string;
  tasks: string;
  calendar: string;
  email: string;
  mood: string;
  tools: string[];
}

export interface AbilityIntent {
  type: 'task' | 'knowledge' | 'code' | 'document' | 'calendar' | 'email' | 'agent' | 'tool' | 'none';
  action?: string;
  params?: Record<string, unknown>;
  confidence: number;
}

/**
 * Build context from all abilities for prompt enrichment
 */
export async function buildAbilityContext(
  userId: string,
  message: string,
  sessionId?: string
): Promise<AbilityContext> {
  try {
    // Parallel fetches for efficiency
    const [
      relevantKnowledge,
      pendingTasks,
      upcomingEvents,
      recentEmails,
      currentMood,
      moodTrends,
      userTools,
    ] = await Promise.all([
      knowledge.searchKnowledge(userId, message, 3).catch(() => []),
      tasks.getTasks(userId, { status: 'pending', limit: 5 }).catch(() => []),
      calendar.getUpcomingEvents(userId, { days: 2, limit: 3 }).catch(() => []),
      email.getRecentEmails(userId, { limit: 3, unreadOnly: true }).catch(() => []),
      sessionId ? mood.processMoodFromMessage(userId, sessionId, message).catch(() => null) : null,
      mood.getMoodTrends(userId, 7).catch(() => ({ averageSentiment: 0, dominantEmotions: [], moodTrend: 'stable' as const, topTopics: [] })),
      tools.getTools(userId, true).catch(() => []),
    ]);

    return {
      knowledge: knowledge.formatKnowledgeForPrompt(relevantKnowledge),
      tasks: tasks.formatTasksForPrompt(pendingTasks),
      calendar: calendar.formatCalendarForPrompt(upcomingEvents),
      email: email.formatEmailsForPrompt(recentEmails),
      mood: mood.formatMoodForPrompt(currentMood, moodTrends),
      tools: userTools.map(t => t.name),
    };
  } catch (error) {
    logger.error('Failed to build ability context', { error: (error as Error).message, userId });
    return {
      knowledge: '',
      tasks: '',
      calendar: '',
      email: '',
      mood: '',
      tools: [],
    };
  }
}

/**
 * Format ability context for inclusion in system prompt
 */
export function formatAbilityContextForPrompt(context: AbilityContext): string {
  const sections: string[] = [];

  if (context.knowledge) sections.push(context.knowledge);
  if (context.tasks) sections.push(context.tasks);
  if (context.calendar) sections.push(context.calendar);
  if (context.email) sections.push(context.email);
  if (context.mood) sections.push(context.mood);

  if (context.tools.length > 0) {
    sections.push(`[Available Tools]\n${context.tools.join(', ')}`);
  }

  return sections.join('\n\n');
}

/**
 * Detect user intent for abilities
 */
export function detectAbilityIntent(message: string): AbilityIntent {
  const lower = message.toLowerCase();

  // Task intents
  if (/\b(remind|reminder|task|todo|remember to|don't forget)\b/i.test(lower)) {
    const isCreate = /\b(add|create|set|new|remind me)\b/i.test(lower);
    const isList = /\b(list|show|what|my tasks|todos)\b/i.test(lower);
    const isComplete = /\b(done|complete|finish|mark)\b/i.test(lower);

    return {
      type: 'task',
      action: isCreate ? 'create' : isList ? 'list' : isComplete ? 'complete' : 'query',
      confidence: 0.8,
    };
  }

  // Knowledge intents
  if (/\b(remember that|note that|save this|my notes?|knowledge)\b/i.test(lower)) {
    const isCreate = /\b(remember|note|save|add)\b/i.test(lower);
    return {
      type: 'knowledge',
      action: isCreate ? 'create' : 'search',
      confidence: 0.8,
    };
  }

  // Code execution intents
  if (/\b(calculate|compute|run|execute|eval)\b/i.test(lower) ||
      /^```(python|javascript|js)?/m.test(message)) {
    return {
      type: 'code',
      action: 'execute',
      confidence: 0.9,
    };
  }

  // Document intents
  if (/\b(document|file|upload|pdf|search.*files?)\b/i.test(lower)) {
    return {
      type: 'document',
      action: /\b(search|find|look)\b/i.test(lower) ? 'search' : 'query',
      confidence: 0.7,
    };
  }

  // Calendar intents
  if (/\b(calendar|schedule|meeting|appointment|event|what.*today|busy)\b/i.test(lower)) {
    return {
      type: 'calendar',
      action: 'query',
      confidence: 0.8,
    };
  }

  // Email intents
  if (/\b(email|mail|inbox|unread|message from)\b/i.test(lower)) {
    return {
      type: 'email',
      action: 'query',
      confidence: 0.8,
    };
  }

  // Multi-agent intents
  if (/\b(research|analyze|write.*article|complex task|help me with)\b/i.test(lower) &&
      message.length > 100) {
    return {
      type: 'agent',
      action: 'orchestrate',
      confidence: 0.6,
    };
  }

  return { type: 'none', confidence: 0 };
}

/**
 * Execute an ability action based on intent
 */
export async function executeAbilityAction(
  userId: string,
  sessionId: string,
  intent: AbilityIntent,
  message: string
): Promise<{
  handled: boolean;
  result?: string;
  data?: unknown;
}> {
  try {
    switch (intent.type) {
      case 'task': {
        if (intent.action === 'create') {
          const parsed = tasks.parseTaskFromText(message);
          const task = await tasks.createTask(userId, {
            title: parsed.title || message,
            dueAt: parsed.dueAt,
            remindAt: parsed.remindAt,
            priority: parsed.priority,
            sourceSessionId: sessionId,
          });
          return {
            handled: true,
            result: `Created task: "${task.title}"${task.dueAt ? ` (due ${new Date(task.dueAt).toLocaleDateString()})` : ''}`,
            data: task,
          };
        }
        if (intent.action === 'list') {
          const taskList = await tasks.getTasks(userId, { limit: 10 });
          return {
            handled: true,
            result: taskList.length > 0
              ? `You have ${taskList.length} tasks:\n${taskList.map(t => `• ${t.title} [${t.status}]`).join('\n')}`
              : 'No tasks found.',
            data: taskList,
          };
        }
        break;
      }

      case 'knowledge': {
        if (intent.action === 'create') {
          // Extract title and content from message
          const match = message.match(/remember (?:that )?(.+)/i);
          const content = match ? match[1] : message;
          const item = await knowledge.createKnowledgeItem(userId, {
            title: content.slice(0, 100),
            content: content,
            category: 'notes',
          });
          return {
            handled: true,
            result: `Noted: "${item.title.slice(0, 50)}..."`,
            data: item,
          };
        }
        break;
      }

      case 'code': {
        // Extract code from message
        const codeMatch = message.match(/```(?:python|javascript|js)?\n?([\s\S]*?)```/);
        const code = codeMatch ? codeMatch[1] : message;

        const result = await sandbox.executeCode(code.trim(), userId, sessionId);
        return {
          handled: true,
          result: result.success
            ? `Execution result:\n\`\`\`\n${result.output}\n\`\`\``
            : `Error: ${result.error}`,
          data: result,
        };
      }

      case 'document': {
        if (intent.action === 'search') {
          const chunks = await documents.searchDocuments(userId, message);
          return {
            handled: chunks.length > 0,
            result: chunks.length > 0
              ? documents.formatDocumentsForPrompt(chunks)
              : undefined,
            data: chunks,
          };
        }
        break;
      }

      case 'calendar': {
        const events = await calendar.getTodayEvents(userId);
        if (events.length === 0) {
          const upcoming = await calendar.getUpcomingEvents(userId, { days: 7, limit: 5 });
          return {
            handled: true,
            result: upcoming.length > 0
              ? `No events today. Upcoming:\n${calendar.formatCalendarForPrompt(upcoming)}`
              : 'No calendar events found. Connect your calendar for schedule awareness.',
            data: upcoming,
          };
        }
        return {
          handled: true,
          result: `Today's schedule:\n${calendar.formatCalendarForPrompt(events)}`,
          data: events,
        };
      }

      case 'email': {
        const emails = await email.getRecentEmails(userId, { limit: 5, unreadOnly: true });
        const summary = await email.getEmailSummary(userId);
        return {
          handled: true,
          result: summary.unreadCount > 0
            ? `${summary.unreadCount} unread emails:\n${email.formatEmailsForPrompt(emails)}`
            : 'No unread emails. Connect your email for inbox awareness.',
          data: { emails, summary },
        };
      }

      case 'agent': {
        // Use multi-agent orchestration for complex tasks
        const result = await agents.orchestrateTask(userId, message);
        return {
          handled: true,
          result: result.synthesis,
          data: result,
        };
      }
    }

    return { handled: false };
  } catch (error) {
    logger.error('Failed to execute ability action', {
      error: (error as Error).message,
      userId,
      intent,
    });
    return { handled: false };
  }
}

/**
 * Get ability capabilities summary for a user
 */
export async function getAbilitySummary(userId: string): Promise<{
  knowledge: { count: number };
  tasks: { pending: number; overdue: number };
  documents: { count: number };
  tools: { count: number };
  calendar: { connected: boolean };
  email: { connected: boolean };
}> {
  try {
    const [
      knowledgeItems,
      taskList,
      documentList,
      toolList,
      calendarConns,
      emailConns,
    ] = await Promise.all([
      knowledge.getKnowledgeItems(userId, { limit: 1 }),
      tasks.getTasks(userId, { status: 'pending' }),
      documents.getDocuments(userId, { limit: 1 }),
      tools.getTools(userId),
      calendar.getCalendarConnections(userId),
      email.getEmailConnections(userId),
    ]);

    const now = new Date();
    const overdue = taskList.filter(t => t.dueAt && new Date(t.dueAt) < now).length;

    return {
      knowledge: { count: knowledgeItems.length > 0 ? -1 : 0 }, // -1 means "has items"
      tasks: { pending: taskList.length, overdue },
      documents: { count: documentList.length > 0 ? -1 : 0 },
      tools: { count: toolList.length },
      calendar: { connected: calendarConns.length > 0 },
      email: { connected: emailConns.length > 0 },
    };
  } catch (error) {
    logger.error('Failed to get ability summary', { error: (error as Error).message, userId });
    return {
      knowledge: { count: 0 },
      tasks: { pending: 0, overdue: 0 },
      documents: { count: 0 },
      tools: { count: 0 },
      calendar: { connected: false },
      email: { connected: false },
    };
  }
}

export default {
  buildAbilityContext,
  formatAbilityContextForPrompt,
  detectAbilityIntent,
  executeAbilityAction,
  getAbilitySummary,
};
