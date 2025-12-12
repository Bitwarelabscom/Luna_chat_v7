'use client';

import { useState, useRef, useEffect } from 'react';
import { X, FileText, FileCode, FileJson } from 'lucide-react';

interface NewFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateFile: (filename: string) => void;
}

const FILE_TYPES = [
  { ext: '.txt', label: 'Text', icon: FileText },
  { ext: '.md', label: 'Markdown', icon: FileText },
  { ext: '.json', label: 'JSON', icon: FileJson },
  { ext: '.ts', label: 'TypeScript', icon: FileCode },
  { ext: '.py', label: 'Python', icon: FileCode },
];

export function NewFileDialog({ isOpen, onClose, onCreateFile }: NewFileDialogProps) {
  const [filename, setFilename] = useState('untitled');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleQuickType = (ext: string) => {
    // If filename already has an extension, replace it
    const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
    setFilename(baseName + ext);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (filename.trim()) {
      onCreateFile(filename.trim());
      setFilename('untitled');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="relative w-full max-w-md mx-4 backdrop-blur-xl border rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: 'var(--theme-bg-secondary)',
          borderColor: 'var(--theme-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <h2 className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            New File
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Filename input */}
          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              Filename
            </label>
            <input
              ref={inputRef}
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
              style={{
                background: 'var(--theme-bg-tertiary)',
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text-primary)',
              }}
              placeholder="Enter filename..."
            />
          </div>

          {/* Quick file types */}
          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              Quick Type
            </label>
            <div className="flex flex-wrap gap-2">
              {FILE_TYPES.map(({ ext, label, icon: Icon }) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => handleQuickType(ext)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all hover:bg-white/5 ${
                    filename.endsWith(ext) ? 'ring-2 ring-offset-1 ring-offset-transparent' : ''
                  }`}
                  style={{
                    borderColor: filename.endsWith(ext) ? 'var(--theme-accent-primary)' : 'var(--theme-border)',
                    color: 'var(--theme-text-primary)',
                  }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-secondary)' }} />
                  {label}
                  <span style={{ color: 'var(--theme-text-muted)' }}>{ext}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm hover:bg-white/5 transition-colors"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: 'var(--theme-accent-primary)',
                color: 'white',
              }}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewFileDialog;
