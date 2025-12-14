/**
 * Planner Node
 *
 * Generates a short plan (3-6 steps) based on:
 * - User input
 * - Current AgentView
 * - Relevant memories
 * - Identity norms
 */

import type { GraphState } from '../schemas/graph-state.js';
import { renderNormsForPrompt, renderStyleForPrompt } from '../schemas/identity.js';
import { renderViewForPrompt } from '../schemas/events.js';
import { createCompletion } from '../../llm/router.js';
import { getUserModelConfig } from '../../llm/model-config.service.js';
import logger from '../../utils/logger.js';

export interface PlannerInput {
  state: GraphState;
  userId: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  model: string;
  provider: string;
}

export interface PlannerOutput {
  state: GraphState;
  tokenUsage?: TokenUsage;
}

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant. Your job is to create a brief, actionable plan for responding to the user's message.

Create a plan with 3-6 clear steps. Each step should be:
- Concrete and actionable
- Focused on what to include in the response
- Considerate of the user's current state and context

Output ONLY the plan as a bulleted list. No preamble, no explanation.

Example:
- Acknowledge the user's frustration empathetically
- Explain the root cause of the issue briefly
- Provide 2-3 specific solutions they can try
- Offer to help further if needed`;

/**
 * Build the planner prompt with context
 */
function buildPlannerPrompt(state: GraphState): string {
  const parts: string[] = [];

  // Identity norms
  const norms = renderNormsForPrompt(state.identity);
  if (norms) {
    parts.push(`[Behavioral Guidelines]\n${norms}`);
  }

  // Style for mode
  const style = renderStyleForPrompt(state.identity, state.mode);
  if (style) {
    parts.push(`[Style Guidelines]\n${style}`);
  }

  // Agent view
  const view = renderViewForPrompt(state.agent_view);
  if (view) {
    parts.push(view);
  }

  // Relevant memories
  if (state.relevant_memories.length > 0) {
    parts.push(`[Retrieved Context]\n${state.relevant_memories.join('\n')}`);
  }

  // User input
  parts.push(`[User Message]\n${state.user_input}`);

  parts.push(`[Task]\nCreate a 3-6 step plan for responding to this message.`);

  return parts.join('\n\n');
}

/**
 * Planner Node
 *
 * Generates a plan for the response
 */
export async function plannerNode(
  input: PlannerInput
): Promise<PlannerOutput> {
  const { state, userId } = input;

  logger.debug('Planner node executing', {
    sessionId: state.session_id,
    turnId: state.turn_id,
    mode: state.mode,
  });

  try {
    // Get model config for planning (use main_chat or a dedicated planner model)
    const modelConfig = await getUserModelConfig(userId, 'main_chat');

    // Build planner prompt
    const userPrompt = buildPlannerPrompt(state);

    // Generate plan
    const response = await createCompletion(
      modelConfig.provider,
      modelConfig.model,
      [
        { role: 'system', content: PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.3, maxTokens: 500 }
    );

    const plan = response.content?.trim() || null;

    logger.debug('Planner node completed', {
      sessionId: state.session_id,
      planLength: plan?.length || 0,
      planLines: plan?.split('\n').length || 0,
      tokens: response.tokensUsed,
    });

    return {
      state: {
        ...state,
        plan,
      },
      tokenUsage: {
        inputTokens: response.inputTokens || 0,
        outputTokens: response.outputTokens || 0,
        cacheTokens: response.cacheTokens,
        model: response.model,
        provider: response.provider,
      },
    };
  } catch (error) {
    logger.error('Planner node failed', {
      sessionId: state.session_id,
      error: (error as Error).message,
    });

    // Generate a simple fallback plan
    const fallbackPlan = `- Understand the user's request
- Provide a helpful and appropriate response
- Maintain a ${state.mode === 'companion' ? 'warm and supportive' : 'professional'} tone`;

    return {
      state: {
        ...state,
        plan: fallbackPlan,
      },
    };
  }
}

export default {
  plannerNode,
  buildPlannerPrompt,
};
