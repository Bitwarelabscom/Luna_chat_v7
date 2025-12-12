'use client';

import { useState } from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type AppId, appConfig, dockApps } from './app-registry';

interface DockProps {
  activeApps: AppId[];
  onAppClick: (appId: AppId) => void;
  focusedApp: AppId | null;
}

export function Dock({ activeApps, onAppClick, focusedApp }: DockProps) {
  const [hoveredApp, setHoveredApp] = useState<AppId | null>(null);

  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-40">
      <div
        className="flex flex-col items-center gap-1 py-3 px-2 backdrop-blur-2xl border rounded-2xl shadow-2xl"
        style={{
          background: 'rgba(255, 255, 255, 0.1)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
        }}
      >
        {dockApps.map((appId, index) => {
          const app = appConfig[appId];
          const Icon = app.icon;
          const isActive = activeApps.includes(appId);
          const isFocused = focusedApp === appId;
          const isHovered = hoveredApp === appId;

          return (
            <div key={appId} className="relative group">
              {/* Tooltip */}
              <div
                className={cn(
                  'absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 backdrop-blur border rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200',
                  isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'
                )}
                style={{
                  background: 'var(--theme-bg-secondary)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                }}
              >
                {app.title}
              </div>

              {/* App Icon */}
              <button
                onClick={() => onAppClick(appId)}
                onMouseEnter={() => setHoveredApp(appId)}
                onMouseLeave={() => setHoveredApp(null)}
                className={cn(
                  'relative w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 ease-out',
                  'bg-gradient-to-br shadow-lg',
                  app.color,
                  isHovered && 'scale-125 -translate-x-3',
                  isFocused && !isHovered && 'scale-110 -translate-x-1',
                  'hover:shadow-xl'
                )}
                style={{
                  transitionDelay: isHovered ? '0ms' : `${index * 20}ms`,
                }}
              >
                <Icon className="w-6 h-6 text-white drop-shadow-md" />
              </button>

              {/* Active Indicator */}
              {isActive && (
                <div
                  className={cn(
                    'absolute -left-1 top-1/2 -translate-y-1/2 rounded-full transition-all',
                    isFocused ? 'bg-white h-2 w-1' : 'bg-white/60 h-1 w-1'
                  )}
                />
              )}
            </div>
          );
        })}

        {/* Separator */}
        <div className="h-px w-10 bg-white/20 my-2" />

        {/* Trash / Downloads */}
        <button
          className="w-12 h-12 rounded-xl flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
        >
          <Folder className="w-6 h-6 text-white/40" />
        </button>
      </div>
    </div>
  );
}

export default Dock;
