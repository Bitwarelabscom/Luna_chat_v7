/**
 * Entity Graph Service
 * Graph operations for entity co-occurrence and associations
 */

import * as neo4jClient from './neo4j.client.js';

// ============================================
// Types
// ============================================

export interface EntityNode {
  id?: string;
  userId: string;
  label: string;
  type: string;
  origin: string;
  confidence: number;
  mentionCount: number;
  lastMentioned: Date;
}

export interface TopicNode {
  id?: string;
  userId: string;
  name: string;
  mentionCount: number;
  lastMentioned: Date;
}

export interface CoOccurrence {
  entity1: string;
  entity2: string;
  count: number;
}

// ============================================
// Sync Operations
// ============================================

/**
 * Sync an entity to Neo4j
 */
export async function syncEntityToGraph(entity: EntityNode): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MERGE (e:Entity {userId: $userId, label: $label})
    SET e.type = $type,
        e.origin = $origin,
        e.confidence = $confidence,
        e.mentionCount = COALESCE(e.mentionCount, 0) + 1,
        e.lastMentioned = datetime(),
        e.updatedAt = datetime()
    RETURN e
  `;

  return neo4jClient.writeQueryVoid(cypher, {
    userId: entity.userId,
    label: entity.label,
    type: entity.type,
    origin: entity.origin,
    confidence: entity.confidence,
  });
}

/**
 * Sync a topic to Neo4j
 */
export async function syncTopicToGraph(topic: TopicNode): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MERGE (t:Topic {userId: $userId, name: $name})
    SET t.mentionCount = COALESCE(t.mentionCount, 0) + 1,
        t.lastMentioned = datetime(),
        t.updatedAt = datetime()
    RETURN t
  `;

  return neo4jClient.writeQueryVoid(cypher, {
    userId: topic.userId,
    name: topic.name,
  });
}

/**
 * Record a co-occurrence between two entities
 */
export async function recordCoOccurrence(
  userId: string,
  entity1: string,
  entity2: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  // Ensure both entities exist
  const ensureCypher = `
    MERGE (e1:Entity {userId: $userId, label: $entity1})
    ON CREATE SET e1.type = 'unknown', e1.origin = 'cooccurrence', e1.confidence = 0.5, e1.mentionCount = 1
    MERGE (e2:Entity {userId: $userId, label: $entity2})
    ON CREATE SET e2.type = 'unknown', e2.origin = 'cooccurrence', e2.confidence = 0.5, e2.mentionCount = 1
    RETURN e1, e2
  `;

  await neo4jClient.writeQueryVoid(ensureCypher, { userId, entity1, entity2 });

  // Create or update co-occurrence relationship
  const coocCypher = `
    MATCH (e1:Entity {userId: $userId, label: $entity1})
    MATCH (e2:Entity {userId: $userId, label: $entity2})
    WHERE e1.label < e2.label  // Consistent ordering to avoid duplicates
    MERGE (e1)-[r:CO_OCCURS_WITH]-(e2)
    ON CREATE SET r.count = 1, r.createdAt = datetime()
    ON MATCH SET r.count = r.count + 1, r.updatedAt = datetime()
    RETURN r
  `;

  return neo4jClient.writeQueryVoid(coocCypher, { userId, entity1, entity2 });
}

/**
 * Record a topic co-occurrence
 */
export async function recordTopicCoOccurrence(
  userId: string,
  topic1: string,
  topic2: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  // Ensure both topics exist
  const ensureCypher = `
    MERGE (t1:Topic {userId: $userId, name: $topic1})
    ON CREATE SET t1.mentionCount = 1
    MERGE (t2:Topic {userId: $userId, name: $topic2})
    ON CREATE SET t2.mentionCount = 1
    RETURN t1, t2
  `;

  await neo4jClient.writeQueryVoid(ensureCypher, { userId, topic1, topic2 });

  // Create or update co-occurrence relationship
  const coocCypher = `
    MATCH (t1:Topic {userId: $userId, name: $topic1})
    MATCH (t2:Topic {userId: $userId, name: $topic2})
    WHERE t1.name < t2.name  // Consistent ordering to avoid duplicates
    MERGE (t1)-[r:CO_OCCURS_WITH]-(t2)
    ON CREATE SET r.count = 1, r.createdAt = datetime()
    ON MATCH SET r.count = r.count + 1, r.updatedAt = datetime()
    RETURN r
  `;

  return neo4jClient.writeQueryVoid(coocCypher, { userId, topic1, topic2 });
}

// ============================================
// Query Operations
// ============================================

/**
 * Get topic co-occurrences for a user
 */
