'use client';

import React, { useState, useCallback } from 'react';
import {
  X,
  Trash2,
  Save,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
  DollarSign,
  Activity,
} from 'lucide-react';

// Condition types
export interface RuleCondition {
  id: string;
  type: 'price' | 'indicator' | 'time' | 'change';
  symbol?: string;
  indicator?: 'rsi' | 'macd' | 'bollinger_upper' | 'bollinger_lower' | 'ema_20' | 'ema_50' | 'volume';
  timeframe?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  operator: '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below';
  value: number;
  // For time conditions
  dayOfWeek?: number; // 0-6
  hour?: number;
  minute?: number;
}

// Action types
export interface RuleAction {
  id: string;
  type: 'buy' | 'sell' | 'alert';
  symbol?: string;
  amountType: 'quote' | 'base' | 'percent';
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

// Complete rule
export interface TradingRule {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionLogic: 'AND' | 'OR';
  conditions: RuleCondition[];
  actions: RuleAction[];
  maxExecutions?: number;
  cooldownMinutes?: number;
}

interface RuleBuilderProps {
  rule?: TradingRule;
  onSave: (rule: TradingRule) => Promise<void>;
  onClose: () => void;
  symbols?: string[];
}

const INDICATORS = [
  { value: 'rsi', label: 'RSI (14)' },
  { value: 'macd', label: 'MACD Signal' },
  { value: 'bollinger_upper', label: 'Bollinger Upper' },
  { value: 'bollinger_lower', label: 'Bollinger Lower' },
  { value: 'ema_20', label: 'EMA 20' },
  { value: 'ema_50', label: 'EMA 50' },
  { value: 'volume', label: 'Volume' },
];

const TIMEFRAMES = [
  { value: '1m', label: '1 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hour' },
  { value: '1d', label: '1 day' },
];

const OPERATORS = [
  { value: '>', label: 'Greater than' },
  { value: '<', label: 'Less than' },
  { value: '>=', label: 'Greater or equal' },
  { value: '<=', label: 'Less or equal' },
  { value: 'crosses_above', label: 'Crosses above' },
  { value: 'crosses_below', label: 'Crosses below' },
];

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT'];

export default function RuleBuilder({ rule, onSave, onClose, symbols = DEFAULT_SYMBOLS }: RuleBuilderProps) {
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [conditionLogic, setConditionLogic] = useState<'AND' | 'OR'>(rule?.conditionLogic || 'AND');
  const [conditions, setConditions] = useState<RuleCondition[]>(rule?.conditions || []);
  const [actions, setActions] = useState<RuleAction[]>(rule?.actions || []);
  const [maxExecutions, setMaxExecutions] = useState(rule?.maxExecutions || 0);
  const [cooldownMinutes, setCooldownMinutes] = useState(rule?.cooldownMinutes || 5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate unique ID
  const generateId = () => Math.random().toString(36).substring(2, 9);

  // Add condition
  const addCondition = useCallback((type: RuleCondition['type']) => {
    const newCondition: RuleCondition = {
      id: generateId(),
      type,
      symbol: 'BTCUSDT',
      operator: '<',
      value: type === 'indicator' ? 30 : 50000,
      indicator: type === 'indicator' ? 'rsi' : undefined,
      timeframe: '5m',
    };
    setConditions(prev => [...prev, newCondition]);
  }, []);

  // Update condition
  const updateCondition = useCallback((id: string, updates: Partial<RuleCondition>) => {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);

  // Remove condition
  const removeCondition = useCallback((id: string) => {
    setConditions(prev => prev.filter(c => c.id !== id));
  }, []);

  // Add action
  const addAction = useCallback((type: RuleAction['type']) => {
    const newAction: RuleAction = {
      id: generateId(),
      type,
      symbol: 'BTCUSDT',
      amountType: 'quote',
      amount: 50,
      orderType: 'market',
    };
    setActions(prev => [...prev, newAction]);
  }, []);

  // Update action
  const updateAction = useCallback((id: string, updates: Partial<RuleAction>) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  // Remove action
  const removeAction = useCallback((id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  }, []);

  // Save rule
  const handleSave = async () => {
    if (!name.trim()) {
      setError('Rule name is required');
      return;
    }
    if (conditions.length === 0) {
      setError('At least one condition is required');
      return;
    }
    if (actions.length === 0) {
      setError('At least one action is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({
        id: rule?.id,
        name,
        description,
        enabled: true,
        conditionLogic,
        conditions,
        actions,
        maxExecutions: maxExecutions > 0 ? maxExecutions : undefined,
        cooldownMinutes,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  // Render condition icon
  const getConditionIcon = (type: string) => {
    switch (type) {
      case 'price': return <DollarSign size={14} />;
      case 'indicator': return <Activity size={14} />;
      case 'time': return <Clock size={14} />;
      case 'change': return <TrendingUp size={14} />;
      default: return <Zap size={14} />;
    }
  };

  return (
    <div className="terminal-modal-overlay" onClick={onClose}>
      <div
        className="terminal-modal"
        style={{ maxWidth: '700px', maxHeight: '90vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="terminal-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={20} style={{ color: 'var(--terminal-accent)' }} />
            {rule ? 'Edit Rule' : 'Create Trading Rule'}
          </h2>
          <button onClick={onClose} className="terminal-btn terminal-btn-secondary" style={{ padding: '0.25rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="terminal-modal-body" style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              background: 'rgba(255, 82, 82, 0.1)',
              border: '1px solid var(--terminal-negative)',
              borderRadius: '4px',
              padding: '0.75rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--terminal-negative)',
            }}>
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="terminal-label">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., RSI Oversold Buy"
              className="terminal-input"
              style={{ width: '100%', marginBottom: '0.75rem' }}
            />

            <label className="terminal-label">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g., Buy when RSI drops below 30"
              className="terminal-input"
              style={{ width: '100%' }}
            />
          </div>

          {/* Conditions */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label className="terminal-label" style={{ margin: 0 }}>Conditions</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)' }}>Logic:</span>
                <select
                  value={conditionLogic}
                  onChange={e => setConditionLogic(e.target.value as 'AND' | 'OR')}
                  className="terminal-select"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  <option value="AND">ALL (AND)</option>
                  <option value="OR">ANY (OR)</option>
                </select>
              </div>
            </div>

            {/* Condition list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {conditions.map((condition, idx) => (
                <div
                  key={condition.id}
                  style={{
                    background: 'var(--terminal-surface-hover)',
                    border: '1px solid var(--terminal-border)',
                    borderRadius: '4px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ color: 'var(--terminal-accent)' }}>{getConditionIcon(condition.type)}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase' }}>
                      {condition.type} Condition
                    </span>
                    {idx > 0 && (
                      <span style={{
                        fontSize: '0.65rem',
                        background: 'var(--terminal-accent)',
                        color: '#000',
                        padding: '0.125rem 0.375rem',
                        borderRadius: '3px',
                      }}>
                        {conditionLogic}
                      </span>
                    )}
                    <button
                      onClick={() => removeCondition(condition.id)}
                      className="terminal-btn terminal-btn-secondary"
                      style={{ marginLeft: 'auto', padding: '0.25rem' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* Symbol select */}
                    {condition.type !== 'time' && (
                      <select
                        value={condition.symbol}
                        onChange={e => updateCondition(condition.id, { symbol: e.target.value })}
                        className="terminal-select"
                        style={{ width: '120px' }}
                      >
                        {symbols.map(s => (
                          <option key={s} value={s}>{s.replace('USDT', '')}</option>
                        ))}
                      </select>
                    )}

                    {/* Indicator select */}
                    {condition.type === 'indicator' && (
                      <>
                        <select
                          value={condition.indicator}
                          onChange={e => updateCondition(condition.id, { indicator: e.target.value as RuleCondition['indicator'] })}
                          className="terminal-select"
                          style={{ width: '140px' }}
                        >
                          {INDICATORS.map(i => (
                            <option key={i.value} value={i.value}>{i.label}</option>
                          ))}
                        </select>
                        <select
                          value={condition.timeframe}
                          onChange={e => updateCondition(condition.id, { timeframe: e.target.value as RuleCondition['timeframe'] })}
                          className="terminal-select"
                          style={{ width: '80px' }}
                        >
                          {TIMEFRAMES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </>
                    )}

                    {/* Operator */}
                    <select
                      value={condition.operator}
                      onChange={e => updateCondition(condition.id, { operator: e.target.value as RuleCondition['operator'] })}
                      className="terminal-select"
                      style={{ width: '130px' }}
                    >
                      {OPERATORS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>

                    {/* Value */}
                    <input
                      type="number"
                      value={condition.value}
                      onChange={e => updateCondition(condition.id, { value: parseFloat(e.target.value) || 0 })}
                      className="terminal-input"
                      style={{ width: '100px' }}
                    />

                    {condition.type === 'change' && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--terminal-text-muted)', alignSelf: 'center' }}>%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add condition buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => addCondition('price')}
                className="terminal-btn terminal-btn-secondary"
                style={{ fontSize: '0.75rem' }}
              >
                <DollarSign size={12} /> Price
              </button>
              <button
                onClick={() => addCondition('indicator')}
                className="terminal-btn terminal-btn-secondary"
                style={{ fontSize: '0.75rem' }}
              >
                <Activity size={12} /> Indicator
              </button>
              <button
                onClick={() => addCondition('change')}
                className="terminal-btn terminal-btn-secondary"
                style={{ fontSize: '0.75rem' }}
              >
                <TrendingDown size={12} /> % Change
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="terminal-label">Actions</label>

            {/* Action list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {actions.map(action => (
                <div
                  key={action.id}
                  style={{
                    background: 'var(--terminal-surface-hover)',
                    border: '1px solid var(--terminal-border)',
                    borderRadius: '4px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{
                      color: action.type === 'buy' ? 'var(--terminal-positive)' :
                        action.type === 'sell' ? 'var(--terminal-negative)' : 'var(--terminal-warning)'
                    }}>
                      {action.type === 'buy' ? <TrendingUp size={14} /> :
                        action.type === 'sell' ? <TrendingDown size={14} /> : <AlertTriangle size={14} />}
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase' }}>
                      {action.type} Action
                    </span>
                    <button
                      onClick={() => removeAction(action.id)}
                      className="terminal-btn terminal-btn-secondary"
                      style={{ marginLeft: 'auto', padding: '0.25rem' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {action.type !== 'alert' && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {/* Symbol */}
                      <select
                        value={action.symbol}
                        onChange={e => updateAction(action.id, { symbol: e.target.value })}
                        className="terminal-select"
                        style={{ width: '120px' }}
                      >
                        {symbols.map(s => (
                          <option key={s} value={s}>{s.replace('USDT', '')}</option>
                        ))}
                      </select>

                      {/* Order type */}
                      <select
                        value={action.orderType}
                        onChange={e => updateAction(action.id, { orderType: e.target.value as 'market' | 'limit' })}
                        className="terminal-select"
                        style={{ width: '100px' }}
                      >
                        <option value="market">Market</option>
                        <option value="limit">Limit</option>
                      </select>

                      {/* Amount type */}
                      <select
                        value={action.amountType}
                        onChange={e => updateAction(action.id, { amountType: e.target.value as 'quote' | 'base' | 'percent' })}
                        className="terminal-select"
                        style={{ width: '100px' }}
                      >
                        <option value="quote">$ Amount</option>
                        <option value="base">Quantity</option>
                        <option value="percent">% Portfolio</option>
                      </select>

                      {/* Amount */}
                      <input
                        type="number"
                        value={action.amount}
                        onChange={e => updateAction(action.id, { amount: parseFloat(e.target.value) || 0 })}
                        className="terminal-input"
                        style={{ width: '80px' }}
                      />
                    </div>
                  )}

                  {/* Stop Loss / Take Profit */}
                  {action.type !== 'alert' && (
                    <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <label style={{ color: 'var(--terminal-text-muted)' }}>SL %:</label>
                        <input
                          type="number"
                          value={action.stopLoss || ''}
                          onChange={e => updateAction(action.id, { stopLoss: parseFloat(e.target.value) || undefined })}
                          placeholder="5"
                          className="terminal-input"
                          style={{ width: '60px', padding: '0.25rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <label style={{ color: 'var(--terminal-text-muted)' }}>TP %:</label>
                        <input
                          type="number"
                          value={action.takeProfit || ''}
                          onChange={e => updateAction(action.id, { takeProfit: parseFloat(e.target.value) || undefined })}
                          placeholder="10"
                          className="terminal-input"
                          style={{ width: '60px', padding: '0.25rem' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => addAction('buy')}
                className="terminal-btn terminal-btn-secondary"
                style={{ fontSize: '0.75rem' }}
              >
                <TrendingUp size={12} /> Buy
              </button>
              <button
                onClick={() => addAction('sell')}
                className="terminal-btn terminal-btn-secondary"
                style={{ fontSize: '0.75rem' }}
              >
                <TrendingDown size={12} /> Sell
              </button>
              <button
                onClick={() => addAction('alert')}
                className="terminal-btn terminal-btn-secondary"
                style={{ fontSize: '0.75rem' }}
              >
                <AlertTriangle size={12} /> Alert
              </button>
            </div>
          </div>

          {/* Advanced Options */}
          <div style={{
            background: 'var(--terminal-surface-hover)',
            border: '1px solid var(--terminal-border)',
            borderRadius: '4px',
            padding: '0.75rem',
          }}>
            <label className="terminal-label" style={{ marginBottom: '0.5rem' }}>Advanced Options</label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                  Max Executions (0 = unlimited)
                </label>
                <input
                  type="number"
                  value={maxExecutions}
                  onChange={e => setMaxExecutions(parseInt(e.target.value) || 0)}
                  className="terminal-input"
                  style={{ width: '100px' }}
                  min={0}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--terminal-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                  Cooldown (minutes)
                </label>
                <input
                  type="number"
                  value={cooldownMinutes}
                  onChange={e => setCooldownMinutes(parseInt(e.target.value) || 0)}
                  className="terminal-input"
                  style={{ width: '100px' }}
                  min={0}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="terminal-modal-footer">
          <button onClick={onClose} className="terminal-btn terminal-btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="terminal-btn terminal-btn-primary"
          >
            {saving ? 'Saving...' : <><Save size={14} /> Save Rule</>}
          </button>
        </div>
      </div>
    </div>
  );
}
