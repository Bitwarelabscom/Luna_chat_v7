import { pool } from '../db/index.js';
import { generateEmbedding } from './embedding.service.js';
import * as preferenceQueue from '../jobs/preference-queue.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface UserPreference {
  id: string;
  type: string;
  value: Record<string, unknown>;
  confidence: number;
  learnedFromCount: number;
}

export interface TopicInterest {
  topic: string;
  interestScore: number;
  engagementCount: number;
  lastEngaged: Date;
}

export interface StylePreference {
  dimension: string;
  level: number; // 0.0 to 1.0
  positiveExamples: string[];
  negativeExamples: string[];
}

export interface ResponseGuidelines {
  verbosity: string; // concise, moderate, detailed
  technicality: string; // simple, moderate, technical
  warmth: string; // professional, warm, very_warm
  directness: string; // direct, balanced, gentle
  encouragement: string; // minimal, moderate, high
  topInterests: string[];
  avoidTopics: string[];
  customInstructions: string[];
}

// ============================================
// Preference Learning Functions
// ============================================

/**
 * Learn preferences from a conversation exchange
 * Queues the job for background processing with Ollama
 */
export async function learnFromConversation(
  userId: string,
  sessionId: string,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  // Only analyze if we have enough context
  if (messages.length < 2) return;

  // Queue for background processing - does not block
  preferenceQueue.enqueue(userId, sessionId, messages);
  logger.debug('Queued preference extraction', { userId, sessionId, messageCount: messages.length });
}

/**
 * Learn from explicit user feedback/corrections
 */
export async function learnFromFeedback(
  userId: string,
  sessionId: string,
  feedbackType: 'correction' | 'praise' | 'elaboration_request' | 'shorter_request',
  content: string,
  originalResponse?: string
): Promise<void> {
  try {
    await recordFeedbackSignal(userId, sessionId, feedbackType, content);

    // Adjust style preferences based on feedback
    switch (feedbackType) {
      case 'shorter_request':
        await updateStylePreference(userId, 'verbosity', -0.1);
        if (originalResponse) {
          await addStyleExample(userId, 'verbosity', originalResponse, false);
        }
        break;
      case 'elaboration_request':
        await updateStylePreference(userId, 'verbosity', 0.1);
        break;
      case 'correction':
        // Parse what kind of correction it is
        if (content.toLowerCase().includes('simpl') || content.toLowerCase().includes('technical')) {
          await updateStylePreference(userId, 'technicality', -0.1);
        }
        break;
      case 'praise':
        // Positive reinforcement - current style is working
        logger.debug('Recorded positive feedback', { userId, feedbackType });
        break;
    }
  } catch (error) {
    logger.error('Failed to learn from feedback', {
      error: (error as Error).message,
      userId
    });
  }
}

/**
 * Record a feedback signal for future analysis
 */
async function recordFeedbackSignal(
  userId: string,
  sessionId: string,
  signalType: string,
  content: string
): Promise<void> {
  await pool.query(
    `INSERT INTO user_feedback_signals (user_id, session_id, signal_type, signal_content)
     VALUES ($1, $2, $3, $4)`,
    [userId, sessionId, signalType, content]
  );
}

/**
 * Update a style preference with incremental learning
 */
async function updateStylePreference(
  userId: string,
  dimension: string,
  delta: number
): Promise<void> {
  // Clamp delta to reasonable range
  delta = Math.max(-0.2, Math.min(0.2, delta));

  await pool.query(
    `INSERT INTO response_style_preferences (user_id, style_dimension, preferred_level)
     VALUES ($1, $2, 0.5 + $3)
     ON CONFLICT (user_id, style_dimension) DO UPDATE SET
       preferred_level = LEAST(1.0, GREATEST(0.0,
         response_style_preferences.preferred_level + $3
       )),
       updated_at = NOW()`,
    [userId, dimension, delta]
  );
}

/**
 * Add an example of good or bad response style
 */
async function addStyleExample(
  userId: string,
  dimension: string,
  example: string,
  isPositive: boolean
): Promise<void> {
  const column = isPositive ? 'positive_examples' : 'negative_examples';
  const truncatedExample = example.substring(0, 500); // Limit example length

  await pool.query(
    `INSERT INTO response_style_preferences (user_id, style_dimension, ${column})
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, style_dimension) DO UPDATE SET
       ${column} = (
         SELECT jsonb_agg(elem)
         FROM (
           SELECT elem FROM jsonb_array_elements(response_style_preferences.${column}) elem
           UNION ALL
           SELECT $4::jsonb
           LIMIT 10
         ) sub
       ),
       updated_at = NOW()`,
    [userId, dimension, JSON.stringify([truncatedExample]), JSON.stringify(truncatedExample)]
  );
}

