/**
 * Context Compression Service
 *
 * Implements three compression strategies:
 * 1. Conversation Summarization - Rolling summary of older messages
 * 2. Message Truncation - Cap message length, strip tool verbosity
 * 3. Smarter History Selection - Semantic similarity instead of just recency
 */

import { query, queryOne } from '../db/postgres.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import { searchSimilarMessages, type SimilarMessage } from '../memory/embedding.service.js';
import type { Message } from '../types/index.js';
import logger from '../utils/logger.js';

// ============================================
// Configuration
// ============================================

export interface CompressionConfig {
  // Strategy 1: Summarization
  verbatimMessageCount: number;      // Keep last N messages verbatim (default: 6)
  summarizationThreshold: number;    // Trigger summarization after N messages (default: 10)

  // Strategy 2: Truncation
  maxMessageLength: number;          // Max chars per message in history (default: 500)
  stripToolDetails: boolean;         // Remove verbose tool call content (default: true)

  // Strategy 3: Semantic selection
  semanticRetrievalCount: number;    // Number of relevant older messages (default: 5)
  semanticThreshold: number;         // Similarity threshold (default: 0.75)
}

const DEFAULT_CONFIG: CompressionConfig = {
  verbatimMessageCount: 8,           // 4 exchanges (increased from 3)
  summarizationThreshold: 12,        // Start summarizing after 12 messages (increased from 10)
  maxMessageLength: 500,             // ~100 words per message
  stripToolDetails: true,
  semanticRetrievalCount: 6,         // Retrieve more relevant context (increased from 5)
  semanticThreshold: 0.75,
};

// ============================================
// Types
// ============================================

export interface CompressedContext {
  systemPrefix: string;              // Rolling summary to inject
  recentMessages: Message[];         // Last N verbatim messages
  relevantMessages: SimilarMessage[]; // Semantically selected older messages
  totalOriginalCount: number;        // For debugging/metrics
}

interface SessionSummaryInfo {
  rollingSummary: string | null;
  summaryCutoffMessageId: string | null;
  lastSummarizedAt: Date | null;
}

// ============================================
// Strategy 2: Message Truncation
// ============================================

/**
 * Strip tool call verbosity from assistant messages
 * Replaces detailed JSON with brief summaries
 */
