/**
 * Load Context Handler
 * Handles execution of load_context and correct_summary tools
 */

import * as contextSummaryService from './context-summary.service.js';
import type {
  LoadContextParams,
  LoadContextResult,
  CorrectSummaryParams,
  CorrectSummaryResult,
  SessionSummaryBrief,
  IntentContextBrief,
  SessionSummary,
  IntentContextSummary,
} from './context-summary.types.js';
import logger from '../utils/logger.js';

// ============================================
// Load Context Handler
// ============================================

/**
 * Handle load_context tool execution
 */
export async function handleLoadContext(
  userId: string,
  params: LoadContextParams
): Promise<LoadContextResult> {
  try {
    const { intent_id, session_id, query, depth = 'summary' } = params;

    // If specific intent_id provided, fetch that intent
    if (intent_id) {
      const intent = await contextSummaryService.getIntentSummary(userId, intent_id);
      if (!intent) {
        return {
          success: false,
          error: `Intent ${intent_id} not found`,
        };
      }

      return {
        success: true,
        intents: [formatIntentByDepth(intent, depth)],
      };
    }

    // If specific session_id provided, fetch that session
    if (session_id) {
      const session = await contextSummaryService.getSessionSummary(userId, session_id);
      if (!session) {
        return {
          success: false,
          error: `Session ${session_id} not found`,
        };
      }

      return {
        success: true,
        sessions: [formatSessionByDepth(session, depth)],
      };
    }

    // If query provided, search for relevant context
    if (query) {
      const searchResults = await contextSummaryService.searchContext(userId, query);

      if (searchResults.length === 0) {
        return {
          success: true,
          searchResults: [],
          error: 'No matching context found for query',
        };
      }

      // If detailed depth requested, also fetch full summaries
      if (depth === 'detailed') {
        const sessions: SessionSummaryBrief[] = [];
        const intents: IntentContextBrief[] = [];

        for (const result of searchResults.slice(0, 5)) {
          if (result.type === 'session') {
            const session = await contextSummaryService.getSessionSummary(userId, result.id);
            if (session) {
              sessions.push(formatSessionByDepth(session, depth));
            }
          } else {
            const intent = await contextSummaryService.getIntentSummary(userId, result.id);
            if (intent) {
              intents.push(formatIntentByDepth(intent, depth));
            }
          }
        }

        return {
          success: true,
          sessions: sessions.length > 0 ? sessions : undefined,
          intents: intents.length > 0 ? intents : undefined,
          searchResults,
        };
      }

      return {
        success: true,
        searchResults,
      };
    }

    // No specific query - return recent sessions + active intents
    const [recentSessions, activeIntents] = await Promise.all([
      contextSummaryService.getRecentSessions(userId, 5),
      contextSummaryService.getActiveIntents(userId, 5),
    ]);

    return {
      success: true,
      sessions: recentSessions,
      intents: activeIntents,
    };
  } catch (error) {
    logger.error('Failed to handle load_context', {
      error: (error as Error).message,
      userId,
      params,
    });

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Format session summary based on depth
 */
function formatSessionByDepth(
  session: SessionSummary,
  depth: 'brief' | 'summary' | 'detailed'
): SessionSummaryBrief {
  const brief: SessionSummaryBrief = {
    sessionId: session.sessionId,
    title: session.title,
    oneLiner: session.oneLiner,
    topics: session.topics,
    startedAt: session.startedAt,
  };

  if (depth === 'brief') {
    return brief;
  }

  // For summary and detailed, include more fields
  // TypeScript will only allow SessionSummaryBrief fields, so we extend with type assertion
  const extended = brief as SessionSummaryBrief & {
    summary?: string;
    decisions?: string[];
    actionItems?: string[];
    moodArc?: string;
  };

  if (depth === 'summary' || depth === 'detailed') {
    extended.summary = session.summary;
    extended.decisions = session.decisions;
    extended.actionItems = session.actionItems;
  }

  if (depth === 'detailed') {
    extended.moodArc = session.moodArc;
  }

  return extended;
}

/**
 * Format intent summary based on depth
 */
function formatIntentByDepth(
  intent: IntentContextSummary,
  depth: 'brief' | 'summary' | 'detailed'
): IntentContextBrief {
  const brief: IntentContextBrief = {
    intentId: intent.intentId,
    label: intent.label,
    goal: intent.goal,
    status: intent.status,
    currentApproach: intent.currentApproach,
    blockers: intent.blockers,
  };

  if (depth === 'brief') {
    return brief;
  }

  // For summary and detailed, include more fields
  const extended = brief as IntentContextBrief & {
    contextSummary?: string;
    decisions?: string[];
    approachesTried?: string[];
  };

  if (depth === 'summary' || depth === 'detailed') {
    extended.contextSummary = intent.contextSummary;
    extended.decisions = intent.decisions;
  }

  if (depth === 'detailed') {
    extended.approachesTried = intent.approachesTried;
  }

  return extended;
}

// ============================================
// Correct Summary Handler
// ============================================

/**
 * Handle correct_summary tool execution
 */
export async function handleCorrectSummary(
  userId: string,
  params: CorrectSummaryParams
): Promise<CorrectSummaryResult> {
  try {
    const { type, id, field, correction } = params;

    // Validate params
    if (!type || !id || !field || !correction) {
      return {
        success: false,
        message: 'Missing required parameters: type, id, field, and correction are required',
      };
    }

    // Apply the correction
    const result = await contextSummaryService.applySummaryCorrection(
      userId,
      type,
      id,
      field,
      correction
    );

    if (!result.success) {
      return {
        success: false,
        message: `Could not find ${type} with ID ${id} to correct`,
      };
    }

    return {
      success: true,
      message: `Corrected ${field} for ${type} ${id}`,
      previousValue: result.previousValue,
      newValue: correction,
    };
  } catch (error) {
    logger.error('Failed to handle correct_summary', {
      error: (error as Error).message,
      userId,
      params,
    });

    return {
      success: false,
      message: (error as Error).message,
    };
  }
}

// ============================================
// Formatting for LLM Response
// ============================================

/**
 * Format load_context result for injection into LLM context
 */
export function formatLoadContextResult(result: LoadContextResult): string {
  if (!result.success) {
    return `[Context Loading Error: ${result.error}]`;
  }

  const parts: string[] = [];

  // Format search results
  if (result.searchResults && result.searchResults.length > 0) {
    parts.push('**Search Results:**');
    for (const sr of result.searchResults) {
      const typeEmoji = sr.type === 'session' ? '📝' : '🎯';
      parts.push(`- ${typeEmoji} ${sr.title} (${sr.type}): ${sr.snippet}`);
    }
  }

  // Format active intents
  if (result.intents && result.intents.length > 0) {
    parts.push('\n**Active Intents:**');
    for (const intent of result.intents) {
      const statusEmoji = intent.status === 'active' ? '🟢' : '🟡';
      parts.push(`- ${statusEmoji} [${intent.intentId.slice(0, 8)}] **${intent.label}**`);
      parts.push(`  Goal: ${intent.goal}`);
      if (intent.currentApproach) {
        parts.push(`  Current approach: ${intent.currentApproach}`);
      }
      if (intent.blockers.length > 0) {
        parts.push(`  Blockers: ${intent.blockers.join(', ')}`);
      }
    }
  }

  // Format recent sessions
  if (result.sessions && result.sessions.length > 0) {
    parts.push('\n**Recent Sessions:**');
    for (const session of result.sessions) {
      const date = new Date(session.startedAt);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      parts.push(`- [${session.sessionId.slice(0, 8)}] **${session.title}** (${dateStr})`);
      parts.push(`  ${session.oneLiner}`);
      if (session.topics.length > 0) {
        parts.push(`  Topics: ${session.topics.join(', ')}`);
      }
    }
  }

  if (parts.length === 0) {
    return '[No relevant context found]';
  }

  return parts.join('\n');
}

/**
 * Format correct_summary result for LLM response
 */
export function formatCorrectSummaryResult(result: CorrectSummaryResult): string {
  if (!result.success) {
    return `Could not apply correction: ${result.message}`;
  }

  if (result.previousValue) {
    return `Correction applied. Changed from "${result.previousValue}" to "${result.newValue}".`;
  }

  return `Correction applied: ${result.message}`;
}

export default {
  handleLoadContext,
  handleCorrectSummary,
  formatLoadContextResult,
  formatCorrectSummaryResult,
};
