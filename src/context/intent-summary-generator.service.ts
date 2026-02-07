/**
 * Intent Summary Generator Service
 * Generates rich context summaries for intents
 * Called when intents change status or during batch refresh
 */

import { createCompletion } from '../llm/router.js';
import { config } from '../config/index.js';
import { pool } from '../db/index.js';
import * as contextSummaryService from './context-summary.service.js';
import type {
  IntentContextSummary,
  RelatedSessionRef,
  SessionSummary,
} from './context-summary.types.js';
import type { Intent } from '../intents/intent.types.js';
import logger from '../utils/logger.js';

// ============================================
// Intent Summary Generation
// ============================================

const INTENT_SUMMARY_PROMPT = `Analyze this intent and its history to create a context summary.

Intent:
- Type: {type}
- Label: {label}
- Goal: {goal}
- Status: {status}
- Priority: {priority}
- Created: {createdAt}
- Last touched: {lastTouchedAt}
- Touch count: {touchCount}
- Tried approaches: {triedApproaches}
- Current approach: {currentApproach}
- Blockers: {blockers}
- Emotional context: {emotionalContext}

Related session summaries:
{sessionSummaries}

Generate a context summary that would help resume work on this intent. Include:
1. contextSummary: A 2-3 sentence summary of what this intent is about and its current state
2. decisions: Array of key decisions made (inferred from approaches and sessions)
3. approachesTried: Array of approaches that were attempted (from intent + sessions)
4. currentApproach: The current strategy being used (null if none)
5. blockers: Current blockers preventing progress

Respond in JSON format:
{
  "contextSummary": "...",
  "decisions": ["..."],
  "approachesTried": ["..."],
  "currentApproach": "...",
  "blockers": ["..."]
}
`;

/**
 * Generate a context summary for an intent
 */
export async function generateIntentSummary(
  intent: Intent,
  recentSessions: SessionSummary[] = []
): Promise<IntentContextSummary | null> {
  try {
    // Format session summaries for prompt
    const sessionSummariesText = recentSessions.length > 0
      ? recentSessions
          .slice(0, 5)
          .map(s => `- ${s.title}: ${s.oneLiner}`)
          .join('\n')
      : 'No related sessions found.';

    // Build the prompt
    const prompt = INTENT_SUMMARY_PROMPT
      .replace('{type}', intent.type)
      .replace('{label}', intent.label)
      .replace('{goal}', intent.goal)
      .replace('{status}', intent.status)
      .replace('{priority}', intent.priority)
      .replace('{createdAt}', intent.createdAt.toISOString())
      .replace('{lastTouchedAt}', intent.lastTouchedAt.toISOString())
      .replace('{touchCount}', String(intent.touchCount))
      .replace('{triedApproaches}', intent.triedApproaches.join(', ') || 'None')
      .replace('{currentApproach}', intent.currentApproach || 'None')
      .replace('{blockers}', intent.blockers.join(', ') || 'None')
      .replace('{emotionalContext}', intent.emotionalContext || 'Not recorded')
      .replace('{sessionSummaries}', sessionSummariesText);

    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 600 }
    );

    const content = response.content || '';

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Failed to parse intent summary response', { intentId: intent.id });
      // Create basic summary from intent data
      return createBasicIntentSummary(intent, recentSessions);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Build related session refs
    const relatedSessions: RelatedSessionRef[] = recentSessions.slice(0, 5).map(s => ({
      sessionId: s.sessionId,
      title: s.title,
      summary: s.oneLiner,
      touchedAt: s.endedAt,
    }));

    // Build the full summary
    const summary: IntentContextSummary = {
      intentId: intent.id,
      userId: intent.userId,
      type: intent.type,
      label: intent.label,
      goal: intent.goal,
      status: intent.status,
      priority: intent.priority,
      contextSummary: parsed.contextSummary || intent.goal,
      decisions: parsed.decisions || [],
      approachesTried: [
        ...intent.triedApproaches,
        ...(parsed.approachesTried || []).filter(
          (a: string) => !intent.triedApproaches.includes(a)
        ),
      ],
      currentApproach: parsed.currentApproach || intent.currentApproach,
      blockers: [
        ...intent.blockers,
        ...(parsed.blockers || []).filter(
          (b: string) => !intent.blockers.includes(b)
        ),
      ],
      relatedSessions,
      createdAt: intent.createdAt,
      lastTouchedAt: intent.lastTouchedAt,
      touchCount: intent.touchCount,
      generatedAt: new Date(),
    };

    // Store in Redis
    await contextSummaryService.storeIntentSummary(summary);

    logger.info('Generated intent summary', {
      intentId: intent.id,
      label: intent.label,
      status: intent.status,
    });

    return summary;
  } catch (error) {
    logger.error('Failed to generate intent summary', {
      error: (error as Error).message,
      intentId: intent.id,
    });

    // Try to create basic summary as fallback
    return createBasicIntentSummary(intent, recentSessions);
  }
}

