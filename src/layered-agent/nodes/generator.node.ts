/**
 * Generator Node
 *
 * Generates draft responses and repairs based on critique.
 * Two modes:
 * 1. Draft: Generate initial response from plan
 * 2. Repair: Fix draft based on critique issues
 */

import type { GraphState } from '../schemas/graph-state.js';
import {
  renderNormsForPrompt,
  renderStyleForPrompt,
  renderCapabilitiesForPrompt,
  renderSharedSpineForPrompt,
  renderModeForPrompt,
  renderGuardrailForPrompt,
} from '../schemas/identity.js';
import { renderViewForPrompt } from '../schemas/events.js';
import { createCompletion } from '../../llm/router.js';
import { getUserModelConfig } from '../../llm/model-config.service.js';
import logger from '../../utils/logger.js';

export interface GeneratorInput {
  state: GraphState;
  userId: string;
  mode: 'draft' | 'repair';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  model: string;
  provider: string;
}

export interface GeneratorOutput {
  state: GraphState;
  tokenUsage?: TokenUsage;
}

/**
 * Build draft generation prompt
 */
function buildDraftPrompt(state: GraphState): { system: string; user: string } {
  const systemParts: string[] = [];

  // Core identity
  systemParts.push(`You are ${state.identity.traits.name}, ${state.identity.traits.role}.`);
  systemParts.push(`Core traits: ${state.identity.traits.personality.join(', ')}`);

  // Shared spine - applies to ALL modes
  const spine = renderSharedSpineForPrompt(state.identity);
  if (spine) {
    systemParts.push(`\n[Shared Spine - Always Apply]\n${spine}`);
  }

  // Mode-specific guidelines (assistant/companion)
  const modeGuidelines = renderModeForPrompt(state.identity, state.mode);
  if (modeGuidelines) {
    systemParts.push(`\n[Current Mode]\n${modeGuidelines}`);
  }

  // Behavioral norms
  const norms = renderNormsForPrompt(state.identity);
  if (norms) {
    systemParts.push(`\n[Behavioral Rules]\n${norms}`);
  }

  // Style guidelines
  const style = renderStyleForPrompt(state.identity, state.mode);
  if (style) {
    systemParts.push(`\n[Style]\n${style}`);
  }

  // Guardrail for mode switching
  const guardrail = renderGuardrailForPrompt(state.identity);
  if (guardrail) {
    systemParts.push(`\n[Guardrail]\n${guardrail}`);
  }

  // Available capabilities/tools
  const capabilities = renderCapabilitiesForPrompt(state.identity);
  if (capabilities) {
    systemParts.push(`\n[Capabilities]\n${capabilities}`);
  }

  // Inject personality tuning hints (from background critique feedback)
  if (state.injected_hints) {
    systemParts.push(`\n${state.injected_hints}`);
  }

  const userParts: string[] = [];

  // Agent view
  const view = renderViewForPrompt(state.agent_view);
  if (view) {
    userParts.push(view);
  }

  // Relevant memories
  if (state.relevant_memories.length > 0) {
    userParts.push(`[Context]\n${state.relevant_memories.join('\n')}`);
  }

  // Plan
  if (state.plan) {
    userParts.push(`[Response Plan]\n${state.plan}`);
  }

  // Inject self-correction prompt if needed (from previous critique findings)
  if (state.correction_prompt) {
    userParts.push(state.correction_prompt);
  }

  // User input
  userParts.push(`[User Message]\n${state.user_input}`);

  userParts.push(`[Task]\nGenerate a response following the plan and behavioral rules.`);

  return {
    system: systemParts.join('\n'),
    user: userParts.join('\n\n'),
  };
}

/**
 * Build repair prompt
 */
