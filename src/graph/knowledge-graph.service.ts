/**
 * Knowledge Graph Service
 * Graph operations for facts and knowledge associations
 */

import * as neo4jClient from './neo4j.client.js';
import type { UserFact } from '../memory/facts.service.js';

// ============================================
// Types
// ============================================

export interface FactNode {
  id: string;
  userId: string;
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  mentionCount: number;
  lastMentioned: Date;
}

export interface FactNetwork {
  centralFact: FactNode;
  relatedFacts: FactNode[];
  associations: Array<{
    factId1: string;
    factId2: string;
    strength: number;
  }>;
}

// ============================================
// Sync Operations
// ============================================

/**
 * Sync a fact to Neo4j
 */
export async function syncFactToGraph(userId: string, fact: UserFact): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MERGE (f:Fact {id: $id})
    SET f.userId = $userId,
        f.category = $category,
        f.factKey = $factKey,
        f.factValue = $factValue,
        f.confidence = $confidence,
        f.mentionCount = $mentionCount,
        f.lastMentioned = datetime($lastMentioned),
        f.updatedAt = datetime()
    RETURN f
  `;

  return neo4jClient.writeQueryVoid(cypher, {
    id: fact.id,
    userId,
    category: fact.category,
    factKey: fact.factKey,
    factValue: fact.factValue,
    confidence: fact.confidence,
    mentionCount: fact.mentionCount,
    lastMentioned: fact.lastMentioned.toISOString(),
  });
}

/**
 * Create or strengthen an association between two facts
 */
export async function createFactAssociation(
  factId1: string,
  factId2: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MATCH (f1:Fact {id: $factId1})
    MATCH (f2:Fact {id: $factId2})
    MERGE (f1)-[r:ASSOCIATED_WITH]-(f2)
    ON CREATE SET r.strength = 1, r.createdAt = datetime()
    ON MATCH SET r.strength = r.strength + 1, r.updatedAt = datetime()
    RETURN r
  `;

  return neo4jClient.writeQueryVoid(cypher, { factId1, factId2 });
}

/**
 * Link a fact to an intent
 */
