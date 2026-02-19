'use client';

import ChatArea from '@/components/ChatArea';
import { SessionList } from '@/components/os/SessionList';
import { useLayoutStore } from '@/lib/layout-store';

export function ChatWindow() {
  const { sessionSidebarOpen } = useLayoutStore();

  return (
    <div className="h-full w-full flex overflow-hidden bg-black/20">
      <SessionList />
      <div className={`flex-1 min-w-0 ${sessionSidebarOpen ? '' : 'border-l'}`} style={{ borderColor: 'var(--theme-border)' }}>
        <ChatArea />
      </div>
    </div>
  );
}

export default ChatWindow;
