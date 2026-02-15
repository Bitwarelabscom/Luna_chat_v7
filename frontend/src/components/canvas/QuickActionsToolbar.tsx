'use client';

import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/lib/canvas-store';
import { useChatStore } from '@/lib/store';
import {
  MessageSquare,
  Bug,
  Languages,
  BookOpen,
  Sparkles,
  Plus,
  X,
  Wand2
} from 'lucide-react';

interface QuickAction {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  prompt: string;
  color: string;
}

const PRE_BUILT_ACTIONS: QuickAction[] = [
  {
    id: 'add_comments',
    title: 'Add Comments',
    icon: MessageSquare,
    prompt: 'Add detailed comments to explain the code',
    color: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: 'fix_bugs',
    title: 'Fix Bugs',
    icon: Bug,
    prompt: 'Review the code for bugs and fix any issues found',
    color: 'bg-red-600 hover:bg-red-700',
  },
  {
    id: 'translate',
    title: 'Translate',
    icon: Languages,
    prompt: 'Translate this to Spanish',
    color: 'bg-green-600 hover:bg-green-700',
  },
  {
    id: 'reading_level',
    title: 'Simplify',
    icon: BookOpen,
    prompt: 'Rewrite this at a 5th grade reading level',
    color: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: 'improve',
    title: 'Improve',
    icon: Sparkles,
    prompt: 'Improve the code quality and performance',
    color: 'bg-yellow-600 hover:bg-yellow-700',
  },
];

interface QuickActionsToolbarProps {
  artifactId: string;
  selectedText?: string;
  onActionExecute?: (prompt: string) => void;
}

export function QuickActionsToolbar({
  artifactId,
  selectedText,
  onActionExecute
}: QuickActionsToolbarProps) {
  const { quickActions, loadQuickActions, createQuickAction, deleteQuickAction } = useCanvasStore();
  const { currentSession } = useChatStore();
  const [showCustomDialog, setShowCustomDialog] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  useEffect(() => {
    loadQuickActions();
  }, [loadQuickActions]);

  const handleAction = (prompt: string) => {
    if (!currentSession) return;

    // Build the full prompt
    let fullPrompt = prompt;
    if (selectedText) {
      fullPrompt = `${prompt}\n\nSelected text:\n${selectedText}`;
    }

    // Execute via chat or callback
    if (onActionExecute) {
      onActionExecute(fullPrompt);
    }
  };

  const handleCreateCustomAction = async () => {
    if (!customTitle || !customPrompt) return;

    try {
      await createQuickAction(customTitle, customPrompt);
      setCustomTitle('');
      setCustomPrompt('');
      setShowCustomDialog(false);
    } catch (error) {
      console.error('Failed to create quick action:', error);
    }
  };

  const handleDeleteCustomAction = async (actionId: string) => {
    try {
      await deleteQuickAction(actionId);
    } catch (error) {
      console.error('Failed to delete quick action:', error);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Pre-built Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400 font-semibold">Quick Actions:</span>
        {PRE_BUILT_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={() => handleAction(action.prompt)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white transition-colors ${action.color}`}
              title={action.prompt}
            >
              <Icon className="w-3.5 h-3.5" />
              {action.title}
            </button>
          );
        })}
      </div>

      {/* Custom Actions */}
      {quickActions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 font-semibold">Custom:</span>
          {quickActions.map((action) => (
            <div key={action.id} className="relative group">
              <button
                onClick={() => handleAction(action.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                title={action.prompt}
              >
                <Wand2 className="w-3.5 h-3.5" />
                {action.title}
              </button>
              <button
                onClick={() => handleDeleteCustomAction(action.id)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete action"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Custom Action Button */}
      <div>
        <button
          onClick={() => setShowCustomDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Custom Action
        </button>
      </div>

      {/* Custom Action Dialog */}
      {showCustomDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">Create Custom Action</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g., Make it Pirate-themed"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  maxLength={100}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Prompt
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Describe what this action should do..."
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
                  rows={4}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowCustomDialog(false);
                    setCustomTitle('');
                    setCustomPrompt('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCustomAction}
                  disabled={!customTitle || !customPrompt}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Create Action
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
