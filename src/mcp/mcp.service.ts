/**
 * MCP (Model Context Protocol) Client Service
 * Connects to external MCP servers to discover and execute tools
 */
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import type OpenAI from 'openai';

// ============================================================================
// Types
// ============================================================================

export interface McpServer {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  url: string;
  headers: Record<string, string>;
  isEnabled: boolean;
  isConnected: boolean;
  lastConnectedAt: Date | null;
  lastError: string | null;
  errorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  isEnabled: boolean;
  usageCount: number;
  lastUsedAt: Date | null;
  discoveredAt: Date;
}

export interface McpServerWithTools extends McpServer {
  tools: McpTool[];
  toolCount: number;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ============================================================================
// JSON-RPC Client
// ============================================================================

let requestId = 1;

async function jsonRpcRequest(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Promise<unknown> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as JsonRpcResponse;

    if (data.error) {
      throw new Error(`MCP Error ${data.error.code}: ${data.error.message}`);
    }

    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Server Management
// ============================================================================

export async function createServer(
  userId: string,
  data: {
    name: string;
    url: string;
    description?: string;
    headers?: Record<string, string>;
  }
): Promise<McpServer> {
  const { name, url, description, headers = {} } = data;

  const result = await pool.query(
    `INSERT INTO mcp_servers (user_id, name, description, url, headers)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, name, description || null, url, JSON.stringify(headers)]
  );

  return mapServerRow(result.rows[0]);
}

export async function getServers(userId: string, enabledOnly = false): Promise<McpServerWithTools[]> {
  let query = `
    SELECT s.*,
           COALESCE(json_agg(t.*) FILTER (WHERE t.id IS NOT NULL), '[]') as tools,
           COUNT(t.id) as tool_count
    FROM mcp_servers s
    LEFT JOIN mcp_tools t ON t.server_id = s.id
    WHERE s.user_id = $1
  `;

  if (enabledOnly) {
    query += ` AND s.is_enabled = true`;
  }

  query += ` GROUP BY s.id ORDER BY s.created_at DESC`;

  const result = await pool.query(query, [userId]);

  return result.rows.map(row => ({
    ...mapServerRow(row),
    tools: row.tools.map(mapToolRow).filter((t: McpTool | null) => t !== null),
    toolCount: parseInt(row.tool_count, 10),
  }));
}

export async function getServer(userId: string, serverId: string): Promise<McpServerWithTools | null> {
  const result = await pool.query(
    `SELECT s.*,
            COALESCE(json_agg(t.*) FILTER (WHERE t.id IS NOT NULL), '[]') as tools,
            COUNT(t.id) as tool_count
     FROM mcp_servers s
     LEFT JOIN mcp_tools t ON t.server_id = s.id
     WHERE s.user_id = $1 AND s.id = $2
     GROUP BY s.id`,
    [userId, serverId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    ...mapServerRow(row),
    tools: row.tools.map(mapToolRow).filter((t: McpTool | null) => t !== null),
    toolCount: parseInt(row.tool_count, 10),
  };
}

export async function updateServer(
  userId: string,
  serverId: string,
  updates: Partial<{
    name: string;
    url: string;
    description: string;
    headers: Record<string, string>;
    isEnabled: boolean;
  }>
): Promise<McpServer | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.url !== undefined) {
    fields.push(`url = $${paramIndex++}`);
    values.push(updates.url);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.headers !== undefined) {
    fields.push(`headers = $${paramIndex++}`);
    values.push(JSON.stringify(updates.headers));
  }
  if (updates.isEnabled !== undefined) {
    fields.push(`is_enabled = $${paramIndex++}`);
    values.push(updates.isEnabled);
  }

  if (fields.length === 0) return null;

  values.push(userId, serverId);

  const result = await pool.query(
    `UPDATE mcp_servers SET ${fields.join(', ')}
     WHERE user_id = $${paramIndex++} AND id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows.length > 0 ? mapServerRow(result.rows[0]) : null;
}

export async function deleteServer(userId: string, serverId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM mcp_servers WHERE user_id = $1 AND id = $2`,
    [userId, serverId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Tool Discovery
// ============================================================================

export async function discoverTools(serverId: string): Promise<McpTool[]> {
  // Get server details
  const serverResult = await pool.query(
    `SELECT * FROM mcp_servers WHERE id = $1`,
    [serverId]
  );

  if (serverResult.rows.length === 0) {
    throw new Error('Server not found');
  }

  const server = mapServerRow(serverResult.rows[0]);

  try {
    // Call MCP tools/list method
    const result = await jsonRpcRequest(
      server.url,
      'tools/list',
      {},
      server.headers
    ) as { tools: McpToolDefinition[] };

    const tools = result.tools || [];

    // Clear existing tools for this server
    await pool.query(`DELETE FROM mcp_tools WHERE server_id = $1`, [serverId]);

    // Insert discovered tools
    for (const tool of tools) {
      await pool.query(
        `INSERT INTO mcp_tools (server_id, name, title, description, input_schema)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          serverId,
          tool.name,
          tool.title || null,
          tool.description,
          JSON.stringify(tool.inputSchema),
        ]
      );
    }

