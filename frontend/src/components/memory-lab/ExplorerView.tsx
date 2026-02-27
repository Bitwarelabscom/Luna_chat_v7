'use client';

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import { NodeListPanel } from './NodeListPanel';
import { NodeDetailPanel } from './NodeDetailPanel';
import type { GraphNode, GraphEdge } from '@/lib/api/memory-lab';

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

interface FGNode {
  id: string;
  label: string;
  nodeType: string;
  edgeCount: number;
  centralityScore: number;
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
  const {
    graphNodes, graphEdges, selectedNodeId,
    setSelectedNodeId, expandNode,
  } = useMemoryLabStore();

  const graphData = useMemo(() => {
    const nodeSet = new Set(graphNodes.map((n: GraphNode) => n.id));
    const nodes: FGNode[] = graphNodes.map((n: GraphNode) => ({
      id: n.id,
      label: n.nodeLabel,
      nodeType: n.nodeType,
      edgeCount: n.edgeCount,
      centralityScore: n.centralityScore,
    }));

    const links: FGLink[] = graphEdges
      .filter((e: GraphEdge) => nodeSet.has(e.sourceNodeId) && nodeSet.has(e.targetNodeId))
      .map((e: GraphEdge) => ({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        edgeType: e.edgeType,
        strength: e.strength,
      }));

    return { nodes, links };
  }, [graphNodes, graphEdges]);

  const handleClick = useCallback((node: FGNode) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const handleDblClick = useCallback((node: FGNode) => {
    expandNode(node.id);
  }, [expandNode]);

  const handleBgClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as FGNode;
    const radius = 2 + Math.sqrt(n.edgeCount) * 1.2;
    const color = NODE_COLORS[n.nodeType] || NODE_COLORS.default;

    // Circle
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Selected ring
    if (n.id === selectedNodeId) {
      ctx.strokeStyle = '#00ff9f';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label at sufficient zoom
    if (globalScale > 0.6) {
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(n.label, node.x!, node.y! + radius + 1);
    }
  }, [selectedNodeId]);

  // Zoom to fit on initial load
  useEffect(() => {
    const fg = fgRef.current;
    if (fg && graphNodes.length > 0) {
      const timer = setTimeout(() => fg.zoomToFit(400, 40), 300);
      return () => clearTimeout(timer);
    }
  }, [graphNodes.length]);

  return (
    <div className="h-full flex">
      <div className="w-[200px] shrink-0">
        <NodeListPanel />
      </div>

      <div className="flex-1 relative" style={{ background: '#0f172a' }}>
        {ForceGraph2D && graphData.nodes.length > 0 && (
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            backgroundColor="#0f172a"
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={(node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
              const radius = 2 + Math.sqrt(node.edgeCount) * 1.2;
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, radius + 2, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={(link: FGLink) => EDGE_COLORS[(link as FGLink).edgeType] || EDGE_COLORS.default}
            linkWidth={(link: FGLink) => Math.max(0.5, (link as FGLink).strength * 3)}
            linkOpacity={0.3}
            onNodeClick={handleClick}
            onNodeDblClick={handleDblClick}
            onBackgroundClick={handleBgClick}
            cooldownTicks={200}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        )}
        {graphData.nodes.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              No nodes loaded. Search or expand the graph.
            </p>
          </div>
        )}
      </div>

      <div className="w-[280px] shrink-0">
        <NodeDetailPanel />
      </div>
    </div>
  );
}
