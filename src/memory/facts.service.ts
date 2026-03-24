import { pool } from '../db/index.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import * as knowledgeGraphService from '../graph/knowledge-graph.service.js';
import { enrichNodeMetadata } from './memorycore-graph.service.js';
import * as contradictionService from './contradiction.service.js';
import { getSemantics } from './fact-semantics.js';
import logger from '../utils/logger.js';
import { formatRelativeTime } from './time-utils.js';

export interface UserFact {
  id: string;
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  lastMentioned: Date;
  mentionCount: number;
  intentId: string | null;
  factStatus: 'active' | 'overridden' | 'superseded' | 'expired';
  factType: 'permanent' | 'default' | 'temporary';
  validFrom: Date | null;
  validUntil: Date | null;
  supersedesId: string | null;
  overridePriority: number;
}

export interface ExtractedFact {
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  factType?: 'permanent' | 'default' | 'temporary';
  validFrom?: string | null;
  validUntil?: string | null;
  isCorrection?: boolean;
}

const SPECULATION_PATTERNS = [
  /\b(suggests?|implies?|may reflect|might indicate|could mean|deeper desire|self-identification)\b/i,
  /\b(hypothesis|assumption|potentially|arguably|seems to)\b/i,
  /\b(further validation|require[sd]? validation|based on assumptions)\b/i,
];

