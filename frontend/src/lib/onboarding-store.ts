import { create } from 'zustand';
import { onboardingApi, type OnboardingState } from './api/onboarding';

interface OnboardingStore {
  state: OnboardingState | null;
  isLoading: boolean;
  reviewOpen: boolean;
  fetchStatus: () => Promise<void>;
  startOnboarding: () => Promise<OnboardingState | null>;
  skipSection: (section?: string) => Promise<void>;
  commit: () => Promise<number>;
  reset: () => Promise<void>;
  updateField: (section: string, key: string, value: string) => Promise<void>;
  deleteField: (section: string, key: string) => Promise<void>;
  setReviewOpen: (open: boolean) => void;
  clearState: () => void;
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  state: null,
  isLoading: false,
  reviewOpen: false,

  fetchStatus: async () => {
    try {
      const res = await onboardingApi.getStatus();
      set({ state: res.onboarding });
      // Auto-open review panel if in reviewing state
      if (res.onboarding?.status === 'reviewing') {
        set({ reviewOpen: true });
      }
    } catch {
      // Not logged in or service unavailable
    }
  },

  startOnboarding: async () => {
    set({ isLoading: true });
    try {
      const res = await onboardingApi.start();
      set({ state: res.onboarding, isLoading: false });
      return res.onboarding;
    } catch {
      set({ isLoading: false });
      return null;
    }
  },

  skipSection: async (section?: string) => {
    try {
      const res = await onboardingApi.skip(section);
      set({ state: res.onboarding });
      if (res.onboarding?.status === 'reviewing') {
        set({ reviewOpen: true });
      }
    } catch { /* ignore */ }
  },

  commit: async () => {
    try {
      const res = await onboardingApi.commit();
      set({ state: res.onboarding, reviewOpen: false });
      return res.committed;
    } catch {
      return 0;
    }
  },

  reset: async () => {
    try {
      await onboardingApi.reset();
      set({ state: null, reviewOpen: false });
    } catch { /* ignore */ }
  },

  updateField: async (section: string, key: string, value: string) => {
    const current = get().state;
    if (!current) return;
    // Optimistic update
    const newData = { ...current.collectedData };
    if (!newData[section]) newData[section] = {};
    newData[section] = { ...newData[section], [key]: value };
    set({ state: { ...current, collectedData: newData } });
    try {
      await onboardingApi.updateData(section, { [key]: value });
    } catch { /* revert on failure would be complex - skip for now */ }
  },

  deleteField: async (section: string, key: string) => {
    const current = get().state;
    if (!current) return;
    // Optimistic: remove key
    const newData = { ...current.collectedData };
    if (newData[section]) {
      const { [key]: _deleted, ...rest } = newData[section];
      newData[section] = rest;
      if (Object.keys(rest).length === 0) delete newData[section];
    }
    set({ state: { ...current, collectedData: newData } });
    try {
      await onboardingApi.updateData(section, { [key]: '' });
    } catch { /* ignore */ }
  },

  setReviewOpen: (open: boolean) => set({ reviewOpen: open }),
  clearState: () => set({ state: null, reviewOpen: false }),
}));
