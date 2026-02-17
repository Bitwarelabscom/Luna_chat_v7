'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare } from 'lucide-react';
import { useLayoutStore } from '@/lib/layout-store';
import { fabVariants, fabTransition } from '@/lib/animations';

export function ChatFloatingButton() {
  const { chatPanelOpen, setChatPanelOpen } = useLayoutStore();

  return (
    <AnimatePresence>
      {!chatPanelOpen && (
        <motion.button
          key="chat-fab"
          onClick={() => setChatPanelOpen(true)}
          className="fixed bottom-20 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: 'linear-gradient(135deg, var(--theme-accent-primary), var(--theme-accent-secondary))',
          }}
          variants={fabVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={fabTransition}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          title="Open chat"
        >
          <MessageSquare className="w-5 h-5 text-white" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default ChatFloatingButton;
