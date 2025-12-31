'use client';

import {
  LayoutDashboard,
  MessageSquare,
  TrendingUp,
  Settings,
  type LucideIcon
} from 'lucide-react';
import clsx from 'clsx';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'trading', label: 'Trading', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[var(--terminal-surface)] border-t border-[var(--terminal-border)] z-50">
      <div
        className="flex items-stretch justify-around"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={clsx(
                'flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors min-h-[64px]',
                isActive
                  ? 'text-[var(--terminal-accent)]'
                  : 'text-[var(--terminal-text-muted)]'
              )}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium uppercase tracking-wider">
                {item.label}
              </span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[var(--terminal-accent)] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
