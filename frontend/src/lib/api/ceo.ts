import { api } from './core';

// Active Build types
export interface ActiveBuild {
  id: string;
  userId: string;
  buildNum: number;
  taskName: string;
  status: 'active' | 'paused' | 'done';
  startedAt: string;
  sessionStartedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  elapsedSeconds: number;
  lastCheckinAt: string;
}

export interface BuildNote {
  id: string;
  buildId: string;
  userId: string;
  note: string;
  source: string;
  createdAt: string;
}

export interface BuildHistoryItem extends ActiveBuild {
  currentElapsedSeconds: number;
  notes: BuildNote[];
}

export interface BuildActionResult {
  success: boolean;
  systemLog: string;
  data: ActiveBuild;
}

// Build tracker API
export const startBuild = (taskName: string) =>
  api<BuildActionResult>('/api/ceo/builds/start', { method: 'POST', body: { taskName } });

export const pauseBuild = (buildNum: number) =>
  api<BuildActionResult>(`/api/ceo/builds/${buildNum}/pause`, { method: 'POST' });

export const continueBuild = (buildNum: number) =>
  api<BuildActionResult>(`/api/ceo/builds/${buildNum}/continue`, { method: 'POST' });

export const doneBuild = (buildNum: number) =>
  api<BuildActionResult>(`/api/ceo/builds/${buildNum}/done`, { method: 'POST' });

export const listBuilds = () =>
  api<{ builds: ActiveBuild[] }>('/api/ceo/builds');

export const fetchBuildHistory = (limit = 60) =>
  api<{ builds: BuildHistoryItem[] }>(`/api/ceo/builds/history?limit=${limit}`);

export const addBuildNote = (buildNum: number, note: string) =>
  api<{ success: boolean }>(`/api/ceo/builds/${buildNum}/note`, { method: 'POST', body: { note } });

// Slash command economy API
export const slashCost = (amount: number, categoryOrKeyword: string, note: string) =>
  api<{ success: boolean; systemLog: string; data: { id: string; category: string; amount: number } }>('/api/ceo/slash/cost', {
    method: 'POST',
    body: { amount, categoryOrKeyword, note },
  });

export const slashIncome = (amount: number, source: string, note: string) =>
  api<{ success: boolean; systemLog: string; data: { id: string; source: string; amount: number } }>('/api/ceo/slash/income', {
    method: 'POST',
    body: { amount, source, note },
  });

export const slashPay = (amount: number, keyword: string, note: string) =>
  api<{ success: boolean; systemLog: string; data: { id: string; keyword: string; amount: number } }>('/api/ceo/slash/pay', {
    method: 'POST',
    body: { amount, keyword, note },
  });

// CEO Dashboard types
export interface CeoDashboard {
  config: {
    mode: string;
    timezone: string;
    autopostEnabled: boolean;
  };
  financial: {
    periodDays: number;
    expenseTotal: number;
    incomeTotal: number;
    ownerPayTotal: number;
    saldo: number;
    projected30dBurnUsd: number;
  };
  activity: {
    buildHours: number;
    experiments: number;
    leads: number;
    lastBuildAt: string | null;
    lastExperimentDate: string | null;
  };
  projectRankings: Array<{
    projectKey: string;
    stage: string;
    opportunityScore: number;
    riskScore: number;
    revenuePotential: number;
    estimatedHours: number;
    lastBuildAt: string | null;
  }>;
  channelPerformance: Array<{
    channel: string;
    runs: number;
    leads: number;
    cost: number;
    costPerLead: number | null;
    score: number;
  }>;
  alerts: Array<{
    id: string;
    severity: 'P1' | 'P2' | 'P3';
    title: string;
    status: string;
    createdAt: string;
  }>;
  autopostQueue: Array<{
    id: string;
    channel: string;
    status: string;
    scheduledAt: string | null;
    createdAt: string;
  }>;
}

