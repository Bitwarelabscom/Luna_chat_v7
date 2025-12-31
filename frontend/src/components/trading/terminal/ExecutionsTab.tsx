'use client';

import React, { useState, useMemo } from 'react';
import { Download, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type { TradeRecord } from '@/lib/api';

interface ExecutionsTabProps {
  trades: TradeRecord[];
  loading: boolean;
}

export default function ExecutionsTab({ trades, loading }: ExecutionsTabProps) {
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [search, setSearch] = useState('');

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (filter !== 'all' && t.side.toLowerCase() !== filter) return false;
      if (search && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [trades, filter, search]);

  // Calculate stats
  const stats = useMemo(() => {
    const buyTrades = trades.filter(t => t.side === 'buy');
    const sellTrades = trades.filter(t => t.side === 'sell');
    const totalVolume = trades.reduce((sum, t) => sum + ((t.price || 0) * t.quantity), 0);
    const avgTradeSize = trades.length > 0 ? totalVolume / trades.length : 0;

    return {
      total: trades.length,
      buys: buyTrades.length,
      sells: sellTrades.length,
      volume: totalVolume,
      avgSize: avgTradeSize,
    };
  }, [trades]);

  const formatDate = (dateInput: string | Date) => {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--terminal-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Total Trades
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              {stats.total}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Buy / Sell
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              <span style={{ color: 'var(--terminal-positive)' }}>{stats.buys}</span>
              <span style={{ color: 'var(--terminal-text-dim)' }}> / </span>
              <span style={{ color: 'var(--terminal-negative)' }}>{stats.sells}</span>
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Total Volume
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              ${stats.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Avg Trade Size
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              ${stats.avgSize.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

        <input
          type="text"
          placeholder="Search symbol..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="terminal-input"
          style={{ width: '200px' }}
        />
      </div>

      {/* Trades Table */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Execution History ({filteredTrades.length})</span>
          <button className="terminal-btn terminal-btn-secondary" style={{ padding: '0.375rem 0.75rem' }}>
            <Download size={14} />
            <span>Export</span>
          </button>
        </div>
        <div className="terminal-card-body" style={{ padding: 0, maxHeight: '500px', overflow: 'auto' }}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Quantity</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.length > 0 ? (
                filteredTrades.map(trade => (
                  <tr key={trade.id}>
                    <td style={{ color: 'var(--terminal-text-muted)', fontSize: '0.8rem' }}>
                      {formatDate(trade.createdAt)}
                    </td>
                    <td style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                      {trade.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {trade.side === 'buy' ? (
                          <ArrowDownLeft size={12} style={{ color: 'var(--terminal-positive)' }} />
                        ) : (
                          <ArrowUpRight size={12} style={{ color: 'var(--terminal-negative)' }} />
                        )}
                        <span style={{
                          color: trade.side === 'buy' ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
                          fontWeight: 500,
                          fontSize: '0.8rem',
                        }}>
                          {trade.side}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                      ${(trade.price || 0).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: (trade.price || 0) < 1 ? 6 : 2,
                      })}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                      {trade.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>
                      ${((trade.price || 0) * trade.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', color: 'var(--terminal-text-muted)' }}>
                      ${(trade.fee || 0).toFixed(4)}
                    </td>
                    <td>
                      <span style={{
                        background: 'var(--terminal-surface-hover)',
                        padding: '0.125rem 0.375rem',
                        borderRadius: '3px',
                        fontSize: '0.65rem',
                        textTransform: 'uppercase',
                      }}>
                        {trade.botId ? 'bot' : 'manual'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--terminal-text-dim)' }}>
                    No trades found
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
