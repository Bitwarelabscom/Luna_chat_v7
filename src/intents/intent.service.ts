/**
 * Intent Service
 * Core CRUD operations and lifecycle management for user intents
 */

import { pool } from '../db/index.js';
import { redis } from '../db/redis.js';
import * as intentSummaryGenerator from '../context/intent-summary-generator.service.js';
import * as intentGraphService from '../graph/intent-graph.service.js';
import logger from '../utils/logger.js';
import {
  Intent,
  IntentSummary,
  IntentRelation,
  IntentTouch,
  CreateIntentInput,
  UpdateIntentInput,
  IntentContext,
  IntentStatus,
  IntentPriority,
  IntentTouchType,
  IntentRelationType,
  INTENT_DEFAULTS,
} from './intent.types.js';

// ============================================
// Constants
// ============================================

const INTENT_CACHE_PREFIX = 'intent:active:';
const INTENT_CACHE_TTL = INTENT_DEFAULTS.REDIS_CACHE_TTL_SECONDS;

// ============================================
// Database Row Mappers
// ============================================

function mapRowToIntent(row: Record<string, unknown>): Intent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Intent['type'],
    label: row.label as string,
    status: row.status as IntentStatus,
    priority: row.priority as IntentPriority,
    createdAt: new Date(row.created_at as string),
    lastTouchedAt: new Date(row.last_touched_at as string),
    touchCount: row.touch_count as number,
    goal: row.goal as string,
    constraints: (row.constraints as string[]) || [],
    triedApproaches: (row.tried_approaches as string[]) || [],
    currentApproach: row.current_approach as string | null,
    blockers: (row.blockers as string[]) || [],
    emotionalContext: row.emotional_context as string | null,
    parentIntentId: row.parent_intent_id as string | null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    resolutionType: row.resolution_type as Intent['resolutionType'],
    sourceSessionId: row.source_session_id as string | null,
    updatedAt: new Date(row.updated_at as string),
  };
}

function intentToSummary(intent: Intent): IntentSummary {
  return {
    id: intent.id,
    type: intent.type,
    label: intent.label,
    status: intent.status,
    priority: intent.priority,
    goal: intent.goal,
    currentApproach: intent.currentApproach,
    blockers: intent.blockers,
    lastTouchedAt: intent.lastTouchedAt,
    touchCount: intent.touchCount,
  };
}

// ============================================
// Cache Operations
// ============================================

/**
 * Get cached active intents for user
 */
