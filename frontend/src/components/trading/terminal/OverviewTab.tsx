'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Activity, Bot, BarChart2 } from 'lucide-react';
import type { Portfolio, PriceData, TradeRecord, BotConfig } from '@/lib/api';

interface OverviewTabProps {
  prices: PriceData[];
  portfolio: Portfolio | null;
  bots: BotConfig[];
  trades: TradeRecord[];
  loading: boolean;
}

export default function OverviewTab({ prices, portfolio, bots, trades, loading }: OverviewTabProps) {
  // Top gainers and losers
  const sorted = [...prices].sort((a, b) => b.change24h - a.change24h);
  const topGainers = sorted.slice(0, 5);
  const topLosers = sorted.slice(-5).reverse();

  // Recent signals (mock for now - will integrate with Redis)
  const recentSignals = [
    { symbol: 'SOLUSDT', type: 'buy', strength: 'strong', reason: 'RSI oversold + MACD bullish cross' },
    { symbol: 'ETHUSDT', type: 'buy', strength: 'medium', reason: 'Bollinger Band bounce' },
    { symbol: 'XRPUSDT', type: 'neutral', strength: 'weak', reason: 'Consolidating near support' },
  ];

  // Active bots
  const runningBots = bots.filter(b => b.status === 'running');

  // Recent trades
  const recentTrades = trades.slice(0, 5);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--terminal-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="terminal-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gridAutoRows: 'minmax(200px, auto)' }}>
      {/* Portfolio Summary */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Portfolio Summary</span>
        </div>
        <div className="terminal-card-body">
          {portfolio ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--terminal-text-muted)', fontSize: '0.8rem' }}>Total Value</span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                  ${portfolio.totalValueUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--terminal-text-muted)', fontSize: '0.8rem' }}>Available</span>
                <span style={{ fontFamily: 'IBM Plex Mono' }}>
                  ${portfolio.availableUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--terminal-text-muted)', fontSize: '0.8rem' }}>P&L</span>
                <span style={{
                  fontFamily: 'IBM Plex Mono',
                  color: portfolio.dailyPnl >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
                }}>
                  {portfolio.dailyPnl >= 0 ? '+' : ''}${portfolio.dailyPnl.toFixed(2)} ({portfolio.dailyPnlPct.toFixed(2)}%)
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--terminal-text-muted)', fontSize: '0.8rem' }}>Positions</span>
                <span style={{ fontFamily: 'IBM Plex Mono' }}>{portfolio.holdings.length}</span>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--terminal-text-dim)', fontSize: '0.85rem' }}>
              Connect exchange to view portfolio
            </div>
          )}
        </div>
      </div>

      {/* Active Signals */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Recent Signals</span>
          <Activity size={14} style={{ color: 'var(--terminal-accent)' }} />
        </div>
        <div className="terminal-card-body" style={{ padding: 0 }}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {recentSignals.map((signal, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                    {signal.symbol.replace('USDT', '')}
                  </td>
                  <td>
                    <span className={`terminal-signal terminal-signal-${signal.type}`}>
                      {signal.type.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--terminal-text-muted)' }}>
                    {signal.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Movers */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Top Gainers</span>
          <TrendingUp size={14} style={{ color: 'var(--terminal-positive)' }} />
        </div>
        <div className="terminal-card-body" style={{ padding: 0 }}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>24h</th>
              </tr>
            </thead>
            <tbody>
              {topGainers.map(p => (
                <tr key={p.symbol}>
                  <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                    {p.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                    ${p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: p.price < 1 ? 6 : 2 })}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--terminal-positive)', fontFamily: 'IBM Plex Mono' }}>
                    +{p.change24h.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Losers */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Top Losers</span>
          <TrendingDown size={14} style={{ color: 'var(--terminal-negative)' }} />
        </div>
        <div className="terminal-card-body" style={{ padding: 0 }}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>24h</th>
              </tr>
            </thead>
            <tbody>
              {topLosers.map(p => (
                <tr key={p.symbol}>
                  <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                    {p.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                    ${p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: p.price < 1 ? 6 : 2 })}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--terminal-negative)', fontFamily: 'IBM Plex Mono' }}>
                    {p.change24h.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Running Algorithms */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Active Algorithms</span>
          <Bot size={14} style={{ color: 'var(--terminal-accent)' }} />
        </div>
        <div className="terminal-card-body">
          {runningBots.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {runningBots.slice(0, 4).map(bot => (
                <div
                  key={bot.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.5rem',
                    background: 'var(--terminal-surface-hover)',
                    borderRadius: '4px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{bot.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)' }}>
                      {bot.type.toUpperCase()} - {bot.symbol}
                    </div>
                  </div>
                  <div className="terminal-status terminal-status-live">
                    <span className="terminal-status-dot" />
                    <span>Running</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--terminal-text-dim)', fontSize: '0.85rem' }}>
              No active algorithms
            </div>
          )}
        </div>
      </div>

      {/* Recent Executions */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Recent Executions</span>
          <BarChart2 size={14} style={{ color: 'var(--terminal-text-muted)' }} />
        </div>
        <div className="terminal-card-body" style={{ padding: 0 }}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.length > 0 ? (
                recentTrades.map(trade => (
                  <tr key={trade.id}>
                    <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                      {trade.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                    </td>
                    <td>
                      <span style={{
                        color: trade.side === 'buy' ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
                        fontWeight: 500,
                        fontSize: '0.75rem',
                      }}>
                        {trade.side}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                      ${((trade.price || 0) * trade.quantity).toFixed(2)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--terminal-text-dim)', textAlign: 'center' }}>
                    No recent trades
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
