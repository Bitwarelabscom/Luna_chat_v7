/**
 * Query Refinement Service
 * Generates improved search queries when initial research fails or for retry attempts
 */

import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

/**
 * Refine search queries after a failed research attempt.
 * Generates 3-5 more specific queries based on failure context.
 */
export async function refineSearchQueries(
  userId: string,
  topic: string,
  originalQueries: string[],
  failureReason: string,
  previousSources: Array<{ url: string; rejected?: boolean; reason?: string }>
): Promise<{ queries: string[]; bestOriginalQuery: string | null }> {
  try {
    const rejectedSourcesSummary = previousSources
      .filter((s) => s.rejected)
      .map((s) => `- ${s.url}: ${s.reason || 'untrusted domain'}`)
      .join('\n');

    const systemPrompt = `You are a search query refinement expert. The initial research attempt for a topic failed. Your job is to generate better, more targeted search queries.

Instructions:
1. Analyze why the first search failed
2. Generate 3-5 improved queries that:
   - Try different angles or phrasings
   - Use site: operators for known trusted domains (e.g., site:arxiv.org, site:github.com)
   - Add year qualifiers for recent information
   - Be more specific or more general as needed
3. Identify which original query performed best (if any)

Output valid JSON only:
{
  "queries": ["query 1", "query 2", "query 3"],
  "bestOriginalQuery": "the best performing original query or null"
}`;

    const userMessage = `Topic: ${topic}

Original queries that were tried:
${originalQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Failure reason: ${failureReason}

${rejectedSourcesSummary ? `Rejected sources:\n${rejectedSourcesSummary}` : 'No sources were found at all.'}

Generate refined search queries.`;

    const completion = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'query_refinement',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.4,
      maxTokens: 1000,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'query_refinement',
      },
    });

    const responseText = completion.content.trim() || '{}';
    const jsonText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(jsonText);

    const queries = Array.isArray(result.queries) ? result.queries.filter((q: unknown) => typeof q === 'string' && q.length > 0) : [];
    const bestOriginalQuery = typeof result.bestOriginalQuery === 'string' ? result.bestOriginalQuery : null;

    logger.info('Search queries refined', {
      userId,
      topic,
      originalCount: originalQueries.length,
      refinedCount: queries.length,
      bestOriginalQuery,
    });

    return { queries, bestOriginalQuery };
  } catch (error) {
    logger.error('Error refining search queries', { error, userId, topic });
    // Fallback: return slightly modified originals
    return {
      queries: originalQueries.map((q) => `${q} 2026`),
      bestOriginalQuery: originalQueries[0] || null,
    };
  }
}

/**
 * Generate retry queries for a 3-day retry attempt.
 * Mixes the best previous query with 2 fresh LLM-generated queries.
 */
export async function generateRetryQueries(
  userId: string,
  topic: string,
  bestPreviousQuery: string | null,
  allPreviousQueries: string[]
): Promise<string[]> {
  try {
    const systemPrompt = `You are a search query expert. A research topic has been retried. Generate 2 fresh search queries that take a different approach from all previous attempts.

Requirements:
- Do NOT repeat any of the previous queries
- Try entirely different angles, synonyms, or related subtopics
- Use site: operators or year qualifiers where helpful

Output valid JSON only:
{"queries": ["query 1", "query 2"]}`;

    const userMessage = `Topic: ${topic}

Previous queries (do not repeat these):
${allPreviousQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate 2 fresh queries.`;

    const completion = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'query_refinement',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.5,
      maxTokens: 500,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'retry_query_generation',
      },
    });

    const responseText = completion.content.trim() || '{}';
    const jsonText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(jsonText);
    const freshQueries = Array.isArray(result.queries) ? result.queries.filter((q: unknown) => typeof q === 'string' && q.length > 0) : [];

    // Mix: best previous query (if any) + 2 fresh queries = 3 total
    const retryQueries: string[] = [];
    if (bestPreviousQuery) {
      retryQueries.push(bestPreviousQuery);
    }
    retryQueries.push(...freshQueries.slice(0, bestPreviousQuery ? 2 : 3));

    logger.info('Retry queries generated', {
      userId,
      topic,
      retryCount: retryQueries.length,
      reusedBest: !!bestPreviousQuery,
    });

    return retryQueries;
  } catch (error) {
    logger.error('Error generating retry queries', { error, userId, topic });
    // Fallback: use best previous query + a modified version
    const fallback: string[] = [];
    if (bestPreviousQuery) fallback.push(bestPreviousQuery);
    fallback.push(`${topic} latest research 2026`);
    fallback.push(`${topic} overview authoritative sources`);
    return fallback.slice(0, 3);
  }
}
