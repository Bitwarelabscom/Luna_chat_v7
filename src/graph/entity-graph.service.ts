/**
 * Entity Graph Service
 * Graph operations for entity co-occurrence and associations
 */

import * as neo4jClient from './neo4j.client.js';

// ============================================
// Stopword & Noise Filtering
// ============================================

const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'be', 'as', 'do', 'no', 'not', 'so',
  'up', 'he', 'she', 'we', 'my', 'me', 'us', 'am', 'are', 'was', 'has', 'had',
  'did', 'may', 'can', 'its', 'his', 'her', 'our', 'who', 'how', 'all', 'any',
  'few', 'get', 'got', 'let', 'say', 'too', 'use', 'way', 'new', 'now', 'old',
  'see', 'out', 'own', 'put', 'run', 'set', 'try', 'why', 'big', 'end', 'far',
  'yes', 'yet', 'also', 'back', 'been', 'both', 'come', 'each', 'even', 'find',
  'give', 'good', 'have', 'here', 'high', 'into', 'just', 'keep', 'know', 'last',
  'like', 'long', 'look', 'made', 'make', 'many', 'more', 'most', 'much', 'must',
  'need', 'next', 'only', 'over', 'part', 'same', 'seem', 'show', 'side', 'some',
  'such', 'sure', 'take', 'tell', 'than', 'that', 'them', 'then', 'they', 'this',
  'time', 'turn', 'used', 'very', 'want', 'well', 'went', 'were', 'what', 'when',
  'will', 'with', 'work', 'year', 'yeah', 'okay', 'thing', 'think', 'going',
  'right', 'about', 'could', 'would', 'should', 'there', 'their', 'these',
  'those', 'which', 'while', 'after', 'again', 'being', 'other', 'where',
  'still', 'really', 'maybe', 'actually', 'basically', 'literally',
  // Common verb artifacts that leak through as entities
  'pick', 'call', 'play', 'hold', 'move', 'live', 'love', 'hate',
  'help', 'feel', 'talk', 'read', 'hear', 'send', 'open', 'close',
  'pull', 'push', 'drop', 'fill', 'hang', 'join', 'mark', 'miss',
  'pass', 'plan', 'post', 'rest', 'roll', 'save', 'sign', 'sing',
  'sit', 'step', 'test', 'type', 'view', 'vote', 'walk', 'wash',
  'note', 'line', 'link', 'list', 'page', 'point', 'check',
  'start', 'stop', 'watch', 'wait', 'leave', 'bring', 'build',
  'write', 'speak', 'learn', 'share', 'place', 'change', 'follow',
]);

const SWEDISH_STOPWORDS = new Set([
  'och', 'det', 'att', 'som', 'en', 'av', 'den', 'har', 'jag', 'hon', 'han',
  'med', 'var', 'sig', 'men', 'ett', 'kan', 'ska', 'vid', 'nog', 'nej', 'sin',
  'alla', 'inte', 'hade', 'vad', 'vet', 'dom', 'dem', 'vara', 'hur', 'mer',
  'man', 'oss', 'min', 'dig', 'mig', 'din', 'typ', 'ser', 'ger', 'tar', 'far',
  'gar', 'nar', 'sen', 'iaf', 'vill', 'bara', 'lite', 'aven', 'helt', 'alla',
  'hade', 'hans', 'hela', 'inget', 'eller', 'efter', 'sedan', 'inte', 'fick',
  'mitt', 'ditt', 'denna', 'detta', 'dessa', 'vilka', 'vilken', 'vilket',
  'redan', 'ganska', 'liksom', 'faktiskt', 'egentligen',
]);

const MIN_ENTITY_LENGTH = 3;

/**
 * Check if a label/name is a stopword or noise
 */
