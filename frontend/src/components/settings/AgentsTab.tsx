'use client';

import { useState, useEffect } from 'react';
import { Plus, Save, Trash2, RotateCcw, Loader2, Bot, ChevronDown, ChevronRight } from 'lucide-react';
import {
  settingsApi,
  type AgentDefinitionDTO,
  type AgentFormData,
  type AgentCategory,
  type ToolSetId,
  type ProviderStrategy,
  type ToolSetOption,
  type ToolOption,
} from '@/lib/api';

type EditorSection = 'general' | 'prompt' | 'provider' | 'tools' | 'advanced';

const CATEGORY_LABELS: Record<AgentCategory, string> = {
  chat_mode: 'Chat',
  specialist: 'Specialist',
  friend: 'Friend',
  council: 'Council',
  department: 'Department',
  utility: 'Utility',
};

const CATEGORY_COLORS: Record<AgentCategory, string> = {
  chat_mode: '#3B82F6',
  specialist: '#8B5CF6',
  friend: '#F59E0B',
  council: '#6366F1',
  department: '#10B981',
  utility: '#6B7280',
};

const BASE_PROMPT_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'luna_base', label: 'Luna Base' },
  { value: 'agent_base', label: 'Agent Base' },
  { value: 'friend_luna_side', label: 'Friend (Luna side)' },
];

interface FormState {
  name: string;
  category: AgentCategory;
  basePromptId: string;
  promptTemplate: string;
  promptComposable: boolean;
  providerStrategyType: 'user_config' | 'fixed' | 'inherit';
  taskType: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: string;
  toolSets: ToolSetId[];
  additionalTools: string[];
  canBeSummoned: boolean;
  canSummon: string[];
  avatarEmoji: string;
  color: string;
  personality: string;
  maxResponseTokens: string;
  cacheTierEnabled: boolean;
  isActive: boolean;
  sortOrder: number;
}

function agentToForm(agent: AgentDefinitionDTO): FormState {
  const ps = agent.providerStrategy;
  return {
    name: agent.name,
    category: agent.category,
    basePromptId: agent.basePromptId || '',
    promptTemplate: agent.promptTemplate,
    promptComposable: agent.promptComposable,
    providerStrategyType: ps.type,
    taskType: ps.type === 'user_config' ? ps.taskType : 'main_chat',
    provider: ps.type === 'fixed' ? ps.provider : '',
    model: ps.type === 'fixed' ? ps.model : '',
    temperature: agent.temperature,
    maxTokens: agent.maxTokens?.toString() || '',
    toolSets: agent.toolSets,
    additionalTools: agent.additionalTools,
    canBeSummoned: agent.canBeSummoned,
    canSummon: agent.canSummon,
    avatarEmoji: agent.avatarEmoji || '',
    color: agent.color || '',
    personality: agent.personality || '',
    maxResponseTokens: agent.maxResponseTokens?.toString() || '',
    cacheTierEnabled: agent.cacheTierEnabled,
    isActive: agent.isActive,
    sortOrder: agent.sortOrder,
  };
}

function formToData(form: FormState): AgentFormData {
  let providerStrategy: ProviderStrategy;
  if (form.providerStrategyType === 'user_config') {
    providerStrategy = { type: 'user_config', taskType: form.taskType || 'main_chat' };
  } else if (form.providerStrategyType === 'fixed') {
    providerStrategy = { type: 'fixed', provider: form.provider, model: form.model };
  } else {
    providerStrategy = { type: 'inherit' };
  }

  return {
    name: form.name,
    category: form.category,
    basePromptId: form.basePromptId || null,
    promptTemplate: form.promptTemplate,
    promptComposable: form.promptComposable,
    providerStrategy,
    temperature: form.temperature,
    maxTokens: form.maxTokens ? parseInt(form.maxTokens) : null,
    toolSets: form.toolSets,
    additionalTools: form.additionalTools,
    canBeSummoned: form.canBeSummoned,
    canSummon: form.canSummon,
    avatarEmoji: form.avatarEmoji || null,
    color: form.color || null,
    personality: form.personality || null,
    maxResponseTokens: form.maxResponseTokens ? parseInt(form.maxResponseTokens) : null,
    cacheTierEnabled: form.cacheTierEnabled,
    isActive: form.isActive,
    sortOrder: form.sortOrder,
  };
}

