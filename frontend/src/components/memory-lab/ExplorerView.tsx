'use client';

import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2, GitMerge, Link2, X } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { GraphNode, SlimGraphEdge } from '@/lib/api/memory-lab';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ForceGraph2D: any = null;
if (typeof window !== 'undefined') {
  import('react-force-graph-2d').then(m => { ForceGraph2D = m.default || m; });
}

const NODE_COLORS: Record<string, string> = {
  entity: '#3b82f6',
  person: '#3b82f6',
  topic: '#22c55e',
  concept: '#a855f7',
  preference: '#f59e0b',
  emotion: '#ec4899',
  event: '#06b6d4',
  location: '#84cc16',
  object: '#64748b',
  default: '#6b7280',
};

const EDGE_COLORS: Record<string, string> = {
  co_occurrence: '#6b7280',
  semantic: '#3b82f6',
  temporal: '#22c55e',
  causal: '#f97316',
  same_as: '#a855f7',
  contradicts: '#ef4444',
  default: '#4b5563',
};

const LEGEND_ITEMS = [
  { type: 'person', color: '#3b82f6', label: 'Person / Entity' },
  { type: 'topic', color: '#22c55e', label: 'Topic' },
  { type: 'concept', color: '#a855f7', label: 'Concept' },
  { type: 'preference', color: '#f59e0b', label: 'Preference' },
  { type: 'emotion', color: '#ec4899', label: 'Emotion' },
  { type: 'event', color: '#06b6d4', label: 'Event' },
  { type: 'location', color: '#84cc16', label: 'Location' },
];

interface FGNode {
  id: string;
  label: string;
  nodeType: string;
  edgeCount: number;
  centralityScore: number;
  activationStrength: number;
  emotionalIntensity: number;
  x?: number;
  y?: number;
}

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  edgeType: string;
  strength: number;
}

