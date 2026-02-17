'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { settingsApi, type LLMProvider, type TaskModelConfig, type UserModelConfig } from '@/lib/api/settings';

export function ModelSelector() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [tasks, setTasks] = useState<TaskModelConfig[]>([]);
  const [userConfigs, setUserConfigs] = useState<UserModelConfig[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get current main_chat config
  const mainChatConfig = userConfigs.find((c) => c.taskType === 'main_chat');
  const mainChatTask = tasks.find((t) => t.taskType === 'main_chat');
  const currentProvider = mainChatConfig?.provider || mainChatTask?.defaultProvider || '';
  const currentModel = mainChatConfig?.model || mainChatTask?.defaultModel || '';

  // Find the display name for the current model
  const providerData = providers.find((p) => p.id === currentProvider);
  const modelData = providerData?.models.find((m) => m.id === currentModel);
  const displayName = modelData?.name || currentModel || 'Select model';

  // Fetch on first open
  const fetchModels = async () => {
    setIsLoading(true);
    try {
      const [modelsRes, configsRes] = await Promise.all([
        settingsApi.getAvailableModels(),
        settingsApi.getUserModelConfigs(),
      ]);
      setProviders(modelsRes.providers);
      setTasks(modelsRes.tasks);
      setUserConfigs(configsRes.configs);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    if (!hasFetched) fetchModels();
    setIsOpen(!isOpen);
  };

  const handleSelect = async (providerId: string, modelId: string) => {
    try {
      await settingsApi.setModelConfig('main_chat', providerId, modelId);
      setUserConfigs((prev) => {
        const filtered = prev.filter((c) => c.taskType !== 'main_chat');
        return [...filtered, { taskType: 'main_chat', provider: providerId, model: modelId }];
      });
    } catch (err) {
      console.error('Failed to set model:', err);
    }
    setIsOpen(false);
  };

  // Close on outside click
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-white/5 transition-colors"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        <span className="font-medium truncate max-w-[200px]">{displayName}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 rounded-xl shadow-2xl border overflow-hidden min-w-[280px] max-h-[400px] overflow-y-auto"
          style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border)' }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                  Chat Model
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); fetchModels(); }}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  title="Refresh models"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} style={{ color: 'var(--theme-text-muted)' }} />
                </button>
              </div>
              {providers.filter((p) => p.enabled).map((provider) => (
                <div key={provider.id}>
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                      {provider.name}
                    </span>
                  </div>
                  {provider.models.map((model) => {
                    const isActive = currentProvider === provider.id && currentModel === model.id;
                    return (
                      <button
                        key={`${provider.id}-${model.id}`}
                        onClick={() => handleSelect(provider.id, model.id)}
                        className={`w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors ${
                          isActive ? 'bg-white/10' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                              {model.name}
                            </span>
                            {isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                            )}
                          </div>
                          {model.bestFor?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {model.bestFor.slice(0, 3).map((tag: string) => (
                                <span
                                  key={tag}
                                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'var(--theme-bg-primary)', color: 'var(--theme-text-muted)' }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
                          {Math.round(model.contextWindow / 1000)}k
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ModelSelector;
