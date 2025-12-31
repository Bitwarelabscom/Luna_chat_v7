'use client';

import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import type { PriceData } from '@/lib/api';

interface Signal {
  id: string;
  symbol: string;
  type: 'buy' | 'sell' | 'alert';
  strength: 'strong' | 'medium' | 'weak';
  reason: string;
  indicators: string[];
  price: number;
  timestamp: number;
  confidence: number;
}

interface SignalsTabProps {
  prices: PriceData[];
}

export default function SignalsTab({ prices }: SignalsTabProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');

  // Generate mock signals based on prices (in production, these come from Redis)
  useEffect(() => {
    const generateSignals = () => {
      const mockSignals: Signal[] = prices
        .slice(0, 15)
        .map(p => {
          const isBuy = p.change24h < -2;
          const isSell = p.change24h > 5;
          const type = isBuy ? 'buy' : isSell ? 'sell' : 'alert';
          const strength = Math.abs(p.change24h) > 5 ? 'strong' : Math.abs(p.change24h) > 3 ? 'medium' : 'weak';

          return {
            id: `${p.symbol}-${Date.now()}`,
            symbol: p.symbol,
            type: type as 'buy' | 'sell' | 'alert',
            strength: strength as 'strong' | 'medium' | 'weak',
            reason: isBuy
              ? 'RSI oversold, price near support'
              : isSell
              ? 'RSI overbought, approaching resistance'
              : 'Consolidating, watch for breakout',
            indicators: isBuy
              ? ['RSI < 30', 'MACD bullish', 'BB lower']
              : isSell
              ? ['RSI > 70', 'MACD bearish', 'BB upper']
              : ['RSI neutral', 'Consolidation'],
            price: p.price,
            timestamp: Date.now() - Math.random() * 3600000,
            confidence: Math.random() * 0.4 + 0.5,
          };
        })
        .filter(s => s.type !== 'alert' || Math.random() > 0.5);

      setSignals(mockSignals);
    };

    generateSignals();
  }, [prices]);

  const filteredSignals = signals.filter(s => filter === 'all' || s.type === filter);

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'strong': return 'var(--terminal-positive)';
      case 'medium': return 'var(--terminal-warning)';
      default: return 'var(--terminal-text-muted)';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Activity size={20} style={{ color: 'var(--terminal-accent)' }} />
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>Active Signals</span>
          <span style={{
            background: 'var(--terminal-accent)',
            color: '#000',
            padding: '0.125rem 0.5rem',
            borderRadius: '10px',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}>
            {filteredSignals.length}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'buy', 'sell'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`terminal-btn ${filter === f ? 'terminal-btn-primary' : 'terminal-btn-secondary'}`}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.7rem' }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Signals Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' }}>
        {filteredSignals.map(signal => (
          <div key={signal.id} className="terminal-card">
            <div className="terminal-card-header" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {signal.type === 'buy' ? (
                  <TrendingUp size={16} style={{ color: 'var(--terminal-positive)' }} />
                ) : signal.type === 'sell' ? (
                  <TrendingDown size={16} style={{ color: 'var(--terminal-negative)' }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: 'var(--terminal-warning)' }} />
                )}
                <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600, fontSize: '0.9rem' }}>
                  {signal.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                </span>
                <span className={`terminal-signal terminal-signal-${signal.type}`}>
                  {signal.type.toUpperCase()}
                </span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)' }}>
                {formatTime(signal.timestamp)}
              </span>
            </div>

            <div className="terminal-card-body" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--terminal-text-muted)', marginBottom: '0.25rem' }}>
                  Reason
                </div>
                <div style={{ fontSize: '0.85rem' }}>{signal.reason}</div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {signal.indicators.map((ind, i) => (
                  <span
                    key={i}
                    style={{
                      background: 'var(--terminal-surface-hover)',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '3px',
                      fontSize: '0.7rem',
                      color: 'var(--terminal-text-muted)',
                    }}
                  >
                    {ind}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)' }}>Price: </span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                    ${signal.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: signal.price < 1 ? 6 : 2 })}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)' }}>Confidence:</span>
                  <div style={{
                    width: '60px',
                    height: '4px',
                    background: 'var(--terminal-border)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${signal.confidence * 100}%`,
                      height: '100%',
                      background: getStrengthColor(signal.strength),
                    }} />
                  </div>
                  <span style={{ fontSize: '0.7rem', fontFamily: 'IBM Plex Mono' }}>
                    {(signal.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredSignals.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem',
          color: 'var(--terminal-text-dim)',
        }}>
          <Activity size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>No {filter !== 'all' ? filter : ''} signals at the moment</p>
        </div>
      )}
    </div>
  );
}
