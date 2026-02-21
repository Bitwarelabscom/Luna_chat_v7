import { pool } from '../db/index.js';
import * as moodService from './mood.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface SessionMoodState {
  sessionId: string;
  userId: string;
  initialMood?: MoodSnapshot;
  currentMood?: MoodSnapshot;
  moodTrajectory: 'improving' | 'stable' | 'declining';
  energyTrajectory: 'increasing' | 'stable' | 'decreasing';
  messageCount: number;
  adjustmentsMade: string[];
}

export interface MoodSnapshot {
  sentiment: string;
  sentimentScore: number;
  energyLevel?: string;
  emotions: string[];
  timestamp: Date;
}

export interface EnergyPattern {
  type: string;
  data: Record<string, number>; // hour/day -> average energy
  sampleCount: number;
}

export interface AdaptiveGuidance {
  toneAdjustment: string;
  paceAdjustment: string;
  contentAdjustment: string;
  proactiveActions: string[];
  shouldCheckIn: boolean;
  checkInPrompt?: string;
}

export interface MoodShift {
  type: 'positive_shift' | 'negative_shift' | 'energy_drop' | 'energy_spike';
  fromState: MoodSnapshot;
  toState: MoodSnapshot;
  magnitude: number;
}

// ============================================
// Session Mood Management
// ============================================

/**
 * Initialize mood tracking for a new session
 */
export async function initializeSessionMood(
  sessionId: string,
  userId: string,
  firstMessage: string
): Promise<SessionMoodState> {
  try {
    // Analyze mood from first message
    const mood = await moodService.analyzeMood(firstMessage, userId);

    const initialMood: MoodSnapshot | undefined = mood ? {
      sentiment: mood.sentiment,
      sentimentScore: mood.sentimentScore,
      energyLevel: mood.energyLevel,
      emotions: mood.emotions,
      timestamp: new Date(),
    } : undefined;

    const state: SessionMoodState = {
      sessionId,
      userId,
      initialMood,
      currentMood: initialMood,
      moodTrajectory: 'stable',
      energyTrajectory: 'stable',
      messageCount: 1,
      adjustmentsMade: [],
    };

    await pool.query(
      `INSERT INTO session_mood_state
        (session_id, user_id, initial_mood, current_mood, mood_trajectory, energy_trajectory, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id) DO UPDATE SET
         initial_mood = COALESCE(session_mood_state.initial_mood, EXCLUDED.initial_mood),
         current_mood = EXCLUDED.current_mood,
         message_count = session_mood_state.message_count + 1,
         updated_at = NOW()`,
      [
        sessionId, userId,
        initialMood ? JSON.stringify(initialMood) : null,
        initialMood ? JSON.stringify(initialMood) : null,
        'stable', 'stable', 1
      ]
    );

    // Store mood entry for long-term tracking
    if (mood) {
      await moodService.storeMoodEntry(userId, sessionId, mood);
    }

    return state;
  } catch (error) {
    logger.error('Failed to initialize session mood', {
      error: (error as Error).message,
      sessionId, userId
    });
    return {
      sessionId, userId,
      moodTrajectory: 'stable',
      energyTrajectory: 'stable',
      messageCount: 1,
      adjustmentsMade: [],
    };
  }
}

/**
 * Update session mood after each message
 */
