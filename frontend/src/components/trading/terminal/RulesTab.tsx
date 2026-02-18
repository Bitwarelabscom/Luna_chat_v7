'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileCode2, Plus, Play, Square, Trash2, Zap, Clock, AlertTriangle, Edit2, RefreshCw } from 'lucide-react';
import { RuleBuilder, type TradingRule } from './rules';
import { tradingApi, type TradingRuleRecord } from '@/lib/api';

interface DisplayRule {
  id: string;
  name: string;
  description: string;
  type: 'indicator' | 'price' | 'time' | 'composite';
  enabled: boolean;
  conditions: string[];
  actions: string[];
  lastTriggered?: string;
  triggerCount: number;
  createdBy: 'user' | 'ai';
  // Store full rule data for editing
  fullRule?: TradingRule;
}

interface RulesTabProps {
  onRuleCreated?: () => void;
}

export default function RulesTab({ onRuleCreated }: RulesTabProps) {
  const [rules, setRules] = useState<DisplayRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<TradingRule | undefined>(undefined);

  // Convert TradingRule to API TradingRuleRecord (for saving)
  const tradingRuleToApiRecord = (rule: TradingRule): TradingRuleRecord => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    conditionLogic: rule.conditionLogic,
    conditions: rule.conditions.map(c => ({
      id: c.id,
      type: c.type,
      symbol: c.symbol,
      indicator: c.indicator,
      timeframe: c.timeframe,
      operator: c.operator,
      value: c.value,
    })),
    actions: rule.actions.map(a => ({
      id: a.id,
      type: a.type,
      symbol: a.symbol,
      amountType: a.amountType,
      amount: a.amount,
      orderType: a.orderType,
      limitPrice: a.limitPrice,
      stopLoss: a.stopLoss,
      takeProfit: a.takeProfit,
    })),
    maxExecutions: rule.maxExecutions,
    cooldownMinutes: rule.cooldownMinutes,
  });

  // Convert API TradingRuleRecord to TradingRule (for editing)
  const apiRuleToTradingRule = (r: TradingRuleRecord): TradingRule => ({
    id: r.id,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    conditionLogic: r.conditionLogic,
    conditions: r.conditions.map(c => ({
      ...c,
      indicator: c.indicator as TradingRule['conditions'][0]['indicator'],
      timeframe: c.timeframe as TradingRule['conditions'][0]['timeframe'],
      operator: c.operator as TradingRule['conditions'][0]['operator'],
    })),
    actions: r.actions as TradingRule['actions'],
    maxExecutions: r.maxExecutions,
    cooldownMinutes: r.cooldownMinutes,
  });

  // Convert TradingRule to DisplayRule
  const convertToDisplayRule = (rule: TradingRule | TradingRuleRecord): DisplayRule => {
    // Determine type from conditions
    let type: DisplayRule['type'] = 'composite';
    if (rule.conditions.length === 1) {
      const cond = rule.conditions[0];
      if (cond.type === 'indicator') type = 'indicator';
      else if (cond.type === 'price') type = 'price';
      else if (cond.type === 'time') type = 'time';
    }

    // Format conditions for display
    const conditionStrings = rule.conditions.map(c => {
      if (c.type === 'indicator') {
        return `${c.indicator?.toUpperCase() || 'IND'}(${c.timeframe}) ${c.operator} ${c.value}`;
      } else if (c.type === 'price') {
        return `${c.symbol?.replace('USDT', '') || ''} Price ${c.operator} $${c.value}`;
      } else if (c.type === 'change') {
        return `${c.symbol?.replace('USDT', '') || ''} Change ${c.operator} ${c.value}%`;
      } else if (c.type === 'time') {
        return `Time condition`;
      }
      return `${c.type} ${c.operator} ${c.value}`;
    });

    // Format actions for display
    const actionStrings = rule.actions.map(a => {
      if (a.type === 'alert') {
        return 'Send Alert';
      }
      const amountStr = a.amountType === 'quote' ? `$${a.amount}` :
        a.amountType === 'percent' ? `${a.amount}%` : `${a.amount}`;
      return `${a.orderType === 'market' ? 'Market' : 'Limit'} ${a.type.toUpperCase()} ${amountStr}`;
    });

    // Convert to TradingRule for fullRule if coming from API
    const fullRule = 'conditionLogic' in rule && !('fullRule' in rule)
      ? apiRuleToTradingRule(rule as TradingRuleRecord)
      : rule as TradingRule;

    return {
      id: rule.id || Math.random().toString(36).substring(2, 9),
      name: rule.name,
      description: rule.description,
      type,
      enabled: rule.enabled,
      conditions: conditionStrings,
      actions: actionStrings,
      triggerCount: 0,
      createdBy: 'user',
      fullRule,
    };
  };

  // Load rules
  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const response = await tradingApi.getTradingRules();
      setRules(response.rules.map(r => convertToDisplayRule(r)));
    } catch (err) {
      console.error('Failed to load rules:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // Save rule
  const handleSaveRule = async (rule: TradingRule) => {
    // Save to API - convert to API record format
    await tradingApi.saveTradingRule(tradingRuleToApiRecord(rule)).catch(() => {
      // If API fails, just update local state
      console.log('API save failed, updating local state');
    });

    // Update local state
    const displayRule = convertToDisplayRule(rule);

    if (rule.id) {
      // Update existing
      setRules(prev => prev.map(r => r.id === rule.id ? displayRule : r));
    } else {
      // Add new
      setRules(prev => [...prev, displayRule]);
    }

    if (onRuleCreated) {
      onRuleCreated();
    }
  };

  // Toggle rule
  const toggleRule = async (ruleId: string) => {
    setRules(prev =>
      prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r)
    );
    // Update API
    const rule = rules.find(r => r.id === ruleId);
    if (rule?.fullRule) {
      const updatedRule = { ...rule.fullRule, enabled: !rule.enabled };
      tradingApi.saveTradingRule(tradingRuleToApiRecord(updatedRule)).catch(() => {});
    }
  };

  // Delete rule
  const deleteRule = async (ruleId: string) => {
    if (!confirm('Delete this rule?')) return;
    setRules(prev => prev.filter(r => r.id !== ruleId));
    tradingApi.deleteTradingRule(ruleId).catch(() => {});
  };

  // Edit rule
  const editRule = (rule: DisplayRule) => {
    if (rule.fullRule) {
      setEditingRule(rule.fullRule);
      setShowBuilder(true);
    }
  };

  // Create new rule
  const createRule = () => {
    setEditingRule(undefined);
    setShowBuilder(true);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'indicator': return <Zap size={14} />;
      case 'price': return <AlertTriangle size={14} />;
      case 'time': return <Clock size={14} />;
      default: return <FileCode2 size={14} />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'indicator': return 'var(--terminal-accent)';
      case 'price': return 'var(--terminal-warning)';
      case 'time': return 'var(--terminal-info)';
      default: return 'var(--terminal-text-muted)';
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const enabledCount = rules.filter(r => r.enabled).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--terminal-text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
        <AlertTriangle size={40} style={{ color: 'var(--terminal-warning)', opacity: 0.7 }} />
        <p style={{ color: 'var(--terminal-text-muted)', fontSize: '0.9rem' }}>Failed to load trading rules</p>
        <button onClick={loadRules} className="terminal-btn terminal-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <RefreshCw size={14} />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <FileCode2 size={20} style={{ color: 'var(--terminal-accent)' }} />
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>Trading Rules</span>
          <span style={{
            background: 'var(--terminal-positive)',
            color: '#000',
            padding: '0.125rem 0.5rem',
            borderRadius: '10px',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}>
            {enabledCount} Active
          </span>
        </div>

        <button onClick={createRule} className="terminal-btn terminal-btn-primary">
          <Plus size={14} />
          <span>Create Rule</span>
        </button>
      </div>

      {/* Rules Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '1rem' }}>
        {rules.map(rule => (
          <div key={rule.id} className="terminal-card">
            <div className="terminal-card-header" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ color: getTypeColor(rule.type) }}>{getTypeIcon(rule.type)}</span>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{rule.name}</span>
                {rule.createdBy === 'ai' && (
                  <span style={{
                    background: 'var(--terminal-accent)',
                    color: '#000',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '3px',
                    fontSize: '0.6rem',
                    fontWeight: 600,
                  }}>
                    AI
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {rule.fullRule && (
                  <button
                    onClick={() => editRule(rule)}
                    className="terminal-btn terminal-btn-secondary"
                    style={{ padding: '0.25rem 0.5rem' }}
                    title="Edit"
                  >
                    <Edit2 size={12} />
                  </button>
                )}
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`terminal-btn ${rule.enabled ? 'terminal-btn-primary' : 'terminal-btn-secondary'}`}
                  style={{ padding: '0.25rem 0.5rem' }}
                  title={rule.enabled ? 'Disable' : 'Enable'}
                >
                  {rule.enabled ? <Square size={12} /> : <Play size={12} />}
                </button>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="terminal-btn terminal-btn-secondary"
                  style={{ padding: '0.25rem 0.5rem' }}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div className="terminal-card-body" style={{ padding: '0.75rem 1rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--terminal-text-muted)', marginBottom: '0.75rem' }}>
                {rule.description}
              </p>

              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', marginBottom: '0.375rem' }}>
                  CONDITIONS
                </div>
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  {rule.conditions.map((cond, i) => (
                    <span
                      key={i}
                      style={{
                        background: 'var(--terminal-surface-hover)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                        fontFamily: 'IBM Plex Mono',
                      }}
                    >
                      {cond}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--terminal-text-dim)', marginBottom: '0.375rem' }}>
                  ACTIONS
                </div>
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  {rule.actions.map((action, i) => (
                    <span
                      key={i}
                      style={{
                        background: 'rgba(0, 212, 170, 0.1)',
                        color: 'var(--terminal-accent)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                        fontFamily: 'IBM Plex Mono',
                      }}
                    >
                      {action}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--terminal-text-dim)' }}>
                <span>Last: {formatDate(rule.lastTriggered)}</span>
                <span>Triggers: {rule.triggerCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem',
          color: 'var(--terminal-text-dim)',
        }}>
          <FileCode2 size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>No trading rules configured</p>
          <p style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>Create rules to automate your trading strategy</p>
          <button onClick={createRule} className="terminal-btn terminal-btn-primary">
            <Plus size={14} />
            <span>Create Your First Rule</span>
          </button>
        </div>
      )}

      {/* Rule Builder Modal */}
      {showBuilder && (
        <RuleBuilder
          rule={editingRule}
          onSave={handleSaveRule}
          onClose={() => {
            setShowBuilder(false);
            setEditingRule(undefined);
          }}
        />
      )}
    </div>
  );
}
