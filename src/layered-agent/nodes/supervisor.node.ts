/**
 * Supervisor Node
 *
 * Critiques draft responses against identity compliance rubric.
 * Uses a cheap/fast model for efficiency.
 * Returns strict JSON verdict.
 */

import type { GraphState } from '../schemas/graph-state.js';
import { SupervisorVerdictSchema, type SupervisorVerdict } from '../schemas/graph-state.js';
import { renderRubricForPrompt, renderNormsForPrompt } from '../schemas/identity.js';
import { createCompletion } from '../../llm/router.js';
import logger from '../../utils/logger.js';

export interface SupervisorInput {
  state: GraphState;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  model: string;
  provider: string;
}

export interface SupervisorOutput {
  state: GraphState;
  verdict: SupervisorVerdict;
  tokenUsage?: TokenUsage;
}

const SUPERVISOR_SYSTEM_PROMPT = `You are a compliance checker for an AI assistant. Review responses for ACTUAL policy violations only.

IMPORTANT CLARIFICATIONS:
- "Using tools for smalltalk" means the response mentions calling APIs/tools for simple greetings. Normal text responses to informal requests are FINE.
- "Overly verbose responses to greetings" only applies if a greeting response is 3+ paragraphs. Brief friendly responses are FINE.
- A joke request is NOT smalltalk - it's a specific content request.
- Most responses should be APPROVED. Only flag clear, obvious violations.

Output ONLY valid JSON:
{"approved": true/false, "issues": ["issue1", "issue2"], "fix_instructions": "how to fix"}

Rules:
- Default to approved: true unless there's a clear violation
- If approved is true, issues should be empty array []
- If approved is false, issues must list ONLY actual violations found
- Output ONLY the JSON, no other text`;

/**
 * Build supervisor prompt
 */
function buildSupervisorPrompt(state: GraphState): string {
  const parts: string[] = [];

  // Behavioral norms
  const norms = renderNormsForPrompt(state.identity);
  if (norms) {
    parts.push(`[Behavioral Rules]\n${norms}`);
  }

  // Compliance rubric
  const rubric = renderRubricForPrompt(state.identity);
  if (rubric) {
    parts.push(`[Compliance Rubric]\n${rubric}`);
  }

  // User message for context
  parts.push(`[Original User Message]\n${state.user_input}`);

  // Draft to review
  parts.push(`[Draft Response to Review]\n${state.draft || '(no draft)'}`);

  parts.push(`[Task]\nReview the draft response for compliance violations. Output JSON verdict.`);

  return parts.join('\n\n');
}

/**
 * Parse supervisor response as JSON verdict
 */
function parseVerdict(response: string): SupervisorVerdict {
  try {
    // Extract JSON from response (may have surrounding text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return SupervisorVerdictSchema.parse(parsed);
  } catch (error) {
    logger.warn('Failed to parse supervisor verdict, defaulting to approved', {
      error: (error as Error).message,
      response: response.slice(0, 200),
    });

    // Default to approved if parsing fails (fail-open for production stability)
    return {
      approved: true,
      issues: [],
      fix_instructions: '',
    };
  }
}

/**
 * Quick check for obvious violations without LLM
 * Catches critical violations that are easy to detect
 */
function quickViolationCheck(draft: string, state: GraphState): SupervisorVerdict | null {
  const issues: string[] = [];

  // Check for em dashes (critical violation)
  if (draft.includes('—')) {
    issues.push('Contains em dash character which is forbidden');
  }

  // Check for markdown in voice mode
  if (state.mode === 'voice') {
    if (draft.includes('```') || draft.includes('**') || draft.includes('##')) {
      issues.push('Voice mode response contains markdown formatting');
    }
    // Check for overly long voice response
    if (draft.length > 500) {
      issues.push('Voice mode response is too long (should be 1-3 sentences)');
    }
  }

  // Check for tool hallucination patterns
  const hallucationPatterns = [
    /i found these results/i,
    /according to my search/i,
    /the weather (?:is|shows|indicates)/i,
    /your calendar shows/i,
  ];
  for (const pattern of hallucationPatterns) {
    if (pattern.test(draft) && !state.relevant_memories.some(m => m.includes('search') || m.includes('calendar'))) {
      issues.push('Response appears to reference tool results that were not provided');
    }
  }

  if (issues.length > 0) {
    return {
      approved: false,
      issues,
      fix_instructions: issues.map((i, idx) => `${idx + 1}. Fix: ${i}`).join('; '),
    };
  }

  return null;
}

/**
 * Supervisor Node
 *
 * Critiques the draft against compliance rubric
 */
export async function supervisorNode(
  input: SupervisorInput
): Promise<SupervisorOutput> {
  const { state } = input;

  logger.debug('Supervisor node executing', {
    sessionId: state.session_id,
    turnId: state.turn_id,
    draftLength: state.draft?.length || 0,
    attempt: state.attempts,
  });

  // Quick check for obvious violations first
  const quickResult = quickViolationCheck(state.draft || '', state);
  if (quickResult && !quickResult.approved) {
    logger.debug('Quick violation check failed', {
      sessionId: state.session_id,
      issues: quickResult.issues,
    });

    return {
      state: {
        ...state,
        critique_issues: quickResult.issues,
        attempts: state.attempts + 1,
      },
      verdict: quickResult,
    };
  }

  try {
    // Use groq llama-3.1-8b-instant for fast, cheap compliance checking
    const prompt = buildSupervisorPrompt(state);

    const response = await createCompletion(
      'groq',
      'llama-3.1-8b-instant',
      [
        { role: 'system', content: SUPERVISOR_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      {
        temperature: 0.1, // Low temperature for consistent judgments
        maxTokens: 500,
      }
    );

    const verdict = parseVerdict(response.content || '');

    const tokenUsage: TokenUsage = {
      inputTokens: response.inputTokens || 0,
      outputTokens: response.outputTokens || 0,
      cacheTokens: response.cacheTokens,
      model: response.model,
      provider: response.provider,
    };

    logger.debug('Supervisor node completed', {
      sessionId: state.session_id,
      approved: verdict.approved,
      issueCount: verdict.issues.length,
      tokens: response.tokensUsed,
    });

    // If approved, set final output
    if (verdict.approved) {
      return {
        state: {
          ...state,
          critique_issues: [],
          final_output: state.draft,
          attempts: state.attempts + 1,
        },
        verdict,
        tokenUsage,
      };
    }

    // Not approved - record issues and increment attempts
    return {
      state: {
        ...state,
        critique_issues: verdict.issues,
        attempts: state.attempts + 1,
      },
      verdict,
      tokenUsage,
    };
  } catch (error) {
    logger.error('Supervisor node failed', {
      sessionId: state.session_id,
      error: (error as Error).message,
    });

    // Fail-open: approve on error to not block responses
    const fallbackVerdict: SupervisorVerdict = {
      approved: true,
      issues: [],
      fix_instructions: '',
    };

    return {
      state: {
        ...state,
        critique_issues: [],
        final_output: state.draft,
        attempts: state.attempts + 1,
      },
      verdict: fallbackVerdict,
    };
  }
}

export default {
  supervisorNode,
  buildSupervisorPrompt,
  quickViolationCheck,
};
