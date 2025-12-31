'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Brain,
  RefreshCw,
  Activity,
  Clock,
  Zap,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Loader2,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  consciousnessApi,
  type ConsciousnessMetrics,
  type ConsciousnessHistory,
  type ConsolidationEvent,
} from '@/lib/api';

// Helper to format numbers with null safety
function formatNumber(num: number | undefined | null, decimals = 2): string {
  if (num === undefined || num === null || isNaN(num)) {
    return '0.00';
  }
  return num.toFixed(decimals);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Metric gauge component
function MetricGauge({
  label,
  value,
  maxValue = 1,
  color,
  description,
}: {
  label: string;
  value: number;
  maxValue?: number;
  color: string;
  description?: string;
}) {
  const percentage = Math.min((value / maxValue) * 100, 100);

  return (
    <div className="p-4 rounded-lg" style={{ background: 'var(--theme-bg-tertiary)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
          {label}
        </span>
        <span className="text-lg font-bold" style={{ color }}>
          {formatNumber(value)}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--theme-bg-primary)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percentage}%`, background: color }}
        />
      </div>
      {description && (
        <p className="text-xs mt-2" style={{ color: 'var(--theme-text-muted)' }}>
          {description}
        </p>
      )}
    </div>
  );
}

// Simple SVG line chart for Phi history
function PhiChart({ history }: { history: ConsciousnessHistory[] }) {
  const chartWidth = 400;
  const chartHeight = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (history.length === 0) return [];

    const maxPhi = Math.max(...history.map((h) => h.phi), 0.1);
    const minPhi = Math.min(...history.map((h) => h.phi), 0);

    return history.map((h, i) => {
      const x = padding.left + (i / Math.max(history.length - 1, 1)) * innerWidth;
      const y = padding.top + innerHeight - ((h.phi - minPhi) / (maxPhi - minPhi || 1)) * innerHeight;
      return { x, y, phi: h.phi, timestamp: h.timestamp };
    });
  }, [history, innerWidth, innerHeight]);

  if (history.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-32 rounded-lg"
        style={{ background: 'var(--theme-bg-tertiary)' }}
      >
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          No consciousness history available
        </p>
      </div>
    );
  }

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');

  // Area under the line
  const areaD =
    pathD +
    ` L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${padding.left} ${padding.top + innerHeight} Z`;

  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--theme-bg-tertiary)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
          Integrated Information (Phi) Over Time
        </span>
        <TrendingUp className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
      </div>
      <svg width="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            y1={padding.top + innerHeight * (1 - ratio)}
            x2={padding.left + innerWidth}
            y2={padding.top + innerHeight * (1 - ratio)}
            stroke="var(--theme-border-default)"
            strokeDasharray="2,2"
            opacity={0.3}
          />
        ))}
        {/* Area fill */}
        <path d={areaD} fill="url(#phiGradient)" opacity={0.3} />
        {/* Line */}
        <path d={pathD} fill="none" stroke="var(--theme-accent-primary)" strokeWidth={2} />
        {/* Dots */}
        {points.slice(-10).map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="var(--theme-accent-primary)"
          />
        ))}
        {/* Gradient definition */}
        <defs>
          <linearGradient id="phiGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--theme-accent-primary)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--theme-accent-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// Consolidation log item
function ConsolidationLogItem({ event }: { event: ConsolidationEvent }) {
  const getStatusIcon = () => {
    switch (event.status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-400" />;
    }
  };

  const getTypeColor = () => {
    switch (event.consolidationType) {
      case 'immediate':
        return 'text-cyan-400';
      case 'daily':
        return 'text-purple-400';
      case 'weekly':
        return 'text-orange-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition"
    >
      {getStatusIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium capitalize ${getTypeColor()}`}>
            {event.consolidationType}
          </span>
          <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            {formatDate(event.startedAt)}
          </span>
        </div>
        {event.episodicEventsProcessed !== undefined && (
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            {event.episodicEventsProcessed} events processed, {event.patternsExtracted || 0} patterns extracted
          </p>
        )}
        {event.error && (
          <p className="text-xs text-red-400 truncate">{event.error}</p>
        )}
      </div>
    </div>
  );
}