    // Update server connection status
    await pool.query(
      `UPDATE mcp_servers
       SET is_connected = true, last_connected_at = NOW(), last_error = NULL, error_count = 0
       WHERE id = $1`,
      [serverId]
    );

    logger.info('MCP tools discovered', { serverId, serverName: server.name, toolCount: tools.length });

    // Return updated tools
    const toolsResult = await pool.query(
      `SELECT * FROM mcp_tools WHERE server_id = $1`,
      [serverId]
    );

    return toolsResult.rows.map(mapToolRow);
  } catch (error) {
    // Update server with error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await pool.query(
      `UPDATE mcp_servers
       SET is_connected = false, last_error = $2, error_count = error_count + 1
       WHERE id = $1`,
      [serverId, errorMessage]
    );

    logger.error('MCP tool discovery failed', { serverId, error: errorMessage });
    throw error;
  }
}

export async function getServerTools(serverId: string, enabledOnly = false): Promise<McpTool[]> {
  let query = `SELECT * FROM mcp_tools WHERE server_id = $1`;
  if (enabledOnly) {
    query += ` AND is_enabled = true`;
  }
  query += ` ORDER BY name`;

  const result = await pool.query(query, [serverId]);
  return result.rows.map(mapToolRow);
}

export async function updateTool(
  toolId: string,
  updates: { isEnabled?: boolean }
): Promise<McpTool | null> {
  if (updates.isEnabled === undefined) return null;

  const result = await pool.query(
    `UPDATE mcp_tools SET is_enabled = $1 WHERE id = $2 RETURNING *`,
    [updates.isEnabled, toolId]
  );

  return result.rows.length > 0 ? mapToolRow(result.rows[0]) : null;
}

// ============================================================================
// Tool Execution
// ============================================================================

export async function getAllUserTools(userId: string): Promise<Array<McpTool & { serverName: string; serverUrl: string }>> {
  const result = await pool.query(
    `SELECT t.*, s.name as server_name, s.url as server_url, s.headers as server_headers
     FROM mcp_tools t
     JOIN mcp_servers s ON s.id = t.server_id
     WHERE s.user_id = $1 AND s.is_enabled = true AND t.is_enabled = true`,
    [userId]
  );

  return result.rows.map(row => ({
    ...mapToolRow(row),
    serverName: row.server_name,
    serverUrl: row.server_url,
    serverHeaders: typeof row.server_headers === 'string'
      ? JSON.parse(row.server_headers)
      : row.server_headers || {},
  }));
}