function stripToolVerbosity(content: string): string {
  // Match tool call patterns and simplify them
  // Pattern: Looking for function calls or tool uses with JSON
  let result = content;

  // Strip JSON-like blocks (common in tool calls)
  result = result.replace(/```json\n[\s\S]*?```/g, '[tool data]');

  // Strip inline JSON objects
  result = result.replace(/\{[^{}]*"[^"]*":\s*[^{}]*\}/g, '[...]');

  // Simplify "I'll use X tool" patterns
  result = result.replace(/I('ll| will) (use|call|invoke) the (\w+) (tool|function)[^.]*\./gi, '[Using $3]');

  // Strip verbose search results
  result = result.replace(/Search results?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi, '[Search performed]');

  return result;
}

/**
 * Collapse verbose formatting in messages
 */
function collapseFormatting(content: string): string {
  let result = content;

  // Collapse long bullet lists (more than 3 items)
  const bulletPattern = /^(\s*[-*]\s+.+\n){4,}/gm;
  result = result.replace(bulletPattern, (match) => {
    const lines = match.trim().split('\n');
    return `${lines[0]}\n${lines[1]}\n  [...${lines.length - 2} more items...]\n`;
  });

  // Collapse code blocks to first/last 2 lines
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const lines = code.trim().split('\n');
    if (lines.length <= 5) return match;
    return `\`\`\`${lang}\n${lines.slice(0, 2).join('\n')}\n  [...${lines.length - 4} lines...]\n${lines.slice(-2).join('\n')}\n\`\`\``;
  });

  // Remove excessive whitespace
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * Compress a single message for history
 * Applies truncation and tool stripping
 */
export function compressMessage(message: Message, maxLength: number = DEFAULT_CONFIG.maxMessageLength): string {
  let content = message.content;

  // For assistant messages, strip tool verbosity and collapse formatting
  if (message.role === 'assistant') {
    content = stripToolVerbosity(content);
    content = collapseFormatting(content);
  }

  // Truncate at word boundary if too long
  if (content.length > maxLength) {
    const truncated = content.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    // Only use lastSpace if it's reasonably far into the string
    content = (lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }

  return content;
}

// ============================================
// Strategy 1: Rolling Summarization
// ============================================

const SUMMARY_PROMPT = `Summarize this conversation segment concisely in 2-3 sentences.
Focus on: main topics discussed, decisions made, key facts shared.
Preserve any important context the assistant needs to remember.
Do NOT use em dashes. Use regular hyphens if needed.

Conversation:
`;

/**
 * Get current summary info for a session
 */
async function getSessionSummaryInfo(sessionId: string): Promise<SessionSummaryInfo> {
  const result = await queryOne<{
    rolling_summary: string | null;
    summary_cutoff_message_id: string | null;
    last_summarized_at: Date | null;
  }>(
    `SELECT rolling_summary, summary_cutoff_message_id, last_summarized_at
     FROM sessions WHERE id = $1`,
    [sessionId]
  );

  return {
    rollingSummary: result?.rolling_summary || null,
    summaryCutoffMessageId: result?.summary_cutoff_message_id || null,
    lastSummarizedAt: result?.last_summarized_at || null,
  };
}

/**
 * Get message count for a session
 */
async function getMessageCount(sessionId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = $1',
    [sessionId]
  );
  return parseInt(result?.count || '0', 10);
}

/**
 * Get messages to summarize (older than verbatim window)
 */
async function getMessagesToSummarize(
  sessionId: string,
  verbatimCount: number,
  lastCutoffId: string | null
): Promise<Message[]> {
  // Get all messages except the most recent N
  const sql = `
    SELECT * FROM messages
    WHERE session_id = $1
    ${lastCutoffId ? 'AND created_at > (SELECT created_at FROM messages WHERE id = $2)' : ''}
    ORDER BY created_at ASC
    OFFSET 0
    LIMIT (
      SELECT GREATEST(0, COUNT(*) - $${lastCutoffId ? '3' : '2'})
      FROM messages WHERE session_id = $1
      ${lastCutoffId ? 'AND created_at > (SELECT created_at FROM messages WHERE id = $2)' : ''}
    )
  `;

  const params = lastCutoffId ? [sessionId, lastCutoffId, verbatimCount] : [sessionId, verbatimCount];
  const result = await query<{
    id: string;
    session_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    tokens_used: number;
    model: string | null;
    search_results: unknown;
    memory_context: unknown;
    created_at: Date;
  }>(sql, params);

  return result.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    tokensUsed: row.tokens_used,
    model: row.model,
    searchResults: row.search_results,
    memoryContext: row.memory_context,
    createdAt: row.created_at,
  }));
}

/**
 * Generate/update rolling summary for older messages
 * Called periodically as conversation grows
 */