async function getCachedIntents(userId: string): Promise<IntentSummary[] | null> {
  try {
    const data = await redis.get(`${INTENT_CACHE_PREFIX}${userId}`);
    if (!data) return null;
    return JSON.parse(data);
  } catch (error) {
    logger.warn('Failed to get cached intents', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Cache active intents for user
 */
async function cacheIntents(userId: string, intents: IntentSummary[]): Promise<void> {
  try {
    await redis.setex(
      `${INTENT_CACHE_PREFIX}${userId}`,
      INTENT_CACHE_TTL,
      JSON.stringify(intents)
    );
  } catch (error) {
    logger.warn('Failed to cache intents', { userId, error: (error as Error).message });
  }
}

/**
 * Invalidate cached intents for user
 */
async function invalidateCache(userId: string): Promise<void> {
  try {
    await redis.del(`${INTENT_CACHE_PREFIX}${userId}`);
  } catch (error) {
    logger.warn('Failed to invalidate intent cache', { userId, error: (error as Error).message });
  }
}

// ============================================
// CRUD Operations
// ============================================

/**
 * Create a new intent
 */
export async function createIntent(input: CreateIntentInput): Promise<Intent> {
  const result = await pool.query(
    `INSERT INTO user_intents (
      user_id, type, label, goal, priority, constraints,
      current_approach, emotional_context, parent_intent_id, source_session_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      input.userId,
      input.type,
      input.label,
      input.goal,
      input.priority || 'medium',
      input.constraints || [],
      input.currentApproach || null,
      input.emotionalContext || null,
      input.parentIntentId || null,
      input.sourceSessionId || null,
    ]
  );

  const intent = mapRowToIntent(result.rows[0]);

  // Invalidate cache
  await invalidateCache(input.userId);

  // Sync to Neo4j (non-blocking)
  intentGraphService.syncIntentToGraph(intent).catch(err => {
    logger.warn('Failed to sync intent to Neo4j', { intentId: intent.id, error: (err as Error).message });
  });

  logger.info('Created intent', {
    intentId: intent.id,
    userId: input.userId,
    type: input.type,
    label: input.label,
  });

  return intent;
}

/**
 * Get intent by ID
 */
export async function getIntentById(intentId: string): Promise<Intent | null> {
  const result = await pool.query('SELECT * FROM user_intents WHERE id = $1', [intentId]);
  return result.rows[0] ? mapRowToIntent(result.rows[0]) : null;
}

/**
 * Get all active intents for user
 */
export async function getActiveIntents(userId: string): Promise<Intent[]> {
  const result = await pool.query(
    `SELECT * FROM user_intents
     WHERE user_id = $1 AND status = 'active'
     ORDER BY priority DESC, last_touched_at DESC`,
    [userId]
  );
  return result.rows.map(mapRowToIntent);
}

/**
 * Get active intent summaries (with cache)
 */
export async function getActiveIntentSummaries(userId: string): Promise<IntentSummary[]> {
  // Try cache first
  const cached = await getCachedIntents(userId);
  if (cached) return cached;

  // Fetch from DB
  const intents = await getActiveIntents(userId);
  const summaries = intents.map(intentToSummary);

  // Cache the result
  await cacheIntents(userId, summaries);

  return summaries;
}

/**
 * Get suspended intents for user
 */
export async function getSuspendedIntents(userId: string): Promise<Intent[]> {
  const result = await pool.query(
    `SELECT * FROM user_intents
     WHERE user_id = $1 AND status = 'suspended'
     ORDER BY last_touched_at DESC`,
    [userId]
  );
  return result.rows.map(mapRowToIntent);
}

/**
 * Get recently resolved intents (last 24h)
 */
export async function getRecentlyResolvedIntents(userId: string): Promise<Intent[]> {
  const result = await pool.query(
    `SELECT * FROM user_intents
     WHERE user_id = $1 AND status = 'resolved'
       AND resolved_at > NOW() - INTERVAL '24 hours'
     ORDER BY resolved_at DESC
     LIMIT 5`,
    [userId]
  );
  return result.rows.map(mapRowToIntent);
}

/**
 * Update an intent
 */
export async function updateIntent(
  intentId: string,
  updates: UpdateIntentInput
): Promise<Intent | null> {
  // Build dynamic update query
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.label !== undefined) {
    setClauses.push(`label = $${paramIndex++}`);
    values.push(updates.label);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    values.push(updates.status);
    if (updates.status === 'resolved') {
      setClauses.push(`resolved_at = NOW()`);
    }
  }
  if (updates.priority !== undefined) {
    setClauses.push(`priority = $${paramIndex++}`);
    values.push(updates.priority);
  }
  if (updates.goal !== undefined) {
    setClauses.push(`goal = $${paramIndex++}`);
    values.push(updates.goal);
  }
  if (updates.constraints !== undefined) {
    setClauses.push(`constraints = $${paramIndex++}`);
    values.push(updates.constraints);
  }
  if (updates.currentApproach !== undefined) {
    setClauses.push(`current_approach = $${paramIndex++}`);
    values.push(updates.currentApproach);
  }
  if (updates.blockers !== undefined) {
    setClauses.push(`blockers = $${paramIndex++}`);
    values.push(updates.blockers);
  }
  if (updates.emotionalContext !== undefined) {
    setClauses.push(`emotional_context = $${paramIndex++}`);
    values.push(updates.emotionalContext);
  }
  if (updates.resolutionType !== undefined) {
    setClauses.push(`resolution_type = $${paramIndex++}`);
    values.push(updates.resolutionType);
  }

  if (setClauses.length === 0) {
    return await getIntentById(intentId);
  }

  values.push(intentId);

  const result = await pool.query(
    `UPDATE user_intents SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);
    return intent;
  }

  return null;
}

/**
 * Touch an intent (update last_touched_at and increment touch_count)
 */
export async function touchIntent(
  intentId: string,
  sessionId?: string,
  messageSnippet?: string,
  touchType: IntentTouchType = 'explicit'
): Promise<Intent | null> {
  // Update the intent
  const result = await pool.query(
    `UPDATE user_intents
     SET last_touched_at = NOW(),
         touch_count = touch_count + 1
     WHERE id = $1
     RETURNING *`,
    [intentId]
  );

  if (!result.rows[0]) return null;

  const intent = mapRowToIntent(result.rows[0]);

  // Record the touch
  await pool.query(
    `INSERT INTO intent_touches (intent_id, session_id, message_snippet, touch_type)
     VALUES ($1, $2, $3, $4)`,
    [intentId, sessionId || null, messageSnippet?.slice(0, 200) || null, touchType]
  );

  // Invalidate cache
  await invalidateCache(intent.userId);

  return intent;
}

/**
 * Add a tried approach to an intent
 */
export async function addTriedApproach(intentId: string, approach: string): Promise<Intent | null> {
  const result = await pool.query(
    `UPDATE user_intents
     SET tried_approaches = array_append(tried_approaches, $2),
         current_approach = $2,
         last_touched_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [intentId, approach]
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);
    return intent;
  }

  return null;
}

/**
 * Add a blocker to an intent
 */
export async function addBlocker(intentId: string, blocker: string): Promise<Intent | null> {
  const result = await pool.query(
    `UPDATE user_intents
     SET blockers = array_append(blockers, $2),
         last_touched_at = NOW()
     WHERE id = $1 AND NOT ($2 = ANY(blockers))
     RETURNING *`,
    [intentId, blocker]
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);
    return intent;
  }

  return await getIntentById(intentId);
}

/**
 * Remove a blocker from an intent
 */
export async function removeBlocker(intentId: string, blocker: string): Promise<Intent | null> {
  const result = await pool.query(
    `UPDATE user_intents
     SET blockers = array_remove(blockers, $2),
         last_touched_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [intentId, blocker]
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);
    return intent;
  }

  return null;
}

/**
 * Resolve an intent
 */
export async function resolveIntent(
  intentId: string,
  resolutionType: Intent['resolutionType']
): Promise<Intent | null> {
  const result = await pool.query(
    `UPDATE user_intents
     SET status = 'resolved',
         resolution_type = $2,
         resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [intentId, resolutionType]
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);

    logger.info('Resolved intent', {
      intentId,
      resolutionType,
      label: intent.label,
    });

    // Generate/update intent context summary (non-blocking)
    intentSummaryGenerator.generateIntentSummary(intent, []).catch(err => {
      logger.warn('Failed to generate intent summary on resolve', {
        intentId,
        error: (err as Error).message,
      });
    });

    // Update Neo4j status (non-blocking)
    intentGraphService.updateIntentStatus(intentId, 'resolved').catch(err => {
      logger.warn('Failed to update intent status in Neo4j', { intentId, error: (err as Error).message });
    });

    return intent;
  }

  return null;
}

/**
 * Suspend an intent
 */
export async function suspendIntent(intentId: string): Promise<Intent | null> {
  const result = await pool.query(
    `UPDATE user_intents
     SET status = 'suspended'
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [intentId]
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);

    // Generate/update intent context summary (non-blocking)
    intentSummaryGenerator.generateIntentSummary(intent, []).catch(err => {
      logger.warn('Failed to generate intent summary on suspend', {
        intentId,
        error: (err as Error).message,
      });
    });

    // Update Neo4j status (non-blocking)
    intentGraphService.updateIntentStatus(intentId, 'suspended').catch(err => {
      logger.warn('Failed to update intent status in Neo4j', { intentId, error: (err as Error).message });
    });

    return intent;
  }

  return null;
}

