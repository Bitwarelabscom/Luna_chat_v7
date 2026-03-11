/**
 * Core agentic loop - plan/act/observe iteration engine.
 *
 * Calls the LLM, executes any tool calls, feeds results back, and repeats
 * until the LLM generates a final response (no tool calls) or a limit is hit.
 */

import {
  createChatCompletion,
  type ChatMessage,
} from '../llm/openai.client.js';
import { executeTool } from './tool-executor.js';
import { estimateCost } from './cost-tracker.js';
import type {
  AgentLoopConfig,
  AgentLoopState,
  AgentLoopEvent,
  ToolExecutionContext,
} from './types.js';
import logger from '../utils/logger.js';

// Default context window sizes by model family (in tokens)
const DEFAULT_CONTEXT_LIMIT = 128_000;

/**
 * Rough token estimate: ~4 chars per token on average.
 */
function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    }
    // Count tool call arguments too
    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as Array<{ function: { arguments: string } }> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        chars += tc.function.arguments?.length || 0;
      }
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Compress older tool results into a summary to free up context space.
 * Keeps the system message, original user message, and recent messages intact.
 * Compresses older tool results in the middle.
 */
function compressOlderToolResults(messages: ChatMessage[]): ChatMessage[] {
  // Keep first 2 messages (system + user) and last 8 messages intact
  const keepStart = 2;
  const keepEnd = 8;

  if (messages.length <= keepStart + keepEnd) return messages;

  const head = messages.slice(0, keepStart);
  const tail = messages.slice(-keepEnd);
  const middle = messages.slice(keepStart, -keepEnd);

  // Summarize middle section
  const toolResults: string[] = [];
  for (const msg of middle) {
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      toolResults.push(msg.content.substring(0, 150));
    }
  }

  const summary: ChatMessage = {
    role: 'system',
    content: `[Context compressed - ${middle.length} earlier messages summarized]\n` +
      `Tools used: ${middle.filter(m => m.role === 'assistant').length} steps.\n` +
      `Key results: ${toolResults.slice(0, 5).join(' | ')}`,
  } as ChatMessage;

  return [...head, summary, ...tail];
}

/**
 * Run the agentic loop. Yields events as the loop progresses.
 *
 * The LLM decides when to stop by generating content instead of tool calls.
 * If limits are hit (maxSteps or maxCostUsd), one final LLM call is made
 * without tools to force a summary response.
 */
