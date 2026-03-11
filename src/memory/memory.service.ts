import * as embeddingService from './embedding.service.js';
import * as factsService from './facts.service.js';
import * as insightsService from '../autonomous/insights.service.js';
import * as memorycoreClient from './memorycore.client.js';
import * as neo4jService from '../graph/neo4j.service.js';
import { graphContextForMessage, graphContextFallback } from './memorycore-graph.service.js';
import { queryOne } from '../db/postgres.js';
import logger from '../utils/logger.js';
import type { Session } from '../types/index.js';
import { UNTRUSTED_EMAIL_FRAME } from '../email/email-gatekeeper.service.js';
import { formatRelativeTime } from './time-utils.js';
import { scoreMessageComplexity, curateMemory } from './memory-curation.service.js';
import { classifyEdges } from './edge-classification.service.js';
import * as lunaStreamsClient from '../integration/luna-streams.client.js';
import * as emotionalMoments from './emotional-moments.service.js';
import * as contradictionService from './contradiction.service.js';
import * as behavioralPatterns from './behavioral-patterns.service.js';

/**
 * Memory context split into stable (cacheable) and volatile (per-query) parts
 * This separation enables better Anthropic prompt caching
 */
export interface MemoryContext {
  // Stable (cacheable) - rarely changes, goes in Tier 2
  stable: {
    facts: string;      // User facts - sorted alphabetically for determinism
    learnings: string;  // Luna's learnings - sorted for determinism
    graphMemory?: string;  // Graph memory narrative (connections, relationships)
    localGraphMemory?: string;  // Local Neo4j graph memory (fallback/supplement)
    consciousness?: {   // Consciousness metrics from NeuralSleep
      phi: number;
      temporalIntegration: number;
      consciousnessLevel?: string;
    };
    consolidatedPatterns?: string;  // NeuralSleep consolidated patterns
    consolidatedKnowledge?: string;  // NeuralSleep preferences + known facts
    semanticMemory?: string;  // MemoryCore high-tier semantic knowledge
    emotionalMoments?: string;  // Recent raw emotional moments
    behavioralObservations?: string;  // Specific behavioral pattern observations
  };
  // Volatile (not cached) - changes per query, goes in Tier 4
  volatile: {
    relevantHistory: string;      // Semantic search results
    conversationContext: string;  // Similar conversation summaries
    curationReasoning?: string;   // Debug: why curation selected these memories
    contradictions?: string;      // Unsurfaced contradiction signals
    contradictionIds?: string[];  // IDs for marking as surfaced post-response
  };
}

/**
 * Format stable memory context for Tier 2 (cacheable)
 * Contains user facts and learnings that rarely change
 */
export function formatStableMemory(context: MemoryContext): string {
  const parts: string[] = [];

  // Graph memory (narrative format - primary knowledge source)
  // This goes first as it provides structured relationship context
  if (context.stable.graphMemory) {
    parts.push(context.stable.graphMemory);
  }

  // Local graph memory (Neo4j fallback/supplement for intent dependencies and co-occurrences)
  if (context.stable.localGraphMemory) {
    parts.push(context.stable.localGraphMemory);
  }

  if (context.stable.facts) {
    parts.push(context.stable.facts);
  }
  if (context.stable.learnings) {
    parts.push(context.stable.learnings);
  }
  // Add consolidated patterns from NeuralSleep if available
  if (context.stable.consolidatedPatterns) {
    parts.push(context.stable.consolidatedPatterns);
  }
  // Add consolidated knowledge (preferences + known facts) from NeuralSleep
  if (context.stable.consolidatedKnowledge) {
    parts.push(context.stable.consolidatedKnowledge);
  }
  // Add semantic memory from MemoryCore
  if (context.stable.semanticMemory) {
    parts.push(context.stable.semanticMemory);
  }
  // Emotional moments - raw, specific memories
  if (context.stable.emotionalMoments) {
    parts.push(context.stable.emotionalMoments);
  }
  // Behavioral observations - specific things Luna has noticed
  if (context.stable.behavioralObservations) {
    parts.push(context.stable.behavioralObservations);
  }
  // Note: consciousness metrics intentionally excluded from prompt - diagnostic only
  return parts.join('\n\n');
}

/**
 * Format volatile memory context for Tier 4 (not cached)
 * Contains semantic search results that change per query
 */
