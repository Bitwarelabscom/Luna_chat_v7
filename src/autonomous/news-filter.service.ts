import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

export type NewsCategory =
  | 'conflicts' | 'tech' | 'good_news' | 'politics'
  | 'science' | 'finance' | 'health' | 'environment'
  | 'security' | 'other';

export const NEWS_CATEGORIES: { id: NewsCategory; label: string; color: string }[] = [
  { id: 'conflicts', label: 'Conflicts/War', color: '#ef4444' },
  { id: 'tech', label: 'Tech', color: '#3b82f6' },
  { id: 'good_news', label: 'Good News', color: '#22c55e' },
  { id: 'politics', label: 'Politics', color: '#a855f7' },
  { id: 'science', label: 'Science', color: '#06b6d4' },
  { id: 'finance', label: 'Finance', color: '#eab308' },
  { id: 'health', label: 'Health', color: '#ec4899' },
  { id: 'environment', label: 'Environment', color: '#10b981' },
  { id: 'security', label: 'Security/Cyber', color: '#f97316' },
  { id: 'other', label: 'Other', color: '#6b7280' },
];

export interface FilterResult {
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  category: NewsCategory;
  reason: string;
  topics: string[];
  confidence: number;
}

const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
const VALID_CATEGORIES: NewsCategory[] = NEWS_CATEGORIES.map(c => c.id);

/**
 * Classify and grade a news article using a small LLM.
 * Returns priority (P1-P4), category, topics, and confidence.
 */
export async function filterArticle(
  title: string,
  summary: string | null,
  userInterests: string[] = [],
  userId?: string,
  defaultCategory?: string
): Promise<FilterResult> {
  const categoryHint = defaultCategory ? `\nSource category hint: ${defaultCategory}` : '';
  const interestStr = userInterests.length > 0 ? userInterests.join(', ') : 'AI, infrastructure, security, autonomous systems';

  const prompt = `You are a news classifier. Analyze the article and assign a priority and category.

PRIORITY LEVELS:
- P1: World-changing / breaking - wars, major disasters, market crashes (>5%), assassinations, pandemics
- P2: Important - significant policy changes, major product launches, notable scientific discoveries, large funding rounds
- P3: Noteworthy - interesting developments, updates, moderate events
- P4: Background - routine updates, minor stories, opinion pieces, listicles

CATEGORIES (pick exactly one):
- conflicts: Wars, military actions, terrorism, geopolitical tensions, sanctions
- tech: Technology, AI, software, hardware, startups, open source
- good_news: Positive developments, breakthroughs, humanitarian wins, solutions
- politics: Elections, legislation, policy, government, diplomacy (non-conflict)
- science: Research, discoveries, space, physics, biology, academic papers
- finance: Markets, economy, crypto, earnings, IPOs, central banks
- health: Medicine, public health, diseases, drug approvals, mental health
- environment: Climate, energy transition, pollution, conservation, weather events
- security: Cybersecurity, hacking, data breaches, privacy, surveillance
- other: Entertainment, sports, lifestyle, anything else
${categoryHint}

User interests: ${interestStr}

Article:
Title: ${title}
Summary: ${summary || 'No summary available.'}

Respond ONLY in JSON:
{
  "priority": "P1"|"P2"|"P3"|"P4",
  "category": "<one of the categories above>",
  "reason": "One sentence explanation",
  "topics": ["topic1", "topic2"],
  "confidence": 0.0-1.0
}`;

  try {
    const response = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'news_filter',
      messages: [
        { role: 'system', content: 'You are a professional news analyst and classifier. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      maxTokens: 200,
      loggingContext: userId ? {
        userId,
        source: 'news-filter',
        nodeName: 'classify_article',
      } : undefined,
    });

    let content = response.content.trim();
    if (content.includes('```json')) {
      content = content.split('```json')[1].split('```')[0].trim();
    } else if (content.includes('```')) {
      content = content.split('```')[1].split('```')[0].trim();
    }

    const result = JSON.parse(content);

    // Validate and normalize
    const priority = VALID_PRIORITIES.includes(result.priority) ? result.priority : 'P4';
    const category = VALID_CATEGORIES.includes(result.category) ? result.category : (defaultCategory as NewsCategory || 'other');

    return {
      priority,
      category,
      reason: result.reason || 'No reason provided',
      topics: Array.isArray(result.topics) ? result.topics : [],
      confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5
    };
  } catch (error) {
    logger.error('Error in news classifier', { title, error });
    return {
      priority: 'P4',
      category: (defaultCategory as NewsCategory) || 'other',
      reason: 'Classification error: ' + (error instanceof Error ? error.message : 'Unknown'),
      topics: [],
      confidence: 0
    };
  }
}