export async function* runAgentLoop(
  initialMessages: ChatMessage[],
  config: AgentLoopConfig,
  toolContext: ToolExecutionContext
): AsyncGenerator<AgentLoopEvent> {
  const state: AgentLoopState = {
    messages: [...initialMessages],
    stepCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: 0,
    toolsUsed: [],
  };

  const providerStr = config.provider || 'xai';
  const contextLimit = config.maxContextTokens || DEFAULT_CONTEXT_LIMIT;

  // Loop breaker tracking
  let consecutiveEmptyResults = 0;
  let lastToolCallSignature = '';

  while (true) {
    // --- Context overflow check ---
    const estimatedTokenCount = estimateTokens(state.messages);
    if (estimatedTokenCount > contextLimit * 0.8) {
      logger.warn('Agent loop compressing context', {
        estimatedTokens: estimatedTokenCount,
        contextLimit,
        messageCount: state.messages.length,
      });
      state.messages = compressOlderToolResults(state.messages);
    }

    // --- Call LLM ---
    const isFirstCall = state.stepCount === 0;
    const completion = await createChatCompletion({
      messages: state.messages,
      tools: config.tools.length > 0 ? config.tools : undefined,
      provider: config.provider,
      model: config.model,
      thinkingMode: config.thinkingMode,
      loggingContext: config.loggingContext ? {
        ...config.loggingContext,
        nodeName: isFirstCall
          ? config.loggingContext.nodeName
          : `${config.loggingContext.nodeName}_step_${state.stepCount}`,
      } : undefined,
    });

    // Track tokens and cost
    state.totalInputTokens += completion.promptTokens || 0;
    state.totalOutputTokens += completion.completionTokens || 0;
    state.estimatedCostUsd = estimateCost(
      providerStr, config.model,
      state.totalInputTokens, state.totalOutputTokens
    );

    // Yield reasoning if present
    if (completion.reasoning) {
      yield { type: 'thinking', content: completion.reasoning };
    }

    // --- No tool calls? Stream final content and exit ---
    if (!completion.toolCalls || completion.toolCalls.length === 0) {
      const finalContent = completion.content || '';
      // Stream in chunks for smooth display
      const chunkSize = 20;
      for (let i = 0; i < finalContent.length; i += chunkSize) {
        yield { type: 'content', content: finalContent.slice(i, i + chunkSize) };
      }
      yield { type: 'done', state };
      return;
    }

    // --- Tool calls present - execute them ---
    state.stepCount++;

    const toolNames = completion.toolCalls.map(tc => tc.function.name);
    state.toolsUsed.push(...toolNames);

    logger.info('Agent loop step', {
      step: state.stepCount,
      toolCalls: toolNames,
      costUsd: state.estimatedCostUsd.toFixed(4),
    });

    // --- Loop breaker: detect stuck patterns ---
    const currentSignature = completion.toolCalls
      .map(tc => `${tc.function.name}:${tc.function.arguments}`)
      .join('|');

    if (currentSignature === lastToolCallSignature) {
      logger.warn('Agent loop detected repeated tool call pattern, forcing exit', {
        step: state.stepCount,
        tools: toolNames,
      });
      yield { type: 'limit_hit', reason: 'max_steps', state };
      yield* emitFinalSummary(state, config);
      return;
    }
    lastToolCallSignature = currentSignature;

    // Add assistant message with tool_calls to conversation
    state.messages.push({
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls,
    } as ChatMessage);

    // Build recent context for summon_agent calls
    const recentContext = state.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 300) : ''}`)
      .join('\n');

    // Execute each tool call
    let hasNonEmptyResult = false;
    for (const toolCall of completion.toolCalls) {
      yield { type: 'tool_start', tool: toolCall.function.name, args: toolCall.function.arguments };

      // Inject recentContext for summon_agent
      if (toolCall.function.name === 'summon_agent') {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          parsed._recentContext = recentContext;
          toolCall.function.arguments = JSON.stringify(parsed);
        } catch { /* ignore parse errors */ }
      }

      const result = await executeTool(toolCall, toolContext);

      // Yield side effects (browser actions, video actions, etc.)
      for (const effect of result.sideEffects) {
        yield { type: 'side_effect', event: effect };
      }

      // Add tool result to conversation
      state.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.toolResponse,
      } as ChatMessage);

      if (result.toolResponse && result.toolResponse.length > 10) {
        hasNonEmptyResult = true;
      }

      yield { type: 'tool_result', tool: toolCall.function.name, result: result.toolResponse.substring(0, 200) };
    }

    // --- Loop breaker: consecutive empty results ---
    if (!hasNonEmptyResult) {
      consecutiveEmptyResults++;
      if (consecutiveEmptyResults >= 3) {
        logger.warn('Agent loop hit 3 consecutive empty results, forcing exit', {
          step: state.stepCount,
        });
        yield { type: 'limit_hit', reason: 'max_steps', state };
        yield* emitFinalSummary(state, config);
        return;
      }
    } else {
      consecutiveEmptyResults = 0;
    }

    // --- Check limits ---
    if (state.stepCount >= config.maxSteps) {
      logger.warn('Agent loop hit max steps', { steps: state.stepCount, maxSteps: config.maxSteps });
      yield { type: 'limit_hit', reason: 'max_steps', state };

      // Final call without tools to get a summary
      yield* emitFinalSummary(state, config);
      return;
    }

    if (state.estimatedCostUsd >= config.maxCostUsd) {
      logger.warn('Agent loop hit cost limit', { costUsd: state.estimatedCostUsd, maxCostUsd: config.maxCostUsd });
      yield { type: 'limit_hit', reason: 'max_cost', state };

      yield* emitFinalSummary(state, config);
      return;
    }

    // Loop back to step 1 (next LLM call)
  }
}

/**
 * Make one final LLM call WITHOUT tools to force a text summary.
 */
async function* emitFinalSummary(
  state: AgentLoopState,
  config: AgentLoopConfig,
): AsyncGenerator<AgentLoopEvent> {
  try {
    // Add a system hint that we're at the limit
    state.messages.push({
      role: 'system',
      content: 'You have reached the tool call limit for this response. Please synthesize all the information gathered so far into a final response for the user. Do not request any more tool calls.',
    } as ChatMessage);

    const summary = await createChatCompletion({
      messages: state.messages,
      // No tools - forces text response
      provider: config.provider,
      model: config.model,
      loggingContext: config.loggingContext ? {
        ...config.loggingContext,
        nodeName: `${config.loggingContext.nodeName}_summary`,
      } : undefined,
    });

    state.totalInputTokens += summary.promptTokens || 0;
    state.totalOutputTokens += summary.completionTokens || 0;

    const content = summary.content || '';
    const chunkSize = 20;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield { type: 'content', content: content.slice(i, i + chunkSize) };
    }
  } catch (error) {
    logger.error('Failed to generate final summary', { error: (error as Error).message });
    yield { type: 'content', content: 'I reached the tool call limit and was unable to generate a final summary. Here is what I found so far based on the tools I used.' };
  }

  yield { type: 'done', state };
}