export function formatVolatileMemory(context: MemoryContext): string {
  const parts: string[] = [];
  if (context.volatile.relevantHistory) {
    parts.push(context.volatile.relevantHistory);
  }
  if (context.volatile.conversationContext) {
    parts.push(context.volatile.conversationContext);
  }
  if (context.volatile.contradictions) {
    parts.push(context.volatile.contradictions);
  }
  return parts.join('\n\n');
}

/**
 * Build complete memory context for a conversation
 * OPTIMIZED: Runs all queries in parallel for better performance
 * Returns split stable/volatile context for cache optimization
 */
export async function buildMemoryContext(
  userId: string,
  currentMessage: string,
  currentSessionId: string
): Promise<MemoryContext> {
  try {
    // Fetch session to get intent
    const session = await queryOne<Session>(`SELECT primary_intent_id as "primaryIntentId", secondary_intent_ids as "secondaryIntentIds" FROM sessions WHERE id = $1`, [currentSessionId]);
    const intentId = session?.primaryIntentId || null;

    // Each source is independently wrapped: try-catch + 5s timeout.
    // A failure in one source never affects another. Uses Promise.allSettled
    // so all queries complete independently - degraded but never broken.
    const QUERY_TIMEOUT_MS = 5000;
    const safeQuery = <T>(promise: Promise<T>, fallback: T, label: string): Promise<T> =>
      Promise.race([
        promise.catch(err => {
          logger.warn(`Memory source failed: ${label}`, { userId, error: (err as Error).message });
          return fallback;
        }),
        new Promise<T>(resolve => setTimeout(() => {
          logger.warn(`Memory source timed out: ${label}`, { userId });
          resolve(fallback);
        }, QUERY_TIMEOUT_MS)),
      ]);

    // Run all 12 sources in parallel - each independently fault-isolated
    const results = await Promise.allSettled([
      safeQuery(factsService.getUserFacts(userId, { limit: 30, intentId }), [], 'facts'),
      safeQuery(embeddingService.searchSimilarMessages(
        currentMessage, userId,
        { limit: 5, threshold: 0.75, excludeSessionId: currentSessionId, intentId }
      ), [], 'similarMessages'),
      safeQuery(embeddingService.searchSimilarConversations(
        currentMessage, userId, 3, intentId
      ), [], 'similarConversations'),
      safeQuery(insightsService.getActiveLearningsForContext(userId, 10), '', 'learnings'),
      safeQuery(memorycoreClient.getConsciousnessMetrics(userId), null, 'consciousness'),
      safeQuery(memorycoreClient.getConsolidatedModel(userId), null, 'consolidatedModel'),
      safeQuery(graphContextForMessage(userId, currentMessage, currentSessionId), '', 'graphContext'),
      safeQuery(neo4jService.buildLocalGraphContext(userId), null, 'localGraph'),
      safeQuery(memorycoreClient.getSemanticMemory(userId), null, 'semanticMemory'),
      safeQuery(emotionalMoments.getRecentMoments(userId, 5, 7), [], 'emotionalMoments'),
      safeQuery(behavioralPatterns.getActiveObservations(userId, 3), [], 'behavioralObservations'),
      safeQuery(contradictionService.getUnsurfaced(userId, currentSessionId), [], 'contradictions'),
    ]);

    // Extract values - allSettled always fulfills since safeQuery never rejects
    const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === 'fulfilled' ? r.value : fallback;

    const facts = val(results[0] as PromiseSettledResult<factsService.UserFact[]>, []);
    const similarMessages = val(results[1] as PromiseSettledResult<embeddingService.SimilarMessage[]>, []);
    const similarConversations = val(results[2] as PromiseSettledResult<Array<{ sessionId: string; summary: string; topics: string[]; similarity: number; updatedAt: Date }>>, []);
    const learningsContext = val(results[3] as PromiseSettledResult<string>, '');
    const consciousnessMetrics = val(results[4] as PromiseSettledResult<Awaited<ReturnType<typeof memorycoreClient.getConsciousnessMetrics>>>, null);
    const consolidatedModel = val(results[5] as PromiseSettledResult<Awaited<ReturnType<typeof memorycoreClient.getConsolidatedModel>>>, null);
    const graphContext = val(results[6] as PromiseSettledResult<string>, '');
    const localGraphContext = val(results[7] as PromiseSettledResult<Awaited<ReturnType<typeof neo4jService.buildLocalGraphContext>>>, null);
    const semanticMemoryData = val(results[8] as PromiseSettledResult<Awaited<ReturnType<typeof memorycoreClient.getSemanticMemory>>>, null);
    const recentEmotionalMoments = val(results[9] as PromiseSettledResult<Awaited<ReturnType<typeof emotionalMoments.getRecentMoments>>>, []);
    const activeObservations = val(results[10] as PromiseSettledResult<Awaited<ReturnType<typeof behavioralPatterns.getActiveObservations>>>, []);
    const unsurfacedContradictions = val(results[11] as PromiseSettledResult<Awaited<ReturnType<typeof contradictionService.getUnsurfaced>>>, []);

    // Score message complexity to decide whether to curate
    const complexity = scoreMessageComplexity(currentMessage);

    // Build consciousness context if metrics available
    const consciousness = consciousnessMetrics ? {
      phi: consciousnessMetrics.phi,
      temporalIntegration: consciousnessMetrics.temporalIntegration,
      consciousnessLevel: consciousnessMetrics.consciousnessLevel,
    } : undefined;

    // Format consolidated patterns from NeuralSleep (bi-directional flow)
    let consolidatedPatterns = '';
    if (consolidatedModel && consolidatedModel.episodicPatterns && consolidatedModel.episodicPatterns.length > 0) {
      const patterns = consolidatedModel.episodicPatterns
        .filter(p => p.confidence > 0.6)
        .slice(0, 5)
        .map(p => `- ${p.pattern} (${p.type})`);
      if (patterns.length > 0) {
        consolidatedPatterns = `[Patterns You've Noticed]\n${patterns.join('\n')}`;
      }
    }

    // Format consolidated knowledge (preferences + known facts) from NeuralSleep
    let consolidatedKnowledge = '';
    if (consolidatedModel) {
      const knowledgeParts: string[] = [];
      if (consolidatedModel.preferences && consolidatedModel.preferences.length > 0) {
        const prefs = consolidatedModel.preferences
          .filter(p => p.confidence > 0.5)
          .slice(0, 5)
          .map(p => {
            const sentiment = p.valence > 0.5 ? 'genuinely enjoys' : p.valence > 0 ? 'likes' : p.valence < -0.3 ? 'dislikes' : 'is neutral about';
            return `- ${sentiment} ${p.theme}`;
          });
        if (prefs.length > 0) knowledgeParts.push(...prefs);
      }
      if (consolidatedModel.knownFacts && consolidatedModel.knownFacts.length > 0) {
        const facts2 = consolidatedModel.knownFacts
          .filter(f => f.confidence > 0.5)
          .slice(0, 5)
          .map(f => `- Known: ${f.theme}`);
        if (facts2.length > 0) knowledgeParts.push(...facts2);
      }
      if (knowledgeParts.length > 0) {
        consolidatedKnowledge = `[Things You Know About Them]\n${knowledgeParts.join('\n')}`;
      }
    }

    // Format semantic memory from MemoryCore
    let semanticMemory = '';
    if (semanticMemoryData?.recentPatterns?.length) {
      const patterns = semanticMemoryData.recentPatterns
        .slice(0, 5)
        .map((p: { type: string; pattern: string }) => `- ${p.type}: ${p.pattern}`);
      semanticMemory = `[Things You've Learned Over Time]\n${patterns.join('\n')}`;
    }

    // Graph memory is already formatted by spreading activation
    const graphMemory = graphContext || '';

    // Get local graph memory (Neo4j - fallback/supplement)
    const localGraphMemory = neo4jService.formatLocalGraphContext(localGraphContext);

    // Attempt curation for non-trivial messages
    let factsPrompt: string;
    let learnings: string;
    let relevantHistory: string;
    let conversationContext: string;
    let curationReasoning: string | undefined;

    if (!complexity.isTrivial) {
      // Try LLM-based curation
      const curationResult = await curateMemory(
        currentMessage,
        {
          facts,
          similarMessages,
          similarConversations,
          learnings: learningsContext,
        },
        complexity.score,
        userId,
        currentSessionId,
      );

      if (!curationResult.skipped && (curationResult.factsPrompt || facts.length === 0)) {
        // Use curated results (but fall back if curation returned 0 facts when we have some)
        factsPrompt = curationResult.factsPrompt;
        learnings = curationResult.learningsPrompt;
        relevantHistory = curationResult.relevantHistory;
        conversationContext = curationResult.conversationContext;
        curationReasoning = curationResult.reasoning;
      } else {
        // Curation failed - fall back to timestamp-enriched direct formatting
        ({ factsPrompt, learnings, relevantHistory, conversationContext } =
          formatDirectWithTimestamps(facts, similarMessages, similarConversations, learningsContext));
      }
    } else {
      // Trivial message - skip curation, use timestamp-enriched direct formatting
      ({ factsPrompt, learnings, relevantHistory, conversationContext } =
        formatDirectWithTimestamps(facts, similarMessages, similarConversations, learningsContext));
    }

    // Format resonant memory data (cap emotional moments at 500 chars to prevent bloat)
    let emotionalMomentsFormatted = emotionalMoments.formatForContext(recentEmotionalMoments);
    if (emotionalMomentsFormatted.length > 500) {
      emotionalMomentsFormatted = emotionalMomentsFormatted.slice(0, 500).replace(/\n[^\n]*$/, '');
    }
    const behavioralObsFormatted = behavioralPatterns.formatForContext(activeObservations);
    const contradictionsFormatted = contradictionService.formatForContext(unsurfacedContradictions);
    const contradictionIds = unsurfacedContradictions.map(s => s.id);

    // Diagnostic: log per-source sizes so we can see what responded
    const sourceSizes = {
      facts: factsPrompt.length, learnings: learnings.length,
      relevantHistory: relevantHistory.length, conversationContext: conversationContext.length,
      graphMemory: graphMemory.length, localGraphMemory: localGraphMemory.length,
      consolidatedPatterns: consolidatedPatterns.length, consolidatedKnowledge: consolidatedKnowledge.length,
      semanticMemory: semanticMemory.length, emotionalMoments: emotionalMomentsFormatted.length,
      behavioralObservations: behavioralObsFormatted.length, contradictions: contradictionsFormatted.length,
    };
    const totalChars = Object.values(sourceSizes).reduce((a, b) => a + b, 0);
    const responded = Object.values(sourceSizes).filter(v => v > 0).length;
    logger.info('Memory context built', {
      userId, sourceSizes, totalChars,
      approxTokens: Math.round(totalChars / 4),
      sourcesResponded: `${responded}/12`,
    });

    return {
      stable: {
        facts: factsPrompt,
        learnings,
        graphMemory,
        localGraphMemory,
        consciousness,
        consolidatedPatterns,
        consolidatedKnowledge,
        semanticMemory,
        emotionalMoments: emotionalMomentsFormatted,
        behavioralObservations: behavioralObsFormatted,
      },
      volatile: {
        relevantHistory,
        conversationContext,
        curationReasoning,
        contradictions: contradictionsFormatted,
        contradictionIds,
      },
    };
  } catch (error) {
    logger.error('Failed to build memory context', {
      error: (error as Error).message,
      userId
    });
    return {
      stable: { facts: '', learnings: '' },
      volatile: { relevantHistory: '', conversationContext: '' }
    };
  }
}

