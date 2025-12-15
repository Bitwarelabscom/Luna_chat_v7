/**
 * Self-Correction Service
 *
 * Manages pending corrections and injects self-correction behavior
 * into the next response when issues are found.
 */

import { pool } from '../../db/index.js';
import logger from '../../utils/logger.js';

// ============================================
// Types
// ============================================

export interface PendingCorrection {
  id: string;
  turnId: string;
  severity: 'minor' | 'moderate' | 'serious';
  issues: string[];
  fixInstructions: string;
  originalResponse: string;
}

// ============================================
// Correction Retrieval
// ============================================

/**
 * Get pending corrections for a session
 */
export async function getPendingCorrections(sessionId: string): Promise<PendingCorrection[]> {
  try {
    const result = await pool.query<{
      id: string;
      turn_id: string;
      severity: string;
      issues: string[];
      fix_instructions: string;
      original_response: string;
    }>(
      `SELECT id, turn_id, severity, issues, fix_instructions, original_response
       FROM pending_corrections
       WHERE session_id = $1 AND processed = FALSE
       ORDER BY created_at ASC`,
      [sessionId]
    );

    return result.rows.map((r) => ({
      id: r.id,
      turnId: r.turn_id,
      severity: r.severity as 'minor' | 'moderate' | 'serious',
      issues: r.issues,
      fixInstructions: r.fix_instructions,
      originalResponse: r.original_response,
    }));
  } catch (error) {
    logger.error('Failed to get pending corrections', {
      sessionId,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Check if session has pending corrections
 */
export async function hasPendingCorrections(sessionId: string): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM pending_corrections
     WHERE session_id = $1 AND processed = FALSE`,
    [sessionId]
  );
  return parseInt(result.rows[0]?.count || '0', 10) > 0;
}

// ============================================
// Correction Management
// ============================================

/**
 * Mark corrections as processed
 */
export async function markCorrectionsProcessed(correctionIds: string[]): Promise<void> {
  if (correctionIds.length === 0) return;

  await pool.query(`UPDATE pending_corrections SET processed = TRUE WHERE id = ANY($1)`, [
    correctionIds,
  ]);

  logger.debug('Marked corrections as processed', { count: correctionIds.length });
}

/**
 * Mark all corrections for a session as processed
 */
export async function markAllSessionCorrectionsProcessed(sessionId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE pending_corrections SET processed = TRUE
     WHERE session_id = $1 AND processed = FALSE`,
    [sessionId]
  );
  return result.rowCount || 0;
}

// ============================================
// Prompt Formatting
// ============================================

/**
 * Format self-correction instructions for prompt injection
 */
export function formatCorrectionPrompt(corrections: PendingCorrection[]): string | null {
  if (corrections.length === 0) return null;

  // Group by severity
  const serious = corrections.filter((c) => c.severity === 'serious');
  const moderate = corrections.filter((c) => c.severity === 'moderate');

  const parts: string[] = [];

  // Serious issues: Explicit correction needed
  if (serious.length > 0) {
    const issues = serious.flatMap((c) => c.issues).slice(0, 3);
    parts.push(`[Self-Correction Required]
In your previous response, you made some mistakes that need explicit correction.
Start your response by briefly acknowledging and correcting: ${issues.join('; ')}.
Use a natural transition like "Actually, let me rephrase..." or "I should clarify..."`);
  }

  // Moderate issues: Subtle weave
  if (moderate.length > 0 && serious.length === 0) {
    const issues = moderate.flatMap((c) => c.issues).slice(0, 2);
    parts.push(`[Subtle Improvement Needed]
Your previous response had minor issues. Without explicitly mentioning corrections,
naturally incorporate improvements for: ${issues.join('; ')}.
Do NOT say you are correcting anything - just do better this time.`);
  }

  // Minor issues: Just log, no prompt injection (hints handle these)
  // They're covered by hint injection in generator

  if (parts.length === 0) return null;

  return parts.join('\n\n');
}

/**
 * Get formatted correction prompt ready for injection
 */
export async function getFormattedCorrectionPrompt(sessionId: string): Promise<{
  prompt: string | null;
  correctionIds: string[];
}> {
  const corrections = await getPendingCorrections(sessionId);
  const prompt = formatCorrectionPrompt(corrections);
  return {
    prompt,
    correctionIds: corrections.map((c) => c.id),
  };
}

// ============================================
// Statistics & Cleanup
// ============================================

/**
 * Get correction statistics for a user
 */
export async function getCorrectionStats(userId: string): Promise<{
  total: number;
  bySeverity: { minor: number; moderate: number; serious: number };
  pending: number;
}> {
  const result = await pool.query<{
    severity: string;
    count: string;
    pending_count: string;
  }>(
    `SELECT
       severity,
       COUNT(*) as count,
       COUNT(*) FILTER (WHERE processed = FALSE) as pending_count
     FROM pending_corrections pc
     JOIN sessions s ON s.id = pc.session_id
     WHERE s.user_id = $1
     GROUP BY severity`,
    [userId]
  );

  const stats = {
    total: 0,
    bySeverity: { minor: 0, moderate: 0, serious: 0 },
    pending: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const pending = parseInt(row.pending_count, 10);
    stats.total += count;
    stats.pending += pending;
    if (row.severity in stats.bySeverity) {
      stats.bySeverity[row.severity as keyof typeof stats.bySeverity] = count;
    }
  }

  return stats;
}

/**
 * Clean up old processed corrections
 */
export async function cleanupOldCorrections(daysOld: number = 7): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM pending_corrections
       WHERE processed = TRUE AND created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [daysOld]
    );
    const deleted = result.rowCount || 0;
    if (deleted > 0) {
      logger.info('Cleaned up old corrections', { deleted, daysOld });
    }
    return deleted;
  } catch (error) {
    logger.error('Failed to cleanup corrections', {
      error: (error as Error).message,
    });
    return 0;
  }
}

/**
 * Delete all corrections for a session
 */
export async function deleteSessionCorrections(sessionId: string): Promise<void> {
  await pool.query(`DELETE FROM pending_corrections WHERE session_id = $1`, [sessionId]);
}

export default {
  getPendingCorrections,
  hasPendingCorrections,
  markCorrectionsProcessed,
  markAllSessionCorrectionsProcessed,
  formatCorrectionPrompt,
  getFormattedCorrectionPrompt,
  getCorrectionStats,
  cleanupOldCorrections,
  deleteSessionCorrections,
};
