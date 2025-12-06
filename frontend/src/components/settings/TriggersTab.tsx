'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Bell, Clock, AlertCircle, Plus, Trash2, Play, Pause, RefreshCw,
  Send, History, Settings, Zap, Moon, MessageSquare, BellOff,
  ExternalLink, Copy, Check, Unlink
} from 'lucide-react';
import { triggersApi } from '../../lib/api';
import type {
  NotificationPreferences, TriggerSchedule, BuiltinSchedule, TriggerHistoryItem,
  TelegramStatus, TelegramLinkCode
} from '../../lib/api';

type TabSection = 'preferences' | 'schedules' | 'history' | 'telegram';

const triggerTypeConfig = {
  time: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Time-based', icon: Clock },
  pattern: { color: 'text-purple-400', bg: 'bg-purple-400/10', label: 'Pattern', icon: Zap },
  event: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Event', icon: AlertCircle },
};

export default function TriggersTab() {
  const [activeSection, setActiveSection] = useState<TabSection>('preferences');
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [schedules, setSchedules] = useState<TriggerSchedule[]>([]);
  const [builtins, setBuiltins] = useState<BuiltinSchedule[]>([]);
  const [history, setHistory] = useState<TriggerHistoryItem[]>([]);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [linkCode, setLinkCode] = useState<TelegramLinkCode | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNewSchedule, setShowNewSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    name: '',
    triggerType: 'time' as 'time' | 'pattern' | 'event',
    cron: '0 9 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pattern: 'long_absence',
    eventType: 'task_due',
    promptTemplate: '',
  });
  const [testMessage, setTestMessage] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [prefsRes, schedulesRes, builtinsRes, historyRes, telegramRes] = await Promise.all([
        triggersApi.getPreferences(),
        triggersApi.getSchedules(),
        triggersApi.getBuiltinSchedules(),
        triggersApi.getHistory(),
        triggersApi.getTelegramStatus().catch(() => null),
      ]);

      setPreferences(prefsRes);
      setSchedules(schedulesRes.schedules || []);
      setBuiltins(builtinsRes.builtins || []);
      setHistory(historyRes.history || []);
      setTelegramStatus(telegramRes);
    } catch (error) {
      console.error('Failed to load triggers data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdatePreference = async (key: keyof NotificationPreferences, value: boolean | string) => {
    if (!preferences) return;
    try {
      const updated = await triggersApi.updatePreferences({ [key]: value });
      setPreferences(updated);
    } catch (error) {
      console.error('Failed to update preference:', error);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchedule.name.trim() || !newSchedule.promptTemplate.trim()) return;

    try {
      let triggerConfig: TriggerSchedule['triggerConfig'] = {};

      if (newSchedule.triggerType === 'time') {
        triggerConfig = { cron: newSchedule.cron, timezone: newSchedule.timezone };
      } else if (newSchedule.triggerType === 'pattern') {
        triggerConfig = { pattern: newSchedule.pattern };
      } else if (newSchedule.triggerType === 'event') {
        triggerConfig = { eventType: newSchedule.eventType };
      }

      await triggersApi.createSchedule({
        name: newSchedule.name,
        triggerType: newSchedule.triggerType,
        triggerConfig,
        promptTemplate: newSchedule.promptTemplate,
        isEnabled: true,
      });

      setNewSchedule({
        name: '',
        triggerType: 'time',
        cron: '0 9 * * *',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        pattern: 'long_absence',
        eventType: 'task_due',
        promptTemplate: '',
      });
      setShowNewSchedule(false);
      await loadData();
    } catch (error) {
      console.error('Failed to create schedule:', error);
      alert('Failed to create schedule');
    }
  };

  const handleToggleSchedule = async (schedule: TriggerSchedule) => {
    try {
      await triggersApi.updateSchedule(schedule.id, { isEnabled: !schedule.isEnabled });
      await loadData();
    } catch (error) {
      console.error('Failed to toggle schedule:', error);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await triggersApi.deleteSchedule(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete schedule:', error);
    }
  };

  const handleAddBuiltin = async (builtin: BuiltinSchedule) => {
    try {
      await triggersApi.createSchedule({
        name: builtin.name,
        triggerType: builtin.triggerType,
        triggerConfig: builtin.triggerConfig,
        promptTemplate: builtin.promptTemplate,
        isEnabled: true,
      });
      await loadData();
    } catch (error) {
      console.error('Failed to add builtin schedule:', error);
    }
  };

  const handleSendTest = async () => {
    try {
      const result = await triggersApi.sendTestTrigger(testMessage || undefined, 'chat');
      alert(result.message);
      setTestMessage('');
      await loadData();
    } catch (error) {
      console.error('Failed to send test:', error);
      alert('Failed to send test notification');
    }
  };

  const handleGenerateTelegramLink = async () => {
    try {
      setTelegramLoading(true);
      const code = await triggersApi.generateTelegramLinkCode();
      setLinkCode(code);
    } catch (error) {
      console.error('Failed to generate link code:', error);
      alert('Failed to generate link code');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    if (!confirm('Unlink your Telegram account? You will no longer receive notifications there.')) return;
    try {
      setTelegramLoading(true);
      await triggersApi.unlinkTelegram();
      setTelegramStatus({ ...telegramStatus!, connection: null });
      setLinkCode(null);
      await loadData();
    } catch (error) {
      console.error('Failed to unlink Telegram:', error);
      alert('Failed to unlink Telegram');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleTelegramTest = async () => {
    try {
      setTelegramLoading(true);
      const result = await triggersApi.sendTelegramTest();
      alert(result.message);
    } catch (error) {
      console.error('Failed to send test:', error);
      alert('Failed to send test message');
    } finally {
      setTelegramLoading(false);
    }
  };

  const copyLinkCode = () => {
    if (linkCode?.code) {
      navigator.clipboard.writeText(linkCode.code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <div className="flex gap-2 border-b border-theme-border pb-2 overflow-x-auto">
        {[
          { id: 'preferences', icon: Settings, label: 'Preferences' },
          { id: 'telegram', icon: Send, label: 'Telegram' },
          { id: 'schedules', icon: Clock, label: 'Schedules' },
          { id: 'history', icon: History, label: 'History' },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id as TabSection)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              activeSection === id
                ? 'bg-theme-accent-primary/20 text-theme-accent-primary'
                : 'text-theme-text-secondary hover:bg-theme-bg-tertiary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {id === 'history' && history.length > 0 && (
              <span className="bg-theme-text-muted/20 text-theme-text-muted text-xs px-1.5 py-0.5 rounded-full">
                {history.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Preferences Section */}
      {activeSection === 'preferences' && preferences && (
        <div className="space-y-6">
          {/* Delivery Methods */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
              Delivery Methods
            </h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between p-4 rounded-lg bg-theme-bg-tertiary cursor-pointer">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-theme-accent-primary" />
                  <div>
                    <span className="text-theme-text-primary font-medium">In-App Chat</span>
                    <p className="text-sm text-theme-text-muted">
                      Messages appear in the Luna Updates session
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.enableChatNotifications}
                  onChange={(e) => handleUpdatePreference('enableChatNotifications', e.target.checked)}
                  className="w-5 h-5 rounded border-theme-border text-theme-accent-primary focus:ring-theme-accent-primary"
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-lg bg-theme-bg-tertiary cursor-pointer opacity-60">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-theme-text-muted" />
                  <div>
                    <span className="text-theme-text-primary font-medium">Push Notifications</span>
                    <p className="text-sm text-theme-text-muted">
                      Browser notifications (coming soon)
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.enablePushNotifications}
                  disabled
                  className="w-5 h-5 rounded border-theme-border text-theme-accent-primary"
                />
              </label>
            </div>
          </div>

          {/* Notification Types */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
              Notification Types
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'enableReminders', label: 'Reminders', desc: 'Task and event reminders' },
                { key: 'enableCheckins', label: 'Check-ins', desc: 'Scheduled check-ins' },
                { key: 'enableInsights', label: 'Insights', desc: 'Proactive discoveries' },
                { key: 'enableAchievements', label: 'Achievements', desc: 'Goal completions' },
              ].map(({ key, label, desc }) => (
                <label
                  key={key}
                  className="flex items-center gap-3 p-3 rounded-lg bg-theme-bg-tertiary cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={preferences[key as keyof NotificationPreferences] as boolean}
                    onChange={(e) => handleUpdatePreference(key as keyof NotificationPreferences, e.target.checked)}
                    className="w-4 h-4 rounded border-theme-border text-theme-accent-primary"
                  />
                  <div>
                    <span className="text-theme-text-primary text-sm font-medium">{label}</span>
                    <p className="text-xs text-theme-text-muted">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Quiet Hours */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
              Quiet Hours
            </h3>
            <div className="bg-theme-bg-tertiary rounded-lg p-4 space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-3">
                  <Moon className="w-5 h-5 text-theme-text-muted" />
                  <div>
                    <span className="text-theme-text-primary font-medium">Enable Quiet Hours</span>
                    <p className="text-sm text-theme-text-muted">
                      Pause notifications during specified times
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.quietHoursEnabled}
                  onChange={(e) => handleUpdatePreference('quietHoursEnabled', e.target.checked)}
                  className="w-5 h-5 rounded border-theme-border text-theme-accent-primary"
                />
              </label>

              {preferences.quietHoursEnabled && (
                <div className="flex items-center gap-4 pt-2 border-t border-theme-border">
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">From</label>
                    <input
                      type="time"
                      value={preferences.quietHoursStart}
                      onChange={(e) => handleUpdatePreference('quietHoursStart', e.target.value)}
                      className="px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-theme-text-muted mb-1">To</label>
                    <input
                      type="time"
                      value={preferences.quietHoursEnd}
                      onChange={(e) => handleUpdatePreference('quietHoursEnd', e.target.value)}
                      className="px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Test Notification */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
              Test Notification
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Optional custom message..."
                className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-sm"
              />
              <button
                onClick={handleSendTest}
                className="flex items-center gap-2 px-4 py-2 bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-primary/80"
              >
                <Send className="w-4 h-4" />
                Send Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Section */}
      {activeSection === 'telegram' && (
        <div className="space-y-6">
          {telegramStatus && !telegramStatus.isConfigured ? (
            /* Telegram Not Configured */
            <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-lg p-4">
              <h3 className="font-medium text-yellow-400 mb-2">Telegram Not Configured</h3>
              <p className="text-sm text-theme-text-secondary mb-4">
                To receive notifications via Telegram, the server administrator needs to set up a Telegram bot.
              </p>
              <pre className="bg-theme-bg-tertiary p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                {telegramStatus.setupInstructions}
              </pre>
            </div>
          ) : telegramStatus?.connection ? (
            /* Connected */
            <div className="space-y-4">
              <div className="bg-green-400/10 border border-green-400/30 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-green-400 flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      Telegram Connected
                    </h3>
                    <p className="text-sm text-theme-text-secondary mt-1">
                      {telegramStatus.connection.firstName && (
                        <span className="font-medium">{telegramStatus.connection.firstName}</span>
                      )}
                      {telegramStatus.connection.username && (
                        <span className="text-theme-text-muted"> @{telegramStatus.connection.username}</span>
                      )}
                    </p>
                    <p className="text-xs text-theme-text-muted mt-2">
                      Connected {new Date(telegramStatus.connection.linkedAt).toLocaleDateString()}
                      {telegramStatus.connection.lastMessageAt && (
                        <> - Last message {new Date(telegramStatus.connection.lastMessageAt).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={handleUnlinkTelegram}
                    disabled={telegramLoading}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 rounded-lg"
                  >
                    <Unlink className="w-4 h-4" />
                    Unlink
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTelegramTest}
                  disabled={telegramLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-primary/80 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  Send Test Message
                </button>
              </div>

              <div className="bg-theme-bg-tertiary rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-sm">Telegram Preferences</h4>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-theme-text-secondary">
                    Also save messages to Luna Updates session
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences?.persistTelegramToChat ?? true}
                    onChange={(e) => handleUpdatePreference('persistTelegramToChat', e.target.checked)}
                    className="w-4 h-4 rounded border-theme-border text-theme-accent-primary"
                  />
                </label>
              </div>
            </div>
          ) : (
            /* Not Connected */
            <div className="space-y-4">
              <div className="bg-theme-bg-tertiary rounded-lg p-4">
                <h3 className="font-medium mb-2">Connect Telegram</h3>
                <p className="text-sm text-theme-text-secondary mb-4">
                  Receive Luna notifications directly on your phone via Telegram.
                </p>

                {linkCode ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-theme-bg-secondary rounded-lg p-3 font-mono text-lg text-center tracking-widest">
                        {linkCode.code}
                      </div>
                      <button
                        onClick={copyLinkCode}
                        className="p-2 hover:bg-theme-bg-secondary rounded-lg"
                        title="Copy code"
                      >
                        {codeCopied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                      </button>
                    </div>

                    {linkCode.linkUrl && (
                      <a
                        href={linkCode.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#0088cc] text-white rounded-lg hover:bg-[#0088cc]/80"
                      >
                        <Send className="w-5 h-5" />
                        Open in Telegram
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}

                    <p className="text-xs text-theme-text-muted text-center">
                      Code expires in {linkCode.expiresInMinutes} minutes
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateTelegramLink}
                    disabled={telegramLoading}
                    className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-[#0088cc] text-white rounded-lg hover:bg-[#0088cc]/80 disabled:opacity-50"
                  >
                    {telegramLoading ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Link Telegram Account
                      </>
                    )}
                  </button>
                )}
              </div>

              {telegramStatus?.botInfo && (
                <p className="text-xs text-theme-text-muted text-center">
                  Bot: @{telegramStatus.botInfo.username}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Schedules Section */}
      {activeSection === 'schedules' && (
        <div className="space-y-6">
          {/* Create New Schedule */}
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Your Schedules</h3>
            <button
              onClick={() => setShowNewSchedule(!showNewSchedule)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-theme-accent-primary/20 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/30"
            >
              <Plus className="w-4 h-4" />
              New Schedule
            </button>
          </div>

          {showNewSchedule && (
            <form onSubmit={handleCreateSchedule} className="bg-theme-bg-tertiary rounded-lg p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-theme-text-secondary mb-1">Name</label>
                  <input
                    type="text"
                    value={newSchedule.name}
                    onChange={(e) => setNewSchedule({ ...newSchedule, name: e.target.value })}
                    placeholder="Morning Check-in"
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-theme-text-secondary mb-1">Type</label>
                  <select
                    value={newSchedule.triggerType}
                    onChange={(e) => setNewSchedule({ ...newSchedule, triggerType: e.target.value as 'time' | 'pattern' | 'event' })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                  >
                    <option value="time">Time-based (Cron)</option>
                    <option value="pattern">Pattern Detection</option>
                    <option value="event">Event Trigger</option>
                  </select>
                </div>
              </div>

              {newSchedule.triggerType === 'time' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-theme-text-secondary mb-1">Cron Expression</label>
                    <input
                      type="text"
                      value={newSchedule.cron}
                      onChange={(e) => setNewSchedule({ ...newSchedule, cron: e.target.value })}
                      placeholder="0 9 * * *"
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm font-mono"
                    />
                    <p className="text-xs text-theme-text-muted mt-1">
                      Example: 0 9 * * * = 9:00 AM daily
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-theme-text-secondary mb-1">Timezone</label>
                    <input
                      type="text"
                      value={newSchedule.timezone}
                      onChange={(e) => setNewSchedule({ ...newSchedule, timezone: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                    />
                  </div>
                </div>
              )}

              {newSchedule.triggerType === 'pattern' && (
                <div>
                  <label className="block text-sm text-theme-text-secondary mb-1">Pattern</label>
                  <select
                    value={newSchedule.pattern}
                    onChange={(e) => setNewSchedule({ ...newSchedule, pattern: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                  >
                    <option value="long_absence">Long Absence (3+ days)</option>
                    <option value="mood_low">Low Mood Detected</option>
                    <option value="high_productivity">High Productivity</option>
                  </select>
                </div>
              )}

              {newSchedule.triggerType === 'event' && (
                <div>
                  <label className="block text-sm text-theme-text-secondary mb-1">Event Type</label>
                  <select
                    value={newSchedule.eventType}
                    onChange={(e) => setNewSchedule({ ...newSchedule, eventType: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                  >
                    <option value="task_due">Task Due</option>
                    <option value="goal_progress">Goal Progress</option>
                    <option value="session_end">Session End</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Message Template</label>
                <textarea
                  value={newSchedule.promptTemplate}
                  onChange={(e) => setNewSchedule({ ...newSchedule, promptTemplate: e.target.value })}
                  placeholder="Hey! How are you doing today?"
                  rows={3}
                  className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm resize-none"
                />
                <p className="text-xs text-theme-text-muted mt-1">
                  Use {'{'}field{'}'} for dynamic values
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 px-3 py-2 bg-theme-accent-primary text-white rounded-lg text-sm hover:bg-theme-accent-primary/80"
                >
                  Create Schedule
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewSchedule(false)}
                  className="px-3 py-2 bg-theme-bg-secondary rounded-lg text-sm hover:bg-theme-bg-tertiary"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Existing Schedules */}
          {schedules.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <BellOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No schedules configured yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map((schedule) => {
                const typeConfig = triggerTypeConfig[schedule.triggerType];
                const Icon = typeConfig.icon;
                return (
                  <div
                    key={schedule.id}
                    className={`bg-theme-bg-tertiary rounded-lg p-4 ${!schedule.isEnabled ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`w-4 h-4 ${typeConfig.color}`} />
                          <span className={`text-xs px-2 py-0.5 rounded ${typeConfig.bg} ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                          {!schedule.isEnabled && (
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-400/10 text-gray-400">
                              Paused
                            </span>
                          )}
                        </div>
                        <h4 className="font-medium">{schedule.name}</h4>
                        <p className="text-sm text-theme-text-secondary mt-1 line-clamp-2">
                          {schedule.promptTemplate}
                        </p>
                        {schedule.nextTriggerAt && (
                          <p className="text-xs text-theme-text-muted mt-2">
                            Next: {new Date(schedule.nextTriggerAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleSchedule(schedule)}
                          className={`p-1.5 rounded ${
                            schedule.isEnabled
                              ? 'text-yellow-400 hover:bg-yellow-400/10'
                              : 'text-green-400 hover:bg-green-400/10'
                          }`}
                          title={schedule.isEnabled ? 'Pause' : 'Enable'}
                        >
                          {schedule.isEnabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          className="p-1.5 text-red-400 hover:bg-red-400/10 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Built-in Templates */}
          <div>
            <h3 className="font-medium mb-3">Built-in Templates</h3>
            <div className="space-y-2">
              {builtins.map((builtin, index) => {
                const typeConfig = triggerTypeConfig[builtin.triggerType];
                const Icon = typeConfig.icon;
                const alreadyAdded = schedules.some(s => s.name === builtin.name);

                return (
                  <div
                    key={index}
                    className={`bg-theme-bg-tertiary rounded-lg p-4 border border-dashed border-theme-border ${
                      alreadyAdded ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`w-4 h-4 ${typeConfig.color}`} />
                          <span className={`text-xs px-2 py-0.5 rounded ${typeConfig.bg} ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                        </div>
                        <h4 className="font-medium">{builtin.name}</h4>
                        <p className="text-sm text-theme-text-secondary mt-1">
                          {builtin.promptTemplate}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAddBuiltin(builtin)}
                        disabled={alreadyAdded}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg ${
                          alreadyAdded
                            ? 'bg-theme-bg-secondary text-theme-text-muted cursor-not-allowed'
                            : 'bg-theme-accent-primary/20 text-theme-accent-primary hover:bg-theme-accent-primary/30'
                        }`}
                      >
                        <Plus className="w-4 h-4" />
                        {alreadyAdded ? 'Added' : 'Add'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* History Section */}
      {activeSection === 'history' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Recent Notifications</h3>
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-theme-bg-tertiary rounded-lg hover:bg-theme-bg-secondary"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>

          {history.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No notification history yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="bg-theme-bg-tertiary rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-2 py-0.5 rounded bg-theme-text-muted/10 text-theme-text-muted">
                          {item.triggerSource}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-theme-text-muted/10 text-theme-text-muted">
                          {item.deliveryMethod}
                        </span>
                      </div>
                      <p className="text-sm text-theme-text-primary">{item.messageSent}</p>
                      <p className="text-xs text-theme-text-muted mt-2">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {item.userResponded && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-400/10 text-green-400">
                        Responded
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
