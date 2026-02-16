'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  X,
  AlertTriangle,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Square,
  Edit3,
  Scissors,
  Clock,
  Bot,
  Search,
  Zap,
  Copy,
  Check,
} from 'lucide-react';
import { tradingApi, type ActiveTrade, type ActiveTradesResponse, type ConditionalOrder } from '@/lib/api';

// Utility functions
const formatPrice = (price: number) => {
  // For very small prices (< $0.01), show more decimals
  // For small prices (< $1), show 4 decimals
  // For normal prices, show 2 decimals
  let minDecimals = 2;
  let maxDecimals = 2;

  if (price > 0 && price < 0.0001) {
    minDecimals = 6;
    maxDecimals = 8;
  } else if (price > 0 && price < 0.01) {
    minDecimals = 4;
    maxDecimals = 6;
  } else if (price > 0 && price < 1) {
    minDecimals = 4;
    maxDecimals = 4;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(price);
};

const formatPnl = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return sign + formatPrice(value);
};

const formatPnlPercent = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const formatTimeInTrade = (ms: number) => {
  if (ms <= 0) return '-';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

const sourceIcons: Record<string, React.ReactNode> = {
  manual: <Edit3 size={12} />,
  bot: <Bot size={12} />,
  research: <Search size={12} />,
};

const sourceColors: Record<string, string> = {
  manual: '#8892a0',
  bot: '#60a5fa',
  research: '#f59e0b',
};

// Edit SL/TP Modal
interface EditSLTPModalProps {
  trade: ActiveTrade;
  onClose: () => void;
  onSaved: () => void;
}

function EditSLTPModal({ trade, onClose, onSaved }: EditSLTPModalProps) {
  const [stopLossEnabled, setStopLossEnabled] = useState(trade.stopLossPrice !== null);
  const [stopLoss, setStopLoss] = useState(trade.stopLossPrice?.toString() || '');
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(trade.takeProfitPrice !== null);
  const [takeProfit, setTakeProfit] = useState(trade.takeProfitPrice?.toString() || '');
  const [trailingEnabled, setTrailingEnabled] = useState(trade.trailingStopPct !== null);
  const [trailingPct, setTrailingPct] = useState(trade.trailingStopPct?.toString() || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await tradingApi.updateTradeSLTP(trade.id, {
        stopLossPrice: stopLossEnabled && stopLoss ? parseFloat(stopLoss) : null,
        takeProfitPrice: takeProfitEnabled && takeProfit ? parseFloat(takeProfit) : null,
        trailingStopPct: trailingEnabled && trailingPct ? parseFloat(trailingPct) : null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#111820',
          borderRadius: '12px',
          border: '1px solid #2a3545',
          width: '100%',
          maxWidth: '400px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #2a3545',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>Edit Exit Strategy</h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#8892a0' }}>
              {trade.symbol} - {trade.side.toUpperCase()} @ {formatPrice(trade.entryPrice)}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X size={20} color="#8892a0" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {error && (
            <div
              style={{
                padding: '10px 12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '13px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <div style={{ marginBottom: '10px', fontSize: '12px', color: '#8892a0' }}>
            Current Price: {formatPrice(trade.currentPrice)}
          </div>

          {/* Stop Loss */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={stopLossEnabled}
              onChange={(e) => setStopLossEnabled(e.target.checked)}
              style={{ accentColor: '#ef4444' }}
            />
            <span style={{ fontSize: '13px', color: '#c0c8d0', flex: 1 }}>Stop Loss</span>
            {stopLossEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '13px', color: '#8892a0' }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100px',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#fff',
                    fontSize: '13px',
                    textAlign: 'right',
                  }}
                />
              </div>
            )}
          </label>

          {/* Take Profit */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={takeProfitEnabled}
              onChange={(e) => setTakeProfitEnabled(e.target.checked)}
              style={{ accentColor: '#00ff9f' }}
            />
            <span style={{ fontSize: '13px', color: '#c0c8d0', flex: 1 }}>Take Profit</span>
            {takeProfitEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '13px', color: '#8892a0' }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100px',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#fff',
                    fontSize: '13px',
                    textAlign: 'right',
                  }}
                />
              </div>
            )}
          </label>

          {/* Trailing Stop */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '20px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={trailingEnabled}
              onChange={(e) => setTrailingEnabled(e.target.checked)}
              style={{ accentColor: '#f59e0b' }}
            />
            <span style={{ fontSize: '13px', color: '#c0c8d0', flex: 1 }}>Trailing Stop</span>
            {trailingEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="number"
                  step="0.1"
                  value={trailingPct}
                  onChange={(e) => setTrailingPct(e.target.value)}
                  placeholder="2.0"
                  style={{
                    width: '60px',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    color: '#fff',
                    fontSize: '13px',
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontSize: '13px', color: '#8892a0' }}>%</span>
              </div>
            )}
          </label>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px solid #2a3545',
                borderRadius: '6px',
                color: '#8892a0',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '10px 20px',
                background: isSubmitting ? '#2a3545' : '#00ff9f',
                border: 'none',
                borderRadius: '6px',
                color: isSubmitting ? '#8892a0' : '#000',
                fontSize: '14px',
                fontWeight: 500,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Partial Close Modal
interface PartialCloseModalProps {
  trade: ActiveTrade;
  onClose: () => void;
  onClosed: () => void;
}

function PartialCloseModal({ trade, onClose, onClosed }: PartialCloseModalProps) {
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const percentButtons = [25, 50, 75];

  const handlePercentClick = (pct: number) => {
    const qty = (trade.quantity * pct) / 100;
    setQuantity(qty.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setError('Please enter a valid quantity');
      return;
    }
    if (qty >= trade.quantity) {
      setError('Use Stop Trade for full close');
      return;
    }

    setIsSubmitting(true);

    try {
      await tradingApi.partialClose(trade.id, qty);
      onClosed();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to partial close');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#111820',
          borderRadius: '12px',
          border: '1px solid #2a3545',
          width: '100%',
          maxWidth: '380px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #2a3545',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>Partial Close</h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#8892a0' }}>
              {trade.symbol} - Position: {trade.quantity.toFixed(6)}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X size={20} color="#8892a0" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {error && (
            <div
              style={{
                padding: '10px 12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '13px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#8892a0', marginBottom: '6px' }}>
              Quantity to close
            </label>
            <input
              type="number"
              step="0.000001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              style={{
                width: '100%',
                background: '#0a0f18',
                border: '1px solid #2a3545',
                borderRadius: '6px',
                padding: '10px 12px',
                color: '#fff',
                fontSize: '14px',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            {percentButtons.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handlePercentClick(pct)}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'rgba(42, 53, 69, 0.5)',
                  border: '1px solid #2a3545',
                  borderRadius: '6px',
                  color: '#8892a0',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {pct}%
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px solid #2a3545',
                borderRadius: '6px',
                color: '#8892a0',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '10px 20px',
                background: isSubmitting ? '#2a3545' : '#f59e0b',
                border: 'none',
                borderRadius: '6px',
                color: isSubmitting ? '#8892a0' : '#000',
                fontSize: '14px',
                fontWeight: 500,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              Close Partial
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Confirmation Modal
interface ConfirmStopModalProps {
  trade: ActiveTrade;
  tradeValue: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function ConfirmStopModal({ trade, tradeValue, onConfirm, onCancel, isLoading }: ConfirmStopModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#111820',
          borderRadius: '12px',
          border: '1px solid #2a3545',
          width: '100%',
          maxWidth: '400px',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <AlertTriangle size={48} color="#f59e0b" style={{ marginBottom: '12px' }} />
          <h3 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Confirm Stop Trade</h3>
        </div>

        <p style={{ fontSize: '14px', color: '#c0c8d0', textAlign: 'center', marginBottom: '16px' }}>
          You are about to{' '}
          {trade.type === 'pending_order' ? 'cancel' : 'close'} a position worth{' '}
          <strong style={{ color: '#fff' }}>{formatPrice(tradeValue)}</strong>
        </p>

        <div
          style={{
            background: 'rgba(42, 53, 69, 0.3)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#8892a0', fontSize: '13px' }}>Symbol</span>
            <span style={{ color: '#fff', fontSize: '13px' }}>{trade.symbol}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#8892a0', fontSize: '13px' }}>Side</span>
            <span
              style={{
                color: trade.side === 'buy' ? '#00ff9f' : '#ef4444',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {trade.side.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8892a0', fontSize: '13px' }}>Quantity</span>
            <span style={{ color: '#fff', fontSize: '13px' }}>{trade.quantity}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '12px',
              background: 'transparent',
              border: '1px solid #2a3545',
              borderRadius: '8px',
              color: '#8892a0',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '12px',
              background: isLoading ? '#2a3545' : '#ef4444',
              border: 'none',
              borderRadius: '8px',
              color: isLoading ? '#8892a0' : '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            Confirm Stop
          </button>
        </div>
      </div>
    </div>
  );
}

// Trade Row Component
interface TradeRowProps {
  trade: ActiveTrade;
  onStop: (trade: ActiveTrade) => void;
  onEdit: (trade: ActiveTrade) => void;
  onPartialClose: (trade: ActiveTrade) => void;
  stoppingId: string | null;
}

const TradeRow = React.memo(function TradeRow({ trade, onStop, onEdit, onPartialClose, stoppingId }: TradeRowProps) {
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = () => {
    if (trade.binanceOrderId) {
      navigator.clipboard.writeText(trade.binanceOrderId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const pnlColor = trade.pnlDollar >= 0 ? '#00ff9f' : '#ef4444';
  const sideColor = trade.side === 'buy' ? '#00ff9f' : '#ef4444';

  return (
    <div
      style={{
        background: 'rgba(42, 53, 69, 0.3)',
        border: '1px solid #2a3545',
        borderRadius: '10px',
        padding: '16px',
      }}
    >
      {/* Header Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: trade.side === 'buy' ? 'rgba(0, 255, 159, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {trade.side === 'buy' ? (
              <TrendingUp size={16} color="#00ff9f" />
            ) : (
              <TrendingDown size={16} color="#ef4444" />
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>{trade.symbol}</span>
              <span
                style={{
                  padding: '2px 6px',
                  background: trade.side === 'buy' ? 'rgba(0, 255, 159, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: sideColor,
                }}
              >
                {trade.side.toUpperCase()}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  background: `${sourceColors[trade.source]}20`,
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: sourceColors[trade.source],
                }}
              >
                {sourceIcons[trade.source]}
                {trade.source}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#8892a0', marginTop: '2px' }}>
              {trade.quantity.toFixed(6)} @ {formatPrice(trade.entryPrice)}
            </div>
          </div>
        </div>

        {/* P&L Display */}
        {trade.type === 'position' && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: pnlColor }}>
              {formatPnl(trade.pnlDollar)}
            </div>
            <div style={{ fontSize: '12px', color: pnlColor }}>{formatPnlPercent(trade.pnlPercent)}</div>
          </div>
        )}
      </div>

      {/* Info Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        {trade.type === 'position' && (
          <div>
            <div style={{ fontSize: '11px', color: '#607080', marginBottom: '2px' }}>Current Price</div>
            <div style={{ fontSize: '13px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
              {formatPrice(trade.currentPrice)}
            </div>
          </div>
        )}

        {trade.stopLossPrice && (
          <div>
            <div style={{ fontSize: '11px', color: '#607080', marginBottom: '2px' }}>Stop Loss</div>
            <div style={{ fontSize: '13px', color: '#ef4444', fontFamily: 'JetBrains Mono, monospace' }}>
              {formatPrice(trade.stopLossPrice)}
            </div>
          </div>
        )}

        {trade.takeProfitPrice && (
          <div>
            <div style={{ fontSize: '11px', color: '#607080', marginBottom: '2px' }}>Take Profit</div>
            <div style={{ fontSize: '13px', color: '#00ff9f', fontFamily: 'JetBrains Mono, monospace' }}>
              {formatPrice(trade.takeProfitPrice)}
            </div>
          </div>
        )}

        {trade.trailingStopPct && (
          <div>
            <div style={{ fontSize: '11px', color: '#607080', marginBottom: '2px' }}>Trailing Stop</div>
            <div style={{ fontSize: '13px', color: '#f59e0b' }}>
              {trade.trailingStopPct}%
              {trade.trailingStopPrice && (
                <span style={{ color: '#8892a0', fontSize: '11px' }}>
                  {' '}
                  @ {formatPrice(trade.trailingStopPrice)}
                </span>
              )}
            </div>
          </div>
        )}

        {trade.type === 'position' && trade.timeInTrade > 0 && (
          <div>
            <div style={{ fontSize: '11px', color: '#607080', marginBottom: '2px' }}>Time in Trade</div>
            <div style={{ fontSize: '13px', color: '#8892a0', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} />
              {formatTimeInTrade(trade.timeInTrade)}
            </div>
          </div>
        )}
      </div>

      {/* Order ID */}
      {trade.binanceOrderId && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#607080', marginBottom: '2px' }}>Binance Order ID</div>
          <button
            onClick={handleCopyId}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              color: '#8892a0',
              fontFamily: 'JetBrains Mono, monospace',
            }}
            title="Click to copy"
          >
            {trade.binanceOrderId.substring(0, 12)}...
            {copiedId ? <Check size={12} color="#00ff9f" /> : <Copy size={12} />}
          </button>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={() => onStop(trade)}
          disabled={stoppingId === trade.id}
          style={{
            flex: 1,
            minWidth: '80px',
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '12px',
            fontWeight: 500,
            cursor: stoppingId === trade.id ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
        >
          {stoppingId === trade.id ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Square size={12} />
          )}
          {trade.type === 'pending_order' ? 'Cancel' : 'Stop'}
        </button>

        {trade.type === 'position' && (
          <>
            <button
              onClick={() => onEdit(trade)}
              style={{
                flex: 1,
                minWidth: '80px',
                padding: '8px 12px',
                background: 'rgba(96, 165, 250, 0.1)',
                border: '1px solid rgba(96, 165, 250, 0.3)',
                borderRadius: '6px',
                color: '#60a5fa',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Edit3 size={12} />
              SL/TP
            </button>

            <button
              onClick={() => onPartialClose(trade)}
              style={{
                flex: 1,
                minWidth: '80px',
                padding: '8px 12px',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '6px',
                color: '#f59e0b',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Scissors size={12} />
              Partial
            </button>
          </>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if relevant data changed
  const prevTrade = prevProps.trade;
  const nextTrade = nextProps.trade;
  return (
    prevTrade.id === nextTrade.id &&
    prevTrade.currentPrice === nextTrade.currentPrice &&
    prevTrade.pnlDollar === nextTrade.pnlDollar &&
    prevTrade.pnlPercent === nextTrade.pnlPercent &&
    prevTrade.stopLossPrice === nextTrade.stopLossPrice &&
    prevTrade.takeProfitPrice === nextTrade.takeProfitPrice &&
    prevTrade.trailingStopPrice === nextTrade.trailingStopPrice &&
    prevTrade.trailingStopPct === nextTrade.trailingStopPct &&
    prevTrade.timeInTrade === nextTrade.timeInTrade &&
    prevProps.stoppingId === nextProps.stoppingId
  );
});

// Main Component
function ActiveTab() {
  const [data, setData] = useState<ActiveTradesResponse>({ openPositions: [], pendingOrders: [] });
  const [conditionalOrders, setConditionalOrders] = useState<ConditionalOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [editingTrade, setEditingTrade] = useState<ActiveTrade | null>(null);
  const [partialCloseTrade, setPartialCloseTrade] = useState<ActiveTrade | null>(null);
  const [confirmStop, setConfirmStop] = useState<{ trade: ActiveTrade; tradeValue: number } | null>(null);
  const hasLoadedRef = React.useRef(false);

  const loadData = useCallback(async (isManualRefresh = false) => {
    try {
      // Only show full loading on initial load
      if (!hasLoadedRef.current) {
        setIsLoading(true);
      } else if (isManualRefresh) {
        setIsRefreshing(true);
      }
      setError(null);
      const [activeTrades, rules] = await Promise.all([
        tradingApi.getActiveTrades(),
        tradingApi.getRules('active'),
      ]);
      setData(activeTrades);
      setConditionalOrders(rules);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load active trades');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleCancelRule = async (id: string) => {
    setCancellingId(id);
    try {
      await tradingApi.cancelRule(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel rule');
    } finally {
      setCancellingId(null);
    }
  };

  useEffect(() => {
    loadData();
    // Auto-refresh every 5 seconds for real-time updates (silent refresh)
    const interval = setInterval(() => loadData(false), 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleStop = async (trade: ActiveTrade, skipConfirmation = false) => {
    setStoppingId(trade.id);
    try {
      const result = await tradingApi.stopTrade(trade.id, skipConfirmation);
      if (result.requiresConfirmation && result.tradeValue) {
        setConfirmStop({ trade, tradeValue: result.tradeValue });
      } else if (result.success) {
        await loadData();
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop trade');
    } finally {
      setStoppingId(null);
    }
  };

  const handleConfirmStop = async () => {
    if (!confirmStop) return;
    setStoppingId(confirmStop.trade.id);
    try {
      const result = await tradingApi.stopTrade(confirmStop.trade.id, true);
      if (result.success) {
        await loadData();
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop trade');
    } finally {
      setStoppingId(null);
      setConfirmStop(null);
    }
  };

  // Sort positions by P&L ascending (worst first)
  const sortedPositions = useMemo(() => {
    return [...data.openPositions].sort((a, b) => a.pnlDollar - b.pnlDollar);
  }, [data.openPositions]);

  const totalPositions = data.openPositions.length;
  const totalPending = data.pendingOrders.length;
  const totalConditional = conditionalOrders.length;
  const totalPnl = data.openPositions.reduce((sum, t) => sum + t.pnlDollar, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Activity size={20} color="#00ff9f" />
          <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Active Trades</h2>
          {!isLoading && (totalPositions > 0 || totalPending > 0 || totalConditional > 0) && (
            <span
              style={{
                padding: '4px 10px',
                background: 'rgba(0, 255, 159, 0.15)',
                borderRadius: '12px',
                fontSize: '12px',
                color: '#00ff9f',
              }}
            >
              {totalPositions + totalPending} active
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {!isLoading && totalPnl !== 0 && (
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: totalPnl >= 0 ? '#00ff9f' : '#ef4444',
              }}
            >
              Total: {formatPnl(totalPnl)}
            </span>
          )}
          <button
            onClick={() => loadData(true)}
            disabled={isLoading || isRefreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              background: 'rgba(42, 53, 69, 0.5)',
              border: '1px solid #2a3545',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
            title="Refresh"
          >
            <RefreshCw size={16} color="#8892a0" className={isLoading || isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: '#ef4444',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={16} />
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
            }}
          >
            <X size={14} color="#ef4444" />
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: '#8892a0',
          }}
        >
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && totalPositions === 0 && totalPending === 0 && totalConditional === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#8892a0',
          }}
        >
          <Activity size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: '#c0c8d0' }}>No active trades</p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Open positions and pending orders will appear here
          </p>
        </div>
      )}

      {/* Pending Orders Section */}
      {!isLoading && totalPending > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            <Clock size={16} color="#f59e0b" />
            <h3 style={{ margin: 0, fontSize: '14px', color: '#fff' }}>
              Pending Orders ({totalPending})
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.pendingOrders.map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                onStop={handleStop}
                onEdit={setEditingTrade}
                onPartialClose={setPartialCloseTrade}
                stoppingId={stoppingId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Open Positions Section */}
      {!isLoading && totalPositions > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            <Zap size={16} color="#00ff9f" />
            <h3 style={{ margin: 0, fontSize: '14px', color: '#fff' }}>
              Open Positions ({totalPositions})
            </h3>
            <span style={{ fontSize: '11px', color: '#607080' }}>sorted by P&L (worst first)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sortedPositions.map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                onStop={handleStop}
                onEdit={setEditingTrade}
                onPartialClose={setPartialCloseTrade}
                stoppingId={stoppingId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Conditional Orders Section */}
      {!isLoading && totalConditional > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            <TrendingUp size={16} color="#a855f7" />
            <h3 style={{ margin: 0, fontSize: '14px', color: '#fff' }}>
              Conditional Orders ({totalConditional})
            </h3>
            <span style={{ fontSize: '11px', color: '#607080' }}>waiting to trigger</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {conditionalOrders.map((order) => (
              <div
                key={order.id}
                style={{
                  background: 'rgba(168, 85, 247, 0.08)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  borderRadius: '12px',
                  padding: '16px',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
                        {order.symbol.replace('_USD', '').replace('USDT', '').replace('USDC', '')}
                      </span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          background: order.action.side === 'buy' ? 'rgba(0, 255, 159, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: order.action.side === 'buy' ? '#00ff9f' : '#ef4444',
                        }}
                      >
                        {order.action.side}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#8892a0' }}>
                      When price {order.condition === 'above' ? 'goes above' : order.condition === 'below' ? 'drops below' : order.condition === 'crosses_up' ? 'crosses up' : 'crosses down'}{' '}
                      <span style={{ color: '#a855f7', fontWeight: 500 }}>{formatPrice(order.triggerPrice)}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: '#607080' }}>
                      {new Date(order.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Order Details */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: '#607080', marginBottom: '2px' }}>Amount</div>
                    <div style={{ fontSize: '13px', color: '#c0c8d0' }}>
                      {order.action.amountType === 'quote' ? `$${order.action.amount}` : order.action.amountType === 'percentage' ? `${order.action.amount}%` : order.action.amount}
                    </div>
                  </div>
                  {order.action.stopLoss && (
                    <div>
                      <div style={{ fontSize: '10px', color: '#607080', marginBottom: '2px' }}>Stop Loss</div>
                      <div style={{ fontSize: '13px', color: '#ef4444' }}>{formatPrice(order.action.stopLoss)}</div>
                    </div>
                  )}
                  {order.action.takeProfit && (
                    <div>
                      <div style={{ fontSize: '10px', color: '#607080', marginBottom: '2px' }}>Take Profit</div>
                      <div style={{ fontSize: '13px', color: '#00ff9f' }}>{formatPrice(order.action.takeProfit)}</div>
                    </div>
                  )}
                </div>

                {/* Order ID + Cancel Button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '10px', color: '#607080', fontFamily: 'monospace' }}>
                    ID: {order.id.slice(0, 8)}...
                  </div>
                  <button
                    onClick={() => handleCancelRule(order.id)}
                    disabled={cancellingId === order.id}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: cancellingId === order.id ? 'not-allowed' : 'pointer',
                      opacity: cancellingId === order.id ? 0.5 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {cancellingId === order.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {editingTrade && (
        <EditSLTPModal trade={editingTrade} onClose={() => setEditingTrade(null)} onSaved={loadData} />
      )}

      {partialCloseTrade && (
        <PartialCloseModal
          trade={partialCloseTrade}
          onClose={() => setPartialCloseTrade(null)}
          onClosed={loadData}
        />
      )}

      {confirmStop && (
        <ConfirmStopModal
          trade={confirmStop.trade}
          tradeValue={confirmStop.tradeValue}
          onConfirm={handleConfirmStop}
          onCancel={() => setConfirmStop(null)}
          isLoading={stoppingId === confirmStop.trade.id}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default React.memo(ActiveTab);
