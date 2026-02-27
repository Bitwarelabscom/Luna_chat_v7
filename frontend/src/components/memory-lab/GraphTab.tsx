'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';

const BrainView = dynamic(() => import('./BrainView').then(m => ({ default: m.BrainView })), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center" style={{ background: '#0f172a' }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
    </div>
  ),
});

const ExplorerView = dynamic(() => import('./ExplorerView').then(m => ({ default: m.ExplorerView })), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center" style={{ background: '#0f172a' }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
    </div>
  ),
});

export function GraphTab() {
  const {
    graphViewMode, setGraphViewMode,
    graphOverview, brainNodes, brainEdges,
    isLoadingGraph, isBrainLoading,
    loadFullGraph, loadGraphOverview,
  } = useMemoryLabStore();

  // Load data when switching modes
  useEffect(() => {
    if (graphViewMode === 'brain' && brainNodes.length === 0 && !isBrainLoading) {
      loadFullGraph();
    }
    if (graphViewMode === 'explorer' && !graphOverview && !isLoadingGraph) {
      loadGraphOverview();
    }
  }, [graphViewMode, brainNodes.length, isBrainLoading, loadFullGraph, graphOverview, isLoadingGraph, loadGraphOverview]);

  const nodeCount = graphViewMode === 'brain' ? brainNodes.length : (graphOverview?.totalNodes ?? 0);
  const edgeCount = graphViewMode === 'brain' ? brainEdges.length : (graphOverview?.totalEdges ?? 0);

  return (
    <div className="h-full flex flex-col">
      {/* Toggle bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--theme-bg-tertiary)' }}>
          <button
            onClick={() => setGraphViewMode('explorer')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              graphViewMode === 'explorer' ? 'bg-white/10 shadow-sm' : 'hover:bg-white/5'
            }`}
            style={{
              color: graphViewMode === 'explorer' ? 'var(--theme-accent-primary)' : 'var(--theme-text-secondary)',
            }}
          >
            Explorer
          </button>
          <button
            onClick={() => setGraphViewMode('brain')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              graphViewMode === 'brain' ? 'bg-white/10 shadow-sm' : 'hover:bg-white/5'
            }`}
            style={{
              color: graphViewMode === 'brain' ? 'var(--theme-accent-primary)' : 'var(--theme-text-secondary)',
            }}
          >
            Brain
          </button>
        </div>

        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          {nodeCount > 0 && (
            <>
              <span>{nodeCount.toLocaleString()} nodes</span>
              <span>{edgeCount.toLocaleString()} edges</span>
            </>
          )}
        </div>
      </div>

      {/* Graph view */}
      <div className="flex-1 overflow-hidden">
        {graphViewMode === 'brain' ? <BrainView /> : <ExplorerView />}
      </div>
    </div>
  );
}