export async function updateSessionMood(
  sessionId: string,
  userId: string,
  message: string
): Promise<{ state: SessionMoodState; shift?: MoodShift }> {
  try {
    // Get current state
    const stateResult = await pool.query(
      `SELECT initial_mood, current_mood, mood_trajectory, energy_trajectory, message_count, adjustments_made
       FROM session_mood_state
       WHERE session_id = $1`,
      [sessionId]
    );

    let previousMood: MoodSnapshot | undefined;
    let initialMood: MoodSnapshot | undefined;
    let messageCount = 1;
    let adjustmentsMade: string[] = [];

    if (stateResult.rows.length > 0) {
      const row = stateResult.rows[0];
      previousMood = row.current_mood as MoodSnapshot | undefined;
      initialMood = row.initial_mood as MoodSnapshot | undefined;
      messageCount = (row.message_count as number) + 1;
      adjustmentsMade = (row.adjustments_made as string[]) || [];
    }

    // Analyze current mood
    const mood = await moodService.analyzeMood(message, userId);
    const currentMood: MoodSnapshot | undefined = mood ? {
      sentiment: mood.sentiment,
      sentimentScore: mood.sentimentScore,
      energyLevel: mood.energyLevel,
      emotions: mood.emotions,
      timestamp: new Date(),
    } : previousMood;

    // Calculate trajectories
    const { moodTrajectory, energyTrajectory, shift } = calculateTrajectories(
      initialMood, previousMood, currentMood
    );

    // Update state
    await pool.query(
      `INSERT INTO session_mood_state
        (session_id, user_id, initial_mood, current_mood, mood_trajectory, energy_trajectory, message_count, adjustments_made)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_id) DO UPDATE SET
         current_mood = EXCLUDED.current_mood,
         mood_trajectory = EXCLUDED.mood_trajectory,
         energy_trajectory = EXCLUDED.energy_trajectory,
         message_count = EXCLUDED.message_count,
         updated_at = NOW()`,
      [
        sessionId, userId,
        initialMood ? JSON.stringify(initialMood) : null,
        currentMood ? JSON.stringify(currentMood) : null,
        moodTrajectory,
        energyTrajectory,
        messageCount,
        adjustmentsMade
      ]
    );

    // Record mood shift if significant
    if (shift) {
      await recordMoodShift(userId, sessionId, shift);
    }

    // Store mood entry
    if (mood) {
      await moodService.storeMoodEntry(userId, sessionId, mood);
    }

    // Update energy patterns asynchronously
    if (currentMood?.energyLevel) {
      updateEnergyPattern(userId, currentMood.energyLevel).catch(() => {});
    }

    const state: SessionMoodState = {
      sessionId, userId,
      initialMood, currentMood,
      moodTrajectory, energyTrajectory,
      messageCount, adjustmentsMade,
    };

    return { state, shift };
  } catch (error) {
    logger.error('Failed to update session mood', {
      error: (error as Error).message,
      sessionId
    });
    return {
      state: {
        sessionId, userId,
        moodTrajectory: 'stable',
        energyTrajectory: 'stable',
        messageCount: 1,
        adjustmentsMade: [],
      }
    };
  }
}

/**
 * Calculate mood and energy trajectories
 */
function calculateTrajectories(
  _initial?: MoodSnapshot,
  previous?: MoodSnapshot,
  current?: MoodSnapshot
): {
  moodTrajectory: 'improving' | 'stable' | 'declining';
  energyTrajectory: 'increasing' | 'stable' | 'decreasing';
  shift?: MoodShift;
} {
  let moodTrajectory: 'improving' | 'stable' | 'declining' = 'stable';
  let energyTrajectory: 'increasing' | 'stable' | 'decreasing' = 'stable';
  let shift: MoodShift | undefined;

  if (!current || !previous) {
    return { moodTrajectory, energyTrajectory };
  }

  // Calculate mood trajectory
  const moodDiff = current.sentimentScore - previous.sentimentScore;
  if (moodDiff > 0.3) {
    moodTrajectory = 'improving';
  } else if (moodDiff < -0.3) {
    moodTrajectory = 'declining';
  }

  // Detect significant mood shifts
  if (Math.abs(moodDiff) >= 0.4) {
    shift = {
      type: moodDiff > 0 ? 'positive_shift' : 'negative_shift',
      fromState: previous,
      toState: current,
      magnitude: Math.abs(moodDiff),
    };
  }

  // Calculate energy trajectory
  const energyMap: Record<string, number> = { low: 0, medium: 0.5, high: 1 };
  const prevEnergy = energyMap[previous.energyLevel || 'medium'] ?? 0.5;
  const currEnergy = energyMap[current.energyLevel || 'medium'] ?? 0.5;
  const energyDiff = currEnergy - prevEnergy;

  if (energyDiff > 0.3) {
    energyTrajectory = 'increasing';
    if (!shift) {
      shift = {
        type: 'energy_spike',
        fromState: previous,
        toState: current,
        magnitude: energyDiff,
      };
    }
  } else if (energyDiff < -0.3) {
    energyTrajectory = 'decreasing';
    if (!shift) {
      shift = {
        type: 'energy_drop',
        fromState: previous,
        toState: current,
        magnitude: Math.abs(energyDiff),
      };
    }
  }

  return { moodTrajectory, energyTrajectory, shift };
}

/**
 * Record a mood shift for analysis
 */
async function recordMoodShift(
  userId: string,
  sessionId: string,
  shift: MoodShift
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO mood_shifts (user_id, session_id, shift_type, from_state, to_state)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, sessionId, shift.type, JSON.stringify(shift.fromState), JSON.stringify(shift.toState)]
    );
  } catch (error) {
    logger.error('Failed to record mood shift', {
      error: (error as Error).message,
      userId
    });
  }
}

