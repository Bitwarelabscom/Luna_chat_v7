// Coder Settings Service - Manage user preferences for coding agents
import { pool } from '../db/index.js';
import type { ProviderId } from '../llm/types.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface TriggerWords {
  claude: string[];
  gemini: string[];
  api: string[];
  codex: string[];
}

export interface CoderSettings {
  userId: string;
  claudeCliEnabled: boolean;
  geminiCliEnabled: boolean;
  codexCliEnabled: boolean;
  coderApiEnabled: boolean;
  coderApiProvider: ProviderId | null;
  coderApiModel: string | null;
  triggerWords: TriggerWords;
  defaultCoder: 'claude' | 'gemini' | 'api' | 'codex';
}

export type CoderType = 'coder-claude' | 'coder-gemini' | 'coder-api' | 'coder-codex';

// Default trigger words
const DEFAULT_TRIGGER_WORDS: TriggerWords = {
  claude: ['refactor', 'security', 'debug', 'architecture', 'critical', 'production', 'careful', 'edge case'],
  gemini: ['test', 'explain', 'analyze', 'log', 'simple', 'script', 'generate', 'boilerplate', 'documentation'],
  api: [],
  codex: ['quick fix', 'patch', 'codex', 'small refactor', 'fast'],
};

// Default settings for new users
const DEFAULT_SETTINGS: Omit<CoderSettings, 'userId'> = {
  claudeCliEnabled: false,
  geminiCliEnabled: false,
  codexCliEnabled: false,
  coderApiEnabled: false,
  coderApiProvider: null,
  coderApiModel: null,
  triggerWords: DEFAULT_TRIGGER_WORDS,
  defaultCoder: 'claude',
};

// ============================================
// Cache with TTL
// ============================================

interface CacheEntry {
  settings: CoderSettings;
  timestamp: number;
}

const CACHE_TTL_MS = 30 * 1000; // 30 seconds
const settingsCache = new Map<string, CacheEntry>();

export function invalidateCoderSettingsCache(userId: string): void {
  settingsCache.delete(userId);
}

// ============================================
// Database Operations
// ============================================

/**
 * Get coder settings for a user (with caching)
 */
export async function getCoderSettings(userId: string): Promise<CoderSettings> {
  const now = Date.now();

  // Check cache first
  const cached = settingsCache.get(userId);
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.settings;
  }

  try {
    const result = await pool.query(
      `SELECT
        claude_cli_enabled,
        gemini_cli_enabled,
        codex_cli_enabled,
        coder_api_enabled,
        coder_api_provider,
        coder_api_model,
        trigger_words,
        default_coder
       FROM coder_settings
       WHERE user_id = $1`,
      [userId]
    );

    let settings: CoderSettings;

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const triggerWords = (row.trigger_words || {}) as Partial<TriggerWords>;
      settings = {
        userId,
        claudeCliEnabled: row.claude_cli_enabled,
        geminiCliEnabled: row.gemini_cli_enabled,
        codexCliEnabled: row.codex_cli_enabled ?? false,
        coderApiEnabled: row.coder_api_enabled,
        coderApiProvider: row.coder_api_provider as ProviderId | null,
        coderApiModel: row.coder_api_model,
        triggerWords: {
          claude: Array.isArray(triggerWords.claude) ? triggerWords.claude : DEFAULT_TRIGGER_WORDS.claude,
          gemini: Array.isArray(triggerWords.gemini) ? triggerWords.gemini : DEFAULT_TRIGGER_WORDS.gemini,
          api: Array.isArray(triggerWords.api) ? triggerWords.api : DEFAULT_TRIGGER_WORDS.api,
          codex: Array.isArray(triggerWords.codex) ? triggerWords.codex : DEFAULT_TRIGGER_WORDS.codex,
        },
        defaultCoder: row.default_coder || 'claude',
      };
    } else {
      // Return defaults for users without settings
      settings = { userId, ...DEFAULT_SETTINGS };
    }

    // Store in cache
    settingsCache.set(userId, { settings, timestamp: now });

    return settings;
  } catch (error) {
    logger.error('Failed to get coder settings', {
      error: (error as Error).message,
      userId,
    });
    // Return defaults on error
    return { userId, ...DEFAULT_SETTINGS };
  }
}

