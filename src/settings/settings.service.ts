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

// === ENHANCED STATS (with model breakdown by time period and costs) ===

export interface ModelPeriodStats {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  cost: number;
}

export interface EnhancedStats {
  tokens: {
    today: ModelPeriodStats;
    thisWeek: ModelPeriodStats;
    thisMonth: ModelPeriodStats;
    total: ModelPeriodStats;
  };
  byModel: Record<string, {
    today: ModelPeriodStats;
    thisWeek: ModelPeriodStats;
    thisMonth: ModelPeriodStats;
    total: ModelPeriodStats;
  }>;
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

export async function getEnhancedStats(userId: string): Promise<EnhancedStats> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get detailed token stats by model and time period (excluding Ollama for cost calculations)
  const modelStatsQuery = await pool.query(
    `SELECT
       m.model,
       m.provider,
       COALESCE(SUM(m.input_tokens), 0) as input_tokens,
       COALESCE(SUM(m.output_tokens), 0) as output_tokens,
       COALESCE(SUM(m.cache_tokens), 0) as cache_tokens,
       COALESCE(SUM(m.tokens_used), 0) as total_tokens,
       COALESCE(SUM(CASE WHEN m.created_at >= $2 THEN m.input_tokens ELSE 0 END), 0) as today_input,
       COALESCE(SUM(CASE WHEN m.created_at >= $2 THEN m.output_tokens ELSE 0 END), 0) as today_output,
       COALESCE(SUM(CASE WHEN m.created_at >= $2 THEN m.cache_tokens ELSE 0 END), 0) as today_cache,
       COALESCE(SUM(CASE WHEN m.created_at >= $2 THEN m.tokens_used ELSE 0 END), 0) as today_total,
       COALESCE(SUM(CASE WHEN m.created_at >= $3 THEN m.input_tokens ELSE 0 END), 0) as week_input,
       COALESCE(SUM(CASE WHEN m.created_at >= $3 THEN m.output_tokens ELSE 0 END), 0) as week_output,
       COALESCE(SUM(CASE WHEN m.created_at >= $3 THEN m.cache_tokens ELSE 0 END), 0) as week_cache,
       COALESCE(SUM(CASE WHEN m.created_at >= $3 THEN m.tokens_used ELSE 0 END), 0) as week_total,
       COALESCE(SUM(CASE WHEN m.created_at >= $4 THEN m.input_tokens ELSE 0 END), 0) as month_input,
       COALESCE(SUM(CASE WHEN m.created_at >= $4 THEN m.output_tokens ELSE 0 END), 0) as month_output,
       COALESCE(SUM(CASE WHEN m.created_at >= $4 THEN m.cache_tokens ELSE 0 END), 0) as month_cache,
       COALESCE(SUM(CASE WHEN m.created_at >= $4 THEN m.tokens_used ELSE 0 END), 0) as month_total
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE s.user_id = $1 AND m.model IS NOT NULL
     GROUP BY m.model, m.provider`,
    [userId, startOfToday, startOfWeek, startOfMonth]
  );

  // Initialize totals
  const totals = {
    today: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, cost: 0 },
    thisWeek: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, cost: 0 },
    thisMonth: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, cost: 0 },
    total: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, cost: 0 },
  };

  const byModel: EnhancedStats['byModel'] = {};

  for (const row of modelStatsQuery.rows) {
    const model = row.model;
    const isOllama = row.provider === 'ollama';

    // Parse values
    const todayStats = {
      inputTokens: parseInt(row.today_input) || 0,
      outputTokens: parseInt(row.today_output) || 0,
      cacheTokens: parseInt(row.today_cache) || 0,
      totalTokens: parseInt(row.today_total) || 0,
      cost: isOllama ? 0 : calculateCost(model, parseInt(row.today_input) || 0, parseInt(row.today_output) || 0),
    };
    const weekStats = {
      inputTokens: parseInt(row.week_input) || 0,
      outputTokens: parseInt(row.week_output) || 0,
      cacheTokens: parseInt(row.week_cache) || 0,
      totalTokens: parseInt(row.week_total) || 0,
      cost: isOllama ? 0 : calculateCost(model, parseInt(row.week_input) || 0, parseInt(row.week_output) || 0),
    };
    const monthStats = {
      inputTokens: parseInt(row.month_input) || 0,
      outputTokens: parseInt(row.month_output) || 0,
      cacheTokens: parseInt(row.month_cache) || 0,
      totalTokens: parseInt(row.month_total) || 0,
      cost: isOllama ? 0 : calculateCost(model, parseInt(row.month_input) || 0, parseInt(row.month_output) || 0),
    };
    const totalStats = {
      inputTokens: parseInt(row.input_tokens) || 0,
      outputTokens: parseInt(row.output_tokens) || 0,
      cacheTokens: parseInt(row.cache_tokens) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      cost: isOllama ? 0 : calculateCost(model, parseInt(row.input_tokens) || 0, parseInt(row.output_tokens) || 0),
    };

    byModel[model] = { today: todayStats, thisWeek: weekStats, thisMonth: monthStats, total: totalStats };

    // Only add to totals if not Ollama (for cost tracking)
    if (!isOllama) {
      totals.today.inputTokens += todayStats.inputTokens;
      totals.today.outputTokens += todayStats.outputTokens;
      totals.today.cacheTokens += todayStats.cacheTokens;
      totals.today.totalTokens += todayStats.totalTokens;
      totals.today.cost += todayStats.cost;

      totals.thisWeek.inputTokens += weekStats.inputTokens;
      totals.thisWeek.outputTokens += weekStats.outputTokens;
      totals.thisWeek.cacheTokens += weekStats.cacheTokens;
      totals.thisWeek.totalTokens += weekStats.totalTokens;
      totals.thisWeek.cost += weekStats.cost;

      totals.thisMonth.inputTokens += monthStats.inputTokens;
      totals.thisMonth.outputTokens += monthStats.outputTokens;
      totals.thisMonth.cacheTokens += monthStats.cacheTokens;
      totals.thisMonth.totalTokens += monthStats.totalTokens;
      totals.thisMonth.cost += monthStats.cost;

      totals.total.inputTokens += totalStats.inputTokens;
      totals.total.outputTokens += totalStats.outputTokens;
      totals.total.cacheTokens += totalStats.cacheTokens;
      totals.total.totalTokens += totalStats.totalTokens;
      totals.total.cost += totalStats.cost;
    }
  }

  // Round costs
  totals.today.cost = Math.round(totals.today.cost * 10000) / 10000;
  totals.thisWeek.cost = Math.round(totals.thisWeek.cost * 10000) / 10000;
  totals.thisMonth.cost = Math.round(totals.thisMonth.cost * 10000) / 10000;
  totals.total.cost = Math.round(totals.total.cost * 10000) / 10000;

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

  const factsStats = factsQuery.rows[0];
  const sessionsStats = sessionsQuery.rows[0];

  return {
    tokens: totals,
    byModel,
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

// === DAILY TOKEN STATS (for header display) ===

export interface DailyTokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<string, { input: number; output: number; cache: number; total: number; cost: number }>;
}