export async function linkFactToIntent(
  factId: string,
  intentId: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MATCH (f:Fact {id: $factId})
    MATCH (i:Intent {id: $intentId})
    MERGE (f)-[r:SUPPORTS_INTENT]->(i)
    SET r.createdAt = datetime()
    RETURN r
  `;

  return neo4jClient.writeQueryVoid(cypher, { factId, intentId });
}

// ============================================
// Query Operations
// ============================================

/**
 * Get fact network - a fact and its related facts by association
 */
export async function getFactNetwork(
  userId: string,
  factId: string,
  maxDepth: number = 3
): Promise<FactNetwork | null> {
  if (!neo4jClient.isNeo4jEnabled()) return null;

  // Get central fact
  const centralCypher = `
    MATCH (f:Fact {id: $factId, userId: $userId})
    RETURN f.id as id, f.userId as userId, f.category as category,
           f.factKey as factKey, f.factValue as factValue, f.confidence as confidence,
           f.mentionCount as mentionCount, f.lastMentioned as lastMentioned
  `;

  const centralResult = await neo4jClient.readQuery<{
    id: string;
    userId: string;
    category: string;
    factKey: string;
    factValue: string;
    confidence: number;
    mentionCount: { low: number } | number;
    lastMentioned: string;
  }>(centralCypher, { factId, userId });

  if (centralResult.length === 0) return null;

  const central = centralResult[0];
  const centralFact: FactNode = {
    id: central.id,
    userId: central.userId,
    category: central.category,
    factKey: central.factKey,
    factValue: central.factValue,
    confidence: central.confidence,
    mentionCount: typeof central.mentionCount === 'object' ? central.mentionCount.low : Number(central.mentionCount),
    lastMentioned: new Date(central.lastMentioned),
  };

  // Get related facts
  const relatedCypher = `
    MATCH (f:Fact {id: $factId})-[r:ASSOCIATED_WITH*1..${maxDepth}]-(related:Fact)
    WHERE related.userId = $userId
    RETURN DISTINCT related.id as id, related.userId as userId, related.category as category,
           related.factKey as factKey, related.factValue as factValue, related.confidence as confidence,
           related.mentionCount as mentionCount, related.lastMentioned as lastMentioned
    ORDER BY related.confidence DESC
    LIMIT 20
  `;

  const relatedResult = await neo4jClient.readQuery<{
    id: string;
    userId: string;
    category: string;
    factKey: string;
    factValue: string;
    confidence: number;
    mentionCount: { low: number } | number;
    lastMentioned: string;
  }>(relatedCypher, { factId, userId });

  const relatedFacts = relatedResult.map(r => ({
    id: r.id,
    userId: r.userId,
    category: r.category,
    factKey: r.factKey,
    factValue: r.factValue,
    confidence: r.confidence,
    mentionCount: typeof r.mentionCount === 'object' ? r.mentionCount.low : Number(r.mentionCount),
    lastMentioned: new Date(r.lastMentioned),
  }));

  // Get associations
  const assocCypher = `
    MATCH (f:Fact {id: $factId})-[r:ASSOCIATED_WITH*1..${maxDepth}]-(related:Fact)
    WHERE related.userId = $userId
    WITH f, related
    MATCH (f)-[a:ASSOCIATED_WITH]-(related)
    RETURN f.id as factId1, related.id as factId2, a.strength as strength
  `;

  const assocResult = await neo4jClient.readQuery<{
    factId1: string;
    factId2: string;
    strength: { low: number } | number;
  }>(assocCypher, { factId, userId });

  const associations = assocResult.map(a => ({
    factId1: a.factId1,
    factId2: a.factId2,
    strength: typeof a.strength === 'object' ? a.strength.low : Number(a.strength),
  }));

  return {
    centralFact,
    relatedFacts,
    associations,
  };
}

/**
 * Find facts related to a query string
 */
export async function findRelatedFacts(
  userId: string,
  query: string,
  limit: number = 10
): Promise<FactNode[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  // Simple text search on factKey and factValue
  const cypher = `
    MATCH (f:Fact {userId: $userId})
    WHERE toLower(f.factKey) CONTAINS toLower($query)
       OR toLower(f.factValue) CONTAINS toLower($query)
    RETURN f.id as id, f.userId as userId, f.category as category,
           f.factKey as factKey, f.factValue as factValue, f.confidence as confidence,
           f.mentionCount as mentionCount, f.lastMentioned as lastMentioned
    ORDER BY f.confidence DESC, f.mentionCount DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    id: string;
    userId: string;
    category: string;
    factKey: string;
    factValue: string;
    confidence: number;
    mentionCount: { low: number } | number;
    lastMentioned: string;
  }>(cypher, { userId, query, limit });

  return result.map(r => ({
    id: r.id,
    userId: r.userId,
    category: r.category,
    factKey: r.factKey,
    factValue: r.factValue,
    confidence: r.confidence,
    mentionCount: typeof r.mentionCount === 'object' ? r.mentionCount.low : Number(r.mentionCount),
    lastMentioned: new Date(r.lastMentioned),
  }));
}

/**
 * Get fact counts by category for a user
 */
export async function getFactCategoryCounts(
  userId: string
): Promise<Array<{ category: string; count: number }>> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (f:Fact {userId: $userId})
    RETURN f.category as category, count(f) as count
    ORDER BY count DESC
  `;

  const result = await neo4jClient.readQuery<{
    category: string;
    count: { low: number } | number;
  }>(cypher, { userId });

  return result.map(r => ({
    category: r.category,
    count: typeof r.count === 'object' ? r.count.low : Number(r.count),
  }));
}

/**
 * Get recent fact associations
 */
export async function getRecentAssociations(
  userId: string,
  limit: number = 10
): Promise<Array<{ fact1: string; fact2: string; strength: number }>> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (f1:Fact {userId: $userId})-[r:ASSOCIATED_WITH]-(f2:Fact)
    WHERE f1.id < f2.id  // Avoid duplicates
    RETURN f1.factKey + ': ' + f1.factValue as fact1,
           f2.factKey + ': ' + f2.factValue as fact2,
           r.strength as strength
    ORDER BY r.updatedAt DESC, r.strength DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    fact1: string;
    fact2: string;
    strength: { low: number } | number;
  }>(cypher, { userId, limit });

  return result.map(r => ({
    fact1: r.fact1,
    fact2: r.fact2,
    strength: typeof r.strength === 'object' ? r.strength.low : Number(r.strength),
  }));
}

/**
 * Remove a fact from the graph
 */
export async function removeFactFromGraph(factId: string): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const cypher = `
    MATCH (f:Fact {id: $factId})
    DETACH DELETE f
  `;

  return neo4jClient.writeQueryVoid(cypher, { factId });
}

export default {
  syncFactToGraph,
  createFactAssociation,
  linkFactToIntent,
  getFactNetwork,
  findRelatedFacts,
  getFactCategoryCounts,
  getRecentAssociations,
  removeFactFromGraph,
};
