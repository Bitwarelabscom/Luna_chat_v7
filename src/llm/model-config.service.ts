import { pool } from '../db/index.js';
import type { ProviderId } from './types.js';
import { CONFIGURABLE_TASKS } from './types.js';
import logger from '../utils/logger.js';

export interface UserModelConfig {
  taskType: string;
  provider: ProviderId;
  model: string;
}

// ============================================
// Config Cache with TTL
// OPTIMIZATION: Prevents repeated DB queries for model config
// ============================================

interface ConfigCacheEntry {
  provider: ProviderId;
  model: string;
  timestamp: number;
}

const CONFIG_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const configCache = new Map<string, ConfigCacheEntry>();

function getConfigCacheKey(userId: string, taskType: string): string {
  return `${userId}:${taskType}`;
}

/**
 * Invalidate user's config cache (call when config changes)
 */
export function invalidateUserConfigCache(userId: string): void {
  for (const key of configCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      configCache.delete(key);
    }
  }
}

/**
 * Get user's model configuration for a specific task
 * OPTIMIZED: Uses cache to prevent repeated DB queries
 */
export async function getUserModelConfig(
  userId: string,
  taskType: string
): Promise<{ provider: ProviderId; model: string }> {
  const cacheKey = getConfigCacheKey(userId, taskType);
  const now = Date.now();

  // Check cache first
  const cached = configCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < CONFIG_CACHE_TTL_MS) {
    return { provider: cached.provider, model: cached.model };
  }

  try {
    const result = await pool.query(
      `SELECT provider, model FROM user_model_config
       WHERE user_id = $1 AND task_type = $2`,
      [userId, taskType]
    );

    let config: { provider: ProviderId; model: string };

    if (result.rows.length > 0) {
      config = {
        provider: result.rows[0].provider as ProviderId,
        model: result.rows[0].model,
      };
    } else {
      // Return default from CONFIGURABLE_TASKS
      const defaultConfig = CONFIGURABLE_TASKS.find(t => t.taskType === taskType);
      if (defaultConfig) {
        config = {
          provider: defaultConfig.defaultProvider,
          model: defaultConfig.defaultModel,
        };
      } else {
        // Ultimate fallback
        config = { provider: 'openai', model: 'gpt-5.1-chat-latest' };
      }
    }

    // Store in cache
    configCache.set(cacheKey, { ...config, timestamp: now });

    return config;
  } catch (error) {
    logger.error('Failed to get user model config', {
      error: (error as Error).message,
      userId,
      taskType,
    });

    // Return default on error
    const defaultConfig = CONFIGURABLE_TASKS.find(t => t.taskType === taskType);
    return defaultConfig
      ? { provider: defaultConfig.defaultProvider, model: defaultConfig.defaultModel }
      : { provider: 'openai', model: 'gpt-5.1-chat-latest' };
  }
}

/**
 * Get all model configurations for a user
 */
export async function getAllUserModelConfigs(userId: string): Promise<UserModelConfig[]> {
  try {
    const result = await pool.query(
      `SELECT task_type, provider, model FROM user_model_config WHERE user_id = $1`,
      [userId]
    );

    const userConfigs = result.rows.map((row: Record<string, unknown>) => ({
      taskType: row.task_type as string,
      provider: row.provider as ProviderId,
      model: row.model as string,
    }));

    // Merge with defaults for any missing tasks
    const configs: UserModelConfig[] = [];
    for (const task of CONFIGURABLE_TASKS) {
      const userConfig = userConfigs.find(c => c.taskType === task.taskType);
      configs.push(
        userConfig || {
          taskType: task.taskType,
          provider: task.defaultProvider,
          model: task.defaultModel,
        }
      );
    }

    return configs;
  } catch (error) {
    logger.error('Failed to get all user model configs', {
      error: (error as Error).message,
      userId,
    });
    // Return defaults on error
    return CONFIGURABLE_TASKS.map(t => ({
      taskType: t.taskType,
      provider: t.defaultProvider,
      model: t.defaultModel,
    }));
  }
}

/**
 * Set user's model configuration for a task
 */
export async function setUserModelConfig(
  userId: string,
  taskType: string,
  provider: ProviderId,
  model: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO user_model_config (user_id, task_type, provider, model)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, task_type) DO UPDATE SET
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         updated_at = NOW()`,
      [userId, taskType, provider, model]
    );

    // Invalidate cache after update
    invalidateUserConfigCache(userId);

    logger.debug('Set user model config', { userId, taskType, provider, model });
  } catch (error) {
    logger.error('Failed to set user model config', {
      error: (error as Error).message,
      userId,
      taskType,
    });
    throw error;
  }
}

/**
 * Reset user's model configuration to defaults
 */
export async function resetUserModelConfigs(userId: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM user_model_config WHERE user_id = $1`, [userId]);

    // Invalidate cache after reset
    invalidateUserConfigCache(userId);

    logger.debug('Reset user model configs to defaults', { userId });
  } catch (error) {
    logger.error('Failed to reset user model configs', {
      error: (error as Error).message,
      userId,
    });
    throw error;
  }
}

export default {
  getUserModelConfig,
  getAllUserModelConfigs,
  setUserModelConfig,
  resetUserModelConfigs,
  invalidateUserConfigCache,
};
