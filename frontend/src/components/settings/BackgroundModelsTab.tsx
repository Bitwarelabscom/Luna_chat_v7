'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, ChevronDown } from 'lucide-react';
import {
  settingsApi,
  type LLMProvider,
  type BackgroundLlmFeatureMeta,
  type BackgroundLlmSettings,
  type BackgroundFeatureModelConfig,
  type ProviderId,
} from '@/lib/api';

export default function BackgroundModelsTab() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [features, setFeatures] = useState<BackgroundLlmFeatureMeta[]>([]);
  const [settings, setSettings] = useState<BackgroundLlmSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await settingsApi.getBackgroundLlmSettings();
      setProviders(Array.isArray(result.providers) ? result.providers : []);
      setFeatures(Array.isArray(result.features) ? result.features : []);
      setSettings(result.settings || null);
    } catch {
      setError('Failed to load background AI settings');
    } finally {
      setIsLoading(false);
    }
  }

  function getModelsForProvider(providerId: string) {
    const provider = providers.find(p => p.id === providerId);
    return provider?.models || [];
  }

  function getDefaultModelForProvider(providerId: string): string {
    return getModelsForProvider(providerId)[0]?.id || '';
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  function updateFeatureConfig(
    featureId: keyof BackgroundLlmSettings,
    type: 'primary' | 'fallback',
    next: Partial<BackgroundFeatureModelConfig['primary']>
  ) {
    if (!settings) return;

    const current = settings[featureId][type];
    const provider = next.provider ?? current.provider;
    const model = next.model ?? current.model;
    const models = getModelsForProvider(provider);
    const hasModel = models.some(m => m.id === model);
    const resolvedModel = hasModel ? model : getDefaultModelForProvider(provider);

    setSettings({
      ...settings,
      [featureId]: {
        ...settings[featureId],
        [type]: {
          provider,
          model: resolvedModel || model,
        },
      },
    });
  }

  async function handleSave() {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await settingsApi.updateBackgroundLlmSettings(settings);
      setSettings(result.settings);
      showSuccess('Background AI settings saved');
    } catch {
      setError('Failed to save background AI settings');
    } finally {
      setIsSaving(false);
    }
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
      <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
        Failed to load background AI settings
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
        <div className="p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm">
          {successMessage}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-theme-text-primary">Background AI Models</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Per-feature primary and fallback models. Fallback is used only when primary fails or returns no response.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-hover disabled:opacity-50 transition"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>

      {!features.length && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg text-yellow-400 text-sm">
          No Background AI features were returned by the API.
        </div>
      )}

      {!providers.length && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg text-yellow-400 text-sm">
          No model providers were returned by the API.
        </div>
      )}

      <div className="space-y-4">
        {features.map(feature => {
          const config = settings[feature.id];
          if (!config) {
            return (
              <div key={feature.id} className="p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg text-yellow-400 text-sm">
                Missing model configuration for feature: {feature.label}
              </div>
            );
          }

          const primaryModels = getModelsForProvider(config.primary.provider);
          const fallbackModels = getModelsForProvider(config.fallback.provider);

          return (
            <div key={feature.id} className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg space-y-3">
              <div>
                <h4 className="font-medium text-theme-text-primary">{feature.label}</h4>
                <p className="text-sm text-theme-text-muted">{feature.description}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-theme-text-muted">Primary</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <select
                        value={config.primary.provider}
                        onChange={e => updateFeatureConfig(feature.id, 'primary', { provider: e.target.value as ProviderId })}
                        disabled={providers.length === 0}
                        className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus"
                      >
                        {providers.length === 0 && <option value="">No providers</option>}
                        {providers.map(provider => (
                          <option key={provider.id} value={provider.id}>{provider.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                    </div>
                    <div className="relative">
                      <select
                        value={config.primary.model}
                        onChange={e => updateFeatureConfig(feature.id, 'primary', { model: e.target.value })}
                        disabled={primaryModels.length === 0}
                        className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus"
                      >
                        {primaryModels.length === 0 && <option value="">No models</option>}
                        {primaryModels.map(model => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-theme-text-muted">Fallback</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <select
                        value={config.fallback.provider}
                        onChange={e => updateFeatureConfig(feature.id, 'fallback', { provider: e.target.value as ProviderId })}
                        disabled={providers.length === 0}
                        className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus"
                      >
                        {providers.length === 0 && <option value="">No providers</option>}
                        {providers.map(provider => (
                          <option key={provider.id} value={provider.id}>{provider.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                    </div>
                    <div className="relative">
                      <select
                        value={config.fallback.model}
                        onChange={e => updateFeatureConfig(feature.id, 'fallback', { model: e.target.value })}
                        disabled={fallbackModels.length === 0}
                        className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus"
                      >
                        {fallbackModels.length === 0 && <option value="">No models</option>}
                        {fallbackModels.map(model => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
