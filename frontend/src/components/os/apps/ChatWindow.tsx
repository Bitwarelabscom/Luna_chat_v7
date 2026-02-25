'use client';

import ChatArea from '@/components/ChatArea';
import { SessionList } from '@/components/os/SessionList';
import { useLayoutStore } from '@/lib/layout-store';
import { useWindowStore } from '@/lib/window-store';
import { ExternalLink } from 'lucide-react';
import dynamic from 'next/dynamic';

const CanvasWindow = dynamic(() => import('./CanvasWindow').then((m) => ({ default: m.CanvasWindow })), {
  ssr: false,
});

export function ChatWindow() {
  const { sessionSidebarOpen, inlineCanvasOpen, closeInlineCanvas } = useLayoutStore();
  const openApp = useWindowStore((state) => state.openApp);

  const handleDetachCanvas = () => {
    openApp('canvas');
    closeInlineCanvas();
  };

  return (
    <div className="h-full w-full flex overflow-hidden bg-black/20">
      <SessionList />
      <div
        className={`flex-1 min-w-0 flex overflow-hidden ${sessionSidebarOpen ? '' : 'border-l'}`}
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div className={inlineCanvasOpen ? 'w-[40%] flex-shrink-0 overflow-hidden flex flex-col' : 'flex-1'}>
          <ChatArea />
        </div>
        {inlineCanvasOpen && (
          <div className="flex-1 flex flex-col border-l" style={{ borderColor: 'var(--theme-border)' }}>
            {/* Canvas toolbar */}
            <div
              className="flex items-center justify-between px-3 py-1.5 border-b bg-gray-900 shrink-0"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <span className="text-xs font-medium text-gray-400">Canvas</span>
              <button
                onClick={handleDetachCanvas}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-white/10 transition-colors"
              >
                <ExternalLink size={12} />
                Detach
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <CanvasWindow />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatWindow;
