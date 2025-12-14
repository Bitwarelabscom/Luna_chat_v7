/**
 * State Store - Event Sourcing
 *
 * Manages the append-only event log and computes
 * AgentView snapshots by replaying events.
 */

import { query, queryOne } from '../../db/postgres.js';
import {
  type StateEventInput,
  type StateEventRow,
  type AgentView,
  reduceEventsToView,
  AgentViewSchema,
} from '../schemas/events.js';
import type { AgentTurnLog, AgentTurnRow } from '../schemas/graph-state.js';
import logger from '../../utils/logger.js';

/**
 * Add events to the event log (append-only)
 */
export async function addEvents(
  sessionId: string,
  turnId: string | null,
  events: StateEventInput[]
): Promise<void> {
  if (events.length === 0) return;

  try {
    // Build bulk insert query
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const event of events) {
      placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      values.push(
        event.session_id,
        event.turn_id || turnId,
        event.event_type,
        event.event_value,
        event.meta ? JSON.stringify(event.meta) : null
      );
    }

    await query(
      `INSERT INTO state_events (session_id, turn_id, event_type, event_value, meta)
       VALUES ${placeholders.join(', ')}`,
      values
    );

    logger.debug('Added state events', {
      sessionId,
      turnId,
      count: events.length,
      types: events.map(e => e.event_type),
    });
  } catch (error) {
    logger.error('Failed to add state events', {
      sessionId,
      turnId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Get events for a session (ordered by timestamp)
 */
export async function getEvents(
  sessionId: string,
  options: {
    limit?: number;
    afterTs?: Date;
    eventType?: string;
  } = {}
): Promise<StateEventRow[]> {
  const { limit = 100, afterTs, eventType } = options;

  try {
    let sql = `
      SELECT event_id, session_id, turn_id, event_type, event_value, ts, meta
      FROM state_events
      WHERE session_id = $1
    `;
    const params: unknown[] = [sessionId];
    let paramIndex = 2;

    if (afterTs) {
      sql += ` AND ts > $${paramIndex++}`;
      params.push(afterTs);
    }

    if (eventType) {
      sql += ` AND event_type = $${paramIndex++}`;
      params.push(eventType);
    }

    sql += ` ORDER BY ts ASC LIMIT $${paramIndex}`;
    params.push(limit);

    const rows = await query<StateEventRow>(sql, params);
    return rows;
  } catch (error) {
    logger.error('Failed to get state events', {
      sessionId,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Get the current AgentView snapshot for a session
 * Computed by replaying all events through the reducer
 */
export async function getSnapshot(sessionId: string): Promise<AgentView> {
  try {
    // Get all events for the session
    const events = await getEvents(sessionId, { limit: 1000 });

    // Reduce events to current view
    const view = reduceEventsToView(events);

    return view;
  } catch (error) {
    logger.error('Failed to get state snapshot', {
      sessionId,
      error: (error as Error).message,
    });

    // Return empty view on error
    return AgentViewSchema.parse({
      current_topic: null,
      current_mood: null,
      active_task: null,
      active_plan: null,
      interaction_count: 0,
    });
  }
}

/**
 * Get snapshot using database function (more efficient for large event logs)
 */
export async function getSnapshotFast(sessionId: string): Promise<AgentView> {
  try {
    const row = await queryOne<{
      current_topic: string | null;
      current_mood: string | null;
      active_task: string | null;
      active_plan: string | null;
      interaction_count: number;
    }>(
      `SELECT * FROM compute_agent_view($1)`,
      [sessionId]
    );

    if (!row) {
      return {
        current_topic: null,
        current_mood: null,
        active_task: null,
        active_plan: null,
        interaction_count: 0,
      };
    }

    return {
      current_topic: row.current_topic,
      current_mood: row.current_mood,
      active_task: row.active_task,
      active_plan: row.active_plan,
      interaction_count: Number(row.interaction_count) || 0,
    };
  } catch (error) {
    // Fall back to JavaScript reducer if DB function fails
    logger.warn('Fast snapshot failed, falling back to reducer', {
      sessionId,
      error: (error as Error).message,
    });
    return getSnapshot(sessionId);
  }
}

/**
 * Log a completed turn for observability
 */
export async function logTurn(turnLog: AgentTurnLog): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_turns (
        turn_id, session_id, identity_id, identity_version,
        user_input, plan, draft, final_output,
        critique_passed, critique_issues, attempts, execution_time_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        turnLog.turn_id,
        turnLog.session_id,
        turnLog.identity_id,
        turnLog.identity_version,
        turnLog.user_input,
        turnLog.plan,
        turnLog.draft,
        turnLog.final_output,
        turnLog.critique_passed,
        JSON.stringify(turnLog.critique_issues),
        turnLog.attempts,
        turnLog.execution_time_ms || null,
      ]
    );

    logger.debug('Logged agent turn', {
      turnId: turnLog.turn_id,
      sessionId: turnLog.session_id,
      passed: turnLog.critique_passed,
      attempts: turnLog.attempts,
    });
  } catch (error) {
    logger.error('Failed to log agent turn', {
      turnId: turnLog.turn_id,
      error: (error as Error).message,
    });
    // Don't throw - logging is non-critical
  }
}

/**
 * Get recent turns for a session (for debugging)
 */
export async function getRecentTurns(
  sessionId: string,
  limit: number = 10
): Promise<AgentTurnRow[]> {
  try {
    const rows = await query<AgentTurnRow>(
      `SELECT *
       FROM agent_turns
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    return rows;
  } catch (error) {
    logger.error('Failed to get recent turns', {
      sessionId,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Get drift metrics for a date range
 */
export async function getDriftMetrics(
  startDate: Date,
  endDate: Date,
  identityId?: string
): Promise<Array<{
  day: Date;
  identityId: string;
  identityVersion: number;
  totalTurns: number;
  repairTurns: number;
  repairRatePct: number;
  avgAttempts: number;
  failedCritiques: number;
  avgExecutionTimeMs: number;
}>> {
  try {
    let sql = `
      SELECT
        day,
        identity_id,
        identity_version,
        total_turns,
        repair_turns,
        repair_rate_pct,
        avg_attempts,
        failed_critiques,
        avg_execution_time_ms
      FROM agent_drift_metrics
      WHERE day >= $1 AND day <= $2
    `;
    const params: unknown[] = [startDate, endDate];

    if (identityId) {
      sql += ` AND identity_id = $3`;
      params.push(identityId);
    }

    sql += ` ORDER BY day DESC, identity_id`;

    const rows = await query<{
      day: Date;
      identity_id: string;
      identity_version: number;
      total_turns: number;
      repair_turns: number;
      repair_rate_pct: number;
      avg_attempts: number;
      failed_critiques: number;
      avg_execution_time_ms: number;
    }>(sql, params);

    return rows.map(r => ({
      day: r.day,
      identityId: r.identity_id,
      identityVersion: r.identity_version,
      totalTurns: r.total_turns,
      repairTurns: r.repair_turns,
      repairRatePct: Number(r.repair_rate_pct) || 0,
      avgAttempts: Number(r.avg_attempts) || 1,
      failedCritiques: r.failed_critiques,
      avgExecutionTimeMs: Number(r.avg_execution_time_ms) || 0,
    }));
  } catch (error) {
    logger.error('Failed to get drift metrics', {
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Clear events for a session (for testing only)
 */
export async function clearSessionEvents(sessionId: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot clear events in production');
  }

  await query(
    `DELETE FROM state_events WHERE session_id = $1`,
    [sessionId]
  );

  logger.warn('Cleared session events', { sessionId });
}

export default {
  addEvents,
  getEvents,
  getSnapshot,
  getSnapshotFast,
  logTurn,
  getRecentTurns,
  getDriftMetrics,
  clearSessionEvents,
};
