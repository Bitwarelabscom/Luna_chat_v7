import { pool } from '../db/index.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

export interface MoodEntry {
  id: string;
  sessionId?: string;
  sentiment: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
  sentimentScore: number;
  emotions: string[];
  energyLevel?: 'low' | 'medium' | 'high';
  topics: string[];
  detectedAt: Date;
}

export interface MoodPattern {
  patternType: string;
  patternData: Record<string, unknown>;
  confidence: number;
}

const MOOD_ANALYSIS_PROMPT = `Analyze the emotional content of this message. Return JSON only:
{
  "sentiment": "very_negative" | "negative" | "neutral" | "positive" | "very_positive",
  "sentimentScore": -1.0 to 1.0,
  "emotions": ["joy", "sadness", "anger", "fear", "surprise", "disgust", "trust", "anticipation"],
  "energyLevel": "low" | "medium" | "high",
  "topics": ["topic1", "topic2"]
}

Only include emotions that are clearly present. Return JSON only.`;

/**
 * Analyze mood from a message
 */
export async function analyzeMood(message: string, userId?: string): Promise<Omit<MoodEntry, 'id' | 'sessionId' | 'detectedAt'> | null> {
  try {
    // Use GPT-5-nano for accurate sentiment classification
    // Note: GPT-5-nano uses internal reasoning tokens, so we need higher maxTokens
    const response = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'mood_analysis',
      messages: [
        { role: 'system', content: MOOD_ANALYSIS_PROMPT },
        { role: 'user', content: message },
      ],
      maxTokens: 2000,
      loggingContext: { userId: userId ?? '', source: 'mood', nodeName: 'mood_analysis' },
    });

    const content = response.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      sentiment: parsed.sentiment || 'neutral',
      sentimentScore: parsed.sentimentScore || 0,
      emotions: parsed.emotions || [],
      energyLevel: parsed.energyLevel,
      topics: parsed.topics || [],
    };
  } catch (error) {
    logger.error('Failed to analyze mood', { error: (error as Error).message });
    return null;
  }
}

/**
 * Store mood entry
 */
export async function storeMoodEntry(
  userId: string,
  sessionId: string | undefined,
  mood: Omit<MoodEntry, 'id' | 'sessionId' | 'detectedAt'>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO mood_entries (user_id, session_id, sentiment, sentiment_score, emotions, energy_level, topics)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, sessionId, mood.sentiment, mood.sentimentScore, mood.emotions, mood.energyLevel, mood.topics]
    );
  } catch (error) {
    logger.error('Failed to store mood entry', { error: (error as Error).message, userId });
  }
}

/**
 * Get recent mood entries
 */
