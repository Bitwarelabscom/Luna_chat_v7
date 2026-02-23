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
import { renderNormsForPrompt, renderStyleForPrompt, renderSharedSpineForPrompt, renderModeForPrompt } from '../schemas/identity.js';
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

CRITICAL RULES:
- NEVER plan responses that sound like a chatbot or service agent
- NEVER include steps like "offer to assist" or "ask how you can help"
- For casual greetings/smalltalk: plan 1-2 steps MAX, keep it natural and human
- For complex requests: plan 3-6 steps

Create a plan that is:
- Concrete and actionable
- Focused on what to include in the response
- Considerate of the user's current state and context
- Natural and conversational, not robotic

Output ONLY the plan as a bulleted list. No preamble, no explanation.

Example for complex request:
- Acknowledge the user's frustration briefly
- Explain the root cause
- Provide 2-3 specific solutions

Example for casual greeting ("hello", "hey", "how are you"):
- Respond casually like a friend would
(That's it - one step. Don't overcomplicate greetings.)`;

/**
 * Build the planner prompt with context
 */
function buildPlannerPrompt(state: GraphState): string {
  const parts: string[] = [];

  // Current mode - IMPORTANT for planning style
  parts.push(`[Current Mode: ${state.mode.toUpperCase()}]`);

  // Shared spine - critical rules that apply to ALL responses
  const spine = renderSharedSpineForPrompt(state.identity);
  if (spine) {
    parts.push(`[Core Rules - MUST Follow]\n${spine}`);
  }

  // Mode-specific guidelines
  const modeGuidelines = renderModeForPrompt(state.identity, state.mode);
  if (modeGuidelines) {
    parts.push(`[Mode Guidelines]\n${modeGuidelines}`);
  }

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

  // Task - adapt based on message complexity
  const isSimpleGreeting = /^(hi|hello|hey|hej|morning|afternoon|evening|yo|sup|how are you|what's up|whats up)\s*[!?.]*$/i.test(state.user_input.trim());
  if (isSimpleGreeting && state.mode === 'companion') {
    parts.push(`[Task]\nThis is casual smalltalk. Plan 1 step: respond naturally like a friend. Keep it brief and human.`);
  } else {
    parts.push(`[Task]\nCreate a plan for responding. Use 1-2 steps for simple messages, 3-6 for complex ones.`);
  }

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
      {
        temperature: 0.3,
        maxTokens: 500,
        loggingContext: {
          userId,
          sessionId: state.session_id,
          turnId: state.turn_id,
          source: 'layered-agent',
          nodeName: 'planner',
        },
      }
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