/**
 * Reactivate a suspended intent
 */
export async function reactivateIntent(intentId: string): Promise<Intent | null> {
  const result = await pool.query(
    `UPDATE user_intents
     SET status = 'active',
         last_touched_at = NOW()
     WHERE id = $1 AND status IN ('suspended', 'decayed')
     RETURNING *`,
    [intentId]
  );

  if (result.rows[0]) {
    const intent = mapRowToIntent(result.rows[0]);
    await invalidateCache(intent.userId);
    return intent;
  }

  return null;
}

// ============================================
// Intent Relations
// ============================================

/**
 * Create a relation between intents
 */
export async function createIntentRelation(
  fromIntentId: string,
  toIntentId: string,
  relationType: IntentRelationType
): Promise<IntentRelation | null> {
  try {
    const result = await pool.query(
      `INSERT INTO intent_relations (from_intent_id, to_intent_id, relation_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (from_intent_id, to_intent_id, relation_type) DO NOTHING
       RETURNING *`,
      [fromIntentId, toIntentId, relationType]
    );

    if (result.rows[0]) {
      // Sync to Neo4j (non-blocking)
      intentGraphService.syncIntentRelationToGraph(fromIntentId, toIntentId, relationType).catch(err => {
        logger.warn('Failed to sync intent relation to Neo4j', { error: (err as Error).message });
      });

      return {
        id: result.rows[0].id,
        fromIntentId: result.rows[0].from_intent_id,
        toIntentId: result.rows[0].to_intent_id,
        relationType: result.rows[0].relation_type,
        createdAt: new Date(result.rows[0].created_at),
      };
    }
    return null;
  } catch (error) {
    logger.warn('Failed to create intent relation', { error: (error as Error).message });
    return null;
  }
}