export interface RadarSignal {
  id: string;
  signalType: 'opportunity' | 'threat' | 'pricing' | 'policy' | 'trend' | 'music_trend';
  title: string;
  summary: string | null;
  sourceUrl: string | null;
  confidence: number;
  actionable: boolean;
  createdAt: string;
}

export interface ProposedGenre {
  id: string;
  genreId: string;
  name: string;
  category: string;
  presetData: Record<string, unknown>;
  confidence: number;
  status: string;
  createdAt: string;
}

export interface AutopostItem {
  id: string;
  channel: string;
  status: string;
  title: string | null;
  content: string;
  scheduledAt: string | null;
  postedAt: string | null;
  createdAt: string;
}

// Dashboard
export const fetchDashboard = (days = 30) =>
  api<{ dashboard: CeoDashboard }>(`/api/ceo/dashboard?days=${days}`);

// Radar signals
export const fetchRadarSignals = (limit = 20) =>
  api<{ signals: RadarSignal[] }>(`/api/ceo/radar/signals?limit=${limit}`);

// Autopost queue
export const fetchAutopostQueue = (limit = 20) =>
  api<{ posts: AutopostItem[] }>(`/api/ceo/autopost/queue?limit=${limit}`);

export const approvePost = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/autopost/${id}/approve`, { method: 'POST' });

export const cancelPost = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/autopost/${id}/cancel`, { method: 'POST' });

// Log endpoints
export interface ExpensePayload {
  vendor: string;
  amountUsd: number;
  date?: string;
  category?: string;
  cadence?: string;
  notes?: string;
}

export interface IncomePayload {
  vendor: string;
  amountUsd: number;
  date?: string;
  category?: string;
  notes?: string;
}

export interface BuildPayload {
  projectKey: string;
  hours: number;
  item?: string;
  stage?: string;
  impact?: string;
  occurredAt?: string;
}

export interface ExperimentPayload {
  channel: string;
  name: string;
  date?: string;
  costUsd?: number;
  leads?: number;
  outcome?: string;
  status?: string;
  notes?: string;
}

export interface LeadPayload {
  source: string;
  date?: string;
  status?: string;
  valueEstimateUsd?: number;
  notes?: string;
}

export interface ProjectPayload {
  projectKey: string;
  stage?: string;
  revenuePotentialUsd?: number;
  estimatedHours?: number;
  strategicLeverage?: number;
  winProbability?: number;
  dependencyRisk?: number;
  confidenceScore?: number;
  notes?: string;
}

export const logExpense = (payload: ExpensePayload) =>
  api<{ id: string }>('/api/ceo/log/expense', { method: 'POST', body: payload });

export const logIncome = (payload: IncomePayload) =>
  api<{ id: string }>('/api/ceo/log/income', { method: 'POST', body: payload });

export const logBuild = (payload: BuildPayload) =>
  api<{ id: string }>('/api/ceo/log/build', { method: 'POST', body: payload });

export const logExperiment = (payload: ExperimentPayload) =>
  api<{ id: string }>('/api/ceo/log/experiment', { method: 'POST', body: payload });

export const logLead = (payload: LeadPayload) =>
  api<{ id: string }>('/api/ceo/log/lead', { method: 'POST', body: payload });

export const logProject = (payload: ProjectPayload) =>
  api<{ id: string }>('/api/ceo/log/project', { method: 'POST', body: payload });

// ============================================================
// Album Production Pipeline
// ============================================================

export interface GenreOption {
  id: string;
  name: string;
  description: string;
  defaultSongCount: number;
  category?: string;
  styleTags?: string;
  bpmRange?: { min: number; max: number };
  energy?: string;
  source?: 'builtin' | 'custom' | 'proposed';
}

export interface ProductionSummary {
  id: string;
  artistName: string;
  genre: string;
  albumCount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  totalSongs: number;
  completedSongs: number;
  failedSongs: number;
}

