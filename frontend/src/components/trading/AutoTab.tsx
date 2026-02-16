'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Zap,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Settings,
  ChevronDown,
  ChevronUp,
  Activity,
  Target,
  Shield,
  Flame,
} from 'lucide-react';
import {
  tradingApi,
  AutoTradingSettings,
  AutoTradingState,
  ReconciliationResult,
  ActiveTrade,
} from '@/lib/api';

interface AutoTabProps {
  onRefresh?: () => void;
}

function AutoTab({ onRefresh }: AutoTabProps) {
  const [settings, setSettings] = useState<AutoTradingSettings | null>(null);
  const [state, setState] = useState<AutoTradingState | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showPositions, setShowPositions] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [settingsData, stateData, tradesData] = await Promise.all([
        tradingApi.getAutoTradingSettings(),
        tradingApi.getAutoTradingState(),
        tradingApi.getActiveTrades(),
      ]);
      setSettings(settingsData);
      setState(stateData.state);
      // Filter to only show auto trades (source === 'bot')
      const autoTrades = tradesData.openPositions.filter(t => t.source === 'bot');
      setActiveTrades(autoTrades);
    } catch (err) {
      console.error('Failed to load auto trading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Refresh every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleStartStop = async () => {
    if (!settings) return;
    try {
      if (settings.enabled) {
        await tradingApi.stopAutoTrading();
      } else {
        await tradingApi.startAutoTrading();
      }
      await loadData();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to toggle auto trading:', err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await tradingApi.reconcilePortfolio();
      setReconciliation(result);
      setLastSyncTime(new Date());
      await loadData();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to reconcile portfolio:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSettingChange = async (key: string, value: number | boolean | string[]) => {
    if (!settings) return;
    try {
      const updates = { [key]: value };
      // Auto-calculate the other capital percentage
      if (key === 'conservativeCapitalPct') {
        updates.aggressiveCapitalPct = 100 - (value as number);
      } else if (key === 'aggressiveCapitalPct') {
        updates.conservativeCapitalPct = 100 - (value as number);
      }
      await tradingApi.updateAutoTradingSettings(updates);
      setSettings({ ...settings, ...updates });
    } catch (err) {
      console.error('Failed to update setting:', err);
    }
  };

  const formatPnl = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  };

  const formatPct = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const timeSinceSync = () => {
    if (!lastSyncTime) return 'Never';
    const seconds = Math.floor((Date.now() - lastSyncTime.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  const formatTimeInTrade = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (days > 0) return `${days}d ${remainingHours}h`;
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getTierColor = (symbol: string) => {
    const isAggressive = settings?.aggressiveSymbols?.some(s => symbol.includes(s.replace('_USD', '')));
    return isAggressive ? '#f59e0b' : '#60a5fa';
  };

  const getTierLabel = (symbol: string) => {
    const isAggressive = settings?.aggressiveSymbols?.some(s => symbol.includes(s.replace('_USD', '')));
    return isAggressive ? 'Aggressive' : 'Conservative';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8892a0' }}>
        <RefreshCw style={{ width: 20, height: 20, marginRight: 8, animation: 'spin 1s linear infinite' }} />
        Loading...
      </div>
    );
  }

  const isRunning = settings?.enabled && !state?.isPaused;
  const winRate = state && state.tradesCount > 0 ? (state.winsCount / state.tradesCount) * 100 : 0;

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto', background: '#0a0f18' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Zap style={{ width: 24, height: 24, color: '#00ff9f' }} />
          <span style={{ fontSize: '18px', fontWeight: 600, color: '#fff' }}>Auto Trading</span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 500,
              background: isRunning ? 'rgba(0, 255, 159, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: isRunning ? '#00ff9f' : '#ef4444',
            }}
          >
            {isRunning ? 'Running' : state?.isPaused ? 'Paused' : 'Stopped'}
          </span>
          {state?.isPaused && state.pauseReason && (
            <span style={{ fontSize: '12px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertTriangle style={{ width: 14, height: 14 }} />
              {state.pauseReason}
            </span>
          )}
        </div>
        <button
          onClick={handleStartStop}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            background: isRunning ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 255, 159, 0.2)',
            color: isRunning ? '#ef4444' : '#00ff9f',
          }}
        >
          {isRunning ? <Square style={{ width: 16, height: 16 }} /> : <Play style={{ width: 16, height: 16 }} />}
          {isRunning ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: '#111827', borderRadius: '8px', padding: '12px', border: '1px solid #2a3545' }}>
          <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Daily P&L</div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              color: (state?.dailyPnlUsd || 0) >= 0 ? '#00ff9f' : '#ef4444',
            }}
          >
            {formatPnl(state?.dailyPnlUsd || 0)}
          </div>
          <div style={{ fontSize: '11px', color: (state?.dailyPnlPct || 0) >= 0 ? '#00ff9f' : '#ef4444' }}>
            {formatPct(state?.dailyPnlPct || 0)}
          </div>
        </div>

        <div style={{ background: '#111827', borderRadius: '8px', padding: '12px', border: '1px solid #2a3545' }}>
          <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Positions</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
            {state?.activePositions || 0} / {settings?.maxPositions || 3}
          </div>
          <div style={{ fontSize: '11px', color: '#8892a0' }}>{state?.tradesCount || 0} trades today</div>
        </div>

        <div style={{ background: '#111827', borderRadius: '8px', padding: '12px', border: '1px solid #2a3545' }}>
          <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Win Rate</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: winRate >= 50 ? '#00ff9f' : '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>
            {winRate.toFixed(0)}%
          </div>
          <div style={{ fontSize: '11px', color: '#8892a0' }}>
            {state?.winsCount || 0}W / {state?.lossesCount || 0}L
          </div>
        </div>

        <div style={{ background: '#111827', borderRadius: '8px', padding: '12px', border: '1px solid #2a3545' }}>
          <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Consec. Losses</div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              color: (state?.consecutiveLosses || 0) >= 2 ? '#ef4444' : '#fff',
            }}
          >
            {state?.consecutiveLosses || 0}
          </div>
          <div style={{ fontSize: '11px', color: '#8892a0' }}>max {settings?.maxConsecutiveLosses || 3}</div>
        </div>
      </div>

      {/* Active Positions */}
      <div style={{ background: '#111827', borderRadius: '8px', border: '1px solid #2a3545', marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: showPositions ? '1px solid #2a3545' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setShowPositions(!showPositions)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity style={{ width: 16, height: 16, color: '#00ff9f' }} />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>Active Positions</span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                background: 'rgba(0, 255, 159, 0.15)',
                color: '#00ff9f',
              }}
            >
              {activeTrades.length}
            </span>
          </div>
          {showPositions ? <ChevronUp style={{ width: 16, height: 16, color: '#8892a0' }} /> : <ChevronDown style={{ width: 16, height: 16, color: '#8892a0' }} />}
        </div>

        {showPositions && (
          <div style={{ padding: '12px 16px' }}>
            {activeTrades.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px', color: '#8892a0' }}>
                <div style={{ fontSize: '13px' }}>No active auto trades</div>
                <div style={{ fontSize: '11px', marginTop: '4px' }}>Positions will appear here when opened</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activeTrades.map((trade) => (
                  <div
                    key={trade.id}
                    style={{
                      background: '#0a0f18',
                      borderRadius: '8px',
                      padding: '12px',
                      border: `1px solid ${getTierColor(trade.symbol)}33`,
                    }}
                  >
                    {/* Header: Symbol + Tier */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
                          {trade.symbol.replace('_USD', '').replace('USDT', '')}
                        </span>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 500,
                            background: `${getTierColor(trade.symbol)}20`,
                            color: getTierColor(trade.symbol),
                          }}
                        >
                          {getTierLabel(trade.symbol)}
                        </span>
                      </div>
                      <span style={{ fontSize: '11px', color: '#8892a0' }}>
                        {formatTimeInTrade(trade.timeInTrade)}
                      </span>
                    </div>

                    {/* Prices Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '10px', color: '#8892a0', marginBottom: '2px' }}>Entry</div>
                        <div style={{ fontSize: '13px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
                          ${trade.entryPrice < 0.01 ? trade.entryPrice.toFixed(6) : trade.entryPrice.toFixed(4)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '10px', color: '#8892a0', marginBottom: '2px' }}>Current</div>
                        <div style={{ fontSize: '13px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
                          ${trade.currentPrice < 0.01 ? trade.currentPrice.toFixed(6) : trade.currentPrice.toFixed(4)}
                        </div>
                      </div>
                    </div>

                    {/* P&L Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '10px', color: '#8892a0', marginBottom: '2px' }}>P&L</div>
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: trade.pnlDollar >= 0 ? '#00ff9f' : '#ef4444',
                          }}
                        >
                          {formatPnl(trade.pnlDollar)} ({formatPct(trade.pnlPercent)})
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '10px', color: '#8892a0', marginBottom: '2px' }}>Trailing Stop</div>
                        <div style={{ fontSize: '13px', color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>
                          {trade.trailingStopPct ? `${trade.trailingStopPct}%` : '-'}
                          {trade.trailingStopPrice && (
                            <span style={{ color: '#8892a0', marginLeft: '4px' }}>
                              @ ${trade.trailingStopPrice < 0.01 ? trade.trailingStopPrice.toFixed(6) : trade.trailingStopPrice.toFixed(4)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quantity */}
                    <div style={{ fontSize: '11px', color: '#8892a0' }}>
                      Qty: {trade.quantity.toFixed(2)} | Value: ${(trade.quantity * trade.currentPrice).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dual Mode Settings */}
      <div style={{ background: '#111827', borderRadius: '8px', border: '1px solid #2a3545', marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #2a3545',
            cursor: 'pointer',
          }}
          onClick={() => setShowSettings(!showSettings)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings style={{ width: 16, height: 16, color: '#8892a0' }} />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>Dual Mode Settings</span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                background: settings?.dualModeEnabled ? 'rgba(0, 255, 159, 0.15)' : 'rgba(107, 114, 128, 0.3)',
                color: settings?.dualModeEnabled ? '#00ff9f' : '#8892a0',
              }}
            >
              {settings?.dualModeEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          {showSettings ? <ChevronUp style={{ width: 16, height: 16, color: '#8892a0' }} /> : <ChevronDown style={{ width: 16, height: 16, color: '#8892a0' }} />}
        </div>

        {showSettings && (
          <div style={{ padding: '16px' }}>
            {/* Dual Mode Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', color: '#c0c8d0' }}>Dual Mode</span>
              <button
                onClick={() => handleSettingChange('dualModeEnabled', !settings?.dualModeEnabled)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  background: settings?.dualModeEnabled ? 'rgba(0, 255, 159, 0.2)' : 'rgba(107, 114, 128, 0.3)',
                  color: settings?.dualModeEnabled ? '#00ff9f' : '#8892a0',
                }}
              >
                {settings?.dualModeEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {/* Capital Split */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#8892a0', marginBottom: '8px' }}>Capital Allocation</div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <Shield style={{ width: 14, height: 14, color: '#60a5fa' }} />
                    <span style={{ fontSize: '12px', color: '#60a5fa' }}>Conservative</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="90"
                    value={settings?.conservativeCapitalPct || 70}
                    onChange={(e) => handleSettingChange('conservativeCapitalPct', parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: '#60a5fa' }}
                  />
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#60a5fa', textAlign: 'center' }}>
                    {settings?.conservativeCapitalPct || 70}%
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <Flame style={{ width: 14, height: 14, color: '#f59e0b' }} />
                    <span style={{ fontSize: '12px', color: '#f59e0b' }}>Aggressive</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="50"
                    value={settings?.aggressiveCapitalPct || 30}
                    onChange={(e) => handleSettingChange('aggressiveCapitalPct', parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: '#f59e0b' }}
                    disabled
                  />
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f59e0b', textAlign: 'center' }}>
                    {settings?.aggressiveCapitalPct || 30}%
                  </div>
                </div>
              </div>
            </div>

            {/* Trailing Stop Settings */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#8892a0', marginBottom: '8px' }}>Trailing Stop Settings</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Activation</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.trailActivationPct || 2}
                      onChange={(e) => handleSettingChange('trailActivationPct', parseFloat(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      step="0.5"
                      min="0.5"
                      max="10"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Trail Distance</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.trailDistancePct || 3}
                      onChange={(e) => handleSettingChange('trailDistancePct', parseFloat(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      step="0.5"
                      min="1"
                      max="10"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Initial SL</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.initialStopLossPct || 5}
                      onChange={(e) => handleSettingChange('initialStopLossPct', parseFloat(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      step="0.5"
                      min="1"
                      max="15"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Confidence Thresholds */}
            <div>
              <div style={{ fontSize: '12px', color: '#8892a0', marginBottom: '8px' }}>Confidence Thresholds</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#60a5fa', marginBottom: '4px' }}>Conservative Min</div>
                  <input
                    type="number"
                    value={settings?.conservativeMinConfidence || 0.75}
                    onChange={(e) => handleSettingChange('conservativeMinConfidence', parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: '1px solid #2a3545',
                      background: '#0a0f18',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                    step="0.05"
                    min="0.5"
                    max="1"
                  />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#f59e0b', marginBottom: '4px' }}>Aggressive Min</div>
                  <input
                    type="number"
                    value={settings?.aggressiveMinConfidence || 0.65}
                    onChange={(e) => handleSettingChange('aggressiveMinConfidence', parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: '1px solid #2a3545',
                      background: '#0a0f18',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                    step="0.05"
                    min="0.5"
                    max="1"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Symbol Lists */}
      <div style={{ background: '#111827', borderRadius: '8px', border: '1px solid #2a3545', marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            cursor: 'pointer',
          }}
          onClick={() => setShowSymbols(!showSymbols)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Target style={{ width: 16, height: 16, color: '#8892a0' }} />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>Trading Symbols</span>
          </div>
          {showSymbols ? <ChevronUp style={{ width: 16, height: 16, color: '#8892a0' }} /> : <ChevronDown style={{ width: 16, height: 16, color: '#8892a0' }} />}
        </div>

        {showSymbols && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Shield style={{ width: 12, height: 12, color: '#60a5fa' }} />
                <span style={{ fontSize: '12px', color: '#60a5fa' }}>Conservative ({settings?.conservativeSymbols?.length || 0})</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {(settings?.conservativeSymbols || []).map((symbol) => (
                  <span
                    key={symbol}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      background: 'rgba(96, 165, 250, 0.15)',
                      color: '#60a5fa',
                    }}
                  >
                    {symbol.replace('_USD', '')}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Flame style={{ width: 12, height: 12, color: '#f59e0b' }} />
                <span style={{ fontSize: '12px', color: '#f59e0b' }}>Aggressive ({settings?.aggressiveSymbols?.length || 0})</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {(settings?.aggressiveSymbols || []).map((symbol) => (
                  <span
                    key={symbol}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      background: 'rgba(245, 158, 11, 0.15)',
                      color: '#f59e0b',
                    }}
                  >
                    {symbol.replace('_USD', '')}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Advanced Settings */}
      <div style={{ background: '#111827', borderRadius: '8px', border: '1px solid #2a3545', marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: showAdvanced ? '1px solid #2a3545' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings style={{ width: 16, height: 16, color: '#8892a0' }} />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>Advanced Settings</span>
          </div>
          {showAdvanced ? <ChevronUp style={{ width: 16, height: 16, color: '#8892a0' }} /> : <ChevronDown style={{ width: 16, height: 16, color: '#8892a0' }} />}
        </div>

        {showAdvanced && (
          <div style={{ padding: '16px' }}>
            {/* Risk Management */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle style={{ width: 14, height: 14 }} />
                Risk Management
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Daily Loss Limit</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.dailyLossLimitPct || 5}
                      onChange={(e) => handleSettingChange('dailyLossLimitPct', parseFloat(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      step="1"
                      min="1"
                      max="20"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Max Positions</div>
                  <input
                    type="number"
                    value={settings?.maxPositions || 5}
                    onChange={(e) => handleSettingChange('maxPositions', parseInt(e.target.value))}
                    style={{
                      width: '60px',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: '1px solid #2a3545',
                      background: '#0a0f18',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                    min="1"
                    max="10"
                  />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Symbol Cooldown</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.symbolCooldownMinutes || 15}
                      onChange={(e) => handleSettingChange('symbolCooldownMinutes', parseInt(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      min="1"
                      max="60"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>min</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Position Size</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>$</span>
                    <input
                      type="number"
                      value={settings?.minPositionUsd || 30}
                      onChange={(e) => handleSettingChange('minPositionUsd', parseFloat(e.target.value))}
                      style={{
                        width: '50px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      min="10"
                      max="500"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>-</span>
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>$</span>
                    <input
                      type="number"
                      value={settings?.maxPositionUsd || 70}
                      onChange={(e) => handleSettingChange('maxPositionUsd', parseFloat(e.target.value))}
                      style={{
                        width: '50px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      min="10"
                      max="1000"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Strategy Settings */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#60a5fa', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Target style={{ width: 14, height: 14 }} />
                Strategy Settings
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>RSI Threshold</div>
                  <input
                    type="number"
                    value={settings?.rsiThreshold || 30}
                    onChange={(e) => handleSettingChange('rsiThreshold', parseInt(e.target.value))}
                    style={{
                      width: '60px',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: '1px solid #2a3545',
                      background: '#0a0f18',
                      color: '#fff',
                      fontSize: '13px',
                    }}
                    min="10"
                    max="50"
                  />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Volume Multiplier</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.volumeMultiplier || 1.5}
                      onChange={(e) => handleSettingChange('volumeMultiplier', parseFloat(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      step="0.1"
                      min="1"
                      max="5"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>x</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Min Profit</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={settings?.minProfitPct || 2}
                      onChange={(e) => handleSettingChange('minProfitPct', parseFloat(e.target.value))}
                      style={{
                        width: '60px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        border: '1px solid #2a3545',
                        background: '#0a0f18',
                        color: '#fff',
                        fontSize: '13px',
                      }}
                      step="0.5"
                      min="0.5"
                      max="10"
                    />
                    <span style={{ fontSize: '12px', color: '#8892a0' }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#8892a0', marginBottom: '4px' }}>Exclude Top 10</div>
                  <button
                    onClick={() => handleSettingChange('excludeTop10', !settings?.excludeTop10)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '4px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                      background: settings?.excludeTop10 ? 'rgba(0, 255, 159, 0.2)' : 'rgba(107, 114, 128, 0.3)',
                      color: settings?.excludeTop10 ? '#00ff9f' : '#8892a0',
                    }}
                  >
                    {settings?.excludeTop10 ? 'Yes' : 'No'}
                  </button>
                </div>
              </div>
            </div>

            {/* BTC Filters */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap style={{ width: 14, height: 14 }} />
                BTC Correlation Filters
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  onClick={() => handleSettingChange('btcTrendFilter', !settings?.btcTrendFilter)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    background: settings?.btcTrendFilter ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107, 114, 128, 0.3)',
                    color: settings?.btcTrendFilter ? '#f59e0b' : '#8892a0',
                  }}
                >
                  Trend Filter {settings?.btcTrendFilter ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => handleSettingChange('btcMomentumBoost', !settings?.btcMomentumBoost)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    background: settings?.btcMomentumBoost ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107, 114, 128, 0.3)',
                    color: settings?.btcMomentumBoost ? '#f59e0b' : '#8892a0',
                  }}
                >
                  Momentum Boost {settings?.btcMomentumBoost ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => handleSettingChange('btcCorrelationSkip', !settings?.btcCorrelationSkip)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    background: settings?.btcCorrelationSkip ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107, 114, 128, 0.3)',
                    color: settings?.btcCorrelationSkip ? '#f59e0b' : '#8892a0',
                  }}
                >
                  Correlation Skip {settings?.btcCorrelationSkip ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Portfolio Sync */}
      <div style={{ background: '#111827', borderRadius: '8px', border: '1px solid #2a3545' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2a3545' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity style={{ width: 16, height: 16, color: '#8892a0' }} />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>Portfolio Sync</span>
            <span style={{ fontSize: '11px', color: '#8892a0' }}>Last: {timeSinceSync()}</span>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              cursor: syncing ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              background: 'rgba(96, 165, 250, 0.2)',
              color: '#60a5fa',
              opacity: syncing ? 0.6 : 1,
            }}
          >
            <RefreshCw style={{ width: 14, height: 14, animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>

        <div style={{ padding: '12px 16px' }}>
          {reconciliation && (reconciliation.orphanPositions.length > 0 || reconciliation.missingFromPortfolio.length > 0) ? (
            <div>
              {reconciliation.orphanPositions.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle style={{ width: 14, height: 14 }} />
                    Orphan Positions (no active trade)
                  </div>
                  {reconciliation.orphanPositions.map((pos) => (
                    <div
                      key={pos.symbol}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: '#0a0f18',
                        borderRadius: '6px',
                        marginBottom: '6px',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>{pos.asset}</span>
                        <span style={{ fontSize: '11px', color: '#8892a0', marginLeft: '8px' }}>${pos.valueUsd.toFixed(2)}</span>
                      </div>
                      {pos.trailingStopAdded ? (
                        <span style={{ fontSize: '11px', color: '#00ff9f', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle style={{ width: 12, height: 12 }} />
                          5% Trailing SL Added
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8892a0' }}>Pending</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {reconciliation.missingFromPortfolio.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', color: '#60a5fa', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TrendingDown style={{ width: 14, height: 14 }} />
                    Manual Sells Detected
                  </div>
                  {reconciliation.missingFromPortfolio.map((symbol) => (
                    <div
                      key={symbol}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: '#0a0f18',
                        borderRadius: '6px',
                        marginBottom: '6px',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>{symbol.replace('_USD', '')}</span>
                      <span style={{ fontSize: '11px', color: '#00ff9f', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle style={{ width: 12, height: 12 }} />
                        Trade Closed
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '16px', color: '#8892a0' }}>
              <CheckCircle style={{ width: 24, height: 24, marginBottom: '8px', color: '#00ff9f' }} />
              <div style={{ fontSize: '13px' }}>Portfolio and trades are in sync</div>
              <div style={{ fontSize: '11px', marginTop: '4px' }}>Auto-sync runs every 30 seconds</div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export default React.memo(AutoTab);
