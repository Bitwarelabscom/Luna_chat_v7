'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { type PriceData } from '@/lib/api';

interface PriceTickerProps {
  prices: PriceData[];
  onSelectSymbol: (symbol: string) => void;
}

export default function PriceTicker({ prices, onSelectSymbol }: PriceTickerProps) {
  // Duplicate prices for seamless scrolling
  const tickerPrices = [...prices, ...prices];

  return (
    <div style={{
      overflow: 'hidden',
      background: 'rgba(17, 24, 39, 0.5)',
      borderBottom: '1px solid #2a3545',
    }}>
      <div style={{
        display: 'flex',
        animation: 'ticker 60s linear infinite',
        whiteSpace: 'nowrap',
      }}>
        {tickerPrices.map((price, index) => (
          <div
            key={`${price.symbol}-${index}`}
            onClick={() => onSelectSymbol(price.symbol)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 24px',
              borderRight: '1px solid rgba(42, 53, 69, 0.5)',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
              {price.symbol.replace('USDT', '')}
            </span>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '13px',
              color: '#8892a0',
            }}>
              ${price.price.toLocaleString(undefined, {
                minimumFractionDigits: price.price < 1 ? 4 : 2,
                maximumFractionDigits: price.price < 1 ? 6 : 2,
              })}
            </span>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '12px',
              fontWeight: 500,
              color: price.change24h >= 0 ? '#10b981' : '#ef4444',
            }}>
              {price.change24h >= 0 ? (
                <TrendingUp style={{ width: 12, height: 12 }} />
              ) : (
                <TrendingDown style={{ width: 12, height: 12 }} />
              )}
              {price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