export async function updateRollingSummary(
  sessionId: string,
  _userId: string,
  configOverride?: Partial<CompressionConfig>
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...configOverride };

  try {
    // Check if we have enough messages to summarize
    const messageCount = await getMessageCount(sessionId);
    if (messageCount <= cfg.summarizationThreshold) {
      logger.debug('Not enough messages to summarize', { sessionId, messageCount, threshold: cfg.summarizationThreshold });
      return;
    }

    // Get current summary info
    const summaryInfo = await getSessionSummaryInfo(sessionId);

    // Get messages to summarize (older than verbatim window, newer than last summary)
    const messagesToSummarize = await getMessagesToSummarize(
      sessionId,
      cfg.verbatimMessageCount,
      summaryInfo.summaryCutoffMessageId
    );

    if (messagesToSummarize.length < 2) {
      logger.debug('Not enough new messages to summarize', { sessionId, count: messagesToSummarize.length });
      return;
    }

    // Format messages for summarization
    const conversationText = messagesToSummarize
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    // Generate summary using OpenAI gpt-5-nano (faster than local CPU)
    const response = await createBackgroundCompletionWithFallback({
      userId: _userId,
      sessionId,
      feature: 'context_summary',
      messages: [{ role: 'user', content: SUMMARY_PROMPT + conversationText }],
      temperature: 0.3,
      maxTokens: 5000,
      loggingContext: {
        userId: _userId,
        sessionId,
        source: 'context-compression',
        nodeName: 'summarize'
      }
    });

    const newSummary = (response.content || '').trim();
    if (!newSummary) {
      logger.warn('Empty summary generated', { sessionId });
      return;
    }

    // Combine with existing summary if present
    const combinedSummary = summaryInfo.rollingSummary
      ? `${summaryInfo.rollingSummary}\n\nLater: ${newSummary}`
      : newSummary;

    // If combined summary is too long, re-summarize it
    let finalSummary = combinedSummary;
    if (combinedSummary.length > 800) {
      const recompressResponse = await createBackgroundCompletionWithFallback({
        userId: _userId,
        sessionId,
        feature: 'context_summary',
        messages: [{ role: 'user', content: `Compress this conversation summary into 2-3 sentences, preserving the most important points:\n\n${combinedSummary}` }],
        temperature: 0.3,
        maxTokens: 5000,
        loggingContext: {
          userId: _userId,
          sessionId,
          source: 'context-compression',
          nodeName: 'recompress'
        }
      });
      finalSummary = (recompressResponse.content || combinedSummary).trim();
    }

    // Get the new cutoff message ID (last message we summarized)
    const newCutoffId = messagesToSummarize[messagesToSummarize.length - 1].id;

    // Store the updated summary
    await query(
      `UPDATE sessions
       SET rolling_summary = $1, summary_cutoff_message_id = $2, last_summarized_at = NOW()
       WHERE id = $3`,
      [finalSummary, newCutoffId, sessionId]
    );

    logger.info('Updated rolling summary', {
      sessionId,
      messagesSummarized: messagesToSummarize.length,
      summaryLength: finalSummary.length
    });
  } catch (error) {
    logger.error('Failed to update rolling summary', {
      error: (error as Error).message,
      sessionId
    });
    // Don't throw - summarization failure is not critical
  }
}

// ============================================
// Strategy 3: Semantic History Selection
// ============================================

/**
 * Select semantically relevant older messages using embeddings
 */
