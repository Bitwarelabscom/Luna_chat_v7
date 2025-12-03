'use client';

import { useState, useEffect } from 'react';
import { Brain, Search, Trash2, Edit2, History, Loader2, X, Check, AlertTriangle } from 'lucide-react';
import { factsApi, type UserFact, type FactCorrection } from '@/lib/api';

const CATEGORY_COLORS: Record<string, string> = {
  personal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  work: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  preference: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  hobby: 'bg-green-500/20 text-green-400 border-green-500/30',
  relationship: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  goal: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  context: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

interface EditingFact {
  id: string;
  newValue: string;
}

interface ConfirmDeleteProps {
  fact: UserFact;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function ConfirmDelete({ fact, onConfirm, onCancel, isLoading }: ConfirmDeleteProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-theme-bg-secondary rounded-xl border border-theme-border p-6 m-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Delete Fact</h3>
        </div>

        <p className="text-theme-text-muted mb-4">
          Are you sure you want to delete this fact?
        </p>

        <div className="p-3 bg-theme-bg-tertiary rounded-lg mb-4">
          <span className="text-theme-text-muted">{fact.factKey}:</span>{' '}
          <span className="text-theme-text-primary">&quot;{fact.factValue}&quot;</span>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition text-white"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MemoryTab() {
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [history, setHistory] = useState<FactCorrection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingFact, setEditingFact] = useState<EditingFact | null>(null);
  const [deletingFact, setDeletingFact] = useState<UserFact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadFacts();
  }, []);

  async function loadFacts() {
    setIsLoading(true);
    setError(null);
    try {
      const [factsData, historyData] = await Promise.all([
        factsApi.getFacts(),
        factsApi.getCorrectionHistory({ limit: 20 }),
      ]);
      setFacts(factsData);
      setHistory(historyData);
    } catch {
      setError('Failed to load facts');
    } finally {
      setIsLoading(false);
    }
  }

  function showSuccessMessage(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleDelete(fact: UserFact) {
    setIsDeleting(true);
    try {
      await factsApi.deleteFact(fact.id, 'Deleted from settings');
      setFacts(facts.filter(f => f.id !== fact.id));
      setDeletingFact(null);
      showSuccessMessage(`Deleted fact: ${fact.factKey}`);
      // Refresh history
      const historyData = await factsApi.getCorrectionHistory({ limit: 20 });
      setHistory(historyData);
    } catch {
      setError('Failed to delete fact');
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingFact) return;

    setIsSaving(true);
    try {
      await factsApi.updateFact(editingFact.id, editingFact.newValue, 'Updated from settings');
      setFacts(facts.map(f =>
        f.id === editingFact.id ? { ...f, factValue: editingFact.newValue } : f
      ));
      setEditingFact(null);
      showSuccessMessage('Fact updated');
      // Refresh history
      const historyData = await factsApi.getCorrectionHistory({ limit: 20 });
      setHistory(historyData);
    } catch {
      setError('Failed to update fact');
    } finally {
      setIsSaving(false);
    }
  }

  const categories = Array.from(new Set(facts.map(f => f.category)));

  const filteredFacts = facts.filter(f => {
    const matchesSearch = searchQuery === '' ||
      f.factKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.factValue.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || f.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Group facts by category for display
  const groupedFacts = filteredFacts.reduce((acc, fact) => {
    if (!acc[fact.category]) acc[fact.category] = [];
    acc[fact.category].push(fact);
    return acc;
  }, {} as Record<string, UserFact[]>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Header with info */}
      <div className="flex items-start gap-4">
        <div className="p-3 bg-theme-accent-primary/10 rounded-xl">
          <Brain className="w-6 h-6 text-theme-accent-primary" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-theme-text-primary">Luna&apos;s Memory</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Facts Luna has learned about you from conversations. You can edit or delete any fact here,
            or simply tell Luna in a chat to forget or correct something.
          </p>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search facts..."
            className="w-full pl-10 pr-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-theme-accent-primary"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              !selectedCategory
                ? 'bg-theme-accent-primary text-white'
                : 'bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            All ({facts.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                cat === selectedCategory
                  ? 'bg-theme-accent-primary text-white'
                  : 'bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {cat} ({facts.filter(f => f.category === cat).length})
            </button>
          ))}
        </div>
      </div>

      {/* Toggle history view */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition ${
            showHistory
              ? 'bg-theme-accent-primary/20 text-theme-accent-primary'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <History className="w-4 h-4" />
          Correction History ({history.length})
        </button>
      </div>

      {/* Facts list or History */}
      {showHistory ? (
        <div className="space-y-3">
          {history.length === 0 ? (
            <p className="text-center text-theme-text-muted py-8">No correction history yet</p>
          ) : (
            history.map(correction => (
              <div
                key={correction.id}
                className="p-3 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    correction.correctionType === 'delete'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {correction.correctionType}
                  </span>
                  <span className="text-theme-text-primary font-medium">{correction.factKey}</span>
                  <span className="text-theme-text-muted text-xs ml-auto">
                    {new Date(correction.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-sm">
                  {correction.correctionType === 'delete' ? (
                    <span className="text-red-400 line-through">&quot;{correction.oldValue}&quot;</span>
                  ) : (
                    <>
                      <span className="text-theme-text-muted line-through">&quot;{correction.oldValue}&quot;</span>
                      <span className="mx-2 text-theme-text-muted">-&gt;</span>
                      <span className="text-green-400">&quot;{correction.newValue}&quot;</span>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.keys(groupedFacts).length === 0 ? (
            <p className="text-center text-theme-text-muted py-8">
              {searchQuery || selectedCategory
                ? 'No facts match your search'
                : 'Luna hasn\'t learned any facts about you yet. Start chatting!'}
            </p>
          ) : (
            Object.entries(groupedFacts).map(([category, categoryFacts]) => (
              <div key={category}>
                <h4 className="text-sm font-medium text-theme-text-muted mb-3 capitalize flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[category]?.split(' ')[0] || 'bg-gray-500'}`} />
                  {category}
                </h4>
                <div className="space-y-2">
                  {categoryFacts.map(fact => (
                    <div
                      key={fact.id}
                      className="group flex items-start gap-3 p-3 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border hover:border-theme-border-hover transition"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-theme-text-muted text-sm">{fact.factKey}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs border ${CATEGORY_COLORS[fact.category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                            {Math.round(fact.confidence * 100)}%
                          </span>
                        </div>

                        {editingFact?.id === fact.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingFact.newValue}
                              onChange={e => setEditingFact({ ...editingFact, newValue: e.target.value })}
                              className="flex-1 px-2 py-1 bg-theme-bg-secondary border border-theme-border rounded text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') setEditingFact(null);
                              }}
                            />
                            <button
                              onClick={handleSaveEdit}
                              disabled={isSaving}
                              className="p-1.5 text-green-400 hover:bg-green-500/20 rounded transition"
                            >
                              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => setEditingFact(null)}
                              className="p-1.5 text-theme-text-muted hover:bg-theme-bg-tertiary rounded transition"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-theme-text-primary break-words">&quot;{fact.factValue}&quot;</p>
                        )}

                        <p className="text-xs text-theme-text-muted mt-1">
                          Mentioned {fact.mentionCount} time{fact.mentionCount !== 1 ? 's' : ''} - last {new Date(fact.lastMentioned).toLocaleDateString()}
                        </p>
                      </div>

                      {editingFact?.id !== fact.id && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => setEditingFact({ id: fact.id, newValue: fact.factValue })}
                            className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded transition"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeletingFact(fact)}
                            className="p-1.5 text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deletingFact && (
        <ConfirmDelete
          fact={deletingFact}
          onConfirm={() => handleDelete(deletingFact)}
          onCancel={() => setDeletingFact(null)}
          isLoading={isDeleting}
        />
      )}
    </div>
  );
}
