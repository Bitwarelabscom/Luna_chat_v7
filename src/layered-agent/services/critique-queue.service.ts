/**
 * Background Critique Queue Service
 *
 * Uses BullMQ for persistent job processing.
 * Queues every message for background critique AFTER response is sent.
 */

import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../../config/index.js';
import { supervisorNode } from '../nodes/supervisor.node.js';
import { activityHelpers, logActivityAndBroadcast } from '../../activity/activity.service.js';
import { pool } from '../../db/index.js';
import { getIdentity } from '../stores/identity.store.js';
import logger from '../../utils/logger.js';

// ============================================
// Types
// ============================================

export interface CritiqueJobData {
  turnId: string;
  sessionId: string;
  userId: string;
  userInput: string;
  draft: string;
  plan: string | null;
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna';
  identityId: string;
  identityVersion: number;
}

export interface CritiqueJobResult {
  approved: boolean;
  issues: string[];
  fixInstructions: string;
  severity: 'minor' | 'moderate' | 'serious';
  hintsGenerated: string[];
}

// ============================================
// Queue Configuration
// ============================================

const QUEUE_NAME = 'luna-critique';

let critiqueQueue: Queue<CritiqueJobData, CritiqueJobResult> | null = null;
let critiqueWorker: Worker<CritiqueJobData, CritiqueJobResult> | null = null;

// ============================================
// Issue to Hint Mapping
// ============================================

const ISSUE_TO_HINT: Record<string, { type: string; text: string }> = {
  'too verbose': { type: 'avoid_verbose', text: 'Keep responses concise and to the point' },
  verbose: { type: 'avoid_verbose', text: 'Keep responses concise and to the point' },
  chatbot: {
    type: 'avoid_chatbot',
    text: 'Avoid generic chatbot phrases like "How can I assist you today?"',
  },
  generic: { type: 'avoid_generic', text: 'Be specific and personalized, avoid generic responses' },
  robotic: { type: 'avoid_robotic', text: 'Sound natural and human, not robotic' },
  'em dash': { type: 'avoid_emdash', text: 'Never use em dash character' },
  markdown: { type: 'avoid_markdown_voice', text: 'No markdown formatting in voice mode' },
  'tool hallucination': {
    type: 'avoid_hallucination',
    text: 'Only reference tools/data that were actually provided',
  },
  'too long': { type: 'avoid_long_voice', text: 'Keep voice responses to 1-3 sentences' },
  repetitive: { type: 'avoid_repetition', text: 'Avoid repeating the same phrases or ideas' },
  formal: { type: 'avoid_formal', text: 'Use casual, friendly tone - not overly formal' },
};

// ============================================
// Redis Connection for BullMQ
// ============================================

// BullMQ requires maxRetriesPerRequest: null for its blocking operations
function createBullMQConnection(): Redis {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  });
}

// ============================================
// Initialize Queue
// ============================================

/**
 * Initialize the BullMQ queue and worker
 */
export function initializeCritiqueQueue(): void {
  if (critiqueQueue) {
    logger.warn('Critique queue already initialized');
    return;
  }

  // Create BullMQ-specific Redis connection
  const bullmqRedis = createBullMQConnection();

  // Create queue
  critiqueQueue = new Queue(QUEUE_NAME, {
    connection: bullmqRedis,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 1000,
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    },
  });

  // Create worker with its own connection
  critiqueWorker = new Worker<CritiqueJobData, CritiqueJobResult>(
    QUEUE_NAME,
    processCritiqueJob,
    {
      connection: createBullMQConnection(),
      concurrency: 3, // Process 3 critiques in parallel
      limiter: {
        max: 10, // Max 10 jobs per minute
        duration: 60000,
      },
    }
  );

  critiqueWorker.on('completed', (job, result) => {
    logger.debug('Critique job completed', {
      jobId: job.id,
      turnId: job.data.turnId,
      approved: result.approved,
    });
  });

  critiqueWorker.on('failed', (job, err) => {
    logger.error('Critique job failed', {
      jobId: job?.id,
      turnId: job?.data.turnId,
      error: err.message,
    });
  });

  logger.info('Critique queue initialized', { queueName: QUEUE_NAME });
}

