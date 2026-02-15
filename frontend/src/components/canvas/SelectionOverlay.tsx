'use client';

import React from 'react';
import { Edit3, MessageSquare, Bug, Sparkles, X } from 'lucide-react';

interface SelectionOverlayProps {
  selectedText: string;
  characterCount: number;
  onEdit: () => void;
  onAddComments: () => void;
  onFixBugs: () => void;
  onImprove: () => void;
  onClose: () => void;
}

export function SelectionOverlay({
  selectedText,
  characterCount,
  onEdit,
  onAddComments,
  onFixBugs,
  onImprove,
  onClose,
}: SelectionOverlayProps) {
  return (
    <div className="absolute bottom-4 right-4 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-4 min-w-[280px] max-w-[400px] z-50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">Selection Actions</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
          title="Close"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Info */}
      <div className="mb-3 text-xs text-gray-400">
        {characterCount} characters selected
      </div>

      {/* Preview */}
      <div className="mb-3 p-2 bg-gray-900 rounded text-xs text-gray-300 max-h-20 overflow-y-auto">
        {selectedText.length > 100
          ? selectedText.substring(0, 100) + '...'
          : selectedText}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          onClick={onEdit}
          className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
        >
          <Edit3 className="w-4 h-4" />
          Edit Selection
        </button>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onAddComments}
            className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
            title="Add comments to explain the selected code"
          >
            <MessageSquare className="w-4 h-4" />
            Comment
          </button>

          <button
            onClick={onFixBugs}
            className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
            title="Review and fix bugs in selection"
          >
            <Bug className="w-4 h-4" />
            Fix Bugs
          </button>

          <button
            onClick={onImprove}
            className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
            title="Improve code quality"
          >
            <Sparkles className="w-4 h-4" />
            Improve
          </button>
        </div>
      </div>
    </div>
  );
}
