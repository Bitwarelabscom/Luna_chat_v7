'use client';

import { PanelLeftClose, PanelLeftOpen, Columns2, Maximize2, X } from 'lucide-react';
import { useLayoutStore } from '@/lib/layout-store';

export function ChatPanelHeader() {
  const {
    sessionSidebarOpen,
    toggleSessionSidebar,
    chatPanelWidth,
    setChatPanelWidth,
    setChatPanelOpen,
  } = useLayoutStore();

  return (
    <div
      className="flex items-center justify-between px-3 h-10 flex-shrink-0 border-b"
      style={{
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* Left: sidebar toggle */}
      <button
        onClick={toggleSessionSidebar}
        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        title={sessionSidebarOpen ? 'Hide sessions' : 'Show sessions'}
      >
        {sessionSidebarOpen ? (
          <PanelLeftClose className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        ) : (
          <PanelLeftOpen className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        )}
      </button>

      {/* Right: width + close */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setChatPanelWidth('50%')}
          className={`p-1.5 rounded-lg transition-colors ${chatPanelWidth === '50%' ? 'bg-white/10' : 'hover:bg-white/10'}`}
          title="Half width"
        >
          <Columns2 className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <button
          onClick={() => setChatPanelWidth('100%')}
          className={`p-1.5 rounded-lg transition-colors ${chatPanelWidth === '100%' ? 'bg-white/10' : 'hover:bg-white/10'}`}
          title="Full width"
        >
          <Maximize2 className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <button
          onClick={() => setChatPanelOpen(false)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors ml-1"
          title="Close chat"
        >
          <X className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
      </div>
    </div>
  );
}

export default ChatPanelHeader;
