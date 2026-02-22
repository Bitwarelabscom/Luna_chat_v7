import { api } from './core';

// Autonomous Mode API
export interface AutonomousConfig {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  sessionIntervalMinutes: number;
  maxDailySessions: number;
  rssCheckIntervalMinutes: number;
  idleTimeoutMinutes: number;
  learningEnabled: boolean;
  rssEnabled: boolean;
  insightsEnabled: boolean;
  voiceEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousSession {
  id: string;
  userId: string;
  status: 'active' | 'completed' | 'paused' | 'failed';
  currentPhase: 'polaris' | 'aurora' | 'vega' | 'sol' | 'act' | null;
  startedAt: string;
  endedAt: string | null;
  sessionType: string;
  summary: string | null;
  insightsGenerated: string[];
  loopCount: number;
  createdAt: string;
}

export interface AutonomousStatus {
  status: 'active' | 'inactive';
  currentSession: AutonomousSession | null;
  config: AutonomousConfig | null;
  todaySessionCount: number;
}

export interface CouncilMember {
  id: string;
  name: string;
  displayName: string;
  role: string;
  personality: string;
  functionDescription: string;
  avatarEmoji: string;
  color: string;
  loopOrder: number;
}

export interface CouncilDeliberation {
  id: string;
  autonomousSessionId: string;
  userId: string;
  topic: string;
  loopNumber: number;
  conversationData: Array<{
    speaker: string;
    message: string;
    timestamp: string;
    phase: string;
  }>;
  participants: string[];
  summary: string | null;
  decision: string | null;
  actionTaken: string | null;
  insights: string[];
  createdAt: string;
}

export interface Goal {
  id: string;
  userId: string;
  goalType: 'user_focused' | 'self_improvement' | 'relationship' | 'research';
  title: string;
  description: string | null;
  targetMetric: { type: string; target: number; current: number } | null;
  status: 'active' | 'completed' | 'paused' | 'abandoned';
  priority: number;
  dueDate: string | null;
  parentGoalId: string | null;
  createdBy: 'luna' | 'user';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Achievement {
  id: string;
  userId: string;
  goalId: string | null;
  title: string;
  description: string | null;
  achievementType: 'goal_completed' | 'milestone' | 'discovery' | 'improvement' | 'insight';
  journalEntry: string | null;
  metadata: Record<string, unknown> | null;
  celebrated: boolean;
  createdAt: string;
}

export interface NewsArticle {
  id: number;
  title: string;
  url: string | null;
  publishedAt: string | null;
  sourceName: string;
  verificationStatus: 'Verified' | 'Likely' | 'Unconfirmed' | 'Conflicted' | 'False/Retraction';
  confidenceScore: number;
  signal: 'low' | 'medium' | 'high' | null;
  signalReason: string | null;
  topics: string[] | null;
  signalConfidence: number | null;
}

export interface NewsClaim {
  id: number;
  claimText: string;
  verificationStatus: string;
  confidenceScore: number;
  scoreBreakdown: {
    independencePoints: number;
    primaryPoints: number;
    recencyPoints: number;
    consistencyPoints: number;
    trustPoints: number;
    independentSources: number;
    primaryEvidenceCount: number;
  };
  articleTitle: string;
  articleUrl: string | null;
  publishedAt: string | null;
}

export interface ProactiveInsight {
  id: string;
  userId: string;
  sourceType: 'council_deliberation' | 'rss_article' | 'goal_progress' | 'pattern_discovery' | 'achievement';
  sourceId: string | null;
  insightTitle: string;
  insightContent: string;
  priority: number;
  expiresAt: string | null;
  sharedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

// Question type for Luna asking user
export interface AutonomousQuestion {
  id: string;
  sessionId: string;
  userId: string;
  question: string;
  context: string | null;
  priority: number;
  status: 'pending' | 'answered' | 'dismissed' | 'expired';
  askedAt: string;
  answeredAt: string | null;
  userResponse: string | null;
  expiresAt: string | null;
  relatedGoalId: string | null;
  createdAt: string;
}

export interface FriendTopicCandidate {
  id: string;
  userId: string;
  topicText: string;
  context: string | null;
  evidence: string[];
  evidenceCount: number;
  modelConfidence: number;
  relevanceScore: number;
  thresholdScore: number;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  createdAt: string;
}

// Session note type
export interface SessionNote {
  id: string;
  sessionId: string;
  userId: string;
  noteType: 'planning' | 'observation' | 'finding' | 'decision' | 'question' | 'summary';
  title: string | null;
  content: string;
  phase: string | null;
  relatedGoalId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Research collection type
export interface ResearchCollection {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  goalId: string | null;
  sessionId: string | null;
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// Research item type
export interface ResearchItem {
  id: string;
  collectionId: string;
  userId: string;
  sourceType: 'web_page' | 'search_result' | 'rss_article' | 'document' | 'user_input';
  sourceUrl: string | null;
  title: string | null;
  content: string | null;
  summary: string | null;
  keyFindings: string[];
  relevanceScore: number;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Fetched page type
export interface FetchedPage {
  id: string;
  url: string;
  title: string | null;
  content: string;
  author: string | null;
  publishedDate: string | null;
  wordCount: number;
  fetchedAt: string;
  fromCache: boolean;
  metadata: Record<string, unknown> | null;
}

export const autonomousApi = {
  // Status & Control
  getStatus: () =>
    api<AutonomousStatus>('/api/autonomous/status'),

  start: (data?: { taskDescription?: string }) =>
    api<{ success: boolean; session: AutonomousSession }>('/api/autonomous/start', { method: 'POST', body: data || {} }),

  stop: () =>
    api<{ success: boolean; session: AutonomousSession | null }>('/api/autonomous/stop', { method: 'POST' }),

  // Configuration
  getConfig: () =>
    api<{ config: AutonomousConfig }>('/api/autonomous/config'),

  updateConfig: (config: Partial<Omit<AutonomousConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>) =>
    api<{ config: AutonomousConfig }>('/api/autonomous/config', { method: 'PUT', body: config }),

  // Sessions
  getSessions: (limit = 20, offset = 0) =>
    api<{ sessions: AutonomousSession[] }>(`/api/autonomous/sessions?limit=${limit}&offset=${offset}`),

  getSession: (id: string) =>
    api<AutonomousSession>(`/api/autonomous/sessions/${id}`),

  // Council
  getCouncilMembers: () =>
    api<{ members: CouncilMember[] }>('/api/autonomous/council'),

  // Deliberations
  getDeliberations: (limit = 10, offset = 0) =>
    api<{ deliberations: CouncilDeliberation[] }>(`/api/autonomous/deliberations?limit=${limit}&offset=${offset}`),

  getDeliberation: (id: string) =>
    api<CouncilDeliberation>(`/api/autonomous/deliberations/${id}`),

  getSessionDeliberations: (sessionId: string) =>
    api<{ deliberations: CouncilDeliberation[] }>(`/api/autonomous/sessions/${sessionId}/deliberations`),

  // Goals
  getGoals: (filters?: { status?: string; type?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.type) params.set('type', filters.type);
    const query = params.toString();
    return api<{ goals: Goal[] }>(`/api/autonomous/goals${query ? `?${query}` : ''}`);
  },

  createGoal: (data: Pick<Goal, 'goalType' | 'title'> & Partial<Pick<Goal, 'description' | 'targetMetric' | 'priority' | 'dueDate' | 'parentGoalId'>> & { createdBy?: 'user' | 'luna' }) =>
    api<{ goal: Goal }>('/api/autonomous/goals', { method: 'POST', body: data }),

  updateGoal: (id: string, data: Partial<Pick<Goal, 'title' | 'description' | 'targetMetric' | 'status' | 'priority' | 'dueDate'>>) =>
    api<{ goal: Goal }>(`/api/autonomous/goals/${id}`, { method: 'PUT', body: data }),

  deleteGoal: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/goals/${id}`, { method: 'DELETE' }),

  getGoalStats: () =>
    api<{ stats: { total: number; active: number; completed: number; paused: number; byType: Record<string, number> } }>('/api/autonomous/goals/stats'),

  // Achievements
  getAchievements: (limit = 50, offset = 0) =>
    api<{ achievements: Achievement[] }>(`/api/autonomous/achievements?limit=${limit}&offset=${offset}`),

  celebrateAchievement: (id: string) =>
    api<{ achievement: Achievement }>(`/api/autonomous/achievements/${id}/celebrate`, { method: 'POST' }),

  // News (Newsfetcher)
  getNewsArticles: (options?: { q?: string; status?: string; minScore?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.q) params.set('q', options.q);
    if (options?.status) params.set('status', options.status);
    if (options?.minScore) params.set('min_score', options.minScore.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<{ articles: NewsArticle[] }>(`/api/autonomous/news/articles${query ? `?${query}` : ''}`);
  },

  getNewsClaims: (options?: { status?: string; minScore?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.minScore) params.set('min_score', options.minScore.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<{ claims: NewsClaim[] }>(`/api/autonomous/news/claims${query ? `?${query}` : ''}`);
  },

  enrichArticle: (id: number) =>
    api<{ article: NewsArticle }>(`/api/autonomous/news/enrich/${id}`, { method: 'POST' }),

  batchEnrich: (limit?: number) => {
    const params = limit ? `?limit=${limit}` : '';
    return api<{ enrichedCount: number }>(`/api/autonomous/news/enrich${params}`, { method: 'POST' });
  },

  triggerIngestion: () =>
    api<{ success: boolean; ingested: number }>('/api/autonomous/news/ingest', { method: 'POST' }),

  getNewsHealth: () =>
    api<{ healthy: boolean; status?: string }>('/api/autonomous/news/health'),

  // Insights
  getInsights: (options?: { unshared?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.unshared) params.set('unshared', 'true');
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<{ insights: ProactiveInsight[] }>(`/api/autonomous/insights${query ? `?${query}` : ''}`);
  },

  markInsightShared: (id: string) =>
    api<{ insight: ProactiveInsight }>(`/api/autonomous/insights/${id}/shared`, { method: 'POST' }),

  dismissInsight: (id: string) =>
    api<{ insight: ProactiveInsight }>(`/api/autonomous/insights/${id}/dismiss`, { method: 'POST' }),

  // User Availability
  getAvailability: () =>
    api<{ available: boolean }>('/api/autonomous/availability'),

  setAvailability: (available: boolean) =>
    api<{ available: boolean }>('/api/autonomous/availability', { method: 'PUT', body: { available } }),

  // Questions
  getPendingQuestions: () =>
    api<{ questions: AutonomousQuestion[] }>('/api/autonomous/questions'),

  getQuestion: (questionId: string) =>
    api<{ question: AutonomousQuestion }>(`/api/autonomous/questions/${questionId}`),

  answerQuestion: (questionId: string, response: string) =>
    api<{ question: AutonomousQuestion }>(`/api/autonomous/questions/${questionId}/answer`, { method: 'POST', body: { response } }),

  dismissQuestion: (questionId: string) =>
    api<{ question: AutonomousQuestion }>(`/api/autonomous/questions/${questionId}/dismiss`, { method: 'POST' }),

  // Session Notes
  getSessionNotes: (sessionId: string) =>
    api<{ notes: SessionNote[] }>(`/api/autonomous/sessions/${sessionId}/notes`),

  // Research Collections
  getResearch: () =>
    api<{ collections: ResearchCollection[] }>('/api/autonomous/research'),

  createResearch: (title: string, description?: string, goalId?: string) =>
    api<{ collection: ResearchCollection }>('/api/autonomous/research', { method: 'POST', body: { title, description, goalId } }),

  getResearchItems: (collectionId: string) =>
    api<{ items: ResearchItem[] }>(`/api/autonomous/research/${collectionId}/items`),

  // Friend topic candidates
  getFriendTopics: (limit = 20) =>
    api<{ topics: FriendTopicCandidate[] }>(`/api/autonomous/friends/topics?limit=${limit}`),

  // Web Fetch
  fetchPage: (url: string, summarize = false, prompt?: string) =>
    api<{ page: FetchedPage; summary?: string }>('/api/autonomous/webfetch', { method: 'POST', body: { url, summarize, prompt } }),
};
