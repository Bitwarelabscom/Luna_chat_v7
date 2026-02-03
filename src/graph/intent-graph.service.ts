/**
 * Intent Graph Service
 * Graph operations for intent dependencies and relationships
 */

import * as neo4jClient from './neo4j.client.js';
import type { Intent, IntentRelationType } from '../intents/intent.types.js';

// ============================================
// Types
// ============================================

export interface IntentNode {
  id: string;
  userId: string;
  type: string;
  label: string;
  status: string;
  priority: string;
  goal: string | null;
  createdAt: Date;
  lastTouchedAt: Date;
}

export interface IntentRelation {
  fromId: string;
  toId: string;
  type: IntentRelationType;
}

export interface IntentGraph {
  nodes: IntentNode[];
  edges: IntentRelation[];
}

// ============================================
// Sync Operations
// ============================================

/**
 * Sync an intent to Neo4j
 */
export async function syncIntentToGraph(intent: Intent): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MERGE (i:Intent {id: $id})
    SET i.userId = $userId,
        i.type = $type,
        i.label = $label,
        i.status = $status,
        i.priority = $priority,
        i.goal = $goal,
        i.createdAt = datetime($createdAt),
        i.lastTouchedAt = datetime($lastTouchedAt),
        i.updatedAt = datetime()
    RETURN i
  `;

  return neo4jClient.writeQueryVoid(cypher, {
    id: intent.id,
    userId: intent.userId,
    type: intent.type,
    label: intent.label,
    status: intent.status,
    priority: intent.priority,
    goal: intent.goal || '',
    createdAt: intent.createdAt.toISOString(),
    lastTouchedAt: intent.lastTouchedAt.toISOString(),
  });
}

/**
 * Sync an intent relation to Neo4j
 */
export async function syncIntentRelationToGraph(
  fromIntentId: string,
  toIntentId: string,
  relationType: IntentRelationType
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  // Map relation type to Neo4j relationship type
  const relationshipTypes: Record<IntentRelationType, string> = {
    blocks: 'BLOCKS',
    depends_on: 'DEPENDS_ON',
    related_to: 'RELATED_TO',
    supersedes: 'SUPERSEDES',
    subtask_of: 'HAS_PARENT',
  };

  const relType = relationshipTypes[relationType] || 'RELATED_TO';

  const cypher = `
    MATCH (from:Intent {id: $fromId})
    MATCH (to:Intent {id: $toId})
    MERGE (from)-[r:${relType}]->(to)
    SET r.createdAt = datetime()
    RETURN r
  `;

  return neo4jClient.writeQueryVoid(cypher, {
    fromId: fromIntentId,
    toId: toIntentId,
  });
}

// ============================================
// Query Operations
// ============================================

/**
 * Get intent dependency chain - all intents that block a given intent
 */
export async function getIntentDependencyChain(
  intentId: string,
  maxDepth: number = 5
): Promise<IntentNode[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH path = (blocker:Intent)-[:BLOCKS*1..${maxDepth}]->(target:Intent {id: $intentId})
    WHERE blocker.status = 'active'
    UNWIND nodes(path) as node
    WITH DISTINCT node
    WHERE node.id <> $intentId
    RETURN node.id as id, node.userId as userId, node.type as type,
           node.label as label, node.status as status, node.priority as priority,
           node.goal as goal, node.createdAt as createdAt, node.lastTouchedAt as lastTouchedAt
    ORDER BY node.lastTouchedAt DESC
  `;

  const result = await neo4jClient.readQuery<{
    id: string;
    userId: string;
    type: string;
    label: string;
    status: string;
    priority: string;
    goal: string | null;
    createdAt: string;
    lastTouchedAt: string;
  }>(cypher, { intentId });

  return result.map(r => ({
    id: r.id,
    userId: r.userId,
    type: r.type,
    label: r.label,
    status: r.status,
    priority: r.priority,
    goal: r.goal,
    createdAt: new Date(r.createdAt),
    lastTouchedAt: new Date(r.lastTouchedAt),
  }));
}

/**
 * Get all intents that directly block a given intent
 */
