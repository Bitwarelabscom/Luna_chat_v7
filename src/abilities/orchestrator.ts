import * as knowledge from './knowledge.service.js';
import * as tasks from './tasks.service.js';
import * as sandbox from './sandbox.service.js';
import * as documents from './documents.service.js';
import * as tools from './tools.service.js';
import * as mood from './mood.service.js';
import * as agents from './agents.service.js';
import * as calendar from './calendar.service.js';
import * as email from './email.service.js';
import * as spotify from './spotify.service.js';
import * as facts from '../memory/facts.service.js';
import * as coderSettings from './coder-settings.service.js';
import { createCompletion } from '../llm/router.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { intentCache } from './intent-cache.service.js';

export interface AbilityContext {
  knowledge: string;
  tasks: string;
  calendar: string;
  email: string;
  mood: string;
  spotify: string;
  tools: string[];
}

export interface AbilityIntent {
  type: 'task' | 'knowledge' | 'code' | 'document' | 'calendar' | 'email' | 'agent' | 'tool' | 'smalltalk' | 'weather' | 'status' | 'fact_correction' | 'spotify' | 'project' | 'none';
  action?: string;
  params?: Record<string, unknown>;
  confidence: number;
}

/**
 * Classify if a message is smalltalk (greetings, casual chat)
 * These should NOT trigger tools or context loading
 */
export function isSmallTalk(message: string): boolean {
  const lower = message.toLowerCase().trim();

  // Short greetings - definite smalltalk
  const greetings = [
    'hi', 'hello', 'hey', 'hej', 'good morning', 'good afternoon', 'good evening',
    'morning', 'evening', 'afternoon', 'howdy', 'yo', 'sup', "what's up", 'whats up',
    'hi luna', 'hello luna', 'hey luna', 'hej luna', 'hi there', 'hello there',
    'how are you', "how's it going", 'how are things', "how's everything",
    'thanks', 'thank you', 'thx', 'ty', 'ok', 'okay', 'cool', 'nice', 'great',
    'bye', 'goodbye', 'see you', 'later', 'good night', 'night',
  ];

  // Check if message is a greeting
  if (greetings.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ',') || lower.startsWith(g + '!'))) {
    return true;
  }

  // Very short messages without question marks or keywords are likely smalltalk
  if (lower.length < 20 && !lower.includes('?') && !hasActionKeywords(lower)) {
    return true;
  }

  return false;
}

/**
 * Check if message contains action keywords that suggest tool usage
 */
function hasActionKeywords(message: string): boolean {
  const actionKeywords = [
    'weather', 'rain', 'temperature', 'forecast', 'snow', 'wind', 'sunny', 'cloudy',
    'calendar', 'schedule', 'meeting', 'appointment', 'event', 'busy',
    'email', 'mail', 'inbox', 'unread', 'send', 'compose',
    'task', 'todo', 'remind', 'reminder',
    'search', 'find', 'look up', 'google', 'what is', 'who is', 'when did',
    'status', '/status', 'system', 'metrics',
    'help me', 'can you', 'please',
    'create', 'make', 'add', 'delete', 'remove', 'update', 'change',
    'document', 'file', 'upload', 'download',
    'code', 'script', 'run', 'execute', 'calculate',
    // Spotify/Music keywords
    'play', 'pause', 'music', 'song', 'spotify', 'track', 'artist', 'album', 'playlist', 'skip', 'next', 'previous', 'volume', 'queue',
  ];

  return actionKeywords.some(k => message.includes(k));
}

/**
 * Check if user is asking about weather
 */
export function isWeatherQuery(message: string): boolean {
  const lower = message.toLowerCase();
  const weatherKeywords = ['weather', 'rain', 'temperature', 'forecast', 'snow', 'wind', 'sunny', 'cloudy', 'humid', 'cold', 'hot', 'warm', 'degrees'];
  return weatherKeywords.some(k => lower.includes(k));
}

/**
 * Check if user is asking for status
 */
export function isStatusQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('/status') || lower.includes('system status') ||
         (lower.includes('status') && lower.includes('show')) ||
         lower.includes("what's running") || lower.includes('whats running');
}

/**
 * Check if user wants to create a multi-file project
 * These are requests that warrant the project builder workflow
 */
export function isProjectCreationIntent(message: string): boolean {
  const lower = message.toLowerCase();

  // Multi-file/project keywords
  const projectKeywords = [
    'create a website', 'build a website', 'make a website',
    'create a web page', 'build a web page', 'make a web page',
    'create a landing page', 'build a landing page', 'make a landing page',
    'create an app', 'build an app', 'make an app',
    'create a page', 'build a page', 'make a page',
    'html page', 'html and css', 'html css js',
    'with images', 'with pictures', 'generate images for',
    'portfolio', 'website for', 'web page for',
    'complete project', 'full project', 'multi-file',
    'create project', 'start a project', 'new project',
  ];

  // Check for project-like requests
  if (projectKeywords.some(k => lower.includes(k))) {
    return true;
  }

  // Complex creation patterns that suggest multi-file output
  const complexPatterns = [
    /create\s+(a\s+)?(?:full|complete|working)\s+\w+/i,
    /build\s+(me\s+)?(?:a\s+)?(?:website|app|page|site)/i,
    /make\s+(me\s+)?(?:a\s+)?(?:website|app|page|site)/i,
    /(?:website|page|app)\s+(?:with|that has|including)\s+/i,
    /(?:html|css|javascript|js)\s+(?:and|with|plus)\s+/i,
  ];

  return complexPatterns.some(p => p.test(lower));
}

interface ParsedCalendarEvent {
  title?: string;
  description?: string;
  startAt?: Date;
  endAt?: Date;
  location?: string;
  isAllDay?: boolean;
}

/**
 * Parse calendar event details from natural language text
 */
