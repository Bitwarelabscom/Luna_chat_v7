'use client';

import { Loader2 } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import { NodeListPanel } from './NodeListPanel';
import { GraphCanvas } from './GraphCanvas';
import { NodeDetailPanel } from './NodeDetailPanel';

export function GraphTab() {
  const { isLoadingGraph, graphOverview } = useMemoryLabStore();

  if (isLoadingGraph && !graphOverview) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: 'var(--theme-accent-primary)' }} />
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading graph data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Left: Node list (200px) */}
      <div className="w-[200px] shrink-0">
        <NodeListPanel />
      </div>

      {/* Center: Cytoscape canvas */}
      <div className="flex-1 relative">
        {/* Stats overlay */}
        {graphOverview && (
          <div
            className="absolute top-2 left-2 z-10 flex items-center gap-3 px-3 py-1.5 rounded-lg text-[10px]"
            style={{ background: 'rgba(0, 0, 0, 0.6)', color: 'var(--theme-text-muted)' }}
          >
            <span>{graphOverview.totalNodes.toLocaleString()} nodes</span>
            <span>{graphOverview.totalEdges.toLocaleString()} edges</span>
            <span>
              Types: {Object.entries(graphOverview.nodesByType)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 4)
                .map(([type, count]) => `${type}(${count})`)
                .join(', ')}
            </span>
          </div>
        )}
        <GraphCanvas />
      </div>

      {/* Right: Detail panel (280px) */}
      <div className="w-[280px] shrink-0">
        <NodeDetailPanel />
      </div>
    </div>
  );
}