export function isSpeculativeFact(value: string): boolean {
  return SPECULATION_PATTERNS.some(p => p.test(value));
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

function buildExtractionPrompt(existingFacts?: UserFact[]): string {
  let prompt = `You are a fact extraction assistant. Extract personal facts about the user from the conversation.

Rules:
- Only extract facts the user explicitly states about themselves
- Do not infer or assume facts
- Use simple, normalized values (e.g., "software developer" not "I work as a software developer")
- Confidence: 1.0 for explicit statements, 0.8 for strongly implied, 0.6 for somewhat implied (use sparingly - only with clear contextual evidence)
- Categories: personal, work, preference, hobby, relationship, goal, context
- Facts must be concrete and verifiable: names, dates, schedules, preferences, events
- NEVER store interpretations, analyses, or psychological observations about the user
- If a fact contains words like "suggests", "implies", "may reflect", "deeper desire" - it is NOT a fact, discard it

Lifecycle detection:
- If the user corrects or updates a previously known fact, set "isCorrection": true
- If the user describes a temporary state (vacation, visiting, shift change with end date), set "factType": "temporary" and "validUntil": ISO date if end is clear
- If the user describes a change with unclear duration ("doing evenings for a while", "staying at mom's"), set "factType": "temporary" and "validUntil": null
- If the user describes a recurring baseline ("I usually work day shift"), set "factType": "default"
- If ambiguous whether temporary or permanent, default to "permanent" with "isCorrection": true

Output JSON array of facts:
[{"category": "personal", "factKey": "name", "factValue": "Henke", "confidence": 1.0, "isCorrection": false, "factType": "permanent", "validUntil": null}]

Return empty array [] if no facts can be extracted.
Only return the JSON array, no other text.`;

  if (existingFacts && existingFacts.length > 0) {
    prompt += `\n\nCurrently known facts for context (detect contradictions against these):`;
    for (const f of existingFacts) {
      prompt += `\n- ${f.category}/${f.factKey}: ${f.factValue} (${f.mentionCount}x)`;
    }
  }

  return prompt;
}

function mapRowToFact(row: Record<string, unknown>): UserFact {
  return {
    id: row.id as string,
    category: row.category as string,
    factKey: row.fact_key as string,
    factValue: row.fact_value as string,
    confidence: parseFloat(row.confidence as string),
    lastMentioned: row.last_mentioned as Date,
    mentionCount: row.mention_count as number,
    intentId: row.intent_id as string | null,
    factStatus: (row.fact_status as string || 'active') as UserFact['factStatus'],
    factType: (row.fact_type as string || 'permanent') as UserFact['factType'],
    validFrom: row.valid_from as Date | null,
    validUntil: row.valid_until as Date | null,
    supersedesId: row.supersedes_id as string | null,
    overridePriority: (row.override_priority as number) || 0,
  };
}

/**
 * Extract facts from a conversation using LLM
 */
export async function extractFactsFromMessages(
  messages: Array<{ role: string; content: string }>,
  userId?: string,
  sessionId?: string
): Promise<ExtractedFact[]> {
  // Only look at user messages for fact extraction
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n\n');

  if (!userMessages.trim()) return [];

  // Get existing facts for context if userId is available
  let existingFacts: UserFact[] | undefined;
  if (userId) {
    try {
      existingFacts = await getUserFacts(userId, { limit: 30 });
    } catch {
      // Non-blocking - extraction still works without context
    }
  }

  try {
    const response = await createBackgroundCompletionWithFallback({
      userId,
      sessionId,
      feature: 'memory_curation',
      messages: [
        { role: 'system', content: buildExtractionPrompt(existingFacts) },
        { role: 'user', content: `Extract facts from:\n\n${userMessages}` },
      ],
      temperature: 0.1,
      maxTokens: 6000,
      ...(userId ? {
        loggingContext: {
          userId,
          sessionId,
          source: 'memory',
          nodeName: 'fact_extraction',
        },
      } : {}),
    });

    const content = response.content || '[]';

    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const facts = JSON.parse(jsonMatch[0]) as ExtractedFact[];

    // Validate facts
    return facts.filter(f => {
      if (!FACT_CATEGORIES.includes(f.category) || !f.factKey || !f.factValue || typeof f.confidence !== 'number') {
        return false;
      }
      if (isSpeculativeFact(f.factValue)) {
        logger.warn('Rejected speculative fact', { key: f.factKey, value: f.factValue });
        return false;
      }
      return true;
    });
  } catch (error) {
    logger.error('Failed to extract facts', { error: (error as Error).message });
    return [];
  }
}

/**
 * Store or update a user fact with lifecycle-aware supersession
 */
export async function storeFact(
  userId: string,
  fact: ExtractedFact,
  sourceMessageId?: string,
  sourceSessionId?: string,
  intentId?: string | null
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find existing active fact with same key
    const existingResult = await client.query(
      `SELECT id, fact_value, mention_count, fact_type, fact_status
       FROM user_facts
       WHERE user_id = $1 AND category = $2 AND fact_key = $3
         AND (intent_id = $4 OR (intent_id IS NULL AND $4 IS NULL))
         AND fact_status = 'active'
       ORDER BY override_priority DESC, mention_count DESC
       LIMIT 1`,
      [userId, fact.category, fact.factKey, intentId || null]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      // 2. No existing fact - INSERT new
      const factType = fact.factType || 'permanent';
      const priority = factType === 'temporary' ? 20 : (fact.isCorrection ? 10 : 0);

      await client.query(
        `INSERT INTO user_facts
          (user_id, category, fact_key, fact_value, confidence, source_message_id, source_session_id, intent_id,
           fact_status, fact_type, valid_from, valid_until, override_priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12)`,
        [userId, fact.category, fact.factKey, fact.factValue, fact.confidence,
         sourceMessageId, sourceSessionId, intentId || null,
         factType, fact.validFrom || null, fact.validUntil || null, priority]
      );
    } else if (existing.fact_value === fact.factValue) {
      // 3. Same value - bump mention_count
      await client.query(
        `UPDATE user_facts SET
           mention_count = mention_count + 1,
           last_mentioned = NOW(),
           confidence = GREATEST(confidence, $2),
           updated_at = NOW()
         WHERE id = $1`,
        [existing.id, fact.confidence]
      );
    } else {
      // 4. Different value - supersession logic
      const incomingType = fact.factType || 'permanent';
      const inheritedMentionCount = (existing.mention_count as number) + 1;

      if (incomingType === 'temporary') {
        // Temporary override: mark old as overridden
        await client.query(
          `UPDATE user_facts SET fact_status = 'overridden', updated_at = NOW() WHERE id = $1`,
          [existing.id]
        );

        await client.query(
          `INSERT INTO user_facts
            (user_id, category, fact_key, fact_value, confidence, source_message_id, source_session_id, intent_id,
             fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority, mention_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 'temporary', $9, $10, $11, 20, $12)`,
          [userId, fact.category, fact.factKey, fact.factValue, fact.confidence,
           sourceMessageId, sourceSessionId, intentId || null,
           fact.validFrom || null, fact.validUntil || null, existing.id, inheritedMentionCount]
        );
      } else {
        // Correction: mark old as superseded
        await client.query(
          `UPDATE user_facts SET fact_status = 'superseded', updated_at = NOW() WHERE id = $1`,
          [existing.id]
        );

        await client.query(
          `INSERT INTO user_facts
            (user_id, category, fact_key, fact_value, confidence, source_message_id, source_session_id, intent_id,
             fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority, mention_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12, 10, $13)`,
          [userId, fact.category, fact.factKey, fact.factValue, fact.confidence,
           sourceMessageId, sourceSessionId, intentId || null,
           incomingType, fact.validFrom || null, fact.validUntil || null, existing.id, inheritedMentionCount]
        );
      }

      // Log the correction
      await client.query(
        `INSERT INTO fact_corrections
          (user_id, fact_key, old_value, new_value, correction_type, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, fact.factKey, existing.fact_value, fact.factValue,
         incomingType === 'temporary' ? 'temporary_override' : 'correction',
         incomingType === 'temporary' ? 'Temporary override' : 'Value correction']
      );

      // Emit contradiction signal for well-established facts
      if ((existing.mention_count as number) >= 2) {
        contradictionService.createSignal(
          userId, sourceSessionId, fact.factKey,
          fact.factValue, existing.fact_value as string,
          fact.isCorrection ? 'correction' : 'misremember'
        ).catch(err => logger.debug('Contradiction signal failed', { err: (err as Error).message }));
      }
    }

    await client.query('COMMIT');

    logger.debug('Stored user fact', {
      userId,
      category: fact.category,
      key: fact.factKey,
      intentId
    });

    // Sync to Neo4j (non-blocking)
    pool.query(
      `SELECT id, mention_count, last_mentioned, fact_status, fact_type FROM user_facts
       WHERE user_id = $1 AND category = $2 AND fact_key = $3
       AND (intent_id = $4 OR (intent_id IS NULL AND $4 IS NULL))
       AND fact_status = 'active'
       LIMIT 1`,
      [userId, fact.category, fact.factKey, intentId || null]
    ).then(result => {
      if (result.rows[0]) {
        const storedFact = mapRowToFact(result.rows[0]);
        knowledgeGraphService.syncFactToGraph(userId, storedFact).catch(err => {
          logger.warn('Failed to sync fact to Neo4j', { error: (err as Error).message });
        });
      }
    }).catch(e => logger.debug('Fact ID lookup for Neo4j sync failed', { err: (e as Error).message }));

    // Enrich graph node with semantic metadata (non-blocking)
    const semantics = getSemantics(fact.factKey);
    if (semantics && fact.factValue && /^[A-Z]/.test(fact.factValue)) {
      enrichNodeMetadata(userId, fact.factValue, {
        semanticType: semantics.semanticType,
        subType: semantics.subType,
        factCategory: fact.category,
        factKey: fact.factKey,
      }).catch(_e => logger.debug('Graph metadata enrichment failed', { factKey: fact.factKey }));
    }
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to store fact', {
      error: (error as Error).message,
      userId,
      fact
    });
  } finally {
    client.release();
  }
}

/**
 * Get active facts for a user with priority-aware deduplication
 */
export async function getUserFacts(
  userId: string,
  options: {
    category?: string;
    limit?: number;
    intentId?: string | null;
    status?: 'active' | 'all';
  } = {}
): Promise<UserFact[]> {
  const { category, limit = 50, intentId, status = 'active' } = options;

  try {
    if (status === 'all') {
      // Return all facts without deduplication
      let query = `
        SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count, intent_id,
               fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority
        FROM user_facts
        WHERE user_id = $1 AND is_active = true
      `;
      const params: (string | number | null)[] = [userId];

      if (category) {
        query += ` AND category = $${params.length + 1}`;
        params.push(category);
      }

      query += ` ORDER BY category, fact_key, override_priority DESC, mention_count DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await pool.query(query, params as any[]);
      return result.rows.map(mapRowToFact);
    }

    // Priority-aware retrieval: only return winning fact per key
    let query = `
      WITH ranked AS (
        SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count, intent_id,
               fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority,
               ROW_NUMBER() OVER (
                 PARTITION BY category, fact_key, COALESCE(intent_id, '00000000-0000-0000-0000-000000000000'::uuid)
                 ORDER BY
                   CASE WHEN fact_type = 'temporary' AND fact_status = 'active'
                        AND (valid_until IS NULL OR valid_until > NOW())
                        THEN 0 ELSE 1 END,
                   override_priority DESC,
                   mention_count DESC,
                   last_mentioned DESC
               ) as rn
        FROM user_facts
        WHERE user_id = $1
          AND is_active = true
          AND fact_status = 'active'
          AND NOT (fact_type = 'temporary' AND valid_until IS NOT NULL AND valid_until <= NOW())
    `;
    const params: (string | number | null)[] = [userId];

    if (category) {
      query += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    if (intentId) {
      query += ` AND (intent_id = $${params.length + 1} OR intent_id IS NULL)`;
      params.push(intentId);
    } else {
      query += ` AND intent_id IS NULL`;
    }

    query += `)
      SELECT * FROM ranked WHERE rn = 1
      ORDER BY intent_id NULLS LAST, mention_count DESC, last_mentioned DESC
      LIMIT $${params.length + 1}`;
    params.push(limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await pool.query(query, params as any[]);
    return result.rows.map(mapRowToFact);
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
 * Annotates temporary facts with validity info
 */
export function formatFactsForPrompt(facts: UserFact[], includeTimestamps = false): string {
  if (facts.length === 0) return '';

  const grouped = facts.reduce((acc, fact) => {
    if (!acc[fact.category]) acc[fact.category] = [];
    let line = `${fact.factKey}: ${fact.factValue}`;

    // Annotate temporary facts
    if (fact.factType === 'temporary') {
      if (fact.validUntil) {
        const until = new Date(fact.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        line += ` [temporary, until ${until}]`;
      } else {
        line += ` [temporary, ongoing]`;
      }
    }

    if (includeTimestamps) {
      const timeParts: string[] = [];
      if (fact.mentionCount > 1) timeParts.push(`${fact.mentionCount}x`);
      const relTime = formatRelativeTime(fact.lastMentioned);
      if (relTime) timeParts.push(relTime);
      if (timeParts.length > 0) line += ` (${timeParts.join(', ')})`;
    }
    acc[fact.category].push(line);
    return acc;
  }, {} as Record<string, string[]>);

  // Sort categories alphabetically for cache determinism
  const sortedCategories = Object.keys(grouped).sort();

  const sections = sortedCategories.map(category => {
    const sortedItems = grouped[category].sort();
    return `${category.charAt(0).toUpperCase() + category.slice(1)}:\n${sortedItems.map(i => `  - ${i}`).join('\n')}`;
  });

  return `[Known Facts About User]\n${sections.join('\n\n')}`;
}

/**
 * Expire temporary facts and restore predecessors
 */
export async function expireTemporaryFacts(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find active temporary facts past their valid_until
    const expiredResult = await client.query(
      `SELECT id, user_id, fact_key, fact_value, supersedes_id, category
       FROM user_facts
       WHERE fact_status = 'active'
         AND fact_type = 'temporary'
         AND valid_until IS NOT NULL
         AND valid_until <= NOW()`
    );

    const expired = expiredResult.rows;
    if (expired.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    for (const fact of expired) {
      // Mark as expired
      await client.query(
        `UPDATE user_facts SET fact_status = 'expired', updated_at = NOW() WHERE id = $1`,
        [fact.id]
      );

      // Chain-aware restore: walk supersedes_id chain to find restorable ancestor
      if (fact.supersedes_id) {
        let ancestorId: string | null = fact.supersedes_id;
        let restoredId: string | null = null;

        // Walk down the chain looking for an overridden ancestor
        while (ancestorId && !restoredId) {
          const ancestorResult = await client.query(
            `SELECT id, fact_status, supersedes_id FROM user_facts WHERE id = $1`,
            [ancestorId]
          );

          if (ancestorResult.rows.length === 0) break;

          const ancestor = ancestorResult.rows[0];
          if (ancestor.fact_status === 'overridden') {
            restoredId = ancestor.id;
          } else {
            ancestorId = ancestor.supersedes_id;
          }
        }

        if (restoredId) {
          await client.query(
            `UPDATE user_facts SET fact_status = 'active', updated_at = NOW() WHERE id = $1`,
            [restoredId]
          );
          logger.info('Restored predecessor fact after expiry', { restoredId, expiredId: fact.id });
        }
      }

      // Log the expiry
      await client.query(
        `INSERT INTO fact_corrections
          (user_id, fact_key, old_value, new_value, correction_type, reason)
         VALUES ($1, $2, $3, NULL, 'expiry', 'Temporary fact expired')`,
        [fact.user_id, fact.fact_key, fact.fact_value]
      );
    }

    await client.query('COMMIT');
    logger.info('Expired temporary facts', { count: expired.length });
    return expired.length;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to expire temporary facts', { error: (error as Error).message });
    return 0;
  } finally {
    client.release();
  }
}

/**
 * Get supersession chain for a fact (both directions)
 */
export async function getFactChain(
  userId: string,
  factId: string
): Promise<UserFact[]> {
  try {
    // Walk up: find all facts this one supersedes
    const chain: UserFact[] = [];

    // Get the starting fact
    const startResult = await pool.query(
      `SELECT * FROM user_facts WHERE id = $1 AND user_id = $2`,
      [factId, userId]
    );
    if (startResult.rows.length === 0) return [];

    const startFact = mapRowToFact(startResult.rows[0]);
    chain.push(startFact);

    // Walk down (predecessors via supersedes_id)
    let currentSupersedesId = startFact.supersedesId;
    while (currentSupersedesId) {
      const result = await pool.query(
        `SELECT * FROM user_facts WHERE id = $1 AND user_id = $2`,
        [currentSupersedesId, userId]
      );
      if (result.rows.length === 0) break;
      const fact = mapRowToFact(result.rows[0]);
      chain.push(fact);
      currentSupersedesId = fact.supersedesId;
    }

    // Walk up (successors that supersede this fact)
    let currentId = factId;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await pool.query(
        `SELECT * FROM user_facts WHERE supersedes_id = $1 AND user_id = $2 LIMIT 1`,
        [currentId, userId]
      );
      if (result.rows.length === 0) break;
      const fact = mapRowToFact(result.rows[0]);
      chain.unshift(fact);
      currentId = fact.id;
    }

    return chain;
  } catch (error) {
    logger.error('Failed to get fact chain', { error: (error as Error).message, factId });
    return [];
  }
}

/**
 * Process messages and extract/store facts
 */
export async function processConversationFacts(
  userId: string,
  sessionId: string,
  messages: Array<{ id?: string; role: string; content: string }>,
  intentId?: string | null
): Promise<void> {
  try {
    const extractedFacts = await extractFactsFromMessages(messages, userId, sessionId);

    for (const fact of extractedFacts) {
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      await storeFact(userId, fact, lastUserMessage?.id, sessionId, intentId);
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
  messages: Array<{ role: string; content: string }>,
  userId?: string,
  sessionId?: string
): Promise<{
  summary: string;
  topics: string[];
  keyPoints: string[];
  sentiment: string;
} | null> {
  if (messages.length < 4) return null;

  try {
    const conversation = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Luna'}: ${m.content}`)
      .join('\n\n');

    const response = await createBackgroundCompletionWithFallback({
      userId,
      sessionId,
      feature: 'context_summary',
      messages: [
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
      temperature: 0.3,
      maxTokens: 4000,
      ...(userId ? {
        loggingContext: {
          userId,
          sessionId,
          source: 'memory',
          nodeName: 'conversation_summary',
        },
      } : {}),
    });

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
      `SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count, intent_id,
              fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority
       FROM user_facts
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [factId, userId]
    );

    if (result.rows.length === 0) return null;
    return mapRowToFact(result.rows[0]);
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
      SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count, intent_id,
             fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority
      FROM user_facts
      WHERE user_id = $1 AND fact_key = $2 AND is_active = true AND fact_status = 'active'
    `;
    const params: string[] = [userId, factKey];

    if (category) {
      query += ` AND category = $3`;
      params.push(category);
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) return null;
    return mapRowToFact(result.rows[0]);
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
  reason?: string,
  updates?: { factType?: string; validFrom?: string | null; validUntil?: string | null }
): Promise<{ success: boolean; oldValue?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    await client.query(
      `INSERT INTO fact_corrections
        (user_id, fact_key, old_value, new_value, correction_type, reason)
       VALUES ($1, $2, $3, $4, 'update', $5)`,
      [userId, oldFact.fact_key, oldFact.fact_value, newValue, reason || null]
    );

    // Build dynamic update
    let updateQuery = `UPDATE user_facts SET fact_value = $1, updated_at = NOW(), last_mentioned = NOW()`;
    const updateParams: (string | null)[] = [newValue];

    if (updates?.factType) {
      updateParams.push(updates.factType);
      updateQuery += `, fact_type = $${updateParams.length}`;
    }

    if (updates && 'validFrom' in updates) {
      updateParams.push(updates.validFrom || null);
      updateQuery += `, valid_from = $${updateParams.length}`;
    }

    if (updates && 'validUntil' in updates) {
      updateParams.push(updates.validUntil || null);
      updateQuery += `, valid_until = $${updateParams.length}`;
    }

    updateParams.push(factId, userId);
    updateQuery += ` WHERE id = $${updateParams.length - 1} AND user_id = $${updateParams.length}`;

    await client.query(updateQuery, updateParams);

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

    await client.query(
      `INSERT INTO fact_corrections
        (user_id, fact_key, old_value, new_value, correction_type, reason)
       VALUES ($1, $2, $3, NULL, 'delete', $4)`,
      [userId, fact.fact_key, fact.fact_value, reason || null]
    );

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
 * Search facts by matching against key or value
 */
export async function searchFacts(
  userId: string,
  searchTerm: string
): Promise<UserFact[]> {
  try {
    const result = await pool.query(
      `SELECT id, category, fact_key, fact_value, confidence, last_mentioned, mention_count, intent_id,
              fact_status, fact_type, valid_from, valid_until, supersedes_id, override_priority
       FROM user_facts
       WHERE user_id = $1 AND is_active = true
         AND (fact_key ILIKE $2 OR fact_value ILIKE $2)
       ORDER BY mention_count DESC, last_mentioned DESC
       LIMIT 10`,
      [userId, `%${searchTerm}%`]
    );

    return result.rows.map(mapRowToFact);
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
  expireTemporaryFacts,
  getFactChain,
};