/**
 * Get related intents
 */
export async function getRelatedIntents(intentId: string): Promise<Intent[]> {
  const result = await pool.query(
    `SELECT ui.* FROM user_intents ui
     JOIN intent_relations ir ON ui.id = ir.to_intent_id
     WHERE ir.from_intent_id = $1
     UNION
     SELECT ui.* FROM user_intents ui
     JOIN intent_relations ir ON ui.id = ir.from_intent_id
     WHERE ir.to_intent_id = $1`,
    [intentId]
  );
  return result.rows.map(mapRowToIntent);
}

/**
 * Get related intent graph using Neo4j for multi-hop traversal
 * Falls back to single-hop PostgreSQL query if Neo4j unavailable
 */
export async function getRelatedIntentsGraph(
  intentId: string,
  depth: number = 2
): Promise<{
  nodes: Array<{ id: string; label: string; status: string; type: string }>;
  edges: Array<{ fromId: string; toId: string; type: string }>;
}> {
  try {
    const graph = await intentGraphService.getRelatedIntentGraph(intentId, depth);
    if (graph.nodes.length > 0) {
      return {
        nodes: graph.nodes.map(n => ({
          id: n.id,
          label: n.label,
          status: n.status,
          type: n.type,
        })),
        edges: graph.edges.map(e => ({
          fromId: e.fromId,
          toId: e.toId,
          type: e.type,
        })),
      };
    }
  } catch (error) {
    logger.warn('Neo4j graph query failed, falling back to PostgreSQL', {
      error: (error as Error).message,
    });
  }

  // Fallback to single-hop PostgreSQL
  const related = await getRelatedIntents(intentId);
  const nodes = related.map(i => ({
    id: i.id,
    label: i.label,
    status: i.status,
    type: i.type,
  }));

  // Get edges from PostgreSQL
  const edgeResult = await pool.query(
    `SELECT from_intent_id, to_intent_id, relation_type FROM intent_relations
     WHERE from_intent_id = $1 OR to_intent_id = $1`,
    [intentId]
  );

  const edges = edgeResult.rows.map(r => ({
    fromId: r.from_intent_id,
    toId: r.to_intent_id,
    type: r.relation_type,
  }));

  return { nodes, edges };
}

/**
 * Get intent dependency chain using Neo4j for efficient multi-hop traversal
 * Returns all intents that block the given intent
 */
export async function getIntentDependencyChain(intentId: string): Promise<IntentSummary[]> {
  try {
    const chain = await intentGraphService.getIntentDependencyChain(intentId);
    return chain.map(i => ({
      id: i.id,
      type: i.type as Intent['type'],
      label: i.label,
      status: i.status as IntentStatus,
      priority: i.priority as IntentPriority,
      goal: i.goal || '',
      currentApproach: null,
      blockers: [],
      lastTouchedAt: i.lastTouchedAt,
      touchCount: 0,
    }));
  } catch (error) {
    logger.warn('Failed to get intent dependency chain from Neo4j', {
      error: (error as Error).message,
    });
    return [];
  }
}

// ============================================
// Context Building
// ============================================

/**
 * Get full intent context for a user
 */
