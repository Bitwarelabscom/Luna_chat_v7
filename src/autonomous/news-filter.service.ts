import { createCompletion } from '../llm/router.js';
import logger from '../utils/logger.js';

export interface FilterResult {
  signal: 'low' | 'medium' | 'high';
  reason: string;
  topics: string[];
  confidence: number;
}

/**
 * Bullshit filter using a small model (e.g., Qwen 2.5B)
 * Identifies high-signal content vs. noise/bullshit.
 */
export async function filterArticle(
  title: string,
  summary: string | null,
  userInterests: string[] = []
): Promise<FilterResult> {
  const prompt = `You are a "bullshit filter" for news. Your goal is to identify high-signal, actionable, or truly insightful information while filtering out noise.

Criteria for BULLSHIT (Low Signal):
- Outrage bait / Rage-farming
- Recycled opinions without new data
- SEO sludge / Content farm garbage
- Speculative hype with no substance
- Purely promotional / PR fluff
- Celebrity gossip or irrelevant politics

Criteria for SIGNAL (Medium to High):
- New information or data points
- Actionable technical insights or tools
- Open source releases or technical PoCs
- Well-researched deep dives
- Security disclosures
- Significant infrastructure/architectural changes
- Direct impact on: ${userInterests.join(', ') || 'AI, infra, security, autonomous systems'}

Analyze the following:
Title: ${title}
Summary: ${summary || 'No summary provided.'}

Respond ONLY in JSON format:
{
  "signal": "low" | "medium" | "high",
  "reason": "One sentence explanation of why this is signal or bullshit",
  "topics": ["topic1", "topic2"],
  "confidence": 0.0-1.0
}`;

  try {
    // We prefer a small, fast model for this (Qwen 2.5B/7B is ideal)
    // If ollama is available, we use qwen2.5:7b
    const response = await createCompletion('ollama', 'qwen2.5:7b', [
      { role: 'system', content: 'You are a professional news analyst and filter.' },
      { role: 'user', content: prompt }
    ], {
      temperature: 0.1,
      maxTokens: 150
    });

    // Clean response if it contains markdown code blocks
    let content = response.content.trim();
    if (content.includes('```json')) {
      content = content.split('```json')[1].split('```')[0].trim();
    } else if (content.includes('```')) {
      content = content.split('```')[1].split('```')[0].trim();
    }

    const result = JSON.parse(content);
    
    // Validate result structure
    if (!result.signal || !['low', 'medium', 'high'].includes(result.signal)) {
      result.signal = 'low';
    }
    
    return {
      signal: result.signal,
      reason: result.reason || 'No reason provided',
      topics: Array.isArray(result.topics) ? result.topics : [],
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5
    };
  } catch (error) {
    logger.error('Error in bullshit filter', { title, error });
    return {
      signal: 'low',
      reason: 'Filter error: ' + (error instanceof Error ? error.message : 'Unknown'),
      topics: [],
      confidence: 0
    };
  }
}