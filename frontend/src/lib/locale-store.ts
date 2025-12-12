import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsApi, type TimeFormat, type DateFormat, type UnitSystem } from './api';

interface LocaleState {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  unitSystem: UnitSystem;
  currency: string;
  timezone: string;
  isHydrated: boolean;
  setTimeFormat: (format: TimeFormat) => void;
  setDateFormat: (format: DateFormat) => void;
  setUnitSystem: (system: UnitSystem) => void;
  setCurrency: (currency: string) => void;
  setTimezone: (timezone: string) => void;
  syncToBackend: () => Promise<void>;
  initializeFromSettings: (settings: Record<string, unknown>) => void;
}

// Common currencies
export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '\u20AC' },
  { code: 'GBP', name: 'British Pound', symbol: '\u00A3' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00A5' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
];

// Common timezones
export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (US)' },
  { value: 'America/Chicago', label: 'Central Time (US)' },
  { value: 'America/Denver', label: 'Mountain Time (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Stockholm', label: 'Stockholm (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
  { value: 'UTC', label: 'UTC' },
];

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set, get) => ({
      timeFormat: '24h',
      dateFormat: 'YYYY-MM-DD',
      unitSystem: 'metric',
      currency: 'USD',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      isHydrated: false,

      setTimeFormat: (format) => {
        set({ timeFormat: format });
        get().syncToBackend();
      },

      setDateFormat: (format) => {
        set({ dateFormat: format });
        get().syncToBackend();
      },

      setUnitSystem: (system) => {
        set({ unitSystem: system });
        get().syncToBackend();
      },

      setCurrency: (currency) => {
        set({ currency });
        get().syncToBackend();
      },

      setTimezone: (timezone) => {
        set({ timezone });
        get().syncToBackend();
      },

      syncToBackend: async () => {
        const { timeFormat, dateFormat, unitSystem, currency, timezone } = get();
        try {
          await settingsApi.updateUserSettings({
            timeFormat,
            dateFormat,
            unitSystem,
            currency,
            timezone,
          });
        } catch (error) {
          console.error('Failed to sync locale to backend:', error);
        }
      },

      initializeFromSettings: (settings) => {
        const timeFormat = (settings.timeFormat as TimeFormat) || '24h';
        const dateFormat = (settings.dateFormat as DateFormat) || 'YYYY-MM-DD';
        const unitSystem = (settings.unitSystem as UnitSystem) || 'metric';
        const currency = (settings.currency as string) || 'USD';
        const timezone = (settings.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        set({ timeFormat, dateFormat, unitSystem, currency, timezone, isHydrated: true });
      },
    }),
    {
      name: 'luna-locale',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isHydrated = true;
        }
      },
    }
  )
);

export type { TimeFormat, DateFormat, UnitSystem };
