'use client';

import { useState } from 'react';
import { useOnboardingStore } from '@/lib/onboarding-store';
import { X, Check, Pencil, Trash2, RotateCcw } from 'lucide-react';

const SECTION_LABELS: Record<string, string> = {
  identity: 'About You',
  household: 'Home & Family',
  work: 'Work',
  interests: 'Interests',
  technical: 'Tech Preferences',
  communication: 'Communication Style',
  health: 'Health & Wellness',
  projects: 'Projects',
  resources: 'Resources',
  goals: 'Goals',
};

export function OnboardingReview() {
  const state = useOnboardingStore((s) => s.state);
  const reviewOpen = useOnboardingStore((s) => s.reviewOpen);
  const setReviewOpen = useOnboardingStore((s) => s.setReviewOpen);
  const commit = useOnboardingStore((s) => s.commit);
  const reset = useOnboardingStore((s) => s.reset);
  const updateField = useOnboardingStore((s) => s.updateField);
  const deleteField = useOnboardingStore((s) => s.deleteField);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  if (!state || !reviewOpen) return null;

  const sections = Object.entries(state.collectedData).filter(([_section, data]) => Object.keys(data).length > 0);
  const totalFacts = sections.reduce((sum, [_section, data]) => sum + Object.keys(data).length, 0);

  const handleCommit = async () => {
    setIsCommitting(true);
    await commit();
    setIsCommitting(false);
  };

  const startEdit = (section: string, key: string, value: string) => {
    setEditingKey(`${section}.${key}`);
    setEditValue(value);
  };

  const saveEdit = (section: string, key: string) => {
    if (editValue.trim()) {
      updateField(section, key, editValue.trim());
    }
    setEditingKey(null);
  };

  return (
    <div className="w-80 border-l border-gray-700 bg-gray-850 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">Review Your Profile</h3>
        <button onClick={() => setReviewOpen(false)} className="text-gray-500 hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {sections.length === 0 ? (
          <p className="text-gray-500 text-sm">No data collected yet.</p>
        ) : (
          sections.map(([section, data]) => (
            <div key={section} className="space-y-1">
              <h4 className="text-xs font-medium text-indigo-400 uppercase tracking-wider">
                {SECTION_LABELS[section] || section}
              </h4>
              {Object.entries(data).map(([key, value]) => {
                const editKey = `${section}.${key}`;
                const isEditing = editingKey === editKey;
                return (
                  <div key={key} className="flex items-start gap-2 group py-1">
                    <span className="text-xs text-gray-500 min-w-[80px] pt-0.5">
                      {key.replace(/_/g, ' ')}
                    </span>
                    {isEditing ? (
                      <div className="flex-1 flex gap-1">
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveEdit(section, key)}
                          className="flex-1 bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600 focus:border-indigo-500 outline-none"
                          autoFocus
                        />
                        <button onClick={() => saveEdit(section, key)} className="text-green-400 hover:text-green-300">
                          <Check className="w-3 h-3" />
                        </button>
                        <button onClick={() => setEditingKey(null)} className="text-gray-500 hover:text-gray-300">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 text-xs text-gray-300">{value}</span>
                        <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                          <button onClick={() => startEdit(section, key, value)} className="text-gray-500 hover:text-gray-300">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => deleteField(section, key)} className="text-gray-500 hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700 space-y-2">
        <p className="text-xs text-gray-500">{totalFacts} facts collected</p>
        <button
          onClick={handleCommit}
          disabled={isCommitting || totalFacts === 0}
          className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isCommitting ? 'Saving...' : 'Save to Memory'}
        </button>
        <button
          onClick={reset}
          className="w-full py-1.5 px-4 text-gray-500 hover:text-gray-300 text-xs transition-colors flex items-center justify-center gap-1"
        >
          <RotateCcw className="w-3 h-3" /> Start Over
        </button>
      </div>
    </div>
  );
}
