/**
 * Activity Service
 *
 * Provides real-time activity logging with database persistence
 * and SSE broadcasting for the Activity Window.
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export type ActivityCategory =
  | 'llm_call'      // LLM requests/responses
  | 'tool_invoke'   // Tool/function calls
  | 'memory_op'     // Memory read/write operations
  | 'state_event'   // State changes (topic, mood, etc.)
  | 'error'         // Errors and exceptions
  | 'background'    // Background jobs, scheduled tasks
  | 'system';       // System events

export type ActivityLevel = 'info' | 'success' | 'warn' | 'error';

export interface ActivityLogInput {
  userId: string;
  sessionId?: string;
  turnId?: string;
  category: ActivityCategory;
  eventType: string;
  level?: ActivityLevel;
  title: string;
  message?: string;
  details?: Record<string, unknown>;
  source?: string;
  durationMs?: number;
}

export interface ActivityLog {
  id: string;
  userId: string;
  sessionId?: string;
  turnId?: string;
  category: ActivityCategory;
  eventType: string;
  level: ActivityLevel;
  title: string;
  message?: string;
  details?: Record<string, unknown>;
  source?: string;
  durationMs?: number;
  createdAt: Date;
}

export interface ActivityQueryOptions {
  limit?: number;
  category?: ActivityCategory;
  level?: ActivityLevel;
  after?: Date;
  before?: Date;
}

// ============================================
// SSE Broadcasting (imported lazily to avoid circular deps)
// ============================================

let broadcastActivity: ((userId: string, activity: ActivityLog) => void) | null = null;

export function setBroadcastFunction(fn: (userId: string, activity: ActivityLog) => void): void {
  broadcastActivity = fn;
}

// ============================================
// Core Functions
// ============================================

/**
 * Log an activity to the database
 */
export async function logActivity(input: ActivityLogInput): Promise<ActivityLog> {
  const {
    userId,
    sessionId,
    turnId,
    category,
    eventType,
    level = 'info',
    title,
    message,
    details,
    source,
    durationMs,
  } = input;

  try {
    const result = await pool.query<ActivityLog>(
      `INSERT INTO activity_logs (
        user_id, session_id, turn_id,
        category, event_type, level,
        title, message, details,
        source, duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING
        id, user_id as "userId", session_id as "sessionId", turn_id as "turnId",
        category, event_type as "eventType", level,
        title, message, details,
        source, duration_ms as "durationMs", created_at as "createdAt"`,
      [
        userId,
        sessionId || null,
        turnId || null,
        category,
        eventType,
        level,
        title,
        message || null,
        details ? JSON.stringify(details) : null,
        source || null,
        durationMs || null,
      ]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to log activity', {
      error: (error as Error).message,
      category,
      eventType,
    });
    throw error;
  }
}

/**
 * Log activity and broadcast via SSE
 */
export async function logActivityAndBroadcast(input: ActivityLogInput): Promise<ActivityLog> {
  const activity = await logActivity(input);

  // Broadcast to user's SSE subscribers
  if (broadcastActivity) {
    try {
      logger.info('Broadcasting activity to SSE', {
        userId: input.userId,
        activityId: activity.id,
        category: activity.category,
      });
      broadcastActivity(input.userId, activity);
    } catch (error) {
      logger.warn('Failed to broadcast activity', {
        error: (error as Error).message,
        activityId: activity.id,
      });
    }
  } else {
    logger.warn('Broadcast function not set, cannot push activity');
  }

  return activity;
}

/**
 * Get recent activity for a user
 */
export async function getRecentActivity(
  userId: string,
  options: ActivityQueryOptions = {}
): Promise<ActivityLog[]> {
  const { limit = 50, category, level, after, before } = options;

  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (category) {
    conditions.push(`category = $${paramIndex++}`);
    params.push(category);
  }

  if (level) {
    conditions.push(`level = $${paramIndex++}`);
    params.push(level);
  }

  if (after) {
    conditions.push(`created_at > $${paramIndex++}`);
    params.push(after);
  }

  if (before) {
    conditions.push(`created_at < $${paramIndex++}`);
    params.push(before);
  }

  params.push(limit);

  const result = await pool.query<ActivityLog>(
    `SELECT
      id, user_id as "userId", session_id as "sessionId", turn_id as "turnId",
      category, event_type as "eventType", level,
      title, message, details,
      source, duration_ms as "durationMs", created_at as "createdAt"
    FROM activity_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramIndex}`,
    params
  );

  return result.rows;
}

/**
 * Get activity for a specific session
 */
