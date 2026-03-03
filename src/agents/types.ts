/**
 * Agent Registry - Type Definitions
 *
 * Central type system for the unified agent registry.
 * All agent definitions (chat modes, specialists, friends, departments, etc.)
 * are stored in the agent_definitions table and loaded into memory at startup.
 */

// ============================================
// Core Types
// ============================================

export type AgentCategory =
  | 'chat_mode'      // companion, assistant, dj_luna, ceo_luna, voice, trading
  | 'specialist'     // coder-claude, coder-gemini, researcher, writer, analyst, etc.
  | 'friend'         // Nova (friend), Sage, Spark, Echo
  | 'council'        // council members (future)
  | 'department'     // finance, marketing, development, research
  | 'utility';       // debugger, project-planner, project-generator

export type ToolSetId =
  | 'companion'        // conversational tools (search, email, calendar, todos, workspace, artifacts, etc.)
  | 'assistant'        // companion + sysmon + MCP tools
  | 'dj_luna'          // search, fetch, youtube, media download, suno generate
  | 'ceo_luna'         // assistant + ceo-specific tools (note build, weekly plan, dept history, tasks)
  | 'trading'          // portfolio, prices, indicators, signals, orders, klines, bots, news
  | 'voice'            // search, fetch, todos, calendar, email
  | 'workspace'        // write, read, list, execute
  | 'code_execution'   // workspace tools (alias)
  | 'search'           // web search only
  | 'none';            // no tools

/**
 * Provider strategy determines how the agent's LLM provider/model is selected.
 *
 * - user_config: Uses the user's configured provider/model for a given taskType
 * - fixed: Always uses a specific provider and model
 * - inherit: Inherits from the calling context (used for summoned agents)
 */
export type ProviderStrategy =
  | { type: 'user_config'; taskType: string }
  | { type: 'fixed'; provider: string; model: string }
  | { type: 'inherit' };

// ============================================
// Agent Definition (mirrors DB schema)
// ============================================

export interface AgentDefinition {
  id: string;
  name: string;
  category: AgentCategory;

  // Prompt
  basePromptId: string | null;
  promptTemplate: string;
  promptComposable: boolean;

  // Provider
  providerStrategy: ProviderStrategy;
  temperature: number;
  maxTokens: number | null;

  // Tools
  toolSets: ToolSetId[];
  additionalTools: string[];

  // Summoning
  canBeSummoned: boolean;
  canSummon: string[];
  summonProvider: ProviderStrategy | null;

  // Presentation
  avatarEmoji: string | null;
  color: string | null;
  personality: string | null;

  // Constraints
  maxResponseTokens: number | null;
  cacheTierEnabled: boolean;

  // Metadata
  isBuiltin: boolean;
  isActive: boolean;
  sortOrder: number;
  userId: string | null;
  builtinParentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Inter-Agent Communication
// ============================================

export interface SummonRequest {
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  conversationContext: string;
  sessionId: string;
  userId: string;
}

export interface SummonResult {
  agentId: string;
  agentName: string;
  response: string;
  tokensUsed: number;
}

// ============================================
// Helper for mapping DB rows
// ============================================

export function mapAgentRow(row: Record<string, unknown>): AgentDefinition {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as AgentCategory,
    basePromptId: row.base_prompt_id as string | null,
    promptTemplate: row.prompt_template as string,
    promptComposable: row.prompt_composable as boolean,
    providerStrategy: row.provider_strategy as ProviderStrategy,
    temperature: row.temperature as number,
    maxTokens: row.max_tokens as number | null,
    toolSets: ((row.tool_sets as string[] | null) || []) as ToolSetId[],
    additionalTools: (row.additional_tools as string[] | null) || [],
    canBeSummoned: row.can_be_summoned as boolean,
    canSummon: (row.can_summon as string[] | null) || [],
    summonProvider: row.summon_provider as ProviderStrategy | null,
    avatarEmoji: row.avatar_emoji as string | null,
    color: row.color as string | null,
    personality: row.personality as string | null,
    maxResponseTokens: row.max_response_tokens as number | null,
    cacheTierEnabled: row.cache_tier_enabled as boolean,
    isBuiltin: row.is_builtin as boolean,
    isActive: row.is_active as boolean,
    sortOrder: row.sort_order as number,
    userId: row.user_id as string | null,
    builtinParentId: row.builtin_parent_id as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
