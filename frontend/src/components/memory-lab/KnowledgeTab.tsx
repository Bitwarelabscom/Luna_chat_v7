'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Pin, PinOff, Trash2, Edit3, Save, X,
  BookOpen, Lock, FileText, Cog, Loader2, Tag,
} from 'lucide-react';
import { knowledgeApi, type KnowledgeItem } from '@/lib/api/knowledge';

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'notes', label: 'Notes', icon: FileText },
  { value: 'secrets', label: 'Secrets', icon: Lock },
  { value: 'references', label: 'References', icon: BookOpen },
  { value: 'procedures', label: 'Procedures', icon: Cog },
];

export function KnowledgeTab() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('notes');
  const [newTags, setNewTags] = useState('');
  const [newPinned, setNewPinned] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      if (searchQuery.trim()) {
        const results = await knowledgeApi.search(searchQuery);
        setItems(results);
      } else {
        const results = await knowledgeApi.list({
          category: categoryFilter || undefined,
          limit: 100,
        });
        setItems(results);
      }
    } catch (err) {
      console.error('Failed to load knowledge items:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      await knowledgeApi.create({
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
        tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
        isPinned: newPinned,
      });
      setNewTitle('');
      setNewContent('');
      setNewCategory('notes');
      setNewTags('');
      setNewPinned(false);
      setShowCreateForm(false);
      loadItems();
    } catch (err) {
      console.error('Failed to create knowledge item:', err);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await knowledgeApi.update(id, {
        title: editTitle.trim(),
        content: editContent.trim(),
        category: editCategory,
        tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setEditingId(null);
      loadItems();
    } catch (err) {
      console.error('Failed to update knowledge item:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await knowledgeApi.delete(id);
      loadItems();
    } catch (err) {
      console.error('Failed to delete knowledge item:', err);
    }
  };

  const handleTogglePin = async (item: KnowledgeItem) => {
    try {
      await knowledgeApi.update(item.id, { isPinned: !item.isPinned });
      loadItems();
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const startEdit = (item: KnowledgeItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditCategory(item.category);
    setEditTags((item.tags || []).join(', '));
  };

  const getCategoryIcon = (cat: string) => {
    const found = CATEGORIES.find(c => c.value === cat);
    return found?.icon || FileText;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header with search + filters */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-1.5 flex-1 px-2 py-1 rounded-md" style={{ background: 'var(--theme-bg-tertiary)' }}>
          <Search className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search knowledge..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
          />
        </div>

        {/* Category filter pills */}
        <div className="flex items-center gap-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setCategoryFilter(cat.value)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                categoryFilter === cat.value ? 'bg-white/15' : 'hover:bg-white/5'
              }`}
              style={{
                color: categoryFilter === cat.value ? 'var(--theme-accent-primary)' : 'var(--theme-text-muted)',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="p-1.5 rounded-md transition hover:bg-white/10"
          title="Create knowledge item"
        >
          <Plus className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div
          className="px-4 py-3 border-b space-y-2 shrink-0"
          style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
        >
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
            className="w-full px-2 py-1 text-sm rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none focus:border-[var(--theme-accent-primary)]"
            style={{ color: 'var(--theme-text-primary)' }}
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Content (markdown supported)"
            rows={3}
            className="w-full px-2 py-1 text-sm rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none resize-none focus:border-[var(--theme-accent-primary)]"
            style={{ color: 'var(--theme-text-primary)' }}
          />
          <div className="flex items-center gap-2">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="px-2 py-1 text-xs rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              <option value="notes">Notes</option>
              <option value="secrets">Secrets</option>
              <option value="references">References</option>
              <option value="procedures">Procedures</option>
            </select>
            <input
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="flex-1 px-2 py-1 text-xs rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none"
              style={{ color: 'var(--theme-text-primary)' }}
            />
            <button
              onClick={() => setNewPinned(!newPinned)}
              className="p-1 rounded transition hover:bg-white/10"
              title={newPinned ? 'Pinned' : 'Not pinned'}
            >
              {newPinned ? (
                <Pin className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
              ) : (
                <PinOff className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
              )}
            </button>
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim() || !newContent.trim()}
              className="px-3 py-1 text-xs rounded font-medium transition disabled:opacity-40"
              style={{ background: 'var(--theme-accent-primary)', color: '#000' }}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32" style={{ color: 'var(--theme-text-muted)' }}>
            <BookOpen className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No knowledge items found</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--theme-border-default)' }}>
            {items.map(item => {
              const CatIcon = getCategoryIcon(item.category);
              const isEditing = editingId === item.id;

              return (
                <div
                  key={item.id}
                  className="px-4 py-3 hover:bg-white/[0.02] transition"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-2 py-1 text-sm rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-accent-primary)] outline-none"
                        style={{ color: 'var(--theme-text-primary)' }}
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={4}
                        className="w-full px-2 py-1 text-sm rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none resize-none"
                        style={{ color: 'var(--theme-text-primary)' }}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="px-2 py-1 text-xs rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none"
                          style={{ color: 'var(--theme-text-primary)' }}
                        >
                          <option value="notes">Notes</option>
                          <option value="secrets">Secrets</option>
                          <option value="references">References</option>
                          <option value="procedures">Procedures</option>
                        </select>
                        <input
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="Tags"
                          className="flex-1 px-2 py-1 text-xs rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none"
                          style={{ color: 'var(--theme-text-primary)' }}
                        />
                        <button
                          onClick={() => handleUpdate(item.id)}
                          className="p-1 rounded transition hover:bg-white/10"
                          title="Save"
                        >
                          <Save className="w-3.5 h-3.5 text-green-400" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded transition hover:bg-white/10"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <CatIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate" style={{ color: 'var(--theme-text-primary)' }}>
                              {item.title}
                            </span>
                            {item.isPinned && (
                              <Pin className="w-3 h-3 shrink-0" style={{ color: 'var(--theme-accent-primary)' }} />
                            )}
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                              style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
                            >
                              {item.category}
                            </span>
                          </div>
                          <p
                            className="text-xs mt-0.5 line-clamp-2"
                            style={{ color: 'var(--theme-text-secondary)' }}
                          >
                            {item.content}
                          </p>
                          {item.tags && item.tags.length > 0 && (
                            <div className="flex items-center gap-1 mt-1">
                              <Tag className="w-3 h-3" style={{ color: 'var(--theme-text-muted)' }} />
                              {item.tags.map(tag => (
                                <span
                                  key={tag}
                                  className="text-[10px] px-1 py-0.5 rounded"
                                  style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => handleTogglePin(item)}
                            className="p-1 rounded transition hover:bg-white/10"
                            title={item.isPinned ? 'Unpin' : 'Pin'}
                          >
                            {item.isPinned ? (
                              <PinOff className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
                            ) : (
                              <Pin className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
                            )}
                          </button>
                          <button
                            onClick={() => startEdit(item)}
                            className="p-1 rounded transition hover:bg-white/10"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1 rounded transition hover:bg-white/10"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400/70" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
