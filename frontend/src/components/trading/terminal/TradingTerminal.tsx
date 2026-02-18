'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  LineChart,
  Wallet,
  Bot,
  ListFilter,
  Zap,
  MessageSquare,
  Settings,
  X,
} from 'lucide-react';
import { tradingApi, type TradingSettings, type Portfolio, type PriceData, type TradeRecord, type BotConfig } from '@/lib/api';
import { useTradingWebSocket, type PriceUpdate } from '@/hooks/useTradingWebSocket';

import OverviewTab from './OverviewTab';
import PortfolioTab from './PortfolioTab';
import AlgorithmsTab from './AlgorithmsTab';
import RulesTab from './RulesTab';
import TerminalChat from './TerminalChat';
import AutoTab from './AutoTab';
import PriceChart from '../PriceChart';

type TabType = 'overview' | 'chart' | 'portfolio' | 'bots' | 'rules' | 'auto' | 'ai';

interface TradingTerminalProps {
  onClose?: () => void;
  userId?: string;
  onOpenSettings?: () => void;
}

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
  { id: 'chart', label: 'Chart', icon: <LineChart size={14} /> },
  { id: 'portfolio', label: 'Portfolio', icon: <Wallet size={14} /> },
  { id: 'bots', label: 'Bots', icon: <Bot size={14} /> },
  { id: 'rules', label: 'Rules', icon: <ListFilter size={14} /> },
  { id: 'auto', label: 'Auto', icon: <Zap size={14} /> },
  { id: 'ai', label: 'AI', icon: <MessageSquare size={14} /> },
];

const DEFAULT_CHART_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

