'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
  Brain,
  RefreshCw,
  Wifi,
  WifiOff,
  Network,
  BookOpen,
  Activity,
  Radio,
} from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import { GraphTab } from '@/components/memory-lab/GraphTab';
import { FactsTab } from '@/components/memory-lab/FactsTab';
import { ConsciousnessTab } from '@/components/memory-lab/ConsciousnessTab';
import { LnnTab } from '@/components/memory-lab/LnnTab';

type TabId = 'graph' | 'facts' | 'consciousness' | 'lnn';

const TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'facts', label: 'Facts', icon: BookOpen },
  { id: 'consciousness', label: 'Consciousness', icon: Activity },
  { id: 'lnn', label: 'LNN Live', icon: Radio },
];

export default function MemoryLabWindow() {
  const initialized = useRef(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const {
    activeTab, setActiveTab,
    graphViewMode,
    isHealthy, neuralsleepConnected,
    loadGraphOverview,
    loadFullGraph,
    loadFacts,
    loadConsciousness,
    loadLnnData,
  } = useMemoryLabStore();

  const isRefreshingRef = useRef(false);

  // Initialize on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadConsciousness();
    if (graphViewMode === 'brain') {
      loadFullGraph();
    } else {
      loadGraphOverview();
    }
  }, [loadConsciousness, loadGraphOverview, loadFullGraph, graphViewMode]);

  // Refresh active tab data
  const refreshActiveTab = useCallback(() => {
    switch (activeTab) {
      case 'graph': return graphViewMode === 'brain' ? loadFullGraph() : loadGraphOverview();
      case 'facts': return loadFacts();
      case 'consciousness': return loadConsciousness();
      case 'lnn': return loadLnnData();
    }
  }, [activeTab, graphViewMode, loadGraphOverview, loadFullGraph, loadFacts, loadConsciousness, loadLnnData]);

  // Load data when switching tabs
  useEffect(() => {
    refreshActiveTab();
  }, [activeTab, refreshActiveTab]);

  // Polling: 5s for LNN, 30s for consciousness
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    if (activeTab === 'lnn') {
      pollRef.current = setInterval(loadLnnData, 5000);
    } else if (activeTab === 'consciousness') {
      pollRef.current = setInterval(loadConsciousness, 30000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeTab, loadLnnData, loadConsciousness]);

  const handleRefresh = async () => {
    isRefreshingRef.current = true;
    await refreshActiveTab();
    setTimeout(() => { isRefreshingRef.current = false; }, 500);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b shrink-0"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-1.5 rounded-lg"
            style={{ background: 'rgba(0, 200, 255, 0.1)' }}
          >
            <Brain className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
          </div>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--theme-text-primary)' }}>
              Memory Lab
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Health badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
            style={{ background: 'var(--theme-bg-tertiary)' }}
          >
            {isHealthy ? (
              <Wifi className="w-3 h-3 text-green-400" />
            ) : (
              <WifiOff className="w-3 h-3 text-red-400" />
            )}
            <span style={{ color: 'var(--theme-text-muted)' }}>
              {neuralsleepConnected ? 'NeuralSleep' : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg transition hover:bg-[var(--theme-bg-tertiary)]"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-1 px-4 py-1.5 border-b shrink-0"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                isActive ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
              style={{
                color: isActive ? 'var(--theme-accent-primary)' : 'var(--theme-text-secondary)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'graph' && <GraphTab />}
        {activeTab === 'facts' && <FactsTab />}
        {activeTab === 'consciousness' && <ConsciousnessTab />}
        {activeTab === 'lnn' && <LnnTab />}
      </div>
    </div>
  );
}
