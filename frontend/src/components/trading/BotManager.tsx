'use client';

import React from 'react';
import { Bot, Play, Pause, Trash2, Plus } from 'lucide-react';
import { type BotConfig } from '@/lib/api';

interface BotManagerProps {
  bots: BotConfig[];
  onCreateBot: () => void;
  onStartBot: (botId: string) => void;
  onStopBot: (botId: string) => void;
  onDeleteBot: (botId: string) => void;
}

export default function BotManager({
  bots,
  onCreateBot,
  onStartBot,
  onStopBot,
  onDeleteBot,
}: BotManagerProps) {
  const getBotTypeLabel = (type: string) => {
    switch (type) {
      case 'grid': return 'Grid Bot';
      case 'dca': return 'DCA Bot';
      case 'rsi': return 'RSI Bot';
      case 'ma_crossover': return 'MA Crossover';
      case 'custom': return 'Custom';
      default: return type;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#10b981';
      case 'stopped': return '#8892a0';
      case 'error': return '#ef4444';
      case 'paused': return '#f59e0b';
      default: return '#8892a0';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #2a3545',
        background: 'rgba(42, 53, 69, 0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot style={{ width: 16, height: 16, color: '#00ff9f' }} />
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#fff' }}>Trading Bots</h3>
        </div>
        <button
          onClick={onCreateBot}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 12px',
            background: '#00ff9f20',
            border: '1px solid #00ff9f',
            borderRadius: '6px',
            color: '#00ff9f',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          <Plus style={{ width: 12, height: 12 }} />
          New Bot
        </button>
      </div>

      {/* Bots List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {bots.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
          }}>
            <Bot style={{ width: 48, height: 48, color: '#2a3545', marginBottom: '16px' }} />
            <p style={{ color: '#607080', fontSize: '13px', marginBottom: '16px' }}>
              No trading bots configured yet.
              <br />
              Create a bot to automate your trading strategy.
            </p>
            <button
              onClick={onCreateBot}
              style={{
                padding: '10px 20px',
                background: '#00ff9f',
                border: 'none',
                borderRadius: '6px',
                color: '#000',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Create Your First Bot
            </button>
          </div>
        ) : (
          bots.map((bot) => (
            <div
              key={bot.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(42, 53, 69, 0.5)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>{bot.name}</span>
                  <span style={{
                    padding: '2px 6px',
                    background: `${getStatusColor(bot.status)}20`,
                    borderRadius: '4px',
                    color: getStatusColor(bot.status),
                    fontSize: '10px',
                    textTransform: 'uppercase',
                  }}>
                    {bot.status}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#607080', fontSize: '11px' }}>
                  <span>{getBotTypeLabel(bot.type)}</span>
                  <span>-</span>
                  <span>{bot.symbol}</span>
                  {bot.totalTrades > 0 && (
                    <>
                      <span>-</span>
                      <span>{bot.totalTrades} trades</span>
                      <span>-</span>
                      <span style={{ color: bot.totalProfit >= 0 ? '#10b981' : '#ef4444' }}>
                        {bot.totalProfit >= 0 ? '+' : ''}${bot.totalProfit.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {bot.status === 'running' ? (
                  <button
                    onClick={() => onStopBot(bot.id)}
                    style={{
                      padding: '6px',
                      background: 'transparent',
                      border: '1px solid #f59e0b',
                      borderRadius: '4px',
                      color: '#f59e0b',
                      cursor: 'pointer',
                    }}
                    title="Pause bot"
                  >
                    <Pause style={{ width: 14, height: 14 }} />
                  </button>
                ) : (
                  <button
                    onClick={() => onStartBot(bot.id)}
                    style={{
                      padding: '6px',
                      background: 'transparent',
                      border: '1px solid #10b981',
                      borderRadius: '4px',
                      color: '#10b981',
                      cursor: 'pointer',
                    }}
                    title="Start bot"
                  >
                    <Play style={{ width: 14, height: 14 }} />
                  </button>
                )}
                <button
                  onClick={() => onDeleteBot(bot.id)}
                  style={{
                    padding: '6px',
                    background: 'transparent',
                    border: '1px solid #ef4444',
                    borderRadius: '4px',
                    color: '#ef4444',
                    cursor: 'pointer',
                  }}
                  title="Delete bot"
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
