import type { ChatMessage, ChatCompletionOptions } from '../llm/openai.client.js';
import type OpenAI from 'openai';

/**
 * Context needed for tool execution - passed down from the chat service
 */
export interface ToolExecutionContext {
  userId: string;
  sessionId: string;
  mode: string;
  mcpUserTools: Array<{ serverId: string; name: string }>;
}

/**
 * Result from executing a single tool
 */
export interface ToolExecutionResult {
  /** Text result to put in the tool message back to the LLM */
  toolResponse: string;
  /** Side effects that must be yielded to the SSE stream */
  sideEffects: Array<Record<string, unknown>>;
}

/**
 * Configuration for an agent loop run
 */
export interface AgentLoopConfig {
  maxSteps: number;
  maxCostUsd: number;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  provider: ChatCompletionOptions['provider'];
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  thinkingMode?: boolean;
  loggingContext?: ChatCompletionOptions['loggingContext'];
}

/**
 * Accumulated state during an agent loop run
 */
export interface AgentLoopState {
  messages: ChatMessage[];
  stepCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  toolsUsed: string[];
}

/**
 * Events emitted by the agent loop
 */
export type AgentLoopEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; tool: string; args: string }
  | { type: 'tool_result'; tool: string; result: string }
  | { type: 'content'; content: string }
  | { type: 'done'; state: AgentLoopState }
  | { type: 'limit_hit'; reason: 'max_steps' | 'max_cost'; state: AgentLoopState }
  | { type: 'side_effect'; event: Record<string, unknown> };
