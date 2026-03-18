'use client';

import { useEffect, useRef } from 'react';
import { Coins } from 'lucide-react';
import type { DailyTokenStats } from '@/lib/api';

interface TokenUsageDropdownProps {
  data: DailyTokenStats;
  onClose: () => void;
}

function formatTokens(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(2);
}

export function TokenUsageDropdown({ data, onClose }: TokenUsageDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const models = Object.entries(data.byModel)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.total - a.total);

  const maxTokens = models.length > 0 ? models[0].total : 1;

  const today = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 bottom-full mb-2 w-80 backdrop-blur-xl border rounded-xl shadow-2xl overflow-hidden z-[9999]"
      style={{
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* Header */}
      <div
        className="p-3 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-amber-400" />
          <h3 className="font-medium text-sm" style={{ color: 'var(--theme-text-primary)' }}>
            Token Usage
          </h3>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
          {today}
        </span>
      </div>

      {/* Summary */}
      <div
        className="grid grid-cols-4 gap-1 p-3 border-b"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Total
          </div>
          <div className="text-sm font-bold text-amber-400">
            {formatTokens(data.totalTokens)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Input
          </div>
          <div className="text-sm font-bold" style={{ color: 'var(--theme-text-primary)' }}>
            {formatTokens(data.inputTokens)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Output
          </div>
          <div className="text-sm font-bold" style={{ color: 'var(--theme-text-primary)' }}>
            {formatTokens(data.outputTokens)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Cost
          </div>
          <div className="text-sm font-bold text-amber-400">
            {formatCost(data.estimatedCost)}
          </div>
        </div>
      </div>

      {/* Cache row */}
      {data.cacheTokens > 0 && (
        <div
          className="px-3 py-1.5 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <span className="text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
            Cache hits
          </span>
          <span className="text-[11px] text-green-400">
            {formatTokens(data.cacheTokens)} tokens
          </span>
        </div>
      )}

      {/* Model breakdown */}
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
          By Model
        </div>
        <div className="space-y-2">
          {models.map((model) => (
            <div key={model.name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium truncate mr-2" style={{ color: 'var(--theme-text-primary)' }}>
                  {model.name}
                </span>
                <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--theme-text-secondary)' }}>
                  {formatTokens(model.total)} &middot; {formatCost(model.cost)}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-amber-400/70"
                  style={{ width: `${(model.total / maxTokens) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {models.length === 0 && (
            <div className="text-center py-2 text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
              No usage today
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TokenUsageDropdown;
