'use client';

import ChatArea from '@/components/ChatArea';

export function ChatWindow() {
  return (
    <div className="h-full w-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ChatArea />
      </div>
    </div>
  );
}

export default ChatWindow;
