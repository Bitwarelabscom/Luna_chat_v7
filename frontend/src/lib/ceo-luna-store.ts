'use client';

import { create } from 'zustand';
import { workspaceApi } from './api/workspace';
import type { CeoDashboard, RadarSignal, AutopostItem, ProductionSummary, GenreOption, ProposedGenre } from './api/ceo';

export interface CeoFileEntry {
  name: string;
  path: string;
  folder: 'Documents' | 'Plans' | 'Week' | 'Other';
}

type ActiveTab = 'viewer' | 'chat' | 'dashboard' | 'radar' | 'autopost' | 'builds' | 'log' | 'albums';

interface CEOLunaState {
  // Session
  sessionId: string | null;

  // UI
  activeTab: ActiveTab;
  selectedFilePath: string | null;
  fileContent: string | null;
  fileTree: CeoFileEntry[];
  isLoadingTree: boolean;
  isLoadingFile: boolean;

  // Dashboard
  dashboard: CeoDashboard | null;
  isLoadingDashboard: boolean;
  dashboardPeriod: number;

  // Radar
  radarSignals: RadarSignal[];
  isLoadingRadar: boolean;
  radarFilter: 'all' | 'market' | 'music_trend';

  // Proposed Genres
  proposedGenres: ProposedGenre[];
  isLoadingProposedGenres: boolean;

  // Autopost
  autopostQueue: AutopostItem[];
  isLoadingAutopost: boolean;

  // Albums
  productions: ProductionSummary[];
  genres: GenreOption[];
  artists: string[];
  isLoadingProductions: boolean;
  isLoadingGenres: boolean;

  // Actions
  setSessionId: (id: string) => void;
  setActiveTab: (tab: ActiveTab) => void;
  selectFile: (path: string) => Promise<void>;
  loadFileTree: () => Promise<void>;
  loadDashboard: (days?: number) => Promise<void>;
  loadRadarSignals: (limit?: number) => Promise<void>;
  setRadarFilter: (filter: 'all' | 'market' | 'music_trend') => void;
  loadProposedGenres: () => Promise<void>;
  approveProposedGenre: (id: string) => Promise<void>;
  rejectProposedGenre: (id: string) => Promise<void>;
  loadAutopostQueue: (limit?: number) => Promise<void>;
  setDashboardPeriod: (days: number) => void;
  createFile: (folder: string, name: string) => Promise<void>;
  loadProductions: () => Promise<void>;
  loadGenres: () => Promise<void>;
  loadArtists: () => Promise<void>;
}

function classifyFolder(path: string): CeoFileEntry['folder'] {
  const parts = path.split('/');
  if (parts.length < 2) return 'Other';
  const seg = parts[1].toLowerCase();
  if (seg === 'documents') return 'Documents';
  if (seg === 'plans') return 'Plans';
  if (seg === 'week') return 'Week';
  return 'Other';
}