/**
 * Build only stable memory (facts + learnings) for companion mode smalltalk
 * This is a lightweight version that skips expensive semantic searches
 * but still gives Luna knowledge of who she's talking to
 */
export async function buildStableMemoryOnly(userId: string): Promise<MemoryContext> {
  try {
    // Each source independently fault-isolated with try-catch + 5s timeout
    const QUERY_TIMEOUT_MS = 5000;
    const safeQuery = <T>(promise: Promise<T>, fallback: T, label: string): Promise<T> =>
      Promise.race([
        promise.catch(err => {
          logger.warn(`Memory source failed: ${label}`, { userId, error: (err as Error).message });
          return fallback;
        }),
        new Promise<T>(resolve => setTimeout(() => {
          logger.warn(`Memory source timed out: ${label}`, { userId });
          resolve(fallback);
        }, QUERY_TIMEOUT_MS)),
      ]);

    const stableResults = await Promise.allSettled([
      safeQuery(factsService.getUserFacts(userId, { limit: 30 }), [], 'facts'),
      safeQuery(insightsService.getActiveLearningsForContext(userId, 10), '', 'learnings'),
      safeQuery(memorycoreClient.getConsciousnessMetrics(userId), null, 'consciousness'),
      safeQuery(memorycoreClient.getConsolidatedModel(userId), null, 'consolidatedModel'),
      safeQuery(graphContextFallback(userId), '', 'graphContext'),
      safeQuery(neo4jService.buildLocalGraphContext(userId), null, 'localGraph'),
      safeQuery(memorycoreClient.getSemanticMemory(userId), null, 'semanticMemory'),
      safeQuery(emotionalMoments.getRecentMoments(userId, 5, 7), [], 'emotionalMoments'),
      safeQuery(behavioralPatterns.getActiveObservations(userId, 3), [], 'behavioralObservations'),
    ]);

    const sval = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === 'fulfilled' ? r.value : fallback;

    const facts = sval(stableResults[0] as PromiseSettledResult<factsService.UserFact[]>, []);
    const learningsContext = sval(stableResults[1] as PromiseSettledResult<string>, '');
    const consciousnessMetrics = sval(stableResults[2] as PromiseSettledResult<Awaited<ReturnType<typeof memorycoreClient.getConsciousnessMetrics>>>, null);
    const consolidatedModel = sval(stableResults[3] as PromiseSettledResult<Awaited<ReturnType<typeof memorycoreClient.getConsolidatedModel>>>, null);
    const graphContext = sval(stableResults[4] as PromiseSettledResult<string>, '');
    const localGraphContext = sval(stableResults[5] as PromiseSettledResult<Awaited<ReturnType<typeof neo4jService.buildLocalGraphContext>>>, null);
    const semanticMemoryData = sval(stableResults[6] as PromiseSettledResult<Awaited<ReturnType<typeof memorycoreClient.getSemanticMemory>>>, null);
    const recentEmotionalMoments = sval(stableResults[7] as PromiseSettledResult<Awaited<ReturnType<typeof emotionalMoments.getRecentMoments>>>, []);
    const activeObservations = sval(stableResults[8] as PromiseSettledResult<Awaited<ReturnType<typeof behavioralPatterns.getActiveObservations>>>, []);

    // Use timestamps in stable-only mode (learnings already have timestamps from insights service)
    const factsPrompt = factsService.formatFactsForPrompt(facts, true);

    let learnings = '';
    if (learningsContext) {
      learnings = `[Luna's Learnings - Apply these insights to personalize responses]\n${learningsContext}`;
    }

    // Build consciousness context if metrics available
    const consciousness = consciousnessMetrics ? {
      phi: consciousnessMetrics.phi,
      temporalIntegration: consciousnessMetrics.temporalIntegration,
      consciousnessLevel: consciousnessMetrics.consciousnessLevel,
    } : undefined;

    // Format consolidated patterns from NeuralSleep (bi-directional flow)
    let consolidatedPatterns = '';
    if (consolidatedModel && consolidatedModel.episodicPatterns && consolidatedModel.episodicPatterns.length > 0) {
      const patterns = consolidatedModel.episodicPatterns
        .filter(p => p.confidence > 0.6)
        .slice(0, 5)
        .map(p => `- ${p.pattern} (${p.type})`);
      if (patterns.length > 0) {
        consolidatedPatterns = `[Patterns You've Noticed]\n${patterns.join('\n')}`;
      }
    }

    // Format consolidated knowledge (preferences + known facts) from NeuralSleep
    let consolidatedKnowledge = '';
    if (consolidatedModel) {
      const knowledgeParts: string[] = [];
      if (consolidatedModel.preferences && consolidatedModel.preferences.length > 0) {
        const prefs = consolidatedModel.preferences
          .filter(p => p.confidence > 0.5)
          .slice(0, 5)
          .map(p => {
            const sentiment = p.valence > 0.5 ? 'genuinely enjoys' : p.valence > 0 ? 'likes' : p.valence < -0.3 ? 'dislikes' : 'is neutral about';
            return `- ${sentiment} ${p.theme}`;
          });
        if (prefs.length > 0) knowledgeParts.push(...prefs);
      }
      if (consolidatedModel.knownFacts && consolidatedModel.knownFacts.length > 0) {
        const facts2 = consolidatedModel.knownFacts
          .filter(f => f.confidence > 0.5)
          .slice(0, 5)
          .map(f => `- Known: ${f.theme}`);
        if (facts2.length > 0) knowledgeParts.push(...facts2);
      }
      if (knowledgeParts.length > 0) {
        consolidatedKnowledge = `[Things You Know About Them]\n${knowledgeParts.join('\n')}`;
      }
    }

    // Format semantic memory from MemoryCore
    let semanticMemory = '';
    if (semanticMemoryData?.recentPatterns?.length) {
      const patterns = semanticMemoryData.recentPatterns
        .slice(0, 5)
        .map((p: { type: string; pattern: string }) => `- ${p.type}: ${p.pattern}`);
      semanticMemory = `[Things You've Learned Over Time]\n${patterns.join('\n')}`;
    }

    // Graph memory is already formatted by fallback
    const graphMemory = graphContext || '';

    // Get local graph memory (Neo4j - fallback/supplement)
    const localGraphMemory = neo4jService.formatLocalGraphContext(localGraphContext);

    return {
      stable: {
        facts: factsPrompt,
        learnings,
        graphMemory,
        localGraphMemory,
        consciousness,
        consolidatedPatterns,
        consolidatedKnowledge,
        semanticMemory,
        emotionalMoments: (() => {
          let em = emotionalMoments.formatForContext(recentEmotionalMoments);
          if (em.length > 500) em = em.slice(0, 500).replace(/\n[^\n]*$/, '');
          return em;
        })(),
        behavioralObservations: behavioralPatterns.formatForContext(activeObservations),
      },
      volatile: {
        relevantHistory: '',
        conversationContext: '',
      },
    };
  } catch (error) {
    logger.error('Failed to build stable memory', {
      error: (error as Error).message,
      userId
    });
    return {
      stable: { facts: '', learnings: '' },
      volatile: { relevantHistory: '', conversationContext: '' }
    };
  }
}

