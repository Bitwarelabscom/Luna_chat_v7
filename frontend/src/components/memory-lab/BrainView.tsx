'use client';

import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { GraphNode, SlimGraphEdge } from '@/lib/api/memory-lab';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ForceGraph3D: any = null;
if (typeof window !== 'undefined') {
  import('react-force-graph-3d').then(m => { ForceGraph3D = m.default || m; });
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
  co_occurrence: '#6b728044',
  semantic: '#3b82f644',
  temporal: '#22c55e44',
  causal: '#f9731644',
  same_as: '#a855f744',
  contradicts: '#ef444444',
  default: '#4b556344',
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

interface FG3DNode {
  id: string;
  label: string;
  nodeType: string;
  edgeCount: number;
  centralityScore: number;
  emotionalIntensity: number;
  x?: number;
  y?: number;
  z?: number;
}

interface FG3DLink {
  source: string | FG3DNode;
  target: string | FG3DNode;
  edgeType: string;
  strength: number;
}

interface HoveredInfo {
  label: string;
  nodeType: string;
  edgeCount: number;
  centralityScore: number;
  x: number;
  y: number;
}

export function BrainView() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredInfo | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const {
    brainNodes, brainEdges, isBrainLoading,
    selectedNodeId, setSelectedNodeId,
  } = useMemoryLabStore();

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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
  }, []);

  const graphData = useMemo(() => {
    const nodes: FG3DNode[] = brainNodes.map((n: GraphNode) => ({
      id: n.id,
      label: n.nodeLabel,
      nodeType: n.nodeType,
      edgeCount: n.edgeCount,
      centralityScore: n.centralityScore,
      emotionalIntensity: n.emotionalIntensity,
    }));

    const nodeSet = new Set(brainNodes.map((n: GraphNode) => n.id));
    const links: FG3DLink[] = brainEdges
      .filter((e: SlimGraphEdge) => nodeSet.has(e.sourceNodeId) && nodeSet.has(e.targetNodeId))
      .map((e: SlimGraphEdge) => ({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        edgeType: e.edgeType,
        strength: e.strength,
      }));

    return { nodes, links };
  }, [brainNodes, brainEdges]);

  const handleClick = useCallback((node: FG3DNode) => {
    setSelectedNodeId(node.id);
    const fg = fgRef.current;
    if (fg) {
      const distance = 120;
      const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
      fg.cameraPosition(
        { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
        { x: node.x, y: node.y, z: node.z },
        1000
      );
    }
  }, [setSelectedNodeId]);

  const handleHover = useCallback((node: FG3DNode | null, prevNode: FG3DNode | null) => {
    if (prevNode) setHovered(null);
    if (node) {
      const fg = fgRef.current;
      if (fg) {
        const coords = fg.graph2ScreenCoords(node.x || 0, node.y || 0, node.z || 0);
        setHovered({
          label: node.label,
          nodeType: node.nodeType,
          edgeCount: node.edgeCount,
          centralityScore: node.centralityScore,
          x: coords.x,
          y: coords.y,
        });
      }
    }
  }, []);

  const handleZoom = useCallback((factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera();
    const pos = cam.position;
    fg.cameraPosition(
      { x: pos.x * factor, y: pos.y * factor, z: pos.z * factor },
      undefined,
      300
    );
  }, []);

  const handleReset = useCallback(() => {
    const fg = fgRef.current;
    if (fg) {
      fg.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 500);
    }
  }, []);

  if (isBrainLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: '#0f172a' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--theme-accent-primary)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading brain graph...</p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
            {brainNodes.length > 0 ? `${brainNodes.length.toLocaleString()} nodes loaded` : 'Fetching all nodes and edges...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full relative" style={{ background: '#0f172a' }}>
      {ForceGraph3D && graphData.nodes.length > 0 && (
        <ForceGraph3D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0f172a"
          nodeColor={(n: FG3DNode) => NODE_COLORS[n.nodeType] || NODE_COLORS.default}
          nodeVal={(n: FG3DNode) => 2 + Math.sqrt(n.edgeCount) * 1.5}
          nodeLabel=""
          nodeOpacity={0.9}
          linkColor={(l: FG3DLink) => EDGE_COLORS[l.edgeType] || EDGE_COLORS.default}
          linkWidth={(l: FG3DLink) => Math.max(0.3, l.strength * 2)}
          linkOpacity={0.15}
          warmupTicks={100}
          cooldownTicks={200}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          enableNodeDrag={false}
          onNodeClick={handleClick}
          onNodeHover={handleHover}
        />
      )}

      {graphData.nodes.length === 0 && !isBrainLoading && (
        <div className="h-full flex items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            No graph data available.
          </p>
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && (
        <div
          className="absolute z-20 pointer-events-none px-3 py-2 rounded-lg shadow-xl"
          style={{
            left: hovered.x + 12,
            top: hovered.y - 10,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
          }}
        >
          <div className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{hovered.label}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: NODE_COLORS[hovered.nodeType] + '33', color: NODE_COLORS[hovered.nodeType] || '#6b7280' }}
            >
              {hovered.nodeType}
            </span>
            <span className="text-[10px]" style={{ color: '#94a3b8' }}>
              {hovered.edgeCount} edges
            </span>
            <span className="text-[10px]" style={{ color: '#94a3b8' }}>
              C: {hovered.centralityScore.toFixed(3)}
            </span>
          </div>
        </div>
      )}

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

      {/* Zoom controls (top-right) */}
      <div
        className="absolute top-3 right-3 z-10 flex flex-col gap-1 rounded-lg p-1"
        style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(148, 163, 184, 0.15)' }}
      >
        <button
          onClick={() => handleZoom(0.7)}
          className="p-1.5 rounded hover:bg-white/10 transition"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" style={{ color: '#94a3b8' }} />
        </button>
        <button
          onClick={() => handleZoom(1.4)}
          className="p-1.5 rounded hover:bg-white/10 transition"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" style={{ color: '#94a3b8' }} />
        </button>
        <button
          onClick={handleReset}
          className="p-1.5 rounded hover:bg-white/10 transition"
          title="Reset view"
        >
          <RotateCcw className="w-4 h-4" style={{ color: '#94a3b8' }} />
        </button>
      </div>

      {/* Selected node info */}
      {selectedNodeId && (() => {
        const node = brainNodes.find(n => n.id === selectedNodeId);
        if (!node) return null;
        return (
          <div
            className="absolute bottom-3 right-3 z-10 px-4 py-3 rounded-lg max-w-[260px]"
            style={{ background: 'rgba(15, 23, 42, 0.92)', border: '1px solid rgba(148, 163, 184, 0.2)' }}
          >
            <div className="text-sm font-medium mb-1" style={{ color: '#e2e8f0' }}>{node.nodeLabel}</div>
            <div className="space-y-0.5 text-[10px]" style={{ color: '#94a3b8' }}>
              <div className="flex justify-between"><span>Type</span><span style={{ color: NODE_COLORS[node.nodeType] || '#6b7280' }}>{node.nodeType}</span></div>
              <div className="flex justify-between"><span>Edges</span><span>{node.edgeCount}</span></div>
              <div className="flex justify-between"><span>Centrality</span><span>{node.centralityScore.toFixed(4)}</span></div>
              <div className="flex justify-between"><span>Activation</span><span>{node.activationStrength.toFixed(3)}</span></div>
              {node.emotionalIntensity > 0 && (
                <div className="flex justify-between"><span>Emotion</span><span>{node.emotionalIntensity.toFixed(2)}</span></div>
              )}
            </div>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="mt-2 text-[10px] underline"
              style={{ color: '#64748b' }}
            >
              Deselect
            </button>
          </div>
        );
      })()}
    </div>
  );
}
