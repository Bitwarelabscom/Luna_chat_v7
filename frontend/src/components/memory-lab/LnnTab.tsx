'use client';

import { useMemo, useState } from 'react';
import { Radio, ChevronDown, ChevronRight, Zap, Brain, GitBranch, Activity } from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { EmotionalPoint, DriftPoint, SeedEntity, ActivatedNode } from '@/lib/api/memory-lab';

// ---- Shared components ----

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
        <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>{data.length} points</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <line
          x1={padding.left} y1={padding.top + innerH / 2}
          x2={padding.left + innerW} y2={padding.top + innerH / 2}
          stroke="var(--theme-border-default)" strokeDasharray="2,2" opacity={0.3}
        />
        <path d={areaD} fill={`url(#${gradientId})`} opacity={0.3} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
        {points.length > 0 && (
          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} />
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

const NODE_TYPE_COLORS: Record<string, string> = {
  entity: '#3b82f6',
  person: '#3b82f6',
  topic: '#22c55e',
  concept: '#a855f7',
  preference: '#f59e0b',
  emotion: '#ec4899',
  event: '#06b6d4',
  location: '#84cc16',
  object: '#64748b',
};

// ---- Architecture Card ----

function ArchCard({
  icon: Icon, title, subtitle, description, children,
}: {
  icon: typeof Brain;
  title: string;
  subtitle: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--theme-bg-tertiary)', border: '1px solid var(--theme-border-default)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
        <div>
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>{title}</span>
          <span className="text-[10px] ml-1.5" style={{ color: 'var(--theme-text-muted)' }}>{subtitle}</span>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
        {description}
      </p>
      {children}
    </div>
  );
}

// ---- Spreading Activation Params ----

const SA_PARAMS = [
  { param: 'DECAY_FACTOR', value: '0.65', desc: 'Signal loss per hop' },
  { param: 'HOP1_THRESHOLD', value: '0.10', desc: 'Min weight*recency for hop-1' },
  { param: 'HOP2_THRESHOLD', value: '0.20', desc: 'Min weight*recency for hop-2' },
  { param: 'HUB_FAN_LIMIT', value: '15', desc: 'Max neighbors per seed node' },
  { param: 'MAX_RESULTS', value: '25', desc: 'Final activation cap' },
  { param: 'SESSION_BONUS', value: '1.5x', desc: 'Boost for edges with 3+ sessions' },
];

// ---- NeuralSleep Schedule ----

function NeuralSleepSection() {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <Chevron className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
          NeuralSleep Schedule
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          <div>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: '#22c55e' }}>
              Daily (2 AM)
            </div>
            <ul className="space-y-1 text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
              <li className="flex items-start gap-1.5">
                <span style={{ color: 'var(--theme-text-muted)' }}>-</span>
                EMA weight evolution: co_occurrence=14d tau, semantic=90d, temporal=30d, causal=60d
              </li>
              <li className="flex items-start gap-1.5">
                <span style={{ color: 'var(--theme-text-muted)' }}>-</span>
                Weak edge pruning (weight &lt; 0.1), recency decay
              </li>
              <li className="flex items-start gap-1.5">
                <span style={{ color: 'var(--theme-text-muted)' }}>-</span>
                Node promotion: 3+ sessions, 3+ edges, 14d window
              </li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: '#a855f7' }}>
              Weekly (Sunday 3 AM)
            </div>
            <ul className="space-y-1 text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
              <li className="flex items-start gap-1.5">
                <span style={{ color: 'var(--theme-text-muted)' }}>-</span>
                Stale node prune: edge_count &lt; 2, emotional_intensity &lt; 0.3, 30d inactive
              </li>
              <li className="flex items-start gap-1.5">
                <span style={{ color: 'var(--theme-text-muted)' }}>-</span>
                Noise purge (stopword entities, type-exempt)
              </li>
              <li className="flex items-start gap-1.5">
                <span style={{ color: 'var(--theme-text-muted)' }}>-</span>
                Anti-centrality pressure, merge candidate analysis
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Activation Trace ----

