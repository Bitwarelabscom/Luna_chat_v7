/**
 * Domain Discovery Service
 * Auto-evaluates unknown domains found during research and provisions trust scores
 */

import { query } from '../db/postgres.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

interface DomainEvaluation {
  domain: string;
  isLegitimate: boolean;
  category: string;
  suggestedScore: number;
  reasoning: string;
}

/**
 * Extract root domain from a URL
 */
function extractRootDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./i, '');
  } catch {
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
    return match ? match[1].toLowerCase() : url.toLowerCase();
  }
}

/**
 * Evaluate unknown domains found in research results.
 * Uses LLM to assess legitimacy and assign provisional trust scores.
 */
export async function evaluateUnknownDomains(
  userId: string,
  unknownUrls: string[]
): Promise<DomainEvaluation[]> {
  // Extract unique root domains
  const domainSet = new Set<string>();
  for (const url of unknownUrls) {
    domainSet.add(extractRootDomain(url));
  }
  const uniqueDomains = [...domainSet];

  if (uniqueDomains.length === 0) return [];

  // Filter out domains already in source_trust_scores
  const existingRows = await query<{ domain: string }>(
    `SELECT domain FROM source_trust_scores WHERE domain = ANY($1)`,
    [uniqueDomains]
  );
  const existingDomains = new Set(existingRows.map((r) => r.domain));
  const newDomains = uniqueDomains.filter((d) => !existingDomains.has(d));

  if (newDomains.length === 0) return [];

  // Cap at 20 domains per evaluation
  const batch = newDomains.slice(0, 20);

  try {
    const systemPrompt = `You are a domain trust evaluator. Assess the following domains for use as research sources.

For each domain, determine:
1. Is it a legitimate organization, publication, or institution?
2. What category does it belong to? (language_docs, database_docs, cloud_infra, security, academic, government, tech_publication, news, reference, community, other)
3. What trust score (0.0-1.0) should it receive?

Known good patterns:
- .edu domains (academic institutions) -> 0.80-0.92
- .gov domains (government) -> 0.85-0.92
- Official documentation sites -> 0.85-0.90
- Established tech publishers -> 0.75-0.85
- Peer-reviewed journals -> 0.85-0.92

Known bad patterns (score <= 0.3):
- User-generated content platforms (forums, social media)
- Content farms, SEO spam sites
- Personal blogs without expertise signals
- Aggregators without editorial review

Output valid JSON only - an array of evaluations:
[
  {
    "domain": "example.com",
    "isLegitimate": true,
    "category": "tech_publication",
    "suggestedScore": 0.78,
    "reasoning": "Established engineering blog from major tech company"
  }
]`;

    const userMessage = `Evaluate these domains:\n${batch.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;

    const completion = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'domain_evaluation',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      maxTokens: 3000,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'domain_evaluation',
      },
    });

    const responseText = completion.content.trim() || '[]';
    const jsonText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const evaluations: DomainEvaluation[] = JSON.parse(jsonText);

    // Validate and filter
    const validEvaluations = evaluations.filter(
      (e) =>
        typeof e.domain === 'string' &&
        typeof e.isLegitimate === 'boolean' &&
        typeof e.suggestedScore === 'number' &&
        e.suggestedScore >= 0 &&
        e.suggestedScore <= 1
    );

    // Insert legitimate domains with capped provisional score
    let insertedCount = 0;
    for (const evaluation of validEvaluations) {
      if (!evaluation.isLegitimate || evaluation.suggestedScore < 0.6) continue;

      // Cap auto-discovered scores at 0.75
      const cappedScore = Math.min(evaluation.suggestedScore, 0.75);

      await query(
        `INSERT INTO source_trust_scores (domain, trust_score, category, update_reason, auto_discovered, discovered_at, discovery_context)
         VALUES ($1, $2, $3, $4, true, NOW(), $5)
         ON CONFLICT (domain) DO NOTHING`,
        [
          evaluation.domain,
          cappedScore,
          evaluation.category || 'other',
          'Auto-discovered during research',
          evaluation.reasoning,
        ]
      );
      insertedCount++;
    }

    logger.info('Domain evaluation complete', {
      userId,
      evaluated: batch.length,
      legitimate: validEvaluations.filter((e) => e.isLegitimate).length,
      inserted: insertedCount,
    });

    return validEvaluations;
  } catch (error) {
    logger.error('Error evaluating unknown domains', { error, userId });
    return [];
  }
}
