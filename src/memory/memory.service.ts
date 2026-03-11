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

    // Run all queries in parallel for better performance
    const [facts, similarMessages, similarConversations, learningsContext, consciousnessMetrics, consolidatedModel, graphContext, localGraphContext, semanticMemoryData, recentEmotionalMoments, activeObservations, unsurfacedContradictions] = await Promise.all([
      // Get user facts (filtered by intent if available)
      factsService.getUserFacts(userId, { limit: 30, intentId }),
      // Search for relevant past messages (excluding current session, scoped to intent)
      embeddingService.searchSimilarMessages(
        currentMessage,
        userId,
        {
          limit: 5,
          threshold: 0.75,
          excludeSessionId: currentSessionId,
          intentId
        }
      ),
      // Search for similar conversation summaries (scoped to intent)
      embeddingService.searchSimilarConversations(
        currentMessage,
        userId,
        3,
        intentId
      ),
      // Get active learnings from autonomous sessions
      insightsService.getActiveLearningsForContext(userId, 10),
      // Get consciousness metrics from MemoryCore/NeuralSleep
      memorycoreClient.getConsciousnessMetrics(userId),
      // Get consolidated model from NeuralSleep (bi-directional flow)
      memorycoreClient.getConsolidatedModel(userId),
      // Get graph memory via spreading activation (replaces static narrative blob)
      graphContextForMessage(userId, currentMessage, currentSessionId),
      // Get local graph context from Neo4j (fallback/supplement)
      neo4jService.buildLocalGraphContext(userId),
      // Get semantic memory from MemoryCore (high-tier consolidated knowledge)
      memorycoreClient.getSemanticMemory(userId),
      // Get recent emotional moments (resonant memory)
      emotionalMoments.getRecentMoments(userId, 5, 7),
      // Get active behavioral observations (resonant memory)
      behavioralPatterns.getActiveObservations(userId, 3),
      // Get unsurfaced contradiction signals (user-scoped, per-session filtering)
      contradictionService.getUnsurfaced(userId, currentSessionId),
    ]);

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

    // Format resonant memory data
    const emotionalMomentsFormatted = emotionalMoments.formatForContext(recentEmotionalMoments);
    const behavioralObsFormatted = behavioralPatterns.formatForContext(activeObservations);
    const contradictionsFormatted = contradictionService.formatForContext(unsurfacedContradictions);
    const contradictionIds = unsurfacedContradictions.map(s => s.id);

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
    const [facts, learningsContext, consciousnessMetrics, consolidatedModel, graphContext, localGraphContext, semanticMemoryData, recentEmotionalMoments, activeObservations] = await Promise.all([
      factsService.getUserFacts(userId, { limit: 30 }),
      insightsService.getActiveLearningsForContext(userId, 10),
      memorycoreClient.getConsciousnessMetrics(userId),
      memorycoreClient.getConsolidatedModel(userId),
      graphContextFallback(userId),
      neo4jService.buildLocalGraphContext(userId),
      memorycoreClient.getSemanticMemory(userId),
      emotionalMoments.getRecentMoments(userId, 5, 7),
      behavioralPatterns.getActiveObservations(userId, 3),
    ]);

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
        emotionalMoments: emotionalMoments.formatForContext(recentEmotionalMoments),
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
