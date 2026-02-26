'use client';

import { useMemo } from 'react';
import { Search } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';

const NODE_TYPE_COLORS: Record<string, string> = {
  person: 'text-blue-400',
  topic: 'text-green-400',
  concept: 'text-purple-400',
  preference: 'text-amber-400',
  emotion: 'text-pink-400',
  event: 'text-cyan-400',
  location: 'text-lime-400',
  object: 'text-slate-400',
};

export function NodeListPanel() {
  const {
    graphNodes, selectedNodeId, graphSearch, graphFilterType,
    setSelectedNodeId, searchNodes, setGraphFilterType,
  } = useMemoryLabStore();

  // Get unique node types
  const nodeTypes = useMemo(() => {
    const types = new Set(graphNodes.map(n => n.nodeType));
    return Array.from(types).sort();
  }, [graphNodes]);

  const handleSearch = (query: string) => {
    searchNodes(query);
  };

  return (
    <div className="h-full flex flex-col border-r" style={{ borderColor: 'var(--theme-border-default)' }}>
      {/* Search */}
      <div className="p-2 space-y-2 border-b shrink-0" style={{ borderColor: 'var(--theme-border-default)' }}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: 'var(--theme-text-muted)' }} />
          <input
            type="text"
            value={graphSearch}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search nodes..."
            className="w-full pl-6 pr-2 py-1 rounded text-xs bg-transparent border outline-none"
            style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
          />
        </div>

        {/* Type filter */}
        <select
          value={graphFilterType || ''}
          onChange={e => setGraphFilterType(e.target.value || null)}
          className="w-full px-2 py-1 rounded text-xs bg-transparent border outline-none"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        >
          <option value="">All types</option>
          {nodeTypes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-auto">
        {graphNodes.length === 0 ? (
          <div className="p-3 text-center">
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No nodes loaded</span>
          </div>
        ) : (
          graphNodes.map(node => {
            const isSelected = selectedNodeId === node.id;
            const typeColor = NODE_TYPE_COLORS[node.nodeType] || 'text-gray-400';
            return (
              <button
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition ${
                  isSelected ? 'bg-white/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: typeColor.replace('text-', 'rgb(') + ')' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{ color: 'var(--theme-text-primary)' }}>
                    {node.nodeLabel}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${typeColor}`}>{node.nodeType}</span>
                    <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                      {node.edgeCount} edges
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="px-2 py-1.5 border-t text-center shrink-0" style={{ borderColor: 'var(--theme-border-default)' }}>
        <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          {graphNodes.length} nodes
        </span>
      </div>
    </div>
  );
}