// Model cost lookup (per 1k tokens) - matches types.ts PROVIDERS
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-5.1-chat-latest': { input: 0.00125, output: 0.01 },
  'gpt-5.1-codex': { input: 0.00125, output: 0.01 },
  'gpt-5-mini': { input: 0.00025, output: 0.002 },
  'gpt-5-nano': { input: 0.00005, output: 0.0004 },
  'gpt-4.1': { input: 0.002, output: 0.008 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'o3': { input: 0.002, output: 0.008 },
  'o4-mini': { input: 0.0011, output: 0.0044 },
  // Groq
  'openai/gpt-oss-120b': { input: 0.00015, output: 0.0006 },
  'llama-3.3-70b-versatile': { input: 0.00059, output: 0.00079 },
  'openai/gpt-oss-20b': { input: 0.000075, output: 0.0003 },
  'llama-3.1-8b-instant': { input: 0.00005, output: 0.00008 },
  // Anthropic
  'claude-opus-4-5-20251101': { input: 0.005, output: 0.025 },
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
  // xAI
  'grok-4-1-fast': { input: 0.0002, output: 0.0005 },
  'grok-4-1-fast-non-reasoning-latest': { input: 0.0002, output: 0.0005 },
  'grok-4': { input: 0.003, output: 0.015 },
  'grok-3': { input: 0.003, output: 0.015 },
  'grok-3-mini': { input: 0.0003, output: 0.0005 },
  'grok-2-1212': { input: 0.002, output: 0.01 },
  // Google
  'gemini-3-pro-preview': { input: 0.002, output: 0.012 },
  'gemini-2.5-pro': { input: 0.00125, output: 0.01 },
  'gemini-2.5-flash': { input: 0.0003, output: 0.0025 },
  'gemini-2.5-flash-lite': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gemini-2.0-flash-lite': { input: 0.000075, output: 0.0003 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model];
  if (!costs) return 0; // Free tier or unknown model
  return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
}

export async function getDailyTokenStats(userId: string): Promise<DailyTokenStats> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Get token breakdown by model for today, excluding Ollama
  const result = await pool.query(
    `SELECT
       m.model,
       COALESCE(SUM(m.input_tokens), 0) as input_tokens,
       COALESCE(SUM(m.output_tokens), 0) as output_tokens,
       COALESCE(SUM(m.cache_tokens), 0) as cache_tokens,
       COALESCE(SUM(m.tokens_used), 0) as total_tokens
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE s.user_id = $1
       AND m.created_at >= $2
       AND m.model IS NOT NULL
       AND (m.provider IS NULL OR m.provider != 'ollama')
     GROUP BY m.model`,
    [userId, startOfToday]
  );

  let totalInput = 0;
  let totalOutput = 0;
  let totalCache = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const byModel: DailyTokenStats['byModel'] = {};

  for (const row of result.rows) {
    const input = parseInt(row.input_tokens) || 0;
    const output = parseInt(row.output_tokens) || 0;
    const cache = parseInt(row.cache_tokens) || 0;
    const total = parseInt(row.total_tokens) || 0;
    const cost = calculateCost(row.model, input, output);

    totalInput += input;
    totalOutput += output;
    totalCache += cache;
    totalTokens += total;
    totalCost += cost;

    byModel[row.model] = { input, output, cache, total, cost };
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheTokens: totalCache,
    totalTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000, // Round to 4 decimal places
    byModel,
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
