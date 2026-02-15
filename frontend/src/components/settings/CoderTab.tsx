'use client';

import { useState, useEffect } from 'react';
import { Loader2, RotateCcw, Check, ChevronDown, X, Plus, Info } from 'lucide-react';
import { settingsApi, type CoderSettings, type TriggerWords, type LLMProvider, type ProviderId } from '@/lib/api';

export default function CoderTab() {
  const [settings, setSettings] = useState<CoderSettings | null>(null);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [newTriggerWord, setNewTriggerWord] = useState<{ claude: string; gemini: string; api: string; codex: string }>({
    claude: '',
    gemini: '',
    api: '',
    codex: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const [coderRes, modelsRes] = await Promise.all([
        settingsApi.getCoderSettings(),
        settingsApi.getAvailableModels(),
      ]);
      setSettings(coderRes.settings);
      setProviders(modelsRes.providers);
    } catch {
      setError('Failed to load coder settings');
    } finally {
      setIsLoading(false);
    }
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  async function updateSettings(updates: Partial<Omit<CoderSettings, 'userId'>>) {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.updateCoderSettings(updates);
      setSettings(updated.settings);
      showSuccess('Settings saved');
    } catch {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('Reset all coder settings to defaults?')) return;
    setIsSaving(true);
    setError(null);
    try {
      await settingsApi.resetCoderSettings();
      await loadData();
      showSuccess('Settings reset to defaults');
    } catch {
      setError('Failed to reset settings');
    } finally {
      setIsSaving(false);
    }
  }

  function addTriggerWord(coder: keyof TriggerWords) {
    const word = newTriggerWord[coder].trim().toLowerCase();
    if (!word || !settings) return;
    if (settings.triggerWords[coder].includes(word)) return;

    const updated = {
      ...settings.triggerWords,
      [coder]: [...settings.triggerWords[coder], word],
    };
    updateSettings({ triggerWords: updated });
    setNewTriggerWord(prev => ({ ...prev, [coder]: '' }));
  }

  function removeTriggerWord(coder: keyof TriggerWords, word: string) {
    if (!settings) return;
    const updated = {
      ...settings.triggerWords,
      [coder]: settings.triggerWords[coder].filter(w => w !== word),
    };
    updateSettings({ triggerWords: updated });
  }

  function getModelsForProvider(providerId: string) {
    const provider = providers.find(p => p.id === providerId);
    return provider?.models || [];
  }

  function getEnabledCount(): number {
    if (!settings) return 0;
    let count = 0;
    if (settings.claudeCliEnabled) count++;
    if (settings.geminiCliEnabled) count++;
    if (settings.codexCliEnabled) count++;
    if (settings.coderApiEnabled) count++;
    return count;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
        Failed to load coder settings
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" />
          {successMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-theme-text-primary">Coder Agents</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Configure which coding backends Luna can use for code tasks
          </p>
        </div>
        <button
          onClick={handleReset}
          disabled={isSaving}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded-lg transition disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Reset to Defaults
        </button>
      </div>

      {/* Backend Toggles */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-theme-text-secondary">Available Backends</h4>

        {/* Claude CLI */}
        <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.claudeCliEnabled}
              onChange={e => updateSettings({ claudeCliEnabled: e.target.checked })}
              disabled={isSaving}
              className="mt-1 w-4 h-4 rounded border-theme-border bg-theme-bg-secondary text-theme-accent-primary focus:ring-theme-accent-primary/50"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-theme-text-primary">Claude CLI</span>
                <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">Senior Engineer</span>
              </div>
              <p className="text-sm text-theme-text-muted mt-1">
                Best for complex architecture, security-critical code, debugging hard errors, and careful refactoring.
                Requires Claude CLI installed on the server.
              </p>
            </div>
          </label>
        </div>

        {/* Gemini CLI */}
        <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.geminiCliEnabled}
              onChange={e => updateSettings({ geminiCliEnabled: e.target.checked })}
              disabled={isSaving}
              className="mt-1 w-4 h-4 rounded border-theme-border bg-theme-bg-secondary text-theme-accent-primary focus:ring-theme-accent-primary/50"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-theme-text-primary">Gemini CLI</span>
                <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">Rapid Prototyper</span>
              </div>
              <p className="text-sm text-theme-text-muted mt-1">
                Best for fast scripting, unit tests, large context analysis (1M+ tokens), and code explanations.
                Requires Gemini CLI installed on the server.
              </p>
            </div>
          </label>
        </div>

        {/* Coder API */}
        <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.coderApiEnabled}
              onChange={e => updateSettings({ coderApiEnabled: e.target.checked })}
              disabled={isSaving}
              className="mt-1 w-4 h-4 rounded border-theme-border bg-theme-bg-secondary text-theme-accent-primary focus:ring-theme-accent-primary/50"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-theme-text-primary">Coder API</span>
                <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">Flexible</span>
              </div>
              <p className="text-sm text-theme-text-muted mt-1">
                Use any API provider/model for coding tasks. Great for using specialized coding models like GPT-4 or custom models.
              </p>
            </div>
          </label>

          {/* Provider/Model picker when enabled */}
          {settings.coderApiEnabled && (
            <div className="mt-4 ml-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-theme-text-muted mb-1">Provider</label>
                <div className="relative">
                  <select
                    value={settings.coderApiProvider || ''}
                    onChange={e => {
                      const newProvider = e.target.value as ProviderId;
                      const models = getModelsForProvider(newProvider);
                      updateSettings({
                        coderApiProvider: newProvider,
                        coderApiModel: models[0]?.id || null,
                      });
                    }}
                    disabled={isSaving}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus disabled:opacity-50"
                  >
                    <option value="">Select provider...</option>
                    {providers.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-theme-text-muted mb-1">Model</label>
                <div className="relative">
                  <select
                    value={settings.coderApiModel || ''}
                    onChange={e => updateSettings({ coderApiModel: e.target.value })}
                    disabled={isSaving || !settings.coderApiProvider}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus disabled:opacity-50"
                  >
                    <option value="">Select model...</option>
                    {getModelsForProvider(settings.coderApiProvider || '').map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Codex (OpenAI) */}
        <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.codexCliEnabled}
              onChange={e => updateSettings({ codexCliEnabled: e.target.checked })}
              disabled={isSaving}
              className="mt-1 w-4 h-4 rounded border-theme-border bg-theme-bg-secondary text-theme-accent-primary focus:ring-theme-accent-primary/50"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-theme-text-primary">Codex Mini</span>
                <span className="px-2 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 rounded">Balanced Coder</span>
              </div>
              <p className="text-sm text-theme-text-muted mt-1">
                Uses OpenAI <code>codex-mini-latest</code> for fast, practical coding and focused patches.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Default Coder */}
      {getEnabledCount() > 1 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-theme-text-secondary">Default Coder</h4>
          <p className="text-sm text-theme-text-muted">
            When no trigger words match, use this coder as fallback
          </p>
          <div className="flex flex-wrap gap-4">
            {[
              { value: 'claude', label: 'Claude CLI', enabled: settings.claudeCliEnabled },
              { value: 'gemini', label: 'Gemini CLI', enabled: settings.geminiCliEnabled },
              { value: 'codex', label: 'Codex Mini', enabled: settings.codexCliEnabled },
              { value: 'api', label: 'Coder API', enabled: settings.coderApiEnabled },
            ].filter(o => o.enabled).map(option => (
              <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="defaultCoder"
                  value={option.value}
                  checked={settings.defaultCoder === option.value}
                  onChange={e => updateSettings({ defaultCoder: e.target.value as 'claude' | 'gemini' | 'codex' | 'api' })}
                  disabled={isSaving}
                  className="w-4 h-4 border-theme-border bg-theme-bg-secondary text-theme-accent-primary focus:ring-theme-accent-primary/50"
                />
                <span className="text-sm text-theme-text-primary">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Trigger Words */}
      {getEnabledCount() > 1 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-theme-text-secondary">Trigger Words</h4>
            <p className="text-sm text-theme-text-muted mt-1">
              When your message contains these words, Luna will route to the matching coder
            </p>
          </div>

          {/* Claude Triggers */}
          {settings.claudeCliEnabled && (
            <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                <span className="text-sm font-medium text-theme-text-primary">Claude CLI Triggers</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {settings.triggerWords.claude.map(word => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-sm"
                  >
                    {word}
                    <button
                      onClick={() => removeTriggerWord('claude', word)}
                      className="hover:text-purple-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTriggerWord.claude}
                  onChange={e => setNewTriggerWord(prev => ({ ...prev, claude: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addTriggerWord('claude')}
                  placeholder="Add trigger word..."
                  className="flex-1 px-3 py-1.5 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-border-focus"
                />
                <button
                  onClick={() => addTriggerWord('claude')}
                  className="px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Gemini Triggers */}
          {settings.geminiCliEnabled && (
            <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-sm font-medium text-theme-text-primary">Gemini CLI Triggers</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {settings.triggerWords.gemini.map(word => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm"
                  >
                    {word}
                    <button
                      onClick={() => removeTriggerWord('gemini', word)}
                      className="hover:text-blue-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTriggerWord.gemini}
                  onChange={e => setNewTriggerWord(prev => ({ ...prev, gemini: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addTriggerWord('gemini')}
                  placeholder="Add trigger word..."
                  className="flex-1 px-3 py-1.5 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-border-focus"
                />
                <button
                  onClick={() => addTriggerWord('gemini')}
                  className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* API Triggers */}
          {settings.coderApiEnabled && (
            <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-theme-text-primary">Coder API Triggers</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {settings.triggerWords.api.length === 0 ? (
                  <span className="text-sm text-theme-text-muted italic">No triggers set - uses default fallback</span>
                ) : (
                  settings.triggerWords.api.map(word => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-sm"
                    >
                      {word}
                      <button
                        onClick={() => removeTriggerWord('api', word)}
                        className="hover:text-green-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTriggerWord.api}
                  onChange={e => setNewTriggerWord(prev => ({ ...prev, api: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addTriggerWord('api')}
                  placeholder="Add trigger word..."
                  className="flex-1 px-3 py-1.5 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-border-focus"
                />
                <button
                  onClick={() => addTriggerWord('api')}
                  className="px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Codex Triggers */}
          {settings.codexCliEnabled && (
            <div className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                <span className="text-sm font-medium text-theme-text-primary">Codex Triggers</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {settings.triggerWords.codex.length === 0 ? (
                  <span className="text-sm text-theme-text-muted italic">No triggers set - uses default fallback</span>
                ) : (
                  settings.triggerWords.codex.map(word => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded text-sm"
                    >
                      {word}
                      <button
                        onClick={() => removeTriggerWord('codex', word)}
                        className="hover:text-cyan-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTriggerWord.codex}
                  onChange={e => setNewTriggerWord(prev => ({ ...prev, codex: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addTriggerWord('codex')}
                  placeholder="Add trigger word..."
                  className="flex-1 px-3 py-1.5 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:border-theme-border-focus"
                />
                <button
                  onClick={() => addTriggerWord('codex')}
                  className="px-3 py-1.5 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Help Section */}
      <div className="p-4 bg-theme-bg-secondary/50 border border-theme-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-theme-text-muted" />
          <h4 className="text-sm font-medium text-theme-text-secondary">Overriding in Chat</h4>
        </div>
        <p className="text-sm text-theme-text-muted mb-2">
          You can override the coder selection directly in your message:
        </p>
        <ul className="text-sm text-theme-text-muted space-y-1">
          <li>
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-purple-400">@coder-claude</code>
            {' '}or{' '}
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-purple-400">use coder-claude</code>
          </li>
          <li>
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-blue-400">@coder-gemini</code>
            {' '}or{' '}
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-blue-400">use coder-gemini</code>
          </li>
          <li>
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-green-400">@coder-api</code>
            {' '}or{' '}
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-green-400">use coder-api</code>
          </li>
          <li>
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-cyan-400">@coder-codex</code>
            {' '}or{' '}
            <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-cyan-400">use coder-codex</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