export async function getBlockingIntents(intentId: string): Promise<IntentNode[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (blocker:Intent)-[:BLOCKS]->(target:Intent {id: $intentId})
    WHERE blocker.status = 'active'
    RETURN blocker.id as id, blocker.userId as userId, blocker.type as type,
           blocker.label as label, blocker.status as status, blocker.priority as priority,
           blocker.goal as goal, blocker.createdAt as createdAt, blocker.lastTouchedAt as lastTouchedAt
  `;

  const result = await neo4jClient.readQuery<{
    id: string;
    userId: string;
    type: string;
    label: string;
    status: string;
    priority: string;
    goal: string | null;
    createdAt: string;
    lastTouchedAt: string;
  }>(cypher, { intentId });

  return result.map(r => ({
    id: r.id,
    userId: r.userId,
    type: r.type,
    label: r.label,
    status: r.status,
    priority: r.priority,
    goal: r.goal,
    createdAt: new Date(r.createdAt),
    lastTouchedAt: new Date(r.lastTouchedAt),
  }));
}

/**
 * Get related intent graph - nodes and edges within N hops
 */
export async function getRelatedIntentGraph(
  intentId: string,
  depth: number = 2
): Promise<IntentGraph> {
  if (!neo4jClient.isNeo4jEnabled()) return { nodes: [], edges: [] };

  // Get nodes
  const nodesCypher = `
    MATCH (center:Intent {id: $intentId})
    MATCH path = (center)-[*1..${depth}]-(related:Intent)
    UNWIND nodes(path) as node
    WITH DISTINCT node
    RETURN node.id as id, node.userId as userId, node.type as type,
           node.label as label, node.status as status, node.priority as priority,
           node.goal as goal, node.createdAt as createdAt, node.lastTouchedAt as lastTouchedAt
  `;

  const nodesResult = await neo4jClient.readQuery<{
    id: string;
    userId: string;
    type: string;
    label: string;
    status: string;
    priority: string;
    goal: string | null;
    createdAt: string;
    lastTouchedAt: string;
  }>(nodesCypher, { intentId });

  const nodes = nodesResult.map(r => ({
    id: r.id,
    userId: r.userId,
    type: r.type,
    label: r.label,
    status: r.status,
    priority: r.priority,
    goal: r.goal,
    createdAt: new Date(r.createdAt),
    lastTouchedAt: new Date(r.lastTouchedAt),
  }));

  // Get edges
  const edgesCypher = `
    MATCH (center:Intent {id: $intentId})
    MATCH path = (center)-[*1..${depth}]-(related:Intent)
    UNWIND relationships(path) as rel
    WITH DISTINCT rel
    RETURN startNode(rel).id as fromId, endNode(rel).id as toId, type(rel) as type
  `;

  const edgesResult = await neo4jClient.readQuery<{
    fromId: string;
    toId: string;
    type: string;
  }>(edgesCypher, { intentId });

  const edges = edgesResult.map(r => ({
    fromId: r.fromId,
    toId: r.toId,
    type: r.type.toLowerCase() as IntentRelationType,
  }));

  return { nodes, edges };
}

/**
 * Get count of active intents for a user
 */
export async function getActiveIntentCount(userId: string): Promise<number> {
  if (!neo4jClient.isNeo4jEnabled()) return 0;

  const cypher = `
    MATCH (i:Intent {userId: $userId, status: 'active'})
    RETURN count(i) as count
  `;

  const result = await neo4jClient.readQuery<{ count: { low: number } | number }>(cypher, { userId });
  const count = result[0]?.count;
  return typeof count === 'object' ? count.low : Number(count) || 0;
}

/**
 * Get all blocking chains for a user's active intents
 */
export async function getAllBlockingChains(
  userId: string
): Promise<Array<{ intentId: string; blockers: string[] }>> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (blocked:Intent {userId: $userId, status: 'active'})
    WHERE EXISTS {
      MATCH (blocker:Intent)-[:BLOCKS]->(blocked)
      WHERE blocker.status = 'active'
    }
    MATCH (blocker:Intent)-[:BLOCKS]->(blocked)
    WHERE blocker.status = 'active'
    RETURN blocked.id as intentId, collect(blocker.label) as blockers
  `;

  const result = await neo4jClient.readQuery<{
    intentId: string;
    blockers: string[];
  }>(cypher, { userId });

  return result;
}

/**
 * Remove an intent from the graph
 */
export async function removeIntentFromGraph(intentId: string): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MATCH (i:Intent {id: $intentId})
    DETACH DELETE i
  `;

  return neo4jClient.writeQueryVoid(cypher, { intentId });
}

/**
 * Update intent status in the graph
 */
export async function updateIntentStatus(
  intentId: string,
  status: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MATCH (i:Intent {id: $intentId})
    SET i.status = $status, i.updatedAt = datetime()
  `;

  return neo4jClient.writeQueryVoid(cypher, { intentId, status });
}

export default {
  syncIntentToGraph,
  syncIntentRelationToGraph,
  getIntentDependencyChain,
  getBlockingIntents,
  getRelatedIntentGraph,
  getActiveIntentCount,
  getAllBlockingChains,
  removeIntentFromGraph,
  updateIntentStatus,
};
