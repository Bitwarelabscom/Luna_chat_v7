'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart3, Clock } from 'lucide-react';
import { tradingApi, type Portfolio, type TradingStats, type ActiveTradesResponse } from '@/lib/api';
import { useTradingWebSocket } from '@/hooks/useTradingWebSocket';

interface QuickStatProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ReactNode;
}

function QuickStat({ label, value, subValue, trend, icon }: QuickStatProps) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[var(--terminal-text-muted)] text-xs uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[var(--terminal-text-dim)]">{icon}</span>
      </div>
      <div className="text-xl font-semibold text-[var(--terminal-text)]">{value}</div>
      {subValue && (
        <div className={`text-sm mt-1 ${
          trend === 'up' ? 'pnl-positive' :
          trend === 'down' ? 'pnl-negative' :
          'text-[var(--terminal-text-muted)]'
        }`}>
          {trend === 'up' && <TrendingUp size={12} className="inline mr-1" />}
          {trend === 'down' && <TrendingDown size={12} className="inline mr-1" />}
          {subValue}
        </div>
      )}
    </div>
  );
}

interface ActivePositionProps {
  symbol: string;
  side: 'buy' | 'sell';
  pnl: number;
  pnlPercent: number;
  currentPrice?: number;
}

function ActivePosition({ symbol, side, pnl, pnlPercent, currentPrice }: ActivePositionProps) {
  const isProfit = pnl >= 0;
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--terminal-border)] last:border-0">
      <div className="flex items-center gap-3">
        <div className={`px-2 py-0.5 rounded text-xs font-medium ${
          side === 'buy'
            ? 'bg-[rgba(0,214,143,0.15)] text-[var(--terminal-positive)]'
            : 'bg-[rgba(255,107,107,0.15)] text-[var(--terminal-negative)]'
        }`}>
          {side.toUpperCase()}
        </div>
        <div>
          <div className="font-medium text-[var(--terminal-text)]">{symbol}</div>
          {currentPrice && (
            <div className="text-xs text-[var(--terminal-text-muted)]">
              ${currentPrice.toFixed(2)}
            </div>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-medium ${isProfit ? 'pnl-positive' : 'pnl-negative'}`}>
          {isProfit ? '+' : ''}{pnl.toFixed(2)}
        </div>
        <div className={`text-xs ${isProfit ? 'pnl-positive' : 'pnl-negative'}`}>
          {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

export function OverviewView() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [stats, setStats] = useState<TradingStats | null>(null);
  const [activeTrades, setActiveTrades] = useState<ActiveTradesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Get symbols from active trades for WebSocket subscription
  const symbols = activeTrades?.openPositions?.map(t => t.symbol) || [];
  const { prices, connected } = useTradingWebSocket({ symbols, enabled: symbols.length > 0 });

  useEffect(() => {
    async function loadData() {
      try {
        const [portfolioData, statsData, tradesData] = await Promise.all([
          tradingApi.getPortfolio().catch(() => null),
          tradingApi.getStats(7).catch(() => null),
          tradingApi.getActiveTrades().catch(() => null),
        ]);
        setPortfolio(portfolioData);
        setStats(statsData);
        setActiveTrades(tradesData);
      } catch (error) {
        console.error('Failed to load overview data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[var(--terminal-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalValue = portfolio?.totalValueUsdt || 0;
  const dailyPnl = portfolio?.dailyPnl || 0;
  const dailyPnlPct = portfolio?.dailyPnlPct || 0;
  const openPositionCount = activeTrades?.openPositions?.length || 0;
  const winRate = stats?.winRate || 0;

  return (
    <div className="space-y-4">
      {/* Connection Status */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className={`status-dot ${connected ? 'status-live' : 'status-offline'}`} />
          <span className="text-xs text-[var(--terminal-text-muted)] uppercase tracking-wider">
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <span className="text-xs text-[var(--terminal-text-dim)]">
          Last update: {new Date().toLocaleTimeString()}
        </span>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <QuickStat
          label="Portfolio"
          value={`$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subValue={`${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} (${dailyPnlPct.toFixed(2)}%)`}
          trend={dailyPnl >= 0 ? 'up' : 'down'}
          icon={<DollarSign size={18} />}
        />
        <QuickStat
          label="Open Positions"
          value={openPositionCount.toString()}
          subValue={openPositionCount > 0 ? 'Active trades' : 'No positions'}
          icon={<Activity size={18} />}
        />
        <QuickStat
          label="Win Rate (7d)"
          value={`${winRate.toFixed(1)}%`}
          subValue={`${stats?.totalTrades || 0} trades`}
          icon={<BarChart3 size={18} />}
        />
        <QuickStat
          label="Today P&L"
          value={`${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`}
          subValue={`${dailyPnlPct >= 0 ? '+' : ''}${dailyPnlPct.toFixed(2)}%`}
          trend={dailyPnl >= 0 ? 'up' : 'down'}
          icon={<Clock size={18} />}
        />
      </div>

      {/* Active Positions */}
      {openPositionCount > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Active Positions</span>
            <span className="text-[var(--terminal-accent)]">{openPositionCount}</span>
          </div>
          <div className="p-4">
            {activeTrades?.openPositions?.map((trade) => {
              const priceData = prices.get(trade.symbol);
              return (
                <ActivePosition
                  key={trade.id}
                  symbol={trade.symbol}
                  side={trade.side}
                  pnl={trade.pnlDollar}
                  pnlPercent={trade.pnlPercent}
                  currentPrice={priceData?.price || trade.currentPrice}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Holdings */}
      {portfolio?.holdings && portfolio.holdings.length > 0 && (
        <div className="card">
          <div className="card-header">Holdings</div>
          <div className="p-4 space-y-3">
            {portfolio.holdings.slice(0, 5).map((holding) => (
              <div key={holding.symbol} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--terminal-surface-hover)] flex items-center justify-center text-xs font-bold">
                    {holding.asset.slice(0, 2)}
                  </div>
                  <div>
                    <div className="font-medium text-[var(--terminal-text)]">{holding.asset}</div>
                    <div className="text-xs text-[var(--terminal-text-muted)]">
                      {holding.amount.toFixed(4)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-[var(--terminal-text)]">
                    ${holding.valueUsdt.toFixed(2)}
                  </div>
                  <div className={`text-xs ${holding.priceChange24h >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {holding.priceChange24h >= 0 ? '+' : ''}{holding.priceChange24h.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
