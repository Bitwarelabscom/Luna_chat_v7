/**
 * Neo4j Client
 * Driver connection management and query execution
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// ============================================
// Driver Singleton
// ============================================

let driver: Driver | null = null;

/**
 * Get or create the Neo4j driver instance
 */
function getDriver(): Driver | null {
  if (!config.neo4j?.enabled) {
    return null;
  }

  if (!driver) {
    try {
      driver = neo4j.driver(
        config.neo4j.uri,
        neo4j.auth.basic(config.neo4j.user, config.neo4j.password || ''),
        {
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 30000,
          connectionTimeout: 30000,
          maxTransactionRetryTime: 30000,
          logging: {
            level: 'warn',
            logger: (level, message) => logger.debug(`Neo4j ${level}: ${message}`),
          },
        }
      );
      logger.info('Neo4j driver initialized', { uri: config.neo4j.uri });
    } catch (error) {
      logger.error('Failed to create Neo4j driver', { error: (error as Error).message });
      return null;
    }
  }

  return driver;
}

/**
 * Check if Neo4j is available
 */
export function isNeo4jEnabled(): boolean {
  return Boolean(config.neo4j?.enabled && getDriver());
}

/**
 * Get a session for read operations
 */
export function getReadSession(): Session | null {
  const d = getDriver();
  if (!d) return null;
  return d.session({ defaultAccessMode: neo4j.session.READ });
}

/**
 * Get a session for write operations
 */
export function getWriteSession(): Session | null {
  const d = getDriver();
  if (!d) return null;
  return d.session({ defaultAccessMode: neo4j.session.WRITE });
}

// ============================================
// Query Execution Helpers
// ============================================

export interface Neo4jRecord {
  get(key: string): unknown;
  toObject(): Record<string, unknown>;
}

/**
 * Helper to convert Neo4j values (including Int64 objects) to standard JS numbers
 */
function toValue(val: any): any {
  if (val && typeof val === 'object' && 'low' in val && 'high' in val) {
    return val.low;
  }
  return val;
}

/**
 * Execute a read query and return results
 */
export async function readQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getReadSession();
  if (!session) return [];

  try {
    const result = await session.run(cypher, params);
    return result.records.map((record) => {
      const obj = record.toObject();
      // Convert any Neo4j integers in the result
      for (const key in obj) {
        obj[key] = toValue(obj[key]);
      }
      return obj as T;
    });
  } catch (error) {
    logger.error('Neo4j read query failed', {
      error: (error as Error).message,
      cypher: cypher.slice(0, 100),
    });
    return [];
  } finally {
    await session.close();
  }
}

/**
 * Execute a write query and return results
 */
export async function writeQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getWriteSession();
  if (!session) return [];

  try {
    const result = await session.run(cypher, params);
    return result.records.map((record) => {
      const obj = record.toObject();
      for (const key in obj) {
        obj[key] = toValue(obj[key]);
      }
      return obj as T;
    });
  } catch (error) {
    logger.error('Neo4j write query failed', {
      error: (error as Error).message,
      cypher: cypher.slice(0, 100),
    });
    return [];
  } finally {
    await session.close();
  }
}

/**
 * Execute a write query with no return value
 */
