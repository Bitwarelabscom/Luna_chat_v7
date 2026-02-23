'use client';

import { useEffect } from 'react';
import { RefreshCw, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

function formatMoney(usd: number): string {
  const abs = Math.abs(usd);
  const sign = usd < 0 ? '-' : '+';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function severityColor(s: string) {
  if (s === 'P1') return 'bg-red-900/40 text-red-400 border border-red-700';
  if (s === 'P2') return 'bg-amber-900/40 text-amber-400 border border-amber-700';
  return 'bg-gray-700/40 text-gray-400 border border-gray-600';
}

const PERIODS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

export function DashboardPanel() {
  const { dashboard, isLoadingDashboard, dashboardPeriod, loadDashboard, setDashboardPeriod } = useCEOLunaStore();

  useEffect(() => {
    if (!dashboard) loadDashboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePeriod = (days: number) => {
    setDashboardPeriod(days);
    loadDashboard(days);
  };

  if (isLoadingDashboard && !dashboard) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950">
        <Loader2 size={24} className="text-gray-500 animate-spin" />
      </div>
    );
  }

  const fin = dashboard?.financial;
  const act = dashboard?.activity;

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">Dashboard</span>
          {isLoadingDashboard && <Loader2 size={12} className="text-gray-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex gap-1">
            {PERIODS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => handlePeriod(value)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  dashboardPeriod === value
                    ? 'bg-slate-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => loadDashboard()}
            disabled={isLoadingDashboard}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* KPI Cards row */}
        <div className="grid grid-cols-5 gap-3">
          {[
            {
              label: 'Income',
              value: fin ? `$${fin.incomeTotalUsd.toFixed(0)}` : '--',
              color: 'text-emerald-400',
            },
            {
              label: 'Expenses',
              value: fin ? `$${fin.expenseTotalUsd.toFixed(0)}` : '--',
              color: 'text-red-400',
            },
            {
              label: 'Net',
              value: fin ? formatMoney(fin.burnNetUsd) : '--',
              color: fin && fin.burnNetUsd >= 0 ? 'text-emerald-400' : 'text-red-400',
              icon: fin && fin.burnNetUsd >= 0 ? TrendingUp : TrendingDown,
            },
            {
              label: 'Build Hours',
              value: act ? `${act.buildHours.toFixed(1)}h` : '--',
              color: 'text-blue-400',
            },
            {
              label: 'Leads',
              value: act ? String(act.leads) : '--',
              color: 'text-purple-400',
            },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="bg-gray-900 border border-gray-700 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className={`text-lg font-semibold ${color} flex items-center gap-1`}>
                {Icon && <Icon size={14} />}
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Project scoreboard */}
        {dashboard && dashboard.projectRankings.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Project Scoreboard</h3>
            <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Project</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Stage</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Hours</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.projectRankings.map((p, i) => (
                    <tr key={i} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                      <td className="px-3 py-2 text-gray-300 font-medium truncate max-w-[140px]">{p.projectKey}</td>
                      <td className="px-3 py-2 text-gray-500">{p.stage || '--'}</td>
                      <td className="px-3 py-2 text-right text-blue-400">{p.opportunityScore.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-gray-400">{p.estimatedHours.toFixed(0)}h</td>
                      <td className="px-3 py-2 text-right text-emerald-400">
                        {p.revenuePotentialUsd > 0 ? `$${(p.revenuePotentialUsd / 1000).toFixed(0)}k` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Channel performance */}
        {dashboard && dashboard.channelPerformance.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Channel Performance</h3>
            <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Channel</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Leads</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Runs</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">Cost</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium">CPL</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.channelPerformance.map((c, i) => (
                    <tr key={i} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                      <td className="px-3 py-2 text-gray-300 capitalize font-medium">{c.channel}</td>
                      <td className="px-3 py-2 text-right text-purple-400">{c.leads}</td>
                      <td className="px-3 py-2 text-right text-gray-400">{c.runs}</td>
                      <td className="px-3 py-2 text-right text-red-400">${c.costUsd.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right text-gray-400">
                        {c.costPerLeadUsd !== null ? `$${c.costPerLeadUsd.toFixed(0)}` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Alerts */}
        {dashboard && dashboard.alerts.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Alerts</h3>
            <div className="space-y-2">
              {dashboard.alerts.map((alert) => (
                <div key={alert.id} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${severityColor(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className="flex-1 text-sm text-gray-300 truncate">{alert.title}</span>
                  <span className="text-xs text-gray-600">{alert.status}</span>
                  <span className="text-xs text-gray-600 hidden sm:block">
                    {new Date(alert.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!dashboard && !isLoadingDashboard && (
          <div className="text-center py-8 text-gray-600 text-sm">
            Failed to load dashboard. <button onClick={() => loadDashboard()} className="text-slate-400 hover:underline">Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
