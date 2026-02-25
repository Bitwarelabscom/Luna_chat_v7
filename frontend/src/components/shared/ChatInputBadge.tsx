'use client';

import { X, BookOpen, Cpu } from 'lucide-react';

interface ChatInputBadgeProps {
  activeSkillName: string | null;
  activeModelLabel: string | null;
  onRemoveSkill: () => void;
}

export function ChatInputBadge({ activeSkillName, activeModelLabel, onRemoveSkill }: ChatInputBadgeProps) {
  if (!activeSkillName && !activeModelLabel) return null;

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      {activeModelLabel && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-900/40 text-blue-300 border border-blue-700/40">
          <Cpu size={10} />
          {activeModelLabel}
        </span>
      )}
      {activeSkillName && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-900/40 text-purple-300 border border-purple-700/40">
          <BookOpen size={10} />
          {activeSkillName}
          <button
            onClick={onRemoveSkill}
            className="ml-0.5 hover:text-white transition-colors"
            title="Remove skill"
          >
            <X size={10} />
          </button>
        </span>
      )}
    </div>
  );
}
