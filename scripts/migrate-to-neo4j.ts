/**
 * Initial Migration Script: PostgreSQL -> Neo4j
 *
 * This script performs a one-time migration of existing data from PostgreSQL
 * to Neo4j graph database. Run this after setting up the Neo4j service.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-neo4j.ts
 *   # or with npm
 *   npm run migrate:neo4j
 *
 * The script will:
 * 1. Initialize Neo4j schema (constraints and indexes)
 * 2. Migrate active intents and their relations
 * 3. Migrate active facts
 * 4. Extract and migrate topics from session logs
 */

import { Pool } from 'pg';
import neo4j, { Driver } from 'neo4j-driver';

// ============================================
// Configuration
// ============================================

const POSTGRES_CONFIG = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'luna',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DB || 'luna_chat',
};

const NEO4J_CONFIG = {
  uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  user: process.env.NEO4J_USER || 'neo4j',
  password: process.env.NEO4J_PASSWORD || '',
};

// ============================================
// Database Connections
// ============================================

let pgPool: Pool;
let neo4jDriver: Driver;

async function connectDatabases(): Promise<void> {
  console.log('Connecting to databases...');

  // PostgreSQL
  pgPool = new Pool(POSTGRES_CONFIG);
  await pgPool.query('SELECT 1');
  console.log('  PostgreSQL: Connected');

  // Neo4j
  neo4jDriver = neo4j.driver(
    NEO4J_CONFIG.uri,
    neo4j.auth.basic(NEO4J_CONFIG.user, NEO4J_CONFIG.password)
  );
  const session = neo4jDriver.session();
  await session.run('RETURN 1');
  await session.close();
  console.log('  Neo4j: Connected');
}

async function closeDatabases(): Promise<void> {
  await pgPool.end();
  await neo4jDriver.close();
}

// ============================================
// Schema Initialization
// ============================================

async function initializeSchema(): Promise<void> {
  console.log('\nInitializing Neo4j schema...');
  const session = neo4jDriver.session();

  const constraints = [
    'CREATE CONSTRAINT intent_id IF NOT EXISTS FOR (i:Intent) REQUIRE i.id IS UNIQUE',
    'CREATE CONSTRAINT fact_id IF NOT EXISTS FOR (f:Fact) REQUIRE f.id IS UNIQUE',
    'CREATE CONSTRAINT topic_user_name IF NOT EXISTS FOR (t:Topic) REQUIRE (t.userId, t.name) IS UNIQUE',
    'CREATE CONSTRAINT goal_id IF NOT EXISTS FOR (g:Goal) REQUIRE g.id IS UNIQUE',
    'CREATE CONSTRAINT entity_user_label IF NOT EXISTS FOR (e:Entity) REQUIRE (e.userId, e.label) IS UNIQUE',
  ];

  const indexes = [
    'CREATE INDEX intent_user_status IF NOT EXISTS FOR (i:Intent) ON (i.userId, i.status)',
    'CREATE INDEX intent_type IF NOT EXISTS FOR (i:Intent) ON (i.type)',
    'CREATE INDEX fact_user_category IF NOT EXISTS FOR (f:Fact) ON (f.userId, f.category)',
    'CREATE INDEX entity_user_type IF NOT EXISTS FOR (e:Entity) ON (e.userId, e.type)',
    'CREATE INDEX topic_user IF NOT EXISTS FOR (t:Topic) ON (t.userId)',
  ];

  try {
    for (const constraint of constraints) {
      try {
        await session.run(constraint);
        console.log(`  Created: ${constraint.split(' ')[2]}`);
      } catch {
        console.log(`  Exists: ${constraint.split(' ')[2]}`);
      }
    }

    for (const index of indexes) {
      try {
        await session.run(index);
        console.log(`  Created: ${index.split(' ')[2]}`);
      } catch {
        console.log(`  Exists: ${index.split(' ')[2]}`);
      }
    }
  } finally {
    await session.close();
  }
}

// ============================================
// Intent Migration
// ============================================

async function migrateIntents(): Promise<number> {
  console.log('\nMigrating intents...');
  const session = neo4jDriver.session();

  try {
    // Get active and suspended intents
    const result = await pgPool.query(`
      SELECT * FROM user_intents
      WHERE status IN ('active', 'suspended')
      ORDER BY user_id, created_at
    `);

    let migrated = 0;
    for (const row of result.rows) {
      await session.run(
        `MERGE (i:Intent {id: $id})
         SET i.userId = $userId,
             i.type = $type,
             i.label = $label,
             i.status = $status,
             i.priority = $priority,
             i.goal = $goal,
             i.createdAt = datetime($createdAt),
             i.lastTouchedAt = datetime($lastTouchedAt),
             i.updatedAt = datetime()`,
        {
          id: row.id,
          userId: row.user_id,
          type: row.type,
          label: row.label,
          status: row.status,
          priority: row.priority,
          goal: row.goal || '',
          createdAt: row.created_at.toISOString(),
          lastTouchedAt: row.last_touched_at.toISOString(),
        }
      );
      migrated++;

      if (migrated % 100 === 0) {
        console.log(`  Migrated ${migrated} intents...`);
      }
    }

    console.log(`  Total intents migrated: ${migrated}`);
    return migrated;
  } finally {
    await session.close();
  }
}

// ============================================
// Intent Relations Migration
// ============================================

