'use client';

import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { Portfolio, PriceData } from '@/lib/api';

interface PortfolioTabProps {
  portfolio: Portfolio | null;
  prices: PriceData[];
  loading: boolean;
}

export default function PortfolioTab({ portfolio, prices, loading }: PortfolioTabProps) {
  // Price lookup map
  const priceMap = useMemo(() => {
    const map = new Map<string, number>();
    prices.forEach(p => {
      map.set(p.symbol, p.price);
      // Also add without suffix
      map.set(p.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', ''), p.price);
    });
    return map;
  }, [prices]);

  // Calculate allocation with live prices
  const allocationData = useMemo(() => {
    if (!portfolio?.holdings) return [];

    return portfolio.holdings
      .map(h => {
        // Use live price if available, otherwise use stored price
        const livePrice = priceMap.get(h.symbol);
        const currentPrice = livePrice || h.price;
        const value = h.amount * currentPrice;
        // Use priceChange24h as pnl percentage
        const pnlPercent = h.priceChange24h || 0;
        const pnl = (h.valueUsdt * pnlPercent) / 100;

        return {
          ...h,
          currentPrice,
          value,
          allocation: h.allocationPct,
          pnl,
          pnlPercent,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [portfolio, priceMap]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--terminal-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--terminal-text-dim)' }}>Connect exchange to view portfolio</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Total Value
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              ${portfolio.totalValueUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Available
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              ${portfolio.availableUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Total P&L
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontFamily: 'IBM Plex Mono',
              fontWeight: 600,
              color: portfolio.dailyPnl >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
            }}>
              {portfolio.dailyPnl >= 0 ? '+' : ''}${portfolio.dailyPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              P&L %
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontFamily: 'IBM Plex Mono',
              fontWeight: 600,
              color: portfolio.dailyPnlPct >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}>
              {portfolio.dailyPnlPct >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
              {portfolio.dailyPnlPct >= 0 ? '+' : ''}{portfolio.dailyPnlPct.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* Holdings Table */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Holdings ({allocationData.length})</span>
        </div>
        <div className="terminal-card-body" style={{ padding: 0 }}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th style={{ textAlign: 'right' }}>Quantity</th>
                <th style={{ textAlign: 'right' }}>Avg Price</th>
                <th style={{ textAlign: 'right' }}>Current</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th style={{ textAlign: 'right' }}>P&L</th>
                <th style={{ textAlign: 'right' }}>Allocation</th>
              </tr>
            </thead>
            <tbody>
              {allocationData.map(h => (
                <tr key={h.symbol}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
                        {h.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                    {h.amount.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', color: 'var(--terminal-text-muted)' }}>
                    ${h.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: h.price < 1 ? 6 : 2 })}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                    ${h.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: h.currentPrice < 1 ? 6 : 2 })}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                    ${h.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{
                    textAlign: 'right',
                    fontFamily: 'IBM Plex Mono',
                    color: h.pnl >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
                  }}>
                    <div>{h.pnl >= 0 ? '+' : ''}${h.pnl.toFixed(2)}</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                      ({h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent.toFixed(2)}%)
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <div style={{
                        width: '60px',
                        height: '4px',
                        background: 'var(--terminal-border)',
                        borderRadius: '2px',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${Math.min(h.allocation, 100)}%`,
                          height: '100%',
                          background: 'var(--terminal-accent)',
                        }} />
                      </div>
                      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', minWidth: '40px' }}>
                        {h.allocation.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
