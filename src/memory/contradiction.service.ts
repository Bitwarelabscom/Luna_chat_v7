/**
 * Contradiction Service
 *
 * Detects and tracks when users state something that contradicts a stored fact.
 * Signals are surfaced to Luna as volatile context so she can gently flag them.
 *
 * Signals are user-scoped (not session-scoped) so contradictions from one session
 * can surface in another. Per-session tracking prevents repeating the same signal.
 */

import { pool } from '../db/index.js';
import { getConceptTokens, getSemantics } from './fact-semantics.js';
import logger from '../utils/logger.js';

export interface ContradictionSignal {
  id: string;
  userId: string;
  sessionId: string | null;
  factKey: string;
  userStated: string;
  storedValue: string;
  signalType: string;
  surfaced: boolean;
  createdAt: Date;
}

/**
 * Create a contradiction signal when a fact supersession occurs
 * on a well-established fact.
 */
export async function createSignal(
  userId: string,
  sessionId: string | undefined,
  factKey: string,
  userStated: string,
  storedValue: string,
  signalType: 'correction' | 'misremember' = 'misremember',
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO contradiction_signals
        (user_id, session_id, fact_key, user_stated, stored_value, signal_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, sessionId || null, factKey, userStated.slice(0, 500), storedValue.slice(0, 500), signalType]
    );

    logger.debug('Created contradiction signal', { userId, factKey, signalType });
  } catch (error) {
    logger.debug('Failed to create contradiction signal', { error: (error as Error).message });
  }
}

/**
 * Get unsurfaced contradiction signals for a user that haven't been shown
 * in the current session yet. User-scoped retrieval with per-session filtering.
 */
export async function getUnsurfaced(userId: string, sessionId: string): Promise<ContradictionSignal[]> {
  try {
    // Deduplicate per fact_key - only return the most recent signal for each field
    const result = await pool.query(
      `SELECT DISTINCT ON (fact_key)
         id, user_id, session_id, fact_key, user_stated, stored_value, signal_type, surfaced, created_at
       FROM contradiction_signals
       WHERE user_id = $1
         AND surfaced = FALSE
         AND NOT (surfaced_session_ids @> ARRAY[$2]::uuid[])
       ORDER BY fact_key, created_at DESC
       LIMIT 3`,
      [userId, sessionId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string,
      sessionId: row.session_id as string | null,
      factKey: row.fact_key as string,
      userStated: row.user_stated as string,
      storedValue: row.stored_value as string,
      signalType: row.signal_type as string,
      surfaced: row.surfaced as boolean,
      createdAt: row.created_at as Date,
    }));
  } catch (error) {
    logger.debug('Failed to get unsurfaced contradictions', { error: (error as Error).message });
    return [];
  }
}

/**
 * Mark contradiction signals as surfaced in a specific session.
 * Appends the sessionId to surfaced_session_ids.
 * Marks globally surfaced after being shown in 3+ sessions.
 */
export async function markSurfaced(signalIds: string[], sessionId: string): Promise<void> {
  if (signalIds.length === 0) return;

  try {
    await pool.query(
      `UPDATE contradiction_signals
       SET surfaced_session_ids = array_append(surfaced_session_ids, $2::uuid),
           surfaced = CASE WHEN array_length(surfaced_session_ids, 1) >= 2 THEN TRUE ELSE surfaced END
       WHERE id = ANY($1)
         AND NOT (surfaced_session_ids @> ARRAY[$2]::uuid[])`,
      [signalIds, sessionId]
    );
  } catch (error) {
    logger.debug('Failed to mark contradictions as surfaced', { error: (error as Error).message });
  }
}

/**
 * Format contradiction signals for volatile system prompt context.
 * Guides Luna to gently flag misremembered facts.
 */
export function formatForContext(signals: ContradictionSignal[]): string {
  if (signals.length === 0) return '';

  const lines = signals.map(s =>
    `- You remember "${s.factKey}" as "${s.storedValue}", but they just said "${s.userStated}". ` +
    `If it comes up naturally, gently mention what you recall - not as a correction, but as genuine memory. ` +
    `Example: "Wait, I thought that was ${s.storedValue} - did it change?"`
  );

  return `[Gentle Memory Check]\n${lines.join('\n')}`;
}