function buildRepairPrompt(state: GraphState): { system: string; user: string } {
  const systemParts: string[] = [];

  // Core identity
  systemParts.push(`You are ${state.identity.traits.name}. You need to fix your previous response.`);

  // Behavioral norms (emphasized for repair)
  const norms = renderNormsForPrompt(state.identity);
  if (norms) {
    systemParts.push(`\n[CRITICAL - Follow These Rules]\n${norms}`);
  }

  // Style guidelines
  const style = renderStyleForPrompt(state.identity, state.mode);
  if (style) {
    systemParts.push(`\n[Style]\n${style}`);
  }

  const userParts: string[] = [];

  // Original plan
  if (state.plan) {
    userParts.push(`[Response Plan]\n${state.plan}`);
  }

  // Previous draft
  if (state.draft) {
    userParts.push(`[Previous Response (has issues)]\n${state.draft}`);
  }

  // Critique issues
  if (state.critique_issues.length > 0) {
    userParts.push(`[Issues to Fix]\n${state.critique_issues.map(i => `- ${i}`).join('\n')}`);
  }

  // User input
  userParts.push(`[Original User Message]\n${state.user_input}`);

  userParts.push(`[Task]\nRewrite the response to fix ALL the issues listed above. Output only the corrected response.`);

  return {
    system: systemParts.join('\n'),
    user: userParts.join('\n\n'),
  };
}

/**
 * Generator Node - Draft Mode
 *
 * Generates initial response from plan
 */
export async function draftNode(
  input: Omit<GeneratorInput, 'mode'>
): Promise<GeneratorOutput> {
  const { state, userId } = input;

  logger.debug('Draft node executing', {
    sessionId: state.session_id,
    turnId: state.turn_id,
    mode: state.mode,
    hasPlan: !!state.plan,
  });

  try {
    const modelConfig = await getUserModelConfig(userId, 'main_chat');
    const { system, user } = buildDraftPrompt(state);

    const response = await createCompletion(
      modelConfig.provider,
      modelConfig.model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        temperature: 0.7,
        maxTokens: state.mode === 'voice' ? 200 : 2000,
        loggingContext: {
          userId,
          sessionId: state.session_id,
          turnId: state.turn_id,
          source: 'layered-agent',
          nodeName: 'generator_draft',
        },
      }
    );

    const draft = response.content?.trim() || null;

    logger.debug('Draft node completed', {
      sessionId: state.session_id,
      draftLength: draft?.length || 0,
      tokens: response.tokensUsed,
    });

    return {
      state: {
        ...state,
        draft,
        // Note: Don't increment attempts here - only increment after repair cycles
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
    logger.error('Draft node failed', {
      sessionId: state.session_id,
      error: (error as Error).message,
    });

    // Return with error as draft for critique to catch
    return {
      state: {
        ...state,
        draft: `[Error generating response: ${(error as Error).message}]`,
        // Note: Don't increment attempts here - only increment after repair cycles
      },
    };
  }
}

/**
 * Generator Node - Repair Mode
 *
 * Fixes draft based on critique issues
 */
export async function repairNode(
  input: Omit<GeneratorInput, 'mode'>
): Promise<GeneratorOutput> {
  const { state, userId } = input;

  logger.debug('Repair node executing', {
    sessionId: state.session_id,
    turnId: state.turn_id,
    attempt: state.attempts,
    issueCount: state.critique_issues.length,
  });

  try {
    const modelConfig = await getUserModelConfig(userId, 'main_chat');
    const { system, user } = buildRepairPrompt(state);

    const response = await createCompletion(
      modelConfig.provider,
      modelConfig.model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        temperature: 0.5, // Lower temperature for repair
        maxTokens: state.mode === 'voice' ? 200 : 2000,
        loggingContext: {
          userId,
          sessionId: state.session_id,
          turnId: state.turn_id,
          source: 'layered-agent',
          nodeName: 'generator_repair',
        },
      }
    );

    const repairedDraft = response.content?.trim() || state.draft;

    logger.debug('Repair node completed', {
      sessionId: state.session_id,
      attempt: state.attempts + 1,
      draftLength: repairedDraft?.length || 0,
      tokens: response.tokensUsed,
    });

    return {
      state: {
        ...state,
        draft: repairedDraft,
        // Clear issues so getNextNode routes back to critique for the repaired draft
        critique_issues: [],
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
    logger.error('Repair node failed', {
      sessionId: state.session_id,
      error: (error as Error).message,
    });

    // Keep existing draft on error
    return {
      state: {
        ...state,
        attempts: state.attempts + 1,
      },
    };
  }
}

/**
 * Combined generator node dispatcher
 */
export async function generatorNode(
  input: GeneratorInput
): Promise<GeneratorOutput> {
  if (input.mode === 'repair') {
    return repairNode(input);
  }
  return draftNode(input);
}

export default {
  generatorNode,
  draftNode,
  repairNode,
  buildDraftPrompt,
  buildRepairPrompt,
};
