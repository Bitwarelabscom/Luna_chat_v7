/**
 * Token Tracker Service
 *
 * Tracks individual LLM calls within layered agent turns.
 * Provides cost calculation and aggregation for token usage.
 */

import { pool } from '../../db/index.js';
import logger from '../../utils/logger.js';

// ============================================
// Types
// ============================================

export interface LLMCallRecord {
  turnId: string;
  sessionId: string;
  userId: string;
  nodeName: string;  // plan, draft, critique, repair
  callSequence: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
}

export interface TurnTokenSummary {
  turnId: string;
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalTokens: number;
  totalCost: number;
  llmCallCount: number;
  callBreakdown: Array<{
    node: string;
    model: string;
    provider: string;
    input: number;
    output: number;
    cache: number;
    cost: number;
    duration: number | null;
    reasoning: number | null;
  }>;
  createdAt: Date;
}

export interface DailyTurnStats {
  day: Date;
  byNode: Record<string, {
    callCount: number;
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    totalCost: number;
    avgDuration: number;
  }>;
  totals: {
    callCount: number;
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    totalCost: number;
  };
}

// ============================================
// Model Costs (per 1K tokens)
// ============================================

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-5.1-chat-latest': { input: 0.00125, output: 0.01 },
  'gpt-5.1-codex': { input: 0.00125, output: 0.01 },
  'gpt-5-mini': { input: 0.00025, output: 0.002 },
  'gpt-5-nano': { input: 0.00005, output: 0.0004 },
  'gpt-4.1': { input: 0.002, output: 0.008 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'o3': { input: 0.002, output: 0.008 },
  'o4-mini': { input: 0.0011, output: 0.0044 },
  // Groq
  'llama-3.3-70b-versatile': { input: 0.00059, output: 0.00079 },
  'llama-3.1-8b-instant': { input: 0.00005, output: 0.00008 },
  // Anthropic
  'claude-opus-4-5-20251101': { input: 0.005, output: 0.025 },
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
  // xAI
  'grok-4-1-fast': { input: 0.0002, output: 0.0005 },
  'grok-4-1-fast-reasoning': { input: 0.0002, output: 0.0005 },
  'grok-4-1-fast-non-reasoning-latest': { input: 0.0002, output: 0.0005 },
  'grok-4': { input: 0.003, output: 0.015 },
  'grok-3': { input: 0.003, output: 0.015 },
  'grok-3-mini': { input: 0.0003, output: 0.0005 },
  // Google
  'gemini-2.5-pro-preview-06-05': { input: 0.00125, output: 0.01 },
  'gemini-2.5-flash-preview-05-20': { input: 0.0003, output: 0.0025 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
};

/**
 * Calculate cost for token usage
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model];
  if (!costs) return 0; // Free tier or unknown model
  return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
}

// ============================================
// Core Functions
// ============================================

/**
 * Log an LLM call within a turn
 */
export async function logLLMCall(record: LLMCallRecord): Promise<void> {
  const {
    turnId,
    sessionId,
    userId,
    nodeName,
    callSequence,
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheTokens = 0,
    reasoningTokens = 0,
    durationMs,
    success = true,
    errorMessage,
  } = record;

  const estimatedCost = calculateCost(model, inputTokens, outputTokens);

  try {
    await pool.query(
      `INSERT INTO turn_llm_calls (
        turn_id, session_id, user_id,
        node_name, call_sequence,
        provider, model,
        input_tokens, output_tokens, cache_tokens, reasoning_tokens,
        estimated_cost, duration_ms,
        success, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        turnId,
        sessionId,
        userId,
        nodeName,
        callSequence,
        provider,
        model,
        inputTokens,
        outputTokens,
        cacheTokens,
        reasoningTokens,
        estimatedCost,
        durationMs || null,
        success,
        errorMessage || null,
      ]
    );

    logger.debug('LLM call logged', {
      turnId,
      nodeName,
      model,
      tokens: inputTokens + outputTokens,
      cost: estimatedCost,
    });
  } catch (error) {
    logger.error('Failed to log LLM call', {
      error: (error as Error).message,
      turnId,
      nodeName,
    });
  }
}

/**
 * Update agent_turns with aggregated token stats
 */
export async function updateTurnSummary(turnId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE agent_turns
       SET
         total_input_tokens = COALESCE((SELECT SUM(input_tokens) FROM turn_llm_calls WHERE turn_id = $1), 0),
         total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM turn_llm_calls WHERE turn_id = $1), 0),
         total_cache_tokens = COALESCE((SELECT SUM(cache_tokens) FROM turn_llm_calls WHERE turn_id = $1), 0),
         total_tokens = COALESCE((SELECT SUM(input_tokens + output_tokens) FROM turn_llm_calls WHERE turn_id = $1), 0),
         total_cost = COALESCE((SELECT SUM(estimated_cost) FROM turn_llm_calls WHERE turn_id = $1), 0),
         llm_call_count = COALESCE((SELECT COUNT(*) FROM turn_llm_calls WHERE turn_id = $1), 0)
       WHERE turn_id = $1`,
      [turnId]
    );
  } catch (error) {
    logger.error('Failed to update turn summary', {
      error: (error as Error).message,
      turnId,
    });
  }
}

/**
 * Get token summary for a specific turn
 */
export async function getTurnSummary(turnId: string): Promise<TurnTokenSummary | null> {
  const result = await pool.query<{
    turn_id: string;
    session_id: string;
    created_at: Date;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_tokens: number;
    total_tokens: number;
    total_cost: number;
    llm_call_count: number;
    call_breakdown: unknown;
  }>(
    `SELECT * FROM turn_token_summary WHERE turn_id = $1`,
    [turnId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    turnId: row.turn_id,
    sessionId: row.session_id,
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    totalCacheTokens: Number(row.total_cache_tokens),
    totalTokens: Number(row.total_tokens),
    totalCost: Number(row.total_cost),
    llmCallCount: Number(row.llm_call_count),
    callBreakdown: row.call_breakdown as TurnTokenSummary['callBreakdown'],
    createdAt: row.created_at,
  };
}

/**
 * Get turn summaries for a session
 */
export async function getSessionTurnStats(
  sessionId: string,
  limit: number = 50
): Promise<TurnTokenSummary[]> {
  const result = await pool.query<{
    turn_id: string;
    session_id: string;
    created_at: Date;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_tokens: number;
    total_tokens: number;
    total_cost: number;
    llm_call_count: number;
    call_breakdown: unknown;
  }>(
    `SELECT * FROM turn_token_summary
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return result.rows.map(row => ({
    turnId: row.turn_id,
    sessionId: row.session_id,
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    totalCacheTokens: Number(row.total_cache_tokens),
    totalTokens: Number(row.total_tokens),
    totalCost: Number(row.total_cost),
    llmCallCount: Number(row.llm_call_count),
    callBreakdown: row.call_breakdown as TurnTokenSummary['callBreakdown'],
    createdAt: row.created_at,
  }));
}

/**
 * Get daily turn token stats for a user
 */
export async function getDailyTurnStats(userId: string): Promise<DailyTurnStats> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const result = await pool.query<{
    node_name: string;
    call_count: string;
    total_input: string;
    total_output: string;
    total_tokens: string;
    total_cost: string;
    avg_duration_ms: string;
  }>(
    `SELECT
       node_name,
       COUNT(*) as call_count,
       SUM(input_tokens) as total_input,
       SUM(output_tokens) as total_output,
       SUM(input_tokens + output_tokens) as total_tokens,
       SUM(estimated_cost) as total_cost,
       ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms
     FROM turn_llm_calls
     WHERE user_id = $1 AND created_at >= $2
     GROUP BY node_name`,
    [userId, startOfToday]
  );

  const byNode: DailyTurnStats['byNode'] = {};
  let totalCallCount = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const row of result.rows) {
    const callCount = parseInt(row.call_count, 10);
    const input = parseInt(row.total_input, 10);
    const output = parseInt(row.total_output, 10);
    const tokens = parseInt(row.total_tokens, 10);
    const cost = parseFloat(row.total_cost);

    byNode[row.node_name] = {
      callCount,
      totalInput: input,
      totalOutput: output,
      totalTokens: tokens,
      totalCost: cost,
      avgDuration: parseInt(row.avg_duration_ms, 10) || 0,
    };

    totalCallCount += callCount;
    totalInput += input;
    totalOutput += output;
    totalTokens += tokens;
    totalCost += cost;
  }

  return {
    day: startOfToday,
    byNode,
    totals: {
      callCount: totalCallCount,
      totalInput,
      totalOutput,
      totalTokens,
      totalCost: Math.round(totalCost * 10000) / 10000, // Round to 4 decimal places
    },
  };
}

// ============================================
// Turn Tracking Context (for executor)
// ============================================

export interface TurnTracker {
  turnId: string;
  sessionId: string;
  userId: string;
  callSequence: number;
}

/**
 * Create a new turn tracker
 */
export function createTurnTracker(
  turnId: string,
  sessionId: string,
  userId: string
): TurnTracker {
  return {
    turnId,
    sessionId,
    userId,
    callSequence: 0,
  };
}

/**
 * Log a call and increment sequence
 */
export async function trackLLMCall(
  tracker: TurnTracker,
  nodeName: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: {
    cacheTokens?: number;
    reasoningTokens?: number;
    durationMs?: number;
    success?: boolean;
    errorMessage?: string;
  } = {}
): Promise<void> {
  tracker.callSequence += 1;

  await logLLMCall({
    turnId: tracker.turnId,
    sessionId: tracker.sessionId,
    userId: tracker.userId,
    nodeName,
    callSequence: tracker.callSequence,
    provider,
    model,
    inputTokens,
    outputTokens,
    ...options,
  });
}

/**
 * Finalize turn tracking (update summary)
 */
export async function finalizeTurnTracking(tracker: TurnTracker): Promise<void> {
  await updateTurnSummary(tracker.turnId);
}

export default {
  calculateCost,
  logLLMCall,
  updateTurnSummary,
  getTurnSummary,
  getSessionTurnStats,
  getDailyTurnStats,
  createTurnTracker,
  trackLLMCall,
  finalizeTurnTracking,
};
