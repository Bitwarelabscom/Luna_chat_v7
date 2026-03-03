/**
 * Agent Settings Service
 *
 * CRUD for custom agents, per-user overrides of builtins, tool options.
 */

import { pool } from '../db/index.js';
import type { AgentDefinition, AgentCategory, ToolSetId, ProviderStrategy } from './types.js';
import { mapAgentRow } from './types.js';
import { refreshUserAgents } from './registry.js';

// ============================================
// DTO types
// ============================================

export interface AgentWithOverrideInfo extends AgentDefinition {
  isOverridden: boolean;
  overrideId: string | null;
}

export interface CreateAgentData {
  name: string;
  category: AgentCategory;
  basePromptId?: string | null;
  promptTemplate: string;
  promptComposable?: boolean;
  providerStrategy: ProviderStrategy;
  temperature?: number;
  maxTokens?: number | null;
  toolSets?: ToolSetId[];
  additionalTools?: string[];
  canBeSummoned?: boolean;
  canSummon?: string[];
  avatarEmoji?: string | null;
  color?: string | null;
  personality?: string | null;
  maxResponseTokens?: number | null;
  cacheTierEnabled?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdateAgentData = Partial<CreateAgentData>;

export interface ToolSetOption {
  id: ToolSetId;
  label: string;
  description: string;
}

export interface ToolOption {
  name: string;
  description: string;
  includedInSets: ToolSetId[];
}

// ============================================
// Agent CRUD
// ============================================

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Get all agents for a user: builtins merged with overrides + custom agents.
 */
export async function getUserAgents(userId: string): Promise<AgentWithOverrideInfo[]> {
  const [builtinResult, userResult] = await Promise.all([
    pool.query('SELECT * FROM agent_definitions WHERE is_builtin = true AND user_id IS NULL ORDER BY sort_order ASC'),
    pool.query('SELECT * FROM agent_definitions WHERE user_id = $1 ORDER BY sort_order ASC', [userId]),
  ]);

  const builtins = builtinResult.rows.map(r => mapAgentRow(r as Record<string, unknown>));
  const userRows = userResult.rows.map(r => mapAgentRow(r as Record<string, unknown>));

  // Separate user rows into overrides and custom agents
  const overrideMap = new Map<string, AgentDefinition>();
  const customAgents: AgentDefinition[] = [];

  for (const row of userRows) {
    if (row.builtinParentId) {
      overrideMap.set(row.builtinParentId, row);
    } else {
      customAgents.push(row);
    }
  }

  // Merge builtins with overrides
  const result: AgentWithOverrideInfo[] = [];
  for (const builtin of builtins) {
    const override = overrideMap.get(builtin.id);
    if (override) {
      result.push({
        ...override,
        id: builtin.id, // Keep the original builtin ID for display
        isOverridden: true,
        overrideId: override.id,
      });
    } else {
      result.push({ ...builtin, isOverridden: false, overrideId: null });
    }
  }

  // Add custom agents
  for (const custom of customAgents) {
    result.push({ ...custom, isOverridden: false, overrideId: null });
  }

  return result;
}

/**
 * Get a single agent resolved with user override.
 */
export async function getUserAgent(userId: string, agentId: string): Promise<AgentWithOverrideInfo | null> {
  // Check for user override first
  const overrideResult = await pool.query(
    'SELECT * FROM agent_definitions WHERE user_id = $1 AND builtin_parent_id = $2',
    [userId, agentId]
  );
  if (overrideResult.rows.length > 0) {
    const override = mapAgentRow(overrideResult.rows[0] as Record<string, unknown>);
    return { ...override, id: agentId, isOverridden: true, overrideId: override.id };
  }

  // Check for custom agent by ID
  const customResult = await pool.query(
    'SELECT * FROM agent_definitions WHERE id = $1 AND user_id = $2 AND builtin_parent_id IS NULL',
    [agentId, userId]
  );
  if (customResult.rows.length > 0) {
    const custom = mapAgentRow(customResult.rows[0] as Record<string, unknown>);
    return { ...custom, isOverridden: false, overrideId: null };
  }

  // Fall back to builtin
  const builtinResult = await pool.query(
    'SELECT * FROM agent_definitions WHERE id = $1 AND is_builtin = true AND user_id IS NULL',
    [agentId]
  );
  if (builtinResult.rows.length > 0) {
    const builtin = mapAgentRow(builtinResult.rows[0] as Record<string, unknown>);
    return { ...builtin, isOverridden: false, overrideId: null };
  }

  return null;
}

/**
 * Create a custom agent.
 */
export async function createUserAgent(userId: string, data: CreateAgentData): Promise<AgentDefinition> {
  const id = slugify(data.name) + '-' + Date.now().toString(36);

  const result = await pool.query(
    `INSERT INTO agent_definitions (
      id, name, category, base_prompt_id, prompt_template, prompt_composable,
      provider_strategy, temperature, max_tokens,
      tool_sets, additional_tools,
      can_be_summoned, can_summon,
      avatar_emoji, color, personality,
      max_response_tokens, cache_tier_enabled,
      is_builtin, is_active, sort_order, user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, false, $19, $20, $21)
    RETURNING *`,
    [
      id,
      data.name,
      data.category,
      data.basePromptId ?? null,
      data.promptTemplate,
      data.promptComposable ?? false,
      JSON.stringify(data.providerStrategy),
      data.temperature ?? 0.7,
      data.maxTokens ?? null,
      data.toolSets ?? [],
      data.additionalTools ?? [],
      data.canBeSummoned ?? false,
      data.canSummon ?? [],
      data.avatarEmoji ?? null,
      data.color ?? null,
      data.personality ?? null,
      data.maxResponseTokens ?? null,
      data.cacheTierEnabled ?? false,
      data.isActive ?? true,
      data.sortOrder ?? 50,
      userId,
    ]
  );

  await refreshUserAgents(userId);
  return mapAgentRow(result.rows[0] as Record<string, unknown>);
}

/**
 * Update a custom agent (not builtins - use saveBuiltinOverride for those).
 */
export async function updateUserAgent(userId: string, agentId: string, data: UpdateAgentData): Promise<AgentDefinition | null> {
  // Verify it's a custom agent belonging to this user
  const check = await pool.query(
    'SELECT id FROM agent_definitions WHERE id = $1 AND user_id = $2 AND builtin_parent_id IS NULL AND is_builtin = false',
    [agentId, userId]
  );
  if (check.rows.length === 0) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  const fields: Array<[string, keyof UpdateAgentData, (v: unknown) => unknown]> = [
    ['name', 'name', v => v],
    ['category', 'category', v => v],
    ['base_prompt_id', 'basePromptId', v => v],
    ['prompt_template', 'promptTemplate', v => v],
    ['prompt_composable', 'promptComposable', v => v],
    ['provider_strategy', 'providerStrategy', v => JSON.stringify(v)],
    ['temperature', 'temperature', v => v],
    ['max_tokens', 'maxTokens', v => v],
    ['tool_sets', 'toolSets', v => v],
    ['additional_tools', 'additionalTools', v => v],
    ['can_be_summoned', 'canBeSummoned', v => v],
    ['can_summon', 'canSummon', v => v],
    ['avatar_emoji', 'avatarEmoji', v => v],
    ['color', 'color', v => v],
    ['personality', 'personality', v => v],
    ['max_response_tokens', 'maxResponseTokens', v => v],
    ['cache_tier_enabled', 'cacheTierEnabled', v => v],
    ['is_active', 'isActive', v => v],
    ['sort_order', 'sortOrder', v => v],
  ];

  for (const [col, key, transform] of fields) {
    if (data[key] !== undefined) {
      sets.push(`${col} = $${idx}`);
      vals.push(transform(data[key]));
      idx++;
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  vals.push(agentId, userId);

  const result = await pool.query(
    `UPDATE agent_definitions SET ${sets.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    vals
  );

  if (result.rows.length === 0) return null;

  await refreshUserAgents(userId);
  return mapAgentRow(result.rows[0] as Record<string, unknown>);
}

/**
 * Delete a custom agent (refuses builtins).
 */
export async function deleteUserAgent(userId: string, agentId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM agent_definitions WHERE id = $1 AND user_id = $2 AND is_builtin = false AND builtin_parent_id IS NULL',
    [agentId, userId]
  );
  if ((result.rowCount ?? 0) > 0) {
    await refreshUserAgents(userId);
    return true;
  }
  return false;
}

// ============================================
// Builtin Overrides
// ============================================

/**
 * Save (upsert) a user override for a builtin agent.
 */
export async function saveBuiltinOverride(userId: string, builtinId: string, data: UpdateAgentData): Promise<AgentDefinition> {
  // Verify builtin exists
  const builtinResult = await pool.query(
    'SELECT * FROM agent_definitions WHERE id = $1 AND is_builtin = true AND user_id IS NULL',
    [builtinId]
  );
  if (builtinResult.rows.length === 0) {
    throw new Error(`Builtin agent '${builtinId}' not found`);
  }
  const builtin = mapAgentRow(builtinResult.rows[0] as Record<string, unknown>);

  // Check if override already exists
  const existingResult = await pool.query(
    'SELECT id FROM agent_definitions WHERE user_id = $1 AND builtin_parent_id = $2',
    [userId, builtinId]
  );

  if (existingResult.rows.length > 0) {
    // Update existing override
    const overrideId = (existingResult.rows[0] as Record<string, unknown>).id as string;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    const mergedFields: Array<[string, keyof UpdateAgentData, unknown, (v: unknown) => unknown]> = [
      ['name', 'name', builtin.name, v => v],
      ['category', 'category', builtin.category, v => v],
      ['base_prompt_id', 'basePromptId', builtin.basePromptId, v => v],
      ['prompt_template', 'promptTemplate', builtin.promptTemplate, v => v],
      ['prompt_composable', 'promptComposable', builtin.promptComposable, v => v],
      ['provider_strategy', 'providerStrategy', builtin.providerStrategy, v => JSON.stringify(v)],
      ['temperature', 'temperature', builtin.temperature, v => v],
      ['max_tokens', 'maxTokens', builtin.maxTokens, v => v],
      ['tool_sets', 'toolSets', builtin.toolSets, v => v],
      ['additional_tools', 'additionalTools', builtin.additionalTools, v => v],
      ['can_be_summoned', 'canBeSummoned', builtin.canBeSummoned, v => v],
      ['can_summon', 'canSummon', builtin.canSummon, v => v],
      ['avatar_emoji', 'avatarEmoji', builtin.avatarEmoji, v => v],
      ['color', 'color', builtin.color, v => v],
      ['personality', 'personality', builtin.personality, v => v],
      ['max_response_tokens', 'maxResponseTokens', builtin.maxResponseTokens, v => v],
      ['cache_tier_enabled', 'cacheTierEnabled', builtin.cacheTierEnabled, v => v],
      ['is_active', 'isActive', builtin.isActive, v => v],
      ['sort_order', 'sortOrder', builtin.sortOrder, v => v],
    ];

    for (const [col, key, _default, transform] of mergedFields) {
      if (data[key] !== undefined) {
        sets.push(`${col} = $${idx}`);
        vals.push(transform(data[key]));
        idx++;
      }
    }

    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      vals.push(overrideId);
      await pool.query(
        `UPDATE agent_definitions SET ${sets.join(', ')} WHERE id = $${idx}`,
        vals
      );
    }

    const updated = await pool.query('SELECT * FROM agent_definitions WHERE id = $1', [overrideId]);
    await refreshUserAgents(userId);
    return mapAgentRow(updated.rows[0] as Record<string, unknown>);
  } else {
    // Create new override by copying builtin and applying changes
    const overrideId = `override-${builtinId}-${userId.slice(0, 8)}`;

    const result = await pool.query(
      `INSERT INTO agent_definitions (
        id, name, category, base_prompt_id, prompt_template, prompt_composable,
        provider_strategy, temperature, max_tokens,
        tool_sets, additional_tools,
        can_be_summoned, can_summon, summon_provider,
        avatar_emoji, color, personality,
        max_response_tokens, cache_tier_enabled,
        is_builtin, is_active, sort_order, user_id, builtin_parent_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, false, $20, $21, $22, $23)
      RETURNING *`,
      [
        overrideId,
        data.name ?? builtin.name,
        data.category ?? builtin.category,
        data.basePromptId !== undefined ? data.basePromptId : builtin.basePromptId,
        data.promptTemplate ?? builtin.promptTemplate,
        data.promptComposable ?? builtin.promptComposable,
        JSON.stringify(data.providerStrategy ?? builtin.providerStrategy),
        data.temperature ?? builtin.temperature,
        data.maxTokens !== undefined ? data.maxTokens : builtin.maxTokens,
        data.toolSets ?? builtin.toolSets,
        data.additionalTools ?? builtin.additionalTools,
        data.canBeSummoned ?? builtin.canBeSummoned,
        data.canSummon ?? builtin.canSummon,
        builtin.summonProvider ? JSON.stringify(builtin.summonProvider) : null,
        data.avatarEmoji !== undefined ? data.avatarEmoji : builtin.avatarEmoji,
        data.color !== undefined ? data.color : builtin.color,
        data.personality !== undefined ? data.personality : builtin.personality,
        data.maxResponseTokens !== undefined ? data.maxResponseTokens : builtin.maxResponseTokens,
        data.cacheTierEnabled ?? builtin.cacheTierEnabled,
        data.isActive ?? builtin.isActive,
        data.sortOrder ?? builtin.sortOrder,
        userId,
        builtinId,
      ]
    );

    await refreshUserAgents(userId);
    return mapAgentRow(result.rows[0] as Record<string, unknown>);
  }
}

/**
 * Reset a builtin override, restoring defaults.
 */
export async function resetBuiltinOverride(userId: string, builtinId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM agent_definitions WHERE user_id = $1 AND builtin_parent_id = $2',
    [userId, builtinId]
  );
  if ((result.rowCount ?? 0) > 0) {
    await refreshUserAgents(userId);
    return true;
  }
  return false;
}

// ============================================
// Tool Options
// ============================================

const TOOL_SET_OPTIONS: ToolSetOption[] = [
  { id: 'companion', label: 'Companion', description: 'Conversational tools (search, email, calendar, todos, workspace, artifacts)' },
  { id: 'assistant', label: 'Assistant', description: 'Companion + sysmon + MCP tools' },
  { id: 'dj_luna', label: 'DJ Luna', description: 'Search, fetch, YouTube, media download, Suno generate' },
  { id: 'ceo_luna', label: 'CEO Luna', description: 'Assistant + CEO-specific tools (build notes, weekly plan, dept history, tasks)' },
  { id: 'trading', label: 'Trading', description: 'Portfolio, prices, indicators, signals, orders, klines, bots, news' },
  { id: 'voice', label: 'Voice', description: 'Search, fetch, todos, calendar, email' },
  { id: 'workspace', label: 'Workspace', description: 'Write, read, list, execute' },
  { id: 'code_execution', label: 'Code Execution', description: 'Workspace tools (alias)' },
  { id: 'search', label: 'Search', description: 'Web search only' },
  { id: 'none', label: 'None', description: 'No tools' },
];

const INDIVIDUAL_TOOLS: ToolOption[] = [
  { name: 'web_search', description: 'Search the web', includedInSets: ['companion', 'assistant', 'dj_luna', 'ceo_luna', 'voice', 'search'] },
  { name: 'fetch_url', description: 'Fetch URL content', includedInSets: ['companion', 'assistant', 'dj_luna', 'ceo_luna', 'voice'] },
  { name: 'youtube_search', description: 'Search YouTube', includedInSets: ['companion', 'assistant', 'dj_luna', 'ceo_luna'] },
  { name: 'media_search', description: 'Search local media library', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'media_play', description: 'Play local media', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'media_download', description: 'Download media', includedInSets: ['companion', 'assistant', 'dj_luna', 'ceo_luna'] },
  { name: 'send_email', description: 'Send email', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'check_email', description: 'Check inbox', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'read_email', description: 'Read email', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'delete_email', description: 'Delete email', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'reply_email', description: 'Reply to email', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'send_telegram', description: 'Send Telegram message', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'list_todos', description: 'List todos', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'create_todo', description: 'Create todo', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'complete_todo', description: 'Complete todo', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'update_todo', description: 'Update todo', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'create_calendar_event', description: 'Create calendar event', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'list_calendar_events', description: 'List calendar events', includedInSets: ['companion', 'assistant', 'ceo_luna', 'voice'] },
  { name: 'workspace_write', description: 'Write file to workspace', includedInSets: ['companion', 'assistant', 'ceo_luna', 'workspace', 'code_execution'] },
  { name: 'workspace_read', description: 'Read file from workspace', includedInSets: ['companion', 'assistant', 'ceo_luna', 'workspace', 'code_execution'] },
  { name: 'workspace_list', description: 'List workspace files', includedInSets: ['companion', 'assistant', 'ceo_luna', 'workspace', 'code_execution'] },
  { name: 'workspace_execute', description: 'Execute workspace script', includedInSets: ['companion', 'assistant', 'ceo_luna', 'workspace', 'code_execution'] },
  { name: 'session_note', description: 'Note session insight', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'generate_image', description: 'Generate AI image', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'open_url', description: 'Open URL in browser', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'delegate_to_agent', description: 'Delegate task to specialist', includedInSets: ['companion', 'assistant', 'ceo_luna'] },
  { name: 'suno_generate', description: 'Generate music with Suno', includedInSets: ['dj_luna'] },
  { name: 'ceo_note_build', description: 'Note build progress', includedInSets: ['ceo_luna'] },
  { name: 'commit_weekly_plan', description: 'Commit weekly plan', includedInSets: ['ceo_luna'] },
  { name: 'query_department_history', description: 'Query department history', includedInSets: ['ceo_luna'] },
  { name: 'start_task', description: 'Start background task', includedInSets: ['ceo_luna'] },
  { name: 'get_task_status', description: 'Get task status', includedInSets: ['ceo_luna'] },
];

export function getToolOptions(): { toolSets: ToolSetOption[]; tools: ToolOption[] } {
  return { toolSets: TOOL_SET_OPTIONS, tools: INDIVIDUAL_TOOLS };
}
