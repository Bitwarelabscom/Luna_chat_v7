'use client';

import { useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Clock, Users, AlertTriangle } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

function formatMoney(usd: number): string {
  const abs = Math.abs(usd);
  const sign = usd < 0 ? '-' : '+';
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

export function KPIStrip() {
  const { dashboard, isLoadingDashboard, loadDashboard, setActiveTab } = useCEOLunaStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadDashboard();
    intervalRef.current = setInterval(() => loadDashboard(), 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const net = dashboard?.financial.burnNetUsd ?? null;
  const buildHours = dashboard?.activity.buildHours ?? null;
  const leads = dashboard?.activity.leads ?? null;
  const alertCount = dashboard?.alerts.filter((a) => a.status === 'open').length ?? null;
  const p2Alerts = dashboard?.alerts.filter((a) => a.severity === 'P2' && a.status === 'open').length ?? 0;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-gray-900/80 border-b border-gray-700 text-xs shrink-0">
      {/* Net P&L */}
      <div className="flex items-center gap-1.5">
        {net === null || isLoadingDashboard ? (
          <span className="text-gray-500 animate-pulse">Net --</span>
        ) : (
          <>
            {net >= 0 ? (
              <TrendingUp size={12} className="text-emerald-400" />
            ) : (
              <TrendingDown size={12} className="text-red-400" />
            )}
            <span className={net >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
              Net {formatMoney(net)}
            </span>
            <span className="text-gray-500">{dashboard?.financial.periodDays}d</span>
          </>
        )}
      </div>

      <div className="w-px h-3 bg-gray-700" />

      {/* Build hours */}
      <div className="flex items-center gap-1.5">
        <Clock size={12} className="text-blue-400" />
        <span className="text-gray-300">
          Build{' '}
          <span className="text-blue-400 font-medium">
            {buildHours === null ? '--' : `${buildHours.toFixed(1)}h`}
          </span>
        </span>
      </div>

      <div className="w-px h-3 bg-gray-700" />

      {/* Leads */}
      <div className="flex items-center gap-1.5">
        <Users size={12} className="text-purple-400" />
        <span className="text-gray-300">
          Leads{' '}
          <span className="text-purple-400 font-medium">
            {leads === null ? '--' : leads}
          </span>
        </span>
      </div>

      <div className="w-px h-3 bg-gray-700" />

      {/* Alerts */}
      <button
        onClick={() => setActiveTab('dashboard')}
        className={`flex items-center gap-1.5 transition-colors ${
          alertCount && alertCount > 0
            ? 'text-amber-400 hover:text-amber-300'
            : 'text-gray-500'
        }`}
      >
        <AlertTriangle size={12} />
        <span>
          {alertCount === null ? '--' : alertCount} alert{alertCount !== 1 ? 's' : ''}
          {p2Alerts > 0 && (
            <span className="ml-1 text-red-400 font-medium">({p2Alerts} P2)</span>
          )}
        </span>
      </button>

      {/* Period indicator */}
      <div className="ml-auto text-gray-600 text-xs">
        CEO Luna
      </div>
    </div>
  );
}
