'use client';

import { useState, useEffect } from 'react';
import { Plus, Save, Trash2, Check, RotateCcw, Loader2 } from 'lucide-react';
import { settingsApi, type SavedPrompt } from '@/lib/api';

export default function PromptsTab() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [defaultPrompts, setDefaultPrompts] = useState<{
    basePrompt: string;
    assistantMode: string;
    companionMode: string;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'view' | 'edit' | 'new'>('view');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    basePrompt: '',
    assistantAdditions: '',
    companionAdditions: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const [promptsRes, activeRes, defaultsRes] = await Promise.all([
        settingsApi.getSavedPrompts(),
        settingsApi.getActivePrompt(),
        settingsApi.getDefaultPrompts(),
      ]);
      setPrompts(promptsRes.prompts);
      setActivePromptId(activeRes.prompt?.id || null);
      setDefaultPrompts(defaultsRes);
    } catch (err) {
      setError('Failed to load prompts');
    } finally {
      setIsLoading(false);
    }
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  function selectPrompt(prompt: SavedPrompt) {
    setSelectedPromptId(prompt.id);
    setEditMode('edit');
    setFormData({
      name: prompt.name,
      description: prompt.description || '',
      basePrompt: prompt.basePrompt,
      assistantAdditions: prompt.assistantAdditions || '',
      companionAdditions: prompt.companionAdditions || '',
    });
  }

  function startNewPrompt() {
    setSelectedPromptId(null);
    setEditMode('new');
    setFormData({
      name: '',
      description: '',
      basePrompt: defaultPrompts?.basePrompt || '',
      assistantAdditions: '',
      companionAdditions: '',
    });
  }

  function resetToDefaults() {
    if (!defaultPrompts) return;
    setFormData({
      ...formData,
      basePrompt: defaultPrompts.basePrompt,
      assistantAdditions: '',
      companionAdditions: '',
    });
  }

  async function handleSave() {
    if (!formData.name.trim() || !formData.basePrompt.trim()) {
      setError('Name and base prompt are required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (editMode === 'new') {
        const res = await settingsApi.createPrompt({
          name: formData.name,
          description: formData.description || undefined,
          basePrompt: formData.basePrompt,
          assistantAdditions: formData.assistantAdditions || undefined,
          companionAdditions: formData.companionAdditions || undefined,
        });
        setPrompts([...prompts, res.prompt]);
        setSelectedPromptId(res.prompt.id);
        setEditMode('edit');
        showSuccess('Prompt created successfully');
      } else if (selectedPromptId) {
        const res = await settingsApi.updatePrompt(selectedPromptId, {
          name: formData.name,
          description: formData.description || undefined,
          basePrompt: formData.basePrompt,
          assistantAdditions: formData.assistantAdditions || undefined,
          companionAdditions: formData.companionAdditions || undefined,
        });
        setPrompts(prompts.map(p => p.id === selectedPromptId ? res.prompt : p));
        showSuccess('Prompt saved successfully');
      }
    } catch (err) {
      setError('Failed to save prompt');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedPromptId) return;
    if (!confirm('Are you sure you want to delete this prompt?')) return;

    setIsSaving(true);
    try {
      await settingsApi.deletePrompt(selectedPromptId);
      setPrompts(prompts.filter(p => p.id !== selectedPromptId));
      setSelectedPromptId(null);
      setEditMode('view');
      showSuccess('Prompt deleted');
    } catch (err) {
      setError('Failed to delete prompt');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetActive(promptId: string | null) {
    try {
      await settingsApi.setActivePrompt(promptId);
      setActivePromptId(promptId);
      showSuccess(promptId ? 'Active prompt updated' : 'Using default prompt');
    } catch (err) {
      setError('Failed to set active prompt');
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-luna-500" />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prompt List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Saved Prompts
            </h3>
            <button
              onClick={startNewPrompt}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition"
              title="New prompt"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Default Option */}
          <button
            onClick={() => handleSetActive(null)}
            className={`w-full text-left p-3 rounded-lg border transition ${
              !activePromptId
                ? 'border-luna-500 bg-luna-500/10'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Default Prompt</span>
              {!activePromptId && <Check className="w-4 h-4 text-luna-500" />}
            </div>
            <p className="text-xs text-gray-400 mt-1">Built-in Luna personality</p>
          </button>

          {/* Saved Prompts */}
          {prompts.map(prompt => (
            <button
              key={prompt.id}
              onClick={() => selectPrompt(prompt)}
              className={`w-full text-left p-3 rounded-lg border transition ${
                selectedPromptId === prompt.id
                  ? 'border-luna-500 bg-luna-500/10'
                  : activePromptId === prompt.id
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{prompt.name}</span>
                {activePromptId === prompt.id && (
                  <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                    Active
                  </span>
                )}
              </div>
              {prompt.description && (
                <p className="text-xs text-gray-400 mt-1 truncate">{prompt.description}</p>
              )}
            </button>
          ))}

          {prompts.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No custom prompts yet
            </p>
          )}
        </div>

        {/* Editor */}
        <div className="lg:col-span-2 space-y-4">
          {editMode === 'view' ? (
            <div className="text-center text-gray-400 py-12">
              Select a prompt to edit or create a new one
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                  {editMode === 'new' ? 'New Prompt' : 'Edit Prompt'}
                </h3>
                <div className="flex items-center gap-2">
                  {editMode === 'edit' && selectedPromptId && (
                    <>
                      <button
                        onClick={() => handleSetActive(selectedPromptId)}
                        disabled={activePromptId === selectedPromptId}
                        className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition"
                      >
                        Set as Active
                      </button>
                      <button
                        onClick={handleDelete}
                        className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition"
                        title="Delete prompt"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-luna-500"
                      placeholder="My Custom Prompt"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-luna-500"
                      placeholder="A short description"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm text-gray-400">Base Prompt *</label>
                    <button
                      onClick={resetToDefaults}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset to default
                    </button>
                  </div>
                  <textarea
                    value={formData.basePrompt}
                    onChange={e => setFormData({ ...formData, basePrompt: e.target.value })}
                    rows={8}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-luna-500 resize-none"
                    placeholder="Enter the base system prompt..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Assistant Mode Additions
                  </label>
                  <textarea
                    value={formData.assistantAdditions}
                    onChange={e => setFormData({ ...formData, assistantAdditions: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-luna-500 resize-none"
                    placeholder="Additional instructions for assistant mode..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Companion Mode Additions
                  </label>
                  <textarea
                    value={formData.companionAdditions}
                    onChange={e => setFormData({ ...formData, companionAdditions: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-luna-500 resize-none"
                    placeholder="Additional instructions for companion mode..."
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-luna-600 hover:bg-luna-700 disabled:opacity-50 rounded-lg transition"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {editMode === 'new' ? 'Create Prompt' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
