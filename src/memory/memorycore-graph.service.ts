import { mcQuery, mcQueryOne } from '../db/memorycore-pool.js';
import { isNoiseToken } from '../graph/entity-graph.service.js';
import logger from '../utils/logger.js';

// Types matching MemoryCore's PostgreSQL schema
export interface GraphNode {
  id: string;
  nodeType: string;
  nodeLabel: string;
  origin: string;
  originConfidence: number;
  identityStatus: string;
  activationStrength: number;
  edgeCount: number;
  centralityScore: number;
  emotionalIntensity: number;
  isActive: boolean;
  createdAt: string;
  lastActivated: string;
  metadata: Record<string, unknown> | null;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  weight: number;
  strength: number;
  recency: number;
  trust: number;
  isActive: boolean;
  activationCount: number;
  distinctSessionCount: number;
}

export interface GraphOverview {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  topNodes: GraphNode[];
}

interface MergeLedgerEntry {
  id: string;
  source_node_id: string;
  target_node_id: string;
  merge_reason: string | null;
  created_at: Date;
}

function mapNodeRow(row: Record<string, unknown>): GraphNode {
  return {
    id: row.id as string,
    nodeType: row.node_type as string,
    nodeLabel: row.node_label as string,
    origin: (row.origin as string) || 'unknown',
    originConfidence: parseFloat((row.origin_confidence as string) ?? '0'),
    identityStatus: (row.identity_status as string) || 'unverified',
    activationStrength: parseFloat((row.activation_strength as string) ?? '0'),
    edgeCount: parseInt((row.edge_count as string) ?? '0'),
    centralityScore: parseFloat((row.centrality_score as string) ?? '0'),
    emotionalIntensity: parseFloat((row.emotional_intensity as string) ?? '0'),
    isActive: row.is_active as boolean,
    createdAt: (row.created_at as Date)?.toISOString() || '',
    lastActivated: (row.last_activated as Date)?.toISOString() || '',
    metadata: row.metadata as Record<string, unknown> | null,
  };
}

function mapEdgeRow(row: Record<string, unknown>): GraphEdge {
  return {
    id: row.id as string,
    sourceNodeId: row.source_node_id as string,
    targetNodeId: row.target_node_id as string,
    edgeType: row.edge_type as string,
    weight: parseFloat((row.weight as string) ?? '1'),
    strength: parseFloat((row.strength as string) ?? '0'),
    recency: parseFloat((row.recency as string) ?? '0'),
    trust: parseFloat((row.trust as string) ?? '0'),
    isActive: row.is_active as boolean,
    activationCount: parseInt((row.activation_count as string) ?? '0'),
    distinctSessionCount: parseInt((row.distinct_session_count as string) ?? '0'),
  };
}

/**
 * Get graph nodes with pagination and filters
 */
