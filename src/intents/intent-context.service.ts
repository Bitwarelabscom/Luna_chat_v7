/**
 * Intent Context Service
 * Formats intents for prompt injection and context building
 */

import * as intentService from './intent.service.js';
import { IntentContext, IntentSummary, INTENT_DEFAULTS } from './intent.types.js';
import logger from '../utils/logger.js';

// ============================================
// Context Retrieval
// ============================================

/**
 * Get intent context for a user
 */
export async function getIntentContext(userId: string): Promise<IntentContext> {
  return await intentService.getIntentContext(userId);
}

/**
 * Get recovery intents for new session
 */
export async function getRecoveryIntents(userId: string): Promise<IntentSummary[]> {
  return await intentService.getRecoveryIntents(userId);
}

// ============================================
// Prompt Formatting
// ============================================

/**
 * Format a single intent for display
 */
function formatIntent(intent: IntentSummary, includeDetails: boolean = true): string {
  const priorityBadge = intent.priority === 'high' ? '[HIGH] ' : '';
  let result = `${priorityBadge}${intent.label}`;

  if (includeDetails) {
    const details: string[] = [];

    if (intent.goal && intent.goal !== intent.label) {
      details.push(`Goal: ${intent.goal}`);
    }

    if (intent.currentApproach) {
      details.push(`Current approach: ${intent.currentApproach}`);
    }

    if (intent.blockers && intent.blockers.length > 0) {
      details.push(`Blocker: ${intent.blockers.join(', ')}`);
    }

    if (details.length > 0) {
      result += '\n  - ' + details.join('\n  - ');
    }
  }

  return result;
}

/**
 * Format intents for prompt injection
 * Returns markdown-formatted string for system prompt
 */
