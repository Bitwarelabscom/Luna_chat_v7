/**
 * Graph Executor
 *
 * Executes the LangGraph-style loop:
 * state_manager -> plan -> draft -> critique -> [repair loop] -> end
 *
 * Features:
 * - Max attempts limit (default 3)
 * - Timeout support
 * - Observability hooks
 * - Turn logging
 */

import type { GraphState, GraphStateInput } from '../schemas/graph-state.js';
import { createInitialState, getNextNode, stateToTurnLog } from '../schemas/graph-state.js';
import type { IdentityProfile } from '../schemas/identity.js';
import type { AgentView } from '../schemas/events.js';
import type {
  NodeName,
  ExecutorOptions,
  ExecutionResult,
  NodeMetrics,
  ExecutionMetrics,
} from './types.js';

import { stateManagerNode } from '../nodes/state-manager.node.js';
import { plannerNode } from '../nodes/planner.node.js';
import { draftNode, repairNode, type TokenUsage } from '../nodes/generator.node.js';
import { supervisorNode } from '../nodes/supervisor.node.js';
import * as stateStore from '../stores/state.store.js';
import * as tokenTracker from '../services/token-tracker.service.js';
import * as hintInjection from '../services/hint-injection.service.js';
import * as selfCorrection from '../services/self-correction.service.js';
import * as critiqueQueue from '../services/critique-queue.service.js';
import { activityHelpers } from '../../activity/activity.service.js';
import logger from '../../utils/logger.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Execute the graph loop
 */
export async function executeGraph(
  input: GraphStateInput,
  identity: IdentityProfile,
  agentView: AgentView,
  userId: string,
  options: ExecutorOptions = {}
): Promise<ExecutionResult> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fastPath = true, // Default to fast path for sub-5s responses
    onNodeStart,
    onNodeEnd,
    onError,
  } = options;

  const startTime = Date.now();
  const nodesExecuted: NodeName[] = [];
  const nodeMetrics: NodeMetrics[] = [];

  // Load hints and corrections BEFORE execution (fast path feature)
  let injectedHints: string | null = null;
  let correctionPrompt: string | null = null;
  let correctionIds: string[] = [];

  if (fastPath) {
    try {
      // Load in parallel for speed
      const [hints, corrections] = await Promise.all([
        hintInjection.getActiveHints(input.session_id, userId),
        selfCorrection.getFormattedCorrectionPrompt(input.session_id),
      ]);

      injectedHints = hintInjection.formatHintsForPrompt(hints);
      correctionPrompt = corrections.prompt;
      correctionIds = corrections.correctionIds;

      // Mark corrections as processed upfront (they'll be used in this response)
      if (correctionIds.length > 0) {
        await selfCorrection.markCorrectionsProcessed(correctionIds);
      }
    } catch (err) {
      logger.warn('Failed to load hints/corrections, continuing without', {
        error: (err as Error).message,
      });
    }
  }

  // Initialize state with hints
  let state = createInitialState(input, identity, agentView, {
    injectedHints,
    correctionPrompt,
  });

  // Create token tracker for this turn
  const tracker = tokenTracker.createTurnTracker(
    state.turn_id,
    state.session_id,
    userId
  );

  logger.info('Graph execution started', {
    sessionId: state.session_id,
    turnId: state.turn_id,
    mode: state.mode,
  });

  // Timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Graph execution timeout')), timeoutMs);
  });

  try {
    // Main execution loop
    while (true) {
      const nextNode = getNextNode(state);

      // Check termination
      if (nextNode === 'end') {
        break;
      }

      // Check max attempts (nextNode is already confirmed not 'end' at this point)
      if (state.attempts >= maxAttempts) {
        logger.warn('Max attempts reached, forcing termination', {
          sessionId: state.session_id,
          attempts: state.attempts,
        });
        // Use last draft as final output
        state.final_output = state.draft;
        break;
      }

      // Execute node with timeout
      const nodeStart = Date.now();
      onNodeStart?.(nextNode, state);
      nodesExecuted.push(nextNode);

      try {
        const result = await Promise.race([
          executeNode(nextNode, state, userId),
          timeoutPromise,
        ]);

        state = result.state;
        const duration = Date.now() - nodeStart;
        nodeMetrics.push({ node: nextNode, durationMs: duration, success: true });
        onNodeEnd?.(nextNode, state, duration);

        // Track token usage if present
        if (result.tokenUsage) {
          await tokenTracker.trackLLMCall(
            tracker,
            nextNode,
            result.tokenUsage.provider,
            result.tokenUsage.model,
            result.tokenUsage.inputTokens,
            result.tokenUsage.outputTokens,
            {
              cacheTokens: result.tokenUsage.cacheTokens,
              durationMs: duration,
            }
          );

          // Log activity for the LLM call
          await activityHelpers.logLLMCall(
            userId,
            state.session_id,
            state.turn_id,
            nextNode,
            result.tokenUsage.model,
            result.tokenUsage.provider,
            {
              input: result.tokenUsage.inputTokens,
              output: result.tokenUsage.outputTokens,
              cache: result.tokenUsage.cacheTokens,
            },
            duration,
            tokenTracker.calculateCost(
              result.tokenUsage.model,
              result.tokenUsage.inputTokens,
              result.tokenUsage.outputTokens
            )
          ).catch(() => {}); // Non-blocking
        }

        // FAST PATH: After draft, skip critique and queue for background
        if (fastPath && nextNode === 'draft' && state.draft) {
          // Queue for background critique (non-blocking)
          critiqueQueue.queueForCritique({
            turnId: state.turn_id,
            sessionId: state.session_id,
            userId,
            userInput: state.user_input,
            draft: state.draft,
            plan: state.plan,
            mode: state.mode,
            identityId: identity.id,
            identityVersion: identity.version,
          }).catch((err) => {
            logger.warn('Failed to queue background critique', {
              error: (err as Error).message,
              turnId: state.turn_id,
            });
          });

          // Use draft as final output, skip critique loop
          state.final_output = state.draft;
          logger.info('Fast path: skipping critique, queued for background', {
            sessionId: state.session_id,
            turnId: state.turn_id,
            draftLength: state.draft.length,
          });
          break;
        }

      } catch (error) {
        const duration = Date.now() - nodeStart;
        nodeMetrics.push({
          node: nextNode,
          durationMs: duration,
          success: false,
          error: (error as Error).message,
        });

        onError?.(nextNode, error as Error, state);

        // If critical node fails, try to recover
        if (nextNode === 'plan' || nextNode === 'draft') {
          logger.error('Critical node failed, using fallback', {
            node: nextNode,
            error: (error as Error).message,
          });
          // Set a basic fallback response
          state.final_output = "I'm sorry, I encountered an issue processing your request. Could you please try again?";
          break;
        }

        // For supervisor/repair failures, use current draft
        if (nextNode === 'critique' || nextNode === 'repair') {
          state.final_output = state.draft;
          break;
        }

        throw error;
      }
    }

    const totalDurationMs = Date.now() - startTime;

    // Finalize token tracking (update turn summary with aggregated stats)
    await tokenTracker.finalizeTurnTracking(tracker);

    // Log turn for observability
    const turnLog = stateToTurnLog(state);
    await stateStore.logTurn(turnLog);

    logger.info('Graph execution completed', {
      sessionId: state.session_id,
      turnId: state.turn_id,
      success: !!state.final_output,
      attempts: state.attempts,
      durationMs: totalDurationMs,
      nodesExecuted: nodesExecuted.length,
    });

    return {
      success: !!state.final_output,
      state,
      output: state.final_output,
      nodesExecuted,
      totalDurationMs,
    };

  } catch (error) {
    const totalDurationMs = Date.now() - startTime;

    logger.error('Graph execution failed', {
      sessionId: state.session_id,
      error: (error as Error).message,
      nodesExecuted,
      durationMs: totalDurationMs,
    });

    // Finalize token tracking even on error
    await tokenTracker.finalizeTurnTracking(tracker).catch(() => {});

    // Still log the turn (as failed)
    state.final_output = state.draft || "I'm sorry, something went wrong. Please try again.";
    const turnLog = stateToTurnLog(state);
    await stateStore.logTurn(turnLog).catch(() => {});

    return {
      success: false,
      state,
      output: state.final_output,
      nodesExecuted,
      totalDurationMs,
      error: error as Error,
    };
  }
}