// ============================================
// Queue Operations
// ============================================

/**
 * Queue a turn for background critique
 */
export async function queueForCritique(data: CritiqueJobData): Promise<void> {
  if (!critiqueQueue) {
    logger.warn('Critique queue not initialized, skipping');
    return;
  }

  try {
    // Log queue entry
    await pool.query(
      `INSERT INTO critique_queue_log (turn_id, session_id, user_id, status)
       VALUES ($1, $2, $3, 'queued')`,
      [data.turnId, data.sessionId, data.userId]
    );

    await critiqueQueue.add('critique', data, {
      jobId: data.turnId, // Use turn ID as job ID for deduplication
    });

    logger.debug('Turn queued for background critique', {
      turnId: data.turnId,
      sessionId: data.sessionId,
    });
  } catch (error) {
    logger.error('Failed to queue critique job', {
      error: (error as Error).message,
      turnId: data.turnId,
    });
  }
}

// ============================================
// Job Processing
// ============================================

/**
 * Process a critique job
 */
async function processCritiqueJob(
  job: Job<CritiqueJobData, CritiqueJobResult>
): Promise<CritiqueJobResult> {
  const { turnId, sessionId, userId, userInput, draft, plan, mode, identityId, identityVersion } =
    job.data;
  const startTime = Date.now();

  logger.debug('Processing critique job', { turnId, sessionId });

  // Update status to processing
  await pool.query(`UPDATE critique_queue_log SET status = 'processing' WHERE turn_id = $1`, [
    turnId,
  ]);

  try {
    // Load identity
    const identity = await getIdentity(identityId, identityVersion);
    if (!identity) {
      throw new Error(`Identity not found: ${identityId}@${identityVersion}`);
    }

    // Build minimal state for supervisor
    const state = {
      session_id: sessionId,
      turn_id: turnId,
      user_input: userInput,
      mode,
      identity,
      agent_view: {
        current_topic: null,
        current_mood: null,
        active_task: null,
        active_plan: null,
        interaction_count: 0,
      },
      relevant_memories: [],
      plan,
      draft,
      critique_issues: [] as string[],
      attempts: 0,
      final_output: null,
      started_at: new Date(),
    };

    // Run supervisor critique
    const result = await supervisorNode({ state, userId });
    const approved = result.verdict.approved;
    const issues = result.verdict.issues;
    const fixInstructions = result.verdict.fix_instructions;

    // Determine severity
    let severity: 'minor' | 'moderate' | 'serious' = 'minor';
    if (issues.length >= 3) severity = 'serious';
    else if (issues.length >= 1) severity = 'moderate';

    // Generate hints from issues
    const hintsGenerated = await generateHintsFromIssues(sessionId, userId, issues);

    // If not approved, create pending correction
    if (!approved && issues.length > 0) {
      await createPendingCorrection(sessionId, turnId, severity, issues, fixInstructions, draft);
    }

    // Log activity
    await activityHelpers.logBackgroundJob(userId, 'Response Review', 'completed', {
      approved,
      issueCount: issues.length,
      severity,
      hintsGenerated: hintsGenerated.length,
    });

    // Broadcast "Luna reviewed her response" activity
    await broadcastReflectionActivity(userId, sessionId, turnId, approved, issues.length);

    // Update queue log
    const processingTimeMs = Date.now() - startTime;
    await pool.query(
      `UPDATE critique_queue_log
       SET status = 'completed', result = $1, processing_time_ms = $2, completed_at = NOW()
       WHERE turn_id = $3`,
      [JSON.stringify({ approved, issues, severity }), processingTimeMs, turnId]
    );

    return {
      approved,
      issues,
      fixInstructions,
      severity,
      hintsGenerated,
    };
  } catch (error) {
    await pool.query(`UPDATE critique_queue_log SET status = 'failed', result = $1 WHERE turn_id = $2`, [
      JSON.stringify({ error: (error as Error).message }),
      turnId,
    ]);
    throw error;
  }
}

