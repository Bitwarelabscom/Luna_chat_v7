'use client';

import { useEffect } from 'react';
import { useThemeStore } from '@/lib/theme-store';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, crtFlicker, isHydrated } = useThemeStore();

  useEffect(() => {
    // Apply theme on mount and changes
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Prevent flash of wrong theme
  if (!isHydrated) {
    return null;
  }

  return (
    <>
      {/* CRT effects overlay - only visible for retro theme */}
      {theme === 'retro' && (
        <div
          className={`crt-overlay ${crtFlicker ? 'crt-flicker-active' : ''}`}
          aria-hidden="true"
        />
      )}
      {children}
    </>
  );
}
