'use client';

import React, { useState } from 'react';
import { Bot, Play, Square, Trash2, Plus } from 'lucide-react';
import { tradingApi, type BotConfig } from '@/lib/api';

interface AlgorithmsTabProps {
  bots: BotConfig[];
  onRefresh: () => void;
}

export default function AlgorithmsTab({ bots, onRefresh }: AlgorithmsTabProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleStart = async (botId: string) => {
    try {
      setLoading(botId);
      await tradingApi.updateBotStatus(botId, 'running');
      onRefresh();
    } catch (err) {
      console.error('Failed to start bot:', err);
    } finally {
      setLoading(null);
    }
  };

  const handleStop = async (botId: string) => {
    try {
      setLoading(botId);
      await tradingApi.updateBotStatus(botId, 'stopped');
      onRefresh();
    } catch (err) {
      console.error('Failed to stop bot:', err);
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async (botId: string) => {
    if (!confirm('Are you sure you want to delete this algorithm?')) return;
    try {
      setLoading(botId);
      await tradingApi.deleteBot(botId);
      onRefresh();
    } catch (err) {
      console.error('Failed to delete bot:', err);
    } finally {
      setLoading(null);
    }
  };

  const getBotTypeLabel = (type: string) => {
    switch (type) {
      case 'grid': return 'Grid Trading';
      case 'dca': return 'DCA';
      case 'rsi': return 'RSI';
      case 'scalp': return 'Scalping';
      default: return type.toUpperCase();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'var(--terminal-positive)';
      case 'stopped': return 'var(--terminal-text-dim)';
      case 'error': return 'var(--terminal-negative)';
      default: return 'var(--terminal-text-muted)';
    }
  };

  const runningCount = bots.filter(b => b.status === 'running').length;
  const totalProfit = bots.reduce((sum, b) => sum + (b.totalProfit || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Total Algorithms
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>
              {bots.length}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Active
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'IBM Plex Mono', fontWeight: 600, color: 'var(--terminal-positive)' }}>
              {runningCount}
            </div>
          </div>
        </div>

        <div className="terminal-card">
          <div className="terminal-card-body" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Total Profit
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontFamily: 'IBM Plex Mono',
              fontWeight: 600,
              color: totalProfit >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
            }}>
              {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Algorithms List */}
      <div className="terminal-card">
        <div className="terminal-card-header">
          <span className="terminal-card-title">Algorithms</span>
          <button className="terminal-btn terminal-btn-primary" style={{ padding: '0.375rem 0.75rem' }}>
            <Plus size={14} />
            <span>New Algorithm</span>
          </button>
        </div>
        <div className="terminal-card-body" style={{ padding: 0 }}>
          {bots.length > 0 ? (
            <table className="terminal-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Profit</th>
                  <th style={{ textAlign: 'right' }}>Trades</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bots.map(bot => (
                  <tr key={bot.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Bot size={14} style={{ color: 'var(--terminal-accent)' }} />
                        <span style={{ fontWeight: 500 }}>{bot.name}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        background: 'var(--terminal-surface-hover)',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                      }}>
                        {getBotTypeLabel(bot.type)}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'IBM Plex Mono' }}>
                      {bot.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                    </td>
                    <td>
                      <div className={`terminal-status ${bot.status === 'running' ? 'terminal-status-live' : ''}`}>
                        <span className="terminal-status-dot" style={{ background: getStatusColor(bot.status) }} />
                        <span style={{ color: getStatusColor(bot.status) }}>
                          {bot.status.toUpperCase()}
                        </span>
                      </div>
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontFamily: 'IBM Plex Mono',
                      color: (bot.totalProfit || 0) >= 0 ? 'var(--terminal-positive)' : 'var(--terminal-negative)',
                    }}>
                      {(bot.totalProfit || 0) >= 0 ? '+' : ''}${(bot.totalProfit || 0).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                      {bot.totalTrades || 0}
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.25rem' }}>
                        {bot.status === 'running' ? (
                          <button
                            onClick={() => handleStop(bot.id)}
                            disabled={loading === bot.id}
                            className="terminal-btn terminal-btn-secondary"
                            style={{ padding: '0.25rem 0.5rem' }}
                            title="Stop"
                          >
                            <Square size={12} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStart(bot.id)}
                            disabled={loading === bot.id}
                            className="terminal-btn terminal-btn-primary"
                            style={{ padding: '0.25rem 0.5rem' }}
                            title="Start"
                          >
                            <Play size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(bot.id)}
                          disabled={loading === bot.id}
                          className="terminal-btn terminal-btn-secondary"
                          style={{ padding: '0.25rem 0.5rem' }}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3rem',
              color: 'var(--terminal-text-dim)',
            }}>
              <Bot size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <p>No algorithms configured</p>
              <p style={{ fontSize: '0.8rem' }}>Create your first algorithm to start automated trading</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
