/**
 * Graph Sync Service
 * PostgreSQL to Neo4j synchronization
 */

import { pool } from '../db/index.js';
import * as intentGraphService from './intent-graph.service.js';
import * as knowledgeGraphService from './knowledge-graph.service.js';
import * as entityGraphService from './entity-graph.service.js';
import * as neo4jClient from './neo4j.client.js';
import logger from '../utils/logger.js';
import type { Intent } from '../intents/intent.types.js';
import type { UserFact } from '../memory/facts.service.js';

// ============================================
// Types
// ============================================

export interface SyncResult {
  intents: { synced: number; failed: number };
  intentRelations: { synced: number; failed: number };
  facts: { synced: number; failed: number };
  topics: { synced: number; failed: number };
  duration: number;
}

// ============================================
// Full Sync Operations
// ============================================

/**
 * Sync all intents for a user to Neo4j
 */
export async function syncUserIntents(userId: string): Promise<{ synced: number; failed: number }> {
  if (!neo4jClient.isNeo4jEnabled()) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  try {
    // Get active and suspended intents
    const result = await pool.query(
      `SELECT * FROM user_intents WHERE user_id = $1 AND status IN ('active', 'suspended')`,
      [userId]
    );

    for (const row of result.rows) {
      const intent: Intent = {
        id: row.id,
        userId: row.user_id,
        type: row.type,
        label: row.label,
        status: row.status,
        priority: row.priority,
        createdAt: new Date(row.created_at),
        lastTouchedAt: new Date(row.last_touched_at),
        touchCount: row.touch_count,
        goal: row.goal,
        constraints: row.constraints || [],
        triedApproaches: row.tried_approaches || [],
        currentApproach: row.current_approach,
        blockers: row.blockers || [],
        emotionalContext: row.emotional_context,
        parentIntentId: row.parent_intent_id,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
        resolutionType: row.resolution_type,
        sourceSessionId: row.source_session_id,
        updatedAt: new Date(row.updated_at),
      };

      const success = await intentGraphService.syncIntentToGraph(intent);
      if (success) {
        synced++;
      } else {
        failed++;
      }
    }

    logger.debug('Synced user intents to Neo4j', { userId, synced, failed });
  } catch (error) {
    logger.error('Failed to sync user intents', { userId, error: (error as Error).message });
  }

  return { synced, failed };
}

/**
 * Sync all intent relations for a user to Neo4j
 */
export async function syncUserIntentRelations(userId: string): Promise<{ synced: number; failed: number }> {
  if (!neo4jClient.isNeo4jEnabled()) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  try {
    // Get intent relations for user's intents
    const result = await pool.query(
      `SELECT ir.* FROM intent_relations ir
       JOIN user_intents ui ON ir.from_intent_id = ui.id
       WHERE ui.user_id = $1`,
      [userId]
    );

    for (const row of result.rows) {
      const success = await intentGraphService.syncIntentRelationToGraph(
        row.from_intent_id,
        row.to_intent_id,
        row.relation_type
      );
      if (success) {
        synced++;
      } else {
        failed++;
      }
    }

    logger.debug('Synced user intent relations to Neo4j', { userId, synced, failed });
  } catch (error) {
    logger.error('Failed to sync user intent relations', { userId, error: (error as Error).message });
  }

  return { synced, failed };
}

/**
 * Sync all facts for a user to Neo4j
 */
