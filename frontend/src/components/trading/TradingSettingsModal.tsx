'use client';

import React, { useState, useEffect } from 'react';
import { X, Key, Shield, AlertTriangle, Check, MessageCircle, ExternalLink, Copy } from 'lucide-react';
import { tradingApi, triggersApi, type TradingSettings, type TelegramStatus, type TelegramLinkCode } from '@/lib/api';

interface TradingSettingsModalProps {
  settings: TradingSettings | null;
  onClose: () => void;
  onConnect: (apiKey: string, apiSecret: string) => Promise<void>;
  onSettingsUpdate: () => void;
}

export default function TradingSettingsModal({
  settings,
  onClose,
  onConnect,
  onSettingsUpdate,
}: TradingSettingsModalProps) {
  const [tab, setTab] = useState<'connect' | 'risk' | 'telegram'>('connect');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Risk settings
  const [maxPositionPct, setMaxPositionPct] = useState(settings?.maxPositionPct || 10);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(settings?.dailyLossLimitPct || 5);
  const [requireStopLoss, setRequireStopLoss] = useState(settings?.requireStopLoss ?? true);
  const [defaultStopLossPct, setDefaultStopLossPct] = useState(settings?.defaultStopLossPct || 2);
  const [riskTolerance, setRiskTolerance] = useState(settings?.riskTolerance || 'moderate');
  const [allowedSymbols, setAllowedSymbols] = useState(settings?.allowedSymbols?.join(', ') || 'BTCUSDT, ETHUSDT');

  // Trading Telegram
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<TelegramLinkCode | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

  useEffect(() => {
    if (tab === 'telegram') {
      loadTelegramStatus();
    }
  }, [tab]);

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

  const handleConnect = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError('Please enter both API key and API secret');
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      await onConnect(apiKey.trim(), apiSecret.trim());
      setSuccess('Successfully connected to Binance!');
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
            { id: 'risk', label: 'Risk', icon: Shield },
            { id: 'telegram', label: 'Telegram', icon: MessageCircle },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as 'connect' | 'risk' | 'telegram')}
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
              {settings?.binanceConnected ? (
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
                      <span style={{ color: '#10b981', fontSize: '14px', fontWeight: 500 }}>Connected to Binance</span>
                    </div>
                    <p style={{ color: '#8892a0', fontSize: '12px', margin: 0 }}>
                      Your account is connected and ready for trading.
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
                  <p style={{ color: '#8892a0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.6 }}>
                    Connect your Binance account using API keys. Only spot trading permissions are required.
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
                      placeholder="Enter your Binance API key"
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
                      placeholder="Enter your Binance API secret"
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
