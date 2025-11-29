import { pool } from '../db/postgres.js';
import logger from '../utils/logger.js';

// Types
export interface SavedPrompt {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  basePrompt: string;
  assistantAdditions: string | null;
  companionAdditions: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserStats {
  tokens: {
    total: number;
    thisMonth: number;
    thisWeek: number;
    today: number;
    byModel: Record<string, number>;
  };
  memory: {
    totalFacts: number;
    activeFacts: number;
    factsByCategory: Record<string, number>;
    totalEmbeddings: number;
    totalSummaries: number;
  };
  sessions: {
    total: number;
    archived: number;
    totalMessages: number;
  };
}

export interface BackupData {
  version: string;
  exportedAt: string;
  user: {
    email: string;
    displayName: string | null;
    settings: Record<string, unknown>;
  };
  savedPrompts: SavedPrompt[];
  sessions: Array<{
    id: string;
    title: string;
    mode: string;
    createdAt: string;
    messages: Array<{
      role: string;
      content: string;
      createdAt: string;
    }>;
  }>;
  facts: Array<{
    category: string;
    factKey: string;
    factValue: string;
    confidence: number;
  }>;
  conversationSummaries: Array<{
    sessionId: string;
    summary: string;
    topics: string[];
    sentiment: string;
    keyPoints: string[];
  }>;
}

// === SAVED PROMPTS ===

export async function getSavedPrompts(userId: string): Promise<SavedPrompt[]> {
  const result = await pool.query(
    `SELECT id, user_id, name, description, base_prompt, assistant_additions,
            companion_additions, is_default, created_at, updated_at
     FROM saved_prompts
     WHERE user_id = $1
     ORDER BY is_default DESC, name ASC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    basePrompt: row.base_prompt,
    assistantAdditions: row.assistant_additions,
    companionAdditions: row.companion_additions,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getSavedPrompt(userId: string, promptId: string): Promise<SavedPrompt | null> {
  const result = await pool.query(
    `SELECT id, user_id, name, description, base_prompt, assistant_additions,
            companion_additions, is_default, created_at, updated_at
     FROM saved_prompts
     WHERE id = $1 AND user_id = $2`,
    [promptId, userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    basePrompt: row.base_prompt,
    assistantAdditions: row.assistant_additions,
    companionAdditions: row.companion_additions,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSavedPrompt(
  userId: string,
  data: {
    name: string;
    description?: string;
    basePrompt: string;
    assistantAdditions?: string;
    companionAdditions?: string;
    isDefault?: boolean;
  }
): Promise<SavedPrompt> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // If setting as default, unset any existing default
    if (data.isDefault) {
      await client.query(
        'UPDATE saved_prompts SET is_default = false WHERE user_id = $1',
        [userId]
      );
    }

    const result = await client.query(
      `INSERT INTO saved_prompts (user_id, name, description, base_prompt, assistant_additions, companion_additions, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, name, description, base_prompt, assistant_additions, companion_additions, is_default, created_at, updated_at`,
      [userId, data.name, data.description || null, data.basePrompt, data.assistantAdditions || null, data.companionAdditions || null, data.isDefault || false]
    );

    await client.query('COMMIT');

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      basePrompt: row.base_prompt,
      assistantAdditions: row.assistant_additions,
      companionAdditions: row.companion_additions,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSavedPrompt(
  userId: string,
  promptId: string,
  data: {
    name?: string;
    description?: string;
    basePrompt?: string;
    assistantAdditions?: string;
    companionAdditions?: string;
    isDefault?: boolean;
  }
): Promise<SavedPrompt | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // If setting as default, unset any existing default
    if (data.isDefault) {
      await client.query(
        'UPDATE saved_prompts SET is_default = false WHERE user_id = $1 AND id != $2',
        [userId, promptId]
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.basePrompt !== undefined) {
      updates.push(`base_prompt = $${paramIndex++}`);
      values.push(data.basePrompt);
    }
    if (data.assistantAdditions !== undefined) {
      updates.push(`assistant_additions = $${paramIndex++}`);
      values.push(data.assistantAdditions);
    }
    if (data.companionAdditions !== undefined) {
      updates.push(`companion_additions = $${paramIndex++}`);
      values.push(data.companionAdditions);
    }
    if (data.isDefault !== undefined) {
      updates.push(`is_default = $${paramIndex++}`);
      values.push(data.isDefault);
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return getSavedPrompt(userId, promptId);
    }

    values.push(promptId, userId);

    const result = await client.query(
      `UPDATE saved_prompts
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
       RETURNING id, user_id, name, description, base_prompt, assistant_additions, companion_additions, is_default, created_at, updated_at`,
      values
    );

    await client.query('COMMIT');

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      basePrompt: row.base_prompt,
      assistantAdditions: row.assistant_additions,
      companionAdditions: row.companion_additions,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSavedPrompt(userId: string, promptId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM saved_prompts WHERE id = $1 AND user_id = $2',
    [promptId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setActivePrompt(userId: string, promptId: string | null): Promise<void> {
  await pool.query(
    'UPDATE users SET active_prompt_id = $1 WHERE id = $2',
    [promptId, userId]
  );
}

export async function getActivePrompt(userId: string): Promise<SavedPrompt | null> {
  const result = await pool.query(
    `SELECT sp.id, sp.user_id, sp.name, sp.description, sp.base_prompt,
            sp.assistant_additions, sp.companion_additions, sp.is_default,
            sp.created_at, sp.updated_at
     FROM users u
     JOIN saved_prompts sp ON u.active_prompt_id = sp.id
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    basePrompt: row.base_prompt,
    assistantAdditions: row.assistant_additions,
    companionAdditions: row.companion_additions,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// === STATS ===

export async function getUserStats(userId: string): Promise<UserStats> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get token stats
  const tokenStatsQuery = await pool.query(
    `SELECT
       COALESCE(SUM(m.tokens_used), 0) as total_tokens,
       COALESCE(SUM(CASE WHEN m.created_at >= $2 THEN m.tokens_used ELSE 0 END), 0) as month_tokens,
       COALESCE(SUM(CASE WHEN m.created_at >= $3 THEN m.tokens_used ELSE 0 END), 0) as week_tokens,
       COALESCE(SUM(CASE WHEN m.created_at >= $4 THEN m.tokens_used ELSE 0 END), 0) as today_tokens
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE s.user_id = $1`,
    [userId, startOfMonth, startOfWeek, startOfToday]
  );

  // Get tokens by model
  const tokensByModelQuery = await pool.query(
    `SELECT m.model, COALESCE(SUM(m.tokens_used), 0) as tokens
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE s.user_id = $1 AND m.model IS NOT NULL
     GROUP BY m.model`,
    [userId]
  );

  const tokensByModel: Record<string, number> = {};
  for (const row of tokensByModelQuery.rows) {
    tokensByModel[row.model] = parseInt(row.tokens);
  }

  // Get memory stats
  const factsQuery = await pool.query(
    `SELECT
       COUNT(*) as total_facts,
       COUNT(CASE WHEN is_active THEN 1 END) as active_facts
     FROM user_facts
     WHERE user_id = $1`,
    [userId]
  );

  const factsByCategoryQuery = await pool.query(
    `SELECT category, COUNT(*) as count
     FROM user_facts
     WHERE user_id = $1 AND is_active = true
     GROUP BY category`,
    [userId]
  );

  const factsByCategory: Record<string, number> = {};
  for (const row of factsByCategoryQuery.rows) {
    factsByCategory[row.category] = parseInt(row.count);
  }

  const embeddingsQuery = await pool.query(
    'SELECT COUNT(*) as count FROM message_embeddings WHERE user_id = $1',
    [userId]
  );

  const summariesQuery = await pool.query(
    'SELECT COUNT(*) as count FROM conversation_summaries WHERE user_id = $1',
    [userId]
  );

  // Get session stats
  const sessionsQuery = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN is_archived THEN 1 END) as archived
     FROM sessions
     WHERE user_id = $1`,
    [userId]
  );

  const messagesQuery = await pool.query(
    `SELECT COUNT(*) as count
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE s.user_id = $1`,
    [userId]
  );

  const tokenStats = tokenStatsQuery.rows[0];
  const factsStats = factsQuery.rows[0];
  const sessionsStats = sessionsQuery.rows[0];

  return {
    tokens: {
      total: parseInt(tokenStats.total_tokens),
      thisMonth: parseInt(tokenStats.month_tokens),
      thisWeek: parseInt(tokenStats.week_tokens),
      today: parseInt(tokenStats.today_tokens),
      byModel: tokensByModel,
    },
    memory: {
      totalFacts: parseInt(factsStats.total_facts),
      activeFacts: parseInt(factsStats.active_facts),
      factsByCategory,
      totalEmbeddings: parseInt(embeddingsQuery.rows[0].count),
      totalSummaries: parseInt(summariesQuery.rows[0].count),
    },
    sessions: {
      total: parseInt(sessionsStats.total),
      archived: parseInt(sessionsStats.archived),
      totalMessages: parseInt(messagesQuery.rows[0].count),
    },
  };
}

// === BACKUP & RESTORE ===

export async function exportUserData(userId: string): Promise<BackupData> {
  // Get user info
  const userResult = await pool.query(
    'SELECT email, display_name, settings FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = userResult.rows[0];

  // Get saved prompts
  const savedPrompts = await getSavedPrompts(userId);

  // Get sessions with messages
  const sessionsResult = await pool.query(
    `SELECT id, title, mode, created_at
     FROM sessions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const sessions: Array<{
    id: string;
    title: string;
    mode: string;
    createdAt: string;
    messages: Array<{ role: string; content: string; createdAt: string }>;
  }> = [];
  for (const session of sessionsResult.rows) {
    const messagesResult = await pool.query(
      `SELECT role, content, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [session.id]
    );

    sessions.push({
      id: session.id,
      title: session.title,
      mode: session.mode,
      createdAt: session.created_at.toISOString(),
      messages: messagesResult.rows.map(m => ({
        role: m.role,
        content: m.content,
        createdAt: m.created_at.toISOString(),
      })),
    });
  }

  // Get facts
  const factsResult = await pool.query(
    `SELECT category, fact_key, fact_value, confidence
     FROM user_facts
     WHERE user_id = $1 AND is_active = true
     ORDER BY category, fact_key`,
    [userId]
  );

  const facts = factsResult.rows.map(f => ({
    category: f.category,
    factKey: f.fact_key,
    factValue: f.fact_value,
    confidence: f.confidence,
  }));

  // Get conversation summaries
  const summariesResult = await pool.query(
    `SELECT session_id, summary, topics, sentiment, key_points
     FROM conversation_summaries
     WHERE user_id = $1`,
    [userId]
  );

  const conversationSummaries = summariesResult.rows.map(s => ({
    sessionId: s.session_id,
    summary: s.summary,
    topics: s.topics || [],
    sentiment: s.sentiment,
    keyPoints: s.key_points || [],
  }));

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      displayName: user.display_name,
      settings: user.settings,
    },
    savedPrompts,
    sessions,
    facts,
    conversationSummaries,
  };
}

export async function importUserData(userId: string, data: BackupData): Promise<{ imported: { sessions: number; facts: number; prompts: number } }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let importedSessions = 0;
    let importedFacts = 0;
    let importedPrompts = 0;

    // Import saved prompts
    for (const prompt of data.savedPrompts || []) {
      try {
        await client.query(
          `INSERT INTO saved_prompts (user_id, name, description, base_prompt, assistant_additions, companion_additions, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, false)
           ON CONFLICT (user_id, name) DO UPDATE SET
             description = EXCLUDED.description,
             base_prompt = EXCLUDED.base_prompt,
             assistant_additions = EXCLUDED.assistant_additions,
             companion_additions = EXCLUDED.companion_additions`,
          [userId, prompt.name, prompt.description, prompt.basePrompt, prompt.assistantAdditions, prompt.companionAdditions]
        );
        importedPrompts++;
      } catch (error) {
        logger.warn('Failed to import prompt', { name: prompt.name, error: (error as Error).message });
      }
    }

    // Import facts
    for (const fact of data.facts || []) {
      try {
        await client.query(
          `INSERT INTO user_facts (user_id, category, fact_key, fact_value, confidence)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, category, fact_key) DO UPDATE SET
             fact_value = EXCLUDED.fact_value,
             confidence = EXCLUDED.confidence,
             is_active = true`,
          [userId, fact.category, fact.factKey, fact.factValue, fact.confidence]
        );
        importedFacts++;
      } catch (error) {
        logger.warn('Failed to import fact', { factKey: fact.factKey, error: (error as Error).message });
      }
    }

    // Import sessions with messages
    for (const session of data.sessions || []) {
      try {
        const sessionResult = await client.query(
          `INSERT INTO sessions (user_id, title, mode, created_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [userId, session.title, session.mode, session.createdAt]
        );

        const sessionId = sessionResult.rows[0].id;

        for (const message of session.messages || []) {
          await client.query(
            `INSERT INTO messages (session_id, role, content, created_at)
             VALUES ($1, $2, $3, $4)`,
            [sessionId, message.role, message.content, message.createdAt]
          );
        }

        importedSessions++;
      } catch (error) {
        logger.warn('Failed to import session', { title: session.title, error: (error as Error).message });
      }
    }

    await client.query('COMMIT');

    return {
      imported: {
        sessions: importedSessions,
        facts: importedFacts,
        prompts: importedPrompts,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// === CLEAR DATA ===

export async function clearMemory(userId: string): Promise<{ deleted: { facts: number; embeddings: number; summaries: number } }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const factsResult = await client.query(
      'DELETE FROM user_facts WHERE user_id = $1',
      [userId]
    );

    const embeddingsResult = await client.query(
      'DELETE FROM message_embeddings WHERE user_id = $1',
      [userId]
    );

    const summariesResult = await client.query(
      'DELETE FROM conversation_summaries WHERE user_id = $1',
      [userId]
    );

    await client.query('COMMIT');

    return {
      deleted: {
        facts: factsResult.rowCount ?? 0,
        embeddings: embeddingsResult.rowCount ?? 0,
        summaries: summariesResult.rowCount ?? 0,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function clearAllData(userId: string): Promise<{ deleted: { sessions: number; messages: number; facts: number; embeddings: number; summaries: number; prompts: number } }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clear active prompt reference first
    await client.query(
      'UPDATE users SET active_prompt_id = NULL WHERE id = $1',
      [userId]
    );

    // Delete saved prompts
    const promptsResult = await client.query(
      'DELETE FROM saved_prompts WHERE user_id = $1',
      [userId]
    );

    // Delete facts
    const factsResult = await client.query(
      'DELETE FROM user_facts WHERE user_id = $1',
      [userId]
    );

    // Delete embeddings
    const embeddingsResult = await client.query(
      'DELETE FROM message_embeddings WHERE user_id = $1',
      [userId]
    );

    // Delete summaries
    const summariesResult = await client.query(
      'DELETE FROM conversation_summaries WHERE user_id = $1',
      [userId]
    );

    // Get message count before deleting sessions (CASCADE will delete messages)
    const messagesCountResult = await client.query(
      `SELECT COUNT(*) as count FROM messages m
       JOIN sessions s ON m.session_id = s.id
       WHERE s.user_id = $1`,
      [userId]
    );

    // Delete sessions (will CASCADE delete messages)
    const sessionsResult = await client.query(
      'DELETE FROM sessions WHERE user_id = $1',
      [userId]
    );

    await client.query('COMMIT');

    return {
      deleted: {
        sessions: sessionsResult.rowCount ?? 0,
        messages: parseInt(messagesCountResult.rows[0].count),
        facts: factsResult.rowCount ?? 0,
        embeddings: embeddingsResult.rowCount ?? 0,
        summaries: summariesResult.rowCount ?? 0,
        prompts: promptsResult.rowCount ?? 0,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