export async function getTopicCoOccurrences(
  userId: string,
  topic: string
): Promise<CoOccurrence[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (t1:Topic {userId: $userId, name: $topic})-[r:CO_OCCURS_WITH]-(t2:Topic)
    RETURN t1.name as entity1, t2.name as entity2, r.count as count
    ORDER BY r.count DESC
    LIMIT 20
  `;

  const result = await neo4jClient.readQuery<{
    entity1: string;
    entity2: string;
    count: { low: number } | number;
  }>(cypher, { userId, topic });

  return result.map(r => ({
    entity1: r.entity1,
    entity2: r.entity2,
    count: typeof r.count === 'object' ? r.count.low : Number(r.count),
  }));
}

/**
 * Get entity co-occurrences for a user
 */
export async function getEntityCoOccurrences(
  userId: string,
  entity: string
): Promise<CoOccurrence[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (e1:Entity {userId: $userId, label: $entity})-[r:CO_OCCURS_WITH]-(e2:Entity)
    RETURN e1.label as entity1, e2.label as entity2, r.count as count
    ORDER BY r.count DESC
    LIMIT 20
  `;

  const result = await neo4jClient.readQuery<{
    entity1: string;
    entity2: string;
    count: { low: number } | number;
  }>(cypher, { userId, entity });

  return result.map(r => ({
    entity1: r.entity1,
    entity2: r.entity2,
    count: typeof r.count === 'object' ? r.count.low : Number(r.count),
  }));
}

/**
 * Get strong co-occurrences (count >= threshold)
 */
export async function getStrongCoOccurrences(
  userId: string,
  limit: number = 10,
  minCount: number = 3
): Promise<CoOccurrence[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (e1:Entity {userId: $userId})-[r:CO_OCCURS_WITH]-(e2:Entity)
    WHERE r.count >= $minCount AND e1.label < e2.label
    RETURN e1.label as entity1, e2.label as entity2, r.count as count
    ORDER BY r.count DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    entity1: string;
    entity2: string;
    count: { low: number } | number;
  }>(cypher, { userId, limit, minCount });

  return result.map(r => ({
    entity1: r.entity1,
    entity2: r.entity2,
    count: typeof r.count === 'object' ? r.count.low : Number(r.count),
  }));
}

/**
 * Get topic count for a user
 */
export async function getTopicCount(userId: string): Promise<number> {
  if (!neo4jClient.isNeo4jEnabled()) return 0;

  const cypher = `
    MATCH (t:Topic {userId: $userId})
    RETURN count(t) as count
  `;

  const result = await neo4jClient.readQuery<{ count: { low: number } | number }>(cypher, { userId });
  const count = result[0]?.count;
  return typeof count === 'object' ? count.low : Number(count) || 0;
}

/**
 * Get entity count for a user
 */
export async function getEntityCount(userId: string): Promise<number> {
  if (!neo4jClient.isNeo4jEnabled()) return 0;

  const cypher = `
    MATCH (e:Entity {userId: $userId})
    RETURN count(e) as count
  `;

  const result = await neo4jClient.readQuery<{ count: { low: number } | number }>(cypher, { userId });
  const count = result[0]?.count;
  return typeof count === 'object' ? count.low : Number(count) || 0;
}

/**
 * Get top entities by mention count
 */
export async function getTopEntities(
  userId: string,
  limit: number = 10
): Promise<EntityNode[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (e:Entity {userId: $userId})
    RETURN e.userId as userId, e.label as label, e.type as type,
           e.origin as origin, e.confidence as confidence,
           e.mentionCount as mentionCount, e.lastMentioned as lastMentioned
    ORDER BY e.mentionCount DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    userId: string;
    label: string;
    type: string;
    origin: string;
    confidence: number;
    mentionCount: { low: number } | number;
    lastMentioned: string;
  }>(cypher, { userId, limit });

  return result.map(r => ({
    userId: r.userId,
    label: r.label,
    type: r.type,
    origin: r.origin,
    confidence: r.confidence,
    mentionCount: typeof r.mentionCount === 'object' ? r.mentionCount.low : Number(r.mentionCount),
    lastMentioned: new Date(r.lastMentioned),
  }));
}

/**
 * Get top topics by mention count
 */
export async function getTopTopics(
  userId: string,
  limit: number = 10
): Promise<TopicNode[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (t:Topic {userId: $userId})
    RETURN t.userId as userId, t.name as name,
           t.mentionCount as mentionCount, t.lastMentioned as lastMentioned
    ORDER BY t.mentionCount DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    userId: string;
    name: string;
    mentionCount: { low: number } | number;
    lastMentioned: string;
  }>(cypher, { userId, limit });

  return result.map(r => ({
    userId: r.userId,
    name: r.name,
    mentionCount: typeof r.mentionCount === 'object' ? r.mentionCount.low : Number(r.mentionCount),
    lastMentioned: new Date(r.lastMentioned),
  }));
}

export default {
  syncEntityToGraph,
  syncTopicToGraph,
  recordCoOccurrence,
  recordTopicCoOccurrence,
  getTopicCoOccurrences,
  getEntityCoOccurrences,
  getStrongCoOccurrences,
  getTopicCount,
  getEntityCount,
  getTopEntities,
  getTopTopics,
};
