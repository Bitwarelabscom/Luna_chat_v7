import { create } from 'zustand';
import { api } from './api';

export interface ArtifactContent {
  id: string;
  index: number;
  type: 'code' | 'text';
  title: string;
  language?: string;
  content: string;
  createdAt: Date;
}

export interface Artifact {
  id: string;
  userId: string;
  sessionId: string | null;
  currentIndex: number;
  contents: ArtifactContent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface QuickAction {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  includeReflections: boolean;
  includePrefix: boolean;
  includeRecentHistory: boolean;
  createdAt: Date;
}

export interface Reflection {
  id: string;
  userId: string;
  type: 'style_rule' | 'content';
  value: string;
  createdAt: Date;
}

export interface TextHighlight {
  startIndex: number;
  endIndex: number;
  selectedText: string;
}

interface CanvasState {
  // Current artifact being edited
  artifact: Artifact | null;

  // Selected text for contextual editing
  selectedBlocks: TextHighlight | null;

  // Streaming state
  isStreaming: boolean;

  // User's quick actions
  quickActions: QuickAction[];

  // User's reflections (style rules)
  reflections: Reflection[];

  // Actions
  setArtifact: (artifact: Artifact | null) => void;
  setSelectedArtifact: (index: number) => void;
  addArtifactVersion: (content: ArtifactContent) => void;
  setSelectedBlocks: (blocks: TextHighlight | null) => void;
  setIsStreaming: (streaming: boolean) => void;
  loadQuickActions: () => Promise<void>;
  loadReflections: () => Promise<void>;
  createQuickAction: (
    title: string,
    prompt: string,
    options?: {
      includeReflections?: boolean;
      includePrefix?: boolean;
      includeRecentHistory?: boolean;
    }
  ) => Promise<void>;
  deleteQuickAction: (actionId: string) => Promise<void>;
  addReflection: (type: 'style_rule' | 'content', value: string) => Promise<void>;
  navigateToVersion: (index: number) => Promise<void>;
  loadArtifact: (artifactId: string) => Promise<void>;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  artifact: null,
  selectedBlocks: null,
  isStreaming: false,
  quickActions: [],
  reflections: [],

  setArtifact: (artifact) => set({ artifact }),

  setSelectedArtifact: (index) => {
    const { artifact } = get();
    if (artifact) {
      set({
        artifact: {
          ...artifact,
          currentIndex: index,
        },
      });
    }
  },

  addArtifactVersion: (content) => {
    const { artifact } = get();
    if (artifact) {
      set({
        artifact: {
          ...artifact,
          contents: [...artifact.contents, content],
          currentIndex: content.index,
          updatedAt: new Date(),
        },
      });
    }
  },

  setSelectedBlocks: (blocks) => set({ selectedBlocks: blocks }),

  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  loadQuickActions: async () => {
    try {
      const response = await api<QuickAction[]>('/api/canvas/quick-actions');
      set({ quickActions: response });
    } catch (error) {
      console.error('Failed to load quick actions:', error);
    }
  },

  loadReflections: async () => {
    try {
      const response = await api<Reflection[]>('/api/canvas/reflections');
      set({ reflections: response });
    } catch (error) {
      console.error('Failed to load reflections:', error);
    }
  },

  createQuickAction: async (title, prompt, options = {}) => {
    try {
      const newAction = await api<QuickAction>('/api/canvas/quick-actions', {
        method: 'POST',
        body: JSON.stringify({
          title,
          prompt,
          includeReflections: options.includeReflections ?? false,
          includePrefix: options.includePrefix ?? true,
          includeRecentHistory: options.includeRecentHistory ?? true,
        }),
      });

      set((state) => ({
        quickActions: [...state.quickActions, newAction],
      }));
    } catch (error) {
      console.error('Failed to create quick action:', error);
      throw error;
    }
  },

  deleteQuickAction: async (actionId) => {
    try {
      await api(`/api/canvas/quick-actions/${actionId}`, {
        method: 'DELETE',
      });

      set((state) => ({
        quickActions: state.quickActions.filter((a) => a.id !== actionId),
      }));
    } catch (error) {
      console.error('Failed to delete quick action:', error);
      throw error;
    }
  },

  addReflection: async (type, value) => {
    try {
      const newReflection = await api<Reflection>('/api/canvas/reflections', {
        method: 'POST',
        body: JSON.stringify({ type, value }),
      });

      set((state) => ({
        reflections: [...state.reflections, newReflection],
      }));
    } catch (error) {
      console.error('Failed to add reflection:', error);
      throw error;
    }
  },

  navigateToVersion: async (index) => {
    const { artifact } = get();
    if (!artifact) return;

    try {
      const response = await api<{ content: ArtifactContent }>(
        `/api/canvas/artifacts/${artifact.id}/navigate`,
        {
          method: 'POST',
          body: JSON.stringify({ index }),
        }
      );

      set({
        artifact: {
          ...artifact,
          currentIndex: index,
        },
      });
    } catch (error) {
      console.error('Failed to navigate to version:', error);
      throw error;
    }
  },

  loadArtifact: async (artifactId) => {
    try {
      const artifact = await api<Artifact>(`/api/canvas/artifacts/${artifactId}`);
      set({ artifact });
    } catch (error) {
      console.error('Failed to load artifact:', error);
      throw error;
    }
  },
}));