function ActivationTraceSection() {
  const { activationTrace } = useMemoryLabStore();

  if (!activationTrace) {
    return (
      <div className="rounded-lg p-4 text-center" style={{ background: 'var(--theme-bg-tertiary)', border: '1px solid var(--theme-border-default)' }}>
        <Activity className="w-5 h-5 mx-auto mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          No activation trace yet. Send a message in chat to see spreading activation in action.
        </p>
      </div>
    );
  }

  const { timestamp, message, seeds, activated, elapsedMs, tieredSummary } = activationTrace;
  const direct = activated.filter((a: ActivatedNode) => a.depth === 1);
  const related = activated.filter((a: ActivatedNode) => a.depth === 2);
  const weak = activated.filter((a: ActivatedNode) => a.depth > 2);

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
          Live Activation Trace
        </span>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          <span>{elapsedMs}ms</span>
          <span>{new Date(timestamp).toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Trigger message */}
      <div className="text-[11px] px-2 py-1.5 rounded" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-secondary)' }}>
        &ldquo;{message}&rdquo;
      </div>

      {/* Seeds */}
      <div>
        <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--theme-text-muted)' }}>
          Seeds ({seeds.length})
        </div>
        <div className="flex flex-wrap gap-1.5">
          {seeds.map((s: SeedEntity) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
              style={{ background: (NODE_TYPE_COLORS[s.nodeType] || '#6b7280') + '22', color: NODE_TYPE_COLORS[s.nodeType] || '#6b7280' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: NODE_TYPE_COLORS[s.nodeType] || '#6b7280' }} />
              {s.nodeLabel}
              <span style={{ color: 'var(--theme-text-muted)' }}>C:{s.centralityScore.toFixed(2)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Tiered summary */}
      <div className="grid grid-cols-3 gap-2">
        <TierBadge label="Direct" count={tieredSummary.direct} color="#22c55e" />
        <TierBadge label="Related" count={tieredSummary.related} color="#3b82f6" />
        <TierBadge label="Weak" count={tieredSummary.weak} color="#6b7280" />
      </div>

      {/* Activated nodes by tier */}
      {direct.length > 0 && (
        <TierList label="Direct (Hop-1)" nodes={direct} color="#22c55e" />
      )}
      {related.length > 0 && (
        <TierList label="Related (Hop-2)" nodes={related} color="#3b82f6" />
      )}
      {weak.length > 0 && (
        <TierList label="Weak (Hop-3+)" nodes={weak} color="#6b7280" />
      )}
    </div>
  );
}

function TierBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded px-2 py-1.5 text-center" style={{ background: color + '15' }}>
      <div className="text-sm font-bold" style={{ color }}>{count}</div>
      <div className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>{label}</div>
    </div>
  );
}

function TierList({ label, nodes, color }: { label: string; nodes: ActivatedNode[]; color: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium mb-1" style={{ color }}>
        {label}
      </div>
      <div className="space-y-1">
        {nodes.slice(0, 10).map((n: ActivatedNode) => (
          <div
            key={n.id}
            className="flex items-center gap-2 px-2 py-1 rounded text-[10px]"
            style={{ background: 'var(--theme-bg-tertiary)' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: NODE_TYPE_COLORS[n.nodeType] || '#6b7280' }}
            />
            <span className="truncate" style={{ color: 'var(--theme-text-primary)' }}>
              {n.nodeLabel}
            </span>
            <span className="ml-auto shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
              {n.path.join(' > ')}
            </span>
            <span className="shrink-0 font-mono" style={{ color }}>
              {n.activation.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Main LNN Tab ----

export function LnnTab() {
  const { metrics, emotionalTrajectory, centroidDrift } = useMemoryLabStore();

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
      {/* Polling indicator */}
      <div className="flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5 text-green-400 animate-pulse" />
        <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>Live - 5s poll</span>
      </div>

      {/* Section 1: Architecture Cards (2x2) */}
      <div className="grid grid-cols-2 gap-3">
        <ArchCard
          icon={Zap}
          title="ThematicLNN"
          subtitle="LNN-A"
          description="Fast-path processor. Extracts thematic topics from messages via keyword/topic co-occurrence. Identifies what the conversation is about."
        >
          <MetricGauge label="Stability" value={thematicStability} color="#00c8ff" />
        </ArchCard>

        <ArchCard
          icon={GitBranch}
          title="RelationalLNN"
          subtitle="LNN-B"
          description="Slow-path processor. Maps relational structure - who connects to whom, causal chains, temporal sequences."
        >
          <MetricGauge label="Coherence" value={relationalCoherence} color="#a855f7" />
        </ArchCard>

        <ArchCard
          icon={Activity}
          title="CausalGate"
          subtitle="Arbitrator"
          description="Arbitrates between Thematic and Relational streams based on message intent. Factual queries favor Relational; open discussion favors Thematic."
        >
          <MetricGauge label="Cross-Stream Flow" value={crossStreamFlow} color="#22c55e" />
        </ArchCard>

        <ArchCard
          icon={Brain}
          title="Spreading Activation"
          subtitle="BFS"
          description="BFS from seed entities through memory graph. Seeds matched from message text, hop-1 and hop-2 neighbors activated with signal decay."
        >
          <div className="space-y-0.5">
            {SA_PARAMS.map(p => (
              <div key={p.param} className="flex items-center justify-between text-[10px]">
                <span className="font-mono" style={{ color: 'var(--theme-text-muted)' }}>{p.param}</span>
                <span className="font-mono font-bold" style={{ color: 'var(--theme-accent-primary)' }}>{p.value}</span>
                <span className="text-right" style={{ color: 'var(--theme-text-muted)', maxWidth: '45%' }}>{p.desc}</span>
              </div>
            ))}
          </div>
        </ArchCard>
      </div>

      {/* Section 2: NeuralSleep Schedule */}
      <NeuralSleepSection />

      {/* Section 3: Live Activation Trace */}
      <ActivationTraceSection />

      {/* Section 4: Charts */}
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
    </div>
  );
}
