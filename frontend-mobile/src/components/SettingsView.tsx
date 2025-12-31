'use client';

import { useState, useEffect } from 'react';
import { LogOut, User, Bell, Shield, ChevronRight, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { tradingApi, type TradingSettings, type TradingStats } from '@/lib/api';

interface SettingRowProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
}

function SettingRow({ icon, label, value, onClick, danger }: SettingRowProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-4 hover:bg-[var(--terminal-surface-hover)] transition-colors ${
        danger ? 'text-[var(--terminal-negative)]' : ''
      }`}
      disabled={!onClick}
    >
      <div className="flex items-center gap-3">
        <span className={danger ? 'text-[var(--terminal-negative)]' : 'text-[var(--terminal-text-muted)]'}>
          {icon}
        </span>
        <span className={danger ? '' : 'text-[var(--terminal-text)]'}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {value && <span className="text-[var(--terminal-text-muted)] text-sm">{value}</span>}
        {onClick && <ChevronRight size={16} className="text-[var(--terminal-text-dim)]" />}
      </div>
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
}

function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <div className="bg-[var(--terminal-surface)] rounded-lg p-3">
      <div className="text-xs text-[var(--terminal-text-muted)] uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--terminal-text)]">{value}</div>
      {subValue && (
        <div className="text-xs text-[var(--terminal-text-dim)] mt-0.5">{subValue}</div>
      )}
    </div>
  );
}

export function SettingsView() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [tradingSettings, setTradingSettings] = useState<TradingSettings | null>(null);
  const [tradingStats, setTradingStats] = useState<TradingStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const [settings, stats] = await Promise.all([
          tradingApi.getSettings().catch(() => null),
          tradingApi.getStats(30).catch(() => null),
        ]);
        setTradingSettings(settings);
        setTradingStats(stats);
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const handleTogglePaperMode = async () => {
    if (!tradingSettings) return;
    try {
      const updated = await tradingApi.updateSettings({
        paperMode: !tradingSettings.paperMode
      });
      setTradingSettings(updated);
    } catch (error) {
      console.error('Failed to toggle paper mode:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* User Profile */}
      <div className="card overflow-hidden">
        <div className="p-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[var(--terminal-accent)] flex items-center justify-center">
            <span className="text-black text-xl font-bold">
              {user?.displayName?.[0] || user?.email?.[0] || 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[var(--terminal-text)] truncate">
              {user?.displayName || 'User'}
            </div>
            <div className="text-sm text-[var(--terminal-text-muted)] truncate">
              {user?.email}
            </div>
          </div>
        </div>
      </div>

      {/* Trading Stats */}
      {tradingStats && (
        <div>
          <h3 className="text-xs font-semibold text-[var(--terminal-text-muted)] uppercase tracking-wider mb-3 px-1">
            Trading Stats (30d)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Total Trades"
              value={tradingStats.totalTrades}
            />
            <StatCard
              label="Win Rate"
              value={`${tradingStats.winRate.toFixed(1)}%`}
            />
            <StatCard
              label="Total P&L"
              value={`$${tradingStats.totalPnl.toFixed(2)}`}
            />
            <StatCard
              label="Avg Win"
              value={`$${tradingStats.avgWin.toFixed(2)}`}
            />
          </div>
        </div>
      )}

      {/* Trading Settings */}
      <div>
        <h3 className="text-xs font-semibold text-[var(--terminal-text-muted)] uppercase tracking-wider mb-3 px-1">
          Trading
        </h3>
        <div className="card divide-y divide-[var(--terminal-border)]">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[var(--terminal-text-muted)]">
                <RefreshCw size={20} />
              </span>
              <div>
                <div className="text-[var(--terminal-text)]">Paper Trading</div>
                <div className="text-xs text-[var(--terminal-text-muted)]">
                  Simulated trading without real money
                </div>
              </div>
            </div>
            <button
              onClick={handleTogglePaperMode}
              disabled={isLoading || !tradingSettings}
              className={`w-12 h-7 rounded-full transition-colors relative ${
                tradingSettings?.paperMode
                  ? 'bg-[var(--terminal-warning)]'
                  : 'bg-[var(--terminal-surface-hover)]'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${
                tradingSettings?.paperMode ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <SettingRow
            icon={<Shield size={20} />}
            label="Exchange"
            value={tradingSettings?.exchangeConnected
              ? tradingSettings.activeExchange?.toUpperCase() || 'Connected'
              : 'Not Connected'}
          />
        </div>
      </div>

      {/* Account */}
      <div>
        <h3 className="text-xs font-semibold text-[var(--terminal-text-muted)] uppercase tracking-wider mb-3 px-1">
          Account
        </h3>
        <div className="card divide-y divide-[var(--terminal-border)]">
          <SettingRow
            icon={<User size={20} />}
            label="Profile"
            value={user?.displayName || 'Set name'}
          />
          <SettingRow
            icon={<Bell size={20} />}
            label="Notifications"
            value="Enabled"
          />
          <SettingRow
            icon={<LogOut size={20} />}
            label="Sign Out"
            onClick={handleLogout}
            danger
          />
        </div>
      </div>

      {/* Version Info */}
      <div className="text-center py-4">
        <p className="text-xs text-[var(--terminal-text-dim)]">
          Luna Mobile v1.0.0
        </p>
        <p className="text-xs text-[var(--terminal-text-dim)] mt-1">
          Local Network Only - 10.0.0.x
        </p>
      </div>
    </div>
  );
}
