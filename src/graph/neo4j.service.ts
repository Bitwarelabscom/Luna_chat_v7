/**
 * Neo4j Service
 * High-level graph operations orchestration
 */

import * as neo4jClient from './neo4j.client.js';
import * as intentGraphService from './intent-graph.service.js';
import * as knowledgeGraphService from './knowledge-graph.service.js';
import * as entityGraphService from './entity-graph.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface GraphContext {
  intents: {
    activeCount: number;
    blockingChains: Array<{ intentId: string; blockers: string[] }>;
    relatedIntents: Array<{ id: string; label: string; relation: string }>;
  };
  knowledge: {
    factCount: number;
    topCategories: Array<{ category: string; count: number }>;
    recentAssociations: Array<{ fact1: string; fact2: string; strength: number }>;
  };
  entities: {
    topicCount: number;
    entityCount: number;
    strongCoOccurrences: Array<{ entity1: string; entity2: string; count: number }>;
  };
}

export interface GraphHealthStatus {
  connected: boolean;
  nodeCount: number;
  relationshipCount: number;
  labels: Record<string, number>;
  lastSync?: Date;
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize Neo4j service - creates schema and verifies connectivity
 */
export async function initialize(): Promise<boolean> {
  if (!neo4jClient.isNeo4jEnabled()) {
    logger.info('Neo4j is disabled');
    return false;
  }

  try {
    // Initialize schema
    await neo4jClient.initializeSchema();

    // Verify connectivity
    const healthy = await neo4jClient.healthCheck();
    if (!healthy) {
      logger.warn('Neo4j health check failed');
      return false;
    }

    logger.info('Neo4j service initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize Neo4j service', { error: (error as Error).message });
    return false;
  }
}

// ============================================
// Graph Context Building
// ============================================

/**
 * Build local graph context for a user
 * This is used as a fallback when MemoryCore is unavailable
 */
export async function buildLocalGraphContext(userId: string): Promise<GraphContext | null> {
  if (!neo4jClient.isNeo4jEnabled()) return null;

  try {
    const [
      activeIntents,
      blockingChains,
      factCategories,
      recentAssociations,
      topicCount,
      entityCount,
      coOccurrences,
    ] = await Promise.all([
      intentGraphService.getActiveIntentCount(userId),
      intentGraphService.getAllBlockingChains(userId),
      knowledgeGraphService.getFactCategoryCounts(userId),
      knowledgeGraphService.getRecentAssociations(userId, 5),
      entityGraphService.getTopicCount(userId),
      entityGraphService.getEntityCount(userId),
      entityGraphService.getStrongCoOccurrences(userId, 5),
    ]);

    return {
      intents: {
        activeCount: activeIntents,
        blockingChains: blockingChains.slice(0, 5),
        relatedIntents: [], // Populated on-demand per intent
      },
      knowledge: {
        factCount: factCategories.reduce((sum, c) => sum + c.count, 0),
        topCategories: factCategories.slice(0, 5),
        recentAssociations,
      },
      entities: {
        topicCount,
        entityCount,
        strongCoOccurrences: coOccurrences,
      },
    };
  } catch (error) {
    logger.error('Failed to build local graph context', {
      error: (error as Error).message,
      userId,
    });
    return null;
  }
}

/**
 * Format local graph context for prompt injection
 */
export function formatLocalGraphContext(context: GraphContext | null): string {
  if (!context) return '';

  const parts: string[] = [];

  // Intent blocking chains
  if (context.intents.blockingChains.length > 0) {
    const chains = context.intents.blockingChains
      .map(c => `- Intent ${c.intentId.slice(0, 8)} blocked by: ${c.blockers.join(', ')}`)
      .join('\n');
    parts.push(`<intent_dependencies>\n${chains}\n</intent_dependencies>`);
  }

  // Strong co-occurrences
  if (context.entities.strongCoOccurrences.length > 0) {
    const coocs = context.entities.strongCoOccurrences
      .map(c => `- ${c.entity1} <-> ${c.entity2} (${c.count} times)`)
      .join('\n');
    parts.push(`<topic_associations>\n${coocs}\n</topic_associations>`);
  }

  // Fact associations
  if (context.knowledge.recentAssociations.length > 0) {
    const assocs = context.knowledge.recentAssociations
      .map(a => `- ${a.fact1} relates to ${a.fact2}`)
      .join('\n');
    parts.push(`<knowledge_links>\n${assocs}\n</knowledge_links>`);
  }

  if (parts.length === 0) return '';

  return `[Local Graph Memory]\n${parts.join('\n\n')}`;
}

// ============================================
// Health & Statistics
// ============================================

/**
 * Get graph health status
 */
export async function getHealthStatus(): Promise<GraphHealthStatus> {
  if (!neo4jClient.isNeo4jEnabled()) {
    return {
      connected: false,
      nodeCount: 0,
      relationshipCount: 0,
      labels: {},
    };
  }

  const connected = await neo4jClient.healthCheck();
  if (!connected) {
    return {
      connected: false,
      nodeCount: 0,
      relationshipCount: 0,
      labels: {},
    };
  }

  const stats = await neo4jClient.getStats();
  return {
    connected: true,
    nodeCount: stats?.nodeCount || 0,
    relationshipCount: stats?.relationshipCount || 0,
    labels: stats?.nodesByLabel || {},
  };
}

// ============================================
// Cleanup
// ============================================

/**
 * Close Neo4j connections
 */
export async function close(): Promise<void> {
  await neo4jClient.close();
}

export default {
  initialize,
  buildLocalGraphContext,
  formatLocalGraphContext,
  getHealthStatus,
  close,
};