/**
 * Format memory context for system prompt (legacy - combines all parts)
 * @deprecated Use formatStableMemory and formatVolatileMemory for cache optimization
 */
export function formatMemoryForPrompt(context: MemoryContext): string {
  const parts: string[] = [];

  // Graph memory (narrative format - primary knowledge source)
  if (context.stable.graphMemory) {
    parts.push(context.stable.graphMemory);
  }

  // Local graph memory (Neo4j fallback/supplement)
  if (context.stable.localGraphMemory) {
    parts.push(context.stable.localGraphMemory);
  }

  // Stable parts
  if (context.stable.facts) {
    parts.push(context.stable.facts);
  }
  if (context.stable.learnings) {
    parts.push(context.stable.learnings);
  }
  // Add consolidated patterns from NeuralSleep if available
  if (context.stable.consolidatedPatterns) {
    parts.push(context.stable.consolidatedPatterns);
  }
  // Add consolidated knowledge (preferences + known facts) from NeuralSleep
  if (context.stable.consolidatedKnowledge) {
    parts.push(context.stable.consolidatedKnowledge);
  }
  // Add semantic memory from MemoryCore
  if (context.stable.semanticMemory) {
    parts.push(context.stable.semanticMemory);
  }
  // Emotional moments and behavioral observations
  if (context.stable.emotionalMoments) {
    parts.push(context.stable.emotionalMoments);
  }
  if (context.stable.behavioralObservations) {
    parts.push(context.stable.behavioralObservations);
  }
  // Note: consciousness metrics intentionally excluded - diagnostic only

  // Volatile parts
  if (context.volatile.relevantHistory) {
    parts.push(context.volatile.relevantHistory);
  }
  if (context.volatile.conversationContext) {
    parts.push(context.volatile.conversationContext);
  }
  if (context.volatile.contradictions) {
    parts.push(context.volatile.contradictions);
  }

  if (parts.length === 0) return '';

  return parts.join('\n\n');
}

