/**
 * Luna Affect Service - Luna's internal emotional state
 *
 * Tracks Luna's own mood/affect that persists across exchanges and colors her responses.
 * Updated after each exchange via sentiment analysis of Luna's own response.
 * Time-decays toward neutral baseline between sessions.
 */

import { query, queryOne } from '../db/postgres.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export interface LunaAffect {
  valence: number;      // -1.0 to 1.0
  arousal: number;      // 0.0 to 1.0
  curiosity: number;    // 0.0 to 1.0
  frustration: number;  // 0.0 to 1.0
  engagement: number;   // 0.0 to 1.0
  moodLabel: string | null;
  moodNarrative: string | null;
  updatedAt: Date;
}

const NEUTRAL_AFFECT: LunaAffect = {
  valence: 0.0,
  arousal: 0.3,
  curiosity: 0.5,
  frustration: 0.0,
  engagement: 0.5,
  moodLabel: null,
  moodNarrative: null,
  updatedAt: new Date(),
};

// Time-decay constants
const DECAY_HALF_LIFE_MS = 30 * 60 * 1000; // 30 minutes - mood drifts toward neutral
const BLEND_FACTOR = 0.3; // How much new signal blends with existing state (0-1)

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Apply time-decay toward neutral baseline.
 * Mood drifts toward neutral over time when no interaction occurs.
 */
function applyTimeDecay(affect: LunaAffect): LunaAffect {
  const elapsedMs = Date.now() - affect.updatedAt.getTime();
  if (elapsedMs < 60_000) return affect; // No decay within 1 minute

  const decayFactor = Math.exp(-0.693 * elapsedMs / DECAY_HALF_LIFE_MS);

  return {
    ...affect,
    valence: affect.valence * decayFactor,
    arousal: 0.3 + (affect.arousal - 0.3) * decayFactor,
    curiosity: 0.5 + (affect.curiosity - 0.5) * decayFactor,
    frustration: affect.frustration * decayFactor,
    engagement: 0.5 + (affect.engagement - 0.5) * decayFactor,
  };
}

/**
 * Get Luna's current affect state for a user (with time-decay applied).
 */
