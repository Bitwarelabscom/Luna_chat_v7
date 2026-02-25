'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Play, RefreshCw, BookOpen, Sparkles, Clock, Zap, MessageCircle, ExternalLink
} from 'lucide-react';
import { autonomousApi } from '../../lib/api';
import type { AutonomousConfig, AutonomousStatus } from '../../lib/api';
import { useWindowStore } from '../../lib/window-store';

export default function AutonomousTab() {
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  const [config, setConfig] = useState<AutonomousConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const openApp = useWindowStore(s => s.openApp);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, configRes] = await Promise.all([
        autonomousApi.getStatus(),
        autonomousApi.getConfig(),
      ]);
      setStatus(statusRes);
      setConfig(configRes.config);
    } catch (error) {
      console.error('Failed to load autonomous data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleUpdateConfig = async (updates: Partial<AutonomousConfig>) => {
    if (!config) return;
    try {
      setIsSaving(true);
      const result = await autonomousApi.updateConfig(updates);
      setConfig(result.config);
    } catch (error) {
      console.error('Failed to update config:', error);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  const isActive = status?.status === 'active';

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Open Council button */}
      <div className="bg-gradient-to-r from-indigo-500/10 to-violet-500/10 rounded-xl p-5 border border-indigo-500/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-theme-text-primary">Council Control Center</h3>
            <p className="text-sm text-theme-text-muted mt-1">
              {isActive ? 'A council session is currently active.' : 'Manage council sessions, goals, deliberations, and questions.'}
            </p>
          </div>
          <button
            onClick={() => openApp('council')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-colors font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Open Council
          </button>
        </div>
        {isActive && status?.currentSession && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400">Active</span>
            <span className="text-theme-text-muted">
              Loop #{status.currentSession.loopCount} - {status.currentSession.currentPhase || 'Initializing'}
            </span>
          </div>
        )}
      </div>

      {/* Configuration */}
      {config && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-theme-text-primary">Autonomous Configuration</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Configure how Luna operates in the background and her autonomous behaviors.
              </p>
            </div>
            {isSaving && (
              <div className="flex items-center gap-2 text-theme-accent-primary text-sm">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </div>
            )}
          </div>

          {/* Core Toggles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-theme-bg-tertiary rounded-xl border border-theme-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-theme-accent-primary/10 rounded-lg text-theme-accent-primary">
                  <Play className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium text-theme-text-primary">Autonomous Mode</div>
                  <div className="text-xs text-theme-text-muted text-balance">Allow Luna to think and act independently</div>
                </div>
              </div>
              <button
                onClick={() => handleUpdateConfig({ enabled: !config.enabled })}
                className={`relative w-12 h-6 rounded-full transition-colors ${config.enabled ? 'bg-theme-accent-primary' : 'bg-theme-bg-secondary border border-theme-border'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${config.enabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            <div className="p-4 bg-theme-bg-tertiary rounded-xl border border-theme-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium text-theme-text-primary">Auto-Start</div>
                  <div className="text-xs text-theme-text-muted text-balance">Automatically start sessions on server boot</div>
                </div>
              </div>
              <button
                onClick={() => handleUpdateConfig({ autoStart: !config.autoStart })}
                className={`relative w-12 h-6 rounded-full transition-colors ${config.autoStart ? 'bg-purple-500' : 'bg-theme-bg-secondary border border-theme-border'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${config.autoStart ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          {/* Background Task Selectors */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Background Task Selectors
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ToggleCard
                icon={<BookOpen className="w-5 h-5" />}
                color="blue"
                label="Autonomous Learning"
                description="Allows Luna to identify knowledge gaps from your conversations and research them independently to improve her expertise."
                enabled={config.learningEnabled}
                onToggle={() => handleUpdateConfig({ learningEnabled: !config.learningEnabled })}
              />
              <ToggleCard
                icon={<RefreshCw className="w-5 h-5" />}
                color="orange"
                label="RSS News Ingestion"
                description="Luna periodically checks configured RSS feeds for news and information relevant to your interests and goals."
                enabled={config.rssEnabled}
                onToggle={() => handleUpdateConfig({ rssEnabled: !config.rssEnabled })}
              />
              <ToggleCard
                icon={<Sparkles className="w-5 h-5" />}
                color="green"
                label="Proactive Insights"
                description="Allows Luna to generate and share discoveries, pattern analysis, and suggestions based on her background processing."
                enabled={config.insightsEnabled}
                onToggle={() => handleUpdateConfig({ insightsEnabled: !config.insightsEnabled })}
              />
              <ToggleCard
                icon={<MessageCircle className="w-5 h-5" />}
                color="red"
                label="Voice Intelligence"
                description="Enables advanced voice pattern analysis and emotional detection during spoken conversations."
                enabled={config.voiceEnabled}
                onToggle={() => handleUpdateConfig({ voiceEnabled: !config.voiceEnabled })}
              />
            </div>
          </div>

          {/* Timing Intervals */}
          <div className="bg-theme-bg-tertiary rounded-xl border border-theme-border p-6 space-y-6">
            <h4 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Intervals & Limits
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <IntervalInput
                label="Session Interval (minutes)"
                value={config.sessionIntervalMinutes}
                onChange={(v) => handleUpdateConfig({ sessionIntervalMinutes: v })}
                help="Time to wait between autonomous thinking sessions."
              />
              <IntervalInput
                label="Max Daily Sessions"
                value={config.maxDailySessions}
                onChange={(v) => handleUpdateConfig({ maxDailySessions: v })}
                help="Limit the total number of autonomous sessions per day."
              />
              <IntervalInput
                label="RSS Check Interval (minutes)"
                value={config.rssCheckIntervalMinutes}
                onChange={(v) => handleUpdateConfig({ rssCheckIntervalMinutes: v })}
                help="How often to check your news feeds for updates."
              />
              <IntervalInput
                label="Idle Timeout (minutes)"
                value={config.idleTimeoutMinutes}
                onChange={(v) => handleUpdateConfig({ idleTimeoutMinutes: v })}
                help="Stop session if Luna remains idle longer than this."
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ToggleCard({ icon, color, label, description, enabled, onToggle }: {
  icon: React.ReactNode;
  color: string;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="p-4 bg-theme-bg-tertiary rounded-xl border border-theme-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 bg-${color}-500/10 rounded-lg text-${color}-400`}>
            {icon}
          </div>
          <span className="font-medium text-theme-text-primary">{label}</span>
        </div>
        <button
          onClick={onToggle}
          className={`relative w-12 h-6 rounded-full transition-colors ${enabled ? `bg-${color}-500` : 'bg-theme-bg-secondary border border-theme-border'}`}
        >
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
      <p className="text-xs text-theme-text-muted">{description}</p>
    </div>
  );
}

function IntervalInput({ label, value, onChange, help }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  help: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-theme-text-secondary">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full px-4 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
      />
      <p className="text-xs text-theme-text-muted">{help}</p>
    </div>
  );
}
