'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChatPanelState {
  chatPanelOpen: boolean;
  chatPanelWidth: '50%' | '100%';
  sessionSidebarOpen: boolean;
  inlineCanvasOpen: boolean;
  toggleChatPanel: () => void;
  setChatPanelOpen: (open: boolean) => void;
  setChatPanelWidth: (width: '50%' | '100%') => void;
  toggleSessionSidebar: () => void;
  openInlineCanvas: () => void;
  closeInlineCanvas: () => void;
  // Legacy compat aliases
  chatSidebarOpen: boolean;
  toggleChatSidebar: () => void;
  setChatSidebarOpen: (open: boolean) => void;
}

export const useLayoutStore = create<ChatPanelState>()(
  persist(
    (set, get) => ({
      chatPanelOpen: true,
      chatPanelWidth: '50%',
      sessionSidebarOpen: true,
      inlineCanvasOpen: false,
      toggleChatPanel: () => set((state) => ({ chatPanelOpen: !state.chatPanelOpen })),
      setChatPanelOpen: (open: boolean) => set({ chatPanelOpen: open }),
      setChatPanelWidth: (width: '50%' | '100%') => set({ chatPanelWidth: width }),
      toggleSessionSidebar: () => set((state) => ({ sessionSidebarOpen: !state.sessionSidebarOpen })),
      openInlineCanvas: () => set({ inlineCanvasOpen: true }),
      closeInlineCanvas: () => set({ inlineCanvasOpen: false }),
      // Legacy compat - map to panel state
      get chatSidebarOpen() {
        return get().chatPanelOpen;
      },
      toggleChatSidebar: () => set((state) => ({ chatPanelOpen: !state.chatPanelOpen })),
      setChatSidebarOpen: (open: boolean) => set({ chatPanelOpen: open }),
    }),
    {
      name: 'luna-layout',
      partialize: (state) => ({
        chatPanelOpen: state.chatPanelOpen,
        chatPanelWidth: state.chatPanelWidth,
        sessionSidebarOpen: state.sessionSidebarOpen,
      }),
    }
  )
);

export default useLayoutStore;
