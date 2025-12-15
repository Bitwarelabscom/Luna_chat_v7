/**
 * Hint Injection Service
 *
 * Retrieves and injects personality tuning hints into generator prompts
 * based on recent critique failures.
 */

import { pool } from '../../db/index.js';
import logger from '../../utils/logger.js';

// ============================================
// Types
// ============================================

export interface SessionHint {
  type: string;
  text: string;
  weight: number;
}

export interface UserHint {
  type: string;
  text: string;
  weight: number;
  occurrences: number;
}

export interface ActiveHints {
  sessionHints: SessionHint[];
  userHints: UserHint[];
}

// ============================================
// Hint Retrieval
// ============================================

/**
 * Get active hints for a session/user combination
 */
export async function getActiveHints(sessionId: string, userId: string): Promise<ActiveHints> {
  try {
    // Get session hints (all of them, most recent first)
    const sessionResult = await pool.query<{
      hint_type: string;
      hint_text: string;
      weight: number;
    }>(
      `SELECT hint_type, hint_text, weight
       FROM session_critique_hints
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [sessionId]
    );

    // Get user hints (weighted, exclude low-weight)
    const userResult = await pool.query<{
      hint_type: string;
      hint_text: string;
      weight: number;
      occurrence_count: number;
    }>(
      `SELECT hint_type, hint_text, weight, occurrence_count
       FROM user_critique_hints
       WHERE user_id = $1 AND weight >= 0.3
       ORDER BY weight DESC, occurrence_count DESC
       LIMIT 5`,
      [userId]
    );

    return {
      sessionHints: sessionResult.rows.map((r) => ({
        type: r.hint_type,
        text: r.hint_text,
        weight: r.weight,
      })),
      userHints: userResult.rows.map((r) => ({
        type: r.hint_type,
        text: r.hint_text,
        weight: r.weight,
        occurrences: r.occurrence_count,
      })),
    };
  } catch (error) {
    logger.error('Failed to get active hints', {
      sessionId,
      userId,
      error: (error as Error).message,
    });
    return { sessionHints: [], userHints: [] };
  }
}

// ============================================
// Prompt Formatting
// ============================================

/**
 * Format hints for prompt injection
 */
export function formatHintsForPrompt(hints: ActiveHints): string | null {
  const allHints: string[] = [];

  // Combine and dedupe hints by type
  const seenTypes = new Set<string>();

  // Session hints take priority (more recent/specific)
  for (const hint of hints.sessionHints) {
    if (!seenTypes.has(hint.type)) {
      seenTypes.add(hint.type);
      allHints.push(`- ${hint.text}`);
    }
  }

  // Add user hints that weren't already covered
  for (const hint of hints.userHints) {
    if (!seenTypes.has(hint.type)) {
      seenTypes.add(hint.type);
      // Weight-based prefix for strong patterns
      const prefix = hint.weight >= 1.5 ? 'IMPORTANT: ' : '';
      allHints.push(`- ${prefix}${hint.text}`);
    }
  }

  if (allHints.length === 0) {
    return null;
  }

  return `[Personality Tuning - Based on Recent Feedback]
${allHints.join('\n')}`;
}

/**
 * Get formatted hints ready for injection
 */
export async function getFormattedHints(
  sessionId: string,
  userId: string
): Promise<string | null> {
  const hints = await getActiveHints(sessionId, userId);
  return formatHintsForPrompt(hints);
}

// ============================================
// Hint Management
// ============================================

/**
 * Clear session hints (called when session ends or resets)
 */
export async function clearSessionHints(sessionId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM session_critique_hints WHERE session_id = $1`, [sessionId]);
    logger.debug('Cleared session hints', { sessionId });
  } catch (error) {
    logger.error('Failed to clear session hints', {
      sessionId,
      error: (error as Error).message,
    });
  }
}

/**
 * Add a session hint manually (for testing or direct injection)
 */
export async function addSessionHint(
  sessionId: string,
  hintType: string,
  hintText: string,
  weight: number = 1.0
): Promise<void> {
  await pool.query(
    `INSERT INTO session_critique_hints (session_id, hint_type, hint_text, weight)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, hintType, hintText, weight]
  );
}

/**
 * Add a user hint manually
 */
export async function addUserHint(
  userId: string,
  hintType: string,
  hintText: string,
  weight: number = 1.0
): Promise<void> {
  await pool.query(
    `INSERT INTO user_critique_hints (user_id, hint_type, hint_text, occurrence_count, last_seen, weight)
     VALUES ($1, $2, $3, 1, NOW(), $4)
     ON CONFLICT (user_id, hint_type) DO UPDATE SET
       occurrence_count = user_critique_hints.occurrence_count + 1,
       last_seen = NOW(),
       weight = LEAST(2.0, user_critique_hints.weight + 0.2)`,
    [userId, hintType, hintText, weight]
  );
}

/**
 * Get hint statistics for a user
 */
export async function getUserHintStats(userId: string): Promise<{
  totalHints: number;
  avgWeight: number;
  topHints: Array<{ type: string; occurrences: number; weight: number }>;
}> {
  const result = await pool.query<{
    hint_type: string;
    occurrence_count: number;
    weight: number;
  }>(
    `SELECT hint_type, occurrence_count, weight
     FROM user_critique_hints
     WHERE user_id = $1
     ORDER BY occurrence_count DESC
     LIMIT 10`,
    [userId]
  );

  const hints = result.rows;
  const totalHints = hints.length;
  const avgWeight =
    totalHints > 0 ? hints.reduce((sum, h) => sum + h.weight, 0) / totalHints : 0;

  return {
    totalHints,
    avgWeight: Math.round(avgWeight * 100) / 100,
    topHints: hints.slice(0, 5).map((h) => ({
      type: h.hint_type,
      occurrences: h.occurrence_count,
      weight: Math.round(h.weight * 100) / 100,
    })),
  };
}

/**
 * Decay user hint weights (called by scheduled job)
 */
export async function decayUserHintWeights(decayDays: number = 7): Promise<number> {
  try {
    const result = await pool.query<{ decay_user_hint_weights: number }>(
      'SELECT decay_user_hint_weights($1)',
      [decayDays]
    );
    const updated = result.rows[0]?.decay_user_hint_weights || 0;
    if (updated > 0) {
      logger.info('Decayed user hint weights', { updated, decayDays });
    }
    return updated;
  } catch (error) {
    logger.error('Failed to decay hint weights', {
      error: (error as Error).message,
    });
    return 0;
  }
}

export default {
  getActiveHints,
  formatHintsForPrompt,
  getFormattedHints,
  clearSessionHints,
  addSessionHint,
  addUserHint,
  getUserHintStats,
  decayUserHintWeights,
};
