/**
 * Graph Types - Node and Edge Contracts
 *
 * Defines the type contracts for graph nodes and edges.
 */

import type { GraphState } from '../schemas/graph-state.js';
import type { SupervisorVerdict } from '../schemas/graph-state.js';

/**
 * Node names in the graph
 */
export type NodeName = 'state_manager' | 'plan' | 'draft' | 'critique' | 'repair' | 'end';

/**
 * Generic node function type
 */
export type NodeFunction<TInput = unknown, TOutput = unknown> = (
  input: TInput
) => Promise<TOutput>;

/**
 * Node result with updated state
 */
export interface NodeResult {
  state: GraphState;
  nextNode?: NodeName;
  error?: Error;
}

/**
 * Supervisor node result includes verdict
 */
export interface SupervisorNodeResult extends NodeResult {
  verdict: SupervisorVerdict;
}

/**
 * Edge function determines next node
 */
export type EdgeFunction = (state: GraphState) => NodeName;

/**
 * Graph execution options
 */
export interface ExecutorOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  /** Fast path: skip critique loop, queue for background processing (default: true) */
  fastPath?: boolean;
  onNodeStart?: (node: NodeName, state: GraphState) => void;
  onNodeEnd?: (node: NodeName, state: GraphState, durationMs: number) => void;
  onError?: (node: NodeName, error: Error, state: GraphState) => void;
}

/**
 * Graph execution result
 */
export interface ExecutionResult {
  success: boolean;
  state: GraphState;
  output: string | null;
  nodesExecuted: NodeName[];
  totalDurationMs: number;
  error?: Error;
}

/**
 * Node execution metrics
 */
export interface NodeMetrics {
  node: NodeName;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Full execution metrics
 */
export interface ExecutionMetrics {
  sessionId: string;
  turnId: string;
  identityId: string;
  identityVersion: number;
  nodes: NodeMetrics[];
  totalDurationMs: number;
  attempts: number;
  critiquePassed: boolean;
  critiqueIssues: string[];
}

export default {
  // Type exports only - no values
};
