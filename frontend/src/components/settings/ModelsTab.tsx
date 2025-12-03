'use client';

import { useState, useEffect } from 'react';
import { RotateCcw, Loader2, Check, ChevronDown } from 'lucide-react';
import { settingsApi, type LLMProvider, type TaskModelConfig, type UserModelConfig } from '@/lib/api';

export default function ModelsTab() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [tasks, setTasks] = useState<TaskModelConfig[]>([]);
  const [configs, setConfigs] = useState<UserModelConfig[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const [availableRes, configsRes] = await Promise.all([
        settingsApi.getAvailableModels(),
        settingsApi.getUserModelConfigs(),
      ]);
      setProviders(availableRes.providers);
      setTasks(availableRes.tasks);
      setConfigs(configsRes.configs);
    } catch {
      setError('Failed to load model configurations');
    } finally {
      setIsLoading(false);
    }
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  function getConfigForTask(taskType: string): UserModelConfig {
    const userConfig = configs.find(c => c.taskType === taskType);
    if (userConfig) return userConfig;

    const taskConfig = tasks.find(t => t.taskType === taskType);
    return {
      taskType,
      provider: taskConfig?.defaultProvider || 'openai',
      model: taskConfig?.defaultModel || 'gpt-4o',
    };
  }

  function getModelsForProvider(providerId: string) {
    const provider = providers.find(p => p.id === providerId);
    return provider?.models || [];
  }

  function formatCost(cost: number | undefined): string {
    if (cost === undefined) return '';
    if (cost < 0.001) return `$${(cost * 1000).toFixed(2)}/M`;
    return `$${cost.toFixed(4)}/1K`;
  }

  function getSelectedModelCost(providerId: string, modelId: string): { input?: number; output?: number } | null {
    const models = getModelsForProvider(providerId);
    const model = models.find(m => m.id === modelId);
    if (!model || (model.costPer1kInput === undefined && model.costPer1kOutput === undefined)) {
      return null;
    }
    return { input: model.costPer1kInput, output: model.costPer1kOutput };
  }

  async function handleProviderChange(taskType: string, newProvider: string) {
    const models = getModelsForProvider(newProvider);
    const firstModel = models[0]?.id || '';

    if (!firstModel) {
      setError(`No models available for ${newProvider}`);
      return;
    }

    await handleModelChange(taskType, newProvider, firstModel);
  }

  async function handleModelChange(taskType: string, provider: string, model: string) {
    setIsSaving(taskType);
    setError(null);

    try {
      await settingsApi.setModelConfig(taskType, provider, model);
      setConfigs(prev => {
        const existing = prev.findIndex(c => c.taskType === taskType);
        const newConfig = { taskType, provider, model };
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = newConfig;
          return updated;
        }
        return [...prev, newConfig];
      });
      showSuccess('Model configuration updated');
    } catch {
      setError('Failed to update model configuration');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleReset() {
    if (!confirm('Reset all model configurations to defaults?')) return;

    setIsSaving('all');
    setError(null);

    try {
      await settingsApi.resetModelConfigs();
      setConfigs([]);
      showSuccess('Model configurations reset to defaults');
    } catch {
      setError('Failed to reset model configurations');
    } finally {
      setIsSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-accent-primary" />
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
          <h3 className="text-lg font-medium text-theme-text-primary">Model Configuration</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Configure which AI models to use for different tasks
          </p>
        </div>
        <button
          onClick={handleReset}
          disabled={isSaving !== null}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded-lg transition disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Reset to Defaults
        </button>
      </div>

      {/* Provider Legend */}
      <div className="flex flex-wrap gap-3 p-3 bg-theme-bg-tertiary/50 rounded-lg">
        {providers.map(provider => (
          <div key={provider.id} className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                provider.id === 'openai'
                  ? 'bg-green-500'
                  : provider.id === 'groq'
                    ? 'bg-orange-500'
                    : provider.id === 'anthropic'
                      ? 'bg-purple-500'
                      : 'bg-blue-500'
              }`}
            />
            <span className="text-sm text-theme-text-secondary">{provider.name}</span>
          </div>
        ))}
      </div>

      {/* Task Configurations */}
      <div className="space-y-4">
        {tasks.map(task => {
          const config = getConfigForTask(task.taskType);
          const models = getModelsForProvider(config.provider);
          const isThisSaving = isSaving === task.taskType;

          return (
            <div
              key={task.taskType}
              className="p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="font-medium text-theme-text-primary">{task.displayName}</h4>
                  <p className="text-sm text-theme-text-muted">{task.description}</p>
                </div>
                {isThisSaving && (
                  <Loader2 className="w-4 h-4 animate-spin text-theme-accent-primary" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Provider Select */}
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Provider</label>
                  <div className="relative">
                    <select
                      value={config.provider}
                      onChange={e => handleProviderChange(task.taskType, e.target.value)}
                      disabled={isSaving !== null}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus disabled:opacity-50"
                    >
                      {providers.map(provider => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                  </div>
                </div>

                {/* Model Select */}
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Model</label>
                  <div className="relative">
                    <select
                      value={config.model}
                      onChange={e => handleModelChange(task.taskType, config.provider, e.target.value)}
                      disabled={isSaving !== null}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-sm appearance-none focus:outline-none focus:border-theme-border-focus disabled:opacity-50"
                    >
                      {models.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name}{model.costPer1kInput !== undefined ? ` - ${formatCost(model.costPer1kInput)} in` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Cost Display */}
              {(() => {
                const cost = getSelectedModelCost(config.provider, config.model);
                if (!cost) return null;
                return (
                  <div className="mt-2 text-xs text-theme-text-muted flex items-center gap-3">
                    <span>Cost:</span>
                    {cost.input !== undefined && (
                      <span className="text-green-400">{formatCost(cost.input)} input</span>
                    )}
                    {cost.output !== undefined && (
                      <span className="text-blue-400">{formatCost(cost.output)} output</span>
                    )}
                  </div>
                );
              })()}

              {/* Default indicator */}
              {config.provider === task.defaultProvider &&
                config.model === task.defaultModel && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-theme-text-muted">
                    <Check className="w-3 h-3" />
                    Using default
                  </div>
                )}
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="p-4 bg-theme-bg-secondary/50 border border-theme-border rounded-lg">
        <h4 className="text-sm font-medium text-theme-text-secondary mb-2">About Model Selection</h4>
        <ul className="text-sm text-theme-text-muted space-y-1">
          <li>
            <strong className="text-theme-text-secondary">Main Chat:</strong> Primary conversation model for Luna
          </li>
          <li>
            <strong className="text-theme-text-secondary">Agents:</strong> Specialized models for research, coding, writing tasks
          </li>
          <li>
            <strong className="text-theme-text-secondary">Background Tasks:</strong> Fact extraction, mood analysis use fast Groq models
          </li>
        </ul>
      </div>
    </div>
  );
}
