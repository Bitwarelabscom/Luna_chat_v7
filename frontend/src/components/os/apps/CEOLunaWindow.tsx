'use client';

import { useEffect, useRef } from 'react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import { KPIStrip } from '@/components/ceo-luna/KPIStrip';
import { FileTree } from '@/components/ceo-luna/FileTree';
import { DocViewer } from '@/components/ceo-luna/DocViewer';
import { CEOChat } from '@/components/ceo-luna/CEOChat';
import { DashboardPanel } from '@/components/ceo-luna/DashboardPanel';
import { RadarPanel } from '@/components/ceo-luna/RadarPanel';
import { AutopostPanel } from '@/components/ceo-luna/AutopostPanel';
import { QuickLogPanel } from '@/components/ceo-luna/QuickLogPanel';
import { BuildsPanel } from '@/components/ceo-luna/BuildsPanel';
import { AlbumCreatorTab } from '@/components/ceo-luna/AlbumCreatorTab';
import { OrgPanel } from '@/components/ceo-luna/OrgPanel';

const TABS = [
  { id: 'viewer' as const, label: 'Viewer' },
  { id: 'chat' as const, label: 'Chat' },
  { id: 'dashboard' as const, label: 'Dashboard' },
  { id: 'org' as const, label: 'Org' },
  { id: 'albums' as const, label: 'Albums' },
  { id: 'radar' as const, label: 'Radar' },
  { id: 'autopost' as const, label: 'Autopost' },
  { id: 'builds' as const, label: 'Builds' },
  { id: 'log' as const, label: 'Log' },
] as const;

type Tab = typeof TABS[number]['id'];

export default function CEOLunaWindow() {
  const { activeTab, setActiveTab, loadFileTree } = useCEOLunaStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadFileTree();
    }
  }, [loadFileTree]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950">
      {/* KPI strip at top */}
      <KPIStrip />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: file tree (25%) */}
        <div className="overflow-hidden border-r border-gray-700" style={{ width: '25%', minWidth: 200, maxWidth: 300 }}>
          <FileTree />
        </div>

        {/* Right panel: tabs + content (75%) */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-700 bg-gray-900 shrink-0 overflow-x-auto whitespace-nowrap">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as Tab)}
                className={`shrink-0 px-3 py-1 text-sm rounded transition-colors ${
                  activeTab === id
                    ? 'bg-slate-700 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'viewer' && <DocViewer />}
            {activeTab === 'chat' && <CEOChat />}
            {activeTab === 'dashboard' && <DashboardPanel />}
            {activeTab === 'org' && <OrgPanel />}
            {activeTab === 'albums' && <AlbumCreatorTab />}
            {activeTab === 'radar' && <RadarPanel />}
            {activeTab === 'autopost' && <AutopostPanel />}
            {activeTab === 'builds' && <BuildsPanel />}
            {activeTab === 'log' && <QuickLogPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
