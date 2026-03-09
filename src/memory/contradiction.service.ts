/**
 * Contradiction Service
 *
 * Detects and tracks when users state something that contradicts a stored fact.
 * Signals are surfaced to Luna as volatile context so she can gently flag them.
 */

import { pool } from '../db/index.js';
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
 * Get unsurfaced contradiction signals for a session.
 */
export async function getUnsurfaced(sessionId: string): Promise<ContradictionSignal[]> {
  try {
    const result = await pool.query(
      `SELECT id, user_id, session_id, fact_key, user_stated, stored_value, signal_type, surfaced, created_at
       FROM contradiction_signals
       WHERE session_id = $1 AND surfaced = FALSE
       ORDER BY created_at DESC
       LIMIT 3`,
      [sessionId]
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
 * Mark contradiction signals as surfaced after they've been included in context.
 */
export async function markSurfaced(signalIds: string[]): Promise<void> {
  if (signalIds.length === 0) return;

  try {
    await pool.query(
      `UPDATE contradiction_signals SET surfaced = TRUE WHERE id = ANY($1)`,
      [signalIds]
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

export default { createSignal, getUnsurfaced, markSurfaced, formatForContext };