export async function syncUserFacts(userId: string): Promise<{ synced: number; failed: number }> {
  if (!neo4jClient.isNeo4jEnabled()) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  try {
    // Get active facts
    const result = await pool.query(
      `SELECT * FROM user_facts WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    for (const row of result.rows) {
      const fact: UserFact = {
        id: row.id,
        category: row.category,
        factKey: row.fact_key,
        factValue: row.fact_value,
        confidence: parseFloat(row.confidence),
        lastMentioned: new Date(row.last_mentioned),
        mentionCount: row.mention_count,
        intentId: row.intent_id,
      };

      const success = await knowledgeGraphService.syncFactToGraph(userId, fact);
      if (success) {
        synced++;
      } else {
        failed++;
      }
    }

    logger.debug('Synced user facts to Neo4j', { userId, synced, failed });
  } catch (error) {
    logger.error('Failed to sync user facts', { userId, error: (error as Error).message });
  }

  return { synced, failed };
}

/**
 * Sync session topics to Neo4j
 */
export async function syncUserTopics(userId: string): Promise<{ synced: number; failed: number }> {
  if (!neo4jClient.isNeo4jEnabled()) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  try {
    // Get topics from session logs
    const result = await pool.query(
      `SELECT DISTINCT unnest(topics) as topic FROM session_logs WHERE user_id = $1`,
      [userId]
    );

    for (const row of result.rows) {
      if (row.topic) {
        const success = await entityGraphService.syncTopicToGraph({
          userId,
          name: row.topic,
          mentionCount: 1,
          lastMentioned: new Date(),
        });
        if (success) {
          synced++;
        } else {
          failed++;
        }
      }
    }

    logger.debug('Synced user topics to Neo4j', { userId, synced, failed });
  } catch (error) {
    logger.error('Failed to sync user topics', { userId, error: (error as Error).message });
  }

  return { synced, failed };
}

/**
 * Full sync for a single user
 */
export async function syncUser(userId: string): Promise<SyncResult> {
  const startTime = Date.now();

  const [intents, intentRelations, facts, topics] = await Promise.all([
    syncUserIntents(userId),
    syncUserIntentRelations(userId),
    syncUserFacts(userId),
    syncUserTopics(userId),
  ]);

  const duration = Date.now() - startTime;

  logger.info('User sync to Neo4j completed', {
    userId,
    intents,
    intentRelations,
    facts,
    topics,
    durationMs: duration,
  });

  return {
    intents,
    intentRelations,
    facts,
    topics,
    duration,
  };
}

// ============================================
// Periodic Reconciliation
// ============================================

/**
 * Reconcile Neo4j with PostgreSQL for users with recent activity
 * Called by the periodic job
 */
export async function reconcileRecentUsers(hoursBack: number = 6): Promise<{
  usersProcessed: number;
  totalSynced: number;
  totalFailed: number;
  duration: number;
}> {
  if (!neo4jClient.isNeo4jEnabled()) {
    return { usersProcessed: 0, totalSynced: 0, totalFailed: 0, duration: 0 };
  }

  const startTime = Date.now();
  let usersProcessed = 0;
  let totalSynced = 0;
  let totalFailed = 0;

  try {
    // Get users with recent activity
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM user_intents
       WHERE last_touched_at > NOW() - INTERVAL '${hoursBack} hours'
       UNION
       SELECT DISTINCT user_id FROM user_facts
       WHERE last_mentioned > NOW() - INTERVAL '${hoursBack} hours'
       UNION
       SELECT DISTINCT user_id FROM session_logs
       WHERE ended_at > NOW() - INTERVAL '${hoursBack} hours'
       LIMIT 50`
    );

    for (const row of result.rows) {
      try {
        const syncResult = await syncUser(row.user_id);
        usersProcessed++;
        totalSynced += syncResult.intents.synced + syncResult.facts.synced + syncResult.topics.synced;
        totalFailed += syncResult.intents.failed + syncResult.facts.failed + syncResult.topics.failed;
      } catch (error) {
        logger.error('Failed to sync user in reconciliation', {
          userId: row.user_id,
          error: (error as Error).message,
        });
      }
    }
  } catch (error) {
    logger.error('Failed to run Neo4j reconciliation', { error: (error as Error).message });
  }

  const duration = Date.now() - startTime;

  logger.info('Neo4j reconciliation completed', {
    usersProcessed,
    totalSynced,
    totalFailed,
    durationMs: duration,
  });

  return {
    usersProcessed,
    totalSynced,
    totalFailed,
    duration,
  };
}

/**
 * Clean up orphaned nodes in Neo4j (nodes that no longer exist in PostgreSQL)
 */
export async function cleanupOrphanedNodes(): Promise<{ deleted: number }> {
  if (!neo4jClient.isNeo4jEnabled()) return { deleted: 0 };

  let deleted = 0;

  try {
    // Get all intent IDs from Neo4j
    const neo4jIntents = await neo4jClient.readQuery<{ id: string }>(
      'MATCH (i:Intent) RETURN i.id as id'
    );

    for (const { id } of neo4jIntents) {
      const result = await pool.query('SELECT id FROM user_intents WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        await intentGraphService.removeIntentFromGraph(id);
        deleted++;
      }
    }

    // Get all fact IDs from Neo4j
    const neo4jFacts = await neo4jClient.readQuery<{ id: string }>(
      'MATCH (f:Fact) RETURN f.id as id'
    );

    for (const { id } of neo4jFacts) {
      const result = await pool.query('SELECT id FROM user_facts WHERE id = $1 AND is_active = true', [id]);
      if (result.rows.length === 0) {
        await knowledgeGraphService.removeFactFromGraph(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info('Cleaned up orphaned Neo4j nodes', { deleted });
    }
  } catch (error) {
    logger.error('Failed to cleanup orphaned nodes', { error: (error as Error).message });
  }

  return { deleted };
}

export default {
  syncUserIntents,
  syncUserIntentRelations,
  syncUserFacts,
  syncUserTopics,
  syncUser,
  reconcileRecentUsers,
  cleanupOrphanedNodes,
};