const defaultForm: FormState = {
  name: '',
  category: 'specialist',
  basePromptId: '',
  promptTemplate: '',
  promptComposable: false,
  providerStrategyType: 'user_config',
  taskType: 'main_chat',
  provider: '',
  model: '',
  temperature: 0.7,
  maxTokens: '',
  toolSets: ['none'],
  additionalTools: [],
  canBeSummoned: false,
  canSummon: [],
  avatarEmoji: '',
  color: '',
  personality: '',
  maxResponseTokens: '',
  cacheTierEnabled: false,
  isActive: true,
  sortOrder: 50,
};

export default function AgentsTab() {
  const [agents, setAgents] = useState<AgentDefinitionDTO[]>([]);
  const [toolSetOptions, setToolSetOptions] = useState<ToolSetOption[]>([]);
  const [toolOptions, setToolOptions] = useState<ToolOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'view' | 'edit' | 'new'>('view');
  const [form, setForm] = useState<FormState>(defaultForm);
  const [activeSection, setActiveSection] = useState<EditorSection>('general');
  const [categoryFilter, setCategoryFilter] = useState<AgentCategory | 'all'>('all');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const [agentsRes, toolsRes] = await Promise.all([
        settingsApi.getAgents(),
        settingsApi.getToolOptions(),
      ]);
      setAgents(agentsRes.agents);
      setToolSetOptions(toolsRes.toolSets);
      setToolOptions(toolsRes.tools);
    } catch {
      setError('Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  function selectAgent(agent: AgentDefinitionDTO) {
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setEditMode('edit');
    setActiveSection('general');
  }

  function startNew() {
    setSelectedAgentId(null);
    setForm({ ...defaultForm });
    setEditMode('new');
    setActiveSection('general');
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const data = formToData(form);
      if (editMode === 'new') {
        await settingsApi.createAgent(data);
        showSuccess('Agent created');
      } else if (selectedAgentId) {
        const agent = agents.find(a => a.id === selectedAgentId);
        if (agent?.isBuiltin) {
          await settingsApi.saveBuiltinOverride(selectedAgentId, data);
          showSuccess('Override saved');
        } else {
          await settingsApi.updateAgent(selectedAgentId, data);
          showSuccess('Agent updated');
        }
      }
      await loadData();
    } catch (err) {
      setError((err as Error).message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedAgentId) return;
    if (!confirm('Delete this agent?')) return;
    setIsSaving(true);
    try {
      await settingsApi.deleteAgent(selectedAgentId);
      showSuccess('Agent deleted');
      setSelectedAgentId(null);
      setEditMode('view');
      await loadData();
    } catch (err) {
      setError((err as Error).message || 'Delete failed');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!selectedAgentId) return;
    if (!confirm('Reset to builtin defaults?')) return;
    setIsSaving(true);
    try {
      await settingsApi.resetBuiltinOverride(selectedAgentId);
      showSuccess('Reset to defaults');
      await loadData();
      // Re-select to show the reset version
      const refreshed = agents.find(a => a.id === selectedAgentId);
      if (refreshed) selectAgent(refreshed);
    } catch (err) {
      setError((err as Error).message || 'Reset failed');
    } finally {
      setIsSaving(false);
    }
  }

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const filteredAgents = categoryFilter === 'all'
    ? agents
    : agents.filter(a => a.category === categoryFilter);

  // Group by category
  const grouped = new Map<AgentCategory, AgentDefinitionDTO[]>();
  for (const agent of filteredAgents) {
    const list = grouped.get(agent.category) || [];
    list.push(agent);
    grouped.set(agent.category, list);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full min-h-0" style={{ maxHeight: 'calc(100vh - 200px)' }}>
      {/* Left panel - agent list */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
        <button
          onClick={startNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-3 transition hover:brightness-110"
          style={{ background: 'var(--theme-accent-primary)', color: '#fff' }}
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>

        {/* Category filter */}
        <div className="flex flex-wrap gap-1 mb-3">
          {(['all', 'chat_mode', 'specialist', 'friend', 'department', 'utility'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className="px-2 py-0.5 rounded text-[11px] font-medium transition"
              style={{
                background: categoryFilter === cat ? 'var(--theme-accent-primary)' : 'var(--theme-bg-tertiary)',
                color: categoryFilter === cat ? '#fff' : 'var(--theme-text-muted)',
              }}
            >
              {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {Array.from(grouped.entries()).map(([category, catAgents]) => (
            <div key={category}>
              <div
                className="text-[10px] uppercase tracking-wider font-medium px-1 mb-1"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                {CATEGORY_LABELS[category]}
              </div>
              <div className="space-y-0.5">
                {catAgents.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => selectAgent(agent)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition ${
                      selectedAgentId === agent.id
                        ? 'bg-[var(--theme-accent-primary)]/20'
                        : 'hover:bg-[var(--theme-bg-tertiary)]'
                    }`}
                  >
                    <span className="text-base flex-shrink-0">
                      {agent.avatarEmoji || <Bot className="w-4 h-4" style={{ color: agent.color || 'var(--theme-text-muted)' }} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate text-sm"
                          style={{ color: selectedAgentId === agent.id ? 'var(--theme-accent-primary)' : 'var(--theme-text-primary)' }}
                        >
                          {agent.name}
                        </span>
                        {agent.isBuiltin && !agent.isOverridden && (
                          <span className="px-1 py-0 rounded text-[9px] font-medium" style={{ background: '#3B82F620', color: '#3B82F6' }}>
                            Builtin
                          </span>
                        )}
                        {agent.isOverridden && (
                          <span className="px-1 py-0 rounded text-[9px] font-medium" style={{ background: '#F59E0B20', color: '#F59E0B' }}>
                            Modified
                          </span>
                        )}
                        {!agent.isBuiltin && (
                          <span className="px-1 py-0 rounded text-[9px] font-medium" style={{ background: '#10B98120', color: '#10B981' }}>
                            Custom
                          </span>
                        )}
                      </div>
                      {agent.personality && (
                        <div className="text-[11px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
                          {agent.personality}
                        </div>
                      )}
                    </div>
                    {!agent.isActive && (
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#EF4444' }} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel - editor */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {editMode === 'view' ? (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
            <div className="text-center">
              <Bot className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select an agent to edit or create a new one</p>
            </div>
          </div>
        ) : (
          <>
            {/* Status messages */}
            {error && (
              <div className="px-4 py-2 mb-2 rounded text-sm" style={{ background: '#EF444420', color: '#EF4444' }}>
                {error}
              </div>
            )}
            {successMessage && (
              <div className="px-4 py-2 mb-2 rounded text-sm" style={{ background: '#10B98120', color: '#10B981' }}>
                {successMessage}
              </div>
            )}

            {/* Section tabs */}
            <div className="flex gap-1 mb-3 flex-shrink-0">
              {(['general', 'prompt', 'provider', 'tools', 'advanced'] as const).map(section => (
                <button
                  key={section}
                  onClick={() => setActiveSection(section)}
                  className="px-3 py-1.5 rounded text-sm font-medium capitalize transition"
                  style={{
                    background: activeSection === section ? 'var(--theme-accent-primary)' : 'var(--theme-bg-tertiary)',
                    color: activeSection === section ? '#fff' : 'var(--theme-text-muted)',
                  }}
                >
                  {section}
                </button>
              ))}
            </div>

            {/* Section content */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {activeSection === 'general' && (
                <GeneralSection form={form} setForm={setForm} />
              )}
              {activeSection === 'prompt' && (
                <PromptSection form={form} setForm={setForm} />
              )}
              {activeSection === 'provider' && (
                <ProviderSection form={form} setForm={setForm} />
              )}
              {activeSection === 'tools' && (
                <ToolsSection form={form} setForm={setForm} toolSetOptions={toolSetOptions} toolOptions={toolOptions} />
              )}
              {activeSection === 'advanced' && (
                <AdvancedSection form={form} setForm={setForm} />
              )}
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-2 pt-3 mt-3 border-t flex-shrink-0" style={{ borderColor: 'var(--theme-border-default)' }}>
              {editMode === 'edit' && selectedAgent?.isBuiltin && (
                <>
                  {selectedAgent.isOverridden && (
                    <button
                      onClick={handleReset}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition hover:brightness-110"
                      style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset to Default
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition hover:brightness-110"
                    style={{ background: 'var(--theme-accent-primary)', color: '#fff' }}
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Override
                  </button>
                </>
              )}
              {editMode === 'edit' && selectedAgent && !selectedAgent.isBuiltin && (
                <>
                  <button
                    onClick={handleDelete}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition hover:brightness-110"
                    style={{ background: '#EF444420', color: '#EF4444' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition hover:brightness-110"
                    style={{ background: 'var(--theme-accent-primary)', color: '#fff' }}
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Changes
                  </button>
                </>
              )}
              {editMode === 'new' && (
                <>
                  <div className="flex-1" />
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !form.name || !form.promptTemplate}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition hover:brightness-110 disabled:opacity-50"
                    style={{ background: 'var(--theme-accent-primary)', color: '#fff' }}
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Create Agent
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// Section Components
// ============================================

function GeneralSection({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Name">
        <input
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          maxLength={100}
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        />
      </Field>

      <Field label="Category">
        <select
          value={form.category}
          onChange={e => setForm({ ...form, category: e.target.value as AgentCategory })}
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        >
          {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </Field>

      <div className="flex gap-3">
        <Field label="Avatar Emoji" className="w-24">
          <input
            type="text"
            value={form.avatarEmoji}
            onChange={e => setForm({ ...form, avatarEmoji: e.target.value })}
            maxLength={4}
            className="w-full px-3 py-1.5 rounded text-sm text-center"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
          />
        </Field>
        <Field label="Color" className="w-32">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color || '#808080'}
              onChange={e => setForm({ ...form, color: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer"
              style={{ border: '1px solid var(--theme-border-default)' }}
            />
            <input
              type="text"
              value={form.color}
              onChange={e => setForm({ ...form, color: e.target.value })}
              placeholder="#808080"
              className="flex-1 px-2 py-1.5 rounded text-sm"
              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
            />
          </div>
        </Field>
      </div>

      <Field label="Personality">
        <input
          type="text"
          value={form.personality}
          onChange={e => setForm({ ...form, personality: e.target.value })}
          maxLength={500}
          placeholder="Brief personality description"
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        />
      </Field>

      <Field label="Active">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm({ ...form, isActive: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
            Agent is active and available
          </span>
        </label>
      </Field>
    </div>
  );
}

function PromptSection({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Base Prompt ID">
        <select
          value={form.basePromptId}
          onChange={e => setForm({ ...form, basePromptId: e.target.value })}
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        >
          {BASE_PROMPT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Composable">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.promptComposable}
            onChange={e => setForm({ ...form, promptComposable: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
            Prompt is composable (appended to base prompt)
          </span>
        </label>
      </Field>

      <Field label="Prompt Template">
        <textarea
          value={form.promptTemplate}
          onChange={e => setForm({ ...form, promptTemplate: e.target.value })}
          rows={16}
          className="w-full px-3 py-2 rounded text-sm font-mono leading-relaxed"
          style={{
            background: 'var(--theme-bg-tertiary)',
            color: 'var(--theme-text-primary)',
            border: '1px solid var(--theme-border-default)',
            resize: 'vertical',
          }}
        />
        <div className="text-[11px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
          {form.promptTemplate.length.toLocaleString()} characters
        </div>
      </Field>
    </div>
  );
}

function ProviderSection({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Strategy">
        <select
          value={form.providerStrategyType}
          onChange={e => setForm({ ...form, providerStrategyType: e.target.value as 'user_config' | 'fixed' | 'inherit' })}
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        >
          <option value="user_config">User Config (uses configured model for task type)</option>
          <option value="fixed">Fixed (specific provider and model)</option>
          <option value="inherit">Inherit (from calling context)</option>
        </select>
      </Field>

      {form.providerStrategyType === 'user_config' && (
        <Field label="Task Type">
          <input
            type="text"
            value={form.taskType}
            onChange={e => setForm({ ...form, taskType: e.target.value })}
            placeholder="main_chat"
            className="w-full px-3 py-1.5 rounded text-sm"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
          />
        </Field>
      )}

      {form.providerStrategyType === 'fixed' && (
        <>
          <Field label="Provider">
            <input
              type="text"
              value={form.provider}
              onChange={e => setForm({ ...form, provider: e.target.value })}
              placeholder="anthropic, openai, ollama, etc."
              className="w-full px-3 py-1.5 rounded text-sm"
              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={form.model}
              onChange={e => setForm({ ...form, model: e.target.value })}
              placeholder="claude-3-5-sonnet-20241022"
              className="w-full px-3 py-1.5 rounded text-sm"
              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
            />
          </Field>
        </>
      )}

      <Field label={`Temperature: ${form.temperature.toFixed(1)}`}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={form.temperature}
          onChange={e => setForm({ ...form, temperature: parseFloat(e.target.value) })}
          className="w-full"
        />
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          <span>Precise (0)</span>
          <span>Creative (2)</span>
        </div>
      </Field>

      <Field label="Max Tokens">
        <input
          type="number"
          value={form.maxTokens}
          onChange={e => setForm({ ...form, maxTokens: e.target.value })}
          placeholder="Default (model limit)"
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        />
      </Field>
    </div>
  );
}

function ToolsSection({
  form,
  setForm,
  toolSetOptions,
  toolOptions,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  toolSetOptions: ToolSetOption[];
  toolOptions: ToolOption[];
}) {
  const [showIndividualTools, setShowIndividualTools] = useState(false);

  function toggleToolSet(id: ToolSetId) {
    const sets = form.toolSets.includes(id)
      ? form.toolSets.filter(s => s !== id)
      : [...form.toolSets, id];
    setForm({ ...form, toolSets: sets });
  }

  function toggleAdditionalTool(name: string) {
    const tools = form.additionalTools.includes(name)
      ? form.additionalTools.filter(t => t !== name)
      : [...form.additionalTools, name];
    setForm({ ...form, additionalTools: tools });
  }

  return (
    <div className="space-y-4">
      <Field label="Tool Set Presets">
        <div className="grid grid-cols-2 gap-2">
          {toolSetOptions.map(opt => (
            <label
              key={opt.id}
              className="flex items-start gap-2 px-3 py-2 rounded cursor-pointer transition hover:brightness-110"
              style={{ background: 'var(--theme-bg-tertiary)' }}
            >
              <input
                type="checkbox"
                checked={form.toolSets.includes(opt.id)}
                onChange={() => toggleToolSet(opt.id)}
                className="mt-0.5 rounded"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{opt.label}</div>
                <div className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>

      <div>
        <button
          onClick={() => setShowIndividualTools(!showIndividualTools)}
          className="flex items-center gap-1.5 text-sm font-medium mb-2"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          {showIndividualTools ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Additional Individual Tools
        </button>

        {showIndividualTools && (
          <div className="grid grid-cols-2 gap-1">
            {toolOptions.map(tool => (
              <label
                key={tool.name}
                className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm"
                style={{ background: 'var(--theme-bg-tertiary)' }}
                title={`Included in: ${tool.includedInSets.join(', ')}`}
              >
                <input
                  type="checkbox"
                  checked={form.additionalTools.includes(tool.name)}
                  onChange={() => toggleAdditionalTool(tool.name)}
                  className="rounded"
                />
                <span style={{ color: 'var(--theme-text-primary)' }}>{tool.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdvancedSection({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const SUMMON_CATEGORIES: AgentCategory[] = ['specialist', 'friend', 'department', 'utility'];

  function toggleCanSummon(cat: string) {
    const summon = form.canSummon.includes(cat)
      ? form.canSummon.filter(c => c !== cat)
      : [...form.canSummon, cat];
    setForm({ ...form, canSummon: summon });
  }

  return (
    <div className="space-y-3">
      <Field label="Can Be Summoned">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.canBeSummoned}
            onChange={e => setForm({ ...form, canBeSummoned: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
            Other agents can summon this agent
          </span>
        </label>
      </Field>

      <Field label="Can Summon (categories)">
        <div className="flex flex-wrap gap-2">
          {SUMMON_CATEGORIES.map(cat => (
            <label key={cat} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.canSummon.includes(cat)}
                onChange={() => toggleCanSummon(cat)}
                className="rounded"
              />
              <span className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>
                {CATEGORY_LABELS[cat]}
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Max Response Tokens">
        <input
          type="number"
          value={form.maxResponseTokens}
          onChange={e => setForm({ ...form, maxResponseTokens: e.target.value })}
          placeholder="Default"
          className="w-full px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        />
      </Field>

      <Field label="Cache Tier Enabled">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.cacheTierEnabled}
            onChange={e => setForm({ ...form, cacheTierEnabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
            Enable prompt caching tier
          </span>
        </label>
      </Field>

      <Field label="Sort Order">
        <input
          type="number"
          value={form.sortOrder}
          onChange={e => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
          className="w-24 px-3 py-1.5 rounded text-sm"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)', border: '1px solid var(--theme-border-default)' }}
        />
      </Field>
    </div>
  );
}

// ============================================
// Shared components
// ============================================

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-text-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
