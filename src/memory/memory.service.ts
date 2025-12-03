import * as embeddingService from './embedding.service.js';
import * as factsService from './facts.service.js';
import * as insightsService from '../autonomous/insights.service.js';
import logger from '../utils/logger.js';

export interface MemoryContext {
  facts: string;
  relevantHistory: string;
  conversationContext: string;
  learnings: string;
}

/**
 * Build complete memory context for a conversation
 * OPTIMIZED: Runs all queries in parallel for better performance
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

    const factsPrompt = factsService.formatFactsForPrompt(facts);

    // Format relevant history
    let relevantHistory = '';
    if (similarMessages.length > 0) {
      const historyItems = similarMessages.map(m => {
        const role = m.role === 'user' ? 'User' : 'Luna';
        return `[${role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`;
      });
      relevantHistory = `[Relevant Past Conversations]\n${historyItems.join('\n')}`;
    }

    // Format conversation context
    let conversationContext = '';
    if (similarConversations.length > 0) {
      const contextItems = similarConversations.map(c =>
        `- ${c.summary} (Topics: ${c.topics.join(', ')})`
      );
      conversationContext = `[Related Past Topics]\n${contextItems.join('\n')}`;
    }

    // Format learnings
    let learnings = '';
    if (learningsContext) {
      learnings = `[Luna's Learnings - Apply these insights to personalize responses]\n${learningsContext}`;
    }

    return {
      facts: factsPrompt,
      relevantHistory,
      conversationContext,
      learnings,
    };
  } catch (error) {
    logger.error('Failed to build memory context', {
      error: (error as Error).message,
      userId
    });
    return { facts: '', relevantHistory: '', conversationContext: '', learnings: '' };
  }
}

/**
 * Format memory context for system prompt
 */
export function formatMemoryForPrompt(context: MemoryContext): string {
  const parts: string[] = [];

  if (context.facts) {
    parts.push(context.facts);
  }

  if (context.relevantHistory) {
    parts.push(context.relevantHistory);
  }

  if (context.conversationContext) {
    parts.push(context.conversationContext);
  }

  if (context.learnings) {
    parts.push(context.learnings);
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
  processMessageMemory,
  processConversationMemory,
};
