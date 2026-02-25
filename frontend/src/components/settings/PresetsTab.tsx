'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2, Zap, ChevronDown } from 'lucide-react';
import { settingsApi, type LLMProvider } from '@/lib/api/settings';

interface ModelPreset {
  name: string;
  provider: string;
  model: string;
  label: string;
}

const PRESETS_KEY = 'luna-model-presets';

function loadPresets(): ModelPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  } catch {
    return [];
  }
}

function savePresets(presets: ModelPreset[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export default function PresetsTab() {
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // New preset form state
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    setPresets(loadPresets());
    loadProviders();
  }, []);

  async function loadProviders() {
    setIsLoading(true);
    try {
      const result = await settingsApi.getAvailableModels();
      setProviders(result.providers || []);
      // Default select first provider/model
      if (result.providers && result.providers.length > 0) {
        const firstProvider = result.providers[0];
        setNewProvider(firstProvider.id);
        if (firstProvider.models && firstProvider.models.length > 0) {
          setNewModel(firstProvider.models[0].id);
          setNewLabel(firstProvider.models[0].name);
        }
      }
    } catch {
      // Providers unavailable
    } finally {
      setIsLoading(false);
    }
  }

  const selectedProviderModels = providers.find(p => p.id === newProvider)?.models || [];

  function handleProviderChange(providerId: string) {
    setNewProvider(providerId);
    const providerModels = providers.find(p => p.id === providerId)?.models || [];
    if (providerModels.length > 0) {
      setNewModel(providerModels[0].id);
      setNewLabel(providerModels[0].name);
    } else {
      setNewModel('');
      setNewLabel('');
    }
  }

  function handleModelChange(modelId: string) {
    setNewModel(modelId);
    const model = selectedProviderModels.find(m => m.id === modelId);
    if (model) setNewLabel(model.name);
  }

  function addPreset() {
    if (!newName.trim() || !newProvider || !newModel) return;
    const preset: ModelPreset = {
      name: newName.trim(),
      provider: newProvider,
      model: newModel,
      label: newLabel || newModel,
    };
    const updated = [...presets.filter(p => p.name !== preset.name), preset];
    setPresets(updated);
    savePresets(updated);
    setNewName('');
  }

  function deletePreset(name: string) {
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    savePresets(updated);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Model Presets</h3>
        <p className="text-xs text-gray-500 mb-4">
          Create named presets for quick model switching via <code className="bg-gray-800 px-1 rounded">/model</code> in any chat.
        </p>
      </div>

      {/* Existing presets */}
      {presets.length > 0 && (
        <div className="space-y-2">
          {presets.map((preset) => (
            <div
              key={preset.name}
              className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-700"
            >
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-yellow-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-200">{preset.name}</div>
                  <div className="text-xs text-gray-500">{preset.label} ({preset.provider})</div>
                </div>
              </div>
              <button
                onClick={() => deletePreset(preset.name)}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {presets.length === 0 && (
        <div className="text-center py-6 text-gray-600 text-sm">
          No presets yet. Create one below.
        </div>
      )}

      {/* Add new preset */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add Preset</h4>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Preset name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='e.g. "fast", "smart", "local"'
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Provider</label>
            <div className="relative">
              <select
                value={newProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-slate-500 focus:outline-none"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Model</label>
            <div className="relative">
              <select
                value={newModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-slate-500 focus:outline-none"
              >
                {selectedProviderModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          </div>
        </div>

        <button
          onClick={addPreset}
          disabled={!newName.trim() || !newProvider || !newModel}
          className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors"
        >
          <Plus size={14} />
          Add Preset
        </button>
      </div>

      <div className="text-xs text-gray-600 bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <strong className="text-gray-500">Tip:</strong> Presets appear at the top of the <code className="bg-gray-700 px-1 rounded">/model</code> dropdown in any chat window.
      </div>
    </div>
  );
}
