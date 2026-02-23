/**
 * Layered Agent - Main Entry Point
 *
 * Provides the primary interface for processing messages
 * using the layered agent architecture.
 */

import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { GraphStateInput } from './schemas/graph-state.js';
import { executeGraph } from './graph/executor.js';
import * as identityStore from './stores/identity.store.js';
import * as stateStore from './stores/state.store.js';
import * as tokenTracker from './services/token-tracker.service.js';
import logger from '../utils/logger.js';

// Default identity file path
const DEFAULT_IDENTITY_PATH = join(process.cwd(), 'src/config/identity_luna_v13.yaml');

export interface LayeredAgentInput {
  sessionId: string;
  userId: string;
  message: string;
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna';
  source?: 'web' | 'telegram' | 'api';
}

export interface LLMCallBreakdown {
  node: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  cost: number;
  durationMs?: number;
}

export interface LayeredAgentMetrics {
  promptTokens: number;
  completionTokens: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  toolsUsed: string[];
  model: string;
  llmBreakdown?: LLMCallBreakdown[];
  totalCost?: number;
}

export interface LayeredAgentOutput {
  messageId: string;
  content: string;
  success: boolean;
  attempts: number;
  executionTimeMs: number;
  critiqueIssues?: string[];
  metrics?: LayeredAgentMetrics;
}

/**
 * Process a message using the layered agent architecture
 *
 * This is the main entry point that replaces the legacy chat processing
 * when AGENT_ENGINE=layered_v1
 */
export async function processLayeredAgent(
  input: LayeredAgentInput
): Promise<LayeredAgentOutput> {
  const { sessionId, userId, message, mode, source = 'web' } = input;
  const turnId = uuidv4();
  const startTime = Date.now();

  logger.info('Layered agent processing started', {
    sessionId,
    userId,
    turnId,
    mode,
    source,
    messageLength: message.length,
  });

  try {
    // 1. Ensure identity is loaded and pinned for this session
    const identity = await identityStore.ensureSessionIdentity(
      sessionId,
      DEFAULT_IDENTITY_PATH
    );

    // 2. Get current state snapshot
    const agentView = await stateStore.getSnapshotFast(sessionId);

    // 3. Build graph input
    const graphInput: GraphStateInput = {
      session_id: sessionId,
      turn_id: turnId,
      user_input: message,
      mode,
    };

    // 4. Execute the graph
    const result = await executeGraph(graphInput, identity, agentView, userId);

    // 5. Store memory for this turn (async, don't block)
    // DISABLED: Handled in chat.service.ts to ensure correct message IDs and avoid FK violations
    // storeMemoryAsync(turnId, userId, sessionId, message, result);

    const executionTimeMs = Date.now() - startTime;

    // 6. Get token summary for metrics
    let metrics: LayeredAgentMetrics | undefined;
    try {
      const summary = await tokenTracker.getTurnSummary(turnId);
      logger.info('Token summary result for metrics', {
        turnId,
        mode,
        hasSummary: !!summary,
        llmCallCount: summary?.llmCallCount || 0,
        totalTokens: summary?.totalTokens || 0,
      });
      if (summary && summary.llmCallCount > 0) {
        const tokensPerSecond = executionTimeMs > 0
          ? (summary.totalOutputTokens / (executionTimeMs / 1000))
          : 0;

        metrics = {
          promptTokens: summary.totalInputTokens,
          completionTokens: summary.totalOutputTokens,
          processingTimeMs: executionTimeMs,
          tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
          toolsUsed: [], // Layered agent doesn't use tools (yet)
          model: summary.callBreakdown[0]?.model || 'layered-agent',
          llmBreakdown: summary.callBreakdown.map(call => ({
            node: call.node,
            model: call.model,
            provider: call.provider,
            inputTokens: call.input,
            outputTokens: call.output,
            cacheTokens: call.cache || undefined,
            cost: call.cost,
            durationMs: call.duration || undefined,
          })),
          totalCost: summary.totalCost,
        };
      }
    } catch (error) {
      logger.warn('Failed to get token summary for metrics', {
        turnId,
        error: (error as Error).message,
      });
    }

    logger.info('Layered agent processing completed', {
      sessionId,
      turnId,
      success: result.success,
      attempts: result.state.attempts,
      executionTimeMs,
      outputLength: result.output?.length || 0,
    });

    return {
      messageId: turnId,
      content: result.output || "I'm sorry, I couldn't generate a response.",
      success: result.success,
      attempts: result.state.attempts,
      executionTimeMs,
      critiqueIssues: result.state.critique_issues.length > 0
        ? result.state.critique_issues
        : undefined,
      metrics,
    };

  } catch (error) {
    const executionTimeMs = Date.now() - startTime;

    logger.error('Layered agent processing failed', {
      sessionId,
      turnId,
      error: (error as Error).message,
      executionTimeMs,
    });

    return {
      messageId: turnId,
      content: "I'm sorry, something went wrong. Please try again.",
      success: false,
      attempts: 0,
      executionTimeMs,
    };
  }
}

/**
 * Stream a message using the layered agent architecture
 * (For now, this is a simple wrapper that returns the full response)
 * TODO: Implement true streaming with node-by-node progress
 */
export async function* streamLayeredAgent(
  input: LayeredAgentInput
): AsyncGenerator<{
  type: 'status' | 'content' | 'done';
  content?: string;
  messageId?: string;
  attempts?: number;
  tokensUsed?: number;
  metrics?: LayeredAgentMetrics;
}> {
  // Emit status updates
  yield { type: 'status', content: 'Preparing response...' };

  const result = await processLayeredAgent(input);

  // Emit content
  yield { type: 'content', content: result.content };

  // Emit done with metrics
  yield {
    type: 'done',
    messageId: result.messageId,
    attempts: result.attempts,
    tokensUsed: result.metrics?.promptTokens && result.metrics?.completionTokens
      ? result.metrics.promptTokens + result.metrics.completionTokens
      : 0,
    metrics: result.metrics,
  };
}

/**
 * Get drift metrics for dashboard
 */
export async function getDriftMetrics(
  startDate: Date,
  endDate: Date,
  identityId?: string
) {
  return stateStore.getDriftMetrics(startDate, endDate, identityId);
}

/**
 * Get recent turns for a session (debugging)
 */
export async function getSessionTurns(sessionId: string, limit: number = 10) {
  return stateStore.getRecentTurns(sessionId, limit);
}

/**
 * Get current state snapshot for a session
 */
export async function getSessionState(sessionId: string) {
  return stateStore.getSnapshotFast(sessionId);
}

/**
 * Check if layered agent is enabled
 */
export function isLayeredAgentEnabled(): boolean {
  // Import config dynamically to avoid circular deps
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('../config/index.js');
  return config.agentEngine === 'layered_v1';
}

// Re-export types and schemas
export * from './schemas/identity.js';
export * from './schemas/events.js';
export * from './schemas/graph-state.js';

export default {
  processLayeredAgent,
  streamLayeredAgent,
  getDriftMetrics,
  getSessionTurns,
  getSessionState,
  isLayeredAgentEnabled,
};