/**
 * Format memories directly with timestamps (no curation).
 * Used as fallback when curation is skipped or fails.
 */
function formatDirectWithTimestamps(
  facts: factsService.UserFact[],
  similarMessages: embeddingService.SimilarMessage[],
  similarConversations: Array<{ sessionId: string; summary: string; topics: string[]; similarity: number; updatedAt: Date }>,
  learningsContext: string,
): { factsPrompt: string; learnings: string; relevantHistory: string; conversationContext: string } {
  // Format facts with timestamps
  const factsPrompt = factsService.formatFactsForPrompt(facts, true);

  // Format learnings (timestamps already added by insights service)
  let learnings = '';
  if (learningsContext) {
    learnings = `[Luna's Learnings - Apply these insights to personalize responses]\n${learningsContext}`;
  }

  // Format relevant history with timestamps
  let relevantHistory = '';
  if (similarMessages.length > 0) {
    const historyItems = similarMessages.map(m => {
      const relTime = formatRelativeTime(m.createdAt);
      const role = m.role === 'user' ? 'User' : 'Luna';
      const timePrefix = relTime ? `[${relTime}] ` : '';
      return `${timePrefix}[${role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`;
    });
    relevantHistory = `[Relevant Past Conversations]\n${historyItems.join('\n')}`;
  }

  // Format conversation context with timestamps
  let conversationContext = '';
  if (similarConversations.length > 0) {
    const contextItems = similarConversations.map(c => {
      const relTime = formatRelativeTime(c.updatedAt);
      const timePrefix = relTime ? `[${relTime}] ` : '';
      return `- ${timePrefix}${c.summary} (Topics: ${c.topics.join(', ')})`;
    });
    conversationContext = `[Related Past Topics]\n${contextItems.join('\n')}`;
  }

  return { factsPrompt, learnings, relevantHistory, conversationContext };
}