/**
 * Create a basic intent summary without LLM
 */
function createBasicIntentSummary(
  intent: Intent,
  recentSessions: SessionSummary[]
): IntentContextSummary {
  const relatedSessions: RelatedSessionRef[] = recentSessions.slice(0, 5).map(s => ({
    sessionId: s.sessionId,
    title: s.title,
    summary: s.oneLiner,
    touchedAt: s.endedAt,
  }));

  return {
    intentId: intent.id,
    userId: intent.userId,
    type: intent.type,
    label: intent.label,
    goal: intent.goal,
    status: intent.status,
    priority: intent.priority,
    contextSummary: intent.goal,
    decisions: [],
    approachesTried: intent.triedApproaches,
    currentApproach: intent.currentApproach,
    blockers: intent.blockers,
    relatedSessions,
    createdAt: intent.createdAt,
    lastTouchedAt: intent.lastTouchedAt,
    touchCount: intent.touchCount,
    generatedAt: new Date(),
  };
}

// ============================================
// Session End Hook
// ============================================

/**
 * Update intent summaries when a session ends
 * Called by session finalization
 */
export async function updateIntentsOnSessionEnd(
  userId: string,
  sessionSummary: SessionSummary
): Promise<void> {
  try {
    // Get intents that were active during this session
    const intentIds = [
      ...sessionSummary.intentsActive,
      ...sessionSummary.intentsResolved,
    ];

    if (intentIds.length === 0) {
      // Try to find intents touched in this session from intent_touches table
      const touches = await pool.query(
        `SELECT DISTINCT intent_id FROM intent_touches
         WHERE session_id = $1`,
        [sessionSummary.sessionId]
      );
      for (const row of touches.rows) {
        intentIds.push(row.intent_id);
      }
    }

    if (intentIds.length === 0) {
      return;
    }

    // Get full intent records
    const intentsResult = await pool.query(
      `SELECT * FROM user_intents
       WHERE id = ANY($1) AND user_id = $2`,
      [intentIds, userId]
    );

    for (const row of intentsResult.rows) {
      const intent = mapRowToIntent(row);

      // Get existing intent summary if any
      const existingSummary = await contextSummaryService.getIntentSummary(
        userId,
        intent.id
      );

      // Merge session into related sessions
      const relatedSessions: RelatedSessionRef[] = existingSummary
        ? [...existingSummary.relatedSessions]
        : [];

      // Add current session if not already present
      const sessionRef: RelatedSessionRef = {
        sessionId: sessionSummary.sessionId,
        title: sessionSummary.title,
        summary: sessionSummary.oneLiner,
        touchedAt: sessionSummary.endedAt,
      };

      const existingIdx = relatedSessions.findIndex(
        s => s.sessionId === sessionSummary.sessionId
      );

      if (existingIdx >= 0) {
        relatedSessions[existingIdx] = sessionRef;
      } else {
        relatedSessions.unshift(sessionRef);
      }

      // Keep only last 10 related sessions
      const trimmedSessions = relatedSessions.slice(0, 10);

      // Build updated summary
      const updatedSummary: IntentContextSummary = existingSummary
        ? {
            ...existingSummary,
            status: intent.status,
            currentApproach: intent.currentApproach,
            blockers: intent.blockers,
            approachesTried: intent.triedApproaches,
            relatedSessions: trimmedSessions,
            lastTouchedAt: intent.lastTouchedAt,
            touchCount: intent.touchCount,
            generatedAt: new Date(),
          }
        : createBasicIntentSummary(intent, []);

      // Store updated summary
      await contextSummaryService.storeIntentSummary(updatedSummary);
    }

    logger.debug('Updated intent summaries on session end', {
      sessionId: sessionSummary.sessionId,
      intentCount: intentIds.length,
    });
  } catch (error) {
    logger.error('Failed to update intents on session end', {
      error: (error as Error).message,
      sessionId: sessionSummary.sessionId,
    });
  }
}

