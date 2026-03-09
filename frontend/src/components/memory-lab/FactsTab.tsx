'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronDown,
  History,
  Link2,
} from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { UserFact } from '@/lib/api/friends';

const CATEGORIES = ['all', 'personal', 'work', 'preference', 'hobby', 'relationship', 'goal', 'context'];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80' },
  overridden: { bg: 'rgba(234, 179, 8, 0.15)', text: '#facc15' },
  superseded: { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8' },
  expired: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171' },
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  permanent: { bg: 'rgba(148, 163, 184, 0.1)', text: 'var(--theme-text-muted)' },
  default: { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa' },
  temporary: { bg: 'rgba(249, 115, 22, 0.15)', text: '#fb923c' },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.active;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
      style={{ background: colors.bg, color: colors.text }}
    >
      {status}
    </span>
  );
}

function TypeBadge({ fact }: { fact: UserFact }) {
  const colors = TYPE_COLORS[fact.factType] || TYPE_COLORS.permanent;
  let label: string = fact.factType;
  if (fact.factType === 'temporary') {
    if (fact.validUntil) {
      const d = new Date(fact.validUntil);
      label = `temp - ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else {
      label = 'temp - ongoing';
    }
  }
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: colors.bg, color: colors.text }}
    >
      {label}
    </span>
  );
}

function ChainView({ factId }: { factId: string }) {
  const { factChain, factChainId, loadFactChain, clearFactChain } = useMemoryLabStore();
  const isOpen = factChainId === factId;

  const handleToggle = () => {
    if (isOpen) {
      clearFactChain();
    } else {
      loadFactChain(factId);
    }
  };

  return (
    <>
      <button
        onClick={handleToggle}
        className="p-1 rounded hover:bg-white/5 transition"
        title="View chain"
      >
        <Link2 className="w-3.5 h-3.5" style={{ color: isOpen ? 'var(--theme-accent-primary)' : 'var(--theme-text-muted)' }} />
      </button>
      {isOpen && factChain.length > 0 && (
        <tr>
          <td colSpan={8} className="px-6 py-2" style={{ background: 'var(--theme-bg-tertiary)' }}>
            <div className="text-xs space-y-1">
              <span className="font-medium" style={{ color: 'var(--theme-text-secondary)' }}>Supersession Chain:</span>
              {factChain.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2 pl-2" style={{ color: 'var(--theme-text-muted)' }}>
                  <span>{i + 1}.</span>
                  <StatusBadge status={f.factStatus} />
                  <span style={{ color: 'var(--theme-text-primary)' }}>{f.factValue}</span>
                  <span>({f.mentionCount}x)</span>
                  {f.id === factId && <span className="text-[10px] font-bold" style={{ color: 'var(--theme-accent-primary)' }}>current</span>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FactRow({ fact }: { fact: UserFact }) {
  const { editingFactId, setEditingFactId, updateFact, deleteFact, factChainId } = useMemoryLabStore();
  const isEditing = editingFactId === fact.id;
  const [editValue, setEditValue] = useState(fact.factValue);

  const handleSave = () => {
    if (editValue.trim() && editValue !== fact.factValue) {
      updateFact(fact.id, editValue.trim());
    }
    setEditingFactId(null);
  };

  const handleCancel = () => {
    setEditValue(fact.factValue);
    setEditingFactId(null);
  };

  const handleDelete = () => {
    if (confirm(`Delete fact "${fact.factKey}"?`)) {
      deleteFact(fact.id);
    }
  };

  const showChain = factChainId === fact.id;

  return (
    <>
      <tr className="border-b hover:bg-white/[0.02] transition" style={{ borderColor: 'var(--theme-border-default)' }}>
        <td className="px-3 py-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-secondary)' }}
          >
            {fact.category}
          </span>
        </td>
        <td className="px-3 py-2 text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {fact.factKey}
        </td>
        <td className="px-3 py-2">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
                className="flex-1 px-2 py-1 rounded text-sm bg-transparent border outline-none"
                style={{ borderColor: 'var(--theme-accent-primary)', color: 'var(--theme-text-primary)' }}
                autoFocus
              />
              <button onClick={handleSave} className="p-1 text-green-400 hover:bg-green-400/10 rounded">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleCancel} className="p-1 text-red-400 hover:bg-red-400/10 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <span className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>
              {fact.factValue}
            </span>
          )}
        </td>
        <td className="px-2 py-2">
          <StatusBadge status={fact.factStatus} />
        </td>
        <td className="px-2 py-2">
          <TypeBadge fact={fact} />
        </td>
        <td className="px-3 py-2 text-center">
          <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            {fact.mentionCount}
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1 justify-end">
            {fact.supersedesId && <ChainView factId={fact.id} />}
            <button
              onClick={() => { setEditingFactId(fact.id); setEditValue(fact.factValue); }}
              className="p-1 rounded hover:bg-white/5 transition"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 rounded hover:bg-red-400/10 transition"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          </div>
        </td>
      </tr>
      {showChain && <ChainView factId={fact.id} />}
    </>
  );
}

function AddFactModal({ onClose }: { onClose: () => void }) {
  const { createFact } = useMemoryLabStore();
  const [category, setCategory] = useState('personal');
  const [factKey, setFactKey] = useState('');
  const [factValue, setFactValue] = useState('');
  const [factType, setFactType] = useState<'permanent' | 'default' | 'temporary'>('permanent');
  const [validUntil, setValidUntil] = useState('');

  const handleSubmit = async () => {
    if (!factKey.trim() || !factValue.trim()) return;
    await createFact({
      category,
      factKey: factKey.trim(),
      factValue: factValue.trim(),
      factType,
      validUntil: factType === 'temporary' && validUntil ? new Date(validUntil).toISOString() : null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--theme-text-primary)' }}>
          Add New Fact
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            >
              {CATEGORIES.filter(c => c !== 'all').map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Key</label>
            <input
              type="text"
              value={factKey}
              onChange={e => setFactKey(e.target.value)}
              placeholder="e.g., favorite_color"
              className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Value</label>
            <input
              type="text"
              value={factValue}
              onChange={e => setFactValue(e.target.value)}
              placeholder="e.g., blue"
              className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>Type</label>
            <select
              value={factType}
              onChange={e => setFactType(e.target.value as 'permanent' | 'default' | 'temporary')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            >
              <option value="permanent">Permanent</option>
              <option value="default">Default (baseline)</option>
              <option value="temporary">Temporary</option>
            </select>
          </div>
          {factType === 'temporary' && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--theme-text-muted)' }}>
                Valid Until (optional - leave empty for indefinite)
              </label>
              <input
                type="datetime-local"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
                style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition hover:bg-white/5"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!factKey.trim() || !factValue.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40"
            style={{ background: 'var(--theme-accent-primary)', color: 'var(--theme-bg-primary)' }}
          >
            Add Fact
          </button>
        </div>
      </div>
    </div>
  );
}

export function FactsTab() {
  const {
    facts, factsFilter, factsSearch, factsStatusFilter, factHistory,
    setFactsSearch, setFactsFilter, setFactsStatusFilter, loadFactHistory,
    isLoadingFacts,
  } = useMemoryLabStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const filteredFacts = useMemo(() => {
    let result = facts;
    if (factsFilter && factsFilter !== 'all') {
      result = result.filter(f => f.category === factsFilter);
    }
    if (factsSearch) {
      const q = factsSearch.toLowerCase();
      result = result.filter(f =>
        f.factKey.toLowerCase().includes(q) || f.factValue.toLowerCase().includes(q)
      );
    }
    return result;
  }, [facts, factsFilter, factsSearch]);

  const handleToggleHistory = async () => {
    if (!showHistory && factHistory.length === 0) {
      await loadFactHistory();
    }
    setShowHistory(!showHistory);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0 flex-wrap"
        style={{ borderColor: 'var(--theme-border-default)' }}
      >
        <div className="flex items-center gap-1">
          <label className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Category:</label>
          <select
            value={factsFilter || 'all'}
            onChange={e => setFactsFilter(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-transparent border outline-none"
            style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Status:</label>
          <select
            value={factsStatusFilter}
            onChange={e => setFactsStatusFilter(e.target.value as 'active' | 'all')}
            className="px-2 py-1 rounded text-xs bg-transparent border outline-none"
            style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
          >
            <option value="active">Active</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
          <input
            type="text"
            value={factsSearch}
            onChange={e => setFactsSearch(e.target.value)}
            placeholder="Search facts..."
            className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs bg-transparent border outline-none"
            style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
          />
        </div>

        <button
          onClick={handleToggleHistory}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition hover:bg-white/5"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          <History className="w-3.5 h-3.5" />
          History
        </button>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition"
          style={{ background: 'var(--theme-accent-primary)', color: 'var(--theme-bg-primary)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Fact
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead>
            <tr
              className="border-b text-xs sticky top-0"
              style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-muted)' }}
            >
              <th className="px-3 py-2 text-left w-[100px]">Category</th>
              <th className="px-3 py-2 text-left w-[130px]">Key</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-2 py-2 text-left w-[80px]">Status</th>
              <th className="px-2 py-2 text-left w-[110px]">Type</th>
              <th className="px-3 py-2 text-center w-[60px]">Mentions</th>
              <th className="px-3 py-2 text-right w-[90px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingFacts ? (
              <tr>
                <td colSpan={7} className="text-center py-8">
                  <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading...</span>
                </td>
              </tr>
            ) : filteredFacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8">
                  <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>No facts found</span>
                </td>
              </tr>
            ) : (
              filteredFacts.map(fact => <FactRow key={fact.id} fact={fact} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Correction History (collapsible) */}
      {showHistory && (
        <div
          className="border-t max-h-48 overflow-auto shrink-0"
          style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
        >
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
              Correction History
            </span>
            <button onClick={() => setShowHistory(false)}>
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
            </button>
          </div>
          <div className="px-4 pb-3 space-y-1">
            {factHistory.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No corrections recorded</p>
            ) : (
              factHistory.map(h => (
                <div key={h.id} className="text-xs flex items-center gap-2" style={{ color: 'var(--theme-text-muted)' }}>
                  <span>{new Date(h.createdAt).toLocaleDateString()}</span>
                  <span className="font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
                    {h.correctionType === 'delete' ? 'Deleted' :
                     h.correctionType === 'temporary_override' ? 'Temp Override' :
                     h.correctionType === 'expiry' ? 'Expired' :
                     h.correctionType === 'correction' ? 'Corrected' : 'Updated'}
                  </span>
                  <span>&quot;{h.factKey}&quot;</span>
                  {h.oldValue && h.newValue && (
                    <span>from &quot;{h.oldValue}&quot; to &quot;{h.newValue}&quot;</span>
                  )}
                  {h.reason && <span className="italic">({h.reason})</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAddModal && <AddFactModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
