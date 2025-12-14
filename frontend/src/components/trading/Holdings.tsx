'use client';

import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Zap, Wallet } from 'lucide-react';
import { type PortfolioHolding, type AlphaHolding } from '@/lib/api';

type ViewMode = 'all' | 'spot' | 'alpha';

interface HoldingsProps {
  holdings: PortfolioHolding[];
  alphaHoldings?: AlphaHolding[];
  showAlphaTabs?: boolean;
  onSelectSymbol: (symbol: string) => void;
}

export default function Holdings({ holdings, alphaHoldings = [], showAlphaTabs = true, onSelectSymbol }: HoldingsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  // Filter based on view mode
  const filteredSpot = viewMode === 'alpha' ? [] : holdings;
  const filteredAlpha = viewMode === 'spot' ? [] : alphaHoldings;

  // Combined and sorted by value
  const allHoldings = [
    ...filteredSpot.map(h => ({ ...h, type: 'spot' as const })),
    ...filteredAlpha.map(h => ({
      ...h,
      type: 'alpha' as const,
      asset: h.symbol,
      allocationPct: 0, // Alpha doesn't have allocation in same way
    })),
  ].sort((a, b) => b.valueUsdt - a.valueUsdt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with Tabs */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #2a3545',
        background: 'rgba(42, 53, 69, 0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showAlphaTabs ? '12px' : 0 }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#fff' }}>Holdings</h3>
        </div>

        {/* Tabs - show when showAlphaTabs is true */}
        {showAlphaTabs && (
          <div style={{
            display: 'flex',
            gap: '4px',
            background: '#1a1f2e',
            borderRadius: '8px',
            padding: '4px',
          }}>
            {(['all', 'spot', 'alpha'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: viewMode === mode ? '#2a3545' : 'transparent',
                  color: viewMode === mode ? '#fff' : '#607080',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                {mode === 'alpha' && <Zap style={{ width: 10, height: 10, color: '#f59e0b' }} />}
                {mode === 'spot' && <Wallet style={{ width: 10, height: 10 }} />}
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                <span style={{
                  fontSize: '10px',
                  color: viewMode === mode ? '#a0a0a0' : '#607080',
                  marginLeft: '2px',
                }}>
                  ({mode === 'all'
                    ? holdings.length + alphaHoldings.length
                    : mode === 'spot'
                      ? holdings.length
                      : alphaHoldings.length})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Holdings List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {allHoldings.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#607080',
            fontSize: '13px',
          }}>
            {viewMode === 'alpha' ? 'No Alpha holdings' :
             viewMode === 'spot' ? 'No Spot holdings' :
             'No holdings found'}
          </div>
        ) : (
          allHoldings.map((holding) => {
            const isAlpha = holding.type === 'alpha';
            const alphaData = isAlpha ? holding as AlphaHolding & { type: 'alpha' } : null;

            return (
              <div
                key={`${holding.type}-${holding.symbol}`}
                onClick={() => onSelectSymbol(holding.symbol)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(42, 53, 69, 0.5)',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  background: isAlpha ? 'rgba(245, 158, 11, 0.03)' : 'transparent',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = isAlpha ? 'rgba(245, 158, 11, 0.08)' : 'rgba(42, 53, 69, 0.3)'}
                onMouseLeave={(e) => e.currentTarget.style.background = isAlpha ? 'rgba(245, 158, 11, 0.03)' : 'transparent'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: isAlpha ? 'rgba(245, 158, 11, 0.15)' : '#1f2937',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: isAlpha ? '1px solid rgba(245, 158, 11, 0.3)' : 'none',
                  }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: isAlpha ? '#f59e0b' : '#00ff9f'
                    }}>
                      {holding.asset?.slice(0, 2) || holding.symbol.slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>
                        {holding.asset || holding.symbol}
                      </span>
                      {isAlpha && alphaData && (
                        <span style={{
                          fontSize: '9px',
                          fontWeight: 500,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#f59e0b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                        }}>
                          <Zap style={{ width: 8, height: 8 }} />
                          {alphaData.chain}
                        </span>
                      )}
                      {!isAlpha && 'allocationPct' in holding && (
                        <span style={{ fontSize: '11px', color: '#607080' }}>
                          {holding.allocationPct.toFixed(1)}%
                        </span>
                      )}
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
            );
          })
        )}
      </div>
    </div>
  );
}
