'use client';

import React, { useState, useEffect } from 'react';
import { Activity, Zap, TrendingDown, CheckCircle, XCircle, AlertTriangle, RefreshCw, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { tradingApi, IndicatorSettings } from '@/lib/api';

interface ResearchSignal {
  id: string;
  symbol: string;
  price: number;
  rsi1m?: number;
  rsi5m?: number;
  rsi15m?: number;
  priceDropPct?: number;
  volumeRatio?: number;
  confidence: number;
  reasons: string[];
  status: 'pending' | 'executed' | 'skipped' | 'expired' | 'failed';
  executionMode: string;
  paperLiveMode: string;
  createdAt: string;
  indicators?: {
    rsi: { value1m: number; value5m: number; value15m: number };
    macd: { value: number; signal: number; histogram: number; crossover: string | null };
    bollinger: { percentB: number; squeeze: boolean };
    ema: { trend: string; crossover: string | null };
    volume: { ratio: number; spike: boolean };
  };
  confidenceBreakdown?: {
    rsi: number;
    macd: number;
    bollinger: number;
    ema: number;
    volume: number;
    priceAction: number;
    total: number;
  };
}

interface ResearchSettings {
  executionMode: 'auto' | 'confirm' | 'manual';
  paperLiveMode: 'paper' | 'live';
  enableAutoDiscovery: boolean;
  autoDiscoveryLimit: number;
  customSymbols: string[];
  minConfidence: number;
}

interface ResearchMetrics {
  research: {
    totalSignals: number;
    executed: number;
    skipped: number;
    expired: number;
    successRate: number;
    avgConfidence: number;
  };
  scalping: {
    paper: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
    live: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
    patterns: { key: string; winRate: number; trades: number; modifier: number }[];
  };
}

interface ResearchTabProps {
  onViewChart?: (symbol: string) => void;
}

export default function ResearchTab({ onViewChart }: ResearchTabProps) {
  const [signals, setSignals] = useState<ResearchSignal[]>([]);
  const [settings, setSettings] = useState<ResearchSettings | null>(null);
  const [metrics, setMetrics] = useState<ResearchMetrics | null>(null);
  const [topPairs, setTopPairs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings | null>(null);
  const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const [savingIndicators, setSavingIndicators] = useState(false);

  // Load initial data
  useEffect(() => {
    loadData();
    // Poll for signals every 5 seconds
    const interval = setInterval(loadSignals, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [settingsData, metricsData, pairsData, signalsData, indicatorData] = await Promise.all([
        tradingApi.getResearchSettings(),
        tradingApi.getResearchMetrics(),
        tradingApi.getTopPairs(20),
        tradingApi.getResearchSignals(),
        tradingApi.getIndicatorSettings().catch(() => null)
      ]);
      setSettings(settingsData);
      setMetrics(metricsData);
      setTopPairs(pairsData.pairs);
      setSignals(signalsData);
      if (indicatorData) setIndicatorSettings(indicatorData);
    } catch (error) {
      console.error('Failed to load research data', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSignals = async () => {
    try {
      const data = await tradingApi.getResearchSignals();
      setSignals(data);
    } catch (error) {
      console.error('Failed to load signals', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleModeChange = async (mode: 'auto' | 'confirm' | 'manual') => {
    try {
      await tradingApi.updateResearchSettings({ executionMode: mode });
      setSettings(s => s ? { ...s, executionMode: mode } : null);
    } catch (error) {
      console.error('Failed to update mode', error);
    }
  };

  const handlePaperLiveToggle = async () => {
    if (!settings) return;
    const newMode = settings.paperLiveMode === 'paper' ? 'live' : 'paper';
    try {
      await tradingApi.updateResearchSettings({ paperLiveMode: newMode });
      setSettings(s => s ? { ...s, paperLiveMode: newMode } : null);
    } catch (error) {
      console.error('Failed to toggle mode', error);
    }
  };

  const handleConfirmSignal = async (signalId: string, action: 'execute' | 'skip') => {
    try {
      await tradingApi.confirmSignal(signalId, action);
      loadSignals();
    } catch (error) {
      console.error('Failed to confirm signal', error);
    }
  };

  const handleExecuteSignal = async (signalId: string) => {
    try {
      await tradingApi.executeSignal(signalId);
      loadSignals();
    } catch (error) {
      console.error('Failed to execute signal', error);
    }
  };

  const handlePresetChange = async (preset: 'conservative' | 'balanced' | 'aggressive') => {
    setSavingIndicators(true);
    try {
      const updated = await tradingApi.applyIndicatorPreset(preset);
      setIndicatorSettings(updated);
    } catch (error) {
      console.error('Failed to apply preset', error);
    } finally {
      setSavingIndicators(false);
    }
  };

  const handleIndicatorToggle = async (indicator: string, enabled: boolean) => {
    if (!indicatorSettings) return;
    setSavingIndicators(true);
    try {
      const updates: Record<string, boolean> = {};
      updates[`enable${indicator.charAt(0).toUpperCase() + indicator.slice(1)}`] = enabled;
      const updated = await tradingApi.updateIndicatorSettings(updates as Partial<IndicatorSettings>);
      setIndicatorSettings(updated);
    } catch (error) {
      console.error('Failed to update indicator', error);
    } finally {
      setSavingIndicators(false);
    }
  };

  const handleMinConfidenceChange = async (value: number) => {
    setSavingIndicators(true);
    try {
      const updated = await tradingApi.updateIndicatorSettings({ minConfidence: value });
      setIndicatorSettings(updated);
    } catch (error) {
      console.error('Failed to update min confidence', error);
    } finally {
      setSavingIndicators(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RefreshCw style={{ width: 24, height: 24, color: '#8892a0', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const paperStats = metrics?.scalping?.paper || { trades: 0, winRate: 0, totalPnl: 0, avgPnl: 0 };
  const liveStats = metrics?.scalping?.live || { trades: 0, winRate: 0, totalPnl: 0, avgPnl: 0 };
  const currentStats = settings?.paperLiveMode === 'live' ? liveStats : paperStats;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', overflow: 'auto' }}>
      {/* Controls Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '12px', background: '#111827', borderRadius: '8px', alignItems: 'center' }}>
        {/* Execution Mode Selector */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['auto', 'confirm', 'manual'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: 'none',
                background: settings?.executionMode === mode ? '#00ff9f' : '#2a3545',
                color: settings?.executionMode === mode ? '#000' : '#fff',
                cursor: 'pointer',
                textTransform: 'capitalize',
                fontSize: '12px',
                fontWeight: 500,
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Paper/Live Toggle */}
        <button
          onClick={handlePaperLiveToggle}
          style={{
            padding: '6px 12px',
            borderRadius: '4px',
            border: settings?.paperLiveMode === 'live' ? '2px solid #ef4444' : '1px solid #2a3545',
            background: settings?.paperLiveMode === 'live' ? 'rgba(239, 68, 68, 0.2)' : '#2a3545',
            color: settings?.paperLiveMode === 'live' ? '#ef4444' : '#fff',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {settings?.paperLiveMode === 'live' && <AlertTriangle style={{ width: 14, height: 14 }} />}
          {settings?.paperLiveMode === 'paper' ? 'Paper Mode' : 'LIVE MODE'}
        </button>

        <div style={{ flex: 1 }} />

        {/* Indicator Settings Toggle */}
        <button
          onClick={() => setShowIndicatorSettings(!showIndicatorSettings)}
          style={{
            padding: '6px 12px',
            borderRadius: '4px',
            border: '1px solid #2a3545',
            background: showIndicatorSettings ? '#00ff9f20' : '#2a3545',
            color: showIndicatorSettings ? '#00ff9f' : '#fff',
            cursor: 'pointer',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Settings style={{ width: 14, height: 14 }} />
          Indicators
          {showIndicatorSettings ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
        </button>

        {/* Refresh Button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: '6px 12px',
            borderRadius: '4px',
            border: '1px solid #2a3545',
            background: '#2a3545',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw style={{ width: 14, height: 14, animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Indicator Settings Panel */}
      {showIndicatorSettings && indicatorSettings && (
        <div style={{ background: '#111827', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: '#fff', fontWeight: 500 }}>
              Indicator Settings
            </h4>
            {savingIndicators && (
              <span style={{ fontSize: '11px', color: '#8892a0' }}>Saving...</span>
            )}
          </div>

          {/* Presets */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '8px', textTransform: 'uppercase' }}>Preset</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['conservative', 'balanced', 'aggressive'] as const).map(preset => (
                <button
                  key={preset}
                  onClick={() => handlePresetChange(preset)}
                  disabled={savingIndicators}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: indicatorSettings.preset === preset ? '2px solid #00ff9f' : '1px solid #2a3545',
                    background: indicatorSettings.preset === preset ? '#00ff9f20' : '#2a3545',
                    color: indicatorSettings.preset === preset ? '#00ff9f' : '#fff',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                    textTransform: 'capitalize',
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Indicator Toggles */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '8px', textTransform: 'uppercase' }}>Active Indicators</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[
                { key: 'rsi', label: 'RSI', enabled: indicatorSettings.enableRsi },
                { key: 'macd', label: 'MACD', enabled: indicatorSettings.enableMacd },
                { key: 'bollinger', label: 'Bollinger', enabled: indicatorSettings.enableBollinger },
                { key: 'ema', label: 'EMA Cross', enabled: indicatorSettings.enableEma },
                { key: 'volume', label: 'Volume', enabled: indicatorSettings.enableVolume },
                { key: 'priceAction', label: 'Price Action', enabled: indicatorSettings.enablePriceAction },
              ].map(ind => (
                <button
                  key={ind.key}
                  onClick={() => handleIndicatorToggle(ind.key, !ind.enabled)}
                  disabled={savingIndicators}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: ind.enabled ? '1px solid #10b981' : '1px solid #2a3545',
                    background: ind.enabled ? '#10b98120' : '#2a3545',
                    color: ind.enabled ? '#10b981' : '#8892a0',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 500,
                  }}
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Confidence Slider */}
          <div>
            <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '8px', textTransform: 'uppercase' }}>
              Min Confidence: {((indicatorSettings.minConfidence || 0.6) * 100).toFixed(0)}%
            </div>
            <input
              type="range"
              min="0.3"
              max="0.9"
              step="0.05"
              value={indicatorSettings.minConfidence || 0.6}
              onChange={(e) => handleMinConfidenceChange(parseFloat(e.target.value))}
              disabled={savingIndicators}
              style={{
                width: '100%',
                accentColor: '#00ff9f',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#8892a0', marginTop: '4px' }}>
              <span>30% (more signals)</span>
              <span>90% (fewer signals)</span>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        <MetricCard
          title="Win Rate"
          value={`${(currentStats.winRate * 100).toFixed(1)}%`}
          color={currentStats.winRate >= 0.5 ? '#10b981' : '#ef4444'}
        />
        <MetricCard
          title="Total Trades"
          value={currentStats.trades.toString()}
          color="#8892a0"
        />
        <MetricCard
          title="Total P&L"
          value={`$${currentStats.totalPnl.toFixed(2)}`}
          color={currentStats.totalPnl >= 0 ? '#10b981' : '#ef4444'}
        />
        <MetricCard
          title="Signals Today"
          value={(metrics?.research?.totalSignals || 0).toString()}
          color="#00ff9f"
        />
      </div>

      {/* Signal Feed */}
      <div style={{ flex: 1, minHeight: '200px', background: '#111827', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a3545', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity style={{ width: 16, height: 16, color: '#00ff9f' }} />
          <h3 style={{ margin: 0, fontSize: '13px', color: '#fff', fontWeight: 500 }}>Live Signal Feed</h3>
          <span style={{ fontSize: '11px', color: '#8892a0', marginLeft: 'auto' }}>
            {signals.filter(s => s.status === 'pending').length} pending
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
          {signals.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#8892a0', fontSize: '13px' }}>
              No signals detected yet. The bot scans for opportunities every 30 seconds.
            </div>
          ) : (
            signals.map(signal => (
              <SignalCard
                key={signal.id}
                signal={signal}
                executionMode={settings?.executionMode || 'manual'}
                onConfirm={(action) => handleConfirmSignal(signal.id, action)}
                onExecute={() => handleExecuteSignal(signal.id)}
                onViewChart={onViewChart}
              />
            ))
          )}
        </div>
      </div>

      {/* Top Volume Pairs */}
      <div style={{ background: '#111827', borderRadius: '8px', padding: '12px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '11px', color: '#8892a0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Top Volume USDC Pairs
        </h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {topPairs.slice(0, 15).map(pair => (
            <span
              key={pair}
              onClick={() => onViewChart?.(pair)}
              style={{
                padding: '4px 8px',
                background: '#2a3545',
                borderRadius: '4px',
                fontSize: '11px',
                color: '#00ff9f',
                cursor: onViewChart ? 'pointer' : 'default',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {pair.replace('USDC', '')}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div style={{ background: '#111827', borderRadius: '6px', padding: '12px' }}>
      <div style={{ fontSize: '10px', color: '#8892a0', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title}
      </div>
      <div style={{ fontSize: '18px', fontWeight: 600, color, fontFamily: 'JetBrains Mono, monospace' }}>
        {value}
      </div>
    </div>
  );
}

function SignalCard({
  signal,
  executionMode,
  onConfirm,
  onExecute,
  onViewChart,
}: {
  signal: ResearchSignal;
  executionMode: string;
  onConfirm: (action: 'execute' | 'skip') => void;
  onExecute: () => void;
  onViewChart?: (symbol: string) => void;
}) {
  const confidenceColor = signal.confidence > 0.7 ? '#10b981' : signal.confidence > 0.5 ? '#f59e0b' : '#ef4444';
  const isPending = signal.status === 'pending';
  const isOld = new Date().getTime() - new Date(signal.createdAt).getTime() > 5 * 60 * 1000;

  const statusColors: Record<string, string> = {
    pending: '#f59e0b',
    executed: '#10b981',
    skipped: '#8892a0',
    expired: '#6b7280',
    failed: '#ef4444',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        borderBottom: '1px solid #1a2535',
        opacity: isPending ? 1 : 0.6,
      }}
    >
      {/* Icon */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '6px', background: `${confidenceColor}20` }}>
        <Zap style={{ width: 16, height: 16, color: confidenceColor }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            onClick={() => onViewChart?.(signal.symbol)}
            style={{
              fontSize: '14px',
              color: '#fff',
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              cursor: onViewChart ? 'pointer' : 'default',
            }}
          >
            {signal.symbol.replace('USDC', '')}
          </span>
          <span style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '3px',
            background: `${statusColors[signal.status]}20`,
            color: statusColors[signal.status],
            textTransform: 'uppercase',
          }}>
            {signal.status}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#8892a0', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* Enhanced indicators display */}
          {signal.indicators ? (
            <>
              <span style={{ color: signal.indicators.rsi.value5m < 30 ? '#10b981' : '#8892a0' }}>
                RSI: {signal.indicators.rsi.value5m.toFixed(0)}
              </span>
              <span style={{ color: signal.indicators.macd.crossover === 'bullish_cross' ? '#10b981' : '#8892a0' }}>
                MACD: {signal.indicators.macd.histogram > 0 ? '↑' : '↓'}
              </span>
              <span style={{ color: signal.indicators.bollinger.percentB < 0.2 ? '#10b981' : '#8892a0' }}>
                BB: {(signal.indicators.bollinger.percentB * 100).toFixed(0)}%
              </span>
              {signal.indicators.volume.spike && (
                <span style={{ color: '#f59e0b' }}>
                  Vol: {signal.indicators.volume.ratio.toFixed(1)}x
                </span>
              )}
            </>
          ) : (
            <>
              {signal.rsi1m !== undefined && (
                <span style={{ color: signal.rsi1m < 30 ? '#10b981' : '#8892a0' }}>
                  1m RSI: {signal.rsi1m.toFixed(1)}
                </span>
              )}
              {signal.rsi5m !== undefined && (
                <span style={{ color: signal.rsi5m < 30 ? '#10b981' : '#8892a0' }}>
                  5m RSI: {signal.rsi5m.toFixed(1)}
                </span>
              )}
            </>
          )}
          {signal.priceDropPct !== undefined && signal.priceDropPct > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <TrendingDown style={{ width: 10, height: 10, color: '#ef4444' }} />
              {signal.priceDropPct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {/* Confidence */}
      <div style={{ textAlign: 'right' }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: confidenceColor,
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          {(signal.confidence * 100).toFixed(0)}%
        </div>
        <div style={{ fontSize: '10px', color: '#8892a0' }}>
          ${signal.price.toFixed(2)}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {isPending && !isOld && executionMode === 'confirm' && (
          <>
            <button
              onClick={() => onConfirm('execute')}
              style={{
                padding: '6px 8px',
                background: '#10b981',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Execute trade"
            >
              <CheckCircle style={{ width: 14, height: 14 }} />
            </button>
            <button
              onClick={() => onConfirm('skip')}
              style={{
                padding: '6px 8px',
                background: '#ef4444',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Skip signal"
            >
              <XCircle style={{ width: 14, height: 14 }} />
            </button>
          </>
        )}
        {isPending && !isOld && executionMode === 'manual' && (
          <button
            onClick={onExecute}
            style={{
              padding: '4px 10px',
              background: '#10b981',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
            }}
          >
            Execute
          </button>
        )}
      </div>
    </div>
  );
}