export interface SongDetail {
  id: string;
  trackNumber: number;
  title: string;
  direction: string | null;
  style: string | null;
  genrePreset: string | null;
  workspacePath: string | null;
  status: string;
  revisionCount: number;
  analysisIssues: string[] | null;
  errorMessage: string | null;
  completedAt: string | null;
}

export interface AlbumDetail {
  id: string;
  albumNumber: number;
  albumTitle: string | null;
  albumTheme: string | null;
  coverArtPath: string | null;
  songCount: number;
  status: string;
  songs: SongDetail[];
}

export interface ProductionDetail extends ProductionSummary {
  productionNotes: string | null;
  planningModel: string | null;
  lyricsModel: string | null;
  forbiddenWords: string | null;
  songsPerAlbum: number | null;
  albums: AlbumDetail[];
}

export interface CreateProductionParams {
  artistName: string;
  genre: string;
  productionNotes?: string;
  albumCount?: number;
  planningModel?: string;
  lyricsModel?: string;
  forbiddenWords?: string;
  songsPerAlbum?: number;
}

// Album productions
export const fetchGenres = () =>
  api<{ genres: GenreOption[] }>('/api/ceo/albums/genres');

export const createProduction = (params: CreateProductionParams) =>
  api<{ id: string; status: string }>('/api/ceo/albums', { method: 'POST', body: params });

export const fetchProductions = () =>
  api<{ productions: ProductionSummary[] }>('/api/ceo/albums');

export const fetchProductionDetail = (id: string) =>
  api<{ production: ProductionDetail }>(`/api/ceo/albums/${id}`);

export const fetchProductionProgress = (id: string) =>
  api<{ progress: Record<string, number> }>(`/api/ceo/albums/${id}/progress`);

export const approveProduction = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/albums/${id}/approve`, { method: 'POST' });

export const cancelProduction = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/albums/${id}/cancel`, { method: 'POST' });

// Artist management
export const fetchArtists = () =>
  api<{ artists: string[] }>('/api/ceo/artists');

export const fetchArtist = (name: string) =>
  api<{ name: string; content: string }>(`/api/ceo/artists/${encodeURIComponent(name)}`);

export const saveArtist = (name: string, content: string) =>
  api<{ success: boolean }>(`/api/ceo/artists/${encodeURIComponent(name)}`, { method: 'PUT', body: { content } });

// ============================================================
// Music Trends & Genre Proposals
// ============================================================

export const fetchMusicTrendSignals = (limit = 20) =>
  api<{ signals: RadarSignal[] }>(`/api/ceo/radar/music-trends?limit=${limit}`);

export const fetchProposedGenres = (status = 'pending') =>
  api<{ proposals: ProposedGenre[] }>(`/api/ceo/genres/proposed?status=${status}`);

export const approveGenre = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/genres/proposed/${id}/approve`, { method: 'POST' });

export const rejectGenre = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/genres/proposed/${id}/reject`, { method: 'POST' });

export const editGenre = (id: string, presetData: Record<string, unknown>) =>
  api<{ success: boolean }>(`/api/ceo/genres/proposed/${id}`, { method: 'PUT', body: { presetData } });

export const triggerMusicScrape = () =>
  api<{ success: boolean; items: number; genres: number; signals: number }>('/api/ceo/radar/scrape-now', { method: 'POST' });

// ============================================================
// Organization System
// ============================================================

export type DepartmentSlug = 'economy' | 'marketing' | 'development' | 'research';

