import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { Parser } from 'expr-eval';
import { validateExternalUrl } from '../utils/url-validator.js';

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  toolType: 'api' | 'webhook' | 'function';
  config: ToolConfig;
  isEnabled: boolean;
  usageCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
}

export interface ToolConfig {
  // For API tools
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  responseMapping?: string;

  // For webhooks
  webhookUrl?: string;

  // Parameter schema
  parameters?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
    default?: unknown;
  }>;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
}

/**
 * Create a custom tool
 */
export async function createTool(
  userId: string,
  tool: {
    name: string;
    description: string;
    toolType: 'api' | 'webhook' | 'function';
    config: ToolConfig;
  }
): Promise<CustomTool> {
  try {
    const result = await pool.query(
      `INSERT INTO custom_tools (user_id, name, description, tool_type, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, tool_type, config, is_enabled, usage_count, last_used_at, created_at`,
      [userId, tool.name, tool.description, tool.toolType, JSON.stringify(tool.config)]
    );

    logger.info('Created custom tool', { userId, name: tool.name });
    return mapRowToTool(result.rows[0]);
  } catch (error) {
    if ((error as Error).message.includes('duplicate key')) {
      throw new Error(`Tool "${tool.name}" already exists`);
    }
    throw error;
  }
}

/**
 * Get user's tools
 */
