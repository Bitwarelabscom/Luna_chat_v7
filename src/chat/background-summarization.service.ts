/**
 * Background Summarization Service
 *
 * Handles non-blocking background conversation summarization with
 * per-session locking to prevent overlapping summarizations.
 */

import * as contextCompression from './context-compression.service.js';
import logger from '../utils/logger.js';

// In-memory lock per session to prevent concurrent summarizations
const summarizationLocks = new Map<string, boolean>();

// Threshold: trigger background summarization after this many messages since last summary
export const BACKGROUND_SUMMARY_THRESHOLD = 12;

/**
 * Trigger background summarization for a session (non-blocking)
 *
 * This fires off the summarization asynchronously and returns immediately.
 * Uses per-session locking to prevent overlapping summarizations.
 */
export function triggerBackgroundSummarization(
  sessionId: string,
  userId: string
): void {
  // Check lock - skip if already running for this session
  if (summarizationLocks.get(sessionId)) {
    logger.debug('Background summarization already in progress, skipping', { sessionId });
    return;
  }

  // Set lock
  summarizationLocks.set(sessionId, true);

  // Fire and forget - don't await
  runBackgroundSummarization(sessionId, userId)
    .finally(() => {
      summarizationLocks.delete(sessionId);
    });
}

/**
 * Check if a session currently has a summarization running
 */
export function isSummarizationRunning(sessionId: string): boolean {
  return summarizationLocks.get(sessionId) === true;
}

/**
 * Internal function that actually performs the summarization
 */
async function runBackgroundSummarization(
  sessionId: string,
  userId: string
): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Starting background summarization', { sessionId, userId });

    // Double-check we still need to summarize
    // (context might have been compressed by forced sync in the meantime)
    const messageCount = await contextCompression.getMessageCountSinceSummary(sessionId);
    if (messageCount < BACKGROUND_SUMMARY_THRESHOLD - 2) {
      logger.debug('Summary no longer needed after recheck', { sessionId, messageCount });
      return;
    }

    await contextCompression.updateRollingSummary(sessionId, userId);

    logger.info('Background summarization completed', {
      sessionId,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Background summarization failed', {
      sessionId,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    });
  }
}

export default {
  triggerBackgroundSummarization,
  isSummarizationRunning,
  BACKGROUND_SUMMARY_THRESHOLD,
};
