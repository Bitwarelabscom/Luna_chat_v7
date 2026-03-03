/**
 * Agent Registry - Prompt Builder
 *
 * Unified prompt construction for all agents.
 * Replaces the per-mode getBasePrompt() pattern with registry-driven logic.
 */

import type { AgentDefinition } from './types.js';
import { resolveBasePrompt } from './base-prompts.js';

/**
 * Build the static system prompt for an agent.
 * This produces the base prompt (tier 1 in cache hierarchy).
 *
 * For chat_mode agents with cache_tier_enabled, the caller should
 * use buildContextualPrompt() from luna.persona.ts for full 4-tier caching,
 * passing the result of this function as the basePrompt parameter.
 *
 * For other agents (specialists, friends, departments), this produces the
 * complete static prompt.
 */
export function buildAgentPrompt(agent: AgentDefinition): string {
  if (agent.promptComposable && agent.basePromptId) {
    const base = resolveBasePrompt(agent.basePromptId);
    if (base) {
      return `${base}\n\n${agent.promptTemplate}`;
    }
  }
  return agent.promptTemplate;
}

/**
 * Build a simple prompt with datetime appended.
 * Used for non-cached agents (specialists, friends, departments, summoned agents).
 */
export function buildSimplePrompt(agent: AgentDefinition, context?: string): string {
  let prompt = buildAgentPrompt(agent);

  if (context) {
    prompt += `\n\n${context}`;
  }

  // Add current datetime
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Stockholm',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Stockholm',
  });

  prompt += `\n\nCurrent date and time: ${dateStr} at ${timeStr} (CET+1)`;

  return prompt;
}
