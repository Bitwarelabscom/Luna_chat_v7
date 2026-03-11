'use client';

import { useOnboardingStore } from '@/lib/onboarding-store';
import { SkipForward } from 'lucide-react';

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
  telegram: 'Telegram',
  integrations: 'Integrations',
  tour: 'Luna Tour',
  review: 'Review',
  commit: 'Finish',
};

const ALL_SECTIONS = Object.keys(SECTION_LABELS);

export function OnboardingProgress() {
  const state = useOnboardingStore((s) => s.state);
  const skipSection = useOnboardingStore((s) => s.skipSection);

  if (!state || state.status === 'completed' || state.status === 'not_started') return null;

  const currentIdx = ALL_SECTIONS.indexOf(state.currentSection);
  const totalSections = ALL_SECTIONS.length;
  const progress = totalSections > 0 ? Math.round((currentIdx / totalSections) * 100) : 0;
  const label = SECTION_LABELS[state.currentSection] || state.currentSection;
  const phaseLabel = state.currentPhase <= 3 ? `Phase ${state.currentPhase}` : 'Review';

  return (
    <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700/50 flex items-center gap-3 text-xs">
      <span className="text-gray-400 whitespace-nowrap">{phaseLabel}</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500/70 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-gray-300 whitespace-nowrap">{label}</span>
      {state.status === 'in_progress' && state.currentSection !== 'review' && state.currentSection !== 'commit' && (
        <button
          onClick={() => skipSection()}
          className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
          title="Skip this section"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
