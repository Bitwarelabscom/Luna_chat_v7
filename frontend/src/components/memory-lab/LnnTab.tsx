'use client';

import { useMemo } from 'react';
import { Radio } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { EmotionalPoint, DriftPoint } from '@/lib/api/memory-lab';

function MetricGauge({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(Math.max(value * 100, 0), 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>{label}</span>
        <span className="text-xs font-bold" style={{ color }}>{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Sparkline({
  data, color, height = 80, label,
}: {
  data: Array<{ x: number; y: number }>;
  color: string;
  height?: number;
  label: string;
}) {
  const width = 400;
  const padding = { top: 8, right: 8, bottom: 16, left: 8 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (data.length === 0) return [];
    const maxY = Math.max(...data.map(d => d.y), 0.1);
    const minY = Math.min(...data.map(d => d.y), -0.1);
    const range = maxY - minY || 1;

    return data.map((d, i) => ({
      x: padding.left + (i / Math.max(data.length - 1, 1)) * innerW,
      y: padding.top + innerH - ((d.y - minY) / range) * innerH,
    }));
  }, [data, innerW, innerH]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg" style={{ height, background: 'var(--theme-bg-tertiary)' }}>
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No data available</p>
      </div>
    );
  }

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaD = pathD +
    ` L ${points[points.length - 1].x} ${padding.top + innerH}` +
    ` L ${padding.left} ${padding.top + innerH} Z`;

  const gradientId = `sparkGrad-${label.replace(/\s/g, '')}`;

  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--theme-bg-tertiary)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--theme-text-secondary)' }}>{label}</span>
        <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          {data.length} points
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Zero line */}
        <line
          x1={padding.left} y1={padding.top + innerH / 2}
          x2={padding.left + innerW} y2={padding.top + innerH / 2}
          stroke="var(--theme-border-default)" strokeDasharray="2,2" opacity={0.3}
        />
        <path d={areaD} fill={`url(#${gradientId})`} opacity={0.3} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
        {/* Latest point highlight */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={3} fill={color}
          />
        )}
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function LnnTab() {
  const { metrics, emotionalTrajectory, centroidDrift } = useMemoryLabStore();

  // Derive dual-stream metrics from consciousness data
  const thematicStability = metrics?.temporalIntegration ?? 0;
  const relationalCoherence = metrics?.causalDensity ?? 0;
  const crossStreamFlow = metrics ? (thematicStability + relationalCoherence) / 2 : 0;

  const emotionalData = useMemo(() =>
    emotionalTrajectory.map((p: EmotionalPoint, i: number) => ({ x: i, y: p.valence })),
    [emotionalTrajectory]
  );

  const driftData = useMemo(() =>
    centroidDrift.map((p: DriftPoint, i: number) => ({ x: i, y: p.drift })),
    [centroidDrift]
  );

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Dual-Stream Overview */}
      <div className="rounded-lg p-4" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
            Dual-Stream Overview
          </span>
          <div className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-green-400 animate-pulse" />
            <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>5s poll</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="p-3 rounded-lg" style={{ background: 'var(--theme-bg-tertiary)' }}>
            <span className="text-[10px] block mb-2" style={{ color: 'var(--theme-text-muted)' }}>
              LNN-A Thematic
            </span>
            <MetricGauge label="Stability" value={thematicStability} color="#00c8ff" />
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--theme-bg-tertiary)' }}>
            <span className="text-[10px] block mb-2" style={{ color: 'var(--theme-text-muted)' }}>
              LNN-B Relational
            </span>
            <MetricGauge label="Coherence" value={relationalCoherence} color="#a855f7" />
          </div>
        </div>

        <MetricGauge label="Cross-Stream Flow" value={crossStreamFlow} color="#22c55e" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Sparkline
          data={emotionalData}
          color="#ec4899"
          height={100}
          label="Emotional Trajectory (Valence)"
        />
        <Sparkline
          data={driftData}
          color="#06b6d4"
          height={100}
          label="Centroid Drift (Cosine Dist)"
        />
      </div>

      {/* Raw data summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg p-3" style={{ background: 'var(--theme-bg-tertiary)' }}>
          <span className="text-xs font-medium block mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
            Latest Emotional Data
          </span>
          {emotionalTrajectory.length > 0 ? (
            <div className="space-y-1">
              {emotionalTrajectory.slice(-5).reverse().map((p, i) => (
                <div key={i} className="flex items-center justify-between text-[10px]">
                  <span style={{ color: 'var(--theme-text-muted)' }}>
                    {new Date(p.timestamp).toLocaleTimeString()}
                  </span>
                  <span style={{ color: p.valence >= 0 ? '#22c55e' : '#ef4444' }}>
                    V: {p.valence.toFixed(3)}
                  </span>
                  <span style={{ color: 'var(--theme-text-muted)' }}>
                    A: {p.attentionScore.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>No emotional data yet</p>
          )}
        </div>

        <div className="rounded-lg p-3" style={{ background: 'var(--theme-bg-tertiary)' }}>
          <span className="text-xs font-medium block mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
            Latest Drift Data
          </span>
          {centroidDrift.length > 0 ? (
            <div className="space-y-1">
              {centroidDrift.slice(-5).reverse().map((p, i) => (
                <div key={i} className="flex items-center justify-between text-[10px]">
                  <span style={{ color: 'var(--theme-text-muted)' }}>
                    {new Date(p.timestamp).toLocaleTimeString()}
                  </span>
                  <span style={{ color: 'var(--theme-text-secondary)' }}>
                    {p.drift.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>No drift data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