export async function getMoodHistory(
  userId: string,
  limit: number = 20
): Promise<MoodEntry[]> {
  try {
    const result = await pool.query(
      `SELECT id, session_id, sentiment, sentiment_score, emotions, energy_level, topics, detected_at
       FROM mood_entries
       WHERE user_id = $1
       ORDER BY detected_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      sessionId: row.session_id as string | undefined,
      sentiment: row.sentiment as MoodEntry['sentiment'],
      sentimentScore: parseFloat(row.sentiment_score as string),
      emotions: (row.emotions as string[]) || [],
      energyLevel: row.energy_level as 'low' | 'medium' | 'high' | undefined,
      topics: (row.topics as string[]) || [],
      detectedAt: row.detected_at as Date,
    }));
  } catch (error) {
    logger.error('Failed to get mood history', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Calculate mood trends
 */
export async function getMoodTrends(
  userId: string,
  days: number = 7
): Promise<{
  averageSentiment: number;
  dominantEmotions: string[];
  moodTrend: 'improving' | 'stable' | 'declining';
  topTopics: string[];
}> {
  try {
    const result = await pool.query(
      `SELECT sentiment_score, emotions, topics, detected_at
       FROM mood_entries
       WHERE user_id = $1 AND detected_at > NOW() - INTERVAL '${days} days'
       ORDER BY detected_at DESC`,
      [userId]
    );

    if (result.rows.length === 0) {
      return {
        averageSentiment: 0,
        dominantEmotions: [],
        moodTrend: 'stable',
        topTopics: [],
      };
    }

    // Calculate average sentiment
    const scores = result.rows.map((r: Record<string, unknown>) => parseFloat(r.sentiment_score as string));
    const averageSentiment = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Find dominant emotions
    const emotionCounts: Record<string, number> = {};
    result.rows.forEach((row: Record<string, unknown>) => {
      ((row.emotions as string[]) || []).forEach(e => {
        emotionCounts[e] = (emotionCounts[e] || 0) + 1;
      });
    });
    const dominantEmotions = Object.entries(emotionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([emotion]) => emotion);

    // Calculate trend (compare first half to second half)
    const midpoint = Math.floor(scores.length / 2);
    const recentAvg = scores.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint || 0;
    const olderAvg = scores.slice(midpoint).reduce((a, b) => a + b, 0) / (scores.length - midpoint) || 0;
    const diff = recentAvg - olderAvg;

    let moodTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (diff > 0.2) moodTrend = 'improving';
    if (diff < -0.2) moodTrend = 'declining';

    // Find top topics
    const topicCounts: Record<string, number> = {};
    result.rows.forEach((row: Record<string, unknown>) => {
      ((row.topics as string[]) || []).forEach(t => {
        topicCounts[t] = (topicCounts[t] || 0) + 1;
      });
    });
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    return { averageSentiment, dominantEmotions, moodTrend, topTopics };
  } catch (error) {
    logger.error('Failed to get mood trends', { error: (error as Error).message, userId });
    return {
      averageSentiment: 0,
      dominantEmotions: [],
      moodTrend: 'stable',
      topTopics: [],
    };
  }
}

/**
 * Get adaptive response tone based on mood
 */
export function getAdaptiveTone(currentMood: MoodEntry | null, trends: ReturnType<typeof getMoodTrends> extends Promise<infer T> ? T : never): {
  toneAdjustment: string;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  let toneAdjustment = '';

  if (!currentMood) {
    return { toneAdjustment: '', suggestions: [] };
  }

  // Adjust based on current sentiment
  if (currentMood.sentiment === 'very_negative' || currentMood.sentiment === 'negative') {
    toneAdjustment = 'Be extra supportive and empathetic. Acknowledge their feelings. Offer gentle encouragement.';

    if (currentMood.emotions.includes('sadness')) {
      suggestions.push('Consider checking in about their wellbeing');
    }
    if (currentMood.emotions.includes('anger')) {
      suggestions.push('Allow them to vent, validate frustration');
    }
    if (currentMood.emotions.includes('fear')) {
      suggestions.push('Provide reassurance and practical support');
    }
  } else if (currentMood.sentiment === 'positive' || currentMood.sentiment === 'very_positive') {
    toneAdjustment = 'Match their positive energy. Be enthusiastic and encouraging.';

    if (currentMood.emotions.includes('joy')) {
      suggestions.push('Celebrate their wins with them');
    }
  }

  // Adjust based on energy level
  if (currentMood.energyLevel === 'low') {
    toneAdjustment += ' Keep responses concise and low-pressure.';
  } else if (currentMood.energyLevel === 'high') {
    toneAdjustment += ' Can engage in longer, more dynamic conversation.';
  }

  // Adjust based on trends
  if (trends.moodTrend === 'declining') {
    suggestions.push('Monitor for signs of persistent low mood');
  }

  return { toneAdjustment, suggestions };
}

/**
 * Format mood context for prompt
 */
export function formatMoodForPrompt(
  currentMood: MoodEntry | null,
  trends: Awaited<ReturnType<typeof getMoodTrends>>
): string {
  if (!currentMood && !trends.dominantEmotions.length) return '';

  const parts: string[] = ['[Emotional Context]'];

  if (currentMood) {
    parts.push(`Current mood: ${currentMood.sentiment} (${currentMood.sentimentScore.toFixed(2)})`);
    if (currentMood.emotions.length > 0) {
      parts.push(`Detected emotions: ${currentMood.emotions.join(', ')}`);
    }
    if (currentMood.energyLevel) {
      parts.push(`Energy level: ${currentMood.energyLevel}`);
    }
  }

  if (trends.moodTrend !== 'stable') {
    parts.push(`Recent trend: ${trends.moodTrend}`);
  }

  const { toneAdjustment } = getAdaptiveTone(currentMood, trends);
  if (toneAdjustment) {
    parts.push(`\nTone guidance: ${toneAdjustment}`);
  }

  return parts.join('\n');
}

/**
 * Process message for mood and store
 */
export async function processMoodFromMessage(
  userId: string,
  sessionId: string,
  message: string
): Promise<MoodEntry | null> {
  // Only analyze messages with enough content
  if (message.length < 20) return null;

  const mood = await analyzeMood(message, userId);
  if (!mood) return null;

  await storeMoodEntry(userId, sessionId, mood);

  return {
    id: '',
    sessionId,
    ...mood,
    detectedAt: new Date(),
  };
}

export default {
  analyzeMood,
  storeMoodEntry,
  getMoodHistory,
  getMoodTrends,
  getAdaptiveTone,
  formatMoodForPrompt,
  processMoodFromMessage,
};
