import { createCompletion } from '../llm/router.js';
import { config } from '../config/index.js';
import * as sessionService from './session.service.js';
import * as authService from '../auth/auth.service.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as calendarService from '../abilities/calendar.service.js';
import * as factsService from '../memory/facts.service.js';
import type { Message } from '../types/index.js';
import logger from '../utils/logger.js';

export interface StartupContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  userName?: string;
  pendingTasksCount: number;
  overdueTasksCount: number;
  topTasks: tasksService.Task[];
  todayEventsCount: number;
  todayEvents: calendarService.CalendarEvent[];
  userFacts: factsService.UserFact[];
}

export interface StartupResult {
  message: Message;
  suggestions: string[];
}

/**
 * Get time of day based on current hour
 */
function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Get greeting based on time of day
 */
function getTimeGreeting(timeOfDay: string): string {
  switch (timeOfDay) {
    case 'morning': return 'Good morning';
    case 'afternoon': return 'Good afternoon';
    case 'evening': return 'Good evening';
    case 'night': return 'Hey there';
    default: return 'Hello';
  }
}

/**
 * Build context for startup message generation
 */
async function buildStartupContext(userId: string): Promise<StartupContext> {
  const timeOfDay = getTimeOfDay();

  // Fetch all context in parallel
  const [user, tasks, todayEvents, userFacts] = await Promise.all([
    authService.getUserById(userId),
    tasksService.getTasks(userId, { status: 'pending', limit: 10 }),
    calendarService.getTodayEvents(userId).catch(() => []),
    factsService.getUserFacts(userId, { limit: 20 }),
  ]);

  // Count overdue tasks
  const now = new Date();
  const overdueTasks = tasks.filter(t => t.dueAt && new Date(t.dueAt) < now);

  return {
    timeOfDay,
    userName: user?.displayName || undefined,
    pendingTasksCount: tasks.length,
    overdueTasksCount: overdueTasks.length,
    topTasks: tasks.slice(0, 3),
    todayEventsCount: todayEvents.length,
    todayEvents: todayEvents.slice(0, 3),
    userFacts,
  };
}

/**
 * Generate contextual suggestions based on mode and context
 */
function generateSuggestions(
  mode: 'assistant' | 'companion' | 'voice',
  context: StartupContext
): string[] {
  const suggestions: string[] = [];

  if (mode === 'assistant') {
    // Task-focused suggestions
    if (context.pendingTasksCount > 0) {
      suggestions.push('Review my tasks');
    }
    if (context.todayEventsCount > 0) {
      suggestions.push("What's on my calendar today?");
    }
    // Always include generic helpers
    suggestions.push('Help me with something');
    suggestions.push('Search the web for something');
  } else if (mode === 'companion') {
    // Conversation-focused suggestions
    const hobbyFact = context.userFacts.find(f => f.category === 'hobby');
    if (hobbyFact) {
      suggestions.push(`Let's talk about ${hobbyFact.factValue}`);
    }
    suggestions.push("What's on your mind?");
    suggestions.push('Tell me something interesting');
    suggestions.push('I want to share something');
  } else if (mode === 'voice') {
    // Voice mode - shorter, conversational
    suggestions.push("What's new?");
    suggestions.push('Tell me a joke');
    suggestions.push("Let's chat");
  }

  // Limit to 4 suggestions
  return suggestions.slice(0, 4);
}

/**
 * Build the startup prompt for LLM
 */
function buildStartupPrompt(
  mode: 'assistant' | 'companion' | 'voice',
  context: StartupContext
): string {
  const greeting = getTimeGreeting(context.timeOfDay);
  const userName = context.userName ? `, ${context.userName}` : '';

  // Build context summary
  let contextSummary = '';

  if (context.pendingTasksCount > 0) {
    const taskInfo = context.overdueTasksCount > 0
      ? `${context.pendingTasksCount} pending tasks (${context.overdueTasksCount} overdue)`
      : `${context.pendingTasksCount} pending tasks`;

    const topTaskTitles = context.topTasks.slice(0, 2).map(t => {
      let title = t.title;
      if (t.priority === 'urgent' || t.priority === 'high') {
        title += ` [${t.priority}]`;
      }
      return title;
    });

    contextSummary += `\n- Tasks: ${taskInfo}`;
    if (topTaskTitles.length > 0) {
      contextSummary += ` - Top: "${topTaskTitles.join('", "')}"`;
    }
  }

  if (context.todayEventsCount > 0) {
    const eventSummary = context.todayEvents.slice(0, 2).map(e => {
      const time = new Date(e.startAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Europe/Stockholm',
      });
      return `${e.title} at ${time}`;
    });
    contextSummary += `\n- Calendar: ${context.todayEventsCount} events today - ${eventSummary.join(', ')}`;
  }

  // Build user facts summary for companion mode
  let factsSummary = '';
  if (mode === 'companion' && context.userFacts.length > 0) {
    const relevantFacts = context.userFacts
      .filter(f => ['hobby', 'preference', 'goal'].includes(f.category))
      .slice(0, 3);
    if (relevantFacts.length > 0) {
      factsSummary = '\n\nKnown about user:\n' + relevantFacts
        .map(f => `- ${f.category}: ${f.factKey} = ${f.factValue}`)
        .join('\n');
    }
  }

  const modeInstructions = mode === 'assistant'
    ? 'Be helpful and task-focused. Briefly mention what they have on their plate if relevant, and offer to help.'
    : mode === 'companion'
      ? 'Be warm and friendly. Show genuine interest in them. Reference something you know about them if appropriate.'
      : 'Be casual and conversational. Keep it short - 1-2 sentences max.';

  return `You are Luna, generating your FIRST message to start a new ${mode} session.

Context:
- Time: ${context.timeOfDay} (${greeting})
- User name: ${context.userName || 'unknown'}${contextSummary}${factsSummary}

Instructions:
1. Start with a natural ${context.timeOfDay} greeting${userName ? ' using their name' : ''}
2. ${modeInstructions}
3. Keep it to 2-3 sentences maximum
4. Be warm but not overwhelming
5. End with something that invites response
6. NEVER use em dash character

Generate ONLY Luna's greeting message, nothing else.`;
}

/**
 * Generate startup message for a new session
 */
export async function generateStartupMessage(
  userId: string,
  sessionId: string,
  mode: 'assistant' | 'companion' | 'voice'
): Promise<StartupResult> {
  logger.info('Generating startup message', { userId, sessionId, mode });

  // Build context
  const context = await buildStartupContext(userId);

  // Generate suggestions
  const suggestions = generateSuggestions(mode, context);

  // Build prompt
  const prompt = buildStartupPrompt(mode, context);

  // Generate message via LLM
  let content: string;
  try {
    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
      [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Generate the greeting.' },
      ],
      { temperature: 0.7, maxTokens: 200 }
    );

    content = (response.content || '').trim();

    // Fallback if empty
    if (!content) {
      const greeting = getTimeGreeting(context.timeOfDay);
      const name = context.userName ? `, ${context.userName}` : '';
      content = `${greeting}${name}! How can I help you today?`;
    }
  } catch (error) {
    logger.error('Failed to generate startup message via LLM', { error: (error as Error).message });
    // Fallback greeting
    const greeting = getTimeGreeting(context.timeOfDay);
    const name = context.userName ? `, ${context.userName}` : '';
    content = `${greeting}${name}! How can I help you today?`;
  }

  // Store the message
  const message = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content,
    tokensUsed: 0,
    model: config.ollama.chatModel,
  });

  logger.info('Startup message generated', { sessionId, messageId: message.id });

  return { message, suggestions };
}

export default {
  generateStartupMessage,
};
