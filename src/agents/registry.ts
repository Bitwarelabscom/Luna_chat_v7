/**
 * Agent Registry - In-memory cache backed by agent_definitions table
 *
 * Single source of truth for all agent configurations.
 * Loaded at startup, cached in memory with 5-minute TTL.
 */

import { pool } from '../db/index.js';
import type { AgentDefinition, AgentCategory } from './types.js';
import { mapAgentRow } from './types.js';
import logger from '../utils/logger.js';

// ============================================
// In-memory cache
// ============================================

let agentCache = new Map<string, AgentDefinition>();
let categoryCacheMap = new Map<string, AgentDefinition[]>();
let lastRefresh = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Per-user override cache: userId -> (builtinIdOrAgentId -> AgentDefinition)
const userOverrideCache = new Map<string, Map<string, AgentDefinition>>();
const userCacheTimestamps = new Map<string, number>();
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================
// Public API
// ============================================

/**
 * Initialize registry at startup - loads all agents from DB.
 * Should be called once during server boot.
 */
export async function initializeRegistry(): Promise<void> {
  try {
    await refreshAll();
    logger.info('Agent registry initialized', { agentCount: agentCache.size });
  } catch (error) {
    logger.error('Failed to initialize agent registry', { error: (error as Error).message });
    // Don't throw - the system can still work without the registry
    // Individual lookups will try to refresh on demand
  }
}

/**
 * Get a single agent by ID. Returns null if not found.
 */
export function getAgent(id: string): AgentDefinition | null {
  ensureFresh();
  return agentCache.get(id) || null;
}

/**
 * Get all agents in a given category.
 */
export function getAgentsByCategory(category: AgentCategory): AgentDefinition[] {
  ensureFresh();
  return categoryCacheMap.get(category) || [];
}

/**
 * Shorthand for getting a chat mode agent with fallback to companion.
 */
export function getChatModeAgent(mode: string): AgentDefinition | null {
  const agent = getAgent(mode);
  if (agent && agent.category === 'chat_mode') return agent;
  return getAgent('companion');
}

/**
 * Get all active agents.
 */
export function getAllAgents(): AgentDefinition[] {
  ensureFresh();
  return Array.from(agentCache.values());
}

/**
 * Get all summonable agents (for building tool descriptions).
 */
export function getSummonableAgents(): AgentDefinition[] {
  ensureFresh();
  return Array.from(agentCache.values()).filter(a => a.canBeSummoned && a.isActive);
}

/**
 * Reload a single agent from DB (for live updates).
 */
export async function refreshAgent(id: string): Promise<AgentDefinition | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM agent_definitions WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return null;

    const agent = mapAgentRow(result.rows[0] as Record<string, unknown>);
    agentCache.set(id, agent);
    rebuildCategoryCache();
    return agent;
  } catch (error) {
    logger.error('Failed to refresh agent', { id, error: (error as Error).message });
    return null;
  }
}

/**
 * Force refresh all agents from DB.
 */
export async function refreshAll(): Promise<void> {
  const result = await pool.query(
    'SELECT * FROM agent_definitions WHERE is_active = true ORDER BY sort_order ASC'
  );

  const newCache = new Map<string, AgentDefinition>();
  for (const row of result.rows) {
    const agent = mapAgentRow(row as Record<string, unknown>);
    newCache.set(agent.id, agent);
  }

  agentCache = newCache;
  rebuildCategoryCache();
  lastRefresh = Date.now();
}

// ============================================
// Per-user override lookups
// ============================================

/**
 * Get an agent resolved with user-specific overrides/custom agents.
 * Falls back to global builtin if no override exists.
 */
export function getAgentForUser(id: string, userId: string): AgentDefinition | null {
  ensureUserCacheFresh(userId);
  const userMap = userOverrideCache.get(userId);
  if (userMap) {
    const userAgent = userMap.get(id);
    if (userAgent) return userAgent;
  }
  return getAgent(id);
}

/**
 * User-aware chat mode lookup with fallback to companion.
 */
export function getChatModeAgentForUser(mode: string, userId: string): AgentDefinition | null {
  const agent = getAgentForUser(mode, userId);
  if (agent && agent.category === 'chat_mode') return agent;
  return getAgentForUser('companion', userId);
}

/**
 * Reload user overrides + custom agents from DB.
 */
export async function refreshUserAgents(userId: string): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT * FROM agent_definitions WHERE user_id = $1',
      [userId]
    );

    const userMap = new Map<string, AgentDefinition>();
    for (const row of result.rows) {
      const agent = mapAgentRow(row as Record<string, unknown>);
      if (agent.builtinParentId) {
        // Override: key by the builtin parent ID so lookups work
        userMap.set(agent.builtinParentId, agent);
      } else {
        // Custom agent: key by its own ID
        userMap.set(agent.id, agent);
      }
    }

    userOverrideCache.set(userId, userMap);
    userCacheTimestamps.set(userId, Date.now());
  } catch (error) {
    logger.error('Failed to refresh user agents', { userId, error: (error as Error).message });
  }
}

function ensureUserCacheFresh(userId: string): void {
  const ts = userCacheTimestamps.get(userId) || 0;
  if (Date.now() - ts > USER_CACHE_TTL_MS) {
    refreshUserAgents(userId).catch(err =>
      logger.error('Background user agent refresh failed', { userId, error: (err as Error).message })
    );
  }
}

// ============================================
// Department slug mapping (backward compat)
// ============================================

const DEPT_SLUG_TO_AGENT_ID: Record<string, string> = {
  economy: 'finance-dept',
  marketing: 'marketing-dept',
  development: 'development-dept',
  research: 'research-dept',
};

/**
 * Map a department slug ('economy', 'marketing', etc.) to an agent definition.
 * Backward-compatible with the old DEPARTMENT_MAP.
 */
export function getDepartmentAgent(slug: string): AgentDefinition | null {
  const agentId = DEPT_SLUG_TO_AGENT_ID[slug];
  if (!agentId) return null;
  return getAgent(agentId);
}

/**
 * Get all department agents as a slug->agent map (backward compat).
 */
export function getDepartmentMap(): Map<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const [slug, agentId] of Object.entries(DEPT_SLUG_TO_AGENT_ID)) {
    const agent = getAgent(agentId);
    if (agent) map.set(slug, agent);
  }
  return map;
}

// ============================================
// Friend mapping (backward compat)
// ============================================

const FRIEND_AGENT_TO_LEGACY_NAME: Record<string, string> = {
  'nova-friend': 'Nova',
  'sage-friend': 'Sage',
  'spark-friend': 'Spark',
  'echo-friend': 'Echo',
};

/**
 * Get friend agent by legacy name (e.g., 'Nova' -> agent definition).
 */
export function getFriendAgentByName(name: string): AgentDefinition | null {
  const entry = Object.entries(FRIEND_AGENT_TO_LEGACY_NAME).find(([_id, n]) => n === name);
  if (!entry) return null;
  return getAgent(entry[0]);
}

// ============================================
// Internal helpers
// ============================================

function ensureFresh(): void {
  if (Date.now() - lastRefresh > CACHE_TTL_MS) {
    // Async refresh in background - don't block callers
    refreshAll().catch(err =>
      logger.error('Background registry refresh failed', { error: (err as Error).message })
    );
  }
}

function rebuildCategoryCache(): void {
  const newCategoryMap = new Map<string, AgentDefinition[]>();
  for (const agent of agentCache.values()) {
    const list = newCategoryMap.get(agent.category) || [];
    list.push(agent);
    newCategoryMap.set(agent.category, list);
  }
  categoryCacheMap = newCategoryMap;
}