export async function executeTool(
  userId: string,
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
  // Get server details
  const serverResult = await pool.query(
    `SELECT * FROM mcp_servers WHERE id = $1 AND user_id = $2`,
    [serverId, userId]
  );

  if (serverResult.rows.length === 0) {
    return { content: 'MCP server not found or not owned by user', isError: true };
  }

  const server = mapServerRow(serverResult.rows[0]);

  if (!server.isEnabled) {
    return { content: 'MCP server is disabled', isError: true };
  }

  const startTime = Date.now();

  try {
    // Call MCP tools/call method
    const result = await jsonRpcRequest(
      server.url,
      'tools/call',
      {
        name: toolName,
        arguments: args,
      },
      server.headers
    ) as McpToolCallResult;

    // Update tool usage count
    await pool.query(
      `UPDATE mcp_tools SET usage_count = usage_count + 1, last_used_at = NOW()
       WHERE server_id = $1 AND name = $2`,
      [serverId, toolName]
    );

    // Format response content
    const content = result.content
      .map(c => {
        if (c.type === 'text') return c.text || '';
        if (c.type === 'image') return `[Image: ${c.mimeType}]`;
        return JSON.stringify(c);
      })
      .join('\n');

    const executionTime = Date.now() - startTime;
    logger.info('MCP tool executed', { serverId, toolName, executionTime });

    return { content, isError: result.isError || false };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('MCP tool execution failed', { serverId, toolName, error: errorMessage });
    return { content: `Error executing MCP tool: ${errorMessage}`, isError: true };
  }
}

// ============================================================================
// LLM Tool Formatting
// ============================================================================

export function formatMcpToolsForLLM(
  tools: Array<McpTool & { serverName: string; serverId?: string }>
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map(tool => {
    // Create unique tool name: mcp_<shortServerId>_<toolName>
    const shortId = (tool.serverId || tool.id).substring(0, 8);
    const prefixedName = `mcp_${shortId}_${tool.name}`;

    // Enhance description with server context
    const description = `[MCP: ${tool.serverName}] ${tool.description}`;

    return {
      type: 'function' as const,
      function: {
        name: prefixedName,
        description,
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    };
  });
}

export function parseMcpToolName(prefixedName: string): { serverId: string; toolName: string } | null {
  if (!prefixedName.startsWith('mcp_')) return null;

  const parts = prefixedName.slice(4).split('_');
  if (parts.length < 2) return null;

  const serverId = parts[0];
  const toolName = parts.slice(1).join('_');

  return { serverId, toolName };
}

// ============================================================================
// Connection Testing
// ============================================================================

export async function testConnection(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ success: boolean; serverInfo?: { name: string; version: string }; toolCount?: number; error?: string }> {
  try {
    // Try to list tools to verify connection
    const result = await jsonRpcRequest(url, 'tools/list', {}, headers) as { tools: McpToolDefinition[] };

    return {
      success: true,
      toolCount: result.tools?.length || 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapServerRow(row: Record<string, unknown>): McpServer {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    description: row.description as string | null,
    url: row.url as string,
    headers: typeof row.headers === 'string' ? JSON.parse(row.headers) : (row.headers as Record<string, string>) || {},
    isEnabled: row.is_enabled as boolean,
    isConnected: row.is_connected as boolean,
    lastConnectedAt: row.last_connected_at ? new Date(row.last_connected_at as string) : null,
    lastError: row.last_error as string | null,
    errorCount: row.error_count as number,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapToolRow(row: Record<string, unknown>): McpTool {
  if (!row || !row.id) return null as unknown as McpTool;
  return {
    id: row.id as string,
    serverId: row.server_id as string,
    name: row.name as string,
    title: row.title as string | null,
    description: row.description as string,
    inputSchema: typeof row.input_schema === 'string'
      ? JSON.parse(row.input_schema)
      : (row.input_schema as Record<string, unknown>) || {},
    isEnabled: row.is_enabled as boolean,
    usageCount: row.usage_count as number,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
    discoveredAt: new Date(row.discovered_at as string),
  };
}
