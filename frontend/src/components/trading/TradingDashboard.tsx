'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, BarChart3, Wallet, History, Bot, Settings, AlertCircle, RefreshCw, Wifi, WifiOff, X, ExternalLink, MessageCircle, Activity, ListChecks } from 'lucide-react';
import { tradingApi, type TradingSettings, type Portfolio, type PriceData, type TradeRecord, type BotConfig } from '@/lib/api';
import type { DisplayContent } from '@/types/display';
import PriceChart from './PriceChart';
import TradingChat from './TradingChat';
import Holdings from './Holdings';
import RecentTrades from './RecentTrades';
import TradingSettingsModal from './TradingSettingsModal';
import ResearchTab from './ResearchTab';
import RulesTab from './RulesTab';
import { useTradingWebSocket, type PriceUpdate } from '@/hooks/useTradingWebSocket';

type TabType = 'chart' | 'portfolio' | 'trades' | 'bots' | 'rules' | 'research' | 'settings';

export default function TradingDashboard() {
  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDC');
  const [chatOpen, setChatOpen] = useState(false);
  const [displayContent, setDisplayContent] = useState<DisplayContent>({ type: 'chart', symbol: 'BTCUSDC' });
  const [activeTab, setActiveTab] = useState<TabType>('chart');

  // WebSocket for real-time price updates
  const { connected: wsConnected } = useTradingWebSocket({
    onPriceUpdate: useCallback((updates: PriceUpdate[]) => {
      setPrices(prev => {
        const priceMap = new Map(prev.map(p => [p.symbol, p]));
        for (const update of updates) {
          priceMap.set(update.symbol, {
            symbol: update.symbol,
            price: update.price,
            change24h: update.change24h,
            high24h: update.high24h,
            low24h: update.low24h,
            volume24h: update.volume,
          });
        }
        return Array.from(priceMap.values());
      });
    }, []),
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const settingsData = await tradingApi.getSettings();
      setSettings(settingsData);

      const pricesData = await tradingApi.getPrices();
      setPrices(pricesData);

      if (settingsData.binanceConnected) {
        const [portfolioData, tradesData, botsData] = await Promise.all([
          tradingApi.getPortfolio(),
          tradingApi.getTrades(50),
          tradingApi.getBots(),
        ]);
        setPortfolio(portfolioData);
        setTrades(tradesData);
        setBots(botsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trading data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (wsConnected) return;
    const interval = setInterval(async () => {
      try {
        const pricesData = await tradingApi.getPrices();
        setPrices(pricesData);
      } catch (err) {
        console.error('Failed to refresh prices', err);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  const handleConnect = async (apiKey: string, apiSecret: string) => {
    try {
      const result = await tradingApi.connect(apiKey, apiSecret);
      if (result.success) {
        await loadData();
        setShowSettings(false);
      } else {
        setError(result.error || 'Failed to connect');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const handleDisplayChange = useCallback((display: DisplayContent) => {
    setDisplayContent(display);
    if (display.type === 'chart') {
      setSelectedSymbol(display.symbol);
      setActiveTab('chart');
    }
  }, []);

  const runningBots = bots.filter(b => b.status === 'running').length;

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'chart', label: 'Chart', icon: <BarChart3 style={{ width: 16, height: 16 }} /> },
    { id: 'portfolio', label: 'Portfolio', icon: <Wallet style={{ width: 16, height: 16 }} /> },
    { id: 'trades', label: 'Trades', icon: <History style={{ width: 16, height: 16 }} /> },
    { id: 'bots', label: 'Bots', icon: <Bot style={{ width: 16, height: 16 }} /> },
    { id: 'rules', label: 'Rules', icon: <ListChecks style={{ width: 16, height: 16 }} /> },
    { id: 'research', label: 'Research', icon: <Activity style={{ width: 16, height: 16 }} /> },
    { id: 'settings', label: 'Settings', icon: <Settings style={{ width: 16, height: 16 }} /> },
  ];

  // Connect prompt if not connected
  if (!loading && settings && !settings.binanceConnected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0f18' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            background: '#111827',
            border: '1px solid #2a3545',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            maxWidth: '500px',
          }}>
            <TrendingUp style={{ width: 64, height: 64, color: '#00ff9f', marginBottom: 20 }} />
            <h2 style={{ color: '#fff', fontSize: '24px', marginBottom: '12px' }}>Connect Your Binance Account</h2>
            <p style={{ color: '#8892a0', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>
              Connect your Binance account to start trading with Trader Luna.
            </p>
            <button
              onClick={() => setShowSettings(true)}
              style={{
                background: '#00ff9f',
                color: '#000',
                border: 'none',
                padding: '12px 32px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Connect Binance
            </button>
          </div>
        </div>
        {showSettings && (
          <TradingSettingsModal
            settings={settings}
            onClose={() => setShowSettings(false)}
            onConnect={handleConnect}
            onSettingsUpdate={loadData}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0f18' }}>
      {/* Top Bar: Stats + Connection */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #1a2535',
        background: '#0d1420',
      }}>
        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#607080', textTransform: 'uppercase' }}>Portfolio</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: 600, color: '#fff' }}>
              ${portfolio?.totalValueUsdt.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#607080', textTransform: 'uppercase' }}>24h P&L</span>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '14px',
              fontWeight: 600,
              color: (portfolio?.dailyPnl || 0) >= 0 ? '#10b981' : '#ef4444',
            }}>
              {(portfolio?.dailyPnl || 0) >= 0 ? '+' : ''}${portfolio?.dailyPnl?.toFixed(2) || '0.00'}
              {portfolio?.dailyPnlPct ? ` (${portfolio.dailyPnlPct.toFixed(2)}%)` : ''}
            </span>
          </div>
          {runningBots > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Bot style={{ width: 14, height: 14, color: '#00ff9f' }} />
              <span style={{ fontSize: '12px', color: '#00ff9f' }}>{runningBots} bot{runningBots > 1 ? 's' : ''} running</span>
            </div>
          )}
        </div>

        {/* Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {wsConnected ? (
            <Wifi style={{ width: 14, height: 14, color: '#10b981' }} />
          ) : (
            <WifiOff style={{ width: 14, height: 14, color: '#ef4444' }} />
          )}
          <span style={{
            fontSize: '10px',
            fontWeight: 500,
            color: wsConnected ? '#10b981' : '#ef4444',
            textTransform: 'uppercase',
          }}>
            {wsConnected ? 'Live' : 'Polling'}
          </span>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 16px',
        borderBottom: '1px solid #1a2535',
        background: '#0a0f18',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              background: activeTab === tab.id ? '#1a2535' : 'transparent',
              border: activeTab === tab.id ? '1px solid #2a3545' : '1px solid transparent',
              borderRadius: '6px',
              color: activeTab === tab.id ? '#00ff9f' : '#8892a0',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '16px' }}>
        {/* Chart Tab */}
        {activeTab === 'chart' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {displayContent.type === 'chart' && (
              <div style={{ flex: 1, minHeight: 0 }}>
                <PriceChart symbol={displayContent.symbol} />
              </div>
            )}

            {displayContent.type === 'youtube' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#111827', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #2a3545',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: '14px', color: '#fff', fontWeight: 500 }}>
                    {displayContent.title || 'YouTube Video'}
                  </span>
                  <button
                    onClick={() => setDisplayContent({ type: 'chart', symbol: selectedSymbol })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      background: 'rgba(0, 255, 159, 0.1)',
                      border: '1px solid rgba(0, 255, 159, 0.3)',
                      borderRadius: '6px',
                      color: '#00ff9f',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} />
                    Back to Chart
                  </button>
                </div>
                <iframe
                  src={`https://www.youtube.com/embed/${displayContent.videoId}`}
                  style={{ flex: 1, width: '100%', border: 'none' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {displayContent.type === 'website' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#111827', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #2a3545',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', color: '#fff', fontWeight: 500 }}>
                      {displayContent.title || displayContent.url}
                    </span>
                    <a href={displayContent.url} target="_blank" rel="noopener noreferrer" style={{ color: '#8892a0' }}>
                      <ExternalLink style={{ width: 14, height: 14 }} />
                    </a>
                  </div>
                  <button
                    onClick={() => setDisplayContent({ type: 'chart', symbol: selectedSymbol })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      background: 'rgba(0, 255, 159, 0.1)',
                      border: '1px solid rgba(0, 255, 159, 0.3)',
                      borderRadius: '6px',
                      color: '#00ff9f',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} />
                    Back to Chart
                  </button>
                </div>
                <iframe
                  src={displayContent.url}
                  style={{ flex: 1, width: '100%', border: 'none' }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              </div>
            )}
          </div>
        )}

        {/* Portfolio Tab */}
        {activeTab === 'portfolio' && (
          <div style={{ height: '100%', background: '#111827', borderRadius: '8px', overflow: 'hidden' }}>
            <Holdings
              holdings={portfolio?.holdings || []}
              onSelectSymbol={(symbol) => {
                setSelectedSymbol(symbol);
                setDisplayContent({ type: 'chart', symbol });
                setActiveTab('chart');
              }}
            />
          </div>
        )}

        {/* Trades Tab */}
        {activeTab === 'trades' && (
          <div style={{ height: '100%', background: '#111827', borderRadius: '8px', overflow: 'hidden' }}>
            <RecentTrades trades={trades} />
          </div>
        )}

        {/* Bots Tab */}
        {activeTab === 'bots' && (
          <div style={{ height: '100%', background: '#111827', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #2a3545' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: '#fff', fontWeight: 500 }}>Trading Bots</h3>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
              {bots.length === 0 ? (
                <div style={{ textAlign: 'center' }}>
                  <Bot style={{ width: 48, height: 48, color: '#2a3545', marginBottom: '16px' }} />
                  <p style={{ color: '#8892a0', fontSize: '14px', marginBottom: '8px' }}>No bots configured</p>
                  <p style={{ color: '#607080', fontSize: '12px' }}>Ask Trader Luna to help you set up a trading bot</p>
                </div>
              ) : (
                <div style={{ width: '100%' }}>
                  {bots.map(bot => (
                    <div key={bot.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderBottom: '1px solid #2a3545',
                    }}>
                      <div>
                        <div style={{ fontSize: '14px', color: '#fff', fontWeight: 500 }}>{bot.name}</div>
                        <div style={{ fontSize: '12px', color: '#8892a0' }}>{bot.symbol} - {bot.type}</div>
                      </div>
                      <div style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        background: bot.status === 'running' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                        color: bot.status === 'running' ? '#10b981' : '#6b7280',
                      }}>
                        {bot.status}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <div style={{ height: '100%', background: '#111827', borderRadius: '8px', overflow: 'hidden' }}>
            <RulesTab />
          </div>
        )}

        {/* Research Tab */}
        {activeTab === 'research' && (
          <div style={{ height: '100%' }}>
            <ResearchTab
              onViewChart={(symbol) => {
                setSelectedSymbol(symbol);
                setDisplayContent({ type: 'chart', symbol });
                setActiveTab('chart');
              }}
            />
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div style={{ height: '100%', background: '#111827', borderRadius: '8px', overflow: 'auto' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #2a3545' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: '#fff', fontWeight: 500 }}>Trading Settings</h3>
            </div>
            <div style={{ padding: '20px' }}>
              {/* Connection Status */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', color: '#8892a0', marginBottom: '8px', textTransform: 'uppercase' }}>Binance Connection</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: settings?.binanceConnected ? '#10b981' : '#ef4444',
                  }} />
                  <span style={{ color: '#fff', fontSize: '14px' }}>
                    {settings?.binanceConnected ? 'Connected' : 'Not Connected'}
                  </span>
                  <button
                    onClick={() => setShowSettings(true)}
                    style={{
                      padding: '6px 12px',
                      background: '#2a3545',
                      border: '1px solid #3a4555',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {settings?.binanceConnected ? 'Manage' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Risk Settings */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', color: '#8892a0', marginBottom: '12px', textTransform: 'uppercase' }}>Risk Settings</div>
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#0a0f18', borderRadius: '6px' }}>
                    <span style={{ color: '#8892a0', fontSize: '13px' }}>Max Position Size</span>
                    <span style={{ color: '#fff', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace' }}>{settings?.maxPositionPct || 10}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#0a0f18', borderRadius: '6px' }}>
                    <span style={{ color: '#8892a0', fontSize: '13px' }}>Daily Loss Limit</span>
                    <span style={{ color: '#fff', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace' }}>{settings?.dailyLossLimitPct || 5}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#0a0f18', borderRadius: '6px' }}>
                    <span style={{ color: '#8892a0', fontSize: '13px' }}>Default Stop Loss</span>
                    <span style={{ color: '#fff', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace' }}>{settings?.defaultStopLossPct || 2}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: '#0a0f18', borderRadius: '6px' }}>
                    <span style={{ color: '#8892a0', fontSize: '13px' }}>Risk Tolerance</span>
                    <span style={{ color: '#00ff9f', fontSize: '13px', textTransform: 'capitalize' }}>{settings?.riskTolerance || 'moderate'}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowSettings(true)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#00ff9f',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Edit Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Chat Bubble */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: chatOpen ? '#2a3545' : 'linear-gradient(135deg, #00ff9f 0%, #00cc7f 100%)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0, 255, 159, 0.3)',
          zIndex: 1000,
          transition: 'all 0.3s ease',
        }}
      >
        {chatOpen ? (
          <X style={{ width: 24, height: 24, color: '#fff' }} />
        ) : (
          <MessageCircle style={{ width: 24, height: 24, color: '#000' }} />
        )}
      </button>

      {/* Chat Popup */}
      {chatOpen && (
        <div style={{
          position: 'fixed',
          bottom: '96px',
          right: '24px',
          width: '400px',
          height: '500px',
          background: '#111827',
          border: '1px solid #2a3545',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.3s ease',
        }}>
          <TradingChat
            portfolio={portfolio}
            prices={prices}
            isExpanded={false}
            onToggleExpand={() => setChatOpen(false)}
            onDisplayChange={handleDisplayChange}
          />
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#ef4444',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 1000,
        }}>
          <AlertCircle style={{ width: 16, height: 16 }} />
          {error}
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '8px' }}
          >
            x
          </button>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(10, 15, 24, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}>
          <RefreshCw style={{ width: 32, height: 32, color: '#00ff9f', animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <TradingSettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onConnect={handleConnect}
          onSettingsUpdate={loadData}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
