/**
 * Context Trigger Service
 * Detects when Luna should auto-load context from previous sessions/intents
 */

import logger from '../utils/logger.js';

// ============================================
// Pattern Definitions
// ============================================

/**
 * Patterns that trigger context loading
 */
const CONTEXT_TRIGGER_PATTERNS: Array<{
  pattern: RegExp;
  type: 'continuation' | 'reference' | 'decision' | 'intent';
  extractQuery?: (match: RegExpMatchArray) => string | undefined;
}> = [
  // Continuation patterns - user wants to resume work
  {
    pattern: /\b(continue|pick up|resume)\b.*\b(where we left off|from before|what we were doing)\b/i,
    type: 'continuation',
  },
  {
    pattern: /\b(what were we|what was i|remind me what we were)\b.*\b(working on|doing|discussing)\b/i,
    type: 'continuation',
  },
  {
    pattern: /\b(let's get back to|back to|returning to)\b.*\b(what we were|our|the)\b/i,
    type: 'continuation',
  },
  {
    pattern: /\blast time we\b/i,
    type: 'continuation',
  },
  {
    pattern: /\b(earlier|before)\s+(we|you|i)\b.*\b(discussed|talked|worked)\b/i,
    type: 'continuation',
  },

  // Reference patterns - user references past work/discussions
  {
    pattern: /\bthat (thing|bug|issue|feature|project|task) we (discussed|worked on|talked about|fixed)\b/i,
    type: 'reference',
    extractQuery: (match) => match[1], // Extract "thing", "bug", etc.
  },
  {
    pattern: /\bthe (.+?) (we|you|i) (mentioned|discussed|talked about|worked on)\b/i,
    type: 'reference',
    extractQuery: (match) => match[1],
  },
  {
    pattern: /\bremember (when|that|the time) (we|you|i)\b/i,
    type: 'reference',
  },
  {
    pattern: /\byou (said|mentioned|told me|suggested)\b.*\b(about|that)\b/i,
    type: 'reference',
  },

  // Decision patterns - user asking about past decisions
  {
    pattern: /\bwhat did we (decide|agree|settle on|choose)\b.*\b(about|for|regarding)?\b\s*(.+)?/i,
    type: 'decision',
    extractQuery: (match) => match[3]?.trim(),
  },
  {
    pattern: /\b(our|the) decision (about|on|for|regarding)\b\s*(.+)?/i,
    type: 'decision',
    extractQuery: (match) => match[3]?.trim(),
  },
  {
    pattern: /\bwhat was (our|the) (approach|plan|strategy)\b.*\b(for|to|about)?\b\s*(.+)?/i,
    type: 'decision',
    extractQuery: (match) => match[4]?.trim(),
  },

  // Intent patterns - user references a specific goal/intent
  {
    pattern: /\bthe (.+?) (intent|goal|task|project)\b/i,
    type: 'intent',
    extractQuery: (match) => match[1],
  },
  {
    pattern: /\bworking on (.+?) (still|again|now)\b/i,
    type: 'intent',
    extractQuery: (match) => match[1],
  },
  {
    pattern: /\b(status|progress|update) (on|for|of) (.+)\b/i,
    type: 'intent',
    extractQuery: (match) => match[3],
  },
];

/**
 * Short patterns that are less confident but still suggest context loading
 */
const WEAK_TRIGGER_PATTERNS = [
  /\bwe were\b/i,
  /\byou helped me\b/i,
  /\bthat conversation\b/i,
  /\bour last session\b/i,
  /\bpreviously\b/i,
  /\bsame (thing|issue|problem|bug)\b/i,
];

// ============================================
// Detection Logic
// ============================================

export interface ContextTriggerResult {
  shouldLoad: boolean;
  confidence: 'high' | 'medium' | 'low';
  triggerType?: 'continuation' | 'reference' | 'decision' | 'intent';
  query?: string;
  intentMatch?: string;
}

/**
 * Check if a message should trigger auto context loading
 */
export function shouldAutoLoadContext(message: string): ContextTriggerResult {
  // Normalize message
  const normalized = message.trim();

  // Skip very short messages (likely not context requests)
  if (normalized.length < 10) {
    return { shouldLoad: false, confidence: 'low' };
  }

  // Check strong patterns first
  for (const { pattern, type, extractQuery } of CONTEXT_TRIGGER_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const query = extractQuery ? extractQuery(match) : undefined;

      logger.debug('Context trigger matched', {
        pattern: pattern.source,
        type,
        query,
        message: normalized.slice(0, 50),
      });

      return {
        shouldLoad: true,
        confidence: 'high',
        triggerType: type,
        query: query?.replace(/[^a-z0-9\s]/gi, '').trim() || undefined,
      };
    }
  }

  // Check weak patterns
  for (const pattern of WEAK_TRIGGER_PATTERNS) {
    if (pattern.test(normalized)) {
      logger.debug('Weak context trigger matched', {
        pattern: pattern.source,
        message: normalized.slice(0, 50),
      });

      return {
        shouldLoad: true,
        confidence: 'medium',
      };
    }
  }

  // Check for question marks combined with temporal references
  if (normalized.includes('?')) {
    const temporalKeywords = [
      'yesterday', 'last time', 'before', 'earlier', 'previously',
      'last week', 'other day', 'ago',
    ];

    if (temporalKeywords.some(k => normalized.toLowerCase().includes(k))) {
      return {
        shouldLoad: true,
        confidence: 'low',
      };
    }
  }

  return { shouldLoad: false, confidence: 'low' };
}

