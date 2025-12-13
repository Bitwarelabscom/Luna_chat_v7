import * as embeddingService from './embedding.service.js';
import * as factsService from './facts.service.js';
import * as insightsService from '../autonomous/insights.service.js';
import logger from '../utils/logger.js';

/**
 * Memory context split into stable (cacheable) and volatile (per-query) parts
 * This separation enables better Anthropic prompt caching
 */
export interface MemoryContext {
  // Stable (cacheable) - rarely changes, goes in Tier 2
  stable: {
    facts: string;      // User facts - sorted alphabetically for determinism
    learnings: string;  // Luna's learnings - sorted for determinism
  };
  // Volatile (not cached) - changes per query, goes in Tier 4
  volatile: {
    relevantHistory: string;      // Semantic search results
    conversationContext: string;  // Similar conversation summaries
  };
}

/**
 * Format stable memory context for Tier 2 (cacheable)
 * Contains user facts and learnings that rarely change
 */
export function formatStableMemory(context: MemoryContext): string {
  const parts: string[] = [];
  if (context.stable.facts) {
    parts.push(context.stable.facts);
  }
  if (context.stable.learnings) {
    parts.push(context.stable.learnings);
  }
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
    // Run all queries in parallel for better performance
    const [facts, similarMessages, similarConversations, learningsContext] = await Promise.all([
      // Get user facts
      factsService.getUserFacts(userId, { limit: 30 }),
      // Search for relevant past messages (excluding current session)
      embeddingService.searchSimilarMessages(
        currentMessage,
        userId,
        {
          limit: 5,
          threshold: 0.75,
          excludeSessionId: currentSessionId
        }
      ),
      // Search for similar conversation summaries
      embeddingService.searchSimilarConversations(
        currentMessage,
        userId,
        3
      ),
      // Get active learnings from autonomous sessions
      insightsService.getActiveLearningsForContext(userId, 10),
    ]);

    // Format facts with alphabetical sorting for cache determinism
    const factsPrompt = factsService.formatFactsForPrompt(facts);

    // Format learnings (stable)
    let learnings = '';
    if (learningsContext) {
      learnings = `[Luna's Learnings - Apply these insights to personalize responses]\n${learningsContext}`;
    }

    // Format relevant history (volatile - changes per query)
    let relevantHistory = '';
    if (similarMessages.length > 0) {
      const historyItems = similarMessages.map(m => {
        const role = m.role === 'user' ? 'User' : 'Luna';
        return `[${role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`;
      });
      relevantHistory = `[Relevant Past Conversations]\n${historyItems.join('\n')}`;
    }

    // Format conversation context (volatile - changes per query)
    let conversationContext = '';
    if (similarConversations.length > 0) {
      const contextItems = similarConversations.map(c =>
        `- ${c.summary} (Topics: ${c.topics.join(', ')})`
      );
      conversationContext = `[Related Past Topics]\n${contextItems.join('\n')}`;
    }

    return {
      stable: {
        facts: factsPrompt,
        learnings,
      },
      volatile: {
        relevantHistory,
        conversationContext,
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
 * Format memory context for system prompt (legacy - combines all parts)
 * @deprecated Use formatStableMemory and formatVolatileMemory for cache optimization
 */
export function formatMemoryForPrompt(context: MemoryContext): string {
  const parts: string[] = [];

  // Stable parts
  if (context.stable.facts) {
    parts.push(context.stable.facts);
  }
  if (context.stable.learnings) {
    parts.push(context.stable.learnings);
  }

  // Volatile parts
  if (context.volatile.relevantHistory) {
    parts.push(context.volatile.relevantHistory);
  }
  if (context.volatile.conversationContext) {
    parts.push(context.volatile.conversationContext);
  }

  if (parts.length === 0) return '';

  return parts.join('\n\n');
}

/**
 * Process and store memory after a conversation exchange
 */
export async function processMessageMemory(
  userId: string,
  sessionId: string,
  messageId: string,
  content: string,
  role: string
): Promise<void> {
  // Store embedding asynchronously
  embeddingService.storeMessageEmbedding(
    messageId,
    userId,
    sessionId,
    content,
    role
  ).catch(err => {
    logger.error('Failed to store message embedding', { error: err.message });
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
    // Extract and store facts
    await factsService.processConversationFacts(userId, sessionId, messages);

    // Generate and store summary if enough messages
    if (messages.length >= 4) {
      const summaryData = await factsService.generateConversationSummary(messages);
      if (summaryData) {
        await embeddingService.storeConversationSummary(
          sessionId,
          userId,
          summaryData.summary,
          summaryData.topics,
          summaryData.keyPoints,
          messages.length,
          summaryData.sentiment
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
