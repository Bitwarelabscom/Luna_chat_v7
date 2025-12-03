'use client';

import { useState } from 'react';
import { Copy, Pencil, RefreshCw, Volume2, Check, X, Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface MessageActionsProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  onEdit?: (newContent: string) => void;
  onRegenerate?: () => void;
  onPlayAudio?: () => void;
  isPlaying?: boolean;
  isLoadingAudio?: boolean;
  disabled?: boolean;
}

export default function MessageActions({
  role,
  content,
  onEdit,
  onRegenerate,
  onPlayAudio,
  isPlaying = false,
  isLoadingAudio = false,
  disabled = false,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleStartEdit = () => {
    setEditContent(content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(content);
  };

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim() !== content) {
      onEdit(editContent.trim());
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="mt-2 space-y-2">
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full p-2 rounded-lg bg-theme-bg-tertiary text-theme-text-primary border border-theme-border focus:border-theme-accent-primary outline-none resize-none min-h-[80px]"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancelEdit}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-theme-bg-tertiary hover:bg-theme-bg-secondary text-theme-text-secondary transition"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleSaveEdit}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-theme-accent-primary hover:bg-theme-accent-hover text-theme-text-primary transition"
          >
            <Check className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      {/* Copy - available for all messages */}
      <button
        onClick={handleCopy}
        disabled={disabled}
        className={clsx(
          'p-1.5 rounded-md transition',
          'text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-bg-tertiary',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>

      {/* Edit - only for user messages */}
      {role === 'user' && onEdit && (
        <button
          onClick={handleStartEdit}
          disabled={disabled}
          className={clsx(
            'p-1.5 rounded-md transition',
            'text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-bg-tertiary',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Edit message"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}

      {/* Regenerate - only for assistant messages */}
      {role === 'assistant' && onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={disabled}
          className={clsx(
            'p-1.5 rounded-md transition',
            'text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-bg-tertiary',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Regenerate response"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}

      {/* Play audio - only for assistant messages */}
      {role === 'assistant' && onPlayAudio && (
        <button
          onClick={onPlayAudio}
          disabled={disabled || isLoadingAudio}
          className={clsx(
            'p-1.5 rounded-md transition',
            isPlaying
              ? 'text-theme-accent-primary bg-theme-accent-primary/10'
              : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-bg-tertiary',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={isPlaying ? 'Playing...' : 'Play audio'}
        >
          {isLoadingAudio ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}
