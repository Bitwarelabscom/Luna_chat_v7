'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Search,
  ArrowRight,
  Command,
  Clock,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type AppId, appConfig, dockApps } from './app-registry';

interface SpotlightProps {
  isOpen: boolean;
  onClose: () => void;
  onAppOpen: (appId: AppId) => void;
  onCommand: (command: string) => void;
}

const shortcuts: Record<string, string> = {
  chat: 'Cmd 1',
  voice: 'Cmd 2',
  files: 'Cmd 3',
  terminal: 'Cmd 4',
  browser: 'Cmd 5',
};

const quickActions = [
  { name: 'New Chat', icon: appConfig.chat.icon, color: 'from-cyan-500 to-blue-500', action: 'new-chat' },
  { name: 'Run Code', icon: appConfig.terminal.icon, color: 'from-gray-500 to-gray-700', action: 'run-code' },
  { name: 'Browse Web', icon: appConfig.browser.icon, color: 'from-green-500 to-emerald-500', action: 'browse' },
  { name: 'Ask Luna', icon: Zap, color: 'from-yellow-500 to-orange-500', action: 'ask-luna' },
];

const recentActions = [
  { name: 'Chat session: Project Planning', time: '2 hours ago', appId: 'chat' as AppId },
  { name: 'Document: Meeting Notes', time: 'Yesterday', appId: 'editor' as AppId },
  { name: 'Email: Weekly Report', time: '2 days ago', appId: 'email' as AppId },
];

export function Spotlight({ isOpen, onClose, onAppOpen, onCommand }: SpotlightProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build suggestions list
  const appSuggestions = dockApps.map((appId) => ({
    type: 'app' as const,
    id: appId,
    name: appConfig[appId].title,
    icon: appConfig[appId].icon,
    shortcut: shortcuts[appId],
  }));

  const commandSuggestions = [
    { type: 'command' as const, id: 'new-chat', name: 'New AI Chat', icon: Zap, shortcut: undefined as string | undefined },
    { type: 'command' as const, id: 'search-files', name: 'Search Files...', icon: Search, shortcut: undefined as string | undefined },
    { type: 'command' as const, id: 'settings', name: 'System Settings', icon: appConfig.settings.icon, shortcut: undefined as string | undefined },
  ];

  const allSuggestions = [...appSuggestions, ...commandSuggestions];

  const filteredSuggestions = query
    ? allSuggestions.filter((s) =>
        s.name.toLowerCase().includes(query.toLowerCase())
      )
    : allSuggestions;

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredSuggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const selected = filteredSuggestions[selectedIndex];
        if (selected) {
          if (selected.type === 'app') {
            onAppOpen(selected.id as AppId);
          } else {
            onCommand(selected.id);
          }
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, filteredSuggestions, selectedIndex, onAppOpen, onCommand]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Spotlight Window */}
      <div
        className="relative w-full max-w-2xl mx-4 backdrop-blur-2xl border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: 'var(--theme-bg-secondary)',
          borderColor: 'var(--theme-border)',
        }}
      >
        {/* Search Input */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <Search className="w-5 h-5" style={{ color: 'var(--theme-text-secondary)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search apps, commands, or ask Luna..."
            className="flex-1 bg-transparent text-lg focus:outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
          />
          <kbd
            className="px-2 py-1 rounded text-xs"
            style={{
              background: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {/* Quick Actions */}
          {!query && (
            <div className="p-3 border-b" style={{ borderColor: 'var(--theme-border)' }}>
              <p
                className="px-2 text-[11px] font-medium uppercase tracking-wider mb-2"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                Quick Actions
              </p>
              <div className="grid grid-cols-4 gap-2">
                {quickActions.map((action) => (
                  <button
                    key={action.name}
                    onClick={() => {
                      onCommand(action.action);
                      onClose();
                    }}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl transition-colors group"
                    style={{ background: 'var(--theme-bg-tertiary)' }}
                  >
                    <div className={cn('w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center', action.color)}>
                      <action.icon className="w-5 h-5 text-white" />
                    </div>
                    <span
                      className="text-xs group-hover:text-white transition-colors"
                      style={{ color: 'var(--theme-text-secondary)' }}
                    >
                      {action.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          <div className="p-2">
            <p
              className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {query ? 'Results' : 'Applications'}
            </p>
            {filteredSuggestions.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.type === 'app') {
                      onAppOpen(item.id as AppId);
                    } else {
                      onCommand(item.id);
                    }
                    onClose();
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                    selectedIndex === index
                      ? 'bg-[var(--theme-accent-primary)]/20'
                      : 'hover:bg-white/5'
                  )}
                  style={{
                    color: selectedIndex === index ? 'var(--theme-text-primary)' : 'var(--theme-text-primary)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--theme-bg-tertiary)' }}
                  >
                    <Icon
                      className={cn('w-4 h-4', selectedIndex === index && 'text-[var(--theme-accent-primary)]')}
                      style={{ color: selectedIndex !== index ? 'var(--theme-text-secondary)' : undefined }}
                    />
                  </div>
                  <span className="flex-1 text-left text-sm">{item.name}</span>
                  {item.shortcut && (
                    <kbd
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{
                        background: 'var(--theme-bg-tertiary)',
                        color: 'var(--theme-text-secondary)',
                      }}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                  <ArrowRight
                    className={cn(
                      'w-4 h-4 transition-opacity',
                      selectedIndex === index ? 'opacity-100' : 'opacity-0'
                    )}
                    style={{ color: 'var(--theme-accent-primary)' }}
                  />
                </button>
              );
            })}
          </div>

          {/* Recent */}
          {!query && (
            <div className="p-2 border-t" style={{ borderColor: 'var(--theme-border)' }}>
              <p
                className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider flex items-center gap-2"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <Clock className="w-3 h-3" />
                Recent
              </p>
              {recentActions.map((action, index) => {
                const Icon = appConfig[action.appId].icon;
                return (
                  <button
                    key={index}
                    onClick={() => {
                      onAppOpen(action.appId);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <Icon className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
                    <span className="flex-1 text-left text-sm" style={{ color: 'var(--theme-text-primary)' }}>
                      {action.name}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                      {action.time}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2 border-t flex items-center justify-between text-[11px]"
          style={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text-secondary)',
          }}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Command className="w-3 h-3" />
              <span>Space to open</span>
            </span>
            <span>Up/Down Navigate</span>
            <span>Enter Select</span>
          </div>
          <span>LunaOS v1.0</span>
        </div>
      </div>
    </div>
  );
}

export default Spotlight;
