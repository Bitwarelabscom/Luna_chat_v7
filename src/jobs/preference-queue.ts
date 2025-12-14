import { config } from '../config/index.js';
import { pool } from '../db/index.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

interface PreferenceJob {
  id: string;
  userId: string;
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: Date;
}

interface ExtractedPreferences {
  feedbackSignals: Array<{ type: string; content: string }>;
  styleIndicators: {
    verbosity?: number;
    technicality?: number;
    warmth?: number;
    directness?: number;
  };
  engagedTopics: string[];
  avoidedTopics: string[];
}

// ============================================
// Queue State
// ============================================

const queue: PreferenceJob[] = [];
let isProcessing = false;
let processedCount = 0;
let errorCount = 0;

// Style dimensions we track
const STYLE_DIMENSIONS = ['verbosity', 'technicality', 'warmth', 'directness', 'encouragement'];

// Extraction prompt for Ollama
const PREFERENCE_EXTRACTION_PROMPT = `You are analyzing a conversation to detect user preferences and communication style.

Extract any implicit or explicit preferences from how the user communicates or responds.

Look for:
1. **Feedback signals**: When user says "shorter please", "can you explain more", "too technical", etc.
2. **Style indicators**: Formal vs casual language, emoji usage, detail level in their messages
3. **Topic engagement**: Topics they ask follow-up questions about vs topics they redirect from
4. **Response satisfaction**: Positive acknowledgments vs corrections

Output JSON:
{
  "feedbackSignals": [
    {"type": "correction|praise|elaboration_request|shorter_request", "content": "quote or description"}
  ],
  "styleIndicators": {
    "verbosity": 0.0-1.0,
    "technicality": 0.0-1.0,
    "warmth": 0.0-1.0,
    "directness": 0.0-1.0
  },
  "engagedTopics": ["topic1", "topic2"],
  "avoidedTopics": ["topic1"]
}

Return only valid JSON. If no preferences detected, return empty arrays/objects.`;

// ============================================
// Queue Operations
// ============================================

/**
 * Add a preference extraction job to the queue
 */
export function enqueue(
  userId: string,
  sessionId: string,
  messages: Array<{ role: string; content: string }>
): void {
  // Skip if we already have too many jobs queued
  if (queue.length >= 100) {
    logger.warn('Preference queue full, dropping job', { userId, queueSize: queue.length });
    return;
  }

  // Skip if we have a recent job for the same session
  const existingJob = queue.find(j => j.sessionId === sessionId);
  if (existingJob) {
    // Update existing job with newer messages
    existingJob.messages = messages;
    existingJob.createdAt = new Date();
    logger.debug('Updated existing preference job', { sessionId });
    return;
  }

  const job: PreferenceJob = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    sessionId,
    messages,
    createdAt: new Date(),
  };

  queue.push(job);
  logger.debug('Enqueued preference extraction job', {
    jobId: job.id,
    userId,
    sessionId,
    queueSize: queue.length
  });

  // Start processing if not already running
  if (!isProcessing) {
    processQueue();
  }
}

/**
 * Process the queue sequentially
 */
async function processQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  logger.debug('Starting preference queue processing', { queueSize: queue.length });

  while (queue.length > 0) {
    const job = queue.shift()!;

    try {
      await processJob(job);
      processedCount++;
    } catch (error) {
      errorCount++;
      logger.error('Preference extraction job failed', {
        jobId: job.id,
        userId: job.userId,
        error: (error as Error).message
      });
    }

    // Small delay between jobs to not overload Ollama
    if (queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  isProcessing = false;
  logger.debug('Preference queue processing complete');
}

/**
 * Process a single job using Ollama
 */
async function processJob(job: PreferenceJob): Promise<void> {
  const startTime = Date.now();

  // Format conversation for analysis
  const conversation = job.messages
    .slice(-10)
    .map(m => `${m.role === 'user' ? 'User' : 'Luna'}: ${m.content}`)
    .join('\n\n');

  // Call Ollama directly
  const response = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.chatModel,
      messages: [
        { role: 'system', content: PREFERENCE_EXTRACTION_PROMPT },
        { role: 'user', content: conversation },
      ],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 500,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status}`);
  }

  const data = await response.json() as {
    message?: { content: string };
  };

  const content = data.message?.content || '{}';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.debug('No JSON found in Ollama response', { jobId: job.id });
    return;
  }

  const jsonStr = jsonMatch[1] || jsonMatch[0];
  const extracted: ExtractedPreferences = JSON.parse(jsonStr);

  // Apply extracted preferences to database
  await applyPreferences(job.userId, job.sessionId, extracted);

  logger.debug('Preference extraction completed', {
    jobId: job.id,
    userId: job.userId,
    durationMs: Date.now() - startTime,
    feedbackSignals: extracted.feedbackSignals?.length || 0,
    engagedTopics: extracted.engagedTopics?.length || 0,
  });
}

/**
 * Apply extracted preferences to the database
 */
async function applyPreferences(
  userId: string,
  sessionId: string,
  extracted: ExtractedPreferences
): Promise<void> {
  // Record feedback signals
  if (extracted.feedbackSignals?.length > 0) {
    for (const signal of extracted.feedbackSignals) {
      if (signal.type && signal.content) {
        // Truncate signal_type to fit varchar(50) column
        const signalType = String(signal.type).substring(0, 50);
        await pool.query(
          `INSERT INTO user_feedback_signals (user_id, session_id, signal_type, signal_content)
           VALUES ($1, $2, $3, $4)`,
          [userId, sessionId, signalType, signal.content.substring(0, 500)]
        );
      }
    }
  }

  // Update style preferences
  if (extracted.styleIndicators) {
    for (const [dimension, level] of Object.entries(extracted.styleIndicators)) {
      if (typeof level === 'number' && STYLE_DIMENSIONS.includes(dimension)) {
        // Use smaller delta for gradual learning
        const delta = (level - 0.5) * 0.1;
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
    }
  }

  // Track topic engagement
  if (extracted.engagedTopics?.length > 0) {
    for (const topic of extracted.engagedTopics) {
      if (topic && typeof topic === 'string') {
        await trackTopicEngagement(userId, topic, 0.1);
      }
    }
  }

  if (extracted.avoidedTopics?.length > 0) {
    for (const topic of extracted.avoidedTopics) {
      if (topic && typeof topic === 'string') {
        await trackTopicEngagement(userId, topic, -0.1);
      }
    }
  }
}

/**
 * Track topic engagement with embedding
 */
async function trackTopicEngagement(
  userId: string,
  topic: string,
  delta: number
): Promise<void> {
  try {
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
// Status & Management
// ============================================

/**
 * Get queue status
 */
export function getQueueStatus(): {
  queueSize: number;
  isProcessing: boolean;
  processedCount: number;
  errorCount: number;
} {
  return {
    queueSize: queue.length,
    isProcessing,
    processedCount,
    errorCount,
  };
}

/**
 * Clear the queue (for testing/admin)
 */
export function clearQueue(): void {
  queue.length = 0;
  logger.info('Preference queue cleared');
}

export default {
  enqueue,
  getQueueStatus,
  clearQueue,
};
