'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ListChecks,
  Plus,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { tradingApi, type ConditionalOrder, type CreateConditionalOrderParams } from '@/lib/api';

type StatusFilter = 'all' | 'active' | 'triggered' | 'cancelled' | 'expired';

const statusColors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  active: { bg: 'rgba(0, 255, 159, 0.15)', text: '#00ff9f', icon: <Clock size={12} /> },
  triggered: { bg: 'rgba(96, 165, 250, 0.15)', text: '#60a5fa', icon: <CheckCircle2 size={12} /> },
  cancelled: { bg: 'rgba(107, 114, 128, 0.15)', text: '#6b7280', icon: <XCircle size={12} /> },
  expired: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', icon: <AlertTriangle size={12} /> },
};

const conditionLabels: Record<string, string> = {
  above: 'price >=',
  below: 'price <=',
  crosses_up: 'crosses above',
  crosses_down: 'crosses below',
};

interface CreateRuleModalProps {
  onClose: () => void;
  onCreated: () => void;
  symbols: string[];
}

function CreateRuleModal({ onClose, onCreated, symbols }: CreateRuleModalProps) {
  const [symbol, setSymbol] = useState(symbols[0] || 'BCHUSDC');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [amountType, setAmountType] = useState<'percentage' | 'quantity' | 'quote'>('percentage');
  const [amount, setAmount] = useState('100');
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(false);
  const [trailingStopPct, setTrailingStopPct] = useState('2');
  const [stopLossEnabled, setStopLossEnabled] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfit, setTakeProfit] = useState('');
  const [expiresEnabled, setExpiresEnabled] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState('24');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!triggerPrice || parseFloat(triggerPrice) <= 0) {
      setError('Please enter a valid trigger price');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsSubmitting(true);

    try {
      const params: CreateConditionalOrderParams = {
        symbol,
        condition,
        triggerPrice: parseFloat(triggerPrice),
        action: {
          side,
          type: 'market',
          amountType,
          amount: parseFloat(amount),
          ...(trailingStopEnabled && trailingStopPct ? { trailingStopPct: parseFloat(trailingStopPct) } : {}),
          ...(stopLossEnabled && stopLoss ? { stopLoss: parseFloat(stopLoss) } : {}),
          ...(takeProfitEnabled && takeProfit ? { takeProfit: parseFloat(takeProfit) } : {}),
        },
        ...(expiresEnabled && expiresInHours ? { expiresInHours: parseFloat(expiresInHours) } : {}),
      };

      await tradingApi.createRule(params);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule');
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
          maxWidth: '480px',
          maxHeight: '90vh',
          overflow: 'auto',
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
          <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>Create Trade Rule</h3>
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

          {/* Symbol */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#8892a0', marginBottom: '6px' }}>
              Symbol
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              style={{
                width: '100%',
                background: '#0a0f18',
                border: '1px solid #2a3545',
                borderRadius: '6px',
                padding: '10px 12px',
                color: '#fff',
                fontSize: '14px',
              }}
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Condition */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#8892a0', marginBottom: '6px' }}>
              Condition
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as 'above' | 'below')}
                style={{
                  flex: 1,
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              >
                <option value="above">When price is above</option>
                <option value="below">When price is below</option>
              </select>
              <div style={{ position: 'relative', flex: 1 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#8892a0',
                  }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value)}
                  placeholder="650.00"
                  style={{
                    width: '100%',
                    background: '#0a0f18',
                    border: '1px solid #2a3545',
                    borderRadius: '6px',
                    padding: '10px 12px 10px 24px',
                    color: '#fff',
                    fontSize: '14px',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Action */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#8892a0', marginBottom: '6px' }}>
              Action
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}
                style={{
                  width: '100px',
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: side === 'buy' ? '#00ff9f' : '#ef4444',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                <option value="buy">BUY</option>
                <option value="sell">SELL</option>
              </select>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
                style={{
                  flex: 1,
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
              <select
                value={amountType}
                onChange={(e) => setAmountType(e.target.value as 'percentage' | 'quantity' | 'quote')}
                style={{
                  width: '100px',
                  background: '#0a0f18',
                  border: '1px solid #2a3545',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              >
                <option value="percentage">%</option>
                <option value="quantity">qty</option>
                <option value="quote">USD</option>
              </select>
            </div>
          </div>

          {/* Exit Strategy */}
          <div
            style={{
              marginBottom: '16px',
              padding: '12px',
              background: 'rgba(42, 53, 69, 0.3)',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '12px', color: '#8892a0', marginBottom: '12px' }}>
              Exit Strategy (optional)
            </div>

            {/* Trailing Stop */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={trailingStopEnabled}
                onChange={(e) => setTrailingStopEnabled(e.target.checked)}
                style={{ accentColor: '#00ff9f' }}
              />
              <span style={{ fontSize: '13px', color: '#c0c8d0', flex: 1 }}>Trailing Stop</span>
              {trailingStopEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    step="0.1"
                    value={trailingStopPct}
                    onChange={(e) => setTrailingStopPct(e.target.value)}
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

            {/* Stop Loss */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={stopLossEnabled}
                onChange={(e) => setStopLossEnabled(e.target.checked)}
                style={{ accentColor: '#00ff9f' }}
              />
              <span style={{ fontSize: '13px', color: '#c0c8d0', flex: 1 }}>Stop Loss at</span>
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
                      width: '80px',
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
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={takeProfitEnabled}
                onChange={(e) => setTakeProfitEnabled(e.target.checked)}
                style={{ accentColor: '#00ff9f' }}
              />
              <span style={{ fontSize: '13px', color: '#c0c8d0', flex: 1 }}>Take Profit at</span>
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
                      width: '80px',
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
          </div>

          {/* Expiration */}
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
              checked={expiresEnabled}
              onChange={(e) => setExpiresEnabled(e.target.checked)}
              style={{ accentColor: '#00ff9f' }}
            />
            <span style={{ fontSize: '13px', color: '#c0c8d0' }}>Expires in</span>
            {expiresEnabled && (
              <>
                <input
                  type="number"
                  step="1"
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(e.target.value)}
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
                <span style={{ fontSize: '13px', color: '#8892a0' }}>hours</span>
              </>
            )}
          </label>

          {/* Actions */}
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
              Create Rule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RulesTab() {
  const [rules, setRules] = useState<ConditionalOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const symbols = ['BCHUSDC', 'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'DOGEUSDC', 'XRPUSDC'];

  const loadRules = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await tradingApi.getRules(statusFilter === 'all' ? undefined : statusFilter);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const handleCancel = async (id: string) => {
    setCancelingId(id);
    try {
      await tradingApi.cancelRule(id);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel rule');
    } finally {
      setCancelingId(null);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(price);
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const filteredRules = rules;

  return (
    <div style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ListChecks size={20} color="#00ff9f" />
          <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>Trade Rules</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={loadRules}
            disabled={isLoading}
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
            <RefreshCw size={16} color="#8892a0" className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              background: '#00ff9f',
              border: 'none',
              borderRadius: '8px',
              color: '#000',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <Plus size={16} />
            New Rule
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          flexWrap: 'wrap',
        }}
      >
        {(['all', 'active', 'triggered', 'cancelled', 'expired'] as StatusFilter[]).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '6px 14px',
              background: statusFilter === status ? 'rgba(0, 255, 159, 0.15)' : 'rgba(42, 53, 69, 0.3)',
              border: `1px solid ${statusFilter === status ? '#00ff9f' : '#2a3545'}`,
              borderRadius: '16px',
              color: statusFilter === status ? '#00ff9f' : '#8892a0',
              fontSize: '12px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {status}
          </button>
        ))}
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
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={16} />
          {error}
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
      {!isLoading && filteredRules.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#8892a0',
          }}
        >
          <ListChecks size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: '#c0c8d0' }}>No trade rules found</p>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Create a rule to automate trades based on price conditions
          </p>
        </div>
      )}

      {/* Rules List */}
      {!isLoading && filteredRules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredRules.map((rule) => {
            const statusStyle = statusColors[rule.status] || statusColors.active;
            const isAbove = rule.condition === 'above' || rule.condition === 'crosses_up';

            return (
              <div
                key={rule.id}
                style={{
                  background: 'rgba(42, 53, 69, 0.3)',
                  border: '1px solid #2a3545',
                  borderRadius: '10px',
                  padding: '16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        background: statusStyle.bg,
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: statusStyle.text,
                        textTransform: 'uppercase',
                      }}
                    >
                      {statusStyle.icon}
                      {rule.status}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{rule.symbol}</span>
                  </div>
                  {rule.status === 'active' && (
                    <button
                      onClick={() => handleCancel(rule.id)}
                      disabled={cancelingId === rule.id}
                      style={{
                        padding: '4px 10px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '4px',
                        color: '#ef4444',
                        fontSize: '11px',
                        cursor: cancelingId === rule.id ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {cancelingId === rule.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <X size={12} />
                      )}
                      Cancel
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  {isAbove ? (
                    <TrendingUp size={14} color="#00ff9f" />
                  ) : (
                    <TrendingDown size={14} color="#ef4444" />
                  )}
                  <span style={{ fontSize: '13px', color: '#c0c8d0' }}>
                    When {conditionLabels[rule.condition]} {formatPrice(rule.triggerPrice)} →{' '}
                    <span
                      style={{
                        fontWeight: 500,
                        color: rule.action.side === 'buy' ? '#00ff9f' : '#ef4444',
                      }}
                    >
                      {rule.action.side.toUpperCase()}
                    </span>{' '}
                    {rule.action.amount}
                    {rule.action.amountType === 'percentage' ? '%' : rule.action.amountType === 'quote' ? ' USD' : ''}{' '}
                    ({rule.action.type})
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11px', color: '#607080' }}>
                  {rule.action.trailingStopPct && (
                    <span
                      style={{
                        padding: '2px 6px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        borderRadius: '3px',
                        color: '#ef4444',
                      }}
                    >
                      Trailing SL: {rule.action.trailingStopPct}%
                    </span>
                  )}
                  {rule.action.stopLoss && (
                    <span
                      style={{
                        padding: '2px 6px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        borderRadius: '3px',
                        color: '#ef4444',
                      }}
                    >
                      SL: {formatPrice(rule.action.stopLoss)}
                    </span>
                  )}
                  {rule.action.takeProfit && (
                    <span
                      style={{
                        padding: '2px 6px',
                        background: 'rgba(0, 255, 159, 0.1)',
                        borderRadius: '3px',
                        color: '#00ff9f',
                      }}
                    >
                      TP: {formatPrice(rule.action.takeProfit)}
                    </span>
                  )}
                  <span>
                    {rule.status === 'triggered' && rule.triggeredAt
                      ? `Triggered: ${formatTimeAgo(rule.triggeredAt)}`
                      : `Created: ${formatTimeAgo(rule.createdAt)}`}
                  </span>
                  {rule.expiresAt && rule.status === 'active' && (
                    <span style={{ color: '#f59e0b' }}>
                      Expires: {new Date(rule.expiresAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateRuleModal
          onClose={() => setShowCreateModal(false)}
          onCreated={loadRules}
          symbols={symbols}
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
