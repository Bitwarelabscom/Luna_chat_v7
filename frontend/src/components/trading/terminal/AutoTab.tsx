'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Play,
  Square,
  RefreshCw,
  AlertTriangle,
  Shield,
  Flame,
  Clock,
  Brain,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  tradingApi,
  type AutoTradingSettings,
  type AutoTradingState,
  type ReconciliationResult,
  type OrphanPosition,
} from '@/lib/api';

export default function AutoTab() {
  const [settings, setSettings] = useState<AutoTradingSettings | null>(null);
  const [state, setState] = useState<AutoTradingState | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showEarlyTriggers, setShowEarlyTriggers] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<{ analyzedAt: string; marketSummary: string; decisions: unknown[] } | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [settingsData, stateResponse] = await Promise.all([
        tradingApi.getAutoTradingSettings(),
        tradingApi.getAutoTradingState(),
      ]);
      setSettings(settingsData);
      setState(stateResponse.state);
      if (settingsData.strategy === 'luna_ai') {
        try {
          const analysisData = await tradingApi.getLastAnalysis();
          setLastAnalysis(analysisData.analysis);
        } catch (_err) {
          // Non-critical
        }
      }
    } catch (err) {
      console.error('Failed to load auto trading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Refresh state every 10 seconds
    const interval = setInterval(async () => {
      try {
        const stateResponse = await tradingApi.getAutoTradingState();
        setState(stateResponse.state);
      } catch (err) {
        console.error('Failed to refresh state:', err);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle start/stop
  const handleToggle = async () => {
    if (!state) return;
    setActionLoading('toggle');
    try {
      if (state.isRunning) {
        const result = await tradingApi.stopAutoTrading();
        setState(result.state);
      } else {
        const result = await tradingApi.startAutoTrading();
        setState(result.state);
      }
    } catch (err) {
      console.error('Failed to toggle auto trading:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle reconcile
  const handleReconcile = async () => {
    setActionLoading('reconcile');
    try {
      const result = await tradingApi.reconcilePortfolio();
      setReconciliation(result);
      setLastSync(new Date());
      // Refresh state after reconciliation
      const stateResponse = await tradingApi.getAutoTradingState();
      setState(stateResponse.state);
    } catch (err) {
      console.error('Failed to reconcile portfolio:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle settings update
  const handleSettingsUpdate = async (updates: Partial<AutoTradingSettings>) => {
    if (!settings) return;
    try {
      const result = await tradingApi.updateAutoTradingSettings(updates);
      setSettings(result.settings);
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  // Force Luna AI analysis
  const handleForceAnalysis = async () => {
    setActionLoading('force_analysis');
    try {
      await tradingApi.triggerLlmAnalysis();
      const analysisData = await tradingApi.getLastAnalysis();
      setLastAnalysis(analysisData.analysis);
    } catch (err) {
      console.error('Failed to trigger analysis:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle dual mode
  const handleToggleDualMode = async () => {
    await handleSettingsUpdate({ dualModeEnabled: !settings?.dualModeEnabled });
  };

  // Update capital split
  const handleCapitalSplitChange = async (conservativePct: number) => {
    const aggressivePct = 100 - conservativePct;
    await handleSettingsUpdate({
      conservativeCapitalPct: conservativePct,
      aggressiveCapitalPct: aggressivePct,
    });
  };

  // Update trailing settings
  const handleTrailingUpdate = async (field: string, value: number) => {
    await handleSettingsUpdate({ [field]: value });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
        <RefreshCw size={24} className="animate-spin" style={{ color: 'var(--terminal-accent)' }} />
      </div>
    );
  }

  const winRate = state && state.tradesCount > 0
    ? ((state.winsCount / state.tradesCount) * 100).toFixed(1)
    : '0.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header with Status and Controls */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Zap size={18} style={{ color: 'var(--terminal-accent)' }} />
            <span className="terminal-card-title">AUTO TRADING</span>
            <div className={`terminal-status ${state?.isRunning ? 'terminal-status-live' : ''}`}>
              <span className="terminal-status-dot" style={{
                background: state?.isRunning
                  ? 'var(--terminal-positive)'
                  : state?.isPaused
                    ? 'var(--terminal-warning)'
                    : 'var(--terminal-text-dim)',
              }} />
              <span style={{
                color: state?.isRunning
                  ? 'var(--terminal-positive)'
                  : state?.isPaused
                    ? 'var(--terminal-warning)'
                    : 'var(--terminal-text-dim)',
              }}>
                {state?.isRunning ? 'RUNNING' : state?.isPaused ? 'PAUSED' : 'STOPPED'}
              </span>
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={actionLoading === 'toggle'}
            className={`terminal-btn ${state?.isRunning ? 'terminal-btn-secondary' : 'terminal-btn-primary'}`}
            style={{ padding: '0.375rem 0.75rem' }}
          >
            {state?.isRunning ? <Square size={14} /> : <Play size={14} />}
            <span>{state?.isRunning ? 'Stop' : 'Start'}</span>
          </button>
        </div>

        {/* Stats Row */}
        <div className="terminal-card-body" style={{ padding: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                Daily P&L
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontFamily: 'IBM Plex Mono',
                fontWeight: 600,
                color: (state?.dailyPnlUsd || 0) >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
              }}>
                {(state?.dailyPnlUsd || 0) >= 0 ? '+' : ''}${(state?.dailyPnlUsd || 0).toFixed(2)}
                <span style={{ fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                  ({(state?.dailyPnlPct || 0) >= 0 ? '+' : ''}{(state?.dailyPnlPct || 0).toFixed(2)}%)
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                Positions
              </div>
              <div style={{ fontSize: '1.25rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                {state?.activePositions || 0}/{settings?.maxPositions || 3}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                Win Rate
              </div>
              <div style={{ fontSize: '1.25rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                {winRate}%
                <span style={{ fontSize: '0.8rem', color: 'var(--terminal-text-dim)', marginLeft: '0.25rem' }}>
                  ({state?.winsCount || 0}W/{state?.lossesCount || 0}L)
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                Consec. Losses
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontFamily: 'IBM Plex Mono',
                fontWeight: 600,
                color: (state?.consecutiveLosses || 0) >= 2 ? 'var(--terminal-warning)' : 'var(--terminal-text)',
              }}>
                {state?.consecutiveLosses || 0}/{settings?.maxConsecutiveLosses || 3}
              </div>
            </div>
          </div>

          {/* Pause Reason */}
          {state?.isPaused && state.pauseReason && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid var(--terminal-warning)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--terminal-warning)' }} />
              <span style={{ color: 'var(--terminal-warning)', fontSize: '0.85rem' }}>
                Paused: {state.pauseReason}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Dual Mode Settings */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">DUAL MODE SETTINGS</span>
          <button
            onClick={handleToggleDualMode}
            className={`terminal-btn ${settings?.dualModeEnabled ? 'terminal-btn-primary' : 'terminal-btn-secondary'}`}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
          >
            {settings?.dualModeEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <div className="terminal-card-body" style={{ padding: '1rem', opacity: settings?.dualModeEnabled ? 1 : 0.5 }}>
          {/* Capital Split */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Capital Split
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
                <Shield size={14} style={{ color: 'var(--terminal-positive)' }} />
                <span style={{ fontSize: '0.85rem' }}>Conservative</span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                  {settings?.conservativeCapitalPct || 70}%
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="90"
                step="5"
                value={settings?.conservativeCapitalPct || 70}
                onChange={(e) => handleCapitalSplitChange(parseInt(e.target.value))}
                disabled={!settings?.dualModeEnabled}
                style={{ flex: 1, accentColor: 'var(--terminal-accent)' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px', justifyContent: 'flex-end' }}>
                <Flame size={14} style={{ color: 'var(--terminal-warning)' }} />
                <span style={{ fontSize: '0.85rem' }}>Aggressive</span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                  {settings?.aggressiveCapitalPct || 30}%
                </span>
              </div>
            </div>
          </div>

          {/* Trailing Stop Settings */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Trailing Stop
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                  Activation %
                </label>
                <input
                  type="number"
                  min="0.5"
                  max="10"
                  step="0.5"
                  value={settings?.trailActivationPct || 2.0}
                  onChange={(e) => handleTrailingUpdate('trailActivationPct', parseFloat(e.target.value))}
                  disabled={!settings?.dualModeEnabled}
                  className="terminal-input"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                  Trail Distance %
                </label>
                <input
                  type="number"
                  min="1"
                  max="15"
                  step="0.5"
                  value={settings?.trailDistancePct || 3.0}
                  onChange={(e) => handleTrailingUpdate('trailDistancePct', parseFloat(e.target.value))}
                  disabled={!settings?.dualModeEnabled}
                  className="terminal-input"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                  Initial SL %
                </label>
                <input
                  type="number"
                  min="2"
                  max="20"
                  step="0.5"
                  value={settings?.initialStopLossPct || 5.0}
                  onChange={(e) => handleTrailingUpdate('initialStopLossPct', parseFloat(e.target.value))}
                  disabled={!settings?.dualModeEnabled}
                  className="terminal-input"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
            </div>
          </div>

          {/* Symbol Lists */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Shield size={14} style={{ color: 'var(--terminal-positive)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                  Conservative ({settings?.conservativeSymbols?.length || 0})
                </span>
              </div>
              <div style={{
                background: 'var(--terminal-surface)',
                padding: '0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontFamily: 'IBM Plex Mono',
                color: 'var(--terminal-text-muted)',
                maxHeight: '60px',
                overflow: 'auto',
              }}>
                {settings?.conservativeSymbols?.map(s => s.replace('_USD', '')).join(', ') || 'BTC, ETH, SOL, XRP, ADA...'}
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Flame size={14} style={{ color: 'var(--terminal-warning)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                  Aggressive ({settings?.aggressiveSymbols?.length || 0})
                </span>
              </div>
              <div style={{
                background: 'var(--terminal-surface)',
                padding: '0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontFamily: 'IBM Plex Mono',
                color: 'var(--terminal-text-muted)',
                maxHeight: '60px',
                overflow: 'auto',
              }}>
                {settings?.aggressiveSymbols?.map(s => s.replace('_USD', '')).join(', ') || 'DOGE, SHIB, BONK, PONKE...'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Selector + Luna AI Panel */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">STRATEGY</span>
        </div>
        <div className="terminal-card-body" style={{ padding: '1rem' }}>
          <div style={{ marginBottom: settings?.strategy === 'luna_ai' ? '1rem' : 0 }}>
            <select
              value={settings?.strategy || 'rsi_oversold'}
              onChange={(e) => handleSettingsUpdate({ strategy: e.target.value as AutoTradingSettings['strategy'] })}
              className="terminal-input"
              style={{ width: '200px', padding: '0.375rem 0.5rem' }}
            >
              <option value="rsi_oversold">RSI Oversold</option>
              <option value="trend_following">Trend Following</option>
              <option value="mean_reversion">Mean Reversion</option>
              <option value="momentum">Momentum</option>
              <option value="btc_correlation">BTC Correlation</option>
              <option value="luna_ai">Luna AI</option>
            </select>
          </div>

          {settings?.strategy === 'luna_ai' && (
            <div style={{ borderTop: '1px solid var(--terminal-border)', paddingTop: '1rem' }}>
              {/* Luna AI Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <Brain size={16} style={{ color: 'var(--terminal-accent)' }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--terminal-text)' }}>Luna AI Strategy</span>
              </div>

              {/* Risk Level */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Risk Level
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['conservative', 'moderate', 'aggressive'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => handleSettingsUpdate({ riskLevel: level })}
                      className={`terminal-btn ${settings?.riskLevel === level ? 'terminal-btn-primary' : 'terminal-btn-secondary'}`}
                      style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                    >
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* LLM Analysis Interval */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                    LLM Analysis Interval
                  </div>
                  <span style={{ fontSize: '0.8rem', fontFamily: 'IBM Plex Mono', color: 'var(--terminal-accent)' }}>
                    {settings?.llmAnalysisIntervalHours || 4}h
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="24"
                  step="1"
                  value={settings?.llmAnalysisIntervalHours || 4}
                  onChange={(e) => handleSettingsUpdate({ llmAnalysisIntervalHours: parseInt(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--terminal-accent)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--terminal-text-dim)', marginTop: '0.125rem' }}>
                  <span>1h</span>
                  <span>24h</span>
                </div>
              </div>

              {/* Data Sources */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Data Sources
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {[
                    { key: 'technicals', label: 'Technicals', always: true },
                    { key: 'news', label: 'News', always: false },
                    { key: 'sentiment', label: 'Sentiment', always: false },
                    { key: 'fear_greed', label: 'Fear & Greed', always: false },
                  ].map(({ key, label, always }) => {
                    const enabled = always || (settings?.dataSourcesEnabled || []).includes(key);
                    return (
                      <label
                        key={key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.375rem',
                          cursor: always ? 'default' : 'pointer',
                          fontSize: '0.8rem',
                          color: enabled ? 'var(--terminal-text)' : 'var(--terminal-text-dim)',
                          opacity: always ? 0.6 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={always}
                          onChange={() => {
                            const current = settings?.dataSourcesEnabled || [];
                            const next = enabled
                              ? current.filter(s => s !== key)
                              : [...current, key];
                            handleSettingsUpdate({ dataSourcesEnabled: next });
                          }}
                          style={{ accentColor: 'var(--terminal-accent)' }}
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Early Trigger Thresholds (collapsible) */}
              <div style={{ marginBottom: '1rem' }}>
                <div
                  onClick={() => setShowEarlyTriggers(!showEarlyTriggers)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: showEarlyTriggers ? '0.5rem' : 0 }}
                >
                  <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                    Early Trigger Thresholds
                  </div>
                  {showEarlyTriggers
                    ? <ChevronUp size={14} style={{ color: 'var(--terminal-text-dim)' }} />
                    : <ChevronDown size={14} style={{ color: 'var(--terminal-text-dim)' }} />
                  }
                </div>
                {showEarlyTriggers && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                        BTC % Drop
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="0.5"
                        value={settings?.earlyTriggerBtcPct || 3}
                        onChange={(e) => handleSettingsUpdate({ earlyTriggerBtcPct: parseFloat(e.target.value) })}
                        className="terminal-input"
                        style={{ width: '100%', padding: '0.375rem 0.5rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                        Coin % Drop
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="20"
                        step="1"
                        value={settings?.earlyTriggerCoinPct || 5}
                        onChange={(e) => handleSettingsUpdate({ earlyTriggerCoinPct: parseFloat(e.target.value) })}
                        className="terminal-input"
                        style={{ width: '100%', padding: '0.375rem 0.5rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                        Volume Spike
                      </label>
                      <input
                        type="number"
                        min="1.5"
                        max="10"
                        step="0.5"
                        value={settings?.earlyTriggerVolumeX || 2}
                        onChange={(e) => handleSettingsUpdate({ earlyTriggerVolumeX: parseFloat(e.target.value) })}
                        className="terminal-input"
                        style={{ width: '100%', padding: '0.375rem 0.5rem' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Last Analysis */}
              <div style={{
                background: 'var(--terminal-surface)',
                borderRadius: '4px',
                padding: '0.75rem',
                marginBottom: '0.75rem',
                border: '1px solid var(--terminal-border)',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  Last Analysis
                </div>
                {lastAnalysis ? (
                  <>
                    <div style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono', color: 'var(--terminal-accent)', marginBottom: '0.25rem' }}>
                      {new Date(lastAnalysis.analyzedAt).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--terminal-text)', marginBottom: '0.375rem', lineHeight: 1.4 }}>
                      {lastAnalysis.marketSummary
                        ? lastAnalysis.marketSummary.slice(0, 150) + (lastAnalysis.marketSummary.length > 150 ? '...' : '')
                        : 'No summary available'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)' }}>
                      {(lastAnalysis.decisions as unknown[]).length} decision{(lastAnalysis.decisions as unknown[]).length !== 1 ? 's' : ''}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--terminal-text-dim)' }}>No analysis yet</div>
                )}
              </div>

              {/* Force Analysis Button */}
              <button
                onClick={handleForceAnalysis}
                disabled={actionLoading === 'force_analysis'}
                className="terminal-btn terminal-btn-primary"
                style={{ padding: '0.375rem 0.75rem' }}
              >
                <Brain size={14} className={actionLoading === 'force_analysis' ? 'animate-spin' : ''} />
                <span>{actionLoading === 'force_analysis' ? 'Analyzing...' : 'Force Analysis'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Portfolio Sync */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="terminal-card-title">PORTFOLIO SYNC</span>
            {lastSync && (
              <span style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)' }}>
                Last: {Math.round((Date.now() - lastSync.getTime()) / 1000)}s ago
              </span>
            )}
          </div>
          <button
            onClick={handleReconcile}
            disabled={actionLoading === 'reconcile'}
            className="terminal-btn terminal-btn-secondary"
            style={{ padding: '0.375rem 0.75rem' }}
          >
            <RefreshCw size={14} className={actionLoading === 'reconcile' ? 'animate-spin' : ''} />
            <span>Sync Now</span>
          </button>
        </div>
        <div className="terminal-card-body" style={{ padding: '1rem' }}>
          {reconciliation ? (
            <>
              {/* Sync Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                    {reconciliation.orphanPositions.length}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                    Orphans Found
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600, color: 'var(--terminal-positive)' }}>
                    {reconciliation.reconciled}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                    Reconciled
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600, color: 'var(--terminal-warning)' }}>
                    {reconciliation.missingFromPortfolio.length}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase' }}>
                    Manual Sells
                  </div>
                </div>
              </div>

              {/* Orphan Positions Table */}
              {reconciliation.orphanPositions.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Orphan Positions (coins without active trade)
                  </div>
                  <table className="terminal-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Value</th>
                        <th style={{ textAlign: 'right' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.orphanPositions.map((pos: OrphanPosition) => (
                        <tr key={pos.symbol}>
                          <td style={{ fontFamily: 'IBM Plex Mono' }}>
                            {pos.asset}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                            {pos.amount < 1 ? pos.amount.toFixed(6) : pos.amount.toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                            ${pos.valueUsd.toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {pos.trailingStopAdded ? (
                              <span style={{ color: 'var(--terminal-positive)', fontSize: '0.75rem' }}>
                                Trailing SL Added
                              </span>
                            ) : (
                              <span style={{ color: 'var(--terminal-warning)', fontSize: '0.75rem' }}>
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {reconciliation.orphanPositions.length === 0 && reconciliation.missingFromPortfolio.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--terminal-text-dim)', padding: '1rem' }}>
                  Portfolio is in sync - no orphan positions detected
                </div>
              )}
            </>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem',
              color: 'var(--terminal-text-dim)',
            }}>
              <Clock size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
              <p style={{ fontSize: '0.85rem' }}>Click "Sync Now" to check for orphan positions</p>
              <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>Auto-syncs every 30 seconds when auto trading is running</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