/**
 * Check if a message mentions a specific intent by label or keywords
 */
export function detectIntentMention(
  message: string,
  activeIntents: Array<{ id: string; label: string; goal: string }>
): string | null {
  const lower = message.toLowerCase();

  for (const intent of activeIntents) {
    // Check if label is mentioned
    const labelLower = intent.label.toLowerCase();
    if (lower.includes(labelLower)) {
      return intent.id;
    }

    // Check for significant keywords from label/goal
    const keywords = extractKeywords(intent.label + ' ' + intent.goal);
    const matchCount = keywords.filter(k => lower.includes(k)).length;

    // If multiple keywords match, it's likely this intent
    if (matchCount >= 2) {
      return intent.id;
    }
  }

  return null;
}

/**
 * Extract significant keywords from text
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with',
    'this', 'that', 'it', 'i', 'you', 'we', 'they', 'my', 'your',
    'want', 'need', 'should', 'would', 'could', 'will', 'can',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));
}

/**
 * Build a search query from detected trigger
 */
export function buildSearchQuery(result: ContextTriggerResult, message: string): string | undefined {
  // If we extracted a query from the pattern, use it
  if (result.query) {
    return result.query;
  }

  // Try to extract key nouns/topics from the message
  const keywords = extractKeywords(message);

  // Filter to most likely relevant keywords (longer ones, proper nouns, etc.)
  const relevantKeywords = keywords.filter(k =>
    k.length > 4 || // Longer words
    /^[A-Z]/.test(k) || // Starts with capital (proper noun)
    /error|bug|issue|feature|task|project|code|function|api|database|server|client/i.test(k) // Tech terms
  );

  if (relevantKeywords.length > 0) {
    return relevantKeywords.slice(0, 3).join(' ');
  }

  return undefined;
}

// ============================================
// Breadcrumb Generation
// ============================================

/**
 * Format context breadcrumbs for system prompt
 * These are injected at session start to give Luna awareness of recent context
 */
export function formatContextBreadcrumbs(
  recentSessions: Array<{ sessionId: string; title: string; topics: string[] }>,
  activeIntents: Array<{ intentId: string; label: string; status: string }>
): string {
  if (recentSessions.length === 0 && activeIntents.length === 0) {
    return '';
  }

  const parts: string[] = ['[Context Breadcrumbs]'];

  // Add active intents first (most important)
  if (activeIntents.length > 0) {
    parts.push('Active goals:');
    for (const intent of activeIntents.slice(0, 3)) {
      parts.push(`- [${intent.intentId.slice(0, 8)}] ${intent.label}`);
    }
  }

  // Add recent sessions
  if (recentSessions.length > 0) {
    parts.push('Recent sessions:');
    for (const session of recentSessions.slice(0, 3)) {
      const topicsStr = session.topics.length > 0
        ? ` (${session.topics.slice(0, 2).join(', ')})`
        : '';
      parts.push(`- [${session.sessionId.slice(0, 8)}] ${session.title}${topicsStr}`);
    }
  }

  parts.push('Use load_context tool to fetch details when needed.');
  parts.push('[End Breadcrumbs]');

  return parts.join('\n');
}

export default {
  shouldAutoLoadContext,
  detectIntentMention,
  buildSearchQuery,
  formatContextBreadcrumbs,
};
