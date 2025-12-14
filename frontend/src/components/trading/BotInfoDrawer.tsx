'use client';

import React, { useState } from 'react';
import { X, BookOpen, Settings, Lightbulb, AlertTriangle, ChevronRight } from 'lucide-react';
import { type BotType } from '@/lib/api';
import { getBotHelp, getAllBotHelp, type BotHelpContent } from './BotHelpContent';

type TabId = 'overview' | 'parameters' | 'examples' | 'tips';

interface BotInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBotType?: BotType;
  onSelectBotType?: (type: BotType) => void;
}

export default function BotInfoDrawer({
  isOpen,
  onClose,
  selectedBotType,
  onSelectBotType,
}: BotInfoDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedType, setSelectedType] = useState<BotType | null>(selectedBotType || null);

  const allBots = getAllBotHelp();
  const selectedBot = selectedType ? getBotHelp(selectedType) : null;

  const handleSelectBot = (type: BotType) => {
    setSelectedType(type);
    setActiveTab('overview');
    onSelectBotType?.(type);
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
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 999,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '480px',
        maxWidth: '100vw',
        background: '#1a1f2e',
        borderLeft: '1px solid #2a3545',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideIn 0.2s ease-out',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #2a3545',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <BookOpen style={{ width: 20, height: 20, color: '#00ff9f' }} />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fff' }}>
              {selectedBot ? selectedBot.name : 'Bot Strategies Guide'}
            </h2>
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
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!selectedBot ? (
            // Bot List View
            <div style={{ padding: '16px' }}>
              <p style={{ color: '#a0a0a0', fontSize: '13px', marginBottom: '16px' }}>
                Select a strategy to learn more about how it works, parameters, and best practices.
              </p>

              {/* Group by risk level */}
              {(['low', 'medium', 'high'] as const).map(riskLevel => {
                const bots = allBots.filter(b => b.riskLevel === riskLevel);
                if (bots.length === 0) return null;

                return (
                  <div key={riskLevel} style={{ marginBottom: '24px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '12px',
                    }}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: riskLevel === 'low' ? '#10b981' : riskLevel === 'medium' ? '#f59e0b' : '#ef4444',
                      }}>
                        {riskLevel} Risk
                      </span>
                      <div style={{
                        flex: 1,
                        height: '1px',
                        background: '#2a3545',
                      }} />
                    </div>

                    {bots.map(bot => (
                      <button
                        key={bot.type}
                        onClick={() => handleSelectBot(bot.type)}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          marginBottom: '8px',
                          background: '#242b3d',
                          border: '1px solid #2a3545',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#2a3545';
                          e.currentTarget.style.borderColor = '#00ff9f';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#242b3d';
                          e.currentTarget.style.borderColor = '#2a3545';
                        }}
                      >
                        <span style={{ fontSize: '24px' }}>{bot.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>
                            {bot.name}
                          </div>
                          <div style={{ fontSize: '12px', color: '#607080' }}>
                            {bot.tagline}
                          </div>
                        </div>
                        <ChevronRight style={{ width: 16, height: 16, color: '#607080' }} />
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            // Bot Detail View
            <>
              {/* Back button */}
              <button
                onClick={() => setSelectedType(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '12px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid #2a3545',
                  color: '#00ff9f',
                  fontSize: '13px',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <ChevronRight style={{ width: 14, height: 14, transform: 'rotate(180deg)' }} />
                Back to all strategies
              </button>

              {/* Bot Header */}
              <div style={{ padding: '20px', borderBottom: '1px solid #2a3545' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '32px' }}>{selectedBot.icon}</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff' }}>
                      {selectedBot.name}
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#607080' }}>
                      {selectedBot.tagline}
                    </p>
                  </div>
                </div>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 500,
                  background: selectedBot.riskLevel === 'low' ? 'rgba(16, 185, 129, 0.15)' :
                              selectedBot.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: selectedBot.riskLevel === 'low' ? '#10b981' :
                         selectedBot.riskLevel === 'medium' ? '#f59e0b' : '#ef4444',
                }}>
                  {selectedBot.riskLevel.charAt(0).toUpperCase() + selectedBot.riskLevel.slice(1)} Risk
                </span>
              </div>

              {/* Tabs */}
              <div style={{
                display: 'flex',
                borderBottom: '1px solid #2a3545',
                padding: '0 16px',
              }}>
                {([
                  { id: 'overview', label: 'Overview', icon: BookOpen },
                  { id: 'parameters', label: 'Parameters', icon: Settings },
                  { id: 'examples', label: 'Examples', icon: Lightbulb },
                  { id: 'tips', label: 'Tips', icon: AlertTriangle },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      flex: 1,
                      padding: '12px 8px',
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === tab.id ? '2px solid #00ff9f' : '2px solid transparent',
                      color: activeTab === tab.id ? '#fff' : '#607080',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.15s',
                    }}
                  >
                    <tab.icon style={{ width: 14, height: 14 }} />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div style={{ padding: '20px' }}>
                {activeTab === 'overview' && (
                  <OverviewTab bot={selectedBot} />
                )}
                {activeTab === 'parameters' && (
                  <ParametersTab bot={selectedBot} />
                )}
                {activeTab === 'examples' && (
                  <ExamplesTab bot={selectedBot} />
                )}
                {activeTab === 'tips' && (
                  <TipsTab bot={selectedBot} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}

// Tab Components
function OverviewTab({ bot }: { bot: BotHelpContent }) {
  return (
    <div>
      <p style={{ color: '#d0d0d0', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
        {bot.description}
      </p>

      <h4 style={{ color: '#fff', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        How It Works
      </h4>
      <ol style={{
        margin: '0 0 24px',
        paddingLeft: '20px',
        color: '#a0a0a0',
        fontSize: '13px',
        lineHeight: 1.8,
      }}>
        {bot.howItWorks.map((step, i) => (
          <li key={i} style={{ marginBottom: '4px' }}>{step}</li>
        ))}
      </ol>

      <h4 style={{ color: '#fff', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        Best For
      </h4>
      <ul style={{
        margin: '0 0 24px',
        paddingLeft: '20px',
        color: '#10b981',
        fontSize: '13px',
        lineHeight: 1.8,
      }}>
        {bot.bestFor.map((item, i) => (
          <li key={i} style={{ marginBottom: '4px' }}>{item}</li>
        ))}
      </ul>

      <h4 style={{ color: '#fff', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        Not Best For
      </h4>
      <ul style={{
        margin: 0,
        paddingLeft: '20px',
        color: '#ef4444',
        fontSize: '13px',
        lineHeight: 1.8,
      }}>
        {bot.notBestFor.map((item, i) => (
          <li key={i} style={{ marginBottom: '4px' }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ParametersTab({ bot }: { bot: BotHelpContent }) {
  return (
    <div>
      {bot.parameters.map((param, i) => (
        <div key={i} style={{
          padding: '16px',
          marginBottom: '12px',
          background: '#242b3d',
          borderRadius: '8px',
          border: '1px solid #2a3545',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
              {param.label}
            </span>
            <code style={{
              fontSize: '11px',
              padding: '2px 8px',
              background: '#1a1f2e',
              borderRadius: '4px',
              color: '#00ff9f',
            }}>
              {param.name}
            </code>
          </div>
          <p style={{
            margin: '0 0 8px',
            fontSize: '13px',
            color: '#a0a0a0',
            lineHeight: 1.5,
          }}>
            {param.description}
          </p>
          {param.example && (
            <div style={{
              fontSize: '12px',
              color: '#607080',
              marginBottom: param.tip ? '8px' : 0,
            }}>
              <strong>Example:</strong> {param.example}
            </div>
          )}
          {param.tip && (
            <div style={{
              fontSize: '12px',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '6px',
            }}>
              <Lightbulb style={{ width: 12, height: 12, flexShrink: 0, marginTop: '2px' }} />
              {param.tip}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExamplesTab({ bot }: { bot: BotHelpContent }) {
  return (
    <div>
      {bot.examples.map((example, i) => (
        <div key={i} style={{
          padding: '16px',
          marginBottom: '16px',
          background: '#242b3d',
          borderRadius: '8px',
          border: '1px solid #2a3545',
        }}>
          <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#fff' }}>
            {example.title}
          </h4>
          <p style={{
            margin: '0 0 12px',
            fontSize: '13px',
            color: '#a0a0a0',
          }}>
            {example.scenario}
          </p>

          <div style={{
            padding: '12px',
            background: '#1a1f2e',
            borderRadius: '6px',
            marginBottom: '12px',
          }}>
            <div style={{ fontSize: '11px', color: '#607080', marginBottom: '8px' }}>
              Configuration:
            </div>
            {Object.entries(example.config).map(([key, value]) => (
              <div key={key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                marginBottom: '4px',
              }}>
                <span style={{ color: '#a0a0a0' }}>{key}</span>
                <span style={{ color: '#00ff9f', fontFamily: 'JetBrains Mono, monospace' }}>
                  {typeof value === 'number' ? value.toLocaleString() : String(value)}
                </span>
              </div>
            ))}
          </div>

          <div style={{
            fontSize: '13px',
            color: '#10b981',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}>
            <ChevronRight style={{ width: 14, height: 14, flexShrink: 0, marginTop: '2px' }} />
            {example.expectedResult}
          </div>
        </div>
      ))}
    </div>
  );
}

function TipsTab({ bot }: { bot: BotHelpContent }) {
  return (
    <div>
      <h4 style={{ color: '#fff', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        Pro Tips
      </h4>
      <div style={{ marginBottom: '24px' }}>
        {bot.tips.map((tip, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px',
            marginBottom: '8px',
            background: 'rgba(16, 185, 129, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(16, 185, 129, 0.2)',
          }}>
            <Lightbulb style={{ width: 16, height: 16, color: '#10b981', flexShrink: 0, marginTop: '2px' }} />
            <span style={{ fontSize: '13px', color: '#d0d0d0', lineHeight: 1.5 }}>{tip}</span>
          </div>
        ))}
      </div>

      <h4 style={{ color: '#fff', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        Warnings
      </h4>
      <div>
        {bot.warnings.map((warning, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px',
            marginBottom: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.2)',
          }}>
            <AlertTriangle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            <span style={{ fontSize: '13px', color: '#d0d0d0', lineHeight: 1.5 }}>{warning}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
