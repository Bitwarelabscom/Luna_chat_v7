'use client';

import { useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { ElprisPrice } from '@/lib/api';

interface ElprisDropdownProps {
  data: ElprisPrice;
  onClose: () => void;
}

function getPriceColor(price: number): string {
  if (price < 0.5) return '#4ade80';   // green-400
  if (price <= 1.5) return '#facc15';  // yellow-400
  return '#f87171';                     // red-400
}

function getPriceColorClass(price: number): string {
  if (price < 0.5) return 'text-green-400';
  if (price <= 1.5) return 'text-yellow-400';
  return 'text-red-400';
}

export function ElprisDropdown({ data, onClose }: ElprisDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const { current, daily } = data;
  const currentHour = new Date().toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Stockholm',
  });

  // Filter x-axis ticks to show every 4 hours
  const tickIndices = daily.entries
    .map((e, i) => ({ time: e.time, i }))
    .filter((e) => {
      const h = parseInt(e.time.split(':')[0], 10);
      return h % 4 === 0 && e.time.endsWith(':00');
    })
    .map((e) => e.time);

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
          <Zap className={`w-4 h-4 ${getPriceColorClass(current.price)}`} />
          <h3 className="font-medium text-sm" style={{ color: 'var(--theme-text-primary)' }}>
            Electricity Price SE4
          </h3>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
          {current.date}
        </span>
      </div>

      {/* Stats row */}
      <div
        className="grid grid-cols-4 gap-1 p-3 border-b"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Now
          </div>
          <div className={`text-sm font-bold ${getPriceColorClass(current.price)}`}>
            {current.price.toFixed(2)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            High
          </div>
          <div className={`text-sm font-bold ${getPriceColorClass(daily.high)}`}>
            {daily.high.toFixed(2)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Low
          </div>
          <div className={`text-sm font-bold ${getPriceColorClass(daily.low)}`}>
            {daily.low.toFixed(2)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
            Avg
          </div>
          <div className={`text-sm font-bold ${getPriceColorClass(daily.average)}`}>
            {daily.average.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
          Today&apos;s Price Curve (SEK/kWh)
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={daily.entries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="elprisGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getPriceColor(daily.average)} stopOpacity={0.4} />
                <stop offset="95%" stopColor={getPriceColor(daily.average)} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
              tickLine={false}
              axisLine={false}
              ticks={tickIndices}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
              tickLine={false}
              axisLine={false}
              domain={['dataMin - 0.05', 'dataMax + 0.05']}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(0,0,0,0.85)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#fff',
              }}
              formatter={(value) => [`${Number(value).toFixed(4)} SEK/kWh`, 'Price']}
              labelFormatter={(label) => `Time: ${label}`}
            />
            <ReferenceLine
              x={currentHour}
              stroke="rgba(255,255,255,0.3)"
              strokeDasharray="3 3"
              label={{
                value: 'Now',
                position: 'top',
                fill: 'rgba(255,255,255,0.5)',
                fontSize: 10,
              }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={getPriceColor(daily.average)}
              strokeWidth={2}
              fill="url(#elprisGradient)"
              dot={false}
              activeDot={{
                r: 4,
                stroke: getPriceColor(daily.average),
                strokeWidth: 2,
                fill: '#fff',
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="text-[10px] text-center mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
          {current.timeStart}–{current.timeEnd} current interval
        </div>
      </div>
    </div>
  );
}

export default ElprisDropdown;