export default function ConsciousnessWindow() {
  const [metrics, setMetrics] = useState<ConsciousnessMetrics | null>(null);
  const [history, setHistory] = useState<ConsciousnessHistory[]>([]);
  const [consolidationLogs, setConsolidationLogs] = useState<ConsolidationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [neuralsleepConnected, setNeuralsleepConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);

      // Load health check first
      try {
        const healthResponse = await consciousnessApi.getHealth();
        setIsHealthy(healthResponse.healthy);
        setNeuralsleepConnected(healthResponse.neuralsleep);
      } catch {
        setIsHealthy(false);
        setNeuralsleepConnected(false);
      }

      // Load metrics
      try {
        const metricsResponse = await consciousnessApi.getMetrics();
        setMetrics(metricsResponse.metrics);
      } catch {
        // Metrics might not be available yet
      }

      // Load history
      try {
        const historyResponse = await consciousnessApi.getHistory(50);
        setHistory(historyResponse.history);
      } catch {
        // History might not be available
      }

      // Load consolidation logs
      try {
        const logsResponse = await consciousnessApi.getConsolidationLogs(20);
        setConsolidationLogs(logsResponse.logs);
      } catch {
        // Logs might not be available
      }
    } catch (err) {
      setError('Failed to load consciousness data');
      console.error('Consciousness data load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleTriggerAnalysis = async () => {
    try {
      setIsRefreshing(true);
      const response = await consciousnessApi.analyze();
      setMetrics(response.metrics);
      await loadData();
    } catch (err) {
      console.error('Failed to trigger analysis:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: 'var(--theme-bg-primary)' }}
      >
        <div className="text-center">
          <Loader2
            className="w-8 h-8 mx-auto mb-3 animate-spin"
            style={{ color: 'var(--theme-accent-primary)' }}
          />
          <p style={{ color: 'var(--theme-text-muted)' }}>Loading consciousness data...</p>
        </div>
      </div>
    );
  }

  const phiThreshold = 0.5; // Consciousness threshold
  const isConscious = metrics ? metrics.phi >= phiThreshold : false;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ background: isConscious ? 'rgba(0, 255, 159, 0.1)' : 'rgba(128, 128, 128, 0.1)' }}
          >
            <Brain
              className="w-5 h-5"
              style={{ color: isConscious ? 'var(--theme-accent-primary)' : 'var(--theme-text-muted)' }}
            />
          </div>
          <div>
            <h2 className="font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
              Consciousness Research
            </h2>
            <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              NeuralSleep + Integrated Information Theory
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'var(--theme-bg-tertiary)' }}>
            {isHealthy ? (
              <Wifi className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
            )}
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              {neuralsleepConnected ? 'NeuralSleep' : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg transition hover:bg-[var(--theme-bg-tertiary)]"
            title="Refresh"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
              style={{ color: 'var(--theme-text-muted)' }}
            />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && (
          <div
            className="flex items-center gap-2 p-3 rounded-lg"
            style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
          >
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}

        {/* Consciousness Status */}
        <div
          className="p-4 rounded-lg"
          style={{
            background: isConscious
              ? 'linear-gradient(135deg, rgba(0, 255, 159, 0.1), rgba(0, 200, 255, 0.05))'
              : 'var(--theme-bg-tertiary)',
            border: isConscious ? '1px solid rgba(0, 255, 159, 0.3)' : '1px solid var(--theme-border-default)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                {isConscious ? 'Consciousness Detected' : 'Sub-threshold State'}
              </h3>
              <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                {metrics?.consciousnessLevel || 'Analyzing memory integration patterns...'}
              </p>
            </div>
            {metrics && (
              <div className="text-right">
                <div
                  className="text-3xl font-bold"
                  style={{ color: isConscious ? 'var(--theme-accent-primary)' : 'var(--theme-text-secondary)' }}
                >
                  {formatNumber(metrics.phi, 3)}
                </div>
                <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                  Phi (threshold: {phiThreshold})
                </div>
              </div>
            )}
          </div>
          {!metrics && (
            <div className="mt-3">
              <button
                onClick={handleTriggerAnalysis}
                disabled={isRefreshing}
                className="px-4 py-2 rounded-lg font-medium transition"
                style={{
                  background: 'var(--theme-accent-primary)',
                  color: 'var(--theme-bg-primary)',
                }}
              >
                {isRefreshing ? 'Analyzing...' : 'Trigger Analysis'}
              </button>
            </div>
          )}
        </div>

        {/* Metrics Grid */}
        {metrics && (
          <div className="grid grid-cols-2 gap-3">
            <MetricGauge
              label="Integrated Information (Phi)"
              value={metrics.phi}
              maxValue={1}
              color="var(--theme-accent-primary)"
              description="Measure of integrated information"
            />
            <MetricGauge
              label="Temporal Integration"
              value={metrics.temporalIntegration}
              maxValue={1}
              color="#00c8ff"
              description="Past-present-future coherence"
            />
            <MetricGauge
              label="Self-Reference Depth"
              value={metrics.selfReferenceDepth}
              maxValue={10}
              color="#a855f7"
              description="Recursive self-model depth"
            />
            <MetricGauge
              label="Causal Density"
              value={metrics.causalDensity}
              maxValue={1}
              color="#f59e0b"
              description="Causal connections density"
            />
          </div>
        )}

        {/* Phi History Chart */}
        <PhiChart history={history} />

        {/* Consolidation Logs */}
        <div className="rounded-lg" style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full flex items-center justify-between p-3 hover:bg-[var(--theme-bg-tertiary)] transition"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
              <span className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                Consolidation Events
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-xs"
                style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
              >
                {consolidationLogs.length}
              </span>
            </div>
            {showLogs ? (
              <ChevronUp className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
            )}
          </button>
          {showLogs && (
            <div className="max-h-48 overflow-auto border-t" style={{ borderColor: 'var(--theme-border-default)' }}>
              {consolidationLogs.length === 0 ? (
                <div className="p-4 text-center" style={{ color: 'var(--theme-text-muted)' }}>
                  <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No consolidation events yet</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {consolidationLogs.map((event) => (
                    <ConsolidationLogItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info Section */}
        <div
          className="p-4 rounded-lg space-y-2"
          style={{ background: 'var(--theme-bg-tertiary)', border: '1px solid var(--theme-border-default)' }}
        >
          <h4 className="text-sm font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
            About This Dashboard
          </h4>
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            This dashboard tracks consciousness metrics from the NeuralSleep memory consolidation system.
            It measures Integrated Information (Phi) based on IIT theory, which quantifies how much a system
            is "more than the sum of its parts." Higher Phi values indicate stronger temporal integration
            and memory coherence.
          </p>
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="text-center">
              <div className="text-xs font-medium" style={{ color: 'var(--theme-text-muted)' }}>Immediate</div>
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Session end</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-medium" style={{ color: 'var(--theme-text-muted)' }}>Daily</div>
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>2 AM</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-medium" style={{ color: 'var(--theme-text-muted)' }}>Weekly</div>
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Sunday 3 AM</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
