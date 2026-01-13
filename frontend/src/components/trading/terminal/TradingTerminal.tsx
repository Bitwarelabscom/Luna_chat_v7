'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  LayoutGrid,
  Wallet,
  Activity,
  Bot,
  History,
  FileCode2,
  MessageCircle,
  ChevronRight,
  Settings,
  ListOrdered,
  Zap,
} from 'lucide-react';
import { tradingApi, type TradingSettings, type Portfolio, type PriceData, type TradeRecord, type BotConfig } from '@/lib/api';
import { useTradingWebSocket, type PriceUpdate } from '@/hooks/useTradingWebSocket';

// Tab components - will be created
import OverviewTab from './OverviewTab';
import PortfolioTab from './PortfolioTab';
import SignalsTab from './SignalsTab';
import AlgorithmsTab from './AlgorithmsTab';
import ExecutionsTab from './ExecutionsTab';
import RulesTab from './RulesTab';
import TerminalChat from './TerminalChat';
import ActiveTab from '../ActiveTab';
import AutoTab from './AutoTab';

type TabType = 'overview' | 'portfolio' | 'orders' | 'signals' | 'algorithms' | 'executions' | 'rules' | 'auto';

interface TradingTerminalProps {
  onClose: () => void;
  userId?: string;
}

export default function TradingTerminal({ onClose, userId }: TradingTerminalProps) {
  // State
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatExpanded, setChatExpanded] = useState(true);

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

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const settingsData = await tradingApi.getSettings();
      setSettings(settingsData);

      const pricesData = await tradingApi.getPrices();
      setPrices(pricesData);

      if (settingsData.exchangeConnected || settingsData.binanceConnected) {
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

  // Calculate stats
  const stats = useMemo(() => {
    const nav = portfolio?.totalValueUsdt || 0;
    const pnl = portfolio?.dailyPnl || 0;
    const pnlPercent = portfolio?.dailyPnlPct || 0;

    return {
      nav: nav.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
      pnl: pnl >= 0 ? `+$${pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `-$${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      pnlPercent: pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`,
      pnlPositive: pnl >= 0,
    };
  }, [portfolio]);

  // Top movers for ticker
  const topMovers = useMemo(() => {
    return [...prices]
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 20);
  }, [prices]);

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={14} /> },
    { id: 'portfolio', label: 'Portfolio', icon: <Wallet size={14} /> },
    { id: 'orders', label: 'Orders', icon: <ListOrdered size={14} /> },
    { id: 'signals', label: 'Signals', icon: <Activity size={14} /> },
    { id: 'algorithms', label: 'Algorithms', icon: <Bot size={14} /> },
    { id: 'auto', label: 'Auto', icon: <Zap size={14} /> },
    { id: 'executions', label: 'Executions', icon: <History size={14} /> },
    { id: 'rules', label: 'Rules', icon: <FileCode2 size={14} /> },
  ];

  const isConnected = settings?.exchangeConnected || settings?.binanceConnected;

  // Handle keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
      case 'portfolio':
        return (
          <PortfolioTab
            portfolio={portfolio}
            prices={prices}
            loading={loading}
          />
        );
      case 'orders':
        return <ActiveTab />;
      case 'signals':
        return <SignalsTab prices={prices} />;
      case 'algorithms':
        return (
          <AlgorithmsTab
            bots={bots}
            onRefresh={loadData}
          />
        );
      case 'executions':
        return <ExecutionsTab trades={trades} loading={loading} />;
      case 'rules':
        return <RulesTab />;
      case 'auto':
        return <AutoTab />;
      default:
        return null;
    }
  };

  return (
    <div className="trading-terminal">
      {/* Header */}
      <header className="terminal-header">
        <div className="terminal-logo">
          <span style={{ color: 'var(--terminal-accent)' }}>LUNA</span>
          <span style={{ color: 'var(--terminal-text-muted)' }}>TERMINAL</span>
        </div>

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

          <div className="terminal-status terminal-status-live" style={{ marginLeft: '1rem' }}>
            <span className="terminal-status-dot" />
            <span style={{ color: wsConnected ? 'var(--terminal-positive)' : 'var(--terminal-negative)' }}>
              {wsConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          <span style={{ fontSize: '10px', color: 'var(--terminal-text-muted)', marginLeft: '0.5rem' }}>
            BUILD_04JAN_V1
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={onClose}
            className="terminal-btn terminal-btn-secondary"
            title="Close Terminal (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav className="terminal-nav">
        {tabs.map(tab => (
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

      {/* Main Content + Chat Sidebar */}
      <div className="terminal-content">
        <main className="terminal-main">
          {!isConnected && !loading ? (
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
            </div>
          ) : (
            renderTabContent()
          )}
        </main>

        {/* Chat Sidebar */}
        <aside className={`terminal-chat ${!chatExpanded ? 'terminal-chat-collapsed' : ''}`}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: chatExpanded ? 'space-between' : 'center',
              padding: '0.75rem',
              borderBottom: '1px solid var(--terminal-border)',
              cursor: 'pointer',
            }}
            onClick={() => setChatExpanded(!chatExpanded)}
          >
            {chatExpanded && (
              <span style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--terminal-text)',
              }}>
                Luna AI
              </span>
            )}
            {chatExpanded ? <ChevronRight size={16} /> : <MessageCircle size={16} />}
          </div>

          {chatExpanded && (
            <TerminalChat
              userId={userId}
              onTradeExecuted={loadData}
              currentTab={activeTab}
            />
          )}
        </aside>
      </div>

      {/* Bottom Ticker */}
      <div className="terminal-ticker">
        {topMovers.map(price => (
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
              style={{
                color: price.change24h >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
              }}
            >
              {price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