// ============================================
// Inline Contradiction Detection (real-time)
// ============================================

export interface InlineContradiction {
  factKey: string;
  factCategory: string;
  storedValue: string;
  suspectedValue: string;
}

// Common words that start with uppercase but aren't entity names
const INLINE_STOPWORDS = new Set([
  'I', 'My', 'The', 'This', 'That', 'These', 'Those', 'Here', 'There',
  'What', 'When', 'Where', 'Who', 'How', 'Why', 'Which',
  'And', 'But', 'Or', 'So', 'Yet', 'Not', 'No', 'Yes',
  'Can', 'Could', 'Would', 'Should', 'Will', 'Did', 'Does', 'Do',
  'Is', 'Are', 'Was', 'Were', 'Am', 'Been', 'Being',
  'Has', 'Have', 'Had', 'Just', 'Also', 'Very', 'Really',
  'Hey', 'Hi', 'Hello', 'Ok', 'Okay', 'Well', 'Yeah', 'Yep',
  'Maybe', 'Actually', 'Basically', 'Today', 'Now', 'Still',
  'Luna', 'Thanks', 'Please', 'Sure', 'Right', 'Like',
]);

const RELEVANT_CATEGORIES = new Set(['relationship', 'personal', 'context']);

/**
 * Detect contradictions in the current message against stored facts.
 * Pure synchronous, zero I/O, no LLM call.
 * Checks if the user mentions a concept token for a well-established fact
 * but uses a different value than what's stored.
 */
export function detectInlineContradictions(
  message: string,
  facts: Array<{ category: string; factKey: string; factValue: string; mentionCount: number }>
): InlineContradiction[] {
  const contradictions: InlineContradiction[] = [];
  const messageLower = message.toLowerCase();
  const messageWords = messageLower.split(/\s+/);

  // Extract capitalized words from original message as candidate contradicting values
  const capitalizedWords = message
    .split(/\s+/)
    .map(w => w.replace(/[.,!?;:'"()]/g, ''))
    .filter(w => /^[A-Z][a-z]/.test(w) && !INLINE_STOPWORDS.has(w) && w.length >= 2);

  if (capitalizedWords.length === 0) return [];

  for (const fact of facts) {
    if (!RELEVANT_CATEGORIES.has(fact.category)) continue;

    // Name-type facts (pet_name, catName, etc.) are worth checking even at mentionCount 1.
    // Other facts need mentionCount >= 2 to avoid false positives on weak extractions.
    const hasSemantic = !!getSemantics(fact.factKey);
    if (!hasSemantic && fact.mentionCount < 2) continue;

    const conceptTokens = getConceptTokens(fact.factKey);

    // Check if any concept token appears in the message
    const conceptMatch = conceptTokens.some(token => messageWords.includes(token.toLowerCase()));
    if (!conceptMatch) continue;

    // Check that stored value does NOT appear in message (if it does, no contradiction)
    if (messageLower.includes(fact.factValue.toLowerCase())) continue;

    // Look for a contradicting capitalized word
    for (const candidate of capitalizedWords) {
      if (candidate.toLowerCase() === fact.factValue.toLowerCase()) continue;

      contradictions.push({
        factKey: fact.factKey,
        factCategory: fact.category,
        storedValue: fact.factValue,
        suspectedValue: candidate,
      });
      break; // one contradiction per fact
    }
  }

  return contradictions;
}

/**
 * Format inline contradictions for the volatile prompt context.
 * Same tone as formatForContext - gentle memory check.
 */
export function formatInlineContradictions(contradictions: InlineContradiction[]): string {
  if (contradictions.length === 0) return '';

  const lines = contradictions.map(c =>
    `- You remember "${c.factKey}" as "${c.storedValue}", but they just said "${c.suspectedValue}". ` +
    `If it comes up naturally, gently mention what you recall - not as a correction, but as genuine memory. ` +
    `Example: "Wait, I thought that was ${c.storedValue} - did it change?"`
  );

  return `[Gentle Memory Check]\n${lines.join('\n')}`;
}

export default {
  createSignal, getUnsurfaced, markSurfaced, formatForContext,
  detectInlineContradictions, formatInlineContradictions,
};