/**
 * Process and store memory after a conversation exchange
 */
export async function processMessageMemory(
  userId: string,
  sessionId: string,
  messageId: string,
  content: string,
  role: string,
  options?: { skipMemoryStorage?: boolean; enrichment?: { emotionalValence?: number; attentionScore?: number } }
): Promise<void> {
  // Skip memory storage for email-sourced content (memory poisoning prevention)
  if (options?.skipMemoryStorage || content.includes(UNTRUSTED_EMAIL_FRAME)) {
    logger.debug('Skipping memory storage for untrusted email content', { messageId });
    return;
  }

  // Fetch session to get intent
  let intentId: string | null = null;
  try {
    const session = await queryOne<Session>(`SELECT primary_intent_id as "primaryIntentId" FROM sessions WHERE id = $1`, [sessionId]);
    intentId = session?.primaryIntentId || null;
  } catch (err) {
    logger.error('Failed to fetch session intent for message memory', { error: (err as Error).message });
  }

  // Store embedding asynchronously
  embeddingService.storeMessageEmbedding(
    messageId,
    userId,
    sessionId,
    content,
    role,
    intentId,
    options?.enrichment
  ).catch(err => {
    logger.error('Failed to store message embedding', { error: err.message });
  });

  // Extract graph entities asynchronously, then classify edge types
  memorycoreClient.extractGraphEntities(
    userId,
    sessionId,
    content,
    role === 'user' ? 'user' : 'model'
  ).then(result => {
    if (result?.entities && result.entities.length >= 2) {
      // Emit entity update to Luna Streams (fire-and-forget)
      lunaStreamsClient.emitEntityUpdate(result.entities, result.cooccurrences || 0);

      classifyEdges(userId, sessionId, content, role, result.entities).catch(err => {
        logger.error('Failed to classify edges', { error: err.message });
      });
    }
  }).catch(err => {
    logger.error('Failed to extract graph entities or classify edges', { error: err.message });
  });
}

