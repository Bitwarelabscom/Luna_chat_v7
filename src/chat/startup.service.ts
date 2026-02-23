import { createCompletion } from '../llm/router.js';
import * as sessionService from './session.service.js';
import * as sessionLogService from './session-log.service.js';
import * as authService from '../auth/auth.service.js';
import type { Message } from '../types/index.js';
import logger from '../utils/logger.js';

export interface StartupContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  userName?: string;
  recentSessions: sessionLogService.SessionLogEntry[];
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
 * Simplified: just user info and recent session logs (fast DB query)
 */
async function buildStartupContext(userId: string): Promise<StartupContext> {
  const timeOfDay = getTimeOfDay();

  // Fetch user and recent sessions in parallel
  const [user, recentSessions] = await Promise.all([
    authService.getUserById(userId),
    sessionLogService.getRecentSessionLogs(userId, 5), // Last 5 sessions
  ]);

  return {
    timeOfDay,
    userName: user?.displayName || undefined,
    recentSessions,
  };
}


/**
 * Build the startup prompt for LLM (companion/voice modes only)
 */
function buildStartupPrompt(
  mode: 'companion' | 'voice',
  context: StartupContext
): string {
  const greeting = getTimeGreeting(context.timeOfDay);
  const sessionsContext = sessionLogService.formatLogsForContext(context.recentSessions);

  const modeInstructions = mode === 'voice'
    ? 'Keep to 1-2 sentences max. Casual tone.'
    : 'Be warm and friendly. Reference recent activity if relevant.';

  const sessionContinuityInstruction = context.recentSessions.length > 0
    ? '\n6. IMPORTANT: Reference the most recent session naturally if relevant (e.g., "Picking up from earlier..." or mentioning a topic). This shows continuity.'
    : '';

  return `You are Luna, starting a new ${mode} session.

Context:
- Time: ${context.timeOfDay} (${greeting})
- User: ${context.userName || 'friend'}

${sessionsContext || 'No recent sessions.'}

Instructions:
1. Greet naturally based on time of day${context.userName ? ' using their name' : ''}
2. ${modeInstructions}
3. Reference recent session context if available (mood, topics)
4. Invite response
5. Never use em dash character${sessionContinuityInstruction}

Generate ONLY Luna's greeting.`;
}

/**
 * Generate startup message for a new session
 * Returns null for assistant mode (no startup message)
 */
export async function generateStartupMessage(
  userId: string,
  sessionId: string,
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna'
): Promise<StartupResult | null> {
  // Assistant mode: no startup message
  if (mode === 'assistant') {
    logger.info('Skipping startup message for assistant mode', { sessionId });
    return null;
  }

  // DJ Luna mode: specific startup question
  if (mode === 'dj_luna') {
    logger.info('Generating startup message for DJ Luna mode', { sessionId });
    const content = "Yo! DJ Luna in the house. Ready to drop some fire Suno tracks? First, what genre are we vibing with today, and what should the lyrics be about?";
    const message = await sessionService.addMessage({
      sessionId,
      role: 'assistant',
      content,
      tokensUsed: 0,
      model: 'static',
    });
    return { message, suggestions: ['Synthwave', 'Epic Orchestral', 'Lo-fi Hip Hop'] };
  }

  if (mode === 'ceo_luna') {
    logger.info('Generating startup message for CEO Luna mode', { sessionId });
    const content = 'CEO Luna online. Share priorities, costs, leads, experiments, or blockers. I will focus on execution and growth.';
    const message = await sessionService.addMessage({
      sessionId,
      role: 'assistant',
      content,
      tokensUsed: 0,
      model: 'static',
    });
    return {
      message,
      suggestions: [
        'Set this week top 3 priorities',
        'Review funnel and lead generation gaps',
        'Plan a 7-day marketing experiment',
      ],
    };
  }

  logger.info('Generating startup message', { userId, sessionId, mode });

  // Build context (fast: just user + recent sessions from DB)
  const context = await buildStartupContext(userId);

  // No suggestions - let conversation flow naturally
  const suggestions: string[] = [];

  // Build prompt
  const prompt = buildStartupPrompt(mode, context);

  // Generate message via xAI grok-4-1-fast (fast inference)
  let content: string;
  const model = 'grok-4-1-fast';
  try {
    const response = await createCompletion(
      'xai',
      model,
      [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Generate the greeting.' },
      ],
      { temperature: 0.7, maxTokens: 150, loggingContext: { userId, sessionId, source: 'startup', nodeName: 'startup_greeting' } }
    );

    content = (response.content || '').trim();

    // Fallback if empty
    if (!content) {
      const greeting = getTimeGreeting(context.timeOfDay);
      const name = context.userName ? `, ${context.userName}` : '';
      content = `${greeting}${name}! How are you doing?`;
    }
  } catch (error) {
    logger.error('Failed to generate startup message via LLM', { error: (error as Error).message });
    // Fallback greeting
    const greeting = getTimeGreeting(context.timeOfDay);
    const name = context.userName ? `, ${context.userName}` : '';
    content = `${greeting}${name}! How are you doing?`;
  }

  // Store the message
  const message = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content,
    tokensUsed: 0,
    model,
  });

  logger.info('Startup message generated', { sessionId, messageId: message.id });

  return { message, suggestions };
}

export default {
  generateStartupMessage,
};
