'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/lib/store';
import { BottomNav } from '@/components/BottomNav';
import { OverviewView } from '@/components/OverviewView';
import { ChatView } from '@/components/ChatView';
import { TradingView } from '@/components/TradingView';
import { SettingsView } from '@/components/SettingsView';

type Tab = 'overview' | 'chat' | 'trading' | 'settings';

export default function DashboardPage() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useEffect(() => {
    // checkAuth will auto-login if not authenticated
    checkAuth();
  }, [checkAuth]);

  // Show loading while authenticating (includes auto-login attempt)
  if (isLoading || !isAuthenticated) {
    return (
      <div className="h-dvh flex items-center justify-center bg-[var(--terminal-bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-[var(--terminal-accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[var(--terminal-text-muted)] text-sm">Connecting...</span>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewView />;
      case 'chat':
        return <ChatView />;
      case 'trading':
        return <TradingView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  const getTitle = () => {
    switch (activeTab) {
      case 'overview':
        return 'Overview';
      case 'chat':
        return 'Luna Chat';
      case 'trading':
        return 'Trading';
      case 'settings':
        return 'Settings';
      default:
        return 'Luna';
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-[var(--terminal-bg)]">
      {/* Header - not shown for chat (has its own) */}
      {activeTab !== 'chat' && (
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--terminal-accent)] flex items-center justify-center">
              <span className="text-black font-bold text-sm">L</span>
            </div>
            <h1 className="text-lg font-semibold text-[var(--terminal-text)]">
              {getTitle()}
            </h1>
          </div>
        </header>
      )}

      {/* Content */}
      <main
        className={`flex-1 overflow-y-auto ${activeTab !== 'chat' ? 'p-4' : ''}`}
        style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' }}
      >
        {renderContent()}
      </main>

      {/* Bottom Navigation */}
      <BottomNav activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab as Tab)} />
    </div>
  );
}
