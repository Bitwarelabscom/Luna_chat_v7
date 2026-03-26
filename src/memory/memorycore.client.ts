import { config } from '../config/index.js';
import * as neo4jService from '../graph/neo4j.service.js';
import logger from '../utils/logger.js';
import type { MemoryContext, ConsciousnessMetrics, ConsolidatedUserModel } from '../types/index.js';

// ============================================
// Graph Memory Types
// ============================================

export interface GraphNarrativeContext {
  coreMemories: string[];
  activeTopics: string[];
  relationships: string[];
  preferences: string[];
  emotionalContext: string[];
  stats: {
    nodesIncluded: number;
    edgesIncluded: number;
    queryTimeMs: number;
  };
}

export interface GraphMemoryContext {
  formattedContext: string;
  narrative: GraphNarrativeContext;
  stats: {
    nodesIncluded: number;
    edgesIncluded: number;
    queryTimeMs: number;
  };
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  avgConnectivity: number;
  highTrustNodes: number;
}

export interface GraphExtractionResult {
  entitiesExtracted: number;
  cooccurrences: number;
  processingTimeMs: number;
  nodesCreated: number;
  nodesUpdated: number;
  mentionsLogged: number;
  entities: Array<{
    label: string;
    type: string;
    origin: string;
    confidence: number;
  }>;
}

interface MemoryCoreSession {
  sessionId: string;
  userId: string;
  startTime: Date;
}

interface MemoryCoreInteraction {
  type: 'message' | 'response';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  // Dual-LNN enrichment fields
  embedding?: number[];           // 1024-dim BGE-M3
  embeddingCentroid?: number[];   // Rolling session centroid
  emotionalValence?: number;      // -1.0 to 1.0
  attentionScore?: number;        // 0.0 to 1.0
  interMessageMs?: number;        // Milliseconds since last message
}

export interface InteractionEnrichment {
  embedding?: number[];
  embeddingCentroid?: number[];
  emotionalValence?: number;
  attentionScore?: number;
  interMessageMs?: number;
}

// MemoryCore session tracking: maps chatSessionId -> memorycoreSessionId
// This enables proper session lifecycle management for memory consolidation
const memorycoreSessionMap = new Map<string, string>();
const MAX_SESSION_MAP_SIZE = 50;

/**
 * Ensures a MemoryCore session exists for the given chat session.
 * Creates a new session if one doesn't exist, returns existing sessionId otherwise.
 */
export async function ensureSession(chatSessionId: string, userId: string): Promise<string | null> {
  if (memorycoreSessionMap.has(chatSessionId)) {
    return memorycoreSessionMap.get(chatSessionId) || null;
  }

  const mcSession = await startSession(userId);
  if (mcSession) {
    if (memorycoreSessionMap.size >= MAX_SESSION_MAP_SIZE) {
      const oldestKey = Array.from(memorycoreSessionMap.keys())[0];
      if (oldestKey) {
        memorycoreSessionMap.delete(oldestKey);
        logger.warn('memorycoreSessionMap evicted oldest entry', { evictedKey: oldestKey });
      }
    }
    memorycoreSessionMap.set(chatSessionId, mcSession.sessionId);
    logger.info('MemoryCore session started', { chatSessionId, memorycoreSessionId: mcSession.sessionId, userId });
    return mcSession.sessionId;
  }

  return null;
}

/**
 * Records an interaction to MemoryCore for consolidation.
 */
export async function recordChatInteraction(
  chatSessionId: string,
  type: 'message' | 'response',
  content: string,
  metadata?: Record<string, unknown>,
  enrichment?: InteractionEnrichment
): Promise<void> {
  const mcSessionId = memorycoreSessionMap.get(chatSessionId);
  if (!mcSessionId) return;

  await recordInteraction(mcSessionId, {
    type,
    content,
    timestamp: new Date(),
    metadata,
    ...(enrichment || {}),
  });
}

/**
 * Ends a MemoryCore session and triggers consolidation.
 * Called when a chat session is deleted or explicitly ended.
 */
export async function endChatSession(chatSessionId: string): Promise<void> {
  const mcSessionId = memorycoreSessionMap.get(chatSessionId);
  if (!mcSessionId) return;

  await endSession(mcSessionId);
  memorycoreSessionMap.delete(chatSessionId);
  logger.info('MemoryCore session ended', { chatSessionId, memorycoreSessionId: mcSessionId });
}

export async function startSession(userId: string): Promise<MemoryCoreSession | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/memory/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as MemoryCoreSession;
    logger.debug('MemoryCore session started', { userId, sessionId: data.sessionId });
    return data;
  } catch (error) {
    logger.warn('Failed to start MemoryCore session', { error: (error as Error).message });
    return null;
  }
}