export async function selectRelevantHistory(
  sessionId: string,
  userId: string,
  currentMessage: string,
  excludeRecentIds: string[],
  configOverride?: Partial<CompressionConfig>
): Promise<SimilarMessage[]> {
  const cfg = { ...DEFAULT_CONFIG, ...configOverride };

  try {
    // Use existing embedding search, but include current session
    // We'll filter out recent messages manually
    const similar = await searchSimilarMessages(currentMessage, userId, {
      limit: cfg.semanticRetrievalCount + excludeRecentIds.length, // Get extra to account for filtering
      threshold: cfg.semanticThreshold,
    });

    // Filter out messages from the recent window
    const filtered = similar.filter(m => !excludeRecentIds.includes(m.messageId));

    // Sort by a combination of similarity and recency (logarithmic decay)
    const now = Date.now();
    const scored = filtered.map(m => {
      const ageMs = now - new Date(m.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // Logarithmic decay: Day 0-1: 0.00, Day 7: ~0.13, Day 30: ~0.22, Day 365: 0.30 (max)
      const recencyPenalty = ageDays < 1 ? 0 : Math.min(0.30, Math.log10(ageDays + 1) * 0.12);
      return { ...m, adjustedScore: m.similarity - recencyPenalty };
    });

    scored.sort((a, b) => b.adjustedScore - a.adjustedScore);

    return scored.slice(0, cfg.semanticRetrievalCount);
  } catch (error) {
    logger.error('Failed to select relevant history', {
      error: (error as Error).message,
      sessionId
    });
    return [];
  }
}

// ============================================
// Main Orchestrator
// ============================================

/**
 * Build optimized context for a conversation
 * Combines all three compression strategies
 */
export async function buildCompressedContext(
  sessionId: string,
  userId: string,
  currentMessage: string,
  allMessages: Message[],
  configOverride?: Partial<CompressionConfig>
): Promise<CompressedContext> {
  const cfg = { ...DEFAULT_CONFIG, ...configOverride };
  const totalOriginalCount = allMessages.length;

  // Get recent messages (verbatim window)
  const recentMessages = allMessages.slice(-cfg.verbatimMessageCount);
  const recentIds = recentMessages.map(m => m.id);

  // Get rolling summary
  const summaryInfo = await getSessionSummaryInfo(sessionId);
  const systemPrefix = summaryInfo.rollingSummary
    ? `[Previous Conversation Summary]\n${summaryInfo.rollingSummary}\n[End Summary]`
    : '';

  // Get semantically relevant older messages
  let relevantMessages: SimilarMessage[] = [];
  if (totalOriginalCount > cfg.verbatimMessageCount) {
    relevantMessages = await selectRelevantHistory(
      sessionId,
      userId,
      currentMessage,
      recentIds,
      cfg
    );
  }

  // Calculate approximate character savings
  const originalChars = allMessages.reduce((sum, m) => sum + m.content.length, 0);
  const compressedChars = recentMessages.reduce((sum, m) => sum + m.content.length, 0)
    + relevantMessages.reduce((sum, m) => sum + m.content.length, 0)
    + systemPrefix.length;
  const savedChars = originalChars - compressedChars;
  const savedPercent = originalChars > 0 ? Math.round((savedChars / originalChars) * 100) : 0;

  logger.info('Context compression applied', {
    sessionId,
    totalMessages: totalOriginalCount,
    verbatimKept: recentMessages.length,
    semanticRetrieved: relevantMessages.length,
    hasSummary: !!systemPrefix,
    originalChars,
    compressedChars,
    savedPercent: `${savedPercent}%`
  });

  return {
    systemPrefix,
    recentMessages,
    relevantMessages,
    totalOriginalCount,
  };
}

/**
 * Get the default compression config
 */
export function getDefaultConfig(): CompressionConfig {
  return { ...DEFAULT_CONFIG };
}

// ============================================
// Background Summarization Helpers
// ============================================

/**
 * Get count of messages since the last summarization
 * Used by background summarization to determine if threshold is met
 */
export async function getMessageCountSinceSummary(sessionId: string): Promise<number> {
  const summaryInfo = await getSessionSummaryInfo(sessionId);

  if (!summaryInfo.summaryCutoffMessageId) {
    // No summary yet - count all messages
    return await getMessageCount(sessionId);
  }

  // Count messages after the cutoff
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM messages
     WHERE session_id = $1
     AND created_at > (SELECT created_at FROM messages WHERE id = $2)`,
    [sessionId, summaryInfo.summaryCutoffMessageId]
  );

  return parseInt(result?.count || '0', 10);
}

/**
 * Estimate token count from messages
 * Uses rough approximation: ~4 characters per token for English text
 */
export function estimateTokenCount(messages: Message[]): number {
  const CHARS_PER_TOKEN = 4;
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

/**
 * Check if forced synchronous summarization is needed
 * Returns true if estimated tokens exceed safety threshold (80% of context window)
 */
export async function shouldForceSummarization(
  sessionId: string,
  messages: Message[],
  contextWindow: number
): Promise<boolean> {
  const SAFETY_MARGIN = 0.8; // Use 80% of context window before forcing
  const estimatedTokens = estimateTokenCount(messages);
  const threshold = contextWindow * SAFETY_MARGIN;

  if (estimatedTokens > threshold) {
    logger.warn('Context limit approaching - forcing summarization', {
      sessionId,
      estimatedTokens,
      threshold: Math.round(threshold),
      contextWindow,
    });
    return true;
  }

  return false;
}

export default {
  buildCompressedContext,
  updateRollingSummary,
  compressMessage,
  selectRelevantHistory,
  getDefaultConfig,
  getMessageCountSinceSummary,
  estimateTokenCount,
  shouldForceSummarization,
};