// ============================================
// Energy Pattern Analysis
// ============================================

/**
 * Update hourly energy pattern
 */
async function updateEnergyPattern(userId: string, energyLevel: string): Promise<void> {
  try {
    const hour = new Date().getHours();
    const energyValue = energyLevel === 'high' ? 1 : energyLevel === 'low' ? 0 : 0.5;

    // Get existing pattern
    const result = await pool.query(
      `SELECT pattern_data, sample_count FROM energy_patterns
       WHERE user_id = $1 AND pattern_type = 'hourly'`,
      [userId]
    );

    let patternData: Record<string, { sum: number; count: number }> = {};
    let sampleCount = 0;

    if (result.rows.length > 0) {
      patternData = result.rows[0].pattern_data as Record<string, { sum: number; count: number }>;
      sampleCount = result.rows[0].sample_count as number;
    }

    // Update pattern for this hour
    if (!patternData[hour]) {
      patternData[hour] = { sum: 0, count: 0 };
    }
    patternData[hour].sum += energyValue;
    patternData[hour].count += 1;

    await pool.query(
      `INSERT INTO energy_patterns (user_id, pattern_type, pattern_data, sample_count)
       VALUES ($1, 'hourly', $2, $3)
       ON CONFLICT (user_id, pattern_type) DO UPDATE SET
         pattern_data = EXCLUDED.pattern_data,
         sample_count = EXCLUDED.sample_count,
         last_updated = NOW(),
         updated_at = NOW()`,
      [userId, JSON.stringify(patternData), sampleCount + 1]
    );
  } catch (error) {
    logger.error('Failed to update energy pattern', {
      error: (error as Error).message,
      userId
    });
  }
}

/**
 * Predict current energy level based on patterns
 */
export async function predictCurrentEnergy(userId: string): Promise<{
  predicted: 'low' | 'medium' | 'high';
  confidence: number;
}> {
  try {
    const hour = new Date().getHours();

    const result = await pool.query(
      `SELECT pattern_data, sample_count FROM energy_patterns
       WHERE user_id = $1 AND pattern_type = 'hourly'`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { predicted: 'medium', confidence: 0 };
    }

    const patternData = result.rows[0].pattern_data as Record<string, { sum: number; count: number }>;
    const hourData = patternData[hour];

    if (!hourData || hourData.count < 3) {
      return { predicted: 'medium', confidence: 0.2 };
    }

    const avgEnergy = hourData.sum / hourData.count;
    const predicted = avgEnergy < 0.35 ? 'low' : avgEnergy > 0.65 ? 'high' : 'medium';
    const confidence = Math.min(hourData.count / 20, 0.9);

    return { predicted, confidence };
  } catch (error) {
    logger.error('Failed to predict energy', {
      error: (error as Error).message,
      userId
    });
    return { predicted: 'medium', confidence: 0 };
  }
}

// ============================================
// Adaptive Guidance
// ============================================

/**
 * Get comprehensive adaptive guidance for current session
 */