export interface OrgTask {
  id: string;
  userId: string;
  departmentSlug: DepartmentSlug;
  title: string;
  description: string | null;
  riskLevel: 'low' | 'high';
  status: 'pending' | 'in_progress' | 'done' | 'approved' | 'rejected';
  priority: number;
  source: string;
  assignedBy: string | null;
  resultSummary: string | null;
  resultFilePath: string | null;
  weekLabel: string | null;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WeeklyGoal {
  id: string;
  weekLabel: string;
  departmentSlug: DepartmentSlug;
  goalText: string;
  status: 'active' | 'completed' | 'dropped';
  progressPct: number;
}

export interface AbilityProposal {
  id: string;
  departmentSlug: DepartmentSlug;
  title: string;
  description: string | null;
  rationale: string | null;
  estimatedEffort: string | null;
  status: 'proposed' | 'approved' | 'rejected' | 'implemented';
  createdAt: string;
}

export interface RecommendedAction {
  id: string;
  departmentSlug: DepartmentSlug;
  title: string;
  description: string | null;
  priority: number;
  category: string | null;
  status: 'open' | 'dismissed' | 'done';
  createdAt: string;
}

export interface DepartmentSummary {
  slug: DepartmentSlug;
  name: string;
  persona: string;
  focus: string[];
  pendingTasks: number;
  doneTasks: number;
  highRiskPending: number;
}

export const fetchOrgDepartments = () =>
  api<{ departments: DepartmentSummary[] }>('/api/ceo/org/departments');

export const fetchOrgTasks = (params?: { department?: string; status?: string; week?: string }) => {
  const qs = new URLSearchParams();
  if (params?.department) qs.set('department', params.department);
  if (params?.status) qs.set('status', params.status);
  if (params?.week) qs.set('week', params.week);
  const q = qs.toString();
  return api<{ tasks: OrgTask[] }>(`/api/ceo/org/tasks${q ? `?${q}` : ''}`);
};

export const createOrgTask = (data: { departmentSlug: DepartmentSlug; title: string; description?: string; riskLevel?: 'low' | 'high'; priority?: number }) =>
  api<{ task: OrgTask }>('/api/ceo/org/tasks', { method: 'POST', body: data });

export const updateOrgTask = (id: string, data: { status?: string; priority?: number }) =>
  api<{ task: OrgTask }>(`/api/ceo/org/tasks/${id}`, { method: 'PATCH', body: data });

export const approveOrgTask = (id: string) =>
  api<{ task: OrgTask }>(`/api/ceo/org/tasks/${id}/approve`, { method: 'POST' });

export const rejectOrgTask = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/org/tasks/${id}/reject`, { method: 'POST' });

export const fetchOrgGoals = (week?: string) => {
  const q = week ? `?week=${week}` : '';
  return api<{ goals: WeeklyGoal[] }>(`/api/ceo/org/goals${q}`);
};

export const updateOrgGoal = (id: string, data: { status?: string; progressPct?: number }) =>
  api<{ goal: WeeklyGoal }>(`/api/ceo/org/goals/${id}`, { method: 'PATCH', body: data });

export const fetchOrgProposals = (status?: string) => {
  const q = status ? `?status=${status}` : '';
  return api<{ proposals: AbilityProposal[] }>(`/api/ceo/org/proposals${q}`);
};

export const approveOrgProposal = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/org/proposals/${id}/approve`, { method: 'POST' });

export const rejectOrgProposal = (id: string) =>
  api<{ success: boolean }>(`/api/ceo/org/proposals/${id}/reject`, { method: 'POST' });

export const fetchOrgActions = (status?: string) => {
  const q = status ? `?status=${status}` : '';
  return api<{ actions: RecommendedAction[] }>(`/api/ceo/org/actions${q}`);
};

export const updateOrgAction = (id: string, status: 'dismissed' | 'done') =>
  api<{ success: boolean }>(`/api/ceo/org/actions/${id}`, { method: 'PATCH', body: { status } });

export const triggerWeeklyPlan = () =>
  api<{ success: boolean; goalsCreated: number; tasksCreated: number; actionsCreated: number }>('/api/ceo/org/run/weekly-plan', { method: 'POST' });

export const triggerDailyCheck = () =>
  api<{ success: boolean; executed: number; skipped: number }>('/api/ceo/org/run/daily-check', { method: 'POST' });