function parseCalendarEventFromText(text: string): ParsedCalendarEvent {
  const result: ParsedCalendarEvent = {};
  const now = new Date();

  // Extract title - look for quoted text or after keywords
  const quotedMatch = text.match(/"([^"]+)"|'([^']+)'/);
  if (quotedMatch) {
    result.title = quotedMatch[1] || quotedMatch[2];
  } else {
    // Try to extract title from patterns like "schedule meeting with X" or "create event X"
    const titlePatterns = [
      /(?:schedule|create|add|book|set up)\s+(?:a\s+)?(?:meeting|event|appointment|call)?\s*(?:called|named|titled)?\s*[:\-]?\s*(.+?)(?:\s+(?:on|at|for|from|tomorrow|today|next|this))/i,
      /(?:schedule|create|add|book|set up)\s+(?:a\s+)?(.+?)(?:\s+(?:on|at|for|from|tomorrow|today|next|this))/i,
      /(?:meeting|event|appointment|call)\s+(?:with|about|for|called|named)?\s*(.+?)(?:\s+(?:on|at|for|from|tomorrow|today|next|this))/i,
    ];

    for (const pattern of titlePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.title = match[1].trim().replace(/^(with|about|for)\s+/i, '');
        break;
      }
    }

    // Fallback: take first significant phrase
    if (!result.title) {
      const cleanText = text.replace(/\b(schedule|create|add|book|set up|a|an|the|meeting|event|appointment|call|for|on|at)\b/gi, ' ').trim();
      const words = cleanText.split(/\s+/).slice(0, 5);
      if (words.length > 0) {
        result.title = words.join(' ');
      }
    }
  }

  // Extract location - after "at" or "in" keywords
  const locationMatch = text.match(/(?:\bat\b|\bin\b)\s+(?!the|a|an)([^,]+?)(?:\s+(?:on|at|from|tomorrow|today|next)|\s*$)/i);
  if (locationMatch) {
    const loc = locationMatch[1].trim();
    // Exclude time-related phrases
    if (!/^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(loc)) {
      result.location = loc;
    }
  }

  // Parse date/time
  const dateTime = parseDateTimeFromText(text, now);
  if (dateTime.startAt) {
    result.startAt = dateTime.startAt;
    result.endAt = dateTime.endAt || new Date(dateTime.startAt.getTime() + 60 * 60 * 1000); // 1 hour default
    result.isAllDay = dateTime.isAllDay;
  }

  return result;
}

/**
 * Parse date and time from natural language
 */
