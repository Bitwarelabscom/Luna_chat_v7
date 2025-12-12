/**
 * Summarization service for agent outputs
 * Compresses step outputs to prevent context window bloat
 */

import { createCompletion } from '../llm/router.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SummarizationResult {
  summary: string;
  keyFacts: string[];
  tokensSaved: number;
}

// ============================================================================
// Constants
// ============================================================================

const SUMMARIZER_SYSTEM_PROMPT = `You are a concise summarizer. Extract the most important information from agent outputs.

Output JSON only:
{
  "summary": "2-3 sentence summary of the key findings",
  "keyFacts": ["fact 1", "fact 2", "fact 3"]
}

Rules:
- Focus on actionable information
- Preserve specific numbers, dates, names
- Remove verbose explanations
- Keep code snippets if they're essential
- Maximum 5 key facts`;

const MIN_LENGTH_FOR_SUMMARIZATION = 500;
const MAX_SUMMARY_TOKENS = 500;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Summarize agent output into key facts
 * Skips summarization for short outputs
 */
export async function summarizeAgentOutput(
  agentName: string,
  output: string,
  originalTask: string
): Promise<SummarizationResult> {
  const originalLength = output.length;

  // Skip summarization for short outputs
  if (originalLength < MIN_LENGTH_FOR_SUMMARIZATION) {
    return {
      summary: output,
      keyFacts: [],
      tokensSaved: 0,
    };
  }

  const prompt = `Summarize this agent output:

Agent: ${agentName}
Task: ${originalTask}

Output:
${output.slice(0, 8000)}${output.length > 8000 ? '\n...[truncated]' : ''}`;

  try {
    const result = await createCompletion(
      'ollama',
      config.ollama.chatModel, // qwen2.5:3b by default
      [
        { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, maxTokens: MAX_SUMMARY_TOKENS }
    );

    const content = result.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; keyFacts?: string[] };
      const summary = parsed.summary || output.slice(0, 500) + '...';
      const keyFacts = parsed.keyFacts || [];
      const summaryLength = summary.length;

      // Calculate rough token savings (1 token approx 4 chars)
      const tokensSaved = Math.round((originalLength - summaryLength) / 4);

      logger.debug('Summarized agent output', {
        agentName,
        originalLength,
        summaryLength,
        keyFactsCount: keyFacts.length,
        reduction: `${Math.round((1 - summaryLength / originalLength) * 100)}%`,
        tokensSaved,
      });

      return {
        summary,
        keyFacts,
        tokensSaved,
      };
    }

    // Failed to parse JSON - return truncated output
    logger.warn('Failed to parse summarization JSON', { agentName });
    return {
      summary: output.slice(0, 500) + '...',
      keyFacts: [],
      tokensSaved: Math.round((originalLength - 500) / 4),
    };
  } catch (error) {
    logger.warn('Summarization failed, using truncated output', {
      agentName,
      error: (error as Error).message,
    });

    return {
      summary: output.slice(0, 500) + '...',
      keyFacts: [],
      tokensSaved: Math.round((originalLength - 500) / 4),
    };
  }
}

/**
 * Batch summarize multiple outputs
 */
export async function summarizeMultipleOutputs(
  outputs: Array<{ agentName: string; output: string; task: string }>
): Promise<Map<string, SummarizationResult>> {
  const results = new Map<string, SummarizationResult>();

  // Process in parallel with concurrency limit
  const concurrency = 3;
  for (let i = 0; i < outputs.length; i += concurrency) {
    const batch = outputs.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item) =>
        summarizeAgentOutput(item.agentName, item.output, item.task)
      )
    );

    batch.forEach((item, idx) => {
      results.set(item.agentName, batchResults[idx]);
    });
  }

  return results;
}

/**
 * Format summarized results for synthesis prompt
 */
export function formatSummariesForSynthesis(
  summaries: Map<number, string>,
  agentNames: Map<number, string>
): string {
  const sections: string[] = [];

  for (const [stepNum, summary] of summaries) {
    const agentName = agentNames.get(stepNum) || 'unknown';
    sections.push(`### Step ${stepNum} (${agentName})\n${summary}`);
  }

  return sections.join('\n\n');
}