export default function TradingTerminal({ onClose, userId, onOpenSettings }: TradingTerminalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartSymbol, setChartSymbol] = useState('BTCUSDT');

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

      const settingsData = await tradingApi.getSettings();
      setSettings(settingsData);

      const pricesData = await tradingApi.getPrices();
      setPrices(pricesData);

      if (settingsData.exchangeConnected || settingsData.paperMode) {
        const [portfolioData, tradesData, botsData] = await Promise.all([
          tradingApi.getPortfolio(),
          tradingApi.getTrades(100),
          tradingApi.getBots(),
        ]);
        setPortfolio(portfolioData);
        setTrades(tradesData);
        setBots(botsData);
      }
    } catch (err) {
      console.error('Failed to load trading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Escape key
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Portfolio stats
  const stats = useMemo(() => {
    const nav = portfolio?.totalValueUsdt || 0;
    const pnl = portfolio?.dailyPnl || 0;
    const pnlPercent = portfolio?.dailyPnlPct || 0;
    return {
      nav: nav.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
      pnl: pnl >= 0
        ? `+$${pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        : `-$${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      pnlPercent: pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`,
      pnlPositive: pnl >= 0,
    };
  }, [portfolio]);

  // BTC price for header ticker
  const btcPrice = useMemo(() => {
    const btc = prices.find(p => p.symbol === 'BTCUSDT' || p.symbol === 'BTC_USD');
    if (!btc) return null;
    return {
      price: btc.price.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
      change: btc.change24h,
    };
  }, [prices]);

  // Ticker symbols (portfolio holdings + common pairs)
  const tickerSymbols = useMemo(() => {
    return [...prices]
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 20);
  }, [prices]);

  // Available chart symbols
  const chartSymbols = useMemo(() => {
    const holdingSymbols = (portfolio?.holdings || [])
      .map(h => h.symbol)
      .filter(s => s && !s.includes('USD'));
    const all = Array.from(new Set([...holdingSymbols, ...DEFAULT_CHART_SYMBOLS]));
    return all;
  }, [portfolio]);

  // Exchange connection status
  const connectionStatus = useMemo(() => {
    if (!settings) return { dot: '#555', label: 'Loading' };
    if (settings.paperMode) return { dot: '#f59e0b', label: settings.activeExchange ? `${settings.activeExchange.replace('_', '.')} (Paper)` : 'Paper Mode' };
    if (settings.exchangeConnected) return { dot: '#10b981', label: settings.activeExchange ? settings.activeExchange.replace('_', '.') : 'Connected' };
    return { dot: '#ef4444', label: 'Disconnected' };
  }, [settings]);

  const canUseTerminal = settings?.exchangeConnected || settings?.paperMode;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewTab
            prices={prices}
            portfolio={portfolio}
            bots={bots}
            trades={trades}
            loading={loading}
          />
        );
      case 'chart':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--terminal-text-muted)' }}>Symbol:</span>
              <select
                value={chartSymbol}
                onChange={e => setChartSymbol(e.target.value)}
                style={{
                  background: 'var(--terminal-surface)',
                  border: '1px solid var(--terminal-border)',
                  color: 'var(--terminal-text)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontFamily: 'IBM Plex Mono',
                }}
              >
                {chartSymbols.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PriceChart symbol={chartSymbol} />
            </div>
          </div>
        );
      case 'portfolio':
        return (
          <PortfolioTab
            portfolio={portfolio}
            prices={prices}
            loading={loading}
          />
        );
      case 'bots':
        return (
          <AlgorithmsTab
            bots={bots}
            onRefresh={loadData}
          />
        );
      case 'rules':
        return <RulesTab />;
      case 'auto':
        return <AutoTab />;
      case 'ai':
        return (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <TerminalChat
              userId={userId}
              onTradeExecuted={loadData}
              currentTab={activeTab}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="trading-terminal">
      {/* Header */}
      <header className="terminal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="terminal-logo">
            <span style={{ color: 'var(--terminal-accent)' }}>LUNA</span>
            <span style={{ color: 'var(--terminal-text-muted)' }}>TERMINAL</span>
          </div>

          {/* Exchange status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connectionStatus.dot,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--terminal-text-muted)', textTransform: 'capitalize' }}>
              {connectionStatus.label}
            </span>
          </div>

          {/* BTC price */}
          {btcPrice && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--terminal-text-muted)' }}>BTC</span>
              <span style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono' }}>{btcPrice.price}</span>
              <span style={{
                fontSize: '0.7rem',
                fontFamily: 'IBM Plex Mono',
                color: btcPrice.change >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
              }}>
                {btcPrice.change >= 0 ? '+' : ''}{btcPrice.change.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="terminal-stats">
          <div className="terminal-stat">
            <span className="terminal-stat-label">NAV</span>
            <span className="terminal-stat-value">{stats.nav}</span>
          </div>
          <div className="terminal-stat">
            <span className="terminal-stat-label">P&L</span>
            <span className={`terminal-stat-value ${stats.pnlPositive ? 'terminal-stat-positive' : 'terminal-stat-negative'}`}>
              {stats.pnl} ({stats.pnlPercent})
            </span>
          </div>
          <div className="terminal-status" style={{ marginLeft: '0.5rem' }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: wsConnected ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: '0.7rem',
              color: wsConnected ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
              marginLeft: '0.25rem',
            }}>
              {wsConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {onClose && (
            <button onClick={onClose} className="terminal-btn terminal-btn-secondary" title="Close Terminal (Esc)">
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Price Ticker */}
      <div className="terminal-ticker">
        {tickerSymbols.map(price => (
          <div key={price.symbol} className="terminal-ticker-item">
            <span className="terminal-ticker-symbol">
              {price.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
            </span>
            <span className="terminal-ticker-price">
              ${price.price.toLocaleString('en-US', {
                minimumFractionDigits: price.price < 1 ? 6 : 2,
                maximumFractionDigits: price.price < 1 ? 6 : 2,
              })}
            </span>
            <span
              className="terminal-ticker-change"
              style={{ color: price.change24h >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)' }}
            >
              {price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      {/* Navigation */}
      <nav className="terminal-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`terminal-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.icon}
            <span style={{ marginLeft: '0.375rem' }}>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Main Content */}
      <main className="terminal-main">
        {!canUseTerminal && !loading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--terminal-text-muted)',
          }}>
            <Settings size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
            <p style={{ marginBottom: '0.5rem' }}>No exchange connected</p>
            <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
              Connect your exchange in the trading settings to use the terminal
            </p>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="terminal-btn terminal-btn-primary"
                style={{ marginTop: '1rem' }}
              >
                Open Trading Settings
              </button>
            )}
          </div>
        ) : (
          renderTabContent()
        )}
      </main>
    </div>
  );
}