export function formatIntentsForPrompt(context: IntentContext): string {
  const sections: string[] = [];

  // Active intents
  if (context.activeIntents.length > 0) {
    const activeLines = context.activeIntents
      .slice(0, INTENT_DEFAULTS.MAX_ACTIVE_INTENTS)
      .map((intent) => formatIntent(intent, true));

    sections.push('## Active Intents\n' + activeLines.map((l) => `**${l}**`).join('\n\n'));
  }

  // Suspended intents (brief list)
  if (context.suspendedIntents.length > 0) {
    const suspendedLines = context.suspendedIntents
      .slice(0, 3)
      .map((intent) => {
        const daysAgo = Math.floor(
          (Date.now() - new Date(intent.lastTouchedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        return `- ${intent.label} (paused ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago)`;
      });

    sections.push('## Suspended Intents\n' + suspendedLines.join('\n'));
  }

  // Recently resolved (very brief)
  if (context.recentlyResolved.length > 0) {
    const resolvedLines = context.recentlyResolved
      .slice(0, 2)
      .map((intent) => `- ${intent.label} (completed)`);

    if (resolvedLines.length > 0) {
      sections.push('## Recently Completed\n' + resolvedLines.join('\n'));
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : '';
}

/**
 * Format intents for recovery prompt (new session)
 * More concise than full context
 */
export function formatRecoveryPrompt(intents: IntentSummary[]): string {
  if (intents.length === 0) return '';

  const lines = intents.map((intent) => {
    const priorityBadge = intent.priority === 'high' ? '[HIGH] ' : '';
    let line = `- ${priorityBadge}${intent.label}`;

    if (intent.blockers && intent.blockers.length > 0) {
      line += ` (blocked: ${intent.blockers[0]})`;
    } else if (intent.currentApproach) {
      line += ` (trying: ${intent.currentApproach})`;
    }

    return line;
  });

  return '## Continuing Intents\nUser was working on:\n' + lines.join('\n');
}

/**
 * Get stable context (for prompt caching)
 * Returns context that changes infrequently
 */
export function getStableContext(context: IntentContext): string {
  // Only include high-priority intents that are unlikely to change mid-conversation
  const stableIntents = context.activeIntents.filter(
    (i) => i.priority === 'high' && i.touchCount > 2
  );

  if (stableIntents.length === 0) return '';

  const lines = stableIntents.map((intent) => `- [HIGH] ${intent.label}: ${intent.goal}`);

  return '## Long-term Intents\n' + lines.join('\n');
}

/**
 * Get volatile context (changes frequently)
 * This part should not be cached
 */
export function getVolatileContext(context: IntentContext): string {
  const sections: string[] = [];

  // Current working intents (may change each turn)
  const currentIntents = context.activeIntents.filter((i) => i.priority !== 'high' || i.touchCount <= 2);

  if (currentIntents.length > 0) {
    const lines = currentIntents.slice(0, 3).map((intent) => formatIntent(intent, true));
    sections.push('## Current Work\n' + lines.map((l) => `**${l}**`).join('\n\n'));
  }

  // Blockers section (important for context)
  const blockedIntents = context.activeIntents.filter((i) => i.blockers && i.blockers.length > 0);

  if (blockedIntents.length > 0) {
    const blockerLines = blockedIntents.flatMap((intent) =>
      intent.blockers.map((b) => `- ${intent.label}: ${b}`)
    );
    sections.push('## Current Blockers\n' + blockerLines.join('\n'));
  }

  return sections.join('\n\n');
}

// ============================================
// Intent Suggestions
// ============================================

/**
 * Generate intent-aware suggestions for Luna
 * Used to help Luna understand what user might need
 */
export function generateIntentSuggestions(context: IntentContext): string[] {
  const suggestions: string[] = [];

  // Check for blocked intents
  const blocked = context.activeIntents.filter((i) => i.blockers && i.blockers.length > 0);
  for (const intent of blocked.slice(0, 2)) {
    suggestions.push(`User is blocked on "${intent.label}" by: ${intent.blockers.join(', ')}`);
  }

  // Check for stale high-priority intents
  const staleHigh = context.activeIntents.filter((i) => {
    const hoursSinceTouch =
      (Date.now() - new Date(i.lastTouchedAt).getTime()) / (1000 * 60 * 60);
    return i.priority === 'high' && hoursSinceTouch > 24;
  });

  for (const intent of staleHigh.slice(0, 1)) {
    suggestions.push(
      `High-priority intent "${intent.label}" hasn't been touched in over 24 hours`
    );
  }

  // Check for too many active intents
  if (context.activeIntents.length >= INTENT_DEFAULTS.MAX_ACTIVE_INTENTS) {
    suggestions.push(
      'User has many active intents - consider helping them prioritize or complete some'
    );
  }

  return suggestions;
}

// ============================================
// Intent Analysis
// ============================================

/**
 * Analyze intent patterns for a user
 * Used for learning and consolidation
 */
export async function analyzeIntentPatterns(
  userId: string
): Promise<{
  totalActive: number;
  avgCompletionTime: number | null;
  commonTypes: Array<{ type: string; count: number }>;
  blockerPatterns: string[];
}> {
  try {
    const context = await intentService.getIntentContext(userId);

    // Calculate average completion time (if we have resolved intents)
    let avgCompletionTime: number | null = null;
    // Note: Would need to query DB for full history to calculate this accurately
    // Future: Use context.recentlyResolved for completion time analysis

    // Count types
    const typeCounts = new Map<string, number>();
    for (const intent of [...context.activeIntents, ...context.suspendedIntents]) {
      typeCounts.set(intent.type, (typeCounts.get(intent.type) || 0) + 1);
    }

    const commonTypes = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Find common blockers
    const blockerPatterns: string[] = [];
    const allBlockers = context.activeIntents.flatMap((i) => i.blockers || []);
    // Simple frequency analysis
    const blockerCounts = new Map<string, number>();
    for (const blocker of allBlockers) {
      const normalized = blocker.toLowerCase();
      blockerCounts.set(normalized, (blockerCounts.get(normalized) || 0) + 1);
    }
    for (const [blocker, count] of blockerCounts.entries()) {
      if (count > 1) {
        blockerPatterns.push(blocker);
      }
    }

    return {
      totalActive: context.activeIntents.length,
      avgCompletionTime,
      commonTypes,
      blockerPatterns,
    };
  } catch (error) {
    logger.warn('Failed to analyze intent patterns', {
      userId,
      error: (error as Error).message,
    });
    return {
      totalActive: 0,
      avgCompletionTime: null,
      commonTypes: [],
      blockerPatterns: [],
    };
  }
}

export default {
  getIntentContext,
  getRecoveryIntents,
  formatIntentsForPrompt,
  formatRecoveryPrompt,
  getStableContext,
  getVolatileContext,
  generateIntentSuggestions,
  analyzeIntentPatterns,
};