export async function getIntentContext(userId: string): Promise<IntentContext> {
  const [active, suspended, recentlyResolved] = await Promise.all([
    getActiveIntents(userId),
    getSuspendedIntents(userId),
    getRecentlyResolvedIntents(userId),
  ]);

  return {
    activeIntents: active.map(intentToSummary),
    suspendedIntents: suspended.map(intentToSummary).slice(0, 5),
    recentlyResolved: recentlyResolved.map(intentToSummary),
  };
}

/**
 * Get intents for cross-session recovery
 * Returns priority-filtered intents for new session context
 */
export async function getRecoveryIntents(userId: string): Promise<IntentSummary[]> {
  const result = await pool.query(
    `SELECT * FROM user_intents
     WHERE user_id = $1
       AND status = 'active'
       AND (
         priority = 'high'
         OR (priority = 'medium' AND last_touched_at > NOW() - INTERVAL '48 hours')
       )
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
       last_touched_at DESC
     LIMIT 5`,
    [userId]
  );

  return result.rows.map(mapRowToIntent).map(intentToSummary);
}

// ============================================
// Search & Matching
// ============================================

/**
 * Find intents by label similarity (for merge detection)
 */
export async function findSimilarIntents(
  userId: string,
  label: string,
  type?: Intent['type']
): Promise<Intent[]> {
  // Simple similarity using trigram-like matching
  const result = await pool.query(
    `SELECT * FROM user_intents
     WHERE user_id = $1
       AND status IN ('active', 'suspended')
       ${type ? 'AND type = $3' : ''}
       AND (
         LOWER(label) LIKE '%' || LOWER($2) || '%'
         OR LOWER($2) LIKE '%' || LOWER(label) || '%'
       )
     ORDER BY last_touched_at DESC
     LIMIT 5`,
    type ? [userId, label, type] : [userId, label]
  );

  return result.rows.map(mapRowToIntent);
}

/**
 * Find intent by exact label match
 */
export async function findIntentByLabel(
  userId: string,
  label: string
): Promise<Intent | null> {
  const result = await pool.query(
    `SELECT * FROM user_intents
     WHERE user_id = $1
       AND status IN ('active', 'suspended')
       AND LOWER(label) = LOWER($2)
     LIMIT 1`,
    [userId, label]
  );

  return result.rows[0] ? mapRowToIntent(result.rows[0]) : null;
}

// ============================================
// Maintenance Operations
// ============================================

/**
 * Decay stale intents (called by job)
 */
export async function decayStaleIntents(decayDays: number = INTENT_DEFAULTS.DECAY_DAYS): Promise<number> {
  const result = await pool.query('SELECT decay_stale_intents($1) as count', [decayDays]);
  const count = result.rows[0]?.count || 0;

  if (count > 0) {
    logger.info('Decayed stale intents', { count, decayDays });
  }

  return count;
}

/**
 * Prune Redis cache for all users
 */
export async function pruneIntentCache(): Promise<number> {
  try {
    // Get all cached intent keys
    const keys = await redis.keys(`${INTENT_CACHE_PREFIX}*`);

    let pruned = 0;
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      // Remove keys that have already expired or have very short TTL
      if (ttl < 0) {
        await redis.del(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug('Pruned intent cache', { pruned });
    }

    return pruned;
  } catch (error) {
    logger.warn('Failed to prune intent cache', { error: (error as Error).message });
    return 0;
  }
}

/**
 * Get intent touch history
 */
export async function getIntentTouches(intentId: string, limit: number = 10): Promise<IntentTouch[]> {
  const result = await pool.query(
    `SELECT * FROM intent_touches
     WHERE intent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [intentId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    intentId: row.intent_id,
    sessionId: row.session_id,
    messageSnippet: row.message_snippet,
    touchType: row.touch_type,
    createdAt: new Date(row.created_at),
  }));
}

export default {
  createIntent,
  getIntentById,
  getActiveIntents,
  getActiveIntentSummaries,
  getSuspendedIntents,
  getRecentlyResolvedIntents,
  updateIntent,
  touchIntent,
  addTriedApproach,
  addBlocker,
  removeBlocker,
  resolveIntent,
  suspendIntent,
  reactivateIntent,
  createIntentRelation,
  getRelatedIntents,
  getRelatedIntentsGraph,
  getIntentDependencyChain,
  getIntentContext,
  getRecoveryIntents,
  findSimilarIntents,
  findIntentByLabel,
  decayStaleIntents,
  pruneIntentCache,
  getIntentTouches,
};
