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

// CEO Dashboard types
export interface CeoDashboard {
  config: {
    mode: string;
    timezone: string;
    autopostEnabled: boolean;
  };
  financial: {
    periodDays: number;
    expenseTotalUsd: number;
    incomeTotalUsd: number;
    burnNetUsd: number;
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
    revenuePotentialUsd: number;
    estimatedHours: number;
    lastBuildAt: string | null;
  }>;
  channelPerformance: Array<{
    channel: string;
    runs: number;
    leads: number;
    costUsd: number;
    costPerLeadUsd: number | null;
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
  signalType: 'opportunity' | 'threat' | 'pricing' | 'policy' | 'trend';
  title: string;
  summary: string | null;
  sourceUrl: string | null;
  confidence: number;
  actionable: boolean;
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
