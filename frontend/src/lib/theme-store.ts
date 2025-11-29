import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsApi, type ThemeType } from './api';

interface ThemeState {
  theme: ThemeType;
  crtFlicker: boolean;
  isHydrated: boolean;
  setTheme: (theme: ThemeType) => void;
  setCrtFlicker: (enabled: boolean) => void;
  syncToBackend: () => Promise<void>;
  initializeFromSettings: (settings: Record<string, unknown>) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      crtFlicker: false,
      isHydrated: false,

      setTheme: (theme) => {
        set({ theme });
        // Apply theme to document immediately
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', theme);
        }
        // Sync to backend (fire and forget)
        get().syncToBackend();
      },

      setCrtFlicker: (enabled) => {
        set({ crtFlicker: enabled });
        // Sync to backend (fire and forget)
        get().syncToBackend();
      },

      syncToBackend: async () => {
        const { theme, crtFlicker } = get();
        try {
          await settingsApi.updateUserSettings({ theme, crtFlicker });
        } catch (error) {
          console.error('Failed to sync theme to backend:', error);
        }
      },

      initializeFromSettings: (settings) => {
        const theme = (settings.theme as ThemeType) || 'dark';
        const crtFlicker = (settings.crtFlicker as boolean) || false;
        set({ theme, crtFlicker, isHydrated: true });
        // Apply theme to document
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', theme);
        }
      },
    }),
    {
      name: 'luna-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isHydrated = true;
          // Apply theme on rehydration
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', state.theme);
          }
        }
      },
    }
  )
);

export type { ThemeType };