interface NodeResult {
  state: GraphState;
  tokenUsage?: TokenUsage;
}

/**
 * Execute a single node
 */
async function executeNode(
  node: NodeName,
  state: GraphState,
  userId: string
): Promise<NodeResult> {
  logger.debug('Executing node', { node, sessionId: state.session_id });

  switch (node) {
    case 'state_manager': {
      const result = await stateManagerNode({ state, userId });
      return { state: result.state };
    }

    case 'plan': {
      const result = await plannerNode({ state, userId });
      return { state: result.state, tokenUsage: result.tokenUsage };
    }

    case 'draft': {
      const result = await draftNode({ state, userId });
      return { state: result.state, tokenUsage: result.tokenUsage };
    }

    case 'critique': {
      const result = await supervisorNode({ state });
      return { state: result.state, tokenUsage: result.tokenUsage };
    }

    case 'repair': {
      const result = await repairNode({ state, userId });
      return { state: result.state, tokenUsage: result.tokenUsage };
    }

    case 'end':
      return { state };

    default:
      throw new Error(`Unknown node: ${node}`);
  }
}

/**
 * Get execution metrics
 */
export function getExecutionMetrics(
  result: ExecutionResult
): ExecutionMetrics {
  return {
    sessionId: result.state.session_id,
    turnId: result.state.turn_id,
    identityId: result.state.identity.id,
    identityVersion: result.state.identity.version,
    nodes: [], // Would need to track internally
    totalDurationMs: result.totalDurationMs,
    attempts: result.state.attempts,
    critiquePassed: result.state.critique_issues.length === 0,
    critiqueIssues: result.state.critique_issues,
  };
}

/**
 * Simple execution without options (convenience wrapper)
 */
export async function execute(
  input: GraphStateInput,
  identity: IdentityProfile,
  agentView: AgentView,
  userId: string
): Promise<string | null> {
  const result = await executeGraph(input, identity, agentView, userId);
  return result.output;
}

export default {
  executeGraph,
  execute,
  getExecutionMetrics,
};
