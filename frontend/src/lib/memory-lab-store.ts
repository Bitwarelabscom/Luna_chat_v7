import { create } from 'zustand';
import type { GraphNode, GraphEdge, SlimGraphEdge, GraphOverview, EmotionalPoint, DriftPoint, ActivationTrace } from './api/memory-lab';
import type { UserFact, FactCorrection } from './api/friends';
import type { ConsciousnessMetrics, ConsciousnessHistory, ConsolidationEvent } from './api/consciousness';

type TabId = 'graph' | 'facts' | 'consciousness' | 'lnn';

interface MemoryLabState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  // Graph
  graphViewMode: 'explorer' | 'brain';
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphOverview: GraphOverview | null;
  selectedNodeId: string | null;
  expandedNodeIds: string[];
  graphSearch: string;
  graphFilterType: string | null;
  strengthThreshold: number;
  isLoadingGraph: boolean;

  // Brain (full graph)
  brainNodes: GraphNode[];
  brainEdges: SlimGraphEdge[];
  isBrainLoading: boolean;
  brainHoveredNodeId: string | null;

  // Facts
  facts: UserFact[];
  editingFactId: string | null;
  factsFilter: string;
  factsSearch: string;
  factHistory: FactCorrection[];
  isLoadingFacts: boolean;

  // Consciousness
  metrics: ConsciousnessMetrics | null;
  history: ConsciousnessHistory[];
  consolidationLogs: ConsolidationEvent[];
  isHealthy: boolean | null;
  neuralsleepConnected: boolean | null;

  // LNN Live
  emotionalTrajectory: EmotionalPoint[];
  centroidDrift: DriftPoint[];
  activationTrace: ActivationTrace | null;

  // Actions
  setGraphViewMode: (mode: 'explorer' | 'brain') => void;
  loadFullGraph: () => Promise<void>;
  loadGraphOverview: () => Promise<void>;
  expandNode: (nodeId: string) => Promise<void>;
  searchNodes: (query: string) => Promise<void>;
  setSelectedNodeId: (id: string | null) => void;
  setGraphFilterType: (type: string | null) => void;
  setStrengthThreshold: (val: number) => void;
  updateNode: (nodeId: string, updates: { label?: string; type?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  createEdge: (sourceId: string, targetId: string, type: string, strength?: number) => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;
  mergeNodes: (sourceId: string, targetId: string, reason?: string) => Promise<void>;

  loadFacts: () => Promise<void>;
  createFact: (data: { category: string; factKey: string; factValue: string }) => Promise<void>;
  updateFact: (factId: string, newValue: string, reason?: string) => Promise<void>;
  deleteFact: (factId: string, reason?: string) => Promise<void>;
  setEditingFactId: (id: string | null) => void;
  setFactsSearch: (search: string) => void;
  setFactsFilter: (filter: string) => void;
  loadFactHistory: () => Promise<void>;

  loadConsciousness: () => Promise<void>;
  triggerAnalysis: () => Promise<void>;

  loadLnnData: () => Promise<void>;
}

export const useMemoryLabStore = create<MemoryLabState>((set, get) => ({
  activeTab: 'graph',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Graph initial
  graphViewMode: 'brain',
  graphNodes: [],
  graphEdges: [],
  graphOverview: null,
  selectedNodeId: null,
  expandedNodeIds: [],
  graphSearch: '',
  graphFilterType: null,
  strengthThreshold: 0.3,
  isLoadingGraph: false,

  // Brain initial
  brainNodes: [],
  brainEdges: [],
  isBrainLoading: false,
  brainHoveredNodeId: null,

  // Facts initial
  facts: [],
  editingFactId: null,
  factsFilter: '',
  factsSearch: '',
  factHistory: [],
  isLoadingFacts: false,

  // Consciousness initial
  metrics: null,
  history: [],
  consolidationLogs: [],
  isHealthy: null,
  neuralsleepConnected: null,

  // LNN initial
  emotionalTrajectory: [],
  centroidDrift: [],
  activationTrace: null,

  // Graph actions
  setGraphViewMode: (mode) => set({ graphViewMode: mode }),

  loadFullGraph: async () => {
    if (get().isBrainLoading) return;
    set({ isBrainLoading: true });
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const data = await memoryLabApi.getFullGraph();
      set({
        brainNodes: data.nodes,
        brainEdges: data.edges,
        isBrainLoading: false,
      });
    } catch (err) {
      console.error('Failed to load full graph:', err);
      set({ isBrainLoading: false });
    }
  },

  loadGraphOverview: async () => {
    set({ isLoadingGraph: true });
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const overview = await memoryLabApi.getGraphOverview();

      // Load edges between top nodes
      const nodeIds = overview.topNodes.map(n => n.id);
      const { edges } = nodeIds.length > 0
        ? await memoryLabApi.getGraphEdges(nodeIds, { minStrength: get().strengthThreshold })
        : { edges: [] };

      set({
        graphOverview: overview,
        graphNodes: overview.topNodes,
        graphEdges: edges,
        isLoadingGraph: false,
      });
    } catch (err) {
      console.error('Failed to load graph overview:', err);
      set({ isLoadingGraph: false });
    }
  },

  expandNode: async (nodeId: string) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const result = await memoryLabApi.getNodeNeighbors(nodeId, { limit: 30 });

      set(state => {
        const existingIds = new Set(state.graphNodes.map(n => n.id));
        const newNodes = result.nodes.filter(n => !existingIds.has(n.id));

        const existingEdgeIds = new Set(state.graphEdges.map(e => e.id));
        const newEdges = result.edges.filter(e => !existingEdgeIds.has(e.id));

        return {
          graphNodes: [...state.graphNodes, ...newNodes],
          graphEdges: [...state.graphEdges, ...newEdges],
          expandedNodeIds: [...state.expandedNodeIds, nodeId],
          selectedNodeId: nodeId,
        };
      });
    } catch (err) {
      console.error('Failed to expand node:', err);
    }
  },

  searchNodes: async (query: string) => {
    set({ graphSearch: query, isLoadingGraph: true });
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const { nodes } = await memoryLabApi.getGraphNodes({
        search: query,
        limit: 100,
        type: get().graphFilterType || undefined,
      });

      const nodeIds = nodes.map(n => n.id);
      const { edges } = nodeIds.length > 0
        ? await memoryLabApi.getGraphEdges(nodeIds, { minStrength: get().strengthThreshold })
        : { edges: [] };

      set({ graphNodes: nodes, graphEdges: edges, isLoadingGraph: false });
    } catch (err) {
      console.error('Failed to search nodes:', err);
      set({ isLoadingGraph: false });
    }
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setGraphFilterType: (type) => set({ graphFilterType: type }),
  setStrengthThreshold: (val) => set({ strengthThreshold: val }),

  updateNode: async (nodeId, updates) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const { node } = await memoryLabApi.updateNode(nodeId, updates);
      set(state => ({
        graphNodes: state.graphNodes.map(n => n.id === nodeId ? node : n),
      }));
    } catch (err) {
      console.error('Failed to update node:', err);
    }
  },

  deleteNode: async (nodeId) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      await memoryLabApi.deleteNode(nodeId);
      set(state => ({
        graphNodes: state.graphNodes.filter(n => n.id !== nodeId),
        graphEdges: state.graphEdges.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      }));
    } catch (err) {
      console.error('Failed to delete node:', err);
    }
  },

  createEdge: async (sourceId, targetId, type, strength) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const { edge } = await memoryLabApi.createEdge({ sourceId, targetId, type, strength });
      if (edge) {
        set(state => ({ graphEdges: [...state.graphEdges, edge] }));
      }
    } catch (err) {
      console.error('Failed to create edge:', err);
    }
  },

  deleteEdge: async (edgeId) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      await memoryLabApi.deleteEdge(edgeId);
      set(state => ({ graphEdges: state.graphEdges.filter(e => e.id !== edgeId) }));
    } catch (err) {
      console.error('Failed to delete edge:', err);
    }
  },

  mergeNodes: async (sourceId, targetId, reason) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      await memoryLabApi.mergeNodes(sourceId, targetId, reason);
      // Reload graph after merge
      get().loadGraphOverview();
    } catch (err) {
      console.error('Failed to merge nodes:', err);
    }
  },

  // Facts actions
  loadFacts: async () => {
    set({ isLoadingFacts: true });
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const { facts } = await memoryLabApi.getFacts({ limit: 200 });
      set({ facts, isLoadingFacts: false });
    } catch (err) {
      console.error('Failed to load facts:', err);
      set({ isLoadingFacts: false });
    }
  },

  createFact: async (data) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      await memoryLabApi.createFact({ ...data, confidence: 1.0 });
      get().loadFacts();
    } catch (err) {
      console.error('Failed to create fact:', err);
    }
  },

  updateFact: async (factId, newValue, reason) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      await memoryLabApi.updateFact(factId, newValue, reason);
      get().loadFacts();
    } catch (err) {
      console.error('Failed to update fact:', err);
    }
  },

  deleteFact: async (factId, reason) => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      await memoryLabApi.deleteFact(factId, reason);
      set(state => ({ facts: state.facts.filter(f => f.id !== factId) }));
    } catch (err) {
      console.error('Failed to delete fact:', err);
    }
  },

  setEditingFactId: (id) => set({ editingFactId: id }),
  setFactsSearch: (search) => set({ factsSearch: search }),
  setFactsFilter: (filter) => set({ factsFilter: filter }),

  loadFactHistory: async () => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const { history } = await memoryLabApi.getFactHistory(50);
      set({ factHistory: history });
    } catch (err) {
      console.error('Failed to load fact history:', err);
    }
  },

  // Consciousness actions
  loadConsciousness: async () => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const [metricsRes, historyRes, logsRes, healthRes] = await Promise.all([
        memoryLabApi.getMetrics().catch(() => ({ metrics: null })),
        memoryLabApi.getHistory(50).catch(() => ({ history: [] as ConsciousnessHistory[] })),
        memoryLabApi.getConsolidationLogs(20).catch(() => ({ logs: [] as ConsolidationEvent[] })),
        memoryLabApi.getHealth().catch(() => ({ healthy: false, neuralsleep: false })),
      ]);

      set({
        metrics: metricsRes.metrics,
        history: historyRes.history,
        consolidationLogs: logsRes.logs,
        isHealthy: healthRes.healthy,
        neuralsleepConnected: healthRes.neuralsleep,
      });
    } catch (err) {
      console.error('Failed to load consciousness:', err);
    }
  },

  triggerAnalysis: async () => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const { metrics } = await memoryLabApi.analyze();
      set({ metrics });
      get().loadConsciousness();
    } catch (err) {
      console.error('Failed to trigger analysis:', err);
    }
  },

  // LNN actions
  loadLnnData: async () => {
    try {
      const { memoryLabApi } = await import('./api/memory-lab');
      const [trajectoryRes, driftRes, traceRes] = await Promise.all([
        memoryLabApi.getEmotionalTrajectory(100).catch(() => ({ trajectory: [] as EmotionalPoint[] })),
        memoryLabApi.getCentroidDrift(50).catch(() => ({ drift: [] as DriftPoint[] })),
        memoryLabApi.getActivationTrace().catch(() => ({ trace: null as ActivationTrace | null })),
      ]);

      set({
        emotionalTrajectory: trajectoryRes.trajectory,
        centroidDrift: driftRes.drift,
        activationTrace: traceRes.trace,
      });
    } catch (err) {
      console.error('Failed to load LNN data:', err);
    }
  },
}));