/**
 * Update coder settings for a user
 */
export async function updateCoderSettings(
  userId: string,
  updates: Partial<Omit<CoderSettings, 'userId'>>
): Promise<CoderSettings> {
  try {
    // Build dynamic update query
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.claudeCliEnabled !== undefined) {
      fields.push(`claude_cli_enabled = $${paramIndex++}`);
      values.push(updates.claudeCliEnabled);
    }
    if (updates.geminiCliEnabled !== undefined) {
      fields.push(`gemini_cli_enabled = $${paramIndex++}`);
      values.push(updates.geminiCliEnabled);
    }
    if (updates.codexCliEnabled !== undefined) {
      fields.push(`codex_cli_enabled = $${paramIndex++}`);
      values.push(updates.codexCliEnabled);
    }
    if (updates.coderApiEnabled !== undefined) {
      fields.push(`coder_api_enabled = $${paramIndex++}`);
      values.push(updates.coderApiEnabled);
    }
    if (updates.coderApiProvider !== undefined) {
      fields.push(`coder_api_provider = $${paramIndex++}`);
      values.push(updates.coderApiProvider);
    }
    if (updates.coderApiModel !== undefined) {
      fields.push(`coder_api_model = $${paramIndex++}`);
      values.push(updates.coderApiModel);
    }
    if (updates.triggerWords !== undefined) {
      fields.push(`trigger_words = $${paramIndex++}`);
      values.push(JSON.stringify(updates.triggerWords));
    }
    if (updates.defaultCoder !== undefined) {
      fields.push(`default_coder = $${paramIndex++}`);
      values.push(updates.defaultCoder);
    }

    values.push(userId);

    if (fields.length > 0) {
      // Use UPSERT to handle both insert and update
      await pool.query(
        `INSERT INTO coder_settings (user_id, ${fields.map(f => f.split(' = ')[0]).join(', ')})
         VALUES ($${paramIndex}, ${values.slice(0, -1).map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET
           ${fields.join(', ')},
           updated_at = NOW()`,
        values
      );
    }

    // Invalidate cache and return updated settings
    invalidateCoderSettingsCache(userId);
    return getCoderSettings(userId);
  } catch (error) {
    logger.error('Failed to update coder settings', {
      error: (error as Error).message,
      userId,
      updates,
    });
    throw error;
  }
}

/**
 * Reset coder settings to defaults
 */
