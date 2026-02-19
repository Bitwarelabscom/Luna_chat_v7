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

  // Show dock-enabled apps in configured order
  const visibleApps = dockApps.filter((id) => appConfig[id].showInDock !== false);

  return (
    <div className="flex-shrink-0 flex items-center z-40 py-2 pr-2">
      <div
        className="flex flex-col items-center gap-1 py-3 px-2 backdrop-blur-2xl border rounded-2xl shadow-2xl max-h-full overflow-y-auto"
        style={{
          background: 'rgba(255, 255, 255, 0.1)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
        }}
      >
        {visibleApps.map((appId) => {
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
                  'relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ease-out',
                  'bg-gradient-to-br shadow-lg',
                  app.color,
                  isHovered && 'scale-125 -translate-x-3',
                  isFocused && !isHovered && 'scale-110 -translate-x-1',
                  'hover:shadow-xl'
                )}
              >
                <Icon className="w-5 h-5 text-white drop-shadow-md" />
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
        <div className="h-px w-9 bg-white/20 my-1" />

        {/* Trash / Downloads */}
        <button
          className="w-11 h-11 rounded-xl flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
        >
          <Folder className="w-5 h-5 text-white/40" />
        </button>
      </div>
    </div>
  );
}

export default Dock;
