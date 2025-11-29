'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Zap, Brain, MessageSquare, Database } from 'lucide-react';
import { settingsApi, type UserStats } from '@/lib/api';

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function StatCard({
  icon: Icon,
  title,
  value,
  subtext,
  color = 'luna',
}: {
  icon: typeof Zap;
  title: string;
  value: string | number;
  subtext?: string;
  color?: 'luna' | 'green' | 'blue' | 'purple';
}) {
  const colorClasses = {
    luna: 'bg-theme-accent-primary/10 text-theme-accent-primary',
    green: 'bg-green-500/10 text-green-400',
    blue: 'bg-blue-500/10 text-blue-400',
    purple: 'bg-purple-500/10 text-purple-400',
  };

  return (
    <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-theme-text-muted">{title}</p>
          <p className="text-2xl font-bold text-theme-text-primary">{value}</p>
          {subtext && <p className="text-xs text-theme-text-muted mt-0.5">{subtext}</p>}
        </div>
      </div>
    </div>
  );
}

export default function StatsTab() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await settingsApi.getStats();
      setStats(res.stats);
    } catch (err) {
      setError('Failed to load stats');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error || 'Failed to load stats'}</p>
        <button
          onClick={loadStats}
          className="px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-secondary rounded-lg transition text-theme-text-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-theme-text-primary">Usage Statistics</h3>
        <button
          onClick={loadStats}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded-lg transition"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Token Usage */}
      <div>
        <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-3">
          Token Usage
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Zap}
            title="Total Tokens"
            value={formatNumber(stats.tokens.total)}
            color="luna"
          />
          <StatCard
            icon={Zap}
            title="This Month"
            value={formatNumber(stats.tokens.thisMonth)}
            color="blue"
          />
          <StatCard
            icon={Zap}
            title="This Week"
            value={formatNumber(stats.tokens.thisWeek)}
            color="green"
          />
          <StatCard
            icon={Zap}
            title="Today"
            value={formatNumber(stats.tokens.today)}
            color="purple"
          />
        </div>

        {Object.keys(stats.tokens.byModel).length > 0 && (
          <div className="mt-4 p-4 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border">
            <h5 className="text-sm font-medium text-theme-text-muted mb-3">Tokens by Model</h5>
            <div className="space-y-2">
              {Object.entries(stats.tokens.byModel).map(([model, tokens]) => (
                <div key={model} className="flex items-center justify-between">
                  <span className="text-sm text-theme-text-secondary font-mono">{model}</span>
                  <span className="text-sm text-theme-text-primary font-medium">
                    {formatNumber(tokens)} tokens
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Memory Stats */}
      <div>
        <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-3">
          Memory & Knowledge
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Brain}
            title="Active Facts"
            value={stats.memory.activeFacts}
            subtext={`${stats.memory.totalFacts} total`}
            color="purple"
          />
          <StatCard
            icon={Database}
            title="Embeddings"
            value={formatNumber(stats.memory.totalEmbeddings)}
            color="blue"
          />
          <StatCard
            icon={MessageSquare}
            title="Summaries"
            value={stats.memory.totalSummaries}
            color="green"
          />
          <StatCard
            icon={MessageSquare}
            title="Total Messages"
            value={formatNumber(stats.sessions.totalMessages)}
            color="luna"
          />
        </div>

        {Object.keys(stats.memory.factsByCategory).length > 0 && (
          <div className="mt-4 p-4 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border">
            <h5 className="text-sm font-medium text-theme-text-muted mb-3">Facts by Category</h5>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.memory.factsByCategory).map(([category, count]) => (
                <span
                  key={category}
                  className="px-3 py-1 bg-theme-bg-tertiary rounded-full text-sm"
                >
                  <span className="text-theme-text-muted">{category}:</span>{' '}
                  <span className="text-theme-text-primary font-medium">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Session Stats */}
      <div>
        <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-3">
          Conversations
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            icon={MessageSquare}
            title="Total Sessions"
            value={stats.sessions.total}
            color="luna"
          />
          <StatCard
            icon={MessageSquare}
            title="Archived"
            value={stats.sessions.archived}
            color="green"
          />
          <StatCard
            icon={MessageSquare}
            title="Avg Messages/Session"
            value={
              stats.sessions.total > 0
                ? Math.round(stats.sessions.totalMessages / stats.sessions.total)
                : 0
            }
            color="blue"
          />
        </div>
      </div>
    </div>
  );
}
