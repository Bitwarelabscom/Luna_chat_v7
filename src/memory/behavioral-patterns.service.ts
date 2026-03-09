/**
 * Behavioral Patterns Service
 *
 * Detects significant behavioral shifts from enrichment data
 * and generates specific, human-readable observations.
 * Runs on a schedule (every 15 minutes).
 */

import { pool } from '../db/index.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

export interface BehavioralObservation {
  id: string;
  userId: string;
  observationType: string;
  observation: string;
  evidenceSummary: string | null;
  severity: number;
  windowStart: Date;
  windowEnd: Date;
  expired: boolean;
  createdAt: Date;
}

/**
 * Run pattern detection for all active users.
 * Called by job runner every 15 minutes.
 */
export async function runDetection(): Promise<void> {
  try {
    // Find users with recent activity (last 24h)
    const activeUsers = await pool.query(
      `SELECT DISTINCT user_id FROM messages
       WHERE created_at > NOW() - INTERVAL '24 hours'
       LIMIT 50`
    );

    for (const row of activeUsers.rows) {
      await detectPatterns(row.user_id as string).catch(err =>
        logger.debug('Pattern detection failed for user', { userId: row.user_id, error: (err as Error).message })
      );
    }

    // Expire stale observations
    await expireStale();
  } catch (error) {
    logger.debug('Behavioral pattern detection run failed', { error: (error as Error).message });
  }
}

/**
 * Detect behavioral pattern shifts for a single user.
 */
async function detectPatterns(userId: string): Promise<void> {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  // Get recent vs baseline enrichment stats
  const [recentStats, baselineStats] = await Promise.all([
    getEnrichmentStats(userId, threeDaysAgo, now),
    getEnrichmentStats(userId, tenDaysAgo, threeDaysAgo),
  ]);

  if (!recentStats || !baselineStats || baselineStats.messageCount < 10) return;

  const shifts: Array<{ type: string; description: string; evidence: string }> = [];

  // Engagement delta (message frequency)
  if (baselineStats.messageCount > 0) {
    const recentRate = recentStats.messageCount / 3; // per day
    const baselineRate = baselineStats.messageCount / 7; // per day
    if (baselineRate > 0) {
      const ratio = recentRate / baselineRate;
      if (ratio < 0.4) {
        shifts.push({
          type: 'engagement_drop',
          description: `Message frequency dropped significantly (${recentRate.toFixed(1)}/day vs usual ${baselineRate.toFixed(1)}/day)`,
          evidence: `${recentStats.messageCount} messages in 3 days vs ${baselineStats.messageCount} in prior 7 days`,
        });
      } else if (ratio > 2.5) {
        shifts.push({
          type: 'engagement_spike',
          description: `Message frequency spiked (${recentRate.toFixed(1)}/day vs usual ${baselineRate.toFixed(1)}/day)`,
          evidence: `${recentStats.messageCount} messages in 3 days vs ${baselineStats.messageCount} in prior 7 days`,
        });
      }
    }
  }

  // Emotional trajectory (valence trend)
  if (recentStats.avgValence !== null && baselineStats.avgValence !== null) {
    const valenceDelta = recentStats.avgValence - baselineStats.avgValence;
    if (valenceDelta < -0.3) {
      shifts.push({
        type: 'mood_decline',
        description: `Emotional tone has been notably more negative recently`,
        evidence: `Recent avg valence: ${recentStats.avgValence.toFixed(2)}, baseline: ${baselineStats.avgValence.toFixed(2)}`,
      });
    } else if (valenceDelta > 0.3) {
      shifts.push({
        type: 'mood_uplift',
        description: `Emotional tone has been notably more positive recently`,
        evidence: `Recent avg valence: ${recentStats.avgValence.toFixed(2)}, baseline: ${baselineStats.avgValence.toFixed(2)}`,
      });
    }
  }

  // Arousal shift (energy level)
  if (recentStats.avgArousal !== null && baselineStats.avgArousal !== null) {
    const arousalDelta = recentStats.avgArousal - baselineStats.avgArousal;
    if (Math.abs(arousalDelta) > 0.25) {
      shifts.push({
        type: arousalDelta > 0 ? 'energy_spike' : 'energy_drop',
        description: arousalDelta > 0
          ? `Messages have been more intense/energetic than usual`
          : `Messages have been calmer/lower energy than usual`,
        evidence: `Recent avg arousal: ${recentStats.avgArousal.toFixed(2)}, baseline: ${baselineStats.avgArousal.toFixed(2)}`,
      });
    }
  }

  if (shifts.length === 0) return;

  // Check for existing recent observations to avoid duplicates
  const existingResult = await pool.query(
    `SELECT observation_type FROM behavioral_observations
     WHERE user_id = $1 AND expired = FALSE AND created_at > NOW() - INTERVAL '6 hours'`,
    [userId]
  );
  const existingTypes = new Set(existingResult.rows.map((r: Record<string, unknown>) => r.observation_type as string));

  // Generate specific observations via LLM for new shift types
  for (const shift of shifts) {
    if (existingTypes.has(shift.type)) continue;

    const observation = await generateSpecificObservation(shift, userId);
    if (!observation) continue;

    await pool.query(
      `INSERT INTO behavioral_observations
        (user_id, observation_type, observation, evidence_summary, severity, window_start, window_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, shift.type, observation, shift.evidence, 0.5, threeDaysAgo, now]
    );

    logger.debug('Created behavioral observation', { userId, type: shift.type });
  }
}

/**
 * Get aggregated enrichment stats for a user over a time window.
 */
async function getEnrichmentStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<{
  messageCount: number;
  avgValence: number | null;
  avgArousal: number | null;
} | null> {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) as message_count,
        AVG(emotional_valence) as avg_valence,
        AVG(
          CASE WHEN emotional_valence IS NOT NULL
          THEN ABS(emotional_valence) * 0.5 + 0.3
          ELSE NULL END
        ) as avg_arousal
       FROM message_embeddings
       WHERE user_id = $1 AND created_at BETWEEN $2 AND $3`,
      [userId, from, to]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      messageCount: parseInt(row.message_count as string, 10),
      avgValence: row.avg_valence ? parseFloat(row.avg_valence as string) : null,
      avgArousal: row.avg_arousal ? parseFloat(row.avg_arousal as string) : null,
    };
  } catch (error) {
    logger.debug('Failed to get enrichment stats', { error: (error as Error).message });
    return null;
  }
}