export async function writeQueryVoid(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<boolean> {
  const session = getWriteSession();
  if (!session) return false;

  try {
    await session.run(cypher, params);
    return true;
  } catch (error) {
    logger.error('Neo4j write query failed', {
      error: (error as Error).message,
      cypher: cypher.slice(0, 100),
    });
    return false;
  } finally {
    await session.close();
  }
}

/**
 * Execute multiple write queries in a transaction
 */
export async function writeTransaction(
  queries: Array<{ cypher: string; params?: Record<string, unknown> }>
): Promise<boolean> {
  const session = getWriteSession();
  if (!session) return false;

  const txc = session.beginTransaction();
  try {
    for (const { cypher, params } of queries) {
      await txc.run(cypher, params || {});
    }
    await txc.commit();
    return true;
  } catch (error) {
    await txc.rollback();
    logger.error('Neo4j transaction failed', { error: (error as Error).message });
    return false;
  } finally {
    await session.close();
  }
}

// ============================================
// Schema Initialization
// ============================================

/**
 * Initialize Neo4j schema with constraints and indexes
 */
export async function initializeSchema(): Promise<void> {
  if (!isNeo4jEnabled()) {
    logger.info('Neo4j disabled, skipping schema initialization');
    return;
  }

  const constraints = [
    // Intent uniqueness
    'CREATE CONSTRAINT intent_id IF NOT EXISTS FOR (i:Intent) REQUIRE i.id IS UNIQUE',
    // Fact uniqueness
    'CREATE CONSTRAINT fact_id IF NOT EXISTS FOR (f:Fact) REQUIRE f.id IS UNIQUE',
    // Topic uniqueness per user
    'CREATE CONSTRAINT topic_user_name IF NOT EXISTS FOR (t:Topic) REQUIRE (t.userId, t.name) IS UNIQUE',
    // Goal uniqueness
    'CREATE CONSTRAINT goal_id IF NOT EXISTS FOR (g:Goal) REQUIRE g.id IS UNIQUE',
    // Entity uniqueness per user
    'CREATE CONSTRAINT entity_user_label IF NOT EXISTS FOR (e:Entity) REQUIRE (e.userId, e.label) IS UNIQUE',
  ];

  const indexes = [
    // Intent indexes
    'CREATE INDEX intent_user_status IF NOT EXISTS FOR (i:Intent) ON (i.userId, i.status)',
    'CREATE INDEX intent_type IF NOT EXISTS FOR (i:Intent) ON (i.type)',
    // Fact indexes
    'CREATE INDEX fact_user_category IF NOT EXISTS FOR (f:Fact) ON (f.userId, f.category)',
    // Entity indexes
    'CREATE INDEX entity_user_type IF NOT EXISTS FOR (e:Entity) ON (e.userId, e.type)',
    // Topic indexes
    'CREATE INDEX topic_user IF NOT EXISTS FOR (t:Topic) ON (t.userId)',
  ];

  for (const constraint of constraints) {
    try {
      await writeQueryVoid(constraint);
    } catch (error) {
      // Constraint might already exist
      logger.debug('Constraint creation skipped', { error: (error as Error).message });
    }
  }

  for (const index of indexes) {
    try {
      await writeQueryVoid(index);
    } catch (error) {
      // Index might already exist
      logger.debug('Index creation skipped', { error: (error as Error).message });
    }
  }

  logger.info('Neo4j schema initialized');
}

// ============================================
// Health Check
// ============================================

/**
 * Check Neo4j connectivity
 */
export async function healthCheck(): Promise<boolean> {
  if (!isNeo4jEnabled()) return true; // Consider disabled as healthy

  try {
    const result = await readQuery<{ n: number }>('RETURN 1 as n');
    return result.length > 0 && result[0].n === 1;
  } catch {
    return false;
  }
}

/**
 * Get Neo4j statistics
 */
export async function getStats(): Promise<{
  nodeCount: number;
  relationshipCount: number;
  nodesByLabel: Record<string, number>;
} | null> {
  if (!isNeo4jEnabled()) return null;

  try {
    // Get total counts
    const countResult = await readQuery<{ nodes: number; rels: number }>(
      `MATCH (n) WITH count(n) as nodes
       MATCH ()-[r]->() WITH nodes, count(r) as rels
       RETURN nodes, rels`
    );

    // Get counts by label
    const labelResult = await readQuery<{ label: string; count: number }>(
      `CALL db.labels() YIELD label
       CALL { WITH label MATCH (n) WHERE label IN labels(n) RETURN count(n) as count }
       RETURN label, count`
    );

    const nodesByLabel: Record<string, number> = {};
    for (const row of labelResult) {
      nodesByLabel[row.label] = row.count;
    }

    return {
      nodeCount: countResult[0]?.nodes || 0,
      relationshipCount: countResult[0]?.rels || 0,
      nodesByLabel,
    };
  } catch (error) {
    logger.error('Failed to get Neo4j stats', { error: (error as Error).message });
    return null;
  }
}

// ============================================
// Cleanup
// ============================================

/**
 * Close the Neo4j driver connection
 */
export async function close(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    logger.info('Neo4j driver closed');
  }
}

export default {
  isNeo4jEnabled,
  getReadSession,
  getWriteSession,
  readQuery,
  writeQuery,
  writeQueryVoid,
  writeTransaction,
  initializeSchema,
  healthCheck,
  getStats,
  close,
};
