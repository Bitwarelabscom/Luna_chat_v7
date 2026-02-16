import { api } from './core';

// Autonomous Learning API
export interface TrustScore {
  id: number;
  domain: string;
  trustScore: number;
  category: string;
  lastUpdated: string;
  updateReason: string;
}

export interface KnowledgeGap {
  id: number;
  gapDescription: string;
  priority: number;
  suggestedQueries: string[];
  category: string;
  identifiedAt: string;
  status: 'pending' | 'researching' | 'verified' | 'embedded' | 'rejected' | 'failed';
  researchSessionId?: number;
  failureReason?: string;
  completedAt?: string;
  manualApprovalRequired?: boolean;
  description?: string; // Alias for gapDescription
}

export interface ResearchSession {
  id: number;
  knowledgeGapId: number;
  userId: string;
  topic: string;
  searchQueries: string[];
  sourcesFound: number;
  trustedSourcesCount: number;
  findings?: {
    sources: Array<{
      url: string;
      title: string;
      trustScore: number | null;
      summary?: string;
      keyFacts?: string[];
    }>;
    keyFacts: string[];
    summary: string;
    confidence: number;
  };
  verificationResult?: {
    passed: boolean;
    confidence: number;
    reasoning: string;
    internalConsistency: boolean;
    plausibility: boolean;
    sourceAgreement: boolean;
  };
  friendDiscussionId?: number;
  createdAt: string;
  completedAt?: string;
}

export interface LearningLogEntry {
  id: number;
  userId: string;
  actionType: string;
  details: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
  timestamp: string;
}

export interface LearningStats {
  gapsByStatus: Record<string, number>;
  totalResearchSessions: number;
  knowledgeEmbedded: number;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
}

export const autonomousLearningApi = {
  // Trust Scores
  getTrustScores: (category?: string) => {
    const params = category ? `?category=${encodeURIComponent(category)}` : '';
    return api<{ scores: TrustScore[] }>(`/api/autonomous/learning/trust-scores${params}`);
  },

  updateTrustScore: (domain: string, trustScore: number, updateReason: string, category?: string) =>
    api<{ success: boolean }>(`/api/autonomous/learning/trust-scores/${encodeURIComponent(domain)}`, {
      method: 'PUT',
      body: { trustScore, updateReason, category },
    }),

  // Knowledge Gaps
  getKnowledgeGaps: (status?: string, limit = 20) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (status) params.set('status', status);
    return api<{ gaps: KnowledgeGap[] }>(`/api/autonomous/learning/gaps?${params}`);
  },

  approveKnowledgeGap: (gapId: number) =>
    api<{ success: boolean; gap: { id: number; status: string; manuallyApproved: boolean } }>(
      `/api/autonomous/learning/gaps/${gapId}/approve`,
      { method: 'POST' }
    ),

  // Research Sessions
  getResearchSessions: (limit = 20) =>
    api<{ sessions: ResearchSession[] }>(`/api/autonomous/learning/research-sessions?limit=${limit}`),

  getResearchSession: (id: number) =>
    api<{ session: ResearchSession }>(`/api/autonomous/learning/research-sessions/${id}`),

  // Learning Log
  getLearningLog: (actionType?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (actionType) params.set('actionType', actionType);
    return api<{ logs: LearningLogEntry[] }>(`/api/autonomous/learning/log?${params}`);
  },

  // Statistics
  getStats: () =>
    api<{ stats: LearningStats }>('/api/autonomous/learning/stats'),
};
