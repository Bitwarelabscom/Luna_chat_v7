'use client';

import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { type TradeRecord } from '@/lib/api';

interface RecentTradesProps {
  trades: TradeRecord[];
}

export default function RecentTrades({ trades }: RecentTradesProps) {
  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #2a3545',
        background: 'rgba(42, 53, 69, 0.3)',
      }}>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#fff' }}>Recent Trades</h3>
      </div>

      {/* Trades List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {trades.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#607080',
            fontSize: '13px',
          }}>
            No trades yet
          </div>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(42, 53, 69, 0.5)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(42, 53, 69, 0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: trade.side === 'buy' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {trade.side === 'buy' ? (
                    <ArrowUpRight style={{ width: 16, height: 16, color: '#10b981' }} />
                  ) : (
                    <ArrowDownRight style={{ width: 16, height: 16, color: '#ef4444' }} />
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: trade.side === 'buy' ? '#10b981' : '#ef4444',
                    }}>
                      {trade.side}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>
                      {trade.symbol.replace('USDT', '')}
                    </span>
                  </div>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '11px',
                    color: '#607080',
                  }}>
                    {trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })} @ ${trade.filledPrice?.toLocaleString() || trade.price?.toLocaleString() || 'Market'}
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
                  ${trade.total?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '-'}
                </div>
                <span style={{ fontSize: '11px', color: '#607080' }}>
                  {formatTime(trade.createdAt)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
