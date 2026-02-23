/**
 * Graph State Schema - Orchestration Types
 *
 * Defines the state passed through the LangGraph-style
 * execution loop and the supervisor verdict format.
 */

import { z } from 'zod';
import type { IdentityProfile } from './identity.js';
import type { AgentView } from './events.js';

// Graph state passed between nodes
export const GraphStateSchema = z.object({
  // Input
  session_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  user_input: z.string(),
  mode: z.enum(['assistant', 'companion', 'voice', 'dj_luna', 'ceo_luna']),

  // Identity (loaded once per session)
  identity: z.custom<IdentityProfile>(),

  // Computed state from events
  agent_view: z.custom<AgentView>(),

  // Retrieved context
  relevant_memories: z.array(z.string()),

  // Generated content
  plan: z.string().nullable(),
  draft: z.string().nullable(),

  // Critique loop state
  critique_issues: z.array(z.string()),
  attempts: z.number().int().nonnegative(),

  // Final output
  final_output: z.string().nullable(),

  // Timing
  started_at: z.date(),

  // Fast path - hint injection and self-correction
  injected_hints: z.string().nullable().optional(),
  correction_prompt: z.string().nullable().optional(),
});
export type GraphState = z.infer<typeof GraphStateSchema>;

// Initial graph state (before processing)
export const GraphStateInputSchema = z.object({
  session_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  user_input: z.string(),
  mode: z.enum(['assistant', 'companion', 'voice', 'dj_luna', 'ceo_luna']),
});
export type GraphStateInput = z.infer<typeof GraphStateInputSchema>;

// Supervisor verdict from critique node
export const SupervisorVerdictSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
  fix_instructions: z.string(),
});
export type SupervisorVerdict = z.infer<typeof SupervisorVerdictSchema>;

// Turn log entry for observability
export const AgentTurnLogSchema = z.object({
  turn_id: z.string().uuid(),
  session_id: z.string().uuid(),
  identity_id: z.string(),
  identity_version: z.number().int(),
  user_input: z.string(),
  plan: z.string().nullable(),
  draft: z.string().nullable(),
  final_output: z.string().nullable(),
  critique_passed: z.boolean(),
  critique_issues: z.array(z.string()),
  attempts: z.number().int(),
  execution_time_ms: z.number().int().optional(),
});
export type AgentTurnLog = z.infer<typeof AgentTurnLogSchema>;

// Database row type for agent_turns table
export interface AgentTurnRow {
  turn_id: string;
  session_id: string;
  identity_id: string;
  identity_version: number;
  user_input: string;
  plan: string | null;
  draft: string | null;
  final_output: string | null;
  critique_passed: boolean;
  critique_issues: string[] | null;
  attempts: number;
  execution_time_ms: number | null;
  created_at: Date;
}

/**
 * Create initial graph state from input
 */
export function createInitialState(
  input: GraphStateInput,
  identity: IdentityProfile,
  agentView: AgentView,
  options?: { injectedHints?: string | null; correctionPrompt?: string | null }
): GraphState {
  return {
    session_id: input.session_id,
    turn_id: input.turn_id,
    user_input: input.user_input,
    mode: input.mode,
    identity,
    agent_view: agentView,
    relevant_memories: [],
    plan: null,
    draft: null,
    critique_issues: [],
    attempts: 0,
    final_output: null,
    started_at: new Date(),
    injected_hints: options?.injectedHints ?? null,
    correction_prompt: options?.correctionPrompt ?? null,
  };
}

/**
 * Check if graph execution should terminate
 */
export function shouldTerminate(state: GraphState, maxAttempts: number = 3): boolean {
  // Terminate if we have final output
  if (state.final_output !== null) {
    return true;
  }

  // Terminate if max attempts reached (failsafe)
  if (state.attempts >= maxAttempts) {
    return true;
  }

  return false;
}

/**
 * Determine next node based on current state
 */
export function getNextNode(state: GraphState): 'plan' | 'draft' | 'critique' | 'repair' | 'end' {
  // Already have final output - done
  if (state.final_output !== null) {
    return 'end';
  }

  // No plan yet - go to planner
  if (state.plan === null) {
    return 'plan';
  }

  // No draft yet - go to generator
  if (state.draft === null) {
    return 'draft';
  }

  // Max attempts reached - done (failsafe, use last draft)
  if (state.attempts >= 3) {
    return 'end';
  }

  // Have issues from previous critique - go to repair
  if (state.critique_issues.length > 0) {
    return 'repair';
  }

  // Have draft with no issues - needs critique
  // This handles both: first draft (attempts=0) and post-repair (issues cleared by repair)
  return 'critique';
}

/**
 * Convert graph state to turn log entry
 */
export function stateToTurnLog(state: GraphState): AgentTurnLog {
  const executionTimeMs = Date.now() - state.started_at.getTime();

  return {
    turn_id: state.turn_id,
    session_id: state.session_id,
    identity_id: state.identity.id,
    identity_version: state.identity.version,
    user_input: state.user_input,
    plan: state.plan,
    draft: state.draft,
    final_output: state.final_output,
    critique_passed: state.critique_issues.length === 0,
    critique_issues: state.critique_issues,
    attempts: state.attempts,
    execution_time_ms: executionTimeMs,
  };
}

export default {
  GraphStateSchema,
  GraphStateInputSchema,
  SupervisorVerdictSchema,
  AgentTurnLogSchema,
  createInitialState,
  shouldTerminate,
  getNextNode,
  stateToTurnLog,
};
