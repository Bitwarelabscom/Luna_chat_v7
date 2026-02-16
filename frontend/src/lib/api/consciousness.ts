import { api } from './core';

// Consciousness API (NeuralSleep Integration)
export interface ConsciousnessMetrics {
  phi: number;
  selfReferenceDepth: number;
  temporalIntegration: number;
  causalDensity: number;
  dynamicalComplexity?: number;
  consciousnessLevel?: string;
  isConscious?: boolean;
}

export interface ConsciousnessHistory {
  phi: number;
  selfReferenceDepth: number;
  temporalIntegration: number;
  causalDensity: number;
  dynamicalComplexity?: number;
  consciousnessLevel?: string;
  timestamp: string;
}

export interface ConsolidationEvent {
  id: string;
  userId: string;
  consolidationType: 'immediate' | 'daily' | 'weekly';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  episodicEventsProcessed?: number;
  patternsExtracted?: number;
  error?: string;
}

export const consciousnessApi = {
  // Get current consciousness metrics
  getMetrics: () =>
    api<{ metrics: ConsciousnessMetrics | null }>('/api/consciousness/metrics'),

  // Get consciousness history
  getHistory: (limit = 100, since?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (since) params.set('since', since);
    return api<{ history: ConsciousnessHistory[] }>(`/api/consciousness/history?${params}`);
  },

  // Trigger consciousness analysis
  analyze: () =>
    api<{ metrics: ConsciousnessMetrics }>('/api/consciousness/analyze', { method: 'POST' }),

  // Get consolidation logs
  getConsolidationLogs: (limit = 20) =>
    api<{ logs: ConsolidationEvent[] }>(`/api/consolidation/logs?limit=${limit}`),

  // Get MemoryCore health
  getHealth: () =>
    api<{ healthy: boolean; neuralsleep: boolean; message?: string }>('/api/consciousness/health'),
};
