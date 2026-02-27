'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { GraphNode, GraphEdge } from '@/lib/api/memory-lab';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cytoscape: any = null;
if (typeof window !== 'undefined') {
  import('cytoscape').then(m => { cytoscape = m.default || m; });
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

export function GraphCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null);

  const {
    graphNodes, graphEdges, selectedNodeId,
    setSelectedNodeId, expandNode,
  } = useMemoryLabStore();

  // Build cytoscape elements from store data
  const elements = useMemo(() => {
    const nodes = graphNodes.map((n: GraphNode) => ({
      data: {
        id: n.id,
        label: n.nodeLabel,
        nodeType: n.nodeType,
        edgeCount: n.edgeCount,
        centralityScore: n.centralityScore,
      },
    }));

    const edges = graphEdges.map((e: GraphEdge) => ({
      data: {
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        edgeType: e.edgeType,
        strength: e.strength,
        weight: e.weight,
      },
    }));

    return [...nodes, ...edges];
  }, [graphNodes, graphEdges]);

  // Initialize cytoscape
  useEffect(() => {
    if (!containerRef.current || !cytoscape) return;

    // Destroy previous instance
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-size': '10px',
            'color': '#e2e8f0',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'text-max-width': '80px',
            'text-wrap': 'ellipsis',
            'text-outline-color': '#0f172a',
            'text-outline-width': 1,
            'width': (ele: { data: (key: string) => number }) => {
              const count = ele.data('edgeCount') || 1;
              return Math.min(20 + Math.sqrt(count) * 8, 60);
            },
            'height': (ele: { data: (key: string) => number }) => {
              const count = ele.data('edgeCount') || 1;
              return Math.min(20 + Math.sqrt(count) * 8, 60);
            },
            'background-color': (ele: { data: (key: string) => string }) => {
              return NODE_COLORS[ele.data('nodeType')] || NODE_COLORS.default;
            },
            'border-width': 0,
            'border-color': '#fff',
          } as unknown as Record<string, unknown>,
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#00ff9f',
            'background-color': (ele: { data: (key: string) => string }) => {
              return NODE_COLORS[ele.data('nodeType')] || NODE_COLORS.default;
            },
          } as unknown as Record<string, unknown>,
        },
        {
          selector: 'edge',
          style: {
            'width': (ele: { data: (key: string) => number }) => {
              const str = ele.data('strength') || 0.3;
              return Math.max(1, str * 4);
            },
            'line-color': (ele: { data: (key: string) => string }) => {
              return EDGE_COLORS[ele.data('edgeType')] || EDGE_COLORS.default;
            },
            'curve-style': 'bezier',
            'opacity': 0.5,
          } as unknown as Record<string, unknown>,
        },
        {
          selector: 'edge:selected',
          style: {
            'opacity': 1,
            'line-color': '#00ff9f',
          },
        },
      ],
      layout: {
        name: 'cose',
        idealEdgeLength: 120,
        nodeOverlap: 20,
        nodeRepulsion: 8000,
        edgeElasticity: 50,
        gravity: 0.3,
        numIter: 500,
        animate: false,
      },
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 3,
    });

    // Click handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.on('tap', 'node', (evt: any) => {
      const nodeId = evt.target.id();
      setSelectedNodeId(nodeId);
    });

    // Double-click handler - expand neighbors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.on('dbltap', 'node', (evt: any) => {
      const nodeId = evt.target.id();
      expandNode(nodeId);
    });

    // Click background to deselect
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.on('tap', (evt: any) => {
      if (evt.target === cy) {
        setSelectedNodeId(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  // Only re-init on element count changes to avoid constant re-renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements.length]);

  // Update elements when data changes without full re-init
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Add new nodes
    const existingNodeIds = new Set(cy.nodes().map((n: { id: () => string }) => n.id()));
    const existingEdgeIds = new Set(cy.edges().map((e: { id: () => string }) => e.id()));

    const newElements: Array<{ group: 'nodes' | 'edges'; data: Record<string, unknown> }> = [];

    for (const node of graphNodes) {
      if (!existingNodeIds.has(node.id)) {
        newElements.push({
          group: 'nodes',
          data: {
            id: node.id,
            label: node.nodeLabel,
            nodeType: node.nodeType,
            edgeCount: node.edgeCount,
            centralityScore: node.centralityScore,
          },
        });
      }
    }

    for (const edge of graphEdges) {
      if (!existingEdgeIds.has(edge.id)) {
        // Only add edge if both endpoints exist
        const sourceExists = existingNodeIds.has(edge.sourceNodeId) || graphNodes.some(n => n.id === edge.sourceNodeId);
        const targetExists = existingNodeIds.has(edge.targetNodeId) || graphNodes.some(n => n.id === edge.targetNodeId);
        if (sourceExists && targetExists) {
          newElements.push({
            group: 'edges',
            data: {
              id: edge.id,
              source: edge.sourceNodeId,
              target: edge.targetNodeId,
              edgeType: edge.edgeType,
              strength: edge.strength,
              weight: edge.weight,
            },
          });
        }
      }
    }

    if (newElements.length > 0) {
      cy.add(newElements as unknown[]);
      // Run layout for new nodes
      cy.layout({
        name: 'cose',
        idealEdgeLength: 120,
        nodeOverlap: 20,
        nodeRepulsion: 8000,
        animate: true,
        animationDuration: 300,
        numIter: 200,
      } as unknown).run();
    }

    // Remove deleted nodes
    const currentNodeIds = new Set(graphNodes.map(n => n.id));
    cy.nodes().forEach((n: { id: () => string; remove: () => void }) => {
      if (!currentNodeIds.has(n.id())) {
        n.remove();
      }
    });
  }, [graphNodes, graphEdges]);

  // Highlight selected node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().deselect();
    if (selectedNodeId) {
      const node = cy.getElementById(selectedNodeId);
      if (node.length) {
        node.select();
      }
    }
  }, [selectedNodeId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: 'var(--theme-bg-primary)' }}
    />
  );
}
