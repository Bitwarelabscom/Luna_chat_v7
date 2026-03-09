/**
 * Emotional Moments Service
 *
 * Captures raw emotional moments when VAD thresholds are crossed.
 * Preserves the actual text and generates a 1-sentence crystallization.
 * Fire-and-forget, non-blocking.
 */

import { pool } from '../db/index.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

export interface EmotionalMoment {
  id: string;
  userId: string;
  sessionId: string;
  rawText: string;
  momentTag: string;
  valence: number;
  arousal: number;
  dominance: number;
  contextTopic: string | null;
  createdAt: Date;
}

/**
 * Capture an emotional moment when VAD thresholds are crossed.
 * Generates a 1-sentence moment tag via fast LLM call.
 */
export async function capture(
  userId: string,
  sessionId: string,
  messageId: string | null,
  rawText: string,
  vad: { valence: number; arousal: number; dominance: number },
  contextTopic?: string,
): Promise<void> {
  try {
    // Generate a 1-sentence crystallization of the moment
    const momentTag = await generateMomentTag(rawText, vad, userId, sessionId);

    await pool.query(
      `INSERT INTO emotional_moments
        (user_id, session_id, message_id, raw_text, moment_tag, valence, arousal, dominance, context_topic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, sessionId, messageId, rawText.slice(0, 2000), momentTag, vad.valence, vad.arousal, vad.dominance, contextTopic || null]
    );

    logger.debug('Captured emotional moment', { userId, sessionId, valence: vad.valence, arousal: vad.arousal });
  } catch (error) {
    logger.debug('Failed to capture emotional moment', { error: (error as Error).message });
  }
}

/**
 * Generate a 1-sentence moment tag via fast LLM call.
 */
async function generateMomentTag(
  rawText: string,
  vad: { valence: number; arousal: number; dominance: number },
  userId?: string,
  sessionId?: string,
): Promise<string> {
  try {
    const emotionHint = vad.valence < -0.3 ? 'frustrated/upset' :
                        vad.valence > 0.5 ? 'excited/happy' :
                        vad.arousal > 0.7 ? 'intense/agitated' : 'notable';

    const response = await createBackgroundCompletionWithFallback({
      userId,
      sessionId,
      feature: 'memory_curation',
      messages: [
        {
          role: 'system',
          content: `Crystallize this message into a single vivid sentence that captures the emotional moment. Keep the specific details - names, tools, events. Tone: ${emotionHint}. Output ONLY the sentence, nothing else.`,
        },
        { role: 'user', content: rawText.slice(0, 500) },
      ],
      temperature: 0.3,
      maxTokens: 100,
      ...(userId ? {
        loggingContext: {
          userId,
          sessionId,
          source: 'memory',
          nodeName: 'emotional_moment_tag',
        },
      } : {}),
    });

    return (response.content || '').trim().slice(0, 500) || rawText.slice(0, 100);
  } catch {
    // Fallback: use first 100 chars of raw text
    return rawText.slice(0, 100);
  }
}

/**
 * Get recent emotional moments for a user.
 */
export async function getRecentMoments(
  userId: string,
  limit = 5,
  daysBack = 7,
): Promise<EmotionalMoment[]> {
  try {
    const result = await pool.query(
      `SELECT id, user_id, session_id, raw_text, moment_tag, valence, arousal, dominance, context_topic, created_at
       FROM emotional_moments
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, daysBack, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: row.user_id as string,
      sessionId: row.session_id as string,
      rawText: row.raw_text as string,
      momentTag: row.moment_tag as string,
      valence: parseFloat(row.valence as string),
      arousal: parseFloat(row.arousal as string),
      dominance: parseFloat(row.dominance as string),
      contextTopic: row.context_topic as string | null,
      createdAt: row.created_at as Date,
    }));
  } catch (error) {
    logger.debug('Failed to get recent emotional moments', { error: (error as Error).message });
    return [];
  }
}

/**
 * Format emotional moments for system prompt context.
 * Prose format - reads like memory, not data.
 */
export function formatForContext(moments: EmotionalMoment[]): string {
  if (moments.length === 0) return '';

  const lines = moments.map(m => `- ${m.momentTag}`);
  return `[Recent Emotional Moments]\n${lines.join('\n')}`;
}

export default { capture, getRecentMoments, formatForContext };
