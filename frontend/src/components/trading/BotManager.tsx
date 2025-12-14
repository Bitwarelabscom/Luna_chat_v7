'use client';

import React from 'react';
import { Bot, Play, Pause, Trash2, Plus, HelpCircle, Zap, Settings } from 'lucide-react';
import { type BotConfig, type BotType } from '@/lib/api';

interface BotManagerProps {
  bots: BotConfig[];
  onCreateBot: () => void;
  onStartBot: (botId: string) => void;
  onStopBot: (botId: string) => void;
  onDeleteBot: (botId: string) => void;
  onOpenHelp: () => void;
  onOpenBotHelp?: (type: BotType) => void;
}

export default function BotManager({
  bots,
  onCreateBot,
  onStartBot,
  onStopBot,
  onDeleteBot,
  onOpenHelp,
  onOpenBotHelp,
}: BotManagerProps) {
  const BOT_TYPE_INFO: Record<BotType, { label: string; icon: string }> = {
    grid: { label: 'Grid', icon: '📊' },
    dca: { label: 'DCA', icon: '📈' },
    rsi: { label: 'RSI', icon: '📉' },
    ma_crossover: { label: 'MA Cross', icon: '〰️' },
    macd: { label: 'MACD', icon: '📶' },
    breakout: { label: 'Breakout', icon: '🚀' },
    mean_reversion: { label: 'Mean Rev', icon: '🎯' },
    momentum: { label: 'Momentum', icon: '⚡' },
    custom: { label: 'Custom', icon: '🔧' },
  };

  const getBotTypeLabel = (type: BotType) => {
    return BOT_TYPE_INFO[type]?.label || type;
  };

  const getBotTypeIcon = (type: BotType) => {
    return BOT_TYPE_INFO[type]?.icon || '🤖';
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

  // Format config summary for display
  const getConfigSummary = (bot: BotConfig): string => {
    const config = bot.config as Record<string, unknown>;

    switch (bot.type) {
      case 'grid':
        if (config.upperPrice && config.lowerPrice && config.gridCount) {
          return `$${Number(config.lowerPrice).toLocaleString()} - $${Number(config.upperPrice).toLocaleString()}, ${config.gridCount} grids`;
        }
        break;
      case 'dca':
        if (config.amountPerBuy && config.intervalMinutes) {
          const interval = Number(config.intervalMinutes);
          const intervalText = interval === 60 ? 'hourly' :
                               interval === 1440 ? 'daily' :
                               interval === 10080 ? 'weekly' : `${interval}m`;
          return `$${Number(config.amountPerBuy).toLocaleString()} ${intervalText}`;
        }
        break;
      case 'rsi':
        if (config.buyThreshold && config.sellThreshold) {
          return `Buy < ${config.buyThreshold}, Sell > ${config.sellThreshold}`;
        }
        break;
      case 'ma_crossover':
        if (config.fastPeriod && config.slowPeriod) {
          return `${config.maType?.toString().toUpperCase() || 'MA'} ${config.fastPeriod}/${config.slowPeriod}`;
        }
        break;
      case 'macd':
        if (config.fastPeriod && config.slowPeriod) {
          return `${config.fastPeriod}/${config.slowPeriod}/${config.signalPeriod || 9}`;
        }
        break;
      case 'breakout':
        if (config.lookbackPeriod) {
          return `${config.lookbackPeriod} period lookback`;
        }
        break;
      case 'mean_reversion':
        if (config.bbPeriod) {
          return `BB(${config.bbPeriod}, ${config.bbStdDev || 2})`;
        }
        break;
      case 'momentum':
        if (config.momentumThreshold) {
          return `RSI > ${config.momentumThreshold}`;
        }
        break;
    }
    return '';
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
          <button
            onClick={onOpenHelp}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: '#607080',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Learn about bot strategies"
          >
            <HelpCircle style={{ width: 14, height: 14 }} />
          </button>
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
            <p style={{ color: '#fff', fontSize: '15px', fontWeight: 500, marginBottom: '8px' }}>
              Automate Your Trading
            </p>
            <p style={{ color: '#607080', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
              Create bots that trade for you 24/7 using proven strategies like Grid Trading,
              DCA, RSI, and more.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
              <button
                onClick={onCreateBot}
                style={{
                  padding: '12px 24px',
                  background: '#00ff9f',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#1a1f2e',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Plus style={{ width: 16, height: 16 }} />
                Create Your First Bot
              </button>
              <button
                onClick={onOpenHelp}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  border: '1px solid #2a3545',
                  borderRadius: '8px',
                  color: '#a0a0a0',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <HelpCircle style={{ width: 14, height: 14 }} />
                Learn About Strategies
              </button>
            </div>

            {/* Quick start hints */}
            <div style={{
              marginTop: '24px',
              padding: '16px',
              background: '#242b3d',
              borderRadius: '10px',
              textAlign: 'left',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 500, color: '#fff', marginBottom: '12px' }}>
                Popular Strategies:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { type: 'grid' as BotType, desc: 'Profit from ranging markets' },
                  { type: 'dca' as BotType, desc: 'Steady accumulation over time' },
                  { type: 'rsi' as BotType, desc: 'Buy oversold, sell overbought' },
                ].map(({ type, desc }) => (
                  <div
                    key={type}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      background: '#1a1f2e',
                      borderRadius: '6px',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{getBotTypeIcon(type)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: '#fff' }}>
                        {getBotTypeLabel(type)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#607080' }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          bots.map((bot) => {
            const configSummary = getConfigSummary(bot);

            return (
              <div
                key={bot.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(42, 53, 69, 0.5)',
                  background: bot.marketType === 'alpha' ? 'rgba(245, 158, 11, 0.03)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1 }}>
                    {/* Bot Name & Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '16px' }}>{getBotTypeIcon(bot.type)}</span>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>{bot.name}</span>
                      <span style={{
                        padding: '2px 6px',
                        background: `${getStatusColor(bot.status)}20`,
                        borderRadius: '4px',
                        color: getStatusColor(bot.status),
                        fontSize: '10px',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                      }}>
                        {bot.status}
                      </span>
                      {bot.marketType === 'alpha' && (
                        <span style={{
                          padding: '2px 6px',
                          background: 'rgba(245, 158, 11, 0.15)',
                          borderRadius: '4px',
                          color: '#f59e0b',
                          fontSize: '9px',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                        }}>
                          <Zap style={{ width: 8, height: 8 }} />
                          ALPHA
                        </span>
                      )}
                    </div>

                    {/* Type & Symbol */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: '#607080',
                      fontSize: '12px',
                      marginBottom: '4px',
                    }}>
                      <span style={{ color: '#a0a0a0' }}>{getBotTypeLabel(bot.type)}</span>
                      <span>-</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#00ff9f' }}>
                        {bot.symbol}
                      </span>
                      {onOpenBotHelp && (
                        <button
                          onClick={() => onOpenBotHelp(bot.type)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: '2px',
                            cursor: 'pointer',
                            color: '#607080',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title={`Learn about ${getBotTypeLabel(bot.type)}`}
                        >
                          <HelpCircle style={{ width: 12, height: 12 }} />
                        </button>
                      )}
                    </div>

                    {/* Config Summary */}
                    {configSummary && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#607080',
                        fontSize: '11px',
                      }}>
                        <Settings style={{ width: 10, height: 10 }} />
                        <span>{configSummary}</span>
                      </div>
                    )}

                    {/* Stats */}
                    {bot.totalTrades > 0 && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginTop: '8px',
                        padding: '6px 10px',
                        background: '#1a1f2e',
                        borderRadius: '6px',
                        fontSize: '11px',
                      }}>
                        <div>
                          <span style={{ color: '#607080' }}>Trades: </span>
                          <span style={{ color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
                            {bot.totalTrades}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: '#607080' }}>P&L: </span>
                          <span style={{
                            color: bot.totalProfit >= 0 ? '#10b981' : '#ef4444',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}>
                            {bot.totalProfit >= 0 ? '+' : ''}${bot.totalProfit.toFixed(2)}
                          </span>
                        </div>
                        {bot.winRate > 0 && (
                          <div>
                            <span style={{ color: '#607080' }}>Win: </span>
                            <span style={{ color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
                              {bot.winRate.toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px' }}>
                    {bot.status === 'running' ? (
                      <button
                        onClick={() => onStopBot(bot.id)}
                        style={{
                          padding: '8px',
                          background: 'transparent',
                          border: '1px solid #f59e0b',
                          borderRadius: '6px',
                          color: '#f59e0b',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Pause bot"
                      >
                        <Pause style={{ width: 14, height: 14 }} />
                      </button>
                    ) : (
                      <button
                        onClick={() => onStartBot(bot.id)}
                        style={{
                          padding: '8px',
                          background: 'transparent',
                          border: '1px solid #10b981',
                          borderRadius: '6px',
                          color: '#10b981',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Start bot"
                      >
                        <Play style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteBot(bot.id)}
                      style={{
                        padding: '8px',
                        background: 'transparent',
                        border: '1px solid #ef4444',
                        borderRadius: '6px',
                        color: '#ef4444',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Delete bot"
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>

                {/* Error message if any */}
                {bot.status === 'error' && bot.lastError && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 10px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#ef4444',
                  }}>
                    {bot.lastError}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
