'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Zap, Brain, MessageSquare, Database, DollarSign } from 'lucide-react';
import { settingsApi, type EnhancedStats, type ModelPeriodStats } from '@/lib/api';

type TimePeriod = 'today' | 'thisWeek' | 'thisMonth' | 'total';

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(2);
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
  color?: 'luna' | 'green' | 'blue' | 'purple' | 'orange';
}) {
  const colorClasses = {
    luna: 'bg-theme-accent-primary/10 text-theme-accent-primary',
    green: 'bg-green-500/10 text-green-400',
    blue: 'bg-blue-500/10 text-blue-400',
    purple: 'bg-purple-500/10 text-purple-400',
    orange: 'bg-orange-500/10 text-orange-400',
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

function PeriodSelector({
  selected,
  onChange,
}: {
  selected: TimePeriod;
  onChange: (period: TimePeriod) => void;
}) {
  const periods: { id: TimePeriod; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'thisWeek', label: 'This Week' },
    { id: 'thisMonth', label: 'This Month' },
    { id: 'total', label: 'All Time' },
  ];

  return (
    <div className="flex gap-1 bg-theme-bg-tertiary/50 p-1 rounded-lg">
      {periods.map((period) => (
        <button
          key={period.id}
          onClick={() => onChange(period.id)}
          className={`px-3 py-1.5 text-sm rounded-md transition ${
            selected === period.id
              ? 'bg-theme-accent-primary text-theme-bg-primary font-medium'
              : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function TokenBreakdown({ stats, period }: { stats: ModelPeriodStats; period: string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <StatCard
        icon={Zap}
        title="Input Tokens"
        value={formatNumber(stats.inputTokens)}
        color="blue"
      />
      <StatCard
        icon={Zap}
        title="Output Tokens"
        value={formatNumber(stats.outputTokens)}
        color="orange"
      />
      <StatCard
        icon={Zap}
        title="Cache Tokens"
        value={formatNumber(stats.cacheTokens)}
        color="green"
      />
      <StatCard
        icon={Zap}
        title="Total Tokens"
        value={formatNumber(stats.totalTokens)}
        color="luna"
      />
      <StatCard
        icon={DollarSign}
        title="Estimated Cost"
        value={formatCost(stats.cost)}
        subtext={period}
        color="purple"
      />
    </div>
  );
}

export default function StatsTab() {
  const [stats, setStats] = useState<EnhancedStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<TimePeriod>('today');

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await settingsApi.getEnhancedStats();
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

  const periodStats = stats.tokens[period];
  const periodLabel = {
    today: 'Today',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    total: 'All Time',
  }[period];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h3 className="text-lg font-medium text-theme-text-primary">Usage Statistics</h3>
        <div className="flex items-center gap-4">
          <PeriodSelector selected={period} onChange={setPeriod} />
          <button
            onClick={loadStats}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Token Usage Summary */}
      <div>
        <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-3">
          Token Usage - {periodLabel}
        </h4>
        <TokenBreakdown stats={periodStats} period={periodLabel} />
      </div>

      {/* Tokens by Model */}
      {Object.keys(stats.byModel).length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-3">
            Usage by Model - {periodLabel}
          </h4>
          <div className="bg-theme-bg-tertiary/50 rounded-lg border border-theme-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-border">
                  <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-muted">Model</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-muted">Input</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-muted">Output</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-muted">Cache</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-muted">Total</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-muted">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.byModel)
                  .filter(([, modelStats]) => modelStats[period].totalTokens > 0)
                  .sort((a, b) => b[1][period].totalTokens - a[1][period].totalTokens)
                  .map(([model, modelStats]) => {
                    const s = modelStats[period];
                    return (
                      <tr key={model} className="border-b border-theme-border/50 last:border-0">
                        <td className="px-4 py-3 text-sm font-mono text-theme-text-secondary">{model}</td>
                        <td className="px-4 py-3 text-sm text-right text-blue-400">{formatNumber(s.inputTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right text-orange-400">{formatNumber(s.outputTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right text-green-400">{formatNumber(s.cacheTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right text-theme-text-primary font-medium">{formatNumber(s.totalTokens)}</td>
                        <td className="px-4 py-3 text-sm text-right text-purple-400">{formatCost(s.cost)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {Object.values(stats.byModel).every((m) => m[period].totalTokens === 0) && (
              <div className="px-4 py-6 text-center text-theme-text-muted">
                No token usage for this period
              </div>
            )}
          </div>
        </div>
      )}

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