export async function getAdaptiveGuidance(
  userId: string,
  sessionState: SessionMoodState
): Promise<AdaptiveGuidance> {
  const guidance: AdaptiveGuidance = {
    toneAdjustment: '',
    paceAdjustment: '',
    contentAdjustment: '',
    proactiveActions: [],
    shouldCheckIn: false,
  };

  try {
    const { currentMood, moodTrajectory, energyTrajectory, messageCount } = sessionState;

    // Get mood trends for context
    const trends = await moodService.getMoodTrends(userId, 7);

    // Tone adjustments based on current mood
    if (currentMood) {
      if (currentMood.sentiment === 'very_negative' || currentMood.sentiment === 'negative') {
        guidance.toneAdjustment = 'Be extra gentle and supportive. Validate their feelings before offering solutions.';

        if (currentMood.emotions.includes('sadness')) {
          guidance.proactiveActions.push('Consider offering a compassionate check-in');
        }
        if (currentMood.emotions.includes('anger') || currentMood.emotions.includes('frustration')) {
          guidance.proactiveActions.push('Acknowledge frustration without trying to immediately fix');
        }
      } else if (currentMood.sentiment === 'very_positive') {
        guidance.toneAdjustment = 'Match their enthusiasm and celebrate with them!';
      }

      // Energy-based adjustments
      if (currentMood.energyLevel === 'low') {
        guidance.paceAdjustment = 'Keep responses shorter and more focused. Reduce cognitive load.';
        guidance.contentAdjustment = 'Prioritize essential information. Offer to break complex topics into smaller parts.';
      } else if (currentMood.energyLevel === 'high') {
        guidance.paceAdjustment = 'Can engage in longer, more dynamic exchanges.';
        guidance.contentAdjustment = 'Good time for complex topics or creative exploration.';
      }
    }

    // Trajectory-based adjustments
    if (moodTrajectory === 'declining') {
      guidance.proactiveActions.push('Monitor for continued decline. Consider gentle mood check-in.');

      // Check if we should proactively check in
      if (messageCount >= 5 && !sessionState.adjustmentsMade.includes('mood_check')) {
        guidance.shouldCheckIn = true;
        guidance.checkInPrompt = 'I notice you might be going through a tough time. Would you like to talk about it, or would you prefer I help distract you with something else?';
      }
    } else if (moodTrajectory === 'improving') {
      guidance.proactiveActions.push('Mood is improving - current approach is working');
    }

    if (energyTrajectory === 'decreasing') {
      guidance.proactiveActions.push('Energy is dropping. Consider suggesting a break if conversation is long.');

      // Suggest break after many messages
      if (messageCount >= 10) {
        guidance.shouldCheckIn = true;
        guidance.checkInPrompt = 'We have been chatting for a while. How are you feeling? Would you like to take a break?';
      }
    }

    // Long-term trend consideration
    if (trends.moodTrend === 'declining' && trends.averageSentiment < -0.3) {
      guidance.proactiveActions.push('User has shown declining mood over the week. Be extra attentive.');
    }

  } catch (error) {
    logger.error('Failed to get adaptive guidance', {
      error: (error as Error).message,
      userId
    });
  }

  return guidance;
}

/**
 * Record a proactive intervention
 */
export async function recordIntervention(
  userId: string,
  sessionId: string,
  interventionType: string,
  triggerCondition: Record<string, unknown>,
  content?: string
): Promise<string> {
  try {
    const result = await pool.query(
      `INSERT INTO proactive_interventions
        (user_id, session_id, intervention_type, trigger_condition, intervention_content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, sessionId, interventionType, JSON.stringify(triggerCondition), content]
    );
    return result.rows[0].id;
  } catch (error) {
    logger.error('Failed to record intervention', {
      error: (error as Error).message,
      userId
    });
    return '';
  }
}

/**
 * Update intervention response
 */
export async function updateInterventionResponse(
  interventionId: string,
  response: 'accepted' | 'declined' | 'ignored',
  wasHelpful?: boolean
): Promise<void> {
  try {
    await pool.query(
      `UPDATE proactive_interventions
       SET user_response = $2, was_helpful = $3
       WHERE id = $1`,
      [interventionId, response, wasHelpful]
    );
  } catch (error) {
    logger.error('Failed to update intervention response', {
      error: (error as Error).message,
      interventionId
    });
  }
}

/**
 * Format mood awareness for prompt
 */
export function formatMoodAwarenessForPrompt(
  state: SessionMoodState,
  guidance: AdaptiveGuidance
): string {
  const parts: string[] = ['[Mood Awareness]'];

  if (state.currentMood) {
    parts.push(`Current state: ${state.currentMood.sentiment}`);
    if (state.currentMood.energyLevel) {
      parts.push(`Energy: ${state.currentMood.energyLevel}`);
    }
    if (state.currentMood.emotions.length > 0) {
      parts.push(`Emotions: ${state.currentMood.emotions.join(', ')}`);
    }
  }

  if (state.moodTrajectory !== 'stable') {
    parts.push(`Mood trajectory: ${state.moodTrajectory}`);
  }
  if (state.energyTrajectory !== 'stable') {
    parts.push(`Energy trajectory: ${state.energyTrajectory}`);
  }

  if (guidance.toneAdjustment) {
    parts.push(`\nTone: ${guidance.toneAdjustment}`);
  }
  if (guidance.paceAdjustment) {
    parts.push(`Pace: ${guidance.paceAdjustment}`);
  }
  if (guidance.contentAdjustment) {
    parts.push(`Content: ${guidance.contentAdjustment}`);
  }

  if (guidance.proactiveActions.length > 0) {
    parts.push(`\nNotes: ${guidance.proactiveActions.join('. ')}`);
  }

  return parts.join('\n');
}

export default {
  initializeSessionMood,
  updateSessionMood,
  predictCurrentEnergy,
  getAdaptiveGuidance,
  recordIntervention,
  updateInterventionResponse,
  formatMoodAwarenessForPrompt,
};
