import { api } from './core';

export interface OnboardingState {
  id: string;
  userId: string;
  status: 'not_started' | 'in_progress' | 'reviewing' | 'completed';
  currentPhase: number;
  currentSection: string;
  collectedData: Record<string, Record<string, string>>;
  sectionStatus: Record<string, 'pending' | 'done' | 'skipped'>;
  sessionId: string | null;
  factsCommitted: boolean;
}

export const onboardingApi = {
  getStatus: () => api<{ onboarding: OnboardingState | null }>('/api/onboarding/status'),
  start: () => api<{ onboarding: OnboardingState }>('/api/onboarding/start', { method: 'POST' }),
  skip: (section?: string) => api<{ onboarding: OnboardingState }>('/api/onboarding/skip', { method: 'POST', body: { section } }),
  commit: () => api<{ committed: number; onboarding: OnboardingState }>('/api/onboarding/commit', { method: 'POST' }),
  reset: () => api<{ success: boolean }>('/api/onboarding/reset', { method: 'POST' }),
  updateData: (section: string, data: Record<string, string>) =>
    api<{ success: boolean }>('/api/onboarding/data', { method: 'PATCH', body: { section, data } }),
};