export function isNoiseToken(text: string): boolean {
  if (!text || text.length < MIN_ENTITY_LENGTH) return true;
  const lower = text.toLowerCase().trim();
  if (lower.length < MIN_ENTITY_LENGTH) return true;
  if (ENGLISH_STOPWORDS.has(lower)) return true;
  if (SWEDISH_STOPWORDS.has(lower)) return true;
  // Reject purely numeric tokens
  if (/^\d+$/.test(lower)) return true;
  // Reject single repeated characters like "aaa"
  if (/^(.)\1+$/.test(lower)) return true;
  return false;
}

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
  if (isNoiseToken(entity.label)) return false;

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
  if (isNoiseToken(topic.name)) return false;

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
  if (isNoiseToken(entity1) || isNoiseToken(entity2)) return false;
  if (entity1.toLowerCase() === entity2.toLowerCase()) return false;

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
  if (isNoiseToken(topic1) || isNoiseToken(topic2)) return false;
  if (topic1.toLowerCase() === topic2.toLowerCase()) return false;

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
    WHERE size(t2.name) >= 3 AND t1.name <> t2.name
    RETURN t1.name as entity1, t2.name as entity2, r.count as count
    ORDER BY r.count DESC
    LIMIT 20
  `;

  const result = await neo4jClient.readQuery<{
    entity1: string;
    entity2: string;
    count: { low: number } | number;
  }>(cypher, { userId, topic });

  return result
    .map(r => ({
      entity1: r.entity1,
      entity2: r.entity2,
      count: typeof r.count === 'object' ? r.count.low : Number(r.count),
    }))
    .filter(r => !isNoiseToken(r.entity1) && !isNoiseToken(r.entity2));
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
    WHERE size(e2.label) >= 3 AND e1.label <> e2.label
    RETURN e1.label as entity1, e2.label as entity2, r.count as count
    ORDER BY r.count DESC
    LIMIT 20
  `;

  const result = await neo4jClient.readQuery<{
    entity1: string;
    entity2: string;
    count: { low: number } | number;
  }>(cypher, { userId, entity });

  return result
    .map(r => ({
      entity1: r.entity1,
      entity2: r.entity2,
      count: typeof r.count === 'object' ? r.count.low : Number(r.count),
    }))
    .filter(r => !isNoiseToken(r.entity1) && !isNoiseToken(r.entity2));
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
    WHERE r.count >= $minCount
      AND e1.label < e2.label
      AND e1.label <> e2.label
      AND size(e1.label) >= 3
      AND size(e2.label) >= 3
    RETURN e1.label as entity1, e2.label as entity2, r.count as count
    ORDER BY r.count DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    entity1: string;
    entity2: string;
    count: { low: number } | number;
  }>(cypher, { userId, limit, minCount });

  return result
    .map(r => ({
      entity1: r.entity1,
      entity2: r.entity2,
      count: typeof r.count === 'object' ? r.count.low : Number(r.count),
    }))
    .filter(r => !isNoiseToken(r.entity1) && !isNoiseToken(r.entity2));
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
    WHERE size(e.label) >= 3
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

  return result
    .map(r => ({
      userId: r.userId,
      label: r.label,
      type: r.type,
      origin: r.origin,
      confidence: r.confidence,
      mentionCount: typeof r.mentionCount === 'object' ? r.mentionCount.low : Number(r.mentionCount),
      lastMentioned: new Date(r.lastMentioned),
    }))
    .filter(r => !isNoiseToken(r.label));
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
    WHERE size(t.name) >= 3
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

  return result
    .map(r => ({
      userId: r.userId,
      name: r.name,
      mentionCount: typeof r.mentionCount === 'object' ? r.mentionCount.low : Number(r.mentionCount),
      lastMentioned: new Date(r.lastMentioned),
    }))
    .filter(r => !isNoiseToken(r.name));
}

/**
 * Purge existing noise nodes from Neo4j.
 * Deletes Topic/Entity nodes with short names and detaches their relationships.
 * Call once to clean up historical garbage, then the ingestion guards prevent new noise.
 */