export const useCEOLunaStore = create<CEOLunaState>((set, get) => ({
  sessionId: null,
  activeTab: 'chat',
  selectedFilePath: null,
  fileContent: null,
  fileTree: [],
  isLoadingTree: false,
  isLoadingFile: false,
  dashboard: null,
  isLoadingDashboard: false,
  dashboardPeriod: 30,
  radarSignals: [],
  isLoadingRadar: false,
  radarFilter: 'all',
  proposedGenres: [],
  isLoadingProposedGenres: false,
  autopostQueue: [],
  isLoadingAutopost: false,
  productions: [],
  genres: [],
  artists: [],
  isLoadingProductions: false,
  isLoadingGenres: false,

  setSessionId: (id) => set({ sessionId: id }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setDashboardPeriod: (days) => set({ dashboardPeriod: days }),

  selectFile: async (path) => {
    set({ selectedFilePath: path, activeTab: 'viewer', isLoadingFile: true });
    try {
      const { content } = await workspaceApi.getFile(path);
      set({ fileContent: content });
    } catch (err) {
      console.error('Failed to load file:', err);
      set({ fileContent: null });
    } finally {
      set({ isLoadingFile: false });
    }
  },

  loadFileTree: async () => {
    set({ isLoadingTree: true });
    try {
      const files = await workspaceApi.listFiles();
      const ceoFiles = files
        .filter((f) => f.path.startsWith('ceo-luna/') && f.name.endsWith('.md'))
        .map((f) => ({
          name: f.name,
          path: f.path,
          folder: classifyFolder(f.path),
        }));
      set({ fileTree: ceoFiles });
    } catch (err) {
      console.error('Failed to load CEO file tree:', err);
    } finally {
      set({ isLoadingTree: false });
    }
  },

  loadDashboard: async (days) => {
    const period = days ?? get().dashboardPeriod;
    set({ isLoadingDashboard: true });
    try {
      const { fetchDashboard } = await import('./api/ceo');
      const { dashboard } = await fetchDashboard(period);
      set({ dashboard, dashboardPeriod: period });
    } catch (err) {
      console.error('Failed to load CEO dashboard:', err);
    } finally {
      set({ isLoadingDashboard: false });
    }
  },

  loadRadarSignals: async (limit = 20) => {
    set({ isLoadingRadar: true });
    try {
      const { fetchRadarSignals } = await import('./api/ceo');
      const { signals } = await fetchRadarSignals(limit);
      set({ radarSignals: signals });
    } catch (err) {
      console.error('Failed to load radar signals:', err);
    } finally {
      set({ isLoadingRadar: false });
    }
  },

  setRadarFilter: (filter) => set({ radarFilter: filter }),

  loadProposedGenres: async () => {
    set({ isLoadingProposedGenres: true });
    try {
      const { fetchProposedGenres } = await import('./api/ceo');
      const { proposals } = await fetchProposedGenres('pending');
      set({ proposedGenres: proposals });
    } catch (err) {
      console.error('Failed to load proposed genres:', err);
    } finally {
      set({ isLoadingProposedGenres: false });
    }
  },

  approveProposedGenre: async (id) => {
    try {
      const { approveGenre } = await import('./api/ceo');
      await approveGenre(id);
      // Remove from local state
      set(state => ({
        proposedGenres: state.proposedGenres.filter(g => g.id !== id),
      }));
    } catch (err) {
      console.error('Failed to approve genre:', err);
    }
  },

  rejectProposedGenre: async (id) => {
    try {
      const { rejectGenre } = await import('./api/ceo');
      await rejectGenre(id);
      set(state => ({
        proposedGenres: state.proposedGenres.filter(g => g.id !== id),
      }));
    } catch (err) {
      console.error('Failed to reject genre:', err);
    }
  },

  loadAutopostQueue: async (limit = 20) => {
    set({ isLoadingAutopost: true });
    try {
      const { fetchAutopostQueue } = await import('./api/ceo');
      const { posts } = await fetchAutopostQueue(limit);
      set({ autopostQueue: posts });
    } catch (err) {
      console.error('Failed to load autopost queue:', err);
    } finally {
      set({ isLoadingAutopost: false });
    }
  },

  loadProductions: async () => {
    set({ isLoadingProductions: true });
    try {
      const { fetchProductions } = await import('./api/ceo');
      const { productions } = await fetchProductions();
      set({ productions });
    } catch (err) {
      console.error('Failed to load productions:', err);
    } finally {
      set({ isLoadingProductions: false });
    }
  },

  loadGenres: async () => {
    set({ isLoadingGenres: true });
    try {
      const { fetchGenres } = await import('./api/ceo');
      const { genres } = await fetchGenres();
      set({ genres });
    } catch (err) {
      console.error('Failed to load genres:', err);
    } finally {
      set({ isLoadingGenres: false });
    }
  },

  loadArtists: async () => {
    try {
      const { fetchArtists } = await import('./api/ceo');
      const { artists } = await fetchArtists();
      set({ artists });
    } catch (err) {
      console.error('Failed to load artists:', err);
    }
  },

  createFile: async (folder, name) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const path = `ceo-luna/${folder}/${slug}.md`;
    const content = `# ${name}\n\n`;
    try {
      try {
        await workspaceApi.createFile(path, content);
      } catch {
        await workspaceApi.updateFile(path, content);
      }
      await get().loadFileTree();
      await get().selectFile(path);
    } catch (err) {
      console.error('Failed to create CEO file:', err);
      throw err;
    }
  },
}));
