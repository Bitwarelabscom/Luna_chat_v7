import { api } from './core';

// MCP (Model Context Protocol) API
export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transportType: 'http' | 'stdio';
  // HTTP transport
  url: string | null;
  headers: Record<string, string>;
  // Stdio transport
  commandPath: string | null;
  commandArgs: string[];
  envVars: Record<string, string>;
  workingDirectory: string | null;
  // Status
  isEnabled: boolean;
  isConnected: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  errorCount: number;
  toolCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  title: string | null;
  description: string;
  inputSchema: object;
  isEnabled: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  discoveredAt: string;
}

export interface McpServerWithTools extends McpServer {
  tools: McpTool[];
}

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  category: string;
  icon?: string;
}

export interface McpTestResult {
  success: boolean;
  serverInfo?: { name: string; version: string };
  toolCount?: number;
  error?: string;
}

export interface McpServerCreateData {
  name: string;
  description?: string;
  transportType?: 'http' | 'stdio';
  // HTTP transport
  url?: string;
  headers?: Record<string, string>;
  // Stdio transport
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
}

export interface McpServerUpdateData {
  name?: string;
  description?: string;
  transportType?: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
  isEnabled?: boolean;
}

export interface McpTestConnectionData {
  transportType: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
}

export const mcpApi = {
  // Servers
  getServers: () =>
    api<{ servers: McpServerWithTools[] }>('/api/mcp/servers'),

  createServer: (data: McpServerCreateData) =>
    api<{ server: McpServerWithTools }>('/api/mcp/servers', { method: 'POST', body: data }),

  getServer: (id: string) =>
    api<{ server: McpServerWithTools }>(`/api/mcp/servers/${id}`),

  updateServer: (id: string, data: McpServerUpdateData) =>
    api<{ server: McpServer }>(`/api/mcp/servers/${id}`, { method: 'PUT', body: data }),

  deleteServer: (id: string) =>
    api<{ success: boolean }>(`/api/mcp/servers/${id}`, { method: 'DELETE' }),

  // Tools
  discoverTools: (serverId: string) =>
    api<{ tools: McpTool[] }>(`/api/mcp/servers/${serverId}/discover`, { method: 'POST' }),

  getServerTools: (serverId: string) =>
    api<{ tools: McpTool[] }>(`/api/mcp/servers/${serverId}/tools`),

  updateTool: (toolId: string, data: { isEnabled: boolean }) =>
    api<{ tool: McpTool }>(`/api/mcp/tools/${toolId}`, { method: 'PUT', body: data }),

  // Test
  testConnection: (data: McpTestConnectionData) =>
    api<McpTestResult>('/api/mcp/test', { method: 'POST', body: data }),

  // Presets
  getPresets: () =>
    api<{ presets: McpPreset[] }>('/api/mcp/presets'),

  addPreset: (presetId: string) =>
    api<{ server: McpServerWithTools }>('/api/mcp/presets/add', { method: 'POST', body: { presetId } }),
};
