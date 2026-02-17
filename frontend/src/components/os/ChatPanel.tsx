'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useLayoutStore } from '@/lib/layout-store';
import { panelVariants, panelTransition } from '@/lib/animations';
import { ChatPanelHeader } from './ChatPanelHeader';
import { SessionList } from './SessionList';
import ChatArea from '@/components/ChatArea';

export function ChatPanel() {
  const { chatPanelOpen, chatPanelWidth, sessionSidebarOpen } = useLayoutStore();

  return (
    <AnimatePresence>
      {chatPanelOpen && (
        <motion.div
          key="chat-panel"
          className="absolute inset-y-0 right-0 z-[100] flex flex-col"
          style={{
            width: chatPanelWidth,
            borderLeft: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-primary)',
          }}
          variants={panelVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={panelTransition}
        >
          <ChatPanelHeader />
          <div className="flex flex-1 min-h-0">
            {sessionSidebarOpen && <SessionList />}
            <div className="flex-1 flex flex-col min-w-0">
              <ChatArea />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ChatPanel;