/**
 * Process conversation for facts and summary after it ends or periodically
 */
export async function processConversationMemory(
  userId: string,
  sessionId: string,
  messages: Array<{ id?: string; role: string; content: string }>
): Promise<void> {
  try {
    // Filter out messages containing untrusted email content (memory poisoning prevention)
    const filteredMessages = messages.filter(
      msg => !msg.content.includes(UNTRUSTED_EMAIL_FRAME)
    );

    // Fetch session to get intent
    const session = await queryOne<Session>(`SELECT primary_intent_id as "primaryIntentId" FROM sessions WHERE id = $1`, [sessionId]);
    const intentId = session?.primaryIntentId || null;

    // Extract and store facts (using filtered messages)
    await factsService.processConversationFacts(userId, sessionId, filteredMessages, intentId);

    // Generate and store summary if enough filtered messages
    if (filteredMessages.length >= 4) {
      const summaryData = await factsService.generateConversationSummary(filteredMessages, userId, sessionId);
      if (summaryData) {
        await embeddingService.storeConversationSummary(
          sessionId,
          userId,
          summaryData.summary,
          summaryData.topics,
          summaryData.keyPoints,
          filteredMessages.length,
          summaryData.sentiment,
          intentId
        );
      }
    }
  } catch (error) {
    logger.error('Failed to process conversation memory', {
      error: (error as Error).message,
      userId,
      sessionId
    });
  }
}

export default {
  buildMemoryContext,
  formatMemoryForPrompt,
  formatStableMemory,
  formatVolatileMemory,
  processMessageMemory,
  processConversationMemory,
};
