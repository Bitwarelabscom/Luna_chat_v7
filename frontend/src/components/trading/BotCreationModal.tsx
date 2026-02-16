'use client';

import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, HelpCircle, Check, Zap, Wallet, AlertTriangle } from 'lucide-react';
import { tradingApi, type BotType, type BotTemplate } from '@/lib/api';
import { getBotHelp } from './BotHelpContent';

type RiskProfile = 'conservative' | 'moderate' | 'aggressive';
type MarketType = 'spot' | 'alpha';

interface BotCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  preselectedType?: BotType;
  preselectedSymbol?: string;
}

function BotCreationModal({
  isOpen,
  onClose,
  onCreated,
  preselectedType,
  preselectedSymbol,
}: BotCreationModalProps) {
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<BotTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedType, setSelectedType] = useState<BotType | null>(preselectedType || null);
  const [botName, setBotName] = useState('');
  const [symbol, setSymbol] = useState(preselectedSymbol || 'BTCUSDT');
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('moderate');
  const [showHelp, setShowHelp] = useState<string | null>(null);

  // Load templates on mount
  useEffect(() => {
    if (isOpen) {
      tradingApi.getBotTemplates()
        .then(res => setTemplates(res.templates))
        .catch(err => console.error('Failed to load templates:', err));
    }
  }, [isOpen]);

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setStep(preselectedType ? 2 : 1);
      setSelectedType(preselectedType || null);
      setSymbol(preselectedSymbol || 'BTCUSDT');
      setBotName('');
      setConfig({});
      setError(null);
    }
  }, [isOpen, preselectedType, preselectedSymbol]);

  // Get current template
  const selectedTemplate = templates.find(t => t.type === selectedType);
  const botHelp = selectedType ? getBotHelp(selectedType) : null;

  // Apply recommended settings
  const applyRecommendedSettings = (profile: RiskProfile) => {
    if (!selectedTemplate) return;
    setRiskProfile(profile);
    setConfig(selectedTemplate.recommendedSettings[profile]);
  };

  // Handle config changes
  const updateConfig = (key: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // Generate bot name
  const generateBotName = () => {
    if (!selectedType) return '';
    const typeNames: Record<BotType, string> = {
      grid: 'Grid',
      dca: 'DCA',
      rsi: 'RSI',
      ma_crossover: 'MA Cross',
      macd: 'MACD',
      breakout: 'Breakout',
      mean_reversion: 'Mean Rev',
      momentum: 'Momentum',
      custom: 'Custom',
    };
    const base = symbol.replace('USDT', '');
    return `${typeNames[selectedType]} ${base}`;
  };

  // Create the bot
  const handleCreate = async () => {
    if (!selectedType) return;

    setLoading(true);
    setError(null);

    try {
      const name = botName.trim() || generateBotName();
      await tradingApi.createBot({
        name,
        type: selectedType,
        symbol,
        config,
        marketType,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bot');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 999,
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '560px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        background: '#1a1f2e',
        borderRadius: '12px',
        border: '1px solid #2a3545',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #2a3545',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fff' }}>
              Create Trading Bot
            </h2>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
            }}>
              {[1, 2, 3].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: step >= s ? '#00ff9f' : '#2a3545',
                    color: step >= s ? '#1a1f2e' : '#607080',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>
                    {step > s ? <Check style={{ width: 14, height: 14 }} /> : s}
                  </div>
                  <span style={{ fontSize: '12px', color: step === s ? '#fff' : '#607080' }}>
                    {s === 1 ? 'Type' : s === 2 ? 'Configure' : 'Review'}
                  </span>
                  {s < 3 && <ChevronRight style={{ width: 14, height: 14, color: '#2a3545' }} />}
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: '#607080',
            }}
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {step === 1 && (
            <Step1SelectType
              templates={templates}
              selectedType={selectedType}
              onSelect={setSelectedType}
            />
          )}

          {step === 2 && selectedTemplate && (
            <Step2Configure
              template={selectedTemplate}
              botHelp={botHelp}
              symbol={symbol}
              setSymbol={setSymbol}
              marketType={marketType}
              setMarketType={setMarketType}
              config={config}
              updateConfig={updateConfig}
              riskProfile={riskProfile}
              applyRecommendedSettings={applyRecommendedSettings}
              showHelp={showHelp}
              setShowHelp={setShowHelp}
            />
          )}

          {step === 3 && selectedTemplate && (
            <Step3Review
              template={selectedTemplate}
              botName={botName}
              setBotName={setBotName}
              generateBotName={generateBotName}
              symbol={symbol}
              marketType={marketType}
              config={config}
            />
          )}

          {error && (
            <div style={{
              padding: '12px 16px',
              marginTop: '16px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <AlertTriangle style={{ width: 16, height: 16 }} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid #2a3545',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <button
            onClick={() => step > 1 && setStep(step - 1)}
            disabled={step === 1}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: '1px solid #2a3545',
              borderRadius: '8px',
              color: step === 1 ? '#607080' : '#fff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: step === 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ChevronLeft style={{ width: 16, height: 16 }} />
            Back
          </button>

          <button
            onClick={() => {
              if (step < 3) {
                setStep(step + 1);
              } else {
                handleCreate();
              }
            }}
            disabled={loading || (step === 1 && !selectedType)}
            style={{
              padding: '10px 24px',
              background: (loading || (step === 1 && !selectedType)) ? '#2a3545' : '#00ff9f',
              border: 'none',
              borderRadius: '8px',
              color: (loading || (step === 1 && !selectedType)) ? '#607080' : '#1a1f2e',
              fontSize: '13px',
              fontWeight: 600,
              cursor: (loading || (step === 1 && !selectedType)) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {loading ? 'Creating...' : step === 3 ? 'Create Bot' : 'Continue'}
            {!loading && step < 3 && <ChevronRight style={{ width: 16, height: 16 }} />}
          </button>
        </div>
      </div>
    </>
  );
}

// Step 1: Select Bot Type
function Step1SelectType({
  templates,
  selectedType,
  onSelect,
}: {
  templates: BotTemplate[];
  selectedType: BotType | null;
  onSelect: (type: BotType) => void;
}) {
  return (
    <div>
      <p style={{ color: '#a0a0a0', fontSize: '13px', marginBottom: '20px' }}>
        Choose a strategy that matches your trading goals and risk tolerance.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
        {templates.map(template => {
          const help = getBotHelp(template.type);
          return (
            <button
              key={template.type}
              onClick={() => onSelect(template.type)}
              style={{
                padding: '16px',
                background: selectedType === template.type ? 'rgba(0, 255, 159, 0.1)' : '#242b3d',
                border: selectedType === template.type ? '2px solid #00ff9f' : '1px solid #2a3545',
                borderRadius: '10px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '24px' }}>{template.icon}</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
                  {template.name}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#a0a0a0', lineHeight: 1.4 }}>
                {template.shortDescription}
              </p>
              <div style={{
                marginTop: '10px',
                display: 'inline-block',
                padding: '3px 8px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 500,
                background: help?.riskLevel === 'low' ? 'rgba(16, 185, 129, 0.15)' :
                            help?.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: help?.riskLevel === 'low' ? '#10b981' :
                       help?.riskLevel === 'medium' ? '#f59e0b' : '#ef4444',
              }}>
                {help?.riskLevel} risk
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Step 2: Configure Parameters
function Step2Configure({
  template,
  botHelp,
  symbol,
  setSymbol,
  marketType,
  setMarketType,
  config,
  updateConfig,
  riskProfile,
  applyRecommendedSettings,
  showHelp,
  setShowHelp,
}: {
  template: BotTemplate;
  botHelp: ReturnType<typeof getBotHelp> | null;
  symbol: string;
  setSymbol: (s: string) => void;
  marketType: MarketType;
  setMarketType: (t: MarketType) => void;
  config: Record<string, unknown>;
  updateConfig: (key: string, value: unknown) => void;
  riskProfile: RiskProfile;
  applyRecommendedSettings: (p: RiskProfile) => void;
  showHelp: string | null;
  setShowHelp: (s: string | null) => void;
}) {
  return (
    <div>
      {/* Risk Profile Selector */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#a0a0a0', marginBottom: '8px' }}>
          Quick Start - Recommended Settings
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['conservative', 'moderate', 'aggressive'] as RiskProfile[]).map(profile => (
            <button
              key={profile}
              onClick={() => applyRecommendedSettings(profile)}
              style={{
                flex: 1,
                padding: '10px 12px',
                background: riskProfile === profile ? 'rgba(0, 255, 159, 0.1)' : '#242b3d',
                border: riskProfile === profile ? '1px solid #00ff9f' : '1px solid #2a3545',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                fontSize: '12px',
                fontWeight: 500,
                color: riskProfile === profile ? '#00ff9f' : '#fff',
                textTransform: 'capitalize',
              }}>
                {profile}
              </div>
              <div style={{ fontSize: '10px', color: '#607080', marginTop: '2px' }}>
                {profile === 'conservative' ? 'Safer, smaller trades' :
                 profile === 'moderate' ? 'Balanced approach' : 'Higher risk/reward'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Market Type */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#a0a0a0', marginBottom: '8px' }}>
          Market Type
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setMarketType('spot')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: marketType === 'spot' ? 'rgba(0, 255, 159, 0.1)' : '#242b3d',
              border: marketType === 'spot' ? '1px solid #00ff9f' : '1px solid #2a3545',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Wallet style={{ width: 14, height: 14, color: marketType === 'spot' ? '#00ff9f' : '#607080' }} />
            <span style={{ fontSize: '13px', color: marketType === 'spot' ? '#00ff9f' : '#fff' }}>
              Spot
            </span>
          </button>
          <button
            onClick={() => setMarketType('alpha')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: marketType === 'alpha' ? 'rgba(245, 158, 11, 0.1)' : '#242b3d',
              border: marketType === 'alpha' ? '1px solid #f59e0b' : '1px solid #2a3545',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Zap style={{ width: 14, height: 14, color: marketType === 'alpha' ? '#f59e0b' : '#607080' }} />
            <span style={{ fontSize: '13px', color: marketType === 'alpha' ? '#f59e0b' : '#fff' }}>
              Alpha
            </span>
          </button>
        </div>
      </div>

      {/* Symbol Input */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#a0a0a0', marginBottom: '8px' }}>
          Trading Pair
        </label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="BTCUSDT"
          style={{
            width: '100%',
            padding: '10px 14px',
            background: '#242b3d',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        />
      </div>

      {/* Parameters */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#a0a0a0', marginBottom: '12px' }}>
          Strategy Parameters
        </label>

        {template.parameters.map(param => {
          const helpContent = botHelp?.parameters.find(p => p.name === param.name);

          return (
            <div key={param.name} style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}>
                <label style={{ fontSize: '13px', color: '#fff' }}>
                  {param.label}
                  {param.required && <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>}
                </label>
                <button
                  onClick={() => setShowHelp(showHelp === param.name ? null : param.name)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px',
                    color: showHelp === param.name ? '#00ff9f' : '#607080',
                  }}
                >
                  <HelpCircle style={{ width: 14, height: 14 }} />
                </button>
              </div>

              {showHelp === param.name && helpContent && (
                <div style={{
                  padding: '10px 12px',
                  marginBottom: '8px',
                  background: 'rgba(0, 255, 159, 0.05)',
                  border: '1px solid rgba(0, 255, 159, 0.2)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#a0a0a0',
                  lineHeight: 1.5,
                }}>
                  {helpContent.description}
                  {helpContent.tip && (
                    <div style={{ marginTop: '8px', color: '#f59e0b' }}>
                      Tip: {helpContent.tip}
                    </div>
                  )}
                </div>
              )}

              {param.type === 'select' && param.options ? (
                <select
                  value={String(config[param.name] ?? param.default ?? '')}
                  onChange={(e) => updateConfig(param.name, e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: '#242b3d',
                    border: '1px solid #2a3545',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '13px',
                  }}
                >
                  {param.options.map(opt => (
                    <option key={String(opt.value)} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : param.type === 'boolean' ? (
                <button
                  onClick={() => updateConfig(param.name, !config[param.name])}
                  style={{
                    padding: '10px 14px',
                    background: config[param.name] ? 'rgba(0, 255, 159, 0.15)' : '#242b3d',
                    border: `1px solid ${config[param.name] ? '#00ff9f' : '#2a3545'}`,
                    borderRadius: '8px',
                    color: config[param.name] ? '#00ff9f' : '#fff',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  {config[param.name] ? 'Enabled' : 'Disabled'}
                </button>
              ) : (
                <input
                  type={param.type === 'number' ? 'number' : 'text'}
                  value={String(config[param.name] ?? param.default ?? '')}
                  onChange={(e) => updateConfig(
                    param.name,
                    param.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
                  )}
                  min={param.min}
                  max={param.max}
                  step={param.step || (param.type === 'number' ? 'any' : undefined)}
                  placeholder={param.description}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: '#242b3d',
                    border: '1px solid #2a3545',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '14px',
                    fontFamily: param.type === 'number' ? 'JetBrains Mono, monospace' : 'inherit',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Step 3: Review & Create
function Step3Review({
  template,
  botName,
  setBotName,
  generateBotName,
  symbol,
  marketType,
  config,
}: {
  template: BotTemplate;
  botName: string;
  setBotName: (n: string) => void;
  generateBotName: () => string;
  symbol: string;
  marketType: MarketType;
  config: Record<string, unknown>;
}) {
  return (
    <div>
      {/* Bot Name */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#a0a0a0', marginBottom: '8px' }}>
          Bot Name
        </label>
        <input
          type="text"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          placeholder={generateBotName()}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: '#242b3d',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
          }}
        />
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#607080' }}>
          Leave empty to auto-generate: {generateBotName()}
        </p>
      </div>

      {/* Summary */}
      <div style={{
        padding: '16px',
        background: '#242b3d',
        borderRadius: '10px',
        border: '1px solid #2a3545',
      }}>
        <h4 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 600, color: '#fff' }}>
          Configuration Summary
        </h4>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#a0a0a0' }}>Strategy</span>
            <span style={{ fontSize: '13px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{template.icon}</span>
              {template.name}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#a0a0a0' }}>Trading Pair</span>
            <span style={{ fontSize: '13px', color: '#00ff9f', fontFamily: 'JetBrains Mono, monospace' }}>
              {symbol}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#a0a0a0' }}>Market</span>
            <span style={{
              fontSize: '13px',
              color: marketType === 'alpha' ? '#f59e0b' : '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}>
              {marketType === 'alpha' && <Zap style={{ width: 12, height: 12 }} />}
              {marketType === 'alpha' ? 'Alpha' : 'Spot'}
            </span>
          </div>
        </div>

        <div style={{
          borderTop: '1px solid #2a3545',
          paddingTop: '12px',
          marginTop: '12px',
        }}>
          <div style={{ fontSize: '12px', color: '#607080', marginBottom: '8px' }}>Parameters:</div>
          {Object.entries(config).map(([key, value]) => {
            const param = template.parameters.find(p => p.name === key);
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#a0a0a0' }}>
                  {param?.label || key}
                </span>
                <span style={{ fontSize: '12px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>
                  {typeof value === 'number'
                    ? value.toLocaleString()
                    : typeof value === 'boolean'
                      ? (value ? 'Yes' : 'No')
                      : String(value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Warning */}
      <div style={{
        marginTop: '16px',
        padding: '12px 16px',
        background: 'rgba(245, 158, 11, 0.1)',
        border: '1px solid rgba(245, 158, 11, 0.2)',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
      }}>
        <AlertTriangle style={{ width: 16, height: 16, color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
        <p style={{ margin: 0, fontSize: '12px', color: '#a0a0a0', lineHeight: 1.5 }}>
          Trading bots operate automatically once started. Review your settings carefully and
          monitor performance regularly. Past performance does not guarantee future results.
        </p>
      </div>
    </div>
  );
}

export default React.memo(BotCreationModal);