export async function purgeNoiseNodes(): Promise<{ deletedTopics: number; deletedEntities: number }> {
  if (!neo4jClient.isNeo4jEnabled()) return { deletedTopics: 0, deletedEntities: 0 };

  // Build Cypher-compatible stopword list (lowercased)
  const allStopwords = [...ENGLISH_STOPWORDS, ...SWEDISH_STOPWORDS];

  const deleteTopicsCypher = `
    MATCH (t:Topic)
    WHERE size(t.name) < 3 OR toLower(t.name) IN $stopwords
    DETACH DELETE t
    RETURN count(*) as deleted
  `;

  const deleteEntitiesCypher = `
    MATCH (e:Entity)
    WHERE size(e.label) < 3 OR toLower(e.label) IN $stopwords
    DETACH DELETE e
    RETURN count(*) as deleted
  `;

  const topicResult = await neo4jClient.writeQuery<{ deleted: { low: number } | number }>(
    deleteTopicsCypher, { stopwords: allStopwords }
  );
  const entityResult = await neo4jClient.writeQuery<{ deleted: { low: number } | number }>(
    deleteEntitiesCypher, { stopwords: allStopwords }
  );

  const deletedTopics = topicResult[0]?.deleted;
  const deletedEntities = entityResult[0]?.deleted;

  return {
    deletedTopics: typeof deletedTopics === 'object' ? deletedTopics.low : Number(deletedTopics) || 0,
    deletedEntities: typeof deletedEntities === 'object' ? deletedEntities.low : Number(deletedEntities) || 0,
  };
}

/**
 * Purge self-referencing co-occurrence relationships (X -> X)
 */
export async function purgeSelfReferences(): Promise<number> {
  if (!neo4jClient.isNeo4jEnabled()) return 0;

  const cypher = `
    MATCH (e1)-[r:CO_OCCURS_WITH]-(e2)
    WHERE e1 = e2
    DELETE r
    RETURN count(*) as deleted
  `;

  const result = await neo4jClient.writeQuery<{ deleted: { low: number } | number }>(cypher, {});
  const deleted = result[0]?.deleted;
  return typeof deleted === 'object' ? deleted.low : Number(deleted) || 0;
}

// ============================================
// Canvas Style Rules
// ============================================

/**
 * Store a canvas style rule in Neo4j
 * Style rules are stored as Topic nodes with "canvas_style:" prefix
 */
export async function syncCanvasStyleRule(
  userId: string,
  rule: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;
  if (!rule || rule.trim().length === 0) return false;

  // Use special prefix to distinguish style rules from regular topics
  const ruleName = `canvas_style:${rule.trim()}`;

  const cypher = `
    MERGE (t:Topic {userId: $userId, name: $ruleName})
    SET t.type = 'canvas_style_rule',
        t.mentionCount = COALESCE(t.mentionCount, 0) + 1,
        t.lastMentioned = datetime(),
        t.updatedAt = datetime()
    RETURN t
  `;

  return neo4jClient.writeQueryVoid(cypher, {
    userId,
    ruleName,
  });
}

/**
 * Get canvas style rules for a user
 * Returns up to `limit` most recent style rules
 */
export async function getCanvasStyleRules(
  userId: string,
  limit: number = 5
): Promise<string[]> {
  if (!neo4jClient.isNeo4jEnabled()) return [];

  const cypher = `
    MATCH (t:Topic {userId: $userId})
    WHERE t.name STARTS WITH 'canvas_style:'
    RETURN t.name as name, t.mentionCount as count, t.lastMentioned as lastMentioned
    ORDER BY t.lastMentioned DESC
    LIMIT $limit
  `;

  const result = await neo4jClient.readQuery<{
    name: string;
    count: { low: number } | number;
    lastMentioned: any;
  }>(cypher, { userId, limit });

  // Remove "canvas_style:" prefix from results
  return result
    .map(r => r.name.replace(/^canvas_style:/, ''))
    .filter(rule => rule.length > 0);
}

/**
 * Delete a canvas style rule
 */
export async function deleteCanvasStyleRule(
  userId: string,
  rule: string
): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) return false;

  const ruleName = `canvas_style:${rule.trim()}`;

  const cypher = `
    MATCH (t:Topic {userId: $userId, name: $ruleName})
    DETACH DELETE t
    RETURN count(*) as deleted
  `;

  return neo4jClient.writeQueryVoid(cypher, { userId, ruleName });
}

export default {
  isNoiseToken,
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
  purgeNoiseNodes,
  purgeSelfReferences,
  syncCanvasStyleRule,
  getCanvasStyleRules,
  deleteCanvasStyleRule,
};