export async function getTools(
  userId: string,
  enabledOnly: boolean = false
): Promise<CustomTool[]> {
  try {
    let query = `
      SELECT id, name, description, tool_type, config, is_enabled, usage_count, last_used_at, created_at
      FROM custom_tools
      WHERE user_id = $1
    `;

    if (enabledOnly) {
      query += ` AND is_enabled = true`;
    }

    query += ` ORDER BY usage_count DESC, created_at DESC`;

    const result = await pool.query(query, [userId]);
    return result.rows.map(mapRowToTool);
  } catch (error) {
    logger.error('Failed to get tools', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Execute a tool
 */
export async function executeTool(
  userId: string,
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const startTime = Date.now();

  try {
    // Get tool
    const result = await pool.query(
      `SELECT id, tool_type, config FROM custom_tools WHERE user_id = $1 AND name = $2 AND is_enabled = true`,
      [userId, toolName]
    );

    if (result.rows.length === 0) {
      return { success: false, error: `Tool "${toolName}" not found or disabled`, executionTimeMs: 0 };
    }

    const tool = result.rows[0];
    const config = tool.config as ToolConfig;
    let data: unknown;

    switch (tool.tool_type) {
      case 'api':
        data = await executeApiTool(config, params);
        break;
      case 'webhook':
        data = await executeWebhookTool(config, params);
        break;
      case 'function':
        data = await executeFunctionTool(config, params);
        break;
      default:
        throw new Error(`Unknown tool type: ${tool.tool_type}`);
    }

    // Update usage stats
    await pool.query(
      `UPDATE custom_tools SET usage_count = usage_count + 1, last_used_at = NOW() WHERE id = $1`,
      [tool.id]
    );

    return {
      success: true,
      data,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

async function executeApiTool(config: ToolConfig, params: Record<string, unknown>): Promise<unknown> {
  if (!config.url) throw new Error('API URL not configured');

  // Replace placeholders in URL
  let url = config.url;
  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  // SECURITY: Validate URL to prevent SSRF attacks
  try {
    await validateExternalUrl(url);
  } catch (err) {
    logger.warn('API tool URL validation failed', { url, error: (err as Error).message });
    throw new Error(`URL validation failed: ${(err as Error).message}`);
  }

  // Build request body if template exists
  let body: string | undefined;
  if (config.bodyTemplate) {
    body = config.bodyTemplate;
    for (const [key, value] of Object.entries(params)) {
      body = body.replace(`{${key}}`, JSON.stringify(value));
    }
  }

  const response = await fetch(url, {
    method: config.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: body ? body : undefined,
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function executeWebhookTool(config: ToolConfig, params: Record<string, unknown>): Promise<unknown> {
  if (!config.webhookUrl) throw new Error('Webhook URL not configured');

  // SECURITY: Validate webhook URL to prevent SSRF attacks
  try {
    await validateExternalUrl(config.webhookUrl);
  } catch (err) {
    logger.warn('Webhook URL validation failed', { url: config.webhookUrl, error: (err as Error).message });
    throw new Error(`URL validation failed: ${(err as Error).message}`);
  }

  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }

  return response.json();
}

// Safe expression parser instance (no eval/Function)
const mathParser = new Parser();

async function executeFunctionTool(config: ToolConfig, params: Record<string, unknown>): Promise<unknown> {
  // Built-in functions
  const functions: Record<string, (params: Record<string, unknown>) => unknown> = {
    calculate: (p) => {
      const expr = String(p.expression);
      // SECURITY: Use expr-eval for safe math evaluation (no eval/Function)
      try {
        const result = mathParser.evaluate(expr);
        return { result };
      } catch (err) {
        throw new Error(`Invalid expression: ${(err as Error).message}`);
      }
    },
    formatDate: (p) => {
      const date = new Date(p.date as string);
      const format = p.format as string || 'iso';
      if (format === 'iso') return { formatted: date.toISOString() };
      if (format === 'local') return { formatted: date.toLocaleString() };
      return { formatted: date.toString() };
    },
    randomNumber: (p) => {
      const min = Number(p.min) || 0;
      const max = Number(p.max) || 100;
      return { result: Math.floor(Math.random() * (max - min + 1)) + min };
    },
  };

  const funcName = config.url || 'calculate'; // Reuse url field for function name
  const func = functions[funcName];

  if (!func) {
    throw new Error(`Function "${funcName}" not found`);
  }

  return func(params);
}

/**
 * Update a tool
 */
export async function updateTool(
  userId: string,
  toolId: string,
  updates: Partial<{ name: string; description: string; config: ToolConfig; isEnabled: boolean }>
): Promise<CustomTool | null> {
  try {
    const setClauses: string[] = [];
    const params: unknown[] = [userId, toolId];
    let paramIndex = 3;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(updates.description);
    }
    if (updates.config !== undefined) {
      setClauses.push(`config = $${paramIndex++}`);
      params.push(JSON.stringify(updates.config));
    }
    if (updates.isEnabled !== undefined) {
      setClauses.push(`is_enabled = $${paramIndex++}`);
      params.push(updates.isEnabled);
    }

    if (setClauses.length === 0) return null;

    const result = await pool.query(
      `UPDATE custom_tools
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $2 AND user_id = $1
       RETURNING id, name, description, tool_type, config, is_enabled, usage_count, last_used_at, created_at`,
      params
    );

    if (result.rows.length === 0) return null;
    return mapRowToTool(result.rows[0]);
  } catch (error) {
    logger.error('Failed to update tool', { error: (error as Error).message, userId, toolId });
    throw error;
  }
}

/**
 * Delete a tool
 */
export async function deleteTool(userId: string, toolId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM custom_tools WHERE id = $1 AND user_id = $2`,
      [toolId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to delete tool', { error: (error as Error).message, userId, toolId });
    return false;
  }
}

/**
 * Format tools for LLM function calling
 */
export function formatToolsForLLM(tools: CustomTool[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          (tool.config.parameters || []).map(p => [
            p.name,
            {
              type: p.type,
              description: p.description,
            },
          ])
        ),
        required: (tool.config.parameters || []).filter(p => p.required).map(p => p.name),
      },
    },
  }));
}

function mapRowToTool(row: Record<string, unknown>): CustomTool {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    toolType: row.tool_type as 'api' | 'webhook' | 'function',
    config: row.config as ToolConfig,
    isEnabled: row.is_enabled as boolean,
    usageCount: row.usage_count as number,
    lastUsedAt: row.last_used_at as Date | undefined,
    createdAt: row.created_at as Date,
  };
}

export default {
  createTool,
  getTools,
  executeTool,
  updateTool,
  deleteTool,
  formatToolsForLLM,
};