// ============================================
// Hint Generation
// ============================================

/**
 * Generate hints from critique issues
 */
async function generateHintsFromIssues(
  sessionId: string,
  userId: string,
  issues: string[]
): Promise<string[]> {
  const hints: string[] = [];

  for (const issue of issues) {
    const lowerIssue = issue.toLowerCase();

    for (const [keyword, hint] of Object.entries(ISSUE_TO_HINT)) {
      if (lowerIssue.includes(keyword)) {
        hints.push(hint.type);

        try {
          // Add session hint
          await pool.query(
            `INSERT INTO session_critique_hints (session_id, hint_type, hint_text, weight)
             VALUES ($1, $2, $3, 1.0)
             ON CONFLICT DO NOTHING`,
            [sessionId, hint.type, hint.text]
          );

          // Upsert user hint with weight bump
          await pool.query(
            `INSERT INTO user_critique_hints (user_id, hint_type, hint_text, occurrence_count, last_seen, weight)
             VALUES ($1, $2, $3, 1, NOW(), 1.0)
             ON CONFLICT (user_id, hint_type) DO UPDATE SET
               occurrence_count = user_critique_hints.occurrence_count + 1,
               last_seen = NOW(),
               weight = LEAST(2.0, user_critique_hints.weight + 0.2)`,
            [userId, hint.type, hint.text]
          );
        } catch (err) {
          logger.warn('Failed to save hint', {
            error: (err as Error).message,
            hintType: hint.type,
          });
        }

        break; // One hint per issue
      }
    }
  }

  return hints;
}

// ============================================
// Pending Corrections
// ============================================

/**
 * Create a pending correction record
 */
async function createPendingCorrection(
  sessionId: string,
  turnId: string,
  severity: string,
  issues: string[],
  fixInstructions: string,
  originalResponse: string
): Promise<void> {
  await pool.query(
    `INSERT INTO pending_corrections (session_id, turn_id, severity, issues, fix_instructions, original_response)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, turnId, severity, JSON.stringify(issues), fixInstructions, originalResponse]
  );
}

// ============================================
// Activity Broadcasting
// ============================================

/**
 * Broadcast reflection activity to UI
 */
async function broadcastReflectionActivity(
  userId: string,
  sessionId: string,
  turnId: string,
  approved: boolean,
  issueCount: number
): Promise<void> {
  const title = approved
    ? 'Luna reviewed her response'
    : `Luna found ${issueCount} issue${issueCount > 1 ? 's' : ''} to improve`;

  await logActivityAndBroadcast({
    userId,
    sessionId,
    turnId,
    category: 'background',
    eventType: 'response_review',
    level: approved ? 'success' : 'warn',
    title,
    message: approved ? 'Response quality verified' : 'Self-correction pending',
    details: { approved, issueCount },
    source: 'critique-queue',
  });
}

// ============================================
// Queue Status & Management
// ============================================

/**
 * Get queue status
 */
export async function getCritiqueQueueStatus(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  if (!critiqueQueue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }

  const [waiting, active, completed, failed] = await Promise.all([
    critiqueQueue.getWaitingCount(),
    critiqueQueue.getActiveCount(),
    critiqueQueue.getCompletedCount(),
    critiqueQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}

/**
 * Shutdown queue gracefully
 */
export async function shutdownCritiqueQueue(): Promise<void> {
  if (critiqueWorker) {
    await critiqueWorker.close();
    critiqueWorker = null;
  }
  if (critiqueQueue) {
    await critiqueQueue.close();
    critiqueQueue = null;
  }
  logger.info('Critique queue shutdown complete');
}

/**
 * Check if queue is initialized
 */
export function isQueueInitialized(): boolean {
  return critiqueQueue !== null && critiqueWorker !== null;
}

export default {
  initializeCritiqueQueue,
  queueForCritique,
  getCritiqueQueueStatus,
  shutdownCritiqueQueue,
  isQueueInitialized,
};