export async function resetCoderSettings(userId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM coder_settings WHERE user_id = $1`, [userId]);
    invalidateCoderSettingsCache(userId);
    logger.debug('Reset coder settings to defaults', { userId });
  } catch (error) {
    logger.error('Failed to reset coder settings', {
      error: (error as Error).message,
      userId,
    });
    throw error;
  }
}

// ============================================
// Routing Logic
// ============================================

/**
 * Parse explicit coder override from message
 * Patterns: @coder-claude, @coder-gemini, @coder-api, @coder-codex
 *           "use coder-claude", "use coder-gemini", "use coder-api", "use coder-codex"
 */
export function parseExplicitOverride(message: string): CoderType | null {
  const lower = message.toLowerCase();

  // @mention patterns
  if (/@coder-claude\b/i.test(message)) return 'coder-claude';
  if (/@coder-gemini\b/i.test(message)) return 'coder-gemini';
  if (/@coder-api\b/i.test(message)) return 'coder-api';
  if (/@coder-codex\b/i.test(message)) return 'coder-codex';

  // "use X" patterns
  if (/\buse\s+coder-claude\b/i.test(lower)) return 'coder-claude';
  if (/\buse\s+coder-gemini\b/i.test(lower)) return 'coder-gemini';
  if (/\buse\s+coder-api\b/i.test(lower)) return 'coder-api';
  if (/\buse\s+coder-codex\b/i.test(lower)) return 'coder-codex';

  return null;
}

/**
 * Check if a coder type is enabled in settings
 */
function isCoderEnabled(settings: CoderSettings, coderType: CoderType): boolean {
  switch (coderType) {
    case 'coder-claude':
      return settings.claudeCliEnabled;
    case 'coder-gemini':
      return settings.geminiCliEnabled;
    case 'coder-api':
      return settings.coderApiEnabled && !!settings.coderApiProvider && !!settings.coderApiModel;
    case 'coder-codex':
      return settings.codexCliEnabled;
    default:
      return false;
  }
}

/**
 * Get all enabled coders
 */
function getEnabledCoders(settings: CoderSettings): CoderType[] {
  const enabled: CoderType[] = [];
  if (settings.claudeCliEnabled) enabled.push('coder-claude');
  if (settings.geminiCliEnabled) enabled.push('coder-gemini');
  if (settings.codexCliEnabled) enabled.push('coder-codex');
  if (settings.coderApiEnabled && settings.coderApiProvider && settings.coderApiModel) {
    enabled.push('coder-api');
  }
  return enabled;
}

/**
 * Match message against trigger words
 */
function matchTriggerWords(message: string, triggerWords: TriggerWords): CoderType | null {
  const lower = message.toLowerCase();

  // Check Claude trigger words
  for (const word of triggerWords.claude) {
    if (lower.includes(word.toLowerCase())) {
      return 'coder-claude';
    }
  }

  // Check Gemini trigger words
  for (const word of triggerWords.gemini) {
    if (lower.includes(word.toLowerCase())) {
      return 'coder-gemini';
    }
  }

  // Check API trigger words
  for (const word of triggerWords.api) {
    if (lower.includes(word.toLowerCase())) {
      return 'coder-api';
    }
  }

  // Check Codex trigger words
  for (const word of triggerWords.codex) {
    if (lower.includes(word.toLowerCase())) {
      return 'coder-codex';
    }
  }

  return null;
}

/**
 * Select the appropriate coder for a task
 *
 * Routing priority:
 * 1. Explicit override (@coder-claude, "use coder-gemini") - if that coder is enabled
 * 2. If only one coder enabled - use it for all tasks
 * 3. Match against user's trigger words
 * 4. Use default coder setting
 */
export function selectCoderForTask(
  settings: CoderSettings,
  message: string,
  explicitOverride?: CoderType | null
): CoderType | null {
  const enabledCoders = getEnabledCoders(settings);

  // No coders enabled
  if (enabledCoders.length === 0) {
    return null;
  }

  // 1. Explicit override (if that coder is enabled)
  if (explicitOverride && isCoderEnabled(settings, explicitOverride)) {
    return explicitOverride;
  }

  // 2. Only one coder enabled - use it for everything
  if (enabledCoders.length === 1) {
    return enabledCoders[0];
  }

  // 3. Match against trigger words
  const triggerMatch = matchTriggerWords(message, settings.triggerWords);
  if (triggerMatch && isCoderEnabled(settings, triggerMatch)) {
    return triggerMatch;
  }

  // 4. Use default coder (if enabled)
  const defaultCoder = `coder-${settings.defaultCoder}` as CoderType;
  if (isCoderEnabled(settings, defaultCoder)) {
    return defaultCoder;
  }

  // 5. Fallback to first enabled coder
  return enabledCoders[0];
}

/**
 * Get default trigger words (for reset functionality)
 */
export function getDefaultTriggerWords(): TriggerWords {
  return { ...DEFAULT_TRIGGER_WORDS };
}

export default {
  getCoderSettings,
  updateCoderSettings,
  resetCoderSettings,
  invalidateCoderSettingsCache,
  parseExplicitOverride,
  selectCoderForTask,
  getDefaultTriggerWords,
};
