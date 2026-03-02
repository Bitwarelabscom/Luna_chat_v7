'use client';

import { useState } from 'react';
import { X, BookmarkPlus } from 'lucide-react';
import { knowledgeApi } from '@/lib/api/knowledge';

interface SaveToKnowledgeModalProps {
  content: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function SaveToKnowledgeModal({ content, onClose, onSaved }: SaveToKnowledgeModalProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('notes');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await knowledgeApi.create({
        title: title.trim(),
        content: content.trim(),
        category,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('Failed to save to knowledge:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-96 rounded-lg shadow-xl border p-4 space-y-3"
        style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
              Save to Knowledge
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition">
            <X className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
          </button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          autoFocus
          className="w-full px-2 py-1.5 text-sm rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none focus:border-[var(--theme-accent-primary)]"
          style={{ color: 'var(--theme-text-primary)' }}
        />

        <div
          className="max-h-32 overflow-auto p-2 rounded text-xs"
          style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-secondary)' }}
        >
          {content.slice(0, 500)}{content.length > 500 ? '...' : ''}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            <option value="notes">Notes</option>
            <option value="references">References</option>
            <option value="procedures">Procedures</option>
            <option value="secrets">Secrets</option>
          </select>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="flex-1 px-2 py-1 text-xs rounded bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-default)] outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded transition hover:bg-white/10"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="px-3 py-1.5 text-xs rounded font-medium transition disabled:opacity-40"
            style={{ background: 'var(--theme-accent-primary)', color: '#000' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
