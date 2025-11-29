import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import logger from '../utils/logger.js';

export interface UserFact {
  id: string;
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  lastMentioned: Date;
  mentionCount: number;
}

export interface ExtractedFact {
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
}

const FACT_CATEGORIES = [
  'personal',      // name, age, birthday, location
  'work',          // job, company, profession
  'preference',    // likes, dislikes, favorites
  'hobby',         // hobbies, interests, activities
  'relationship',  // family, friends, pets
  'goal',          // plans, aspirations, objectives
  'context',       // current situation, recent events
];

const EXTRACTION_PROMPT = `You are a fact extraction assistant. Extract personal facts about the user from the conversation.

Rules:
- Only extract facts the user explicitly states about themselves
- Do not infer or assume facts
- Use simple, normalized values (e.g., "software developer" not "I work as a software developer")
- Confidence: 1.0 for explicit statements, 0.8 for strongly implied, 0.6 for somewhat implied
- Categories: personal, work, preference, hobby, relationship, goal, context

Output JSON array of facts:
[{"category": "personal", "factKey": "name", "factValue": "John", "confidence": 1.0}]

Return empty array [] if no facts can be extracted.
Only return the JSON array, no other text.`;

/**
 * Extract facts from a conversation using LLM
 */
export async function extractFactsFromMessages(
  messages: Array<{ role: string; content: string }>
): Promise<ExtractedFact[]> {
  // Only look at user messages for fact extraction
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n\n');

  if (!userMessages.trim()) return [];

  try {
    // Use gpt-5-nano for fast fact extraction
    const response = await createCompletion(
      'openai',
      'gpt-5-nano',
      [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `Extract facts from:\n\n${userMessages}` },
      ],
      { temperature: 0.1, maxTokens: 4000 }
    );

    const content = response.content || '[]';

    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const facts = JSON.parse(jsonMatch[0]) as ExtractedFact[];

    // Validate facts
    return facts.filter(f =>
      FACT_CATEGORIES.includes(f.category) &&
      f.factKey &&
      f.factValue &&
      typeof f.confidence === 'number'
    );
  } catch (error) {
    logger.error('Failed to extract facts', { error: (error as Error).message });
    return [];
  }
}

/**
 * Store or update a user fact
 */
export async function storeFact(
  userId: string,
  fact: ExtractedFact,
  sourceMessageId?: string,
  sourceSessionId?: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO user_facts
        (user_id, category, fact_key, fact_value, confidence, source_message_id, source_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, category, fact_key) DO UPDATE SET
         fact_value = CASE
           WHEN EXCLUDED.confidence >= user_facts.confidence THEN EXCLUDED.fact_value
           ELSE user_facts.fact_value
         END,
         confidence = GREATEST(EXCLUDED.confidence, user_facts.confidence),
         last_mentioned = NOW(),
         mention_count = user_facts.mention_count + 1,
         source_message_id = COALESCE(EXCLUDED.source_message_id, user_facts.source_message_id),
         source_session_id = COALESCE(EXCLUDED.source_session_id, user_facts.source_session_id),
         updated_at = NOW()`,
      [userId, fact.category, fact.factKey, fact.factValue, fact.confidence, sourceMessageId, sourceSessionId]
    );

    logger.debug('Stored user fact', {
      userId,
      category: fact.category,
      key: fact.factKey
    });
  } catch (error) {
    logger.error('Failed to store fact', {
      error: (error as Error).message,
      userId,
      fact
    });
  }
}

/**
 * Get all active facts for a user
 */
export async function getUserFacts(
  userId: string,
  options: {
    category?: string;
    limit?: number;
  } = {}
): Promise<UserFact[]> {
  const { category, limit = 50 } = options;

  try {
    let query = `
      SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count
      FROM user_facts
      WHERE user_id = $1 AND is_active = true
    `;
    const params: (string | number)[] = [userId];

    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }

    query += ` ORDER BY mention_count DESC, last_mentioned DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      category: row.category as string,
      factKey: row.fact_key as string,
      factValue: row.fact_value as string,
      confidence: parseFloat(row.confidence as string),
      lastMentioned: row.last_mentioned as Date,
      mentionCount: row.mention_count as number,
    }));
  } catch (error) {
    logger.error('Failed to get user facts', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Format facts for inclusion in prompt
 */
export function formatFactsForPrompt(facts: UserFact[]): string {
  if (facts.length === 0) return '';

  const grouped = facts.reduce((acc, fact) => {
    if (!acc[fact.category]) acc[fact.category] = [];
    acc[fact.category].push(`${fact.factKey}: ${fact.factValue}`);
    return acc;
  }, {} as Record<string, string[]>);

  const sections = Object.entries(grouped).map(([category, items]) =>
    `${category.charAt(0).toUpperCase() + category.slice(1)}:\n${items.map(i => `  - ${i}`).join('\n')}`
  );

  return `[Known Facts About User]\n${sections.join('\n\n')}`;
}

/**
 * Process messages and extract/store facts
 */
export async function processConversationFacts(
  userId: string,
  sessionId: string,
  messages: Array<{ id?: string; role: string; content: string }>
): Promise<void> {
  try {
    const extractedFacts = await extractFactsFromMessages(messages);

    for (const fact of extractedFacts) {
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      await storeFact(userId, fact, lastUserMessage?.id, sessionId);
    }

    if (extractedFacts.length > 0) {
      logger.info('Extracted facts from conversation', {
        userId,
        sessionId,
        factCount: extractedFacts.length
      });
    }
  } catch (error) {
    logger.error('Failed to process conversation facts', {
      error: (error as Error).message,
      userId,
      sessionId
    });
  }
}

/**
 * Generate conversation summary for long-term storage
 */
export async function generateConversationSummary(
  messages: Array<{ role: string; content: string }>
): Promise<{
  summary: string;
  topics: string[];
  keyPoints: string[];
  sentiment: string;
} | null> {
  if (messages.length < 4) return null; // Need at least 2 exchanges

  try {
    const conversation = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Luna'}: ${m.content}`)
      .join('\n\n');

    // Use gpt-5-mini for summaries
    const response = await createCompletion(
      'openai',
      'gpt-5-mini',
      [
        {
          role: 'system',
          content: `Summarize this conversation concisely. Output JSON:
{
  "summary": "Brief 1-2 sentence summary",
  "topics": ["topic1", "topic2"],
  "keyPoints": ["key point 1", "key point 2"],
  "sentiment": "positive|neutral|negative"
}
Only return JSON.`
        },
        { role: 'user', content: conversation },
      ],
      { temperature: 0.3, maxTokens: 2000 }
    );

    const content = response.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    logger.error('Failed to generate conversation summary', {
      error: (error as Error).message
    });
    return null;
  }
}

export default {
  extractFactsFromMessages,
  storeFact,
  getUserFacts,
  formatFactsForPrompt,
  processConversationFacts,
  generateConversationSummary,
};
