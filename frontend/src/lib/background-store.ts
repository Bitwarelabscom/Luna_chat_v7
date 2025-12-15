import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Background {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  backgroundType: 'generated' | 'uploaded' | 'preset';
  style: string | null;
  prompt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface BackgroundState {
  // State
  activeBackground: Background | null;
  backgrounds: Background[];
  isGenerating: boolean;
  isUploading: boolean;
  isHydrated: boolean;

  // Actions
  setActiveBackground: (background: Background | null) => void;
  setBackgrounds: (backgrounds: Background[]) => void;
  addBackground: (background: Background) => void;
  removeBackground: (id: string) => void;
  setIsGenerating: (generating: boolean) => void;
  setIsUploading: (uploading: boolean) => void;
  initializeFromApi: (activeBackground: Background | null, backgrounds: Background[]) => void;
}

export const useBackgroundStore = create<BackgroundState>()(
  persist(
    (set) => ({
      activeBackground: null,
      backgrounds: [],
      isGenerating: false,
      isUploading: false,
      isHydrated: false,

      setActiveBackground: (background) => {
        set((state) => ({
          activeBackground: background,
          // Update isActive in backgrounds list
          backgrounds: state.backgrounds.map((bg) => ({
            ...bg,
            isActive: background ? bg.id === background.id : false,
          })),
        }));
      },

      setBackgrounds: (backgrounds) => {
        set({ backgrounds });
      },

      addBackground: (background) => {
        set((state) => ({
          backgrounds: [background, ...state.backgrounds],
          // If the new background is active, set it
          activeBackground: background.isActive ? background : state.activeBackground,
        }));
      },

      removeBackground: (id) => {
        set((state) => ({
          backgrounds: state.backgrounds.filter((bg) => bg.id !== id),
          // Clear active if the deleted one was active
          activeBackground: state.activeBackground?.id === id ? null : state.activeBackground,
        }));
      },

      setIsGenerating: (generating) => {
        set({ isGenerating: generating });
      },

      setIsUploading: (uploading) => {
        set({ isUploading: uploading });
      },

      initializeFromApi: (activeBackground, backgrounds) => {
        set({
          activeBackground,
          backgrounds,
          isHydrated: true,
        });
      },
    }),
    {
      name: 'luna-background',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isHydrated = true;
        }
      },
    }
  )
);
