import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import { config } from '../config/index.js';
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
[{"category": "personal", "factKey": "name", "factValue": "Henke", "confidence": 1.0}]

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
    // Use local Ollama qwen2.5:3b for fast fact extraction
    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
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
 * Uses deterministic ordering (sorted by category and key) for cache optimization
 */
export function formatFactsForPrompt(facts: UserFact[]): string {
  if (facts.length === 0) return '';

  const grouped = facts.reduce((acc, fact) => {
    if (!acc[fact.category]) acc[fact.category] = [];
    acc[fact.category].push(`${fact.factKey}: ${fact.factValue}`);
    return acc;
  }, {} as Record<string, string[]>);

  // Sort categories alphabetically for cache determinism
  const sortedCategories = Object.keys(grouped).sort();

  const sections = sortedCategories.map(category => {
    // Sort items within each category for determinism
    const sortedItems = grouped[category].sort();
    return `${category.charAt(0).toUpperCase() + category.slice(1)}:\n${sortedItems.map(i => `  - ${i}`).join('\n')}`;
  });

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

    // Use local Ollama qwen2.5:3b for summaries
    const response = await createCompletion(
      'ollama',
      config.ollama.chatModel,
      [
        {
          role: 'system',
          content: `Summarize this conversation concisely. Output JSON only:
{
  "summary": "Brief 1-2 sentence summary",
  "topics": ["topic1", "topic2"],
  "keyPoints": ["key point 1", "key point 2"],
  "sentiment": "positive|neutral|negative"
}
Only return the JSON object, no other text.`
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

/**
 * Get a specific fact by ID
 */
export async function getFactById(
  userId: string,
  factId: string
): Promise<UserFact | null> {
  try {
    const result = await pool.query(
      `SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count
       FROM user_facts
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [factId, userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      factKey: row.fact_key,
      factValue: row.fact_value,
      confidence: parseFloat(row.confidence),
      lastMentioned: row.last_mentioned,
      mentionCount: row.mention_count,
    };
  } catch (error) {
    logger.error('Failed to get fact by ID', {
      error: (error as Error).message,
      userId,
      factId
    });
    return null;
  }
}

/**
 * Get a specific fact by key and optional category
 */
export async function getFactByKey(
  userId: string,
  factKey: string,
  category?: string
): Promise<UserFact | null> {
  try {
    let query = `
      SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count
      FROM user_facts
      WHERE user_id = $1 AND fact_key = $2 AND is_active = true
    `;
    const params: string[] = [userId, factKey];

    if (category) {
      query += ` AND category = $3`;
      params.push(category);
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      factKey: row.fact_key,
      factValue: row.fact_value,
      confidence: parseFloat(row.confidence),
      lastMentioned: row.last_mentioned,
      mentionCount: row.mention_count,
    };
  } catch (error) {
    logger.error('Failed to get fact by key', {
      error: (error as Error).message,
      userId,
      factKey
    });
    return null;
  }
}

/**
 * Update an existing fact's value
 */
export async function updateFact(
  userId: string,
  factId: string,
  newValue: string,
  reason?: string
): Promise<{ success: boolean; oldValue?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the current fact
    const currentResult = await client.query(
      `SELECT fact_key, fact_value, category FROM user_facts
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [factId, userId]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false };
    }

    const oldFact = currentResult.rows[0];

    // Record the correction in history
    await client.query(
      `INSERT INTO fact_corrections
        (user_id, fact_key, old_value, new_value, correction_type, reason)
       VALUES ($1, $2, $3, $4, 'update', $5)`,
      [userId, oldFact.fact_key, oldFact.fact_value, newValue, reason || null]
    );

    // Update the fact
    await client.query(
      `UPDATE user_facts
       SET fact_value = $1, updated_at = NOW(), last_mentioned = NOW()
       WHERE id = $2 AND user_id = $3`,
      [newValue, factId, userId]
    );

    await client.query('COMMIT');

    logger.info('Updated user fact', {
      userId,
      factId,
      factKey: oldFact.fact_key,
      oldValue: oldFact.fact_value,
      newValue
    });

    return { success: true, oldValue: oldFact.fact_value };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to update fact', {
      error: (error as Error).message,
      userId,
      factId
    });
    return { success: false };
  } finally {
    client.release();
  }
}

/**
 * Delete (soft) a fact - marks as inactive
 */
export async function deleteFact(
  userId: string,
  factId: string,
  reason?: string
): Promise<{ success: boolean; deletedFact?: { factKey: string; factValue: string } }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the current fact
    const currentResult = await client.query(
      `SELECT fact_key, fact_value, category FROM user_facts
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [factId, userId]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false };
    }

    const fact = currentResult.rows[0];

    // Record the deletion in history
    await client.query(
      `INSERT INTO fact_corrections
        (user_id, fact_key, old_value, new_value, correction_type, reason)
       VALUES ($1, $2, $3, NULL, 'delete', $4)`,
      [userId, fact.fact_key, fact.fact_value, reason || null]
    );

    // Soft delete the fact
    await client.query(
      `UPDATE user_facts
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [factId, userId]
    );

    await client.query('COMMIT');

    logger.info('Deleted user fact', {
      userId,
      factId,
      factKey: fact.fact_key,
      factValue: fact.fact_value
    });

    return {
      success: true,
      deletedFact: { factKey: fact.fact_key, factValue: fact.fact_value }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to delete fact', {
      error: (error as Error).message,
      userId,
      factId
    });
    return { success: false };
  } finally {
    client.release();
  }
}

/**
 * Get fact correction history for a user
 */
export async function getFactCorrectionHistory(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<Array<{
  id: string;
  factKey: string;
  oldValue: string | null;
  newValue: string | null;
  correctionType: string;
  reason: string | null;
  createdAt: Date;
}>> {
  const { limit = 50, offset = 0 } = options;

  try {
    const result = await pool.query(
      `SELECT id, fact_key, old_value, new_value, correction_type, reason, created_at
       FROM fact_corrections
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      factKey: row.fact_key as string,
      oldValue: row.old_value as string | null,
      newValue: row.new_value as string | null,
      correctionType: row.correction_type as string,
      reason: row.reason as string | null,
      createdAt: row.created_at as Date,
    }));
  } catch (error) {
    logger.error('Failed to get fact correction history', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Search facts by matching against key or value (for LLM to find relevant fact)
 */
export async function searchFacts(
  userId: string,
  searchTerm: string
): Promise<UserFact[]> {
  try {
    const result = await pool.query(
      `SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count
       FROM user_facts
       WHERE user_id = $1 AND is_active = true
         AND (fact_key ILIKE $2 OR fact_value ILIKE $2)
       ORDER BY mention_count DESC, last_mentioned DESC
       LIMIT 10`,
      [userId, `%${searchTerm}%`]
    );

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
    logger.error('Failed to search facts', {
      error: (error as Error).message,
      userId,
      searchTerm
    });
    return [];
  }
}

export default {
  extractFactsFromMessages,
  storeFact,
  getUserFacts,
  formatFactsForPrompt,
  processConversationFacts,
  generateConversationSummary,
  getFactById,
  getFactByKey,
  updateFact,
  deleteFact,
  getFactCorrectionHistory,
  searchFacts,
};
