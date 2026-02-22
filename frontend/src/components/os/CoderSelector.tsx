'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { settingsApi, type CoderSettings, type LLMProvider, type ProviderId } from '@/lib/api/settings';

type CoderChoice = 'claude' | 'gemini' | 'codex' | 'api';

function getEnabledCoders(settings: CoderSettings): CoderChoice[] {
  const enabled: CoderChoice[] = [];
  if (settings.claudeCliEnabled) enabled.push('claude');
  if (settings.geminiCliEnabled) enabled.push('gemini');
  if (settings.codexCliEnabled) enabled.push('codex');
  if (settings.coderApiEnabled && settings.coderApiProvider && settings.coderApiModel) enabled.push('api');
  return enabled;
}

function getSelectedCoder(settings: CoderSettings): '' | CoderChoice {
  const enabled = getEnabledCoders(settings);
  if (enabled.length === 1) return enabled[0];
  return '';
}

function getChoiceLabel(choice: '' | CoderChoice): string {
  switch (choice) {
    case 'claude':
      return 'Coder: Claude';
    case 'gemini':
      return 'Coder: Gemini';
    case 'codex':
      return 'Coder: Codex';
    case 'api':
      return 'Coder: API';
    default:
      return 'Coder: Mixed';
  }
}

function getModelsForProvider(providers: LLMProvider[], providerId: string) {
  return providers.find((p) => p.id === providerId)?.models || [];
}

function resolveApiTarget(
  settings: CoderSettings,
  providers: LLMProvider[]
): { provider: ProviderId | ''; model: string } {
  const available = providers.filter((p) => p.enabled && p.models.length > 0);
  if (available.length === 0) return { provider: '', model: '' };

  if (settings.coderApiProvider) {
    const existingProvider = available.find((p) => p.id === settings.coderApiProvider);
    if (existingProvider) {
      const existingModel =
        settings.coderApiModel && existingProvider.models.some((m) => m.id === settings.coderApiModel)
          ? settings.coderApiModel
          : existingProvider.models[0]?.id || '';
      return { provider: existingProvider.id as ProviderId, model: existingModel };
    }
  }

  // Prefer remote Ollama @ 10.0.0.30 for coder API, then fallback.
  const preferred =
    available.find((p) => p.id === 'ollama_tertiary') ||
    available.find((p) => p.id === 'ollama_secondary') ||
    available.find((p) => p.id === 'ollama') ||
    available[0];

  return {
    provider: preferred.id as ProviderId,
    model: preferred.models[0]?.id || '',
  };
}

export function CoderSelector() {
  const [coderSettings, setCoderSettings] = useState<CoderSettings | null>(null);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [apiProvider, setApiProvider] = useState<ProviderId | ''>('');
  const [apiModel, setApiModel] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [isSavingApiTarget, setIsSavingApiTarget] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchCoderSettings = async () => {
    setIsLoading(true);
    try {
      const [coderRes, modelsRes] = await Promise.all([
        settingsApi.getCoderSettings(),
        settingsApi.getAvailableModels(),
      ]);
      setCoderSettings(coderRes.settings);
      setProviders(modelsRes.providers);
      const target = resolveApiTarget(coderRes.settings, modelsRes.providers);
      setApiProvider(target.provider);
      setApiModel(target.model);
      setHasFetched(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    if (!hasFetched) {
      void fetchCoderSettings();
    }
    setIsOpen(!isOpen);
  };

  const saveApiTarget = async (provider: ProviderId, model: string) => {
    setIsSavingApiTarget(true);
    try {
      const result = await settingsApi.updateCoderSettings({
        coderApiProvider: provider,
        coderApiModel: model,
      });
      setCoderSettings(result.settings);
    } finally {
      setIsSavingApiTarget(false);
    }
  };

  const handleSelect = async (choice: CoderChoice) => {
    if (!coderSettings) return;
    if (choice === 'api' && (!apiProvider || !apiModel)) {
      return;
    }

    const nextApiProvider: ProviderId | null =
      choice === 'api' ? (apiProvider || null) : (coderSettings.coderApiProvider || null);
    const nextApiModel: string | null =
      choice === 'api' ? (apiModel || null) : (coderSettings.coderApiModel || null);

    try {
      const result = await settingsApi.updateCoderSettings({
        claudeCliEnabled: choice === 'claude',
        geminiCliEnabled: choice === 'gemini',
        codexCliEnabled: choice === 'codex',
        coderApiEnabled: choice === 'api',
        coderApiProvider: nextApiProvider,
        coderApiModel: nextApiModel,
        defaultCoder: choice,
      });
      setCoderSettings(result.settings);
      setIsOpen(false);
    } finally {
      // no-op
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const currentChoice = coderSettings ? getSelectedCoder(coderSettings) : '';
  const displayName = getChoiceLabel(currentChoice);
  const apiModels = getModelsForProvider(providers, apiProvider);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-white/5 transition-colors"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        <span className="font-medium truncate max-w-[150px]">{displayName}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 rounded-xl shadow-2xl border overflow-hidden min-w-[280px]"
          style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border)' }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                  Coder Agent
                </span>
              </div>

              {[
                { id: 'claude' as const, label: 'Claude CLI' },
                { id: 'gemini' as const, label: 'Gemini CLI' },
                { id: 'codex' as const, label: 'Codex Mini' },
                {
                  id: 'api' as const,
                  label: 'Coder API',
                  disabled: !apiProvider || !apiModel,
                },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => handleSelect(option.id)}
                  disabled={option.disabled}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5 transition-colors disabled:opacity-40 ${
                    currentChoice === option.id ? 'bg-white/10' : ''
                  }`}
                >
                  <span className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>{option.label}</span>
                  {currentChoice === option.id && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                </button>
              ))}

              <div className="px-3 pt-2 pb-1 border-t" style={{ borderColor: 'var(--theme-border)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                  Coder API Target
                </span>
              </div>
              <div className="px-3 pb-3 space-y-2">
                <div className="relative">
                  <select
                    value={apiProvider}
                    onChange={(e) => {
                      const provider = e.target.value as ProviderId;
                      const models = getModelsForProvider(providers, provider);
                      const firstModel = models[0]?.id || '';
                      setApiProvider(provider);
                      setApiModel(firstModel);
                      if (provider && firstModel) {
                        void saveApiTarget(provider, firstModel);
                      }
                    }}
                    disabled={isSavingApiTarget}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus disabled:opacity-50"
                  >
                    {providers
                      .filter((p) => p.enabled && p.models.length > 0)
                      .map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                </div>

                <div className="relative">
                  <select
                    value={apiModel}
                    onChange={(e) => {
                      const model = e.target.value;
                      setApiModel(model);
                      if (apiProvider && model) {
                        void saveApiTarget(apiProvider, model);
                      }
                    }}
                    disabled={isSavingApiTarget || !apiProvider}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus disabled:opacity-50"
                  >
                    {apiModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                </div>

                <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                  Preferred remote target: Ollama 10.0.0.30
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CoderSelector;