export async function getGraphNodes(
  userId: string,
  options: {
    limit?: number;
    offset?: number;
    type?: string;
    search?: string;
    sortBy?: string;
    minEdgeCount?: number;
  } = {}
): Promise<GraphNode[]> {
  const { limit = 100, offset = 0, type, search, sortBy = 'centrality_score', minEdgeCount } = options;

  try {
    const conditions = ['n.user_id = $1', 'n.is_active = true'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (type) {
      conditions.push(`n.node_type = $${paramIdx}`);
      params.push(type);
      paramIdx++;
    }

    if (search) {
      conditions.push(`n.node_label ILIKE $${paramIdx}`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (minEdgeCount !== undefined && minEdgeCount > 0) {
      conditions.push(`n.edge_count >= $${paramIdx}`);
      params.push(minEdgeCount);
      paramIdx++;
    }

    const validSortCols: Record<string, string> = {
      centrality_score: 'n.centrality_score DESC',
      edge_count: 'n.edge_count DESC',
      activation_strength: 'n.activation_strength DESC',
      created_at: 'n.created_at DESC',
      last_activated: 'n.last_activated DESC',
      node_label: 'n.node_label ASC',
    };
    const orderBy = validSortCols[sortBy] || validSortCols.centrality_score;

    params.push(limit, offset);

    const sql = `
      SELECT n.id, n.node_type, n.node_label, n.origin, n.origin_confidence,
             n.identity_status, n.activation_strength, n.edge_count,
             n.centrality_score, n.emotional_intensity, n.is_active,
             n.created_at, n.last_activated, n.metadata
      FROM memory_nodes n
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const rows = await mcQuery<Record<string, unknown>>(sql, params);
    return rows.map(mapNodeRow);
  } catch (error) {
    logger.error('Failed to get graph nodes', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get edges between a set of nodes
 */
export async function getGraphEdges(
  userId: string,
  options: {
    nodeIds?: string[];
    type?: string;
    minStrength?: number;
  } = {}
): Promise<GraphEdge[]> {
  const { nodeIds, type, minStrength = 0 } = options;

  try {
    const conditions = ['e.user_id = $1', 'e.is_active = true'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (nodeIds && nodeIds.length > 0) {
      conditions.push(`(e.source_node_id = ANY($${paramIdx}) OR e.target_node_id = ANY($${paramIdx}))`);
      params.push(nodeIds);
      paramIdx++;
    }

    if (type) {
      conditions.push(`e.edge_type = $${paramIdx}`);
      params.push(type);
      paramIdx++;
    }

    if (minStrength > 0) {
      conditions.push(`e.strength >= $${paramIdx}`);
      params.push(minStrength);
      paramIdx++;
    }

    // Only return edges where both endpoints are in our node set
    let extraJoin = '';
    if (nodeIds && nodeIds.length > 0) {
      extraJoin = `
        AND e.source_node_id = ANY($2)
        AND e.target_node_id = ANY($2)
      `;
    }

    const sql = `
      SELECT e.id, e.source_node_id, e.target_node_id, e.edge_type,
             e.weight, e.strength, e.recency, e.trust, e.is_active,
             e.activation_count, e.distinct_session_count
      FROM memory_edges e
      WHERE ${conditions.join(' AND ')}
      ${extraJoin}
      ORDER BY e.strength DESC
      LIMIT 2000
    `;

    const rows = await mcQuery<Record<string, unknown>>(sql, params);
    return rows.map(mapEdgeRow);
  } catch (error) {
    logger.error('Failed to get graph edges', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get neighbors of a specific node
 */
export async function getNodeNeighbors(
  nodeId: string,
  userId: string,
  options: { depth?: number; limit?: number } = {}
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const { limit = 30 } = options;

  try {
    // Get edges connected to this node
    const edgeSql = `
      SELECT e.id, e.source_node_id, e.target_node_id, e.edge_type,
             e.weight, e.strength, e.recency, e.trust, e.is_active,
             e.activation_count, e.distinct_session_count
      FROM memory_edges e
      WHERE e.user_id = $1 AND e.is_active = true
        AND (e.source_node_id = $2 OR e.target_node_id = $2)
      ORDER BY e.strength DESC
      LIMIT $3
    `;

    const edgeRows = await mcQuery<Record<string, unknown>>(edgeSql, [userId, nodeId, limit]);
    const edges = edgeRows.map(mapEdgeRow);

    // Collect all neighbor node IDs
    const neighborIds = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceNodeId !== nodeId) neighborIds.add(edge.sourceNodeId);
      if (edge.targetNodeId !== nodeId) neighborIds.add(edge.targetNodeId);
    }

    if (neighborIds.size === 0) return { nodes: [], edges: [] };

    // Fetch neighbor nodes
    const nodeSql = `
      SELECT n.id, n.node_type, n.node_label, n.origin, n.origin_confidence,
             n.identity_status, n.activation_strength, n.edge_count,
             n.centrality_score, n.emotional_intensity, n.is_active,
             n.created_at, n.last_activated, n.metadata
      FROM memory_nodes n
      WHERE n.id = ANY($1) AND n.is_active = true
    `;

    const nodeRows = await mcQuery<Record<string, unknown>>(nodeSql, [Array.from(neighborIds)]);
    const nodes = nodeRows.map(mapNodeRow);

    return { nodes, edges };
  } catch (error) {
    logger.error('Failed to get node neighbors', { error: (error as Error).message, nodeId });
    return { nodes: [], edges: [] };
  }
}

/**
 * Update a node's properties
 */
export async function updateNode(
  nodeId: string,
  userId: string,
  updates: { label?: string; type?: string; metadata?: Record<string, unknown> }
): Promise<GraphNode | null> {
  try {
    const setClauses: string[] = [];
    const params: unknown[] = [nodeId, userId];
    let paramIdx = 3;

    if (updates.label !== undefined) {
      setClauses.push(`node_label = $${paramIdx}`);
      params.push(updates.label);
      paramIdx++;
    }

    if (updates.type !== undefined) {
      setClauses.push(`node_type = $${paramIdx}`);
      params.push(updates.type);
      paramIdx++;
    }

    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIdx}`);
      params.push(JSON.stringify(updates.metadata));
      paramIdx++;
    }

    if (setClauses.length === 0) return null;

    setClauses.push('last_activated = NOW()');

    const sql = `
      UPDATE memory_nodes
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND user_id = $2
      RETURNING id, node_type, node_label, origin, origin_confidence,
                identity_status, activation_strength, edge_count,
                centrality_score, emotional_intensity, is_active,
                created_at, last_activated, metadata
    `;

    const row = await mcQueryOne<Record<string, unknown>>(sql, params);
    return row ? mapNodeRow(row) : null;
  } catch (error) {
    logger.error('Failed to update node', { error: (error as Error).message, nodeId });
    return null;
  }
}

/**
 * Soft-delete a node
 */
export async function deleteNode(nodeId: string, userId: string): Promise<boolean> {
  try {
    const sql = `
      UPDATE memory_nodes
      SET is_active = false, last_activated = NOW()
      WHERE id = $1 AND user_id = $2
    `;
    await mcQuery(sql, [nodeId, userId]);
    return true;
  } catch (error) {
    logger.error('Failed to delete node', { error: (error as Error).message, nodeId });
    return false;
  }
}

/**
 * Create a new edge between nodes.
 * On conflict: increments activation_count, tracks distinct sessions,
 * keeps the higher strength value, and updates last_activated.
 */
export async function createEdge(
  userId: string,
  data: { sourceId: string; targetId: string; type: string; strength?: number; sessionId?: string }
): Promise<GraphEdge | null> {
  try {
    const strength = data.strength ?? 0.5;
    const sessionId = data.sessionId || null;

    const sql = `
      INSERT INTO memory_edges (user_id, source_node_id, target_node_id, edge_type, strength, weight, metadata)
      VALUES ($1, $2, $3, $4, $5, $5, CASE WHEN $6::text IS NOT NULL THEN jsonb_build_object('sessions', jsonb_build_object($6::text, NOW())) ELSE '{}'::jsonb END)
      ON CONFLICT (user_id, source_node_id, target_node_id, edge_type) DO UPDATE SET
        activation_count = memory_edges.activation_count + 1,
        strength = GREATEST(memory_edges.strength, EXCLUDED.strength),
        distinct_session_count = CASE
          WHEN $6::text IS NOT NULL AND NOT (
            COALESCE(memory_edges.metadata->'sessions', '{}'::jsonb) ? $6::text
          ) THEN memory_edges.distinct_session_count + 1
          ELSE memory_edges.distinct_session_count
        END,
        metadata = CASE
          WHEN $6::text IS NOT NULL THEN
            jsonb_set(
              COALESCE(memory_edges.metadata, '{}'::jsonb),
              '{sessions}',
              COALESCE(memory_edges.metadata->'sessions', '{}'::jsonb)
                || jsonb_build_object($6::text, NOW())
            )
          ELSE COALESCE(memory_edges.metadata, '{}'::jsonb)
        END,
        last_activated = NOW()
      RETURNING id, source_node_id, target_node_id, edge_type,
                weight, strength, recency, trust, is_active,
                activation_count, distinct_session_count
    `;

    const row = await mcQueryOne<Record<string, unknown>>(sql, [
      userId, data.sourceId, data.targetId, data.type, strength, sessionId,
    ]);
    return row ? mapEdgeRow(row) : null;
  } catch (error) {
    logger.error('Failed to create edge', { error: (error as Error).message });
    return null;
  }
}

/**
 * Reinforce an existing edge by calling createEdge with just IDs + type + sessionId.
 * Convenience wrapper for when you only want to bump activation_count.
 */
export async function reinforceEdge(
  userId: string,
  sourceId: string,
  targetId: string,
  type: string,
  sessionId?: string
): Promise<GraphEdge | null> {
  return createEdge(userId, { sourceId, targetId, type, sessionId });
}

/**
 * Soft-delete an edge
 */
export async function deleteEdge(edgeId: string, userId: string): Promise<boolean> {
  try {
    const sql = `
      UPDATE memory_edges
      SET is_active = false, last_activated = NOW()
      WHERE id = $1 AND user_id = $2
    `;
    await mcQuery(sql, [edgeId, userId]);
    return true;
  } catch (error) {
    logger.error('Failed to delete edge', { error: (error as Error).message, edgeId });
    return false;
  }
}

/**
 * Merge two nodes - survivor absorbs the merged node
 */
export async function mergeNodes(
  userId: string,
  survivorId: string,
  mergedId: string,
  reason?: string
): Promise<GraphNode | null> {
  try {
    // Record in merge ledger (source = merged, target = survivor)
    await mcQuery(
      `INSERT INTO merge_ledger (user_id, source_node_id, target_node_id, merge_confidence, merge_reason)
       VALUES ($1, $2, $3, 1.0, $4)`,
      [userId, mergedId, survivorId, reason || null]
    );

    // Transfer edges from merged to survivor
    await mcQuery(
      `UPDATE memory_edges SET source_node_id = $1, last_activated = NOW()
       WHERE source_node_id = $2 AND user_id = $3 AND source_node_id != target_node_id`,
      [survivorId, mergedId, userId]
    );
    await mcQuery(
      `UPDATE memory_edges SET target_node_id = $1, last_activated = NOW()
       WHERE target_node_id = $2 AND user_id = $3 AND source_node_id != target_node_id`,
      [survivorId, mergedId, userId]
    );

    // Deactivate merged node
    await mcQuery(
      `UPDATE memory_nodes SET is_active = false, last_activated = NOW()
       WHERE id = $1 AND user_id = $2`,
      [mergedId, userId]
    );

    // Recalculate survivor edge count
    await mcQuery(
      `UPDATE memory_nodes SET
         edge_count = (
           SELECT COUNT(*) FROM memory_edges
           WHERE (source_node_id = $1 OR target_node_id = $1) AND is_active = true AND user_id = $2
         ),
         last_activated = NOW()
       WHERE id = $1 AND user_id = $2`,
      [survivorId, userId]
    );

    // Return updated survivor
    const row = await mcQueryOne<Record<string, unknown>>(
      `SELECT id, node_type, node_label, origin, origin_confidence,
              identity_status, activation_strength, edge_count,
              centrality_score, emotional_intensity, is_active,
              created_at, last_activated, metadata
       FROM memory_nodes WHERE id = $1`,
      [survivorId]
    );
    return row ? mapNodeRow(row) : null;
  } catch (error) {
    logger.error('Failed to merge nodes', { error: (error as Error).message, survivorId, mergedId });
    return null;
  }
}

/**
 * Split (unmerge) nodes via merge ledger
 */
export async function splitNode(
  userId: string,
  mergeId: string
): Promise<GraphNode[]> {
  try {
    // Find the merge record (source = merged node, target = survivor)
    const ledger = await mcQueryOne<MergeLedgerEntry>(
      `SELECT id, source_node_id, target_node_id, merge_reason, created_at
       FROM merge_ledger WHERE id = $1 AND user_id = $2`,
      [mergeId, userId]
    );

    if (!ledger) return [];

    // Reactivate the merged node (source_node_id)
    await mcQuery(
      `UPDATE memory_nodes SET is_active = true, last_activated = NOW()
       WHERE id = $1 AND user_id = $2`,
      [ledger.source_node_id, userId]
    );

    // Mark merge as inactive rather than deleting
    await mcQuery(
      `UPDATE merge_ledger SET is_active = false, unmerged_at = NOW(), unmerge_reason = 'manual split'
       WHERE id = $1`,
      [mergeId]
    );

    // Return both nodes
    const rows = await mcQuery<Record<string, unknown>>(
      `SELECT id, node_type, node_label, origin, origin_confidence,
              identity_status, activation_strength, edge_count,
              centrality_score, emotional_intensity, is_active,
              created_at, last_activated, metadata
       FROM memory_nodes WHERE id = ANY($1)`,
      [[ledger.target_node_id, ledger.source_node_id]]
    );

    return rows.map(mapNodeRow);
  } catch (error) {
    logger.error('Failed to split node', { error: (error as Error).message, mergeId });
    return [];
  }
}

/**
 * Get graph overview with summary stats and top nodes
 */
export async function getGraphOverview(userId: string): Promise<GraphOverview> {
  try {
    // Get total counts
    const countResult = await mcQueryOne<{ total_nodes: string; total_edges: string }>(
      `SELECT
        (SELECT COUNT(*) FROM memory_nodes WHERE user_id = $1 AND is_active = true) as total_nodes,
        (SELECT COUNT(*) FROM memory_edges WHERE user_id = $1 AND is_active = true) as total_edges`,
      [userId]
    );

    // Get nodes by type
    const typeRows = await mcQuery<{ node_type: string; count: string }>(
      `SELECT node_type, COUNT(*) as count
       FROM memory_nodes WHERE user_id = $1 AND is_active = true
       GROUP BY node_type ORDER BY count DESC`,
      [userId]
    );

    const nodesByType: Record<string, number> = {};
    for (const row of typeRows) {
      nodesByType[row.node_type] = parseInt(row.count);
    }

    // Get top nodes by centrality
    const topNodes = await getGraphNodes(userId, {
      limit: 100,
      sortBy: 'centrality_score',
    });

    return {
      totalNodes: parseInt(countResult?.total_nodes || '0'),
      totalEdges: parseInt(countResult?.total_edges || '0'),
      nodesByType,
      topNodes,
    };
  } catch (error) {
    logger.error('Failed to get graph overview', { error: (error as Error).message, userId });
    return { totalNodes: 0, totalEdges: 0, nodesByType: {}, topNodes: [] };
  }
}

/**
 * Purge noise nodes from MemoryCore graph.
 * Identifies active nodes whose labels match stopwords/noise patterns,
 * then soft-deletes them and all connected edges.
 */
export async function purgeNoiseNodes(
  userId: string
): Promise<{ deactivatedNodes: number; deactivatedEdges: number }> {
  try {
    // Node types that are exempt from noise purging - these represent
    // real-world entities where stopwords can be legitimate names
    const NOISE_EXEMPT_TYPES = new Set([
      'song', 'album', 'artist', 'person', 'place', 'brand', 'product',
      'organization', 'project', 'game', 'movie', 'show', 'book',
    ]);

    // Get all active node labels for this user
    const nodes = await mcQuery<{ id: string; node_label: string; node_type: string }>(
      `SELECT id, node_label, node_type FROM memory_nodes WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    const noiseNodeIds: string[] = [];
    for (const node of nodes) {
      if (NOISE_EXEMPT_TYPES.has(node.node_type)) continue;
      if (isNoiseToken(node.node_label)) {
        noiseNodeIds.push(node.id);
      }
    }

    if (noiseNodeIds.length === 0) {
      return { deactivatedNodes: 0, deactivatedEdges: 0 };
    }

    // Soft-delete edges connected to noise nodes
    const edgeResult = await mcQueryOne<{ count: string }>(
      `WITH deactivated AS (
        UPDATE memory_edges SET is_active = false, last_activated = NOW()
        WHERE user_id = $1 AND is_active = true
          AND (source_node_id = ANY($2) OR target_node_id = ANY($2))
        RETURNING id
      )
      SELECT COUNT(*) as count FROM deactivated`,
      [userId, noiseNodeIds]
    );

    // Soft-delete noise nodes
    const nodeResult = await mcQueryOne<{ count: string }>(
      `WITH deactivated AS (
        UPDATE memory_nodes SET is_active = false, last_activated = NOW()
        WHERE user_id = $1 AND id = ANY($2) AND is_active = true
        RETURNING id
      )
      SELECT COUNT(*) as count FROM deactivated`,
      [userId, noiseNodeIds]
    );

    const deactivatedNodes = parseInt(nodeResult?.count || '0');
    const deactivatedEdges = parseInt(edgeResult?.count || '0');

    logger.info('Purged noise nodes from MemoryCore graph', {
      userId, deactivatedNodes, deactivatedEdges,
    });

    return { deactivatedNodes, deactivatedEdges };
  } catch (error) {
    logger.error('Failed to purge noise nodes', { error: (error as Error).message, userId });
    return { deactivatedNodes: 0, deactivatedEdges: 0 };
  }
}

/**
 * Daily NeuralSleep graph consolidation.
 * Runs for all users with active graph data:
 * 1. EMA edge weight evolution based on activation_count + time decay
 * 2. Deactivate weak edges (weight < 0.1)
 * 3. Recalculate edge_count on nodes
 * 4. Recalculate centrality_score (weighted degree)
 * 5. Update recency on edges
 * 6. Promote provisional/unverified nodes to permanent (cross-session reinforcement)
 */
export async function runDailyGraphConsolidation(): Promise<void> {
  try {
    // Get all users with active graph data
    const users = await mcQuery<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM memory_nodes WHERE is_active = true`
    );

    logger.info('NeuralSleep daily consolidation starting', { userCount: users.length });

    for (const { user_id: userId } of users) {
      try {
        await consolidateUserDaily(userId);
      } catch (error) {
        logger.error('Daily consolidation failed for user', {
          error: (error as Error).message, userId,
        });
      }
    }

    logger.info('NeuralSleep daily consolidation complete', { userCount: users.length });
  } catch (error) {
    logger.error('NeuralSleep daily consolidation failed', { error: (error as Error).message });
  }
}

async function consolidateUserDaily(userId: string): Promise<void> {
  // 1. EMA edge weight evolution
  // tau values per edge_type (in seconds):
  //   co_occurrence: 14 days, semantic: 90 days, temporal: 30 days, causal: 60 days
  // alpha = 1 - exp(-deltaT / tau)
  // targetWeight = min(1.0, defaultWeight + 0.05 * ln(activation_count + 1))
  // newWeight = weight * (1 - alpha) + targetWeight * alpha
  await mcQuery(
    `UPDATE memory_edges SET
      weight = LEAST(1.0, GREATEST(0.0,
        weight * (1.0 - (1.0 - exp(
          -EXTRACT(EPOCH FROM (NOW() - COALESCE(last_activated, created_at)))
          / CASE edge_type
              WHEN 'co_occurrence' THEN 1209600   -- 14 days
              WHEN 'semantic' THEN 7776000         -- 90 days
              WHEN 'temporal' THEN 2592000         -- 30 days
              WHEN 'causal' THEN 5184000           -- 60 days
              ELSE 2592000                         -- 30 days default
            END
        )))
        + LEAST(1.0, 0.5 + 0.05 * LN(activation_count + 1))
          * (1.0 - exp(
            -EXTRACT(EPOCH FROM (NOW() - COALESCE(last_activated, created_at)))
            / CASE edge_type
                WHEN 'co_occurrence' THEN 1209600
                WHEN 'semantic' THEN 7776000
                WHEN 'temporal' THEN 2592000
                WHEN 'causal' THEN 5184000
                ELSE 2592000
              END
          ))
      ))
    WHERE user_id = $1 AND is_active = true`,
    [userId]
  );

  // 2. Deactivate weak edges (but never same_as edges)
  const weakResult = await mcQueryOne<{ count: string }>(
    `WITH deactivated AS (
      UPDATE memory_edges SET is_active = false
      WHERE user_id = $1 AND is_active = true AND weight < 0.1 AND edge_type != 'same_as'
      RETURNING id
    )
    SELECT COUNT(*) as count FROM deactivated`,
    [userId]
  );

  // 3. Recalculate edge_count on all active nodes
  await mcQuery(
    `UPDATE memory_nodes n SET
      edge_count = (
        SELECT COUNT(*) FROM memory_edges e
        WHERE e.is_active = true AND e.user_id = $1
          AND (e.source_node_id = n.id OR e.target_node_id = n.id)
      )
    WHERE n.user_id = $1 AND n.is_active = true`,
    [userId]
  );

  // 4. Recalculate centrality_score (weighted degree normalized)
  // centrality = sum(weight of connected edges) / max_possible
  // We use a simple weighted degree / max(weighted_degree) normalization
  await mcQuery(
    `WITH weighted_degrees AS (
      SELECT n.id,
        COALESCE(SUM(e.weight), 0) as wd
      FROM memory_nodes n
      LEFT JOIN memory_edges e ON e.is_active = true AND e.user_id = $1
        AND (e.source_node_id = n.id OR e.target_node_id = n.id)
      WHERE n.user_id = $1 AND n.is_active = true
      GROUP BY n.id
    ),
    max_wd AS (
      SELECT GREATEST(MAX(wd), 1.0) as max_val FROM weighted_degrees
    )
    UPDATE memory_nodes n SET
      centrality_score = wd.wd / mx.max_val
    FROM weighted_degrees wd, max_wd mx
    WHERE n.id = wd.id AND n.user_id = $1`,
    [userId]
  );

  // 5. Update recency on edges: decays from 1.0 toward 0 over days
  await mcQuery(
    `UPDATE memory_edges SET
      recency = 1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(last_activated, created_at))) / 86400.0)
    WHERE user_id = $1 AND is_active = true`,
    [userId]
  );

  // 6. Promote provisional/unverified nodes to permanent
  // Criteria: connected edges span >= 3 distinct sessions, node has >= 3 edges,
  // and has been activated within the last 14 days
  const promotedResult = await mcQueryOne<{ count: string }>(
    `WITH promotion_candidates AS (
      SELECT n.id
      FROM memory_nodes n
      WHERE n.user_id = $1 AND n.is_active = true
        AND n.identity_status IN ('provisional', 'unverified')
        AND n.edge_count >= 3
        AND n.last_activated > NOW() - INTERVAL '14 days'
        AND (
          SELECT COALESCE(MAX(e.distinct_session_count), 0)
          FROM memory_edges e
          WHERE e.is_active = true AND e.user_id = $1
            AND (e.source_node_id = n.id OR e.target_node_id = n.id)
        ) >= 3
    ),
    promoted AS (
      UPDATE memory_nodes SET identity_status = 'permanent'
      WHERE id IN (SELECT id FROM promotion_candidates) AND user_id = $1
      RETURNING id
    )
    SELECT COUNT(*) as count FROM promoted`,
    [userId]
  );

  const weakCount = parseInt(weakResult?.count || '0');
  const promotedCount = parseInt(promotedResult?.count || '0');

  if (weakCount > 0 || promotedCount > 0) {
    logger.info('Daily consolidation results', {
      userId, weakEdgesDeactivated: weakCount, nodesPromoted: promotedCount,
    });
  }
}

/**
 * Weekly NeuralSleep graph consolidation.
 * Runs Sunday 3AM. Per user:
 * 1. Prune stale low-value nodes
 * 2. Purge noise nodes (stopword entities)
 * 3. Anti-centrality pressure on hub nodes
 * 4. Merge candidate analysis (log-only)
 */
export async function runWeeklyGraphConsolidation(): Promise<void> {
  try {
    const users = await mcQuery<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM memory_nodes WHERE is_active = true`
    );

    logger.info('NeuralSleep weekly consolidation starting', { userCount: users.length });

    for (const { user_id: userId } of users) {
      try {
        await consolidateUserWeekly(userId);
      } catch (error) {
        logger.error('Weekly consolidation failed for user', {
          error: (error as Error).message, userId,
        });
      }
    }

    logger.info('NeuralSleep weekly consolidation complete', { userCount: users.length });
  } catch (error) {
    logger.error('NeuralSleep weekly consolidation failed', { error: (error as Error).message });
  }
}

async function consolidateUserWeekly(userId: string): Promise<void> {
  // 1. Prune stale low-value nodes:
  //    edge_count < 2, emotional_intensity < 0.3, last_activated > 30 days ago
  const pruneResult = await mcQueryOne<{ count: string }>(
    `WITH pruned AS (
      UPDATE memory_nodes SET is_active = false, last_activated = NOW()
      WHERE user_id = $1 AND is_active = true
        AND edge_count < 2
        AND emotional_intensity < 0.3
        AND last_activated < NOW() - INTERVAL '30 days'
      RETURNING id
    )
    SELECT COUNT(*) as count FROM pruned`,
    [userId]
  );

  // Deactivate edges connected to pruned nodes
  await mcQuery(
    `UPDATE memory_edges SET is_active = false
    WHERE user_id = $1 AND is_active = true
      AND (source_node_id IN (SELECT id FROM memory_nodes WHERE user_id = $1 AND is_active = false)
           OR target_node_id IN (SELECT id FROM memory_nodes WHERE user_id = $1 AND is_active = false))`,
    [userId]
  );

  // 2. Purge noise nodes
  const noiseResult = await purgeNoiseNodes(userId);

  // 3. Anti-centrality pressure on hub nodes (graduated scale)
  // Exempt person/place nodes - they are naturally high-connectivity
  // 50-99 edges: light pressure (penalty capped at 0.1)
  // 100-199 edges: moderate pressure (penalty capped at 0.25)
  // 200+ edges: heavy pressure (penalty capped at 0.4)
  await mcQuery(
    `UPDATE memory_nodes SET
      centrality_score = centrality_score * (1.0 - CASE
        WHEN edge_count >= 200 THEN LEAST(0.40, LN(edge_count::float / 50.0) / 8.0)
        WHEN edge_count >= 100 THEN LEAST(0.25, LN(edge_count::float / 50.0) / 10.0)
        WHEN edge_count >= 50  THEN LEAST(0.10, LN(edge_count::float / 50.0) / 15.0)
        ELSE 0
      END)
    WHERE user_id = $1 AND is_active = true
      AND edge_count >= 50
      AND node_type NOT IN ('person', 'place', 'artist')`,
    [userId]
  );

  // 4. Merge candidate analysis (log-only)
  // Find node pairs with same type, co-occurrence edge, similar labels
  // Require both labels >= 4 chars to avoid "Pi"/"Piano" false positives
  const mergeCandidates = await mcQuery<{
    node1_id: string; node1_label: string;
    node2_id: string; node2_label: string;
    edge_weight: string;
  }>(
    `SELECT
      n1.id as node1_id, n1.node_label as node1_label,
      n2.id as node2_id, n2.node_label as node2_label,
      e.weight as edge_weight
    FROM memory_edges e
    JOIN memory_nodes n1 ON n1.id = e.source_node_id AND n1.is_active = true
    JOIN memory_nodes n2 ON n2.id = e.target_node_id AND n2.is_active = true
    WHERE e.user_id = $1 AND e.is_active = true
      AND n1.node_type = n2.node_type
      AND e.edge_type = 'co_occurrence'
      AND e.activation_count >= 3
      AND LENGTH(n1.node_label) >= 4
      AND LENGTH(n2.node_label) >= 4
      AND (
        n1.node_label ILIKE '%' || n2.node_label || '%'
        OR n2.node_label ILIKE '%' || n1.node_label || '%'
      )
    ORDER BY e.activation_count DESC
    LIMIT 20`,
    [userId]
  );

  const prunedCount = parseInt(pruneResult?.count || '0');
  if (prunedCount > 0 || noiseResult.deactivatedNodes > 0 || mergeCandidates.length > 0) {
    logger.info('Weekly consolidation results', {
      userId,
      prunedNodes: prunedCount,
      noiseNodes: noiseResult.deactivatedNodes,
      noiseEdges: noiseResult.deactivatedEdges,
      mergeCandidates: mergeCandidates.length,
      candidates: mergeCandidates.map(c => `${c.node1_label} <-> ${c.node2_label}`),
    });
  }
}

/**
 * Analyze merge candidates for a user.
 * Finds pairs of nodes that might represent the same concept:
 * - Same node_type
 * - Label substring match or embedding similarity
 * - Co-occurrence edge between them
 */
export async function analyzeMergeCandidates(
  userId: string,
  options: { minActivation?: number; limit?: number } = {}
): Promise<Array<{
  node1: GraphNode;
  node2: GraphNode;
  similarity: number;
  coOccurrenceCount: number;
  reason: string;
}>> {
  const { minActivation = 2, limit = 50 } = options;

  try {
    // Find candidates via label substring matching
    const labelCandidates = await mcQuery<{
      n1_id: string; n1_type: string; n1_label: string; n1_origin: string;
      n1_origin_confidence: string; n1_identity_status: string;
      n1_activation_strength: string; n1_edge_count: string;
      n1_centrality_score: string; n1_emotional_intensity: string;
      n1_is_active: boolean; n1_created_at: Date; n1_last_activated: Date;
      n1_metadata: Record<string, unknown> | null;
      n2_id: string; n2_type: string; n2_label: string; n2_origin: string;
      n2_origin_confidence: string; n2_identity_status: string;
      n2_activation_strength: string; n2_edge_count: string;
      n2_centrality_score: string; n2_emotional_intensity: string;
      n2_is_active: boolean; n2_created_at: Date; n2_last_activated: Date;
      n2_metadata: Record<string, unknown> | null;
      edge_activation_count: string;
    }>(
      `SELECT
        n1.id as n1_id, n1.node_type as n1_type, n1.node_label as n1_label,
        n1.origin as n1_origin, n1.origin_confidence as n1_origin_confidence,
        n1.identity_status as n1_identity_status, n1.activation_strength as n1_activation_strength,
        n1.edge_count as n1_edge_count, n1.centrality_score as n1_centrality_score,
        n1.emotional_intensity as n1_emotional_intensity, n1.is_active as n1_is_active,
        n1.created_at as n1_created_at, n1.last_activated as n1_last_activated,
        n1.metadata as n1_metadata,
        n2.id as n2_id, n2.node_type as n2_type, n2.node_label as n2_label,
        n2.origin as n2_origin, n2.origin_confidence as n2_origin_confidence,
        n2.identity_status as n2_identity_status, n2.activation_strength as n2_activation_strength,
        n2.edge_count as n2_edge_count, n2.centrality_score as n2_centrality_score,
        n2.emotional_intensity as n2_emotional_intensity, n2.is_active as n2_is_active,
        n2.created_at as n2_created_at, n2.last_activated as n2_last_activated,
        n2.metadata as n2_metadata,
        COALESCE(e.activation_count, 0) as edge_activation_count
      FROM memory_nodes n1
      JOIN memory_nodes n2 ON n1.node_type = n2.node_type
        AND n1.id < n2.id
        AND n2.user_id = $1 AND n2.is_active = true
      LEFT JOIN memory_edges e ON e.user_id = $1 AND e.is_active = true
        AND ((e.source_node_id = n1.id AND e.target_node_id = n2.id)
          OR (e.source_node_id = n2.id AND e.target_node_id = n1.id))
      WHERE n1.user_id = $1 AND n1.is_active = true
        AND LENGTH(n1.node_label) >= 4
        AND LENGTH(n2.node_label) >= 4
        AND (
          n1.node_label ILIKE '%' || n2.node_label || '%'
          OR n2.node_label ILIKE '%' || n1.node_label || '%'
        )
        AND COALESCE(e.activation_count, 0) >= $2
      ORDER BY COALESCE(e.activation_count, 0) DESC
      LIMIT $3`,
      [userId, minActivation, limit]
    );

    return labelCandidates.map(row => {
      // Calculate a simple similarity score based on label overlap
      const l1 = row.n1_label.toLowerCase();
      const l2 = row.n2_label.toLowerCase();
      const shorter = l1.length <= l2.length ? l1 : l2;
      const longer = l1.length > l2.length ? l1 : l2;
      const similarity = shorter.length / longer.length;

      const reason = l1.includes(l2) || l2.includes(l1)
        ? 'Label substring match'
        : 'Label overlap';

      return {
        node1: mapNodeRow({
          id: row.n1_id, node_type: row.n1_type, node_label: row.n1_label,
          origin: row.n1_origin, origin_confidence: row.n1_origin_confidence,
          identity_status: row.n1_identity_status, activation_strength: row.n1_activation_strength,
          edge_count: row.n1_edge_count, centrality_score: row.n1_centrality_score,
          emotional_intensity: row.n1_emotional_intensity, is_active: row.n1_is_active,
          created_at: row.n1_created_at, last_activated: row.n1_last_activated,
          metadata: row.n1_metadata,
        }),
        node2: mapNodeRow({
          id: row.n2_id, node_type: row.n2_type, node_label: row.n2_label,
          origin: row.n2_origin, origin_confidence: row.n2_origin_confidence,
          identity_status: row.n2_identity_status, activation_strength: row.n2_activation_strength,
          edge_count: row.n2_edge_count, centrality_score: row.n2_centrality_score,
          emotional_intensity: row.n2_emotional_intensity, is_active: row.n2_is_active,
          created_at: row.n2_created_at, last_activated: row.n2_last_activated,
          metadata: row.n2_metadata,
        }),
        similarity,
        coOccurrenceCount: parseInt(row.edge_activation_count),
        reason,
      };
    });
  } catch (error) {
    logger.error('Failed to analyze merge candidates', { error: (error as Error).message, userId });
    return [];
  }
}

export default {
  getGraphNodes,
  getGraphEdges,
  getNodeNeighbors,
  updateNode,
  deleteNode,
  createEdge,
  reinforceEdge,
  deleteEdge,
  mergeNodes,
  splitNode,
  getGraphOverview,
  purgeNoiseNodes,
  runDailyGraphConsolidation,
  runWeeklyGraphConsolidation,
  analyzeMergeCandidates,
};
