'use client';

import { create } from 'zustand';
import { type AppId, appConfig } from '@/components/os/app-registry';

export interface VideoResult {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  duration: string;
  isLive: boolean;
}

export interface PendingVideoData {
  videos: VideoResult[];
  query: string;
}

export interface EditorFileContext {
  sourceType: 'workspace' | 'project';
  sourceId: string;
  documentId: string;
  documentName: string;
  initialContent?: string;
}

export interface WindowState {
  id: string;
  appId: AppId;
  isMinimized: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

interface WindowStore {
  windows: WindowState[];
  focusedWindow: string | null;
  maxZIndex: number;
  // Pending URL for browser window to navigate to on open
  pendingBrowserUrl: string | null;
  // Pending context for editor to open a file
  pendingEditorContext: EditorFileContext | null;
  // Pending video results for videos window
  pendingVideoResults: PendingVideoData | null;

  // Actions
  openApp: (appId: AppId) => void;
  closeApp: (windowId: string) => void;
  minimizeApp: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  updateWindowPosition: (windowId: string, position: { x: number; y: number }) => void;
  updateWindowSize: (windowId: string, size: { width: number; height: number }) => void;
  // Browser URL actions
  setPendingBrowserUrl: (url: string | null) => void;
  consumePendingBrowserUrl: () => string | null;
  // Editor context actions
  setPendingEditorContext: (context: EditorFileContext | null) => void;
  consumePendingEditorContext: () => EditorFileContext | null;
  // Video results actions
  setPendingVideoResults: (data: PendingVideoData | null) => void;
  consumePendingVideoResults: () => PendingVideoData | null;
}

let windowIdCounter = 0;

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  focusedWindow: null,
  maxZIndex: 1,
  pendingBrowserUrl: null,
  pendingEditorContext: null,
  pendingVideoResults: null,

  openApp: (appId: AppId) => {
    const { windows, maxZIndex } = get();
    const config = appConfig[appId];

    // Check if app is already open
    const existingWindow = windows.find((w) => w.appId === appId);

    if (existingWindow) {
      // If minimized, restore it
      if (existingWindow.isMinimized) {
        set({
          windows: windows.map((w) =>
            w.id === existingWindow.id
              ? { ...w, isMinimized: false, zIndex: maxZIndex + 1 }
              : w
          ),
          focusedWindow: existingWindow.id,
          maxZIndex: maxZIndex + 1,
        });
      } else {
        // Just focus it
        set({
          windows: windows.map((w) =>
            w.id === existingWindow.id
              ? { ...w, zIndex: maxZIndex + 1 }
              : w
          ),
          focusedWindow: existingWindow.id,
          maxZIndex: maxZIndex + 1,
        });
      }
    } else {
      // Create new window
      const offset = windows.length * 30;
      const newWindow: WindowState = {
        id: `window-${++windowIdCounter}`,
        appId,
        isMinimized: false,
        position: { x: 100 + offset, y: 50 + offset },
        size: config.defaultSize,
        zIndex: maxZIndex + 1,
      };

      set({
        windows: [...windows, newWindow],
        focusedWindow: newWindow.id,
        maxZIndex: maxZIndex + 1,
      });
    }
  },

  closeApp: (windowId: string) => {
    const { windows, focusedWindow } = get();
    const newWindows = windows.filter((w) => w.id !== windowId);

    let newFocused = focusedWindow;
    if (focusedWindow === windowId) {
      // Focus the next available window
      const remaining = newWindows.filter((w) => !w.isMinimized);
      newFocused = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }

    set({
      windows: newWindows,
      focusedWindow: newFocused,
    });
  },

  minimizeApp: (windowId: string) => {
    const { windows, focusedWindow } = get();

    set({
      windows: windows.map((w) =>
        w.id === windowId ? { ...w, isMinimized: true } : w
      ),
    });

    // If we minimized the focused window, focus the next one
    if (focusedWindow === windowId) {
      const remaining = windows.filter((w) => w.id !== windowId && !w.isMinimized);
      set({
        focusedWindow: remaining.length > 0 ? remaining[remaining.length - 1].id : null,
      });
    }
  },

  focusWindow: (windowId: string) => {
    const { windows, maxZIndex } = get();

    set({
      windows: windows.map((w) =>
        w.id === windowId ? { ...w, zIndex: maxZIndex + 1 } : w
      ),
      focusedWindow: windowId,
      maxZIndex: maxZIndex + 1,
    });
  },

  updateWindowPosition: (windowId: string, position: { x: number; y: number }) => {
    const { windows } = get();
    set({
      windows: windows.map((w) =>
        w.id === windowId ? { ...w, position } : w
      ),
    });
  },

  updateWindowSize: (windowId: string, size: { width: number; height: number }) => {
    const { windows } = get();
    set({
      windows: windows.map((w) =>
        w.id === windowId ? { ...w, size } : w
      ),
    });
  },

  setPendingBrowserUrl: (url: string | null) => {
    set({ pendingBrowserUrl: url });
  },

  consumePendingBrowserUrl: () => {
    const { pendingBrowserUrl } = get();
    if (pendingBrowserUrl) {
      set({ pendingBrowserUrl: null });
    }
    return pendingBrowserUrl;
  },

  setPendingEditorContext: (context: EditorFileContext | null) => {
    set({ pendingEditorContext: context });
  },

  consumePendingEditorContext: () => {
    const { pendingEditorContext } = get();
    if (pendingEditorContext) {
      set({ pendingEditorContext: null });
    }
    return pendingEditorContext;
  },

  setPendingVideoResults: (data: PendingVideoData | null) => {
    set({ pendingVideoResults: data });
  },

  consumePendingVideoResults: () => {
    const { pendingVideoResults } = get();
    if (pendingVideoResults) {
      set({ pendingVideoResults: null });
    }
    return pendingVideoResults;
  },
}));

export default useWindowStore;
