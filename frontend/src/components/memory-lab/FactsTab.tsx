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
  ChevronUp,
  History,
} from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';
import type { UserFact } from '@/lib/api/friends';

const CATEGORIES = ['all', 'personal', 'work', 'preference', 'hobby', 'relationship', 'goal', 'context'];

function FactRow({ fact }: { fact: UserFact }) {
  const { editingFactId, setEditingFactId, updateFact, deleteFact } = useMemoryLabStore();
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

  return (
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
      <td className="px-3 py-2 text-center">
        <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {fact.confidence.toFixed(1)}
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {fact.mentionCount}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 justify-end">
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
  );
}

function AddFactModal({ onClose }: { onClose: () => void }) {
  const { createFact } = useMemoryLabStore();
  const [category, setCategory] = useState('personal');
  const [factKey, setFactKey] = useState('');
  const [factValue, setFactValue] = useState('');

  const handleSubmit = async () => {
    if (!factKey.trim() || !factValue.trim()) return;
    await createFact({ category, factKey: factKey.trim(), factValue: factValue.trim() });
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
    facts, factsFilter, factsSearch, factHistory,
    setFactsSearch, setFactsFilter, loadFactHistory,
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
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
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
              <th className="px-3 py-2 text-left w-[140px]">Key</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-3 py-2 text-center w-[60px]">Conf.</th>
              <th className="px-3 py-2 text-center w-[70px]">Mentions</th>
              <th className="px-3 py-2 text-right w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingFacts ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading...</span>
                </td>
              </tr>
            ) : filteredFacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
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
                    {h.correctionType === 'delete' ? 'Deleted' : 'Updated'}
                  </span>
                  <span>"{h.factKey}"</span>
                  {h.oldValue && h.newValue && (
                    <span>from "{h.oldValue}" to "{h.newValue}"</span>
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