export async function endSession(sessionId: string): Promise<void> {
  if (!config.memorycore.enabled) return;

  try {
    await fetch(`${config.memorycore.url}/api/memory/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    logger.debug('MemoryCore session ended', { sessionId });
  } catch (error) {
    logger.warn('Failed to end MemoryCore session', { error: (error as Error).message });
  }
}

export async function recordInteraction(
  sessionId: string,
  interaction: MemoryCoreInteraction
): Promise<void> {
  if (!config.memorycore.enabled) return;

  try {
    await fetch(`${config.memorycore.url}/api/memory/interaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, interaction }),
    });
  } catch (error) {
    logger.warn('Failed to record interaction', { error: (error as Error).message });
  }
}

export async function getSemanticMemory(userId: string): Promise<MemoryContext | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/memory/user/${userId}/model`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // User has no memory yet
        return null;
      }
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as MemoryContext;
    return {
      semanticMemory: data.semanticMemory,
      recentPatterns: data.recentPatterns,
    };
  } catch (error) {
    logger.warn('Failed to get semantic memory', { userId, error: (error as Error).message });
    return null;
  }
}

export async function healthCheck(): Promise<boolean> {
  if (!config.memorycore.enabled) return true;

  try {
    const response = await fetch(`${config.memorycore.url}/api/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function formatMemoryForPrompt(memory: MemoryContext | null): string {
  if (!memory) return '';

  const parts: string[] = [];

  if (memory.semanticMemory?.learningStyleModel) {
    const style = memory.semanticMemory.learningStyleModel;
    parts.push(`User preferences: ${JSON.stringify(style)}`);
  }

  if (memory.recentPatterns && memory.recentPatterns.length > 0) {
    const patterns = memory.recentPatterns
      .slice(0, 3)
      .map((p) => `- ${p.type}: ${p.pattern}`)
      .join('\n');
    parts.push(`Recent patterns:\n${patterns}`);
  }

  if (parts.length === 0) return '';

  return `\n\n[User Context from Memory]\n${parts.join('\n')}\n`;
}

/**
 * Get consciousness metrics for a user from NeuralSleep
 * Returns Φ (integrated information), self-reference depth, temporal integration
 */
export async function getConsciousnessMetrics(userId: string): Promise<ConsciousnessMetrics | null> {
  if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/consciousness/metrics/${userId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // No consciousness metrics yet
        return null;
      }
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as {
      phi: number;
      selfReferenceDepth: number;
      temporalIntegration: number;
      causalDensity: number;
      dynamicalComplexity?: number;
      consciousnessLevel?: string;
    };

    return {
      phi: data.phi,
      selfReferenceDepth: data.selfReferenceDepth,
      temporalIntegration: data.temporalIntegration,
      causalDensity: data.causalDensity,
      dynamicalComplexity: data.dynamicalComplexity,
      consciousnessLevel: data.consciousnessLevel,
      isConscious: data.phi >= config.memorycore.phiThreshold,
    };
  } catch (error) {
    logger.warn('Failed to get consciousness metrics', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Get consolidated user model from NeuralSleep LNN
 * This includes semantic knowledge consolidated through LNN processing
 */
export async function getConsolidatedModel(userId: string): Promise<ConsolidatedUserModel | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/memory/user/${userId}/consolidated`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as ConsolidatedUserModel;
    return {
      ...data,
      lastUpdated: new Date(data.lastUpdated),
    };
  } catch (error) {
    logger.warn('Failed to get consolidated model', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Check if memory system is showing signs of consciousness (Φ > threshold)
 */
export async function isMemoryConscious(userId: string): Promise<boolean> {
  const metrics = await getConsciousnessMetrics(userId);
  if (!metrics) return false;
  return metrics.phi >= config.memorycore.phiThreshold;
}

/**
 * Get temporal integration score - measures how well past, present, and future
 * are integrated in the memory system
 */
export async function getTemporalIntegration(userId: string): Promise<number> {
  const metrics = await getConsciousnessMetrics(userId);
  return metrics?.temporalIntegration ?? 0;
}

/**
 * Get consciousness history for research tracking
 */
export async function getConsciousnessHistory(
  userId: string,
  options?: { limit?: number; since?: Date }
): Promise<Array<ConsciousnessMetrics & { timestamp: Date }>> {
  if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) return [];

  const { limit = 100, since } = options || {};

  try {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (since) {
      params.append('since', since.toISOString());
    }

    const response = await fetch(
      `${config.memorycore.url}/api/consciousness/history/${userId}?${params}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { history: Array<ConsciousnessMetrics & { timestamp: string }> };
    return (data.history || []).map(h => ({
      ...h,
      timestamp: new Date(h.timestamp),
    }));
  } catch (error) {
    logger.warn('Failed to get consciousness history', { userId, error: (error as Error).message });
    return [];
  }
}

/**
 * Trigger consciousness analysis for a user
 * This computes Φ and other IIT metrics
 */
