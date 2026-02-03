/**
 * Graph Module
 * Neo4j integration for local graph traversal
 */

export * as neo4jClient from './neo4j.client.js';
export * as neo4jService from './neo4j.service.js';
export * as intentGraphService from './intent-graph.service.js';
export * as knowledgeGraphService from './knowledge-graph.service.js';
export * as entityGraphService from './entity-graph.service.js';
export * as graphSyncService from './graph-sync.service.js';

// Re-export commonly used types
export type { IntentNode, IntentGraph } from './intent-graph.service.js';
export type { FactNode, FactNetwork } from './knowledge-graph.service.js';
export type { EntityNode, TopicNode, CoOccurrence } from './entity-graph.service.js';
export type { SyncResult } from './graph-sync.service.js';
export type { GraphContext, GraphHealthStatus } from './neo4j.service.js';