/**
 * Track topic engagement (interest score adjustment)
 */
export async function trackTopicEngagement(
  userId: string,
  topic: string,
  delta: number = 0.1
): Promise<void> {
  try {
    // Generate embedding for topic
    const { embedding } = await generateEmbedding(topic);
    const vectorString = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO user_topic_interests (user_id, topic, interest_score, embedding)
       VALUES ($1, $2, 0.5 + $3, $4::vector)
       ON CONFLICT (user_id, topic) DO UPDATE SET
         interest_score = LEAST(1.0, GREATEST(0.0,
           user_topic_interests.interest_score + $3
         )),
         engagement_count = user_topic_interests.engagement_count + 1,
         last_engaged = NOW(),
         updated_at = NOW()`,
      [userId, topic, delta, vectorString]
    );
  } catch (error) {
    logger.error('Failed to track topic engagement', {
      error: (error as Error).message,
      userId,
      topic
    });
  }
}

// ============================================
// Preference Retrieval Functions
// ============================================

/**
 * Get user's style preferences
 */
export async function getStylePreferences(userId: string): Promise<StylePreference[]> {
  try {
    const result = await pool.query(
      `SELECT style_dimension, preferred_level, positive_examples, negative_examples
       FROM response_style_preferences
       WHERE user_id = $1`,
      [userId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      dimension: row.style_dimension as string,
      level: parseFloat(row.preferred_level as string),
      positiveExamples: (row.positive_examples as string[]) || [],
      negativeExamples: (row.negative_examples as string[]) || [],
    }));
  } catch (error) {
    logger.error('Failed to get style preferences', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Get user's topic interests
 */
export async function getTopicInterests(
  userId: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<TopicInterest[]> {
  const { limit = 20, minScore = 0.3 } = options;

  try {
    const result = await pool.query(
      `SELECT topic, interest_score, engagement_count, last_engaged
       FROM user_topic_interests
       WHERE user_id = $1 AND interest_score >= $2
       ORDER BY interest_score DESC, engagement_count DESC
       LIMIT $3`,
      [userId, minScore, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      topic: row.topic as string,
      interestScore: parseFloat(row.interest_score as string),
      engagementCount: row.engagement_count as number,
      lastEngaged: row.last_engaged as Date,
    }));
  } catch (error) {
    logger.error('Failed to get topic interests', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Find topics similar to a query
 */
export async function findSimilarTopics(
  userId: string,
  query: string,
  limit: number = 5
): Promise<TopicInterest[]> {
  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    const result = await pool.query(
      `SELECT topic, interest_score, engagement_count, last_engaged,
              1 - (embedding <=> $1::vector) as similarity
       FROM user_topic_interests
       WHERE user_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorString, userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      topic: row.topic as string,
      interestScore: parseFloat(row.interest_score as string),
      engagementCount: row.engagement_count as number,
      lastEngaged: row.last_engaged as Date,
    }));
  } catch (error) {
    logger.error('Failed to find similar topics', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Get comprehensive response guidelines for a user
 */
export async function getResponseGuidelines(userId: string): Promise<ResponseGuidelines> {
  const stylePrefs = await getStylePreferences(userId);
  const topicInterests = await getTopicInterests(userId, { limit: 10, minScore: 0.6 });

  // Convert style preferences to descriptive guidelines
  const guidelines: ResponseGuidelines = {
    verbosity: 'moderate',
    technicality: 'moderate',
    warmth: 'warm',
    directness: 'balanced',
    encouragement: 'moderate',
    topInterests: topicInterests.filter(t => t.interestScore >= 0.6).map(t => t.topic),
    avoidTopics: topicInterests.filter(t => t.interestScore < 0.3).map(t => t.topic),
    customInstructions: [],
  };

  for (const pref of stylePrefs) {
    const level = pref.level;
    switch (pref.dimension) {
      case 'verbosity':
        guidelines.verbosity = level < 0.35 ? 'concise' : level > 0.65 ? 'detailed' : 'moderate';
        break;
      case 'technicality':
        guidelines.technicality = level < 0.35 ? 'simple' : level > 0.65 ? 'technical' : 'moderate';
        break;
      case 'warmth':
        guidelines.warmth = level < 0.35 ? 'professional' : level > 0.65 ? 'very_warm' : 'warm';
        break;
      case 'directness':
        guidelines.directness = level < 0.35 ? 'gentle' : level > 0.65 ? 'direct' : 'balanced';
        break;
      case 'encouragement':
        guidelines.encouragement = level < 0.35 ? 'minimal' : level > 0.65 ? 'high' : 'moderate';
        break;
    }
  }

  return guidelines;
}

/**
 * Format response guidelines for inclusion in system prompt
 */
export function formatGuidelinesForPrompt(guidelines: ResponseGuidelines): string {
  const parts: string[] = [];

  parts.push('[Personalization Preferences]');
  parts.push(`Response Style:`);
  parts.push(`  - Length: ${guidelines.verbosity} (${
    guidelines.verbosity === 'concise' ? 'keep responses brief and to the point' :
    guidelines.verbosity === 'detailed' ? 'provide thorough explanations with context' :
    'balance brevity with clarity'
  })`);
  parts.push(`  - Technical Level: ${guidelines.technicality} (${
    guidelines.technicality === 'simple' ? 'avoid jargon, explain concepts simply' :
    guidelines.technicality === 'technical' ? 'use appropriate technical terminology' :
    'adjust based on topic complexity'
  })`);
  parts.push(`  - Tone: ${guidelines.warmth} (${
    guidelines.warmth === 'professional' ? 'maintain professional distance' :
    guidelines.warmth === 'very_warm' ? 'be extra supportive and encouraging' :
    'be friendly and approachable'
  })`);
  parts.push(`  - Communication: ${guidelines.directness} (${
    guidelines.directness === 'gentle' ? 'soften feedback, focus on positives' :
    guidelines.directness === 'direct' ? 'be straightforward and clear' :
    'balance honesty with sensitivity'
  })`);

  if (guidelines.topInterests.length > 0) {
    parts.push(`\nKnown Interests: ${guidelines.topInterests.join(', ')}`);
  }

  if (guidelines.customInstructions.length > 0) {
    parts.push(`\nSpecial Instructions:`);
    for (const instruction of guidelines.customInstructions) {
      parts.push(`  - ${instruction}`);
    }
  }

  return parts.join('\n');
}

/**
 * Detect if a message contains feedback signals
 */
export function detectFeedbackSignals(message: string): {
  type: 'correction' | 'praise' | 'elaboration_request' | 'shorter_request' | null;
  confidence: number;
} {
  const lowerMessage = message.toLowerCase();

  // Check for shorter request
  if (
    lowerMessage.includes('shorter') ||
    lowerMessage.includes('brief') ||
    lowerMessage.includes('concise') ||
    lowerMessage.includes('too long') ||
    lowerMessage.includes('tl;dr')
  ) {
    return { type: 'shorter_request', confidence: 0.8 };
  }

  // Check for elaboration request
  if (
    lowerMessage.includes('explain more') ||
    lowerMessage.includes('more detail') ||
    lowerMessage.includes('elaborate') ||
    lowerMessage.includes('can you expand') ||
    lowerMessage.includes('tell me more')
  ) {
    return { type: 'elaboration_request', confidence: 0.8 };
  }

  // Check for corrections
  if (
    lowerMessage.includes('too technical') ||
    lowerMessage.includes('too simple') ||
    lowerMessage.includes('not what i meant') ||
    lowerMessage.includes('that\'s not right') ||
    lowerMessage.includes('actually')
  ) {
    return { type: 'correction', confidence: 0.6 };
  }

  // Check for praise
  if (
    lowerMessage.includes('perfect') ||
    lowerMessage.includes('exactly') ||
    lowerMessage.includes('great answer') ||
    lowerMessage.includes('thanks') ||
    lowerMessage.includes('helpful')
  ) {
    return { type: 'praise', confidence: 0.5 };
  }

  return { type: null, confidence: 0 };
}

// Re-export queue status for monitoring
export const getPreferenceQueueStatus = preferenceQueue.getQueueStatus;

export default {
  learnFromConversation,
  learnFromFeedback,
  trackTopicEngagement,
  getStylePreferences,
  getTopicInterests,
  findSimilarTopics,
  getResponseGuidelines,
  formatGuidelinesForPrompt,
  detectFeedbackSignals,
  getPreferenceQueueStatus,
};
