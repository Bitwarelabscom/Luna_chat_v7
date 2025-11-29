'use client';

import { useState, useRef } from 'react';
import { Download, Upload, Trash2, AlertTriangle, Loader2, Check, X } from 'lucide-react';
import { settingsApi, type BackupData } from '@/lib/api';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
  isLoading,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');

  if (!isOpen) return null;

  const isValid = inputValue === confirmText;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-theme-bg-secondary rounded-xl border border-theme-border p-6 m-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-theme-text-primary">{title}</h3>
        </div>

        <p className="text-theme-text-muted mb-4">{message}</p>

        <div className="mb-4">
          <label className="block text-sm text-theme-text-muted mb-2">
            Type <span className="text-red-400 font-mono">{confirmText}</span> to confirm:
          </label>
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-red-500"
            placeholder={confirmText}
            autoFocus
          />
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
            onClick={() => {
              if (isValid) {
                onConfirm();
                setInputValue('');
              }
            }}
            disabled={!isValid || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition text-white"
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

export default function DataTab() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'memory' | 'all' | null;
  }>({ type: null });

  const fileInputRef = useRef<HTMLInputElement>(null);

  function showSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 5000);
  }

  async function handleExport() {
    setIsExporting(true);
    setError(null);

    try {
      const data = await settingsApi.exportData();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `luna-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showSuccess('Backup downloaded successfully');
    } catch (err) {
      setError('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setError(null);

    try {
      const text = await file.text();
      const data: BackupData = JSON.parse(text);

      if (!data.version || !data.exportedAt) {
        throw new Error('Invalid backup file format');
      }

      const result = await settingsApi.importData(data);

      showSuccess(
        `Imported ${result.imported.sessions} sessions, ${result.imported.facts} facts, ${result.imported.prompts} prompts`
      );
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON file');
      } else {
        setError((err as Error).message || 'Failed to import data');
      }
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleClearMemory() {
    setIsClearing(true);
    setError(null);

    try {
      const result = await settingsApi.clearMemory();
      setConfirmDialog({ type: null });
      showSuccess(
        `Cleared ${result.deleted.facts} facts, ${result.deleted.embeddings} embeddings, ${result.deleted.summaries} summaries`
      );
    } catch (err) {
      setError('Failed to clear memory');
    } finally {
      setIsClearing(false);
    }
  }

  async function handleClearAll() {
    setIsClearing(true);
    setError(null);

    try {
      const result = await settingsApi.clearAllData();
      setConfirmDialog({ type: null });
      showSuccess(
        `Cleared ${result.deleted.sessions} sessions, ${result.deleted.messages} messages, ${result.deleted.facts} facts, ${result.deleted.prompts} prompts`
      );
    } catch (err) {
      setError('Failed to clear data');
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Backup Section */}
      <div>
        <h3 className="text-lg font-medium text-theme-text-primary mb-2">Backup & Restore</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Export your data as a JSON file or restore from a previous backup.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-theme-accent-primary/10 rounded-lg">
                <Download className="w-5 h-5 text-theme-accent-primary" />
              </div>
              <div>
                <h4 className="font-medium text-theme-text-primary">Export Data</h4>
                <p className="text-xs text-theme-text-muted">Download all your data</p>
              </div>
            </div>
            <p className="text-sm text-theme-text-muted mb-4">
              Exports conversations, saved prompts, and memory data.
            </p>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-theme-accent-primary hover:bg-theme-accent-hover disabled:opacity-50 rounded-lg transition text-theme-text-primary"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {isExporting ? 'Exporting...' : 'Download Backup'}
            </button>
          </div>

          <div className="p-4 bg-theme-bg-tertiary/50 rounded-lg border border-theme-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Upload className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h4 className="font-medium text-theme-text-primary">Restore Data</h4>
                <p className="text-xs text-theme-text-muted">Import from backup file</p>
              </div>
            </div>
            <p className="text-sm text-theme-text-muted mb-4">
              Restore conversations and data from a backup file.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition text-white"
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {isImporting ? 'Importing...' : 'Upload Backup'}
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div>
        <h3 className="text-lg font-medium text-red-400 mb-2">Danger Zone</h3>
        <p className="text-sm text-theme-text-muted mb-4">
          Irreversible actions. Make sure to backup your data first.
        </p>

        <div className="space-y-4">
          <div className="p-4 bg-red-500/5 rounded-lg border border-red-500/30">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-medium text-theme-text-primary">Clear Memory</h4>
                <p className="text-sm text-theme-text-muted mt-1">
                  Delete all learned facts, embeddings, and conversation summaries.
                  Your chat history will be preserved.
                </p>
              </div>
              <button
                onClick={() => setConfirmDialog({ type: 'memory' })}
                className="flex-shrink-0 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/50 rounded-lg transition"
              >
                Clear Memory
              </button>
            </div>
          </div>

          <div className="p-4 bg-red-500/5 rounded-lg border border-red-500/30">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-medium text-theme-text-primary">Clear All Data</h4>
                <p className="text-sm text-theme-text-muted mt-1">
                  Delete everything: conversations, memory, saved prompts.
                  This cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setConfirmDialog({ type: 'all' })}
                className="flex-shrink-0 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/50 rounded-lg transition"
              >
                Clear All Data
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.type === 'memory'}
        title="Clear Memory"
        message="This will permanently delete all learned facts, embeddings, and conversation summaries. Your chat history will be preserved."
        confirmText="DELETE"
        onConfirm={handleClearMemory}
        onCancel={() => setConfirmDialog({ type: null })}
        isLoading={isClearing}
      />

      <ConfirmDialog
        isOpen={confirmDialog.type === 'all'}
        title="Clear All Data"
        message="This will permanently delete ALL your data including conversations, memory, and saved prompts. This action cannot be undone."
        confirmText="DELETE ALL"
        onConfirm={handleClearAll}
        onCancel={() => setConfirmDialog({ type: null })}
        isLoading={isClearing}
      />
    </div>
  );
}