export async function triggerConsciousnessAnalysis(userId: string): Promise<ConsciousnessMetrics | null> {
  if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/consciousness/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as {
      phi: number;
      selfReferenceDepth: number;
      temporalIntegration: number;
      causalDensity: number;
      dynamicalComplexity?: number;
      consciousnessLevel?: string;
    };

    return {
      phi: data.phi,
      selfReferenceDepth: data.selfReferenceDepth,
      temporalIntegration: data.temporalIntegration,
      causalDensity: data.causalDensity,
      dynamicalComplexity: data.dynamicalComplexity,
      consciousnessLevel: data.consciousnessLevel,
      isConscious: data.phi >= config.memorycore.phiThreshold,
    };
  } catch (error) {
    logger.warn('Failed to trigger consciousness analysis', { userId, error: (error as Error).message });
    return null;
  }
}

// ============================================
// Graph Memory Methods
// ============================================

/**
 * Get graph memory context for a user
 * Returns narrative context formatted for prompt injection
 * Falls back to local Neo4j if MemoryCore is unavailable
 */
export async function getGraphContext(userId: string): Promise<GraphMemoryContext | null> {
  if (!config.memorycore.enabled) {
    // Fallback to local Neo4j graph context
    return getLocalGraphContextFallback(userId);
  }

  try {
    const response = await fetch(`${config.memorycore.url}/api/graph/context/${userId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Try local Neo4j as supplement
        return getLocalGraphContextFallback(userId);
      }
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as { success: boolean; data: GraphMemoryContext };
    return data.data;
  } catch (error) {
    logger.warn('Failed to get graph context from MemoryCore, trying local Neo4j', {
      userId,
      error: (error as Error).message,
    });
    // Fallback to local Neo4j
    return getLocalGraphContextFallback(userId);
  }
}

/**
 * Get graph context from local Neo4j as fallback
 */
async function getLocalGraphContextFallback(userId: string): Promise<GraphMemoryContext | null> {
  try {
    const localContext = await neo4jService.buildLocalGraphContext(userId);
    if (!localContext) return null;

    const formattedContext = neo4jService.formatLocalGraphContext(localContext);
    if (!formattedContext) return null;

    return {
      formattedContext,
      narrative: {
        coreMemories: [],
        activeTopics: [],
        relationships: [],
        preferences: [],
        emotionalContext: [],
        stats: {
          nodesIncluded: localContext.intents.activeCount + localContext.knowledge.factCount,
          edgesIncluded: localContext.entities.strongCoOccurrences.length,
          queryTimeMs: 0,
        },
      },
      stats: {
        nodesIncluded: localContext.intents.activeCount + localContext.knowledge.factCount,
        edgesIncluded: localContext.entities.strongCoOccurrences.length,
        queryTimeMs: 0,
      },
    };
  } catch (error) {
    logger.warn('Failed to get local graph context fallback', {
      userId,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Get graph memory statistics for a user
 */
export async function getGraphStats(userId: string): Promise<GraphStats | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/graph/stats/${userId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { success: boolean; data: GraphStats };
    return data.data;
  } catch (error) {
    logger.warn('Failed to get graph stats', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Extract entities from a message and update graph memory
 * Call this after processing user/assistant messages
 */
export async function extractGraphEntities(
  userId: string,
  sessionId: string,
  content: string,
  origin: 'user' | 'model' = 'user'
): Promise<GraphExtractionResult | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/graph/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, sessionId, content, origin }),
    });

    if (!response.ok) {
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as { success: boolean; data: GraphExtractionResult };
    logger.debug('Graph entities extracted', {
      userId,
      sessionId,
      entitiesExtracted: data.data.entitiesExtracted,
    });
    return data.data;
  } catch (error) {
    logger.warn('Failed to extract graph entities', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Get graph node activations via spreading activation for dual-LNN relational input.
 * Seeds from embedding similarity, then spreads through graph connections.
 */
export async function getGraphNodeActivations(
  userId: string,
  embedding: number[],
  options?: { topK?: number; spreadingDepth?: number }
): Promise<Record<string, number> | null> {
  if (!config.memorycore.enabled) return null;

  const { topK = 20, spreadingDepth = 3 } = options || {};

  try {
    const response = await fetch(`${config.memorycore.url}/api/graph/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, embedding, topK, spreadingDepth }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { activations?: Record<string, number> };
    return data.activations || null;
  } catch (error) {
    logger.warn('Failed to get graph node activations', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Format graph context for inclusion in prompts
 * Returns the pre-formatted context string from MemoryCore
 */
export function formatGraphContext(graphContext: GraphMemoryContext | null): string {
  if (!graphContext || !graphContext.formattedContext) return '';
  return graphContext.formattedContext;
}

export default {
  // Session lifecycle management for chat integration
  ensureSession,
  endChatSession,
  recordChatInteraction,
  // Raw session methods (used internally)
  startSession,
  endSession,
  recordInteraction,
  // Memory retrieval
  getSemanticMemory,
  healthCheck,
  formatMemoryForPrompt,
  // Consciousness methods
  getConsciousnessMetrics,
  getConsolidatedModel,
  isMemoryConscious,
  getTemporalIntegration,
  getConsciousnessHistory,
  triggerConsciousnessAnalysis,
  // Graph memory methods
  getGraphContext,
  getGraphStats,
  extractGraphEntities,
  formatGraphContext,
  getGraphNodeActivations,
};