// ============================================
// Batch Operations (for jobs)
// ============================================

/**
 * Refresh all active intent summaries for a user
 * Called by daily maintenance job
 */
export async function refreshUserIntentSummaries(userId: string): Promise<number> {
  try {
    // Get all active/suspended intents
    const intentsResult = await pool.query(
      `SELECT * FROM user_intents
       WHERE user_id = $1 AND status IN ('active', 'suspended')
       ORDER BY last_touched_at DESC
       LIMIT 20`,
      [userId]
    );

    let refreshed = 0;

    for (const row of intentsResult.rows) {
      const intent = mapRowToIntent(row);

      // Get related session summaries
      const recentSessions = await getRelatedSessionSummaries(userId, intent.id);

      // Generate fresh summary
      await generateIntentSummary(intent, recentSessions);
      refreshed++;
    }

    return refreshed;
  } catch (error) {
    logger.error('Failed to refresh user intent summaries', {
      error: (error as Error).message,
      userId,
    });
    return 0;
  }
}

/**
 * Get session summaries related to an intent
 */
async function getRelatedSessionSummaries(
  userId: string,
  intentId: string
): Promise<SessionSummary[]> {
  try {
    // Get session IDs from intent_touches - use GROUP BY to avoid DISTINCT/ORDER BY conflict
    const touchesResult = await pool.query(
      `SELECT session_id, MAX(created_at) as last_touch 
       FROM intent_touches
       WHERE intent_id = $1 AND session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY last_touch DESC
       LIMIT 5`,
      [intentId]
    );

    const summaries: SessionSummary[] = [];

    for (const row of touchesResult.rows) {
      const summary = await contextSummaryService.getSessionSummary(
        userId,
        row.session_id
      );
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries;
  } catch (error) {
    logger.warn('Failed to get related session summaries', {
      error: (error as Error).message,
      intentId,
    });
    return [];
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Map database row to Intent object
 */
function mapRowToIntent(row: Record<string, unknown>): Intent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Intent['type'],
    label: row.label as string,
    status: row.status as Intent['status'],
    priority: row.priority as Intent['priority'],
    createdAt: new Date(row.created_at as string),
    lastTouchedAt: new Date(row.last_touched_at as string),
    touchCount: row.touch_count as number,
    goal: row.goal as string,
    constraints: (row.constraints as string[]) || [],
    triedApproaches: (row.tried_approaches as string[]) || [],
    currentApproach: row.current_approach as string | null,
    blockers: (row.blockers as string[]) || [],
    emotionalContext: row.emotional_context as string | null,
    parentIntentId: row.parent_intent_id as string | null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    resolutionType: row.resolution_type as Intent['resolutionType'],
    sourceSessionId: row.source_session_id as string | null,
    updatedAt: new Date(row.updated_at as string),
  };
}

export default {
  generateIntentSummary,
  updateIntentsOnSessionEnd,
  refreshUserIntentSummaries,
};
