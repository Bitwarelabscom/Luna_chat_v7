'use client';

import { create } from 'zustand';
import { workspaceApi } from './api/workspace';
import type {
  CeoDashboard, RadarSignal, AutopostItem, ProductionSummary, GenreOption, ProposedGenre,
  OrgTask, WeeklyGoal, AbilityProposal, RecommendedAction, DepartmentSummary,
  FinanceEntry, FinanceCreatePayload, FinanceUpdatePayload,
  CeoProposal, StaffSession, StaffMessage, CeoMemo, DepartmentSlug,
} from './api/ceo';

export interface CeoFileEntry {
  name: string;
  path: string;
  folder: 'Documents' | 'Plans' | 'Week' | 'Other';
}

type ActiveTab = 'viewer' | 'chat' | 'dashboard' | 'finances' | 'org' | 'staff' | 'radar' | 'autopost' | 'builds' | 'log' | 'albums';

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

  // Organization
  orgDepartments: DepartmentSummary[];
  orgTasks: OrgTask[];
  orgGoals: WeeklyGoal[];
  orgProposals: AbilityProposal[];
  orgActions: RecommendedAction[];
  isLoadingOrg: boolean;
  orgDeptFilter: string;

  // Finances
  financeEntries: FinanceEntry[];
  financesTotal: number;
  isLoadingFinances: boolean;
  financeFilter: 'all' | 'expense' | 'income' | 'owner_pay';
  financePeriod: number;

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
  loadFinances: () => Promise<void>;
  setFinanceFilter: (filter: 'all' | 'expense' | 'income' | 'owner_pay') => void;
  setFinancePeriod: (days: number) => void;
  createFinance: (payload: FinanceCreatePayload) => Promise<void>;
  updateFinance: (id: string, payload: FinanceUpdatePayload) => Promise<void>;
  deleteFinance: (id: string) => Promise<void>;

  loadProductions: () => Promise<void>;
  loadGenres: () => Promise<void>;
  loadArtists: () => Promise<void>;

  // Org actions
  loadOrgOverview: () => Promise<void>;
  setOrgDeptFilter: (dept: string) => void;
  approveOrgTask: (id: string) => Promise<void>;
  rejectOrgTask: (id: string) => Promise<void>;
  updateOrgAction: (id: string, status: 'dismissed' | 'done') => Promise<void>;
  approveOrgProposal: (id: string) => Promise<void>;
  rejectOrgProposal: (id: string) => Promise<void>;

  // Memos
  orgMemos: CeoMemo[];
  isLoadingMemos: boolean;
  loadMemos: (department?: string) => Promise<void>;

  // Background task execution
  runningTasks: OrgTask[];
  recentlyCompletedTasks: OrgTask[];
  taskPollingInterval: ReturnType<typeof setInterval> | null;
  startTask: (taskId: string) => Promise<void>;
  pollRunningTasks: () => Promise<void>;
  startTaskPolling: () => void;
  stopTaskPolling: () => void;
  createOrgTask: (data: { departmentSlug: DepartmentSlug; title: string; description?: string; priority?: number }) => Promise<void>;

  // Proposals
  ceoProposals: CeoProposal[];
  pendingProposalCount: number;
  isLoadingProposals: boolean;
  loadCeoProposals: () => Promise<void>;
  loadProposalCount: () => Promise<void>;
  approveCeoProposal: (id: string) => Promise<void>;
  rejectCeoProposal: (id: string) => Promise<void>;
  batchDecideProposals: (action: 'approve' | 'reject') => Promise<void>;

  // Staff Chat
  staffSessions: Record<string, StaffSession | null>;
  staffMessages: Record<string, StaffMessage[]>;
  staffActiveTab: 'economy' | 'marketing' | 'development' | 'research' | 'meeting';
  isStaffSending: boolean;
  setStaffActiveTab: (tab: 'economy' | 'marketing' | 'development' | 'research' | 'meeting') => void;
  loadStaffSession: (dept: string) => Promise<void>;
  sendStaffMessage: (sessionId: string, message: string) => Promise<void>;
  sendMeetingMessage: (sessionId: string, message: string) => Promise<void>;
  clearStaffSession: (sessionId: string) => Promise<void>;
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
  orgDepartments: [],
  orgTasks: [],
  orgGoals: [],
  orgProposals: [],
  orgActions: [],
  isLoadingOrg: false,
  orgDeptFilter: 'all',

  financeEntries: [],
  financesTotal: 0,
  isLoadingFinances: false,
  financeFilter: 'all',
  financePeriod: 90,

  productions: [],
  genres: [],
  artists: [],
  isLoadingProductions: false,
  isLoadingGenres: false,

  // Proposals
  ceoProposals: [],
  pendingProposalCount: 0,
  isLoadingProposals: false,

  // Memos
  orgMemos: [],
  isLoadingMemos: false,

  // Background task execution
  runningTasks: [],
  recentlyCompletedTasks: [],
  taskPollingInterval: null,

  // Staff Chat
  staffSessions: {},
  staffMessages: {},
  staffActiveTab: 'economy',
  isStaffSending: false,

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

  loadFinances: async () => {
    set({ isLoadingFinances: true });
    try {
      const { fetchFinances } = await import('./api/ceo');
      const filter = get().financeFilter;
      const days = get().financePeriod;
      const type = filter === 'all' ? undefined : filter;
      const { entries, total } = await fetchFinances({ type, days, limit: 200 });
      set({ financeEntries: entries, financesTotal: total });
    } catch (err) {
      console.error('Failed to load finances:', err);
    } finally {
      set({ isLoadingFinances: false });
    }
  },

  setFinanceFilter: (filter) => {
    set({ financeFilter: filter });
    get().loadFinances();
  },

  setFinancePeriod: (days) => {
    set({ financePeriod: days });
    get().loadFinances();
  },

  createFinance: async (payload) => {
    try {
      const { createFinanceEntry } = await import('./api/ceo');
      await createFinanceEntry(payload);
      await get().loadFinances();
      get().loadDashboard();
    } catch (err) {
      console.error('Failed to create finance entry:', err);
      throw err;
    }
  },

  updateFinance: async (id, payload) => {
    try {
      const { updateFinanceEntry } = await import('./api/ceo');
      await updateFinanceEntry(id, payload);
      await get().loadFinances();
      get().loadDashboard();
    } catch (err) {
      console.error('Failed to update finance entry:', err);
      throw err;
    }
  },

  deleteFinance: async (id) => {
    try {
      const { deleteFinanceEntry } = await import('./api/ceo');
      await deleteFinanceEntry(id);
      set({ financeEntries: get().financeEntries.filter((e) => e.id !== id) });
      get().loadDashboard();
    } catch (err) {
      console.error('Failed to delete finance entry:', err);
      throw err;
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

  // Organization actions
  loadOrgOverview: async () => {
    set({ isLoadingOrg: true });
    try {
      const { fetchOrgDepartments, fetchOrgTasks, fetchOrgGoals, fetchOrgProposals, fetchOrgActions } = await import('./api/ceo');
      const deptFilter = get().orgDeptFilter;
      const taskParams = deptFilter !== 'all' ? { department: deptFilter } : undefined;

      const [deptRes, tasksRes, goalsRes, proposalsRes, actionsRes] = await Promise.all([
        fetchOrgDepartments(),
        fetchOrgTasks(taskParams),
        fetchOrgGoals(),
        fetchOrgProposals('proposed'),
        fetchOrgActions('open'),
      ]);
      set({
        orgDepartments: deptRes.departments,
        orgTasks: tasksRes.tasks,
        orgGoals: goalsRes.goals,
        orgProposals: proposalsRes.proposals,
        orgActions: actionsRes.actions,
      });
    } catch (err) {
      console.error('Failed to load org overview:', err);
    } finally {
      set({ isLoadingOrg: false });
    }
  },

  setOrgDeptFilter: (dept) => set({ orgDeptFilter: dept }),

  approveOrgTask: async (id) => {
    try {
      const { approveOrgTask: apiApprove } = await import('./api/ceo');
      await apiApprove(id);
      await get().loadOrgOverview();
    } catch (err) {
      console.error('Failed to approve task:', err);
    }
  },

  rejectOrgTask: async (id) => {
    try {
      const { rejectOrgTask: apiReject } = await import('./api/ceo');
      await apiReject(id);
      await get().loadOrgOverview();
    } catch (err) {
      console.error('Failed to reject task:', err);
    }
  },

  updateOrgAction: async (id, status) => {
    try {
      const { updateOrgAction: apiUpdate } = await import('./api/ceo');
      await apiUpdate(id, status);
      set({ orgActions: get().orgActions.filter((a) => a.id !== id) });
    } catch (err) {
      console.error('Failed to update action:', err);
    }
  },

  approveOrgProposal: async (id) => {
    try {
      const { approveOrgProposal: apiApprove } = await import('./api/ceo');
      await apiApprove(id);
      set({ orgProposals: get().orgProposals.filter((p) => p.id !== id) });
    } catch (err) {
      console.error('Failed to approve proposal:', err);
    }
  },

  rejectOrgProposal: async (id) => {
    try {
      const { rejectOrgProposal: apiReject } = await import('./api/ceo');
      await apiReject(id);
      set({ orgProposals: get().orgProposals.filter((p) => p.id !== id) });
    } catch (err) {
      console.error('Failed to reject proposal:', err);
    }
  },

  // ============================================================
  // Memos
  // ============================================================

  loadMemos: async (department) => {
    set({ isLoadingMemos: true });
    try {
      const { fetchMemos } = await import('./api/ceo');
      const params = department && department !== 'all' ? { department, limit: 10 } : { limit: 10 };
      const { memos } = await fetchMemos(params);
      set({ orgMemos: memos });
    } catch (err) {
      console.error('Failed to load memos:', err);
    } finally {
      set({ isLoadingMemos: false });
    }
  },

  // ============================================================
  // Background Task Execution
  // ============================================================

  startTask: async (taskId) => {
    try {
      const { startTaskExecution } = await import('./api/ceo');
      await startTaskExecution(taskId);
      // Start polling for results
      get().startTaskPolling();
      // Refresh task list
      await get().loadOrgOverview();
    } catch (err) {
      console.error('Failed to start task:', err);
    }
  },

  pollRunningTasks: async () => {
    try {
      const { fetchRunningTasks } = await import('./api/ceo');
      const { running, recentlyCompleted } = await fetchRunningTasks();
      const prevRunning = get().runningTasks;
      set({ runningTasks: running, recentlyCompletedTasks: recentlyCompleted });

      // If tasks just completed (were running before, now fewer running), refresh org overview
      if (prevRunning.length > running.length) {
        await get().loadOrgOverview();
        await get().loadMemos(get().orgDeptFilter);
      }

      // Auto-stop polling when nothing is running
      if (running.length === 0) {
        get().stopTaskPolling();
      }
    } catch (err) {
      console.error('Failed to poll running tasks:', err);
    }
  },

  startTaskPolling: () => {
    const existing = get().taskPollingInterval;
    if (existing) return; // Already polling
    const interval = setInterval(() => { get().pollRunningTasks(); }, 10000);
    set({ taskPollingInterval: interval });
    // Also poll immediately
    get().pollRunningTasks();
  },

  stopTaskPolling: () => {
    const interval = get().taskPollingInterval;
    if (interval) {
      clearInterval(interval);
      set({ taskPollingInterval: null });
    }
  },

  createOrgTask: async (data) => {
    try {
      const { createOrgTask: apiCreate } = await import('./api/ceo');
      await apiCreate(data);
      await get().loadOrgOverview();
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  },

  // ============================================================
  // CEO Proposals
  // ============================================================

  loadCeoProposals: async () => {
    set({ isLoadingProposals: true });
    try {
      const { fetchCeoProposals } = await import('./api/ceo');
      const { proposals } = await fetchCeoProposals('pending');
      set({ ceoProposals: proposals });
    } catch (err) {
      console.error('Failed to load proposals:', err);
    } finally {
      set({ isLoadingProposals: false });
    }
  },

  loadProposalCount: async () => {
    try {
      const { fetchProposalCount } = await import('./api/ceo');
      const { count } = await fetchProposalCount();
      set({ pendingProposalCount: count });
    } catch (err) {
      console.error('Failed to load proposal count:', err);
    }
  },

  approveCeoProposal: async (id) => {
    try {
      const { approveCeoProposal: apiApprove } = await import('./api/ceo');
      await apiApprove(id);
      set({
        ceoProposals: get().ceoProposals.filter((p) => p.id !== id),
        pendingProposalCount: Math.max(0, get().pendingProposalCount - 1),
      });
    } catch (err) {
      console.error('Failed to approve proposal:', err);
    }
  },

  rejectCeoProposal: async (id) => {
    try {
      const { rejectCeoProposal: apiReject } = await import('./api/ceo');
      await apiReject(id);
      set({
        ceoProposals: get().ceoProposals.filter((p) => p.id !== id),
        pendingProposalCount: Math.max(0, get().pendingProposalCount - 1),
      });
    } catch (err) {
      console.error('Failed to reject proposal:', err);
    }
  },

  batchDecideProposals: async (action) => {
    try {
      const { batchDecideProposals: apiBatch } = await import('./api/ceo');
      const decisions = get().ceoProposals.map((p) => ({ id: p.id, action }));
      await apiBatch(decisions);
      set({ ceoProposals: [], pendingProposalCount: 0 });
    } catch (err) {
      console.error('Failed to batch decide proposals:', err);
    }
  },

  // ============================================================
  // Staff Chat
  // ============================================================

  setStaffActiveTab: (tab) => set({ staffActiveTab: tab }),

  loadStaffSession: async (dept) => {
    try {
      const { fetchStaffSession, fetchStaffMessages } = await import('./api/ceo');
      const { session } = await fetchStaffSession(dept);
      set((state) => ({
        staffSessions: { ...state.staffSessions, [dept]: session },
      }));
      // Load messages
      const { messages } = await fetchStaffMessages(session.id);
      set((state) => ({
        staffMessages: { ...state.staffMessages, [session.id]: messages },
      }));
    } catch (err) {
      console.error('Failed to load staff session:', err);
    }
  },

  sendStaffMessage: async (sessionId, message) => {
    set({ isStaffSending: true });
    try {
      // Optimistic: add user message
      const userMsg: StaffMessage = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user',
        departmentSlug: null,
        content: message,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        staffMessages: {
          ...state.staffMessages,
          [sessionId]: [...(state.staffMessages[sessionId] || []), userMsg],
        },
      }));

      const { sendStaffMessage: apiSend } = await import('./api/ceo');
      const { message: assistantMsg } = await apiSend(sessionId, message);

      // Replace temp user msg and add assistant response
      set((state) => {
        const msgs = (state.staffMessages[sessionId] || []).filter((m) => m.id !== userMsg.id);
        // Reload from server to get the real user message + response
        return {
          staffMessages: {
            ...state.staffMessages,
            [sessionId]: [...msgs, { ...userMsg, id: `u-${Date.now()}` }, assistantMsg],
          },
        };
      });
    } catch (err) {
      console.error('Failed to send staff message:', err);
    } finally {
      set({ isStaffSending: false });
    }
  },

  sendMeetingMessage: async (sessionId, message) => {
    set({ isStaffSending: true });
    try {
      // Optimistic: add user message
      const userMsg: StaffMessage = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user',
        departmentSlug: null,
        content: message,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        staffMessages: {
          ...state.staffMessages,
          [sessionId]: [...(state.staffMessages[sessionId] || []), userMsg],
        },
      }));

      const { sendMeetingMessage: apiSend } = await import('./api/ceo');
      const { messages: newMsgs } = await apiSend(sessionId, message);

      // Add all returned messages
      set((state) => {
        const msgs = (state.staffMessages[sessionId] || []).filter((m) => m.id !== userMsg.id);
        return {
          staffMessages: {
            ...state.staffMessages,
            [sessionId]: [...msgs, { ...userMsg, id: `u-${Date.now()}` }, ...newMsgs],
          },
        };
      });
    } catch (err) {
      console.error('Failed to send meeting message:', err);
    } finally {
      set({ isStaffSending: false });
    }
  },

  clearStaffSession: async (sessionId) => {
    try {
      const { clearStaffChat } = await import('./api/ceo');
      await clearStaffChat(sessionId);
      set((state) => ({
        staffMessages: { ...state.staffMessages, [sessionId]: [] },
      }));
    } catch (err) {
      console.error('Failed to clear staff session:', err);
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