export async function getCurrentAffect(userId: string): Promise<LunaAffect> {
  if (!config.lunaAffect?.enabled) return NEUTRAL_AFFECT;

  try {
    const row = await queryOne<{
      valence: number;
      arousal: number;
      curiosity: number;
      frustration: number;
      engagement: number;
      mood_label: string | null;
      mood_narrative: string | null;
      updated_at: Date;
    }>(
      `SELECT valence, arousal, curiosity, frustration, engagement, mood_label, mood_narrative, updated_at
       FROM luna_affect_state
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!row) return NEUTRAL_AFFECT;

    const affect: LunaAffect = {
      valence: row.valence,
      arousal: row.arousal,
      curiosity: row.curiosity,
      frustration: row.frustration,
      engagement: row.engagement,
      moodLabel: row.mood_label,
      moodNarrative: row.mood_narrative,
      updatedAt: new Date(row.updated_at),
    };

    return applyTimeDecay(affect);
  } catch (error) {
    logger.debug('Failed to get Luna affect', { error: (error as Error).message });
    return NEUTRAL_AFFECT;
  }
}

/**
 * Update Luna's affect based on her response and the conversation signals.
 * Called fire-and-forget after each exchange.
 */
export async function updateAffect(
  userId: string,
  sessionId: string,
  signals: {
    lunaResponse: string;
    userMessage: string;
    userSentimentValence?: number;
  }
): Promise<void> {
  if (!config.lunaAffect?.enabled) return;

  try {
    // Get current state (with decay)
    const current = await getCurrentAffect(userId);

    // Analyze Luna's own response for affect signals
    const modelConfig = await getBackgroundFeatureModelConfig(userId, 'luna_affect_analysis');

    const analysisResult = await createCompletion(
      modelConfig.primary.provider,
      modelConfig.primary.model,
      [
        {
          role: 'system',
          content: `You analyze an AI assistant's response to determine her internal emotional state.
Output ONLY a JSON object with these float values:
- valence: -1.0 to 1.0 (negative to positive mood)
- arousal: 0.0 to 1.0 (calm to energized)
- curiosity: 0.0 to 1.0 (bored to fascinated)
- frustration: 0.0 to 1.0 (none to high)
- engagement: 0.0 to 1.0 (disengaged to deeply invested)
- mood_label: short 2-3 word mood description (e.g. "warmly curious", "quietly amused")
No other text.`,
        },
        {
          role: 'user',
          content: `User said: "${signals.userMessage.slice(0, 200)}"
Luna responded: "${signals.lunaResponse.slice(0, 400)}"`,
        },
      ],
      {
        temperature: 0.2,
        maxTokens: 100,
        loggingContext: { userId, source: 'luna_affect', nodeName: 'luna_affect' },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(analysisResult.content.trim());
    } catch {
      logger.debug('Luna affect LLM returned invalid JSON, keeping current state', {
        userId, raw: analysisResult.content.slice(0, 100),
      });
      return;
    }

    // Blend new signals with existing state (exponential moving average)
    const newAffect = {
      valence: clamp(current.valence * (1 - BLEND_FACTOR) + (parseFloat(parsed.valence) || 0) * BLEND_FACTOR, -1, 1),
      arousal: clamp(current.arousal * (1 - BLEND_FACTOR) + (parseFloat(parsed.arousal) || 0.3) * BLEND_FACTOR, 0, 1),
      curiosity: clamp(current.curiosity * (1 - BLEND_FACTOR) + (parseFloat(parsed.curiosity) || 0.5) * BLEND_FACTOR, 0, 1),
      frustration: clamp(current.frustration * (1 - BLEND_FACTOR) + (parseFloat(parsed.frustration) || 0) * BLEND_FACTOR, 0, 1),
      engagement: clamp(current.engagement * (1 - BLEND_FACTOR) + (parseFloat(parsed.engagement) || 0.5) * BLEND_FACTOR, 0, 1),
      moodLabel: typeof parsed.mood_label === 'string' ? parsed.mood_label.slice(0, 64) : current.moodLabel,
    };

    // Generate mood narrative via background LLM (concise 1-sentence)
    let moodNarrative = current.moodNarrative;
    try {
      const narrativeResult = await createCompletion(
        modelConfig.primary.provider,
        modelConfig.primary.model,
        [
          {
            role: 'system',
            content: 'Write a single short sentence (max 80 chars) describing an AI companion\'s current internal emotional state. First-person, present tense. No quotes. Example: "I feel a warm curiosity building, drawn into this thread."',
          },
          {
            role: 'user',
            content: `Mood: ${newAffect.moodLabel}. Valence: ${newAffect.valence.toFixed(2)}, Arousal: ${newAffect.arousal.toFixed(2)}, Curiosity: ${newAffect.curiosity.toFixed(2)}, Engagement: ${newAffect.engagement.toFixed(2)}.`,
          },
        ],
        {
          temperature: 0.7,
          maxTokens: 60,
          loggingContext: { userId, source: 'luna_affect_narrative', nodeName: 'luna_affect' },
        }
      );
      moodNarrative = narrativeResult.content.trim().slice(0, 200);
    } catch {
      // Keep existing narrative on failure
    }

    // Persist
    await query(
      `INSERT INTO luna_affect_state (user_id, session_id, valence, arousal, curiosity, frustration, engagement, mood_label, mood_narrative, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        userId,
        sessionId,
        newAffect.valence,
        newAffect.arousal,
        newAffect.curiosity,
        newAffect.frustration,
        newAffect.engagement,
        newAffect.moodLabel,
        moodNarrative,
      ]
    );

    logger.debug('Luna affect updated', {
      userId,
      moodLabel: newAffect.moodLabel,
      valence: newAffect.valence.toFixed(2),
    });
  } catch (error) {
    logger.debug('Luna affect update failed', { error: (error as Error).message });
  }
}

/**
 * Format Luna's affect state for prompt injection (~40 tokens).
 */
export function formatAffectForPrompt(affect: LunaAffect): string {
  if (!affect.moodLabel && !affect.moodNarrative) return '';

  const parts: string[] = ['[Luna\'s Current State]'];
  if (affect.moodNarrative) {
    parts.push(affect.moodNarrative);
  } else if (affect.moodLabel) {
    parts.push(`Current mood: ${affect.moodLabel}`);
  }

  return parts.join('\n');
}

export default { getCurrentAffect, updateAffect, formatAffectForPrompt };