function parseDateTimeFromText(text: string, now: Date): { startAt?: Date; endAt?: Date; isAllDay?: boolean } {
  const lower = text.toLowerCase();
  let targetDate = new Date(now);
  let hasTime = false;
  let isAllDay = false;

  // Parse relative days
  if (/\btomorrow\b/.test(lower)) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (/\btoday\b/.test(lower)) {
    // Keep current date
  } else if (/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) {
    const dayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    if (dayMatch) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(dayMatch[1].toLowerCase());
      const currentDay = targetDate.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      daysUntil += 7; // "next" means the following week
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }
  } else if (/\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) {
    const dayMatch = lower.match(/this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    if (dayMatch) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(dayMatch[1].toLowerCase());
      const currentDay = targetDate.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }
  } else if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) {
    const dayMatch = lower.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    if (dayMatch) {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(dayMatch[1].toLowerCase());
      const currentDay = targetDate.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }
  }

  // Parse specific date (MM/DD, Month DD, DD Month)
  const datePatterns = [
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/, // MM/DD or MM/DD/YYYY
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/i,
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (pattern === datePatterns[0]) {
        // MM/DD format
        const month = parseInt(match[1]) - 1;
        const day = parseInt(match[2]);
        const year = match[3] ? parseInt(match[3]) : now.getFullYear();
        targetDate = new Date(year < 100 ? 2000 + year : year, month, day);
      } else {
        // Month name format
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        let monthStr: string;
        let dayStr: string;
        let yearStr: string | undefined;

        if (pattern === datePatterns[1]) {
          monthStr = match[1].toLowerCase().slice(0, 3);
          dayStr = match[2];
          yearStr = match[3];
        } else {
          dayStr = match[1];
          monthStr = match[2].toLowerCase().slice(0, 3);
        }

        const month = monthNames.indexOf(monthStr);
        const day = parseInt(dayStr);
        const year = yearStr ? parseInt(yearStr) : now.getFullYear();
        targetDate = new Date(year, month, day);
      }
      break;
    }
  }

  // Parse time
  const timePatterns = [
    /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\b(\d{1,2}):(\d{2})\b/,
  ];

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const meridiem = match[3]?.toLowerCase();

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      targetDate.setHours(hours, minutes, 0, 0);
      hasTime = true;
      break;
    }
  }

  // Check for all-day
  if (/\ball\s*day\b/i.test(lower)) {
    isAllDay = true;
    targetDate.setHours(0, 0, 0, 0);
  } else if (!hasTime) {
    // Default to 9 AM if no time specified
    targetDate.setHours(9, 0, 0, 0);
  }

  // Parse end time or duration
  let endDate = new Date(targetDate);
  const durationMatch = text.match(/\bfor\s+(\d+)\s*(hour|hr|minute|min)s?\b/i);
  const endTimeMatch = text.match(/\b(?:to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

  if (durationMatch) {
    const amount = parseInt(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    if (unit.startsWith('hour') || unit.startsWith('hr')) {
      endDate = new Date(targetDate.getTime() + amount * 60 * 60 * 1000);
    } else {
      endDate = new Date(targetDate.getTime() + amount * 60 * 1000);
    }
  } else if (endTimeMatch) {
    let hours = parseInt(endTimeMatch[1]);
    const minutes = endTimeMatch[2] ? parseInt(endTimeMatch[2]) : 0;
    const meridiem = endTimeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    endDate = new Date(targetDate);
    endDate.setHours(hours, minutes, 0, 0);
  } else if (isAllDay) {
    endDate = new Date(targetDate);
    endDate.setDate(endDate.getDate() + 1);
  } else {
    // Default 1 hour duration
    endDate = new Date(targetDate.getTime() + 60 * 60 * 1000);
  }

  return {
    startAt: targetDate,
    endAt: endDate,
    isAllDay,
  };
}

/**
 * Options for context building - allows selective loading
 */
export interface ContextBuildOptions {
  skipAll?: boolean;       // For smalltalk - skip all context loading
  loadKnowledge?: boolean; // Load relevant knowledge
  loadTasks?: boolean;     // Load pending tasks
  loadCalendar?: boolean;  // Load upcoming events
  loadEmail?: boolean;     // Load recent emails
  loadMood?: boolean;      // Process mood
  loadTools?: boolean;     // Load available tools
  loadSpotify?: boolean;   // Load Spotify playback state
}

/**
 * Determine what context to load based on message intent
 */
export function getContextOptions(message: string): ContextBuildOptions {
  // Smalltalk - skip everything
  if (isSmallTalk(message)) {
    logger.debug('Smalltalk detected - skipping context loading', { message: message.slice(0, 50) });
    return { skipAll: true };
  }

  const lower = message.toLowerCase();

  // Determine which contexts are relevant
  const options: ContextBuildOptions = {
    loadKnowledge: true, // Always check for relevant memories
    loadTasks: /\b(task|todo|remind|pending|overdue)\b/i.test(lower),
    loadCalendar: /\b(calendar|schedule|meeting|event|appointment|today|tomorrow|busy)\b/i.test(lower),
    loadEmail: /\b(email|mail|inbox|unread)\b/i.test(lower),
    loadMood: true, // Mood is lightweight
    loadTools: /\b(tool|search|execute|run|calculate|weather|document)\b/i.test(lower) || lower.includes('?'),
    loadSpotify: /\b(play|pause|music|song|spotify|track|artist|album|playlist|skip|next|previous|volume|queue|listen|what.*playing)\b/i.test(lower),
  };

  return options;
}

/**
 * Build context from all abilities for prompt enrichment
 * Now with selective loading based on message intent
 */
export async function buildAbilityContext(
  userId: string,
  message: string,
  sessionId?: string,
  options?: ContextBuildOptions
): Promise<AbilityContext> {
  // Determine options if not provided
  const opts = options || getContextOptions(message);

  // Empty context for smalltalk
  if (opts.skipAll) {
    return {
      knowledge: '',
      tasks: '',
      calendar: '',
      email: '',
      mood: '',
      spotify: '',
      tools: [],
    };
  }

  try {
    // Selective fetches based on options
    const promises: Promise<unknown>[] = [];
    const indices: { knowledge?: number; tasks?: number; calendar?: number; email?: number; mood?: number; moodTrends?: number; tools?: number; spotify?: number } = {};

    if (opts.loadKnowledge !== false) {
      indices.knowledge = promises.length;
      promises.push(knowledge.searchKnowledge(userId, message, 3).catch(() => []));
    }

    if (opts.loadTasks) {
      indices.tasks = promises.length;
      promises.push(tasks.getTasks(userId, { status: 'pending', limit: 5 }).catch(() => []));
    }

    if (opts.loadCalendar) {
      indices.calendar = promises.length;
      promises.push(calendar.getUpcomingEvents(userId, { days: 2, limit: 3 }).catch(() => []));
    }

    if (opts.loadEmail) {
      indices.email = promises.length;
      promises.push(email.getRecentEmails(userId, { limit: 3, unreadOnly: true }).catch(() => []));
    }

    if (opts.loadMood !== false && sessionId) {
      indices.mood = promises.length;
      promises.push(mood.processMoodFromMessage(userId, sessionId, message).catch(() => null));
      indices.moodTrends = promises.length;
      promises.push(mood.getMoodTrends(userId, 7).catch(() => ({ averageSentiment: 0, dominantEmotions: [], moodTrend: 'stable' as const, topTopics: [] })));
    }

    if (opts.loadTools) {
      indices.tools = promises.length;
      promises.push(tools.getTools(userId, true).catch(() => []));
    }

    if (opts.loadSpotify) {
      indices.spotify = promises.length;
      promises.push(spotify.getPlaybackStatus(userId).catch(() => null));
    }

    const results = await Promise.all(promises);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getResult = <T>(key: keyof typeof indices): T | null => {
      const idx = indices[key];
      return idx !== undefined ? results[idx] as T : null;
    };

    const relevantKnowledge = getResult<Awaited<ReturnType<typeof knowledge.searchKnowledge>>>('knowledge') || [];
    const pendingTasks = getResult<Awaited<ReturnType<typeof tasks.getTasks>>>('tasks') || [];
    const upcomingEvents = getResult<Awaited<ReturnType<typeof calendar.getUpcomingEvents>>>('calendar') || [];
    const recentEmails = getResult<Awaited<ReturnType<typeof email.getRecentEmails>>>('email') || [];
    const currentMood = getResult<Awaited<ReturnType<typeof mood.processMoodFromMessage>>>('mood');
    const moodTrends = getResult<Awaited<ReturnType<typeof mood.getMoodTrends>>>('moodTrends') || { averageSentiment: 0, dominantEmotions: [], moodTrend: 'stable' as const, topTopics: [] };
    const userTools = getResult<Awaited<ReturnType<typeof tools.getTools>>>('tools') || [];
    const spotifyState = getResult<Awaited<ReturnType<typeof spotify.getPlaybackStatus>>>('spotify');

    return {
      knowledge: knowledge.formatKnowledgeForPrompt(relevantKnowledge),
      tasks: tasks.formatTasksForPrompt(pendingTasks),
      calendar: calendar.formatCalendarForPrompt(upcomingEvents),
      email: email.formatEmailsForPrompt(recentEmails),
      mood: mood.formatMoodForPrompt(currentMood, moodTrends),
      spotify: spotify.formatSpotifyForPrompt(spotifyState),
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
      spotify: '',
      tools: [],
    };
  }
}

/**
 * Format ability context for inclusion in system prompt
 * Uses deterministic ordering and consistent headers for cache optimization
 */
export function formatAbilityContextForPrompt(context: AbilityContext): string {
  const sections: string[] = [];

  // Always include sections in consistent order for cache determinism
  // Use consistent headers even when content is empty

  // Calendar section - always present
  if (context.calendar) {
    sections.push(context.calendar);
  } else {
    sections.push('[Calendar]\n(No upcoming events)');
  }

  // Tasks section - always present
  if (context.tasks) {
    sections.push(context.tasks);
  } else {
    sections.push('[Tasks]\n(No pending tasks)');
  }

  // Email section - always present
  if (context.email) {
    sections.push(context.email);
  } else {
    sections.push('[Email]\n(No new mail)');
  }

  // Mood section - only if available (not critical for consistency)
  if (context.mood) {
    sections.push(context.mood);
  }

  // Spotify section - only if available
  if (context.spotify) {
    sections.push(context.spotify);
  }

  // Knowledge section - only if relevant documents found
  if (context.knowledge) {
    sections.push(context.knowledge);
  }

  // Tools section - sort for determinism
  if (context.tools.length > 0) {
    const sortedTools = [...context.tools].sort();
    sections.push(`[Available Tools]\n${sortedTools.join(', ')}`);
  }

  return sections.join('\n\n');
}

/**
 * Detect if message should be routed directly to a specific coding agent
 * Returns the preferred agent name or null if no shortcut matches
 *
 * @deprecated Use detectCodingAgentWithSettings for user-aware routing
 */
export function detectCodingAgentShortcut(message: string): 'coder-claude' | 'coder-gemini' | null {
  const lower = message.toLowerCase();

  // Keywords that strongly suggest coder-gemini (large context, high volume)
  const geminiTriggers = [
    'huge', 'large', 'massive', 'entire', 'whole',     // Large context indicators
    'log', 'logs', 'analyze log', 'error log',         // Log analysis
    'all files', 'entire codebase', 'whole repo',      // Full repo analysis
    'unit test', 'tests for', 'write tests',           // Test generation
    'explain this code', 'what does this do',          // Code explanation
    'simple script', 'quick script', 'utility',        // Simple scripts
    'boilerplate', 'generate', 'scaffold',             // Code generation
    'documentation', 'document this', 'comments',      // Documentation
  ];

  // Keywords that strongly suggest coder-claude (complexity, security)
  const claudeTriggers = [
    'refactor', 'restructure', 'redesign',             // Architectural changes
    'security', 'vulnerability', 'auth', 'authentication', // Security-critical
    'debug', 'fix bug', 'race condition', 'deadlock',  // Complex debugging
    'architecture', 'design pattern', 'system design', // Architecture
    'optimize', 'performance', 'bottleneck',           // Performance optimization
    'migration', 'upgrade', 'legacy',                  // Complex migrations
    'critical', 'production', 'production-ready',      // Production code
    'careful', 'thoroughly', 'edge case',              // Requires deep thinking
  ];

  // Check for gemini triggers
  for (const trigger of geminiTriggers) {
    if (lower.includes(trigger)) {
      logger.debug('Coding agent shortcut: coder-gemini', { trigger });
      return 'coder-gemini';
    }
  }

  // Check for claude triggers
  for (const trigger of claudeTriggers) {
    if (lower.includes(trigger)) {
      logger.debug('Coding agent shortcut: coder-claude', { trigger });
      return 'coder-claude';
    }
  }

  return null;
}

/**
 * Detect coding agent with user-aware routing
 *
 * Routing priority:
 * 1. Explicit override (@coder-claude, "use coder-gemini", etc.)
 * 2. If only one coder enabled, use it for all tasks
 * 3. Match against user's custom trigger words
 * 4. Use user's default coder setting
 *
 * Returns null if no coders are enabled or no match found
 */
export async function detectCodingAgentWithSettings(
  userId: string,
  message: string
): Promise<coderSettings.CoderType | null> {
  try {
    // Get user's coder settings
    const settings = await coderSettings.getCoderSettings(userId);

    // Check for explicit override in message (@coder-claude, "use coder-gemini", etc.)
    const explicitOverride = coderSettings.parseExplicitOverride(message);

    if (explicitOverride) {
      logger.debug('Explicit coder override detected', { override: explicitOverride, userId });
    }

    // Use the routing logic from coder-settings service
    const selectedCoder = coderSettings.selectCoderForTask(settings, message, explicitOverride);

    if (selectedCoder) {
      logger.debug('Selected coder agent', {
        coder: selectedCoder,
        userId,
        hadExplicitOverride: !!explicitOverride,
      });
    }

    return selectedCoder;
  } catch (error) {
    logger.error('Failed to detect coding agent with settings', {
      error: (error as Error).message,
      userId,
    });
    // Fall back to legacy detection
    return detectCodingAgentShortcut(message);
  }
}

/**
 * Detect user intent for abilities
 */
export function detectAbilityIntent(message: string): AbilityIntent {
  const lower = message.toLowerCase();

  // Check for smalltalk FIRST - this prevents tool spam on greetings
  if (isSmallTalk(message)) {
    return {
      type: 'smalltalk',
      confidence: 0.95,
    };
  }

  // Check for explicit status request
  if (isStatusQuery(message)) {
    return {
      type: 'status',
      action: 'show',
      confidence: 0.9,
    };
  }

  // Check for project creation intent
  if (isProjectCreationIntent(message)) {
    return {
      type: 'project',
      action: 'create',
      confidence: 0.85,
    };
  }

  // Check for weather query
  if (isWeatherQuery(message)) {
    return {
      type: 'weather',
      action: 'check',
      confidence: 0.85,
    };
  }

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
    const isCreate = /\b(add|create|schedule|set up|book|new)\b/i.test(lower);
    const isDelete = /\b(delete|remove|cancel|clear)\b/i.test(lower);
    const isUpdate = /\b(update|change|modify|reschedule|move)\b/i.test(lower);
    const isList = /\b(list|show|what|my calendar|events|upcoming)\b/i.test(lower);

    return {
      type: 'calendar',
      action: isCreate ? 'create' : isDelete ? 'delete' : isUpdate ? 'update' : isList ? 'list' : 'query',
      confidence: 0.8,
    };
  }

  // Email intents
  if (/\b(email|mail|inbox|unread|message from)\b/i.test(lower)) {
    const isSend = /\b(send|write|compose|email to|mail to|reply)\b/i.test(lower);
    const isCheck = /\b(check|inbox|unread|my email|read)\b/i.test(lower);
    return {
      type: 'email',
      action: isSend ? 'send' : isCheck ? 'check' : 'query',
      confidence: 0.8,
    };
  }

  // Fact correction intents - user wants Luna to forget or correct something she learned
  if (/\b(forget|wrong|incorrect|not true|no longer|not anymore|actually|correct that|update that)\b/i.test(lower)) {
    // Check for patterns indicating fact correction
    const forgetPatterns = [
      /forget\s+(?:that\s+)?(?:i|my|about)/i,
      /(?:that's|thats|that is)\s+(?:not\s+)?(?:true|correct|right|wrong|incorrect)/i,
      /(?:i'm|im|i am)\s+(?:not|no longer)\s+/i,
      /(?:not|no longer)\s+(?:on\s+)?(?:a\s+)?break/i,
      /actually[,\s]+(?:i|my|i'm)/i,
      /correct\s+(?:that|the\s+fact)/i,
      /update\s+(?:that|the\s+fact)/i,
      /(?:delete|remove)\s+(?:that|the)\s+(?:fact|memory|information)/i,
      /you(?:'ve|'re|\s+have|\s+are)\s+(?:got\s+)?(?:it\s+)?wrong/i,
      /(?:i\s+)?(?:was\s+)?wrong\s+(?:about|when)/i,
    ];

    if (forgetPatterns.some(p => p.test(lower))) {
      const isDelete = /\b(forget|delete|remove)\b/i.test(lower);
      return {
        type: 'fact_correction',
        action: isDelete ? 'delete' : 'update',
        confidence: 0.85,
      };
    }
  }

  // Spotify/Music intents
  if (/\b(play|pause|stop|skip|next|previous|volume|music|song|spotify|track|artist|album|playlist|queue|shuffle|repeat|listen|what.*playing|now playing|create.*playlist|make.*playlist)\b/i.test(lower)) {
    const isCreatePlaylist = /\b(create|make)\b.*\bplaylist\b/i.test(lower);
    const isPlay = /\b(play|put on|start|listen|throw on)\b/i.test(lower) && !isCreatePlaylist;
    const isPause = /\b(pause|stop)\b/i.test(lower);
    const isSkip = /\b(skip|next)\b/i.test(lower);
    const isPrevious = /\b(previous|back|go back)\b/i.test(lower);
    const isVolume = /\b(volume|louder|quieter|turn up|turn down)\b/i.test(lower);
    const isQueue = /\b(queue|add to queue|play next)\b/i.test(lower);
    const isStatus = /\b(what.*playing|now playing|current song|what song)\b/i.test(lower);
    const isDevice = /\b(device|speaker|phone|computer|transfer)\b/i.test(lower);
    const isSearch = /\b(find|search|look for)\b/i.test(lower) && /\b(song|track|music|artist)\b/i.test(lower);
    const isRecommend = /\b(recommend|suggestion|something|mood|chill|energetic|calm|happy|sad)\b/i.test(lower) && /\b(music|play|listen)\b/i.test(lower);

    return {
      type: 'spotify',
      action: isCreatePlaylist ? 'create_playlist' : isPlay ? 'play' : isPause ? 'pause' : isSkip ? 'next' : isPrevious ? 'previous' :
              isVolume ? 'volume' : isQueue ? 'queue' : isStatus ? 'status' : isDevice ? 'device' :
              isSearch ? 'search' : isRecommend ? 'recommend' : 'query',
      confidence: 0.85,
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
 * Detect ability intent with semantic caching
 * Uses cached intents for similar queries to skip redundant detection
 */
export async function detectAbilityIntentWithCache(
  message: string
): Promise<AbilityIntent> {
  // Skip caching for very short messages
  if (message.length < 20) {
    return detectAbilityIntent(message);
  }

  try {
    // Check cache first
    const cached = await intentCache.getCachedIntent(message);

    if (cached && cached.confidence >= 0.8) {
      logger.debug('Using cached intent', {
        agentType: cached.agentType,
        confidence: cached.confidence,
        cacheAge: Date.now() - cached.timestamp,
      });

      // Map cached agent type back to AbilityIntent
      return {
        type: cached.agentType as AbilityIntent['type'],
        confidence: cached.confidence,
      };
    }

    // Fall back to rule-based detection
    const intent = detectAbilityIntent(message);

    // Cache the result if confident enough and not 'none' or 'smalltalk'
    if (intent.confidence >= 0.7 && intent.type !== 'none' && intent.type !== 'smalltalk') {
      await intentCache.cacheIntent(message, intent.type, intent.confidence);
    }

    return intent;
  } catch (error) {
    // On cache error, fall back to rule-based detection
    logger.warn('Intent cache error, falling back to rule-based', {
      error: (error as Error).message,
    });
    return detectAbilityIntent(message);
  }
}

/**
 * Use LLM to identify which fact the user wants to correct/delete
 */
async function identifyFactToCorrect(
  message: string,
  userFacts: facts.UserFact[]
): Promise<{ factId: string | null; newValue?: string }> {
  const factsJson = userFacts.map(f => ({
    id: f.id,
    category: f.category,
    key: f.factKey,
    value: f.factValue,
  }));

  const prompt = `You are analyzing a user's message to identify which stored fact they want to change or delete.

User's stored facts:
${JSON.stringify(factsJson, null, 2)}

User's message: "${message}"

Analyze the message and determine:
1. Which fact (by id) the user is referring to, if any
2. If they want to update it, what the new value should be

Output JSON only:
{"factId": "uuid-here-or-null", "newValue": "new value or null if deleting"}

If you cannot determine which fact they mean, output: {"factId": null}
If they are deleting/forgetting, set newValue to null.
Only return the JSON object.`;

  try {
    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
      [
        { role: 'system', content: 'You identify facts from user messages. Output only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, maxTokens: 500 }
    );

    const content = response.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { factId: null };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      factId: parsed.factId || null,
      newValue: parsed.newValue || undefined,
    };
  } catch (error) {
    logger.error('Failed to identify fact to correct', { error: (error as Error).message });
    return { factId: null };
  }
}

/**
 * Execute a confirmed fact correction (called after user confirms)
 */
export async function executeFactCorrection(
  userId: string,
  action: 'delete' | 'update',
  factId: string,
  newValue?: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  try {
    if (action === 'delete') {
      const result = await facts.deleteFact(userId, factId, reason);
      if (result.success && result.deletedFact) {
        return {
          success: true,
          message: `Done! I've forgotten that your ${result.deletedFact.factKey} was "${result.deletedFact.factValue}".`,
        };
      }
      return { success: false, message: "I couldn't find that fact to delete." };
    } else {
      if (!newValue) {
        return { success: false, message: 'No new value provided for the update.' };
      }
      const result = await facts.updateFact(userId, factId, newValue, reason);
      if (result.success) {
        return {
          success: true,
          message: `Updated! I've changed that from "${result.oldValue}" to "${newValue}".`,
        };
      }
      return { success: false, message: "I couldn't find that fact to update." };
    }
  } catch (error) {
    logger.error('Failed to execute fact correction', { error: (error as Error).message });
    return { success: false, message: 'Something went wrong while correcting that fact.' };
  }
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

      case 'project': {
        // Project creation is handled separately in chat.service.ts
        // This case just flags that project mode should be activated
        return {
          handled: false, // Let chat service handle the full flow
          result: '[PROJECT_INTENT_DETECTED]', // Signal to chat service
          data: { intent: 'create_project', message },
        };
      }

      case 'calendar': {
        // Create calendar event
        if (intent.action === 'create') {
          const parsed = parseCalendarEventFromText(message);
          if (parsed.title) {
            try {
              const event = await calendar.createEvent(userId, {
                title: parsed.title,
                description: parsed.description,
                startAt: parsed.startAt || new Date(),
                endAt: parsed.endAt || new Date(Date.now() + 60 * 60 * 1000), // 1 hour default
                location: parsed.location,
                isAllDay: parsed.isAllDay,
              });
              const eventDate = new Date(event.startAt);
              const dateStr = eventDate.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
              const timeStr = eventDate.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
              return {
                handled: true,
                result: `Created calendar event: "${event.title}" on ${dateStr} at ${timeStr}${event.location ? ` @ ${event.location}` : ''}`,
                data: event,
              };
            } catch (error) {
              return {
                handled: true,
                result: `Could not create calendar event: ${(error as Error).message}`,
                data: null,
              };
            }
          }
          return {
            handled: true,
            result: 'I can create a calendar event for you. Please tell me the event title, date, and time.',
            data: { needsDetails: true },
          };
        }

        // Delete calendar event
        if (intent.action === 'delete') {
          // For delete, we need an event ID - would need to list events first
          const upcoming = await calendar.getUpcomingEvents(userId, { days: 30, limit: 10 });
          if (upcoming.length === 0) {
            return {
              handled: true,
              result: 'No upcoming events to delete.',
              data: null,
            };
          }
          return {
            handled: true,
            result: `Here are your upcoming events. Which one would you like to delete?\n${upcoming.map((e, i) => {
              const d = new Date(e.startAt);
              return `${i + 1}. ${e.title} - ${d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
            }).join('\n')}`,
            data: { events: upcoming, action: 'delete' },
          };
        }

        // Update calendar event
        if (intent.action === 'update') {
          const upcoming = await calendar.getUpcomingEvents(userId, { days: 30, limit: 10 });
          if (upcoming.length === 0) {
            return {
              handled: true,
              result: 'No upcoming events to update.',
              data: null,
            };
          }
          return {
            handled: true,
            result: `Here are your upcoming events. Which one would you like to update?\n${upcoming.map((e, i) => {
              const d = new Date(e.startAt);
              return `${i + 1}. ${e.title} - ${d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
            }).join('\n')}`,
            data: { events: upcoming, action: 'update' },
          };
        }

        // List or query events
        const events = await calendar.getTodayEvents(userId);
        if (events.length === 0) {
          const upcoming = await calendar.getUpcomingEvents(userId, { days: 7, limit: 5 });
          return {
            handled: true,
            result: upcoming.length > 0
              ? `No events today. Upcoming:\n${calendar.formatCalendarForPrompt(upcoming)}`
              : 'No calendar events found. You can ask me to create events for you!',
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
        // Check Luna's own inbox
        if (intent.action === 'check') {
          const lunaEmails = await email.getLunaUnreadEmails();
          if (lunaEmails.length > 0) {
            return {
              handled: true,
              result: `${lunaEmails.length} unread email(s) in my inbox:\n${email.formatLunaInboxForPrompt(lunaEmails)}`,
              data: { emails: lunaEmails },
            };
          }
          // Fall through to user's connected emails
        }

        // Send email from Luna
        if (intent.action === 'send') {
          // Parse email details from message
          const toMatch = message.match(/(?:to|email)\s+([^\s,]+@[^\s,]+)/i);
          const subjectMatch = message.match(/subject[:\s]+["']?([^"'\n]+)["']?/i);

          if (toMatch) {
            const recipient = toMatch[1];
            const canSend = email.canLunaEmailRecipient(recipient);

            if (!canSend) {
              return {
                handled: true,
                result: `I can't send emails to ${recipient} - they're not in my approved recipients list. I can only email addresses at bitwarelabs.com.`,
                data: { blocked: true, recipient },
              };
            }

            // If we have enough info, note it for the user
            return {
              handled: true,
              result: `I can send an email to ${recipient}. What would you like me to say? (Subject: ${subjectMatch?.[1] || 'needed'})`,
              data: { recipient, subject: subjectMatch?.[1], needsContent: true },
            };
          }

          return {
            handled: true,
            result: 'I can send emails from luna@bitwarelabs.com to approved recipients (anyone @bitwarelabs.com). Who would you like me to email?',
            data: { needsRecipient: true },
          };
        }

        // Query user's connected emails
        const emails_list = await email.getRecentEmails(userId, { limit: 5, unreadOnly: true });
        const summary = await email.getEmailSummary(userId);
        return {
          handled: true,
          result: summary.unreadCount > 0
            ? `${summary.unreadCount} unread emails:\n${email.formatEmailsForPrompt(emails_list)}`
            : 'No unread emails. Connect your email for inbox awareness.',
          data: { emails: emails_list, summary },
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

      case 'fact_correction': {
        // Get all user facts to help identify which one they want to change
        const userFacts = await facts.getUserFacts(userId, { limit: 50 });

        if (userFacts.length === 0) {
          return {
            handled: true,
            result: "I don't have any facts stored about you yet, so there's nothing to correct or forget.",
            data: null,
          };
        }

        // Use LLM to identify which fact the user is referring to
        const matchResult = await identifyFactToCorrect(message, userFacts);

        if (!matchResult.factId) {
          // Couldn't identify the fact - ask for clarification
          const factList = userFacts.slice(0, 10).map(f =>
            `- ${f.category}: ${f.factKey} = "${f.factValue}"`
          ).join('\n');

          return {
            handled: true,
            result: `I'm not sure which fact you want me to ${intent.action === 'delete' ? 'forget' : 'correct'}. Here's what I know about you:\n\n${factList}\n\nWhich one would you like me to change?`,
            data: { facts: userFacts.slice(0, 10), needsClarification: true },
          };
        }

        // Found the fact - ask for confirmation
        const targetFact = userFacts.find(f => f.id === matchResult.factId);
        if (!targetFact) {
          return {
            handled: true,
            result: "I couldn't find that fact in my memory. It may have already been removed.",
            data: null,
          };
        }

        if (intent.action === 'delete') {
          return {
            handled: true,
            result: `Are you sure you want me to forget that your ${targetFact.factKey} is "${targetFact.factValue}"? Reply "yes" to confirm, or tell me if I got the wrong fact.`,
            data: {
              pendingAction: 'delete',
              factId: targetFact.id,
              factKey: targetFact.factKey,
              factValue: targetFact.factValue,
              needsConfirmation: true,
            },
          };
        } else {
          // Update - need the new value
          if (matchResult.newValue) {
            return {
              handled: true,
              result: `You want me to update your ${targetFact.factKey} from "${targetFact.factValue}" to "${matchResult.newValue}". Is that correct? Reply "yes" to confirm.`,
              data: {
                pendingAction: 'update',
                factId: targetFact.id,
                factKey: targetFact.factKey,
                oldValue: targetFact.factValue,
                newValue: matchResult.newValue,
                needsConfirmation: true,
              },
            };
          } else {
            return {
              handled: true,
              result: `You want me to update your ${targetFact.factKey} (currently "${targetFact.factValue}"). What should I change it to?`,
              data: {
                pendingAction: 'update',
                factId: targetFact.id,
                factKey: targetFact.factKey,
                oldValue: targetFact.factValue,
                needsNewValue: true,
              },
            };
          }
        }
      }

      case 'spotify': {
        // Handle Spotify music control
        const isLinked = await spotify.isSpotifyLinked(userId);
        if (!isLinked) {
          return {
            handled: true,
            result: "You haven't connected your Spotify account yet. Go to Settings > Integrations to connect your Spotify account.",
            data: { needsAuth: true },
          };
        }

        switch (intent.action) {
          case 'play': {
            // Extract what to play from the message
            const playMatch = message.match(/play\s+(?:some\s+)?(?:music\s+)?(?:by\s+)?(.+)/i) ||
                              message.match(/put\s+on\s+(.+)/i) ||
                              message.match(/listen\s+to\s+(.+)/i);
            const query = playMatch?.[1]?.trim();

            // Determine type from message
            let type: 'track' | 'artist' | 'album' | 'playlist' | undefined;
            if (/\balbum\b/i.test(message)) type = 'album';
            else if (/\bartist\b/i.test(message)) type = 'artist';
            else if (/\bplaylist\b/i.test(message)) type = 'playlist';
            else type = 'track';

            const result = await spotify.playMusic(userId, {
              query: query || undefined,
              type: query ? type : undefined,
            });
            return {
              handled: true,
              result: result.message,
              data: { track: result.track, success: result.success },
            };
          }

          case 'pause': {
            const result = await spotify.pauseMusic(userId);
            return {
              handled: true,
              result: result.message,
              data: { success: result.success },
            };
          }

          case 'next': {
            const result = await spotify.skipTrack(userId, 'next');
            return {
              handled: true,
              result: result.message,
              data: { track: result.track, success: result.success },
            };
          }

          case 'previous': {
            const result = await spotify.skipTrack(userId, 'previous');
            return {
              handled: true,
              result: result.message,
              data: { track: result.track, success: result.success },
            };
          }

          case 'volume': {
            const volumeMatch = message.match(/(\d+)\s*%?/);
            const volume = volumeMatch ? parseInt(volumeMatch[1]) : 50;
            const result = await spotify.setVolume(userId, volume);
            return {
              handled: true,
              result: result.message,
              data: { success: result.success },
            };
          }

          case 'queue': {
            // Extract tracks to queue - handle various phrasings like "queue röyksopp", "queue up röyksopp", "add röyksopp to queue"
            const queueMatch = message.match(/(?:queue\s+(?:up\s+)?(?:more\s+)?|add\s+(?:to\s+queue\s+)?|play\s+next\s+)(.+)/i) ||
                               message.match(/(?:add\s+)?(.+?)(?:\s+to\s+(?:the\s+)?queue)/i);
            const rawQuery = queueMatch?.[1]?.trim();

            if (!rawQuery) {
              return {
                handled: true,
                result: "What would you like me to add to the queue?",
                data: { needsQuery: true },
              };
            }

            // Split on "and" to handle multiple artists/tracks
            const queries = rawQuery.split(/\s+and\s+/i).map(q => q.trim()).filter(Boolean);
            const allAddedTracks: Array<{ name: string; artist: string }> = [];

            for (const query of queries) {
              // Use addMultipleToQueue to add 5 tracks per query (artist/search term)
              const result = await spotify.addMultipleToQueue(userId, query, 5);
              if (result.success && result.tracksAdded.length > 0) {
                for (const track of result.tracksAdded) {
                  allAddedTracks.push({ name: track.name, artist: track.artists[0]?.name || 'Unknown' });
                }
              }
            }

            if (allAddedTracks.length === 0) {
              return {
                handled: true,
                result: `Couldn't find tracks for: ${queries.join(', ')}`,
                data: { success: false },
              };
            }

            // Format the track list nicely
            const trackList = allAddedTracks.map(t => `"${t.name}" by ${t.artist}`).join(', ');

            return {
              handled: true,
              result: `Added ${allAddedTracks.length} tracks to queue: ${trackList}`,
              data: { tracksAdded: allAddedTracks, count: allAddedTracks.length },
            };
          }

          case 'status': {
            const state = await spotify.getPlaybackStatus(userId);
            if (!state) {
              return {
                handled: true,
                result: "Nothing is currently playing.",
                data: { playing: false },
              };
            }
            return {
              handled: true,
              result: spotify.formatSpotifyForPrompt(state),
              data: { state },
            };
          }

          case 'device': {
            const devices = await spotify.getAvailableDevices(userId);
            if (devices.length === 0) {
              return {
                handled: true,
                result: "No Spotify devices found. Open Spotify on a device first.",
                data: { devices: [] },
              };
            }

            // Check if user wants to transfer
            const transferMatch = message.match(/(?:transfer|move|switch)\s+(?:to\s+)?(.+)/i) ||
                                  message.match(/(?:on\s+)?(?:my\s+)?(.+?)(?:\s+please)?$/i);
            const targetDevice = transferMatch?.[1]?.trim();

            if (targetDevice && !/\b(device|list|show)\b/i.test(targetDevice)) {
              const device = devices.find(d =>
                d.name.toLowerCase().includes(targetDevice.toLowerCase())
              );
              if (device) {
                const result = await spotify.transferPlayback(userId, device.id, true);
                return {
                  handled: true,
                  result: result.message,
                  data: { device, success: result.success },
                };
              }
            }

            return {
              handled: true,
              result: `Available devices:\n${devices.map(d => `- ${d.name} (${d.type})${d.isActive ? ' [active]' : ''}`).join('\n')}`,
              data: { devices },
            };
          }

          case 'recommend': {
            // Extract mood from message
            const moodMatch = message.match(/\b(happy|sad|energetic|calm|focused|workout|sleep|party|chill|romantic)\b/i);
            const mood = moodMatch?.[1]?.toLowerCase();

            const tracks = await spotify.getRecommendations(userId, { mood, limit: 5 });
            if (tracks.length === 0) {
              return {
                handled: true,
                result: "I couldn't get recommendations right now. Try playing something specific instead.",
                data: { tracks: [] },
              };
            }

            // Play the first recommendation
            const firstTrack = tracks[0];
            const result = await spotify.playMusic(userId, { uri: firstTrack.uri });

            return {
              handled: true,
              result: `${mood ? `Based on your ${mood} mood, ` : ''}here's what I recommend:\n${tracks.slice(0, 5).map((t, i) => `${i + 1}. ${t.name} - ${t.artists[0]?.name}`).join('\n')}\n\n${result.success ? `Now playing: ${firstTrack.name}` : result.message}`,
              data: { tracks, playing: result.track },
            };
          }

          case 'create_playlist': {
            // Extract playlist name and tracks from message
            const playlistMatch = message.match(/(?:create|make)\s+(?:a\s+)?(?:new\s+)?playlist\s+(?:called\s+|named\s+)?["']?([^"']+?)["']?(?:\s+with\s+(.+))?$/i);
            const name = playlistMatch?.[1]?.trim();

            if (!name) {
              return {
                handled: true,
                result: "What should I name the playlist?",
                data: { needsName: true },
              };
            }

            // Parse tracks if provided
            let tracks: string[] | undefined;
            if (playlistMatch?.[2]) {
              tracks = playlistMatch[2].split(/,\s*(?:and\s+)?/).map(t => t.trim()).filter(Boolean);
            }

            const result = await spotify.createPlaylistWithTracks(userId, name, undefined, tracks);
            return {
              handled: true,
              result: result.success
                ? `${result.message}. ${result.playlistUrl ? `[Open in Spotify](${result.playlistUrl})` : ''}`
                : result.message,
              data: { success: result.success, playlistUrl: result.playlistUrl, tracksAdded: result.tracksAdded },
            };
          }

          default: {
            // General Spotify query - show status
            const state = await spotify.getPlaybackStatus(userId);
            return {
              handled: true,
              result: state ? spotify.formatSpotifyForPrompt(state) : "Nothing playing. What would you like to listen to?",
              data: { state },
            };
          }
        }
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
  detectCodingAgentShortcut,
  detectCodingAgentWithSettings,
  executeAbilityAction,
  executeFactCorrection,
  getAbilitySummary,
  isSmallTalk,
  isWeatherQuery,
  isStatusQuery,
  isProjectCreationIntent,
  getContextOptions,
};