export function ExplorerView() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showEdgeDialog, setShowEdgeDialog] = useState(false);

  const {
    brainNodes, brainEdges, isBrainLoading,
    brainMinEdges, setBrainMinEdges,
    selectedNodeId, setSelectedNodeId,
    updateNode, deleteNode, mergeNodes, createEdge,
  } = useMemoryLabStore();

  // Track container size - re-attach when loading state changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Capture initial size immediately
    setDimensions({ width: el.clientWidth, height: el.clientHeight });
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isBrainLoading]);

  // Configure forces for better spread
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge');
    if (charge) charge.strength(-1000);
    const link = fg.d3Force('link');
    if (link) link.distance((l: FGLink) => 100 + 200 * (1 - (typeof l.strength === 'number' ? l.strength : 0.5)));
  });

  const graphData = useMemo(() => {
    const filteredNodes = brainNodes.filter((n: GraphNode) => n.edgeCount >= brainMinEdges);
    const nodeSet = new Set(filteredNodes.map((n: GraphNode) => n.id));

    const nodes: FGNode[] = filteredNodes.map((n: GraphNode) => ({
      id: n.id,
      label: n.nodeLabel,
      nodeType: n.nodeType,
      edgeCount: n.edgeCount,
      centralityScore: n.centralityScore,
      activationStrength: n.activationStrength,
      emotionalIntensity: n.emotionalIntensity,
    }));

    const links: FGLink[] = brainEdges
      .filter((e: SlimGraphEdge) => nodeSet.has(e.sourceNodeId) && nodeSet.has(e.targetNodeId))
      .map((e: SlimGraphEdge) => ({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        edgeType: e.edgeType,
        strength: e.strength,
      }));

    return { nodes, links };
  }, [brainNodes, brainEdges, brainMinEdges]);

  const handleClick = useCallback((node: FGNode) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const handleBgClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as FGNode;
    const radius = 0.3 + Math.sqrt(n.edgeCount) * 0.2;
    const color = NODE_COLORS[n.nodeType] || NODE_COLORS.default;

    ctx.beginPath();
    ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (n.id === selectedNodeId) {
      ctx.strokeStyle = '#00ff9f';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (globalScale > 0.4 || n.edgeCount > 20) {
      const fontSize = Math.max(11 / globalScale, 2.5);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(n.label, node.x!, node.y! + radius + 1);
    }
  }, [selectedNodeId]);

  // Zoom to fit on data change
  useEffect(() => {
    const fg = fgRef.current;
    if (fg && graphData.nodes.length > 0) {
      const timer = setTimeout(() => fg.zoomToFit(400, 60), 500);
      return () => clearTimeout(timer);
    }
  }, [graphData.nodes.length]);

  const selectedNode = useMemo(
    () => brainNodes.find(n => n.id === selectedNodeId),
    [brainNodes, selectedNodeId]
  );

  const handleDeleteNode = useCallback(() => {
    if (selectedNode && confirm(`Delete node "${selectedNode.nodeLabel}"?`)) {
      deleteNode(selectedNode.id);
    }
  }, [selectedNode, deleteNode]);

  return (
    <div ref={containerRef} className="h-full relative" style={{ background: '#0f172a' }}>
      {isBrainLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-30">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--theme-accent-primary)', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading graph...</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
              {brainNodes.length > 0 ? `${brainNodes.length.toLocaleString()} nodes loaded` : 'Fetching all nodes and edges...'}
            </p>
          </div>
        </div>
      )}
      {!isBrainLoading && ForceGraph2D && graphData.nodes.length > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0f172a"
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={(node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
            const radius = 0.3 + Math.sqrt(node.edgeCount) * 0.2 + 2;
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkColor={(link: FGLink) => EDGE_COLORS[link.edgeType] || EDGE_COLORS.default}
          linkWidth={(link: FGLink) => Math.max(0.3, link.strength * 2.5)}
          linkOpacity={0.25}
          onNodeClick={handleClick}
          onBackgroundClick={handleBgClick}
          cooldownTicks={300}
          d3AlphaDecay={0.01}
          d3VelocityDecay={0.2}
          enableNodeDrag={true}
        />
      )}

      {!isBrainLoading && graphData.nodes.length === 0 && (
        <div className="h-full flex items-center justify-center">
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            No nodes match the current filter. Try lowering the min edges threshold.
          </p>
        </div>
      )}

      {/* Min edges threshold slider (top-left) */}
      <div
        className="absolute top-3 left-3 z-10 px-3 py-2 rounded-lg"
        style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(148, 163, 184, 0.15)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-medium" style={{ color: '#e2e8f0' }}>
            Min edges: {brainMinEdges}
          </span>
          <span className="text-[10px]" style={{ color: '#64748b' }}>
            {graphData.nodes.length.toLocaleString()} nodes | {graphData.links.length.toLocaleString()} edges
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={1000}
          step={1}
          value={brainMinEdges}
          onChange={e => setBrainMinEdges(Number(e.target.value))}
          className="w-36 h-1 cursor-pointer"
          style={{ accentColor: '#3b82f6' }}
        />
        <div className="flex justify-between text-[9px] mt-0.5" style={{ color: '#64748b' }}>
          <span>1</span>
          <span>1000</span>
        </div>
      </div>

      {/* Color legend (bottom-left) */}
      <div
        className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-lg"
        style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(148, 163, 184, 0.15)' }}
      >
        {LEGEND_ITEMS.map(item => (
          <div key={item.type} className="flex items-center gap-2 py-0.5">
            <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
            <span className="text-[10px]" style={{ color: '#94a3b8' }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Selected node info (bottom-right) */}
      {selectedNode && (
        <div
          className="absolute bottom-3 right-3 z-10 px-4 py-3 rounded-lg max-w-[280px]"
          style={{ background: 'rgba(15, 23, 42, 0.92)', border: '1px solid rgba(148, 163, 184, 0.2)' }}
        >
          <div className="flex items-start justify-between mb-1">
            <div className="text-sm font-medium pr-2" style={{ color: '#e2e8f0' }}>{selectedNode.nodeLabel}</div>
            <button onClick={() => setSelectedNodeId(null)} className="p-0.5 hover:bg-white/10 rounded shrink-0">
              <X className="w-3 h-3" style={{ color: '#64748b' }} />
            </button>
          </div>
          <div className="space-y-0.5 text-[10px]" style={{ color: '#94a3b8' }}>
            <div className="flex justify-between"><span>Type</span><span style={{ color: NODE_COLORS[selectedNode.nodeType] || '#6b7280' }}>{selectedNode.nodeType}</span></div>
            <div className="flex justify-between"><span>Edges</span><span>{selectedNode.edgeCount}</span></div>
            <div className="flex justify-between"><span>Centrality</span><span>{selectedNode.centralityScore.toFixed(4)}</span></div>
            <div className="flex justify-between"><span>Activation</span><span>{selectedNode.activationStrength.toFixed(3)}</span></div>
            {selectedNode.emotionalIntensity > 0 && (
              <div className="flex justify-between"><span>Emotion</span><span>{selectedNode.emotionalIntensity.toFixed(2)}</span></div>
            )}
          </div>
          <div className="flex items-center gap-1 mt-2 pt-1.5 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.15)' }}>
            <button onClick={() => setShowEditModal(true)} className="p-1.5 rounded hover:bg-white/10 transition" title="Edit">
              <Pencil className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
            </button>
            <button onClick={() => setShowMergeDialog(true)} className="p-1.5 rounded hover:bg-white/10 transition" title="Merge">
              <GitMerge className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
            </button>
            <button onClick={() => setShowEdgeDialog(true)} className="p-1.5 rounded hover:bg-white/10 transition" title="Add Edge">
              <Link2 className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
            </button>
            <button onClick={handleDeleteNode} className="p-1.5 rounded hover:bg-red-400/10 transition ml-auto" title="Delete">
              <Trash2 className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showEditModal && selectedNode && (
        <EditModal
          node={selectedNode}
          onSave={(label, type) => { updateNode(selectedNode.id, { label, type }); setShowEditModal(false); }}
          onClose={() => setShowEditModal(false)}
        />
      )}
      {showMergeDialog && selectedNode && (
        <MergeDialog
          sourceLabel={selectedNode.nodeLabel}
          candidates={brainNodes.filter(n => n.id !== selectedNode.id).slice(0, 200)}
          onMerge={(targetId, reason) => { mergeNodes(selectedNode.id, targetId, reason); setShowMergeDialog(false); }}
          onClose={() => setShowMergeDialog(false)}
        />
      )}
      {showEdgeDialog && selectedNode && (
        <CreateEdgeDialog
          sourceLabel={selectedNode.nodeLabel}
          candidates={brainNodes.filter(n => n.id !== selectedNode.id).slice(0, 200)}
          onCreateEdge={(targetId, type) => { createEdge(selectedNode.id, targetId, type); setShowEdgeDialog(false); }}
          onClose={() => setShowEdgeDialog(false)}
        />
      )}
    </div>
  );
}

function EditModal({
  node, onSave, onClose,
}: {
  node: { nodeLabel: string; nodeType: string };
  onSave: (label: string, type: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(node.nodeLabel);
  const [type, setType] = useState(node.nodeType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[360px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-text-primary)' }}>Edit Node</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--theme-text-muted)' }}>Label</label>
            <input
              value={label} onChange={e => setLabel(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--theme-text-muted)' }}>Type</label>
            <input
              value={type} onChange={e => setType(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Cancel</button>
          <button
            onClick={() => onSave(label, type)}
            className="px-3 py-1.5 rounded text-xs font-medium"
            style={{ background: 'var(--theme-accent-primary)', color: 'var(--theme-bg-primary)' }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

function MergeDialog({
  sourceLabel, candidates, onMerge, onClose,
}: {
  sourceLabel: string;
  candidates: Array<{ id: string; nodeLabel: string; nodeType: string }>;
  onMerge: (targetId: string, reason?: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');

  const filtered = candidates.filter(c =>
    c.nodeLabel.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[400px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--theme-text-primary)' }}>
          Merge &quot;{sourceLabel}&quot; into...
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--theme-text-muted)' }}>
          The selected node will be absorbed by the target node.
        </p>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search target node..."
          className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none mb-2"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        />
        <div className="max-h-40 overflow-auto mb-3 space-y-0.5">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => onMerge(c.id, reason || undefined)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-white/5 transition"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              <span className="truncate">{c.nodeLabel}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                ({c.nodeType})
              </span>
            </button>
          ))}
        </div>
        <input
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none mb-3"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        />
        <div className="flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function CreateEdgeDialog({
  sourceLabel, candidates, onCreateEdge, onClose,
}: {
  sourceLabel: string;
  candidates: Array<{ id: string; nodeLabel: string; nodeType: string }>;
  onCreateEdge: (targetId: string, type: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [edgeType, setEdgeType] = useState('semantic');
  const EDGE_TYPES = ['co_occurrence', 'semantic', 'temporal', 'causal', 'same_as', 'contradicts'];

  const filtered = candidates.filter(c =>
    c.nodeLabel.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[400px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-text-primary)' }}>
          Create Edge from &quot;{sourceLabel}&quot;
        </h3>
        <div className="mb-2">
          <label className="text-xs block mb-1" style={{ color: 'var(--theme-text-muted)' }}>Edge Type</label>
          <select
            value={edgeType} onChange={e => setEdgeType(e.target.value)}
            className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none"
            style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
          >
            {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search target node..."
          className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none mb-2"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        />
        <div className="max-h-40 overflow-auto mb-3 space-y-0.5">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => onCreateEdge(c.id, edgeType)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-white/5 transition"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              <span className="truncate">{c.nodeLabel}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-text-muted)' }}>({c.nodeType})</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
