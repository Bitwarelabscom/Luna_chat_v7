/**
 * Agent Registry - Inter-Agent Communication
 *
 * Implements the summon protocol: any agent can summon another agent
 * to get a specialist response. Summoned agents always use Ollama
 * (lightweight, fast, local) to keep costs down.
 */

import { createCompletion } from '../llm/router.js';
import type { ProviderId } from '../llm/types.js';
import type { ChatMessage } from '../llm/types.js';
import type { SummonRequest, SummonResult } from './types.js';
import { getAgent } from './registry.js';
import { buildSimplePrompt } from './prompt-builder.js';
import logger from '../utils/logger.js';

// Default provider for summoned agents (fast, local, cheap)
const DEFAULT_SUMMON_PROVIDER: ProviderId = 'ollama';
const DEFAULT_SUMMON_MODEL = 'qwen2.5:7b';

/**
 * Summon another agent to respond to a question or task.
 *
 * Flow:
 * 1. Look up target agent from registry
 * 2. Verify permissions (can_be_summoned, source can_summon target's category)
 * 3. Build prompt for summoned agent
 * 4. Call LLM with summoned agent's prompt + conversation context
 * 5. Return the response
 */
export async function summonAgent(request: SummonRequest): Promise<SummonResult> {
  const { fromAgentId, toAgentId, reason, conversationContext, sessionId, userId } = request;

  // Look up both agents
  const sourceAgent = getAgent(fromAgentId);
  const targetAgent = getAgent(toAgentId);

  if (!targetAgent) {
    return {
      agentId: toAgentId,
      agentName: toAgentId,
      response: `Agent "${toAgentId}" not found in the registry.`,
      tokensUsed: 0,
    };
  }

  if (!targetAgent.canBeSummoned) {
    return {
      agentId: toAgentId,
      agentName: targetAgent.name,
      response: `${targetAgent.name} cannot be summoned.`,
      tokensUsed: 0,
    };
  }

  // Verify source can summon target's category
  if (sourceAgent && !sourceAgent.canSummon.includes(targetAgent.category)) {
    return {
      agentId: toAgentId,
      agentName: targetAgent.name,
      response: `You don't have permission to summon ${targetAgent.name} (category: ${targetAgent.category}).`,
      tokensUsed: 0,
    };
  }

  // Determine provider/model for the summoned agent
  let provider: ProviderId = DEFAULT_SUMMON_PROVIDER;
  let model = DEFAULT_SUMMON_MODEL;

  if (targetAgent.summonProvider) {
    if (targetAgent.summonProvider.type === 'fixed') {
      provider = targetAgent.summonProvider.provider as ProviderId;
      model = targetAgent.summonProvider.model;
    }
    // 'user_config' and 'inherit' fall through to defaults for summoning
  }

  // Build the summoned agent's prompt with context
  const contextBlock = `[Summoning Context]\nYou have been summoned by ${sourceAgent?.name || fromAgentId} to help with: ${reason}\n\nRecent conversation context:\n${conversationContext}\n\nRespond concisely and directly to the request. Keep your response focused and under 500 words.`;

  const systemPrompt = buildSimplePrompt(targetAgent, contextBlock);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: reason },
  ];

  try {
    logger.info('Summoning agent', {
      from: fromAgentId,
      to: toAgentId,
      reason: reason.slice(0, 100),
      provider,
      model,
      sessionId,
      userId,
    });

    const result = await createCompletion(provider, model, messages, {
      temperature: targetAgent.temperature,
      maxTokens: targetAgent.maxResponseTokens || 1024,
    });

    logger.info('Agent summoned successfully', {
      from: fromAgentId,
      to: toAgentId,
      tokensUsed: result.tokensUsed,
    });

    return {
      agentId: toAgentId,
      agentName: targetAgent.name,
      response: result.content,
      tokensUsed: result.tokensUsed,
    };
  } catch (error) {
    logger.error('Failed to summon agent', {
      from: fromAgentId,
      to: toAgentId,
      error: (error as Error).message,
    });

    return {
      agentId: toAgentId,
      agentName: targetAgent.name,
      response: `Failed to reach ${targetAgent.name}: ${(error as Error).message}`,
      tokensUsed: 0,
    };
  }
}
