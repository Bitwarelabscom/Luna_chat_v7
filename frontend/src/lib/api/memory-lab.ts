import { api } from './core';
import type { ConsciousnessMetrics, ConsciousnessHistory, ConsolidationEvent } from './consciousness';

// Graph types
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

// Facts types - import from friends module to avoid barrel conflict
import type { UserFact, FactCorrection } from './friends';

// LNN types
export interface EmotionalPoint {
  timestamp: string;
  valence: number;
  attentionScore: number;
}

export interface DriftPoint {
  timestamp: string;
  drift: number;
}

// Consciousness types used internally (not re-exported to avoid barrel conflict)

export const memoryLabApi = {
  // Graph
  getGraphOverview: () =>
    api<GraphOverview>('/api/memory-lab/graph/overview'),

  getGraphNodes: (params?: {
    limit?: number; offset?: number; type?: string;
    search?: string; sortBy?: string; minEdgeCount?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.type) qs.set('type', params.type);
    if (params?.search) qs.set('search', params.search);
    if (params?.sortBy) qs.set('sortBy', params.sortBy);
    if (params?.minEdgeCount) qs.set('minEdgeCount', String(params.minEdgeCount));
    return api<{ nodes: GraphNode[] }>(`/api/memory-lab/graph/nodes?${qs}`);
  },

  getGraphEdges: (nodeIds: string[], options?: { type?: string; minStrength?: number }) => {
    const qs = new URLSearchParams();
    if (nodeIds.length > 0) qs.set('nodeIds', nodeIds.join(','));
    if (options?.type) qs.set('type', options.type);
    if (options?.minStrength) qs.set('minStrength', String(options.minStrength));
    return api<{ edges: GraphEdge[] }>(`/api/memory-lab/graph/edges?${qs}`);
  },

  getNodeNeighbors: (nodeId: string, options?: { depth?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (options?.depth) qs.set('depth', String(options.depth));
    if (options?.limit) qs.set('limit', String(options.limit));
    return api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
      `/api/memory-lab/graph/nodes/${nodeId}/neighbors?${qs}`
    );
  },

  updateNode: (nodeId: string, data: { label?: string; type?: string; metadata?: Record<string, unknown> }) =>
    api<{ node: GraphNode }>(`/api/memory-lab/graph/nodes/${nodeId}`, { method: 'PATCH', body: data }),

  deleteNode: (nodeId: string) =>
    api<{ success: boolean }>(`/api/memory-lab/graph/nodes/${nodeId}`, { method: 'DELETE' }),

  createEdge: (data: { sourceId: string; targetId: string; type: string; strength?: number }) =>
    api<{ edge: GraphEdge }>('/api/memory-lab/graph/edges', { method: 'POST', body: data }),

  deleteEdge: (edgeId: string) =>
    api<{ success: boolean }>(`/api/memory-lab/graph/edges/${edgeId}`, { method: 'DELETE' }),

  mergeNodes: (sourceId: string, targetId: string, reason?: string) =>
    api<{ node: GraphNode }>('/api/memory-lab/graph/merge', {
      method: 'POST', body: { sourceId, targetId, reason },
    }),

  splitNode: (mergeId: string) =>
    api<{ nodes: GraphNode[] }>(`/api/memory-lab/graph/split/${mergeId}`, { method: 'POST' }),

  // Facts
  getFacts: (params?: { category?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.limit) qs.set('limit', String(params.limit));
    return api<{ facts: UserFact[] }>(`/api/memory-lab/facts?${qs}`);
  },

  createFact: (data: { category: string; factKey: string; factValue: string; confidence?: number }) =>
    api<{ success: boolean }>('/api/memory-lab/facts', { method: 'POST', body: data }),

  updateFact: (factId: string, factValue: string, reason?: string) =>
    api<{ success: boolean; oldValue?: string }>(`/api/memory-lab/facts/${factId}`, {
      method: 'PATCH', body: { factValue, reason },
    }),

  deleteFact: (factId: string, reason?: string) =>
    api<{ success: boolean }>(`/api/memory-lab/facts/${factId}`, {
      method: 'DELETE', body: { reason },
    }),

  searchFacts: (q: string) =>
    api<{ facts: UserFact[] }>(`/api/memory-lab/facts/search?q=${encodeURIComponent(q)}`),

  getFactHistory: (limit?: number) =>
    api<{ history: FactCorrection[] }>(`/api/memory-lab/facts/history?limit=${limit || 50}`),

  // Consciousness
  getMetrics: () =>
    api<{ metrics: ConsciousnessMetrics | null }>('/api/memory-lab/consciousness/metrics'),

  getHistory: (limit = 100) =>
    api<{ history: ConsciousnessHistory[] }>(`/api/memory-lab/consciousness/history?limit=${limit}`),

  analyze: () =>
    api<{ metrics: ConsciousnessMetrics }>('/api/memory-lab/consciousness/analyze', { method: 'POST' }),

  getHealth: () =>
    api<{ healthy: boolean; neuralsleep: boolean }>('/api/memory-lab/consciousness/health'),

  getConsolidationLogs: (limit = 20) =>
    api<{ logs: ConsolidationEvent[] }>(`/api/memory-lab/consolidation/logs?limit=${limit}`),

  // LNN Live
  getEmotionalTrajectory: (limit = 100) =>
    api<{ trajectory: EmotionalPoint[] }>(`/api/memory-lab/lnn/emotional-trajectory?limit=${limit}`),

  getCentroidDrift: (limit = 50) =>
    api<{ drift: DriftPoint[] }>(`/api/memory-lab/lnn/centroid-drift?limit=${limit}`),

  getSessionEnrichment: () =>
    api<{ sessions: Array<{ sessionId: string; lastActivity: string }> }>(
      '/api/memory-lab/lnn/session-enrichment'
    ),
};
