/**
 * Routine Learning Service - Learns temporal/behavioral patterns from existing data
 *
 * Daily job mines messages, summaries, and tool usage to find recurring patterns.
 * Per-message reads return matching routines for current time context.
 */

import { query } from '../db/postgres.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import logger from '../utils/logger.js';

interface Routine {
  patternKey: string;
  description: string;
  routineType: 'temporal' | 'sequential' | 'contextual';
  timeWindowStart?: string;
  timeWindowEnd?: string;
  dayOfWeek?: number[];
  confidence: number;
}

/**
 * Analyze user activity to discover routines. Called daily.
 */
export async function analyzeRoutines(userId: string): Promise<void> {
  try {
    // Mine message timestamps grouped by hour and day of week
    const timePatterns = await query(
      `SELECT
        EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'Europe/Helsinki') AS hour,
        EXTRACT(DOW FROM m.created_at AT TIME ZONE 'Europe/Helsinki') AS dow,
        COUNT(*) AS msg_count
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE s.user_id = $1
        AND m.role = 'user'
        AND m.created_at > NOW() - INTERVAL '30 days'
      GROUP BY hour, dow
      ORDER BY msg_count DESC
      LIMIT 20`,
      [userId]
    ) as Array<{ hour: number; dow: number; msg_count: string }>;

    if (timePatterns.length < 3) return; // Not enough data

    // Get recent conversation topics for context
    const recentTopics = await query(
      `SELECT topics, summary
      FROM conversation_summaries
      WHERE user_id = $1
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 15`,
      [userId]
    ) as Array<{ topics: string[]; summary: string }>;

    // Get tool usage patterns
    const toolPatterns = await query(
      `SELECT
        sl.tools_used,
        EXTRACT(HOUR FROM sl.started_at AT TIME ZONE 'Europe/Helsinki') AS hour
      FROM session_logs sl
      JOIN sessions s ON sl.session_id = s.id
      WHERE s.user_id = $1
        AND sl.started_at > NOW() - INTERVAL '30 days'
        AND sl.tools_used IS NOT NULL
        AND array_length(sl.tools_used, 1) > 0
      ORDER BY sl.started_at DESC
      LIMIT 20`,
      [userId]
    ) as Array<{ tools_used: string[]; hour: number }>;

    const modelConfig = await getBackgroundFeatureModelConfig(userId, 'luna_affect_analysis');

    const activitySummary = timePatterns.map(t =>
      `Hour ${t.hour} (day ${t.dow}): ${t.msg_count} messages`
    ).join('\n');

    const topicSummary = recentTopics.slice(0, 8).map(t =>
      `Topics: ${(t.topics || []).join(', ')} - ${t.summary?.slice(0, 100)}`
    ).join('\n');

    const toolSummary = toolPatterns.slice(0, 8).map(t =>
      `Hour ${t.hour}: ${t.tools_used.join(', ')}`
    ).join('\n');

    const result = await createCompletion(
      modelConfig.primary.provider,
      modelConfig.primary.model,
      [
        {
          role: 'system',
          content: `Analyze a user's activity patterns and identify recurring routines.
Output a JSON array of routines found (max 5). Each routine:
{
  "patternKey": "unique_snake_case_key",
  "description": "Human-readable: Usually does X around Y",
  "routineType": "temporal|sequential|contextual",
  "timeWindowStart": "HH:MM" or null,
  "timeWindowEnd": "HH:MM" or null,
  "dayOfWeek": [0-6 array, 0=Sunday] or null,
  "confidence": 0.0-1.0
}
Only include routines with clear evidence. Be conservative.
Output ONLY the JSON array, no markdown.`,
        },
        {
          role: 'user',
          content: `Activity by hour/day:\n${activitySummary}\n\nRecent topics:\n${topicSummary}\n\nTool usage by hour:\n${toolSummary}`,
        },
      ],
      {
        temperature: 0.3,
        maxTokens: 500,
        loggingContext: { userId, source: 'routine_learning', nodeName: 'routine_analysis' },
      }
    );

    let routines: Routine[];
    try {
      const cleaned = result.content.trim().replace(/^```json?\n?|\n?```$/g, '');
      routines = JSON.parse(cleaned);
      if (!Array.isArray(routines)) return;
    } catch {
      logger.debug('Failed to parse routine analysis result', { userId });
      return;
    }

    // Upsert discovered routines
    for (const routine of routines.slice(0, 5)) {
      if (!routine.patternKey || !routine.description) continue;

      await query(
        `INSERT INTO user_routines (user_id, routine_type, pattern_key, description, time_window_start, time_window_end, day_of_week, confidence, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (user_id, pattern_key)
         DO UPDATE SET
           description = EXCLUDED.description,
           confidence = GREATEST(user_routines.confidence, EXCLUDED.confidence),
           occurrence_count = user_routines.occurrence_count + 1,
           last_seen_at = NOW(),
           is_active = true,
           updated_at = NOW()`,
        [
          userId,
          routine.routineType || 'temporal',
          routine.patternKey,
          routine.description,
          routine.timeWindowStart || null,
          routine.timeWindowEnd || null,
          routine.dayOfWeek || null,
          routine.confidence || 0.5,
        ]
      );
    }

    logger.info('Routine analysis complete', { userId, routinesFound: routines.length });
  } catch (error) {
    logger.error('Routine analysis failed', { userId, error: (error as Error).message });
  }
}

/**
 * Get routine context matching current time. Called per-message (~2ms).
 */
export async function getRoutineContext(userId: string, currentHour: number, dayOfWeek: number): Promise<string> {
  try {
    const routines = await query(
      `SELECT description, confidence FROM user_routines
       WHERE user_id = $1
         AND is_active = true
         AND confidence > 0.3
         AND (
           (time_window_start IS NOT NULL AND time_window_end IS NOT NULL
            AND $2::time BETWEEN time_window_start AND time_window_end)
           OR time_window_start IS NULL
         )
         AND (
           day_of_week IS NULL OR $3 = ANY(day_of_week)
         )
       ORDER BY confidence DESC
       LIMIT 3`,
      [userId, `${currentHour}:00`, dayOfWeek]
    ) as Array<{ description: string; confidence: number }>;

    if (routines.length === 0) return '';

    return routines.map(r => `- ${r.description}`).join('\n');
  } catch (error) {
    logger.debug('Routine context fetch failed', { error: (error as Error).message });
    return '';
  }
}

/**
 * Decay and deactivate stale routines. Called daily.
 */
export async function expireStaleRoutines(): Promise<void> {
  try {
    // Decay confidence for routines not seen in 14+ days
    await query(
      `UPDATE user_routines
       SET confidence = confidence * 0.85, updated_at = NOW()
       WHERE is_active = true
         AND last_seen_at < NOW() - INTERVAL '14 days'
         AND confidence > 0.15`
    );

    // Deactivate below threshold
    await query(
      `UPDATE user_routines
       SET is_active = false, updated_at = NOW()
       WHERE is_active = true
         AND confidence <= 0.15`
    );
  } catch (error) {
    logger.error('Routine expiry failed', { error: (error as Error).message });
  }
}