/**
 * Generate a specific, human-readable observation from a detected shift.
 * Not "engagement dropped" but a vivid, specific note.
 */
async function generateSpecificObservation(
  shift: { type: string; description: string; evidence: string },
  userId?: string,
): Promise<string | null> {
  try {
    const response = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'memory_curation',
      messages: [
        {
          role: 'system',
          content: `You are an observant friend noticing a behavioral change. Given the data below, write ONE specific, human observation. Be concrete - reference what changed, not the category. Don't be clinical. Don't use words like "engagement" or "metrics". Write it as something a close friend would notice. Output ONLY the observation sentence.`,
        },
        {
          role: 'user',
          content: `Shift type: ${shift.type}\nDescription: ${shift.description}\nEvidence: ${shift.evidence}`,
        },
      ],
      temperature: 0.5,
      maxTokens: 100,
      ...(userId ? {
        loggingContext: {
          userId,
          source: 'memory',
          nodeName: 'behavioral_observation',
        },
      } : {}),
    });

    const observation = (response.content || '').trim();
    return observation.length > 10 ? observation.slice(0, 500) : null;
  } catch {
    // Fallback to the raw description
    return shift.description;
  }
}

/**
 * Get active (non-expired) observations for a user.
 */
export async function getActiveObservations(
  userId: string,
  limit = 3,
): Promise<BehavioralObservation[]> {
  try {
    const result = await pool.query(
      `SELECT id, user_id, observation_type, observation, evidence_summary, severity,
              window_start, window_end, expired, created_at
       FROM behavioral_observations
       WHERE user_id = $1 AND expired = FALSE
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string,
      observationType: row.observation_type as string,
      observation: row.observation as string,
      evidenceSummary: row.evidence_summary as string | null,
      severity: parseFloat(row.severity as string),
      windowStart: row.window_start as Date,
      windowEnd: row.window_end as Date,
      expired: row.expired as boolean,
      createdAt: row.created_at as Date,
    }));
  } catch (error) {
    logger.debug('Failed to get active observations', { error: (error as Error).message });
    return [];
  }
}

/**
 * Expire observations older than 7 days.
 */
async function expireStale(): Promise<void> {
  try {
    await pool.query(
      `UPDATE behavioral_observations SET expired = TRUE
       WHERE expired = FALSE AND created_at < NOW() - INTERVAL '7 days'`
    );
  } catch (error) {
    logger.debug('Failed to expire stale observations', { error: (error as Error).message });
  }
}

/**
 * Format active observations for system prompt context.
 */
export function formatForContext(observations: BehavioralObservation[]): string {
  if (observations.length === 0) return '';

  const lines = observations.map(o => `- ${o.observation}`);
  return `[Things You've Noticed]\n${lines.join('\n')}`;
}

export default { runDetection, getActiveObservations, formatForContext };
