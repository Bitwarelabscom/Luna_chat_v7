'use client';

import React, { useState, useEffect } from 'react';
import { X, Key, Shield, AlertTriangle, Check, MessageCircle, ExternalLink, Copy, FileText, RefreshCw, Zap } from 'lucide-react';
import { tradingApi, triggersApi, type TradingSettings, type TelegramStatus, type TelegramLinkCode, type PaperPortfolio, type AdvancedSignalSettings, type ExchangeType } from '@/lib/api';

interface TradingSettingsModalProps {
  settings: TradingSettings | null;
  onClose: () => void;
  onConnect: (apiKey: string, apiSecret: string, exchange?: ExchangeType, marginEnabled?: boolean, leverage?: number) => Promise<void>;
  onSettingsUpdate: () => void;
}

export default function TradingSettingsModal({
  settings,
  onClose,
  onConnect,
  onSettingsUpdate,
}: TradingSettingsModalProps) {
  const [tab, setTab] = useState<'connect' | 'risk' | 'paper' | 'telegram' | 'strategy'>('connect');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Exchange selection
  const [selectedExchange, setSelectedExchange] = useState<ExchangeType>(settings?.activeExchange || 'binance');
  const [marginEnabled, setMarginEnabled] = useState(settings?.marginEnabled ?? false);
  const [leverage, setLeverage] = useState(settings?.leverage || 1);

  // Advanced signal settings (Strategy tab)
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSignalSettings | null>(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<'basic' | 'intermediate' | 'pro'>('basic');

  // Risk settings
  const [maxPositionPct, setMaxPositionPct] = useState(settings?.maxPositionPct || 10);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(settings?.dailyLossLimitPct || 5);
  const [requireStopLoss, setRequireStopLoss] = useState(settings?.requireStopLoss ?? true);
  const [defaultStopLossPct, setDefaultStopLossPct] = useState(settings?.defaultStopLossPct || 2);
  const [riskTolerance, setRiskTolerance] = useState(settings?.riskTolerance || 'moderate');
  const [allowedSymbols, setAllowedSymbols] = useState(settings?.allowedSymbols?.join(', ') || 'BTCUSDT, ETHUSDT');
  const [stopConfirmationThreshold, setStopConfirmationThreshold] = useState(settings?.stopConfirmationThresholdUsd || 0);

  // Paper trading settings
  const [paperMode, setPaperMode] = useState(settings?.paperMode ?? false);
  const [paperBalanceUsdc, setPaperBalanceUsdc] = useState(settings?.paperBalanceUsdc || 10000);
  const [paperPortfolio, setPaperPortfolio] = useState<PaperPortfolio | null>(null);
  const [paperLoading, setPaperLoading] = useState(false);

  // Trading Telegram
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<TelegramLinkCode | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

  useEffect(() => {
    if (tab === 'telegram') {
      loadTelegramStatus();
    }
    if (tab === 'paper' && paperMode) {
      loadPaperPortfolio();
    }
    if (tab === 'strategy') {
      loadAdvancedSettings();
    }
  }, [tab, paperMode]);

  const loadAdvancedSettings = async () => {
    try {
      const settings = await tradingApi.getAdvancedSettings();
      setAdvancedSettings(settings);
      setSelectedPreset(settings.featurePreset);
    } catch (err) {
      console.error('Failed to load advanced settings:', err);
    }
  };

  const handleApplyPreset = async (preset: 'basic' | 'intermediate' | 'pro') => {
    setAdvancedLoading(true);
    setError(null);
    try {
      const settings = await tradingApi.applyFeaturePreset(preset);
      setAdvancedSettings(settings);
      setSelectedPreset(preset);
      setSuccess(`Applied "${preset}" strategy preset`);
      onSettingsUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply preset');
    } finally {
      setAdvancedLoading(false);
    }
  };

  const handleSaveAdvancedSettings = async () => {
    if (!advancedSettings) return;
    setAdvancedLoading(true);
    setError(null);
    try {
      const updated = await tradingApi.updateAdvancedSettings(advancedSettings);
      setAdvancedSettings(updated);
      setSuccess('Advanced settings saved');
      onSettingsUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setAdvancedLoading(false);
    }
  };

  const loadTelegramStatus = async () => {
    try {
      const status = await triggersApi.getTradingTelegramStatus();
      setTelegramStatus(status);
    } catch (err) {
      console.error('Failed to load trading telegram status:', err);
    }
  };

  const handleGenerateLinkCode = async () => {
    setTelegramLoading(true);
    setError(null);
    try {
      const code = await triggersApi.generateTradingTelegramLinkCode();
      setTelegramLinkCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate link code');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    setTelegramLoading(true);
    setError(null);
    try {
      await triggersApi.unlinkTradingTelegram();
      setTelegramStatus(prev => prev ? { ...prev, connection: null } : null);
      setSuccess('Trading Telegram unlinked');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleTestTelegram = async () => {
    setTelegramLoading(true);
    setError(null);
    try {
      await triggersApi.sendTradingTelegramTest();
      setSuccess('Test message sent!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setTelegramLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
  };

  // Paper trading functions
  const loadPaperPortfolio = async () => {
    try {
      const portfolio = await tradingApi.getPaperPortfolio();
      setPaperPortfolio(portfolio);
    } catch (err) {
      console.error('Failed to load paper portfolio:', err);
    }
  };

  const handleSavePaperSettings = async () => {
    setPaperLoading(true);
    setError(null);
    try {
      await tradingApi.updateSettings({
        paperMode,
        paperBalanceUsdc,
      });
      setSuccess(paperMode ? 'Paper trading enabled!' : 'Live trading enabled!');
      onSettingsUpdate();
      if (paperMode) {
        await loadPaperPortfolio();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setPaperLoading(false);
    }
  };

  const handleResetPaperPortfolio = async () => {
    if (!confirm('Reset paper portfolio to starting balance? All paper holdings will be cleared.')) {
      return;
    }
    setPaperLoading(true);
    setError(null);
    try {
      const result = await tradingApi.resetPaperPortfolio();
      setPaperPortfolio(result.portfolio);
      setSuccess('Paper portfolio reset successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset portfolio');
    } finally {
      setPaperLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError('Please enter both API key and API secret');
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      await onConnect(
        apiKey.trim(),
        apiSecret.trim(),
        selectedExchange,
        selectedExchange === 'crypto_com' ? marginEnabled : false,
        selectedExchange === 'crypto_com' ? leverage : 1
      );
      const exchangeName = selectedExchange === 'binance' ? 'Binance' : 'Crypto.com';
      setSuccess(`Successfully connected to ${exchangeName}!`);
      setApiKey('');
      setApiSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await tradingApi.disconnect();
      onSettingsUpdate();
      setSuccess('Disconnected from Binance');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  const handleSaveRiskSettings = async () => {
    try {
      await tradingApi.updateSettings({
        maxPositionPct,
        dailyLossLimitPct,
        requireStopLoss,
        defaultStopLossPct,
        riskTolerance: riskTolerance as 'conservative' | 'moderate' | 'aggressive',
        allowedSymbols: allowedSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
        stopConfirmationThresholdUsd: stopConfirmationThreshold,
      });
      setSuccess('Settings saved successfully!');
      onSettingsUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#111827',
        border: '1px solid #2a3545',
        borderRadius: '12px',
        width: '500px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #2a3545',
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fff' }}>Trading Settings</h2>
          <button onClick={onClose} style={{
            background: 'none',
            border: 'none',
            color: '#607080',
            cursor: 'pointer',
            padding: '4px',
          }}>
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #2a3545',
          padding: '0 20px',
        }}>
          {[
            { id: 'connect', label: 'Connection', icon: Key },
            { id: 'paper', label: 'Paper Mode', icon: FileText },
            { id: 'risk', label: 'Risk', icon: Shield },
            { id: 'strategy', label: 'Strategy', icon: Zap },
            { id: 'telegram', label: 'Telegram', icon: MessageCircle },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as 'connect' | 'risk' | 'paper' | 'telegram' | 'strategy')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '12px 16px',
                background: 'none',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid #00ff9f' : '2px solid transparent',
                color: tab === t.id ? '#00ff9f' : '#8892a0',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              <t.icon style={{ width: 14, height: 14 }} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Messages */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#ef4444',
              fontSize: '13px',
            }}>
              <AlertTriangle style={{ width: 16, height: 16 }} />
              {error}
            </div>
          )}

          {success && (
            <div style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid #10b981',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#10b981',
              fontSize: '13px',
            }}>
              <Check style={{ width: 16, height: 16 }} />
              {success}
            </div>
          )}

          {tab === 'connect' && (
            <div>
              {settings?.exchangeConnected || settings?.binanceConnected ? (
                <div>
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid #10b981',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
                      <span style={{ color: '#10b981', fontSize: '14px', fontWeight: 500 }}>
                        Connected to {settings?.activeExchange === 'crypto_com' ? 'Crypto.com' : 'Binance'}
                      </span>
                    </div>
                    <p style={{ color: '#8892a0', fontSize: '12px', margin: 0 }}>
                      Your account is connected and ready for trading.
                      {settings?.activeExchange === 'crypto_com' && settings?.marginEnabled && (
                        <> Margin trading enabled ({settings.leverage}x leverage).</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'transparent',
                      border: '1px solid #ef4444',
                      borderRadius: '8px',
                      color: '#ef4444',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect Account
                  </button>
                </div>
              ) : (
                <div>
                  {/* Exchange Selector */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                      Exchange
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setSelectedExchange('binance')}
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: selectedExchange === 'binance' ? 'rgba(243, 186, 47, 0.15)' : '#0a0f18',
                          border: selectedExchange === 'binance' ? '2px solid #f3ba2f' : '1px solid #2a3545',
                          borderRadius: '8px',
                          color: selectedExchange === 'binance' ? '#f3ba2f' : '#8892a0',
                          fontSize: '14px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Binance
                      </button>
                      <button
                        onClick={() => setSelectedExchange('crypto_com')}
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: selectedExchange === 'crypto_com' ? 'rgba(37, 99, 235, 0.15)' : '#0a0f18',
                          border: selectedExchange === 'crypto_com' ? '2px solid #2563eb' : '1px solid #2a3545',
                          borderRadius: '8px',
                          color: selectedExchange === 'crypto_com' ? '#2563eb' : '#8892a0',
                          fontSize: '14px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Crypto.com
                      </button>
                    </div>
                  </div>

                  {/* Margin Settings (Crypto.com only) */}
                  {selectedExchange === 'crypto_com' && (
                    <div style={{
                      background: '#0a0f18',
                      border: '1px solid #2a3545',
                      borderRadius: '8px',
                      padding: '16px',
                      marginBottom: '16px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <label style={{ color: '#c0c8d0', fontSize: '13px' }}>
                          Enable Margin Trading
                        </label>
                        <button
                          onClick={() => setMarginEnabled(!marginEnabled)}
                          style={{
                            width: '44px',
                            height: '24px',
                            borderRadius: '12px',
                            background: marginEnabled ? '#10b981' : '#2a3545',
                            border: 'none',
                            cursor: 'pointer',
                            position: 'relative',
                            transition: 'background 0.2s',
                          }}
                        >
                          <div style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            background: '#fff',
                            position: 'absolute',
                            top: '3px',
                            left: marginEnabled ? '23px' : '3px',
                            transition: 'left 0.2s',
                          }} />
                        </button>
                      </div>
                      {marginEnabled && (
                        <div>
                          <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                            Leverage: {leverage}x
                          </label>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={leverage}
                            onChange={(e) => setLeverage(parseInt(e.target.value))}
                            style={{ width: '100%' }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#607080', marginTop: '4px' }}>
                            <span>1x</span>
                            <span>5x</span>
                            <span>10x</span>
                          </div>
                          <p style={{ color: '#f59e0b', fontSize: '11px', marginTop: '8px' }}>
                            Higher leverage increases both potential profits and losses.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <p style={{ color: '#8892a0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
                    Connect your {selectedExchange === 'binance' ? 'Binance' : 'Crypto.com'} account using API keys.
                    {selectedExchange === 'binance' && ' Only spot trading permissions are required.'}
                    {selectedExchange === 'crypto_com' && marginEnabled && ' Margin trading permissions required.'}
                    <strong style={{ color: '#ef4444' }}> Do not enable withdrawal permissions.</strong>
                  </p>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                      API Key
                    </label>
                    <input
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={`Enter your ${selectedExchange === 'binance' ? 'Binance' : 'Crypto.com'} API key`}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: '#0a0f18',
                        border: '1px solid #2a3545',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '13px',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                      API Secret
                    </label>
                    <input
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder={`Enter your ${selectedExchange === 'binance' ? 'Binance' : 'Crypto.com'} API secret`}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: '#0a0f18',
                        border: '1px solid #2a3545',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '13px',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: connecting ? '#2a3545' : '#00ff9f',
                      border: 'none',
                      borderRadius: '8px',
                      color: connecting ? '#607080' : '#000',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: connecting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {connecting ? 'Connecting...' : 'Connect Account'}
                  </button>

                  <p style={{ color: '#607080', fontSize: '11px', marginTop: '12px', textAlign: 'center' }}>
                    Your API keys are encrypted and stored securely.
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === 'paper' && (
            <div>
              <p style={{ color: '#8892a0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
                Paper trading uses real-time prices from Binance but executes simulated trades.
                Perfect for testing strategies without risking real money.
              </p>

              {/* Paper/Live Toggle */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '8px' }}>
                  Trading Mode
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setPaperMode(false)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: !paperMode ? 'rgba(239, 68, 68, 0.15)' : '#0a0f18',
                      border: !paperMode ? '2px solid #ef4444' : '1px solid #2a3545',
                      borderRadius: '8px',
                      color: !paperMode ? '#ef4444' : '#8892a0',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    LIVE
                  </button>
                  <button
                    onClick={() => setPaperMode(true)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: paperMode ? 'rgba(16, 185, 129, 0.15)' : '#0a0f18',
                      border: paperMode ? '2px solid #10b981' : '1px solid #2a3545',
                      borderRadius: '8px',
                      color: paperMode ? '#10b981' : '#8892a0',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    PAPER
                  </button>
                </div>
              </div>

              {/* Paper Balance */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                  Starting Paper Balance (USDC)
                </label>
                <input
                  type="number"
                  min="100"
                  max="1000000"
                  step="100"
                  value={paperBalanceUsdc}
                  onChange={(e) => setPaperBalanceUsdc(parseFloat(e.target.value) || 10000)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
                <p style={{ color: '#607080', fontSize: '11px', marginTop: '4px' }}>
                  This is the USDC balance you start with in paper mode (100 - 1,000,000)
                </p>
              </div>

              {/* Current Paper Portfolio */}
              {paperMode && paperPortfolio && (
                <div style={{
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ color: '#8892a0', fontSize: '12px' }}>Current Paper Portfolio</span>
                    <button
                      onClick={loadPaperPortfolio}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#607080',
                        cursor: 'pointer',
                        padding: '2px',
                      }}
                    >
                      <RefreshCw style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: '#00ff9f', marginBottom: '8px' }}>
                    ${paperPortfolio.totalValueUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <span style={{ color: '#8892a0' }}>
                      Available: <span style={{ color: '#fff' }}>${paperPortfolio.availableUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </span>
                    <span style={{ color: paperPortfolio.dailyPnl >= 0 ? '#10b981' : '#ef4444' }}>
                      Daily P&L: {paperPortfolio.dailyPnl >= 0 ? '+' : ''}${paperPortfolio.dailyPnl.toFixed(2)} ({paperPortfolio.dailyPnlPct >= 0 ? '+' : ''}{paperPortfolio.dailyPnlPct.toFixed(2)}%)
                    </span>
                  </div>
                  {paperPortfolio.holdings.length > 0 && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #2a3545' }}>
                      <div style={{ color: '#607080', fontSize: '11px', marginBottom: '8px' }}>Holdings:</div>
                      {paperPortfolio.holdings.slice(0, 5).map((h) => (
                        <div key={h.asset} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                          <span style={{ color: '#c0c8d0' }}>{h.asset}</span>
                          <span style={{ color: '#8892a0' }}>{h.amount.toFixed(4)} (${h.valueUsdc.toFixed(2)})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleSavePaperSettings}
                  disabled={paperLoading}
                  style={{
                    flex: 2,
                    padding: '12px',
                    background: paperLoading ? '#2a3545' : '#00ff9f',
                    border: 'none',
                    borderRadius: '8px',
                    color: paperLoading ? '#607080' : '#000',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: paperLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {paperLoading ? 'Saving...' : 'Save Settings'}
                </button>
                {paperMode && (
                  <button
                    onClick={handleResetPaperPortfolio}
                    disabled={paperLoading}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: 'transparent',
                      border: '1px solid #f59e0b',
                      borderRadius: '8px',
                      color: '#f59e0b',
                      fontSize: '12px',
                      cursor: paperLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Reset Portfolio
                  </button>
                )}
              </div>

              {!paperMode && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid #ef4444',
                  borderRadius: '8px',
                  padding: '12px',
                  marginTop: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <AlertTriangle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
                  <span style={{ color: '#ef4444', fontSize: '12px' }}>
                    Live mode executes real trades on Binance. Make sure your API keys are connected.
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === 'risk' && (
            <div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                  Risk Tolerance
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['conservative', 'moderate', 'aggressive'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setRiskTolerance(level)}
                      style={{
                        flex: 1,
                        padding: '10px',
                        background: riskTolerance === level ? '#00ff9f20' : '#0a0f18',
                        border: riskTolerance === level ? '1px solid #00ff9f' : '1px solid #2a3545',
                        borderRadius: '6px',
                        color: riskTolerance === level ? '#00ff9f' : '#8892a0',
                        fontSize: '12px',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                  Max Position Size: {maxPositionPct}% of portfolio
                </label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={maxPositionPct}
                  onChange={(e) => setMaxPositionPct(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                  Daily Loss Limit: {dailyLossLimitPct}% of portfolio
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={dailyLossLimitPct}
                  onChange={(e) => setDailyLossLimitPct(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#c0c8d0',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={requireStopLoss}
                    onChange={(e) => setRequireStopLoss(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                  />
                  Require stop-loss on all trades
                </label>
              </div>

              {requireStopLoss && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                    Default Stop-Loss: {defaultStopLossPct}%
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={defaultStopLossPct}
                    onChange={(e) => setDefaultStopLossPct(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                  Allowed Trading Pairs (comma-separated)
                </label>
                <input
                  type="text"
                  value={allowedSymbols}
                  onChange={(e) => setAllowedSymbols(e.target.value)}
                  placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '6px' }}>
                  Stop Trade Confirmation Threshold (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={stopConfirmationThreshold}
                  onChange={(e) => setStopConfirmationThreshold(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
                <p style={{ color: '#607080', fontSize: '11px', marginTop: '4px' }}>
                  Require confirmation before stopping trades worth more than this amount. Set to 0 to disable.
                </p>
              </div>

              <button
                onClick={handleSaveRiskSettings}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#00ff9f',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save Risk Settings
              </button>
            </div>
          )}

          {tab === 'strategy' && (
            <div>
              <p style={{ color: '#8892a0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
                Configure Trader Luna&apos;s signal detection logic. Use presets for quick setup or customize individual features.
              </p>

              {/* Preset Selector */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#c0c8d0', fontSize: '12px', marginBottom: '8px' }}>
                  Strategy Preset
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: 'basic', label: 'Basic', desc: 'Original logic' },
                    { id: 'intermediate', label: 'Intermediate', desc: 'MTF + VWAP + ATR' },
                    { id: 'pro', label: 'Pro', desc: 'All features' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handleApplyPreset(preset.id as 'basic' | 'intermediate' | 'pro')}
                      disabled={advancedLoading}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        background: selectedPreset === preset.id ? '#00ff9f20' : '#0a0f18',
                        border: selectedPreset === preset.id ? '2px solid #00ff9f' : '1px solid #2a3545',
                        borderRadius: '8px',
                        cursor: advancedLoading ? 'not-allowed' : 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{
                        color: selectedPreset === preset.id ? '#00ff9f' : '#c0c8d0',
                        fontSize: '14px',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}>
                        {preset.label}
                      </div>
                      <div style={{
                        color: '#607080',
                        fontSize: '10px',
                      }}>
                        {preset.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Feature Toggles */}
              <div style={{
                background: '#0a0f18',
                border: '1px solid #2a3545',
                borderRadius: '8px',
                padding: '16px',
              }}>
                <div style={{ color: '#c0c8d0', fontSize: '12px', marginBottom: '12px', fontWeight: 500 }}>
                  Advanced Features
                </div>

                {/* MTF Confluence */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ color: advancedSettings?.enableMtfConfluence ? '#00ff9f' : '#8892a0', fontSize: '13px' }}>
                      MTF Confluence
                    </div>
                    <div style={{ color: '#607080', fontSize: '10px' }}>
                      Confirm 5m entries with 1h trend
                    </div>
                  </div>
                  <button
                    onClick={() => advancedSettings && setAdvancedSettings({
                      ...advancedSettings,
                      enableMtfConfluence: !advancedSettings.enableMtfConfluence,
                    })}
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '12px',
                      border: 'none',
                      background: advancedSettings?.enableMtfConfluence ? '#00ff9f' : '#2a3545',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <div style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: '3px',
                      left: advancedSettings?.enableMtfConfluence ? '23px' : '3px',
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* VWAP Entry */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ color: advancedSettings?.enableVwapEntry ? '#00ff9f' : '#8892a0', fontSize: '13px' }}>
                      VWAP Entry
                    </div>
                    <div style={{ color: '#607080', fontSize: '10px' }}>
                      Only signal when reclaiming VWAP
                    </div>
                  </div>
                  <button
                    onClick={() => advancedSettings && setAdvancedSettings({
                      ...advancedSettings,
                      enableVwapEntry: !advancedSettings.enableVwapEntry,
                    })}
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '12px',
                      border: 'none',
                      background: advancedSettings?.enableVwapEntry ? '#00ff9f' : '#2a3545',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <div style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: '3px',
                      left: advancedSettings?.enableVwapEntry ? '23px' : '3px',
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* ATR Stops */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ color: advancedSettings?.enableAtrStops ? '#00ff9f' : '#8892a0', fontSize: '13px' }}>
                      ATR-Based Stops
                    </div>
                    <div style={{ color: '#607080', fontSize: '10px' }}>
                      Dynamic SL/TP based on volatility
                    </div>
                  </div>
                  <button
                    onClick={() => advancedSettings && setAdvancedSettings({
                      ...advancedSettings,
                      enableAtrStops: !advancedSettings.enableAtrStops,
                    })}
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '12px',
                      border: 'none',
                      background: advancedSettings?.enableAtrStops ? '#00ff9f' : '#2a3545',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <div style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: '3px',
                      left: advancedSettings?.enableAtrStops ? '23px' : '3px',
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* BTC Filter */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ color: advancedSettings?.enableBtcFilter ? '#00ff9f' : '#8892a0', fontSize: '13px' }}>
                      BTC Correlation Filter
                    </div>
                    <div style={{ color: '#607080', fontSize: '10px' }}>
                      Pause altcoin longs if BTC dumps
                    </div>
                  </div>
                  <button
                    onClick={() => advancedSettings && setAdvancedSettings({
                      ...advancedSettings,
                      enableBtcFilter: !advancedSettings.enableBtcFilter,
                    })}
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '12px',
                      border: 'none',
                      background: advancedSettings?.enableBtcFilter ? '#00ff9f' : '#2a3545',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <div style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: '3px',
                      left: advancedSettings?.enableBtcFilter ? '23px' : '3px',
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>

                {/* Liquidity Sweep */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ color: advancedSettings?.enableLiquiditySweep ? '#00ff9f' : '#8892a0', fontSize: '13px' }}>
                      Liquidity Sweep Detection
                    </div>
                    <div style={{ color: '#607080', fontSize: '10px' }}>
                      Detect stop-hunt patterns
                    </div>
                  </div>
                  <button
                    onClick={() => advancedSettings && setAdvancedSettings({
                      ...advancedSettings,
                      enableLiquiditySweep: !advancedSettings.enableLiquiditySweep,
                    })}
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '12px',
                      border: 'none',
                      background: advancedSettings?.enableLiquiditySweep ? '#00ff9f' : '#2a3545',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <div style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: '3px',
                      left: advancedSettings?.enableLiquiditySweep ? '23px' : '3px',
                      transition: 'left 0.2s',
                    }} />
                  </button>
                </div>
              </div>

              {/* ATR Parameters (shown when ATR is enabled) */}
              {advancedSettings?.enableAtrStops && (
                <div style={{
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '8px',
                  padding: '16px',
                  marginTop: '12px',
                }}>
                  <div style={{ color: '#c0c8d0', fontSize: '12px', marginBottom: '12px', fontWeight: 500 }}>
                    ATR Parameters
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', color: '#607080', fontSize: '10px', marginBottom: '4px' }}>
                        SL Multiplier ({advancedSettings.atrSlMultiplier}x)
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.5"
                        value={advancedSettings.atrSlMultiplier}
                        onChange={(e) => setAdvancedSettings({
                          ...advancedSettings,
                          atrSlMultiplier: parseFloat(e.target.value),
                        })}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', color: '#607080', fontSize: '10px', marginBottom: '4px' }}>
                        TP Multiplier ({advancedSettings.atrTpMultiplier}x)
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={advancedSettings.atrTpMultiplier}
                        onChange={(e) => setAdvancedSettings({
                          ...advancedSettings,
                          atrTpMultiplier: parseFloat(e.target.value),
                        })}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* BTC Filter Parameters */}
              {advancedSettings?.enableBtcFilter && (
                <div style={{
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '8px',
                  padding: '16px',
                  marginTop: '12px',
                }}>
                  <div style={{ color: '#c0c8d0', fontSize: '12px', marginBottom: '12px', fontWeight: 500 }}>
                    BTC Filter Parameters
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', color: '#607080', fontSize: '10px', marginBottom: '4px' }}>
                        Dump Threshold ({advancedSettings.btcDumpThreshold}%)
                      </label>
                      <input
                        type="range"
                        min="0.5"
                        max="5"
                        step="0.25"
                        value={advancedSettings.btcDumpThreshold}
                        onChange={(e) => setAdvancedSettings({
                          ...advancedSettings,
                          btcDumpThreshold: parseFloat(e.target.value),
                        })}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', color: '#607080', fontSize: '10px', marginBottom: '4px' }}>
                        Lookback ({advancedSettings.btcLookbackMinutes}m)
                      </label>
                      <input
                        type="range"
                        min="5"
                        max="60"
                        step="5"
                        value={advancedSettings.btcLookbackMinutes}
                        onChange={(e) => setAdvancedSettings({
                          ...advancedSettings,
                          btcLookbackMinutes: parseInt(e.target.value),
                        })}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <button
                onClick={handleSaveAdvancedSettings}
                disabled={advancedLoading}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginTop: '16px',
                  background: advancedLoading ? '#2a3545' : '#00ff9f',
                  border: 'none',
                  borderRadius: '8px',
                  color: advancedLoading ? '#607080' : '#000',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: advancedLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {advancedLoading ? 'Saving...' : 'Save Strategy Settings'}
              </button>
            </div>
          )}

          {tab === 'telegram' && (
            <div>
              {!telegramStatus?.isConfigured ? (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid #ef4444',
                  borderRadius: '8px',
                  padding: '16px',
                }}>
                  <p style={{ color: '#ef4444', fontSize: '13px', margin: 0 }}>
                    Trading Telegram bot is not configured on the server.
                  </p>
                </div>
              ) : telegramStatus?.connection ? (
                <div>
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid #10b981',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
                      <span style={{ color: '#10b981', fontSize: '14px', fontWeight: 500 }}>
                        Connected to Trading Telegram
                      </span>
                    </div>
                    <p style={{ color: '#8892a0', fontSize: '12px', margin: 0 }}>
                      {telegramStatus.connection.firstName && `Hi ${telegramStatus.connection.firstName}! `}
                      Linked {telegramStatus.connection.username ? `@${telegramStatus.connection.username}` : ''} on {new Date(telegramStatus.connection.linkedAt).toLocaleDateString()}
                    </p>
                  </div>

                  <p style={{ color: '#8892a0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
                    You can chat with Trader Luna, receive trade notifications, and confirm orders via Telegram.
                  </p>

                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button
                      onClick={handleTestTelegram}
                      disabled={telegramLoading}
                      style={{
                        flex: 1,
                        padding: '10px',
                        background: '#1e293b',
                        border: '1px solid #2a3545',
                        borderRadius: '6px',
                        color: '#c0c8d0',
                        fontSize: '12px',
                        cursor: telegramLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Send Test
                    </button>
                    <button
                      onClick={handleUnlinkTelegram}
                      disabled={telegramLoading}
                      style={{
                        flex: 1,
                        padding: '10px',
                        background: 'transparent',
                        border: '1px solid #ef4444',
                        borderRadius: '6px',
                        color: '#ef4444',
                        fontSize: '12px',
                        cursor: telegramLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ color: '#8892a0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
                    Connect Telegram to chat with Trader Luna, receive trade notifications, and confirm orders with buttons.
                  </p>

                  {telegramLinkCode ? (
                    <div>
                      <div style={{
                        background: '#0a0f18',
                        border: '1px solid #2a3545',
                        borderRadius: '8px',
                        padding: '16px',
                        marginBottom: '16px',
                        textAlign: 'center',
                      }}>
                        <p style={{ color: '#607080', fontSize: '11px', marginBottom: '8px' }}>
                          Your link code (expires in {telegramLinkCode.expiresInMinutes} min)
                        </p>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                        }}>
                          <code style={{
                            fontSize: '24px',
                            fontWeight: 'bold',
                            color: '#00ff9f',
                            letterSpacing: '2px',
                          }}>
                            {telegramLinkCode.code}
                          </code>
                          <button
                            onClick={() => copyToClipboard(telegramLinkCode.code)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#607080',
                              cursor: 'pointer',
                              padding: '4px',
                            }}
                          >
                            <Copy style={{ width: 16, height: 16 }} />
                          </button>
                        </div>
                      </div>

                      {telegramLinkCode.linkUrl && (
                        <a
                          href={telegramLinkCode.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '12px',
                            background: '#0088cc',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '13px',
                            fontWeight: 600,
                            textDecoration: 'none',
                            marginBottom: '12px',
                          }}
                        >
                          <ExternalLink style={{ width: 16, height: 16 }} />
                          Open @{telegramLinkCode.botUsername}
                        </a>
                      )}

                      <p style={{ color: '#607080', fontSize: '11px', textAlign: 'center' }}>
                        Or send <code style={{ color: '#00ff9f' }}>/start {telegramLinkCode.code}</code> to @{telegramLinkCode.botUsername}
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerateLinkCode}
                      disabled={telegramLoading}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: telegramLoading ? '#2a3545' : '#00ff9f',
                        border: 'none',
                        borderRadius: '8px',
                        color: telegramLoading ? '#607080' : '#000',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: telegramLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {telegramLoading ? 'Generating...' : 'Link Trading Telegram'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
