import { mcQuery, mcQueryOne } from '../db/memorycore-pool.js';
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
  survivorNodeId: string;
  mergedNodeId: string;
  reason: string | null;
  createdAt: string;
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
      FROM graph_nodes n
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
      FROM graph_edges e
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
      FROM graph_edges e
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
      FROM graph_nodes n
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

    setClauses.push('updated_at = NOW()');

    const sql = `
      UPDATE graph_nodes
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
      UPDATE graph_nodes
      SET is_active = false, updated_at = NOW()
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
 * Create a new edge between nodes
 */
export async function createEdge(
  userId: string,
  data: { sourceId: string; targetId: string; type: string; strength?: number }
): Promise<GraphEdge | null> {
  try {
    const sql = `
      INSERT INTO graph_edges (user_id, source_node_id, target_node_id, edge_type, strength, weight)
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT DO NOTHING
      RETURNING id, source_node_id, target_node_id, edge_type,
                weight, strength, recency, trust, is_active,
                activation_count, distinct_session_count
    `;

    const row = await mcQueryOne<Record<string, unknown>>(sql, [
      userId, data.sourceId, data.targetId, data.type, data.strength ?? 0.5,
    ]);
    return row ? mapEdgeRow(row) : null;
  } catch (error) {
    logger.error('Failed to create edge', { error: (error as Error).message });
    return null;
  }
}

/**
 * Soft-delete an edge
 */
export async function deleteEdge(edgeId: string, userId: string): Promise<boolean> {
  try {
    const sql = `
      UPDATE graph_edges
      SET is_active = false, updated_at = NOW()
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
    // Record in merge ledger
    await mcQuery(
      `INSERT INTO merge_ledger (user_id, survivor_node_id, merged_node_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [userId, survivorId, mergedId, reason || null]
    );

    // Transfer edges from merged to survivor
    await mcQuery(
      `UPDATE graph_edges SET source_node_id = $1, updated_at = NOW()
       WHERE source_node_id = $2 AND user_id = $3 AND source_node_id != target_node_id`,
      [survivorId, mergedId, userId]
    );
    await mcQuery(
      `UPDATE graph_edges SET target_node_id = $1, updated_at = NOW()
       WHERE target_node_id = $2 AND user_id = $3 AND source_node_id != target_node_id`,
      [survivorId, mergedId, userId]
    );

    // Deactivate merged node
    await mcQuery(
      `UPDATE graph_nodes SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [mergedId, userId]
    );

    // Recalculate survivor edge count
    await mcQuery(
      `UPDATE graph_nodes SET
         edge_count = (
           SELECT COUNT(*) FROM graph_edges
           WHERE (source_node_id = $1 OR target_node_id = $1) AND is_active = true AND user_id = $2
         ),
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [survivorId, userId]
    );

    // Return updated survivor
    const row = await mcQueryOne<Record<string, unknown>>(
      `SELECT id, node_type, node_label, origin, origin_confidence,
              identity_status, activation_strength, edge_count,
              centrality_score, emotional_intensity, is_active,
              created_at, last_activated, metadata
       FROM graph_nodes WHERE id = $1`,
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
    // Find the merge record
    const ledger = await mcQueryOne<MergeLedgerEntry>(
      `SELECT id, survivor_node_id, merged_node_id, reason, created_at
       FROM merge_ledger WHERE id = $1 AND user_id = $2`,
      [mergeId, userId]
    );

    if (!ledger) return [];

    // Reactivate the merged node
    await mcQuery(
      `UPDATE graph_nodes SET is_active = true, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [ledger.mergedNodeId, userId]
    );

    // Remove the merge record
    await mcQuery(`DELETE FROM merge_ledger WHERE id = $1`, [mergeId]);

    // Return both nodes
    const rows = await mcQuery<Record<string, unknown>>(
      `SELECT id, node_type, node_label, origin, origin_confidence,
              identity_status, activation_strength, edge_count,
              centrality_score, emotional_intensity, is_active,
              created_at, last_activated, metadata
       FROM graph_nodes WHERE id = ANY($1)`,
      [[ledger.survivorNodeId, ledger.mergedNodeId]]
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
        (SELECT COUNT(*) FROM graph_nodes WHERE user_id = $1 AND is_active = true) as total_nodes,
        (SELECT COUNT(*) FROM graph_edges WHERE user_id = $1 AND is_active = true) as total_edges`,
      [userId]
    );

    // Get nodes by type
    const typeRows = await mcQuery<{ node_type: string; count: string }>(
      `SELECT node_type, COUNT(*) as count
       FROM graph_nodes WHERE user_id = $1 AND is_active = true
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

export default {
  getGraphNodes,
  getGraphEdges,
  getNodeNeighbors,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  mergeNodes,
  splitNode,
  getGraphOverview,
};
