'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { type PortfolioHolding } from '@/lib/api';

interface HoldingsProps {
  holdings: PortfolioHolding[];
  onSelectSymbol: (symbol: string) => void;
}

export default function Holdings({ holdings, onSelectSymbol }: HoldingsProps) {
  // Sort by value
  const sortedHoldings = [...holdings].sort((a, b) => b.valueUsdt - a.valueUsdt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #2a3545',
        background: 'rgba(42, 53, 69, 0.3)',
      }}>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#fff' }}>
          Holdings ({holdings.length})
        </h3>
      </div>

      {/* Holdings List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sortedHoldings.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#607080',
            fontSize: '13px',
          }}>
            No holdings found
          </div>
        ) : (
          sortedHoldings.map((holding) => (
            <div
              key={holding.symbol}
              onClick={() => onSelectSymbol(holding.symbol)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(42, 53, 69, 0.5)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(42, 53, 69, 0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: '#1f2937',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#00ff9f'
                  }}>
                    {holding.asset?.slice(0, 2) || holding.symbol.slice(0, 2)}
                  </span>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>
                      {holding.asset || holding.symbol}
                    </span>
                    <span style={{ fontSize: '11px', color: '#607080' }}>
                      {holding.allocationPct.toFixed(1)}%
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#607080' }}>
                    {holding.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} units
                  </span>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                }}>
                  ${holding.valueUsdt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '4px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '11px',
                  color: holding.priceChange24h >= 0 ? '#10b981' : '#ef4444',
                }}>
                  {holding.priceChange24h >= 0 ? (
                    <TrendingUp style={{ width: 10, height: 10 }} />
                  ) : (
                    <TrendingDown style={{ width: 10, height: 10 }} />
                  )}
                  {holding.priceChange24h >= 0 ? '+' : ''}{holding.priceChange24h.toFixed(2)}%
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