export async function getSessionActivity(
  sessionId: string,
  limit: number = 100
): Promise<ActivityLog[]> {
  const result = await pool.query<ActivityLog>(
    `SELECT
      id, user_id as "userId", session_id as "sessionId", turn_id as "turnId",
      category, event_type as "eventType", level,
      title, message, details,
      source, duration_ms as "durationMs", created_at as "createdAt"
    FROM activity_logs
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [sessionId, limit]
  );

  return result.rows;
}

/**
 * Get archived activity
 */
export async function getArchivedActivity(
  userId: string,
  options: { startDate?: Date; endDate?: Date; limit?: number } = {}
): Promise<ActivityLog[]> {
  const { startDate, endDate, limit = 100 } = options;

  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(endDate);
  }

  params.push(limit);

  const result = await pool.query<ActivityLog>(
    `SELECT
      id, user_id as "userId", session_id as "sessionId", turn_id as "turnId",
      category, event_type as "eventType", level,
      title, message, details,
      source, duration_ms as "durationMs", created_at as "createdAt"
    FROM activity_archive
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramIndex}`,
    params
  );

  return result.rows;
}

/**
 * Clear user's activity logs
 */
export async function clearUserLogs(userId: string): Promise<void> {
  await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [userId]);
}

/**
 * Archive old activity logs (called by scheduled job)
 */
export async function archiveOldLogs(daysToKeep: number = 7): Promise<number> {
  const result = await pool.query<{ archive_old_activity_logs: number }>(
    'SELECT archive_old_activity_logs($1)',
    [daysToKeep]
  );
  return result.rows[0]?.archive_old_activity_logs || 0;
}

/**
 * Cleanup old archives (called by scheduled job)
 */
export async function cleanupOldArchives(daysToKeep: number = 90): Promise<number> {
  const result = await pool.query<{ cleanup_old_archives: number }>(
    'SELECT cleanup_old_archives($1)',
    [daysToKeep]
  );
  return result.rows[0]?.cleanup_old_archives || 0;
}

// ============================================
// Helper Functions for Common Activity Types
// ============================================

export const activityHelpers = {
  /**
   * Log an LLM call activity
   */
  logLLMCall: async (
    userId: string,
    sessionId: string | undefined,
    turnId: string | undefined,
    nodeName: string,
    model: string,
    provider: string,
    tokens: { input: number; output: number; cache?: number },
    durationMs: number,
    cost?: number,
    reasoning?: string
  ): Promise<ActivityLog> => {
    return logActivityAndBroadcast({
      userId,
      sessionId,
      turnId,
      category: 'llm_call',
      eventType: `node_${nodeName}_complete`,
      level: 'success',
      title: `${nodeName} complete`,
      message: `${model} - ${tokens.input + tokens.output} tokens`,
      details: {
        nodeName,
        model,
        provider,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheTokens: tokens.cache || 0,
        totalTokens: tokens.input + tokens.output,
        cost,
        reasoning: reasoning ? reasoning.substring(0, 200) : undefined,
      },
      source: 'layered-agent',
      durationMs,
    });
  },

  /**
   * Log a tool invocation
   */
  logToolInvocation: async (
    userId: string,
    sessionId: string | undefined,
    toolName: string,
    args: Record<string, unknown>,
    success: boolean,
    durationMs?: number,
    resultPreview?: string
  ): Promise<ActivityLog> => {
    return logActivityAndBroadcast({
      userId,
      sessionId,
      category: 'tool_invoke',
      eventType: `tool_${toolName}`,
      level: success ? 'success' : 'error',
      title: `Tool: ${toolName}`,
      message: success ? resultPreview : 'Tool invocation failed',
      details: {
        toolName,
        args,
        success,
      },
      source: 'chat-service',
      durationMs,
    });
  },

  /**
   * Log a memory operation
   */
  logMemoryOperation: async (
    userId: string,
    sessionId: string | undefined,
    operation: 'store' | 'retrieve' | 'summarize',
    details: Record<string, unknown>
  ): Promise<ActivityLog> => {
    return logActivityAndBroadcast({
      userId,
      sessionId,
      category: 'memory_op',
      eventType: `memory_${operation}`,
      level: 'info',
      title: `Memory ${operation}`,
      details,
      source: 'memory-service',
    });
  },

  /**
   * Log a state event
   */
  logStateEvent: async (
    userId: string,
    sessionId: string,
    eventType: string,
    value: string
  ): Promise<ActivityLog> => {
    return logActivityAndBroadcast({
      userId,
      sessionId,
      category: 'state_event',
      eventType,
      level: 'info',
      title: `State: ${eventType}`,
      message: value,
      source: 'layered-agent',
    });
  },

  /**
   * Log an error
   */
  logError: async (
    userId: string,
    sessionId: string | undefined,
    error: Error,
    context: Record<string, unknown>
  ): Promise<ActivityLog> => {
    return logActivityAndBroadcast({
      userId,
      sessionId,
      category: 'error',
      eventType: 'error_occurred',
      level: 'error',
      title: 'Error',
      message: error.message,
      details: {
        ...context,
        stack: error.stack?.split('\n').slice(0, 5),
      },
      source: context.source as string || 'unknown',
    });
  },

  /**
   * Log a background job
   */
  logBackgroundJob: async (
    userId: string,
    jobName: string,
    status: 'started' | 'completed' | 'failed',
    details?: Record<string, unknown>
  ): Promise<ActivityLog> => {
    return logActivityAndBroadcast({
      userId,
      category: 'background',
      eventType: `job_${jobName}_${status}`,
      level: status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info',
      title: `Job: ${jobName}`,
      message: status,
      details,
      source: 'scheduler',
    });
  },
};

export default {
  logActivity,
  logActivityAndBroadcast,
  getRecentActivity,
  getSessionActivity,
  getArchivedActivity,
  clearUserLogs,
  archiveOldLogs,
  cleanupOldArchives,
  activityHelpers,
  setBroadcastFunction,
};