async function migrateIntentRelations(): Promise<number> {
  console.log('\nMigrating intent relations...');
  const session = neo4jDriver.session();

  const relationshipTypes: Record<string, string> = {
    blocks: 'BLOCKS',
    depends_on: 'DEPENDS_ON',
    related_to: 'RELATED_TO',
    supersedes: 'SUPERSEDES',
    subtask_of: 'HAS_PARENT',
  };

  try {
    const result = await pgPool.query(`
      SELECT ir.* FROM intent_relations ir
      JOIN user_intents ui ON ir.from_intent_id = ui.id
      WHERE ui.status IN ('active', 'suspended')
    `);

    let migrated = 0;
    for (const row of result.rows) {
      const relType = relationshipTypes[row.relation_type] || 'RELATED_TO';

      await session.run(
        `MATCH (from:Intent {id: $fromId})
         MATCH (to:Intent {id: $toId})
         MERGE (from)-[r:${relType}]->(to)
         SET r.createdAt = datetime()`,
        {
          fromId: row.from_intent_id,
          toId: row.to_intent_id,
        }
      );
      migrated++;
    }

    console.log(`  Total relations migrated: ${migrated}`);
    return migrated;
  } finally {
    await session.close();
  }
}

// ============================================
// Facts Migration
// ============================================

async function migrateFacts(): Promise<number> {
  console.log('\nMigrating facts...');
  const session = neo4jDriver.session();

  try {
    const result = await pgPool.query(`
      SELECT * FROM user_facts
      WHERE is_active = true
      ORDER BY user_id, category
    `);

    let migrated = 0;
    for (const row of result.rows) {
      await session.run(
        `MERGE (f:Fact {id: $id})
         SET f.userId = $userId,
             f.category = $category,
             f.factKey = $factKey,
             f.factValue = $factValue,
             f.confidence = $confidence,
             f.mentionCount = $mentionCount,
             f.lastMentioned = datetime($lastMentioned),
             f.updatedAt = datetime()`,
        {
          id: row.id,
          userId: row.user_id,
          category: row.category,
          factKey: row.fact_key,
          factValue: row.fact_value,
          confidence: parseFloat(row.confidence),
          mentionCount: row.mention_count,
          lastMentioned: row.last_mentioned.toISOString(),
        }
      );
      migrated++;

      if (migrated % 100 === 0) {
        console.log(`  Migrated ${migrated} facts...`);
      }
    }

    console.log(`  Total facts migrated: ${migrated}`);
    return migrated;
  } finally {
    await session.close();
  }
}

// ============================================
// Topics Migration
// ============================================

async function migrateTopics(): Promise<number> {
  console.log('\nMigrating topics from session logs...');
  const session = neo4jDriver.session();

  try {
    const result = await pgPool.query(`
      SELECT user_id, unnest(topics) as topic, count(*) as mention_count
      FROM session_logs
      WHERE topics IS NOT NULL AND array_length(topics, 1) > 0
      GROUP BY user_id, unnest(topics)
      ORDER BY user_id, mention_count DESC
    `);

    let migrated = 0;
    for (const row of result.rows) {
      if (row.topic) {
        await session.run(
          `MERGE (t:Topic {userId: $userId, name: $name})
           SET t.mentionCount = $mentionCount,
               t.lastMentioned = datetime(),
               t.updatedAt = datetime()`,
          {
            userId: row.user_id,
            name: row.topic,
            mentionCount: parseInt(row.mention_count, 10),
          }
        );
        migrated++;
      }
    }

    console.log(`  Total topics migrated: ${migrated}`);
    return migrated;
  } finally {
    await session.close();
  }
}

// ============================================
// Goals Migration (from autonomous_goals if exists)
// ============================================

async function migrateGoals(): Promise<number> {
  console.log('\nMigrating autonomous goals...');
  const session = neo4jDriver.session();

  try {
    // Check if autonomous_goals table exists
    const tableCheck = await pgPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'autonomous_goals'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('  Skipped: autonomous_goals table does not exist');
      return 0;
    }

    const result = await pgPool.query(`
      SELECT * FROM autonomous_goals
      WHERE status IN ('active', 'in_progress')
      ORDER BY user_id, created_at
    `);

    let migrated = 0;
    for (const row of result.rows) {
      await session.run(
        `MERGE (g:Goal {id: $id})
         SET g.userId = $userId,
             g.title = $title,
             g.goalType = $goalType,
             g.status = $status,
             g.createdAt = datetime($createdAt),
             g.updatedAt = datetime()`,
        {
          id: row.id,
          userId: row.user_id,
          title: row.title,
          goalType: row.goal_type,
          status: row.status,
          createdAt: row.created_at.toISOString(),
        }
      );
      migrated++;
    }

    console.log(`  Total goals migrated: ${migrated}`);
    return migrated;
  } finally {
    await session.close();
  }
}

// ============================================
// Main Migration
// ============================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Neo4j Migration Script');
  console.log('='.repeat(60));

  const startTime = Date.now();

  try {
    await connectDatabases();
    await initializeSchema();

    const results = {
      intents: await migrateIntents(),
      relations: await migrateIntentRelations(),
      facts: await migrateFacts(),
      topics: await migrateTopics(),
      goals: await migrateGoals(),
    };

    const duration = (Date.now() - startTime) / 1000;

    console.log('\n' + '='.repeat(60));
    console.log('Migration Complete!');
    console.log('='.repeat(60));
    console.log(`  Intents:    ${results.intents}`);
    console.log(`  Relations:  ${results.relations}`);
    console.log(`  Facts:      ${results.facts}`);
    console.log(`  Topics:     ${results.topics}`);
    console.log(`  Goals:      ${results.goals}`);
    console.log(`  Duration:   ${duration.toFixed(2)}s`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\nMigration failed:', (error as Error).message);
    process.exit(1);
  } finally {
    await closeDatabases();
  }
}

main();
