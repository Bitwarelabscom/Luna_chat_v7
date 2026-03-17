/**
 * MCP Server Presets
 * Pre-configured MCP servers that users can add with one click
 */

export interface McpPreset {
  name: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  category: 'finance' | 'productivity' | 'development' | 'data' | 'media' | 'other';
  icon?: string;
  transportType?: 'http' | 'stdio';
  commandPath?: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
}

export const MCP_PRESETS: Record<string, McpPreset> = {
  'crypto-market-data': {
    name: 'Crypto.com Market Data',
    description: 'Real-time cryptocurrency prices, market caps, trading volumes, and market trends from Crypto.com',
    url: 'https://mcp.crypto.com/market-data/mcp',
    headers: {},
    category: 'finance',
    icon: 'bitcoin',
  },
  'sonarr': {
    name: 'Sonarr TV Manager',
    description: 'Manage TV series: search, add shows, check downloads, view upcoming episodes via Sonarr',
    url: '',
    headers: {},
    category: 'media',
    icon: 'tv',
    transportType: 'stdio',
    commandPath: 'node',
    commandArgs: ['/mcp-servers/sonarr/index.js'],
    envVars: {
      SONARR_URL: 'http://10.0.0.2:8989',
      SONARR_API_KEY: 'dcaa7d414033421c97d71c5b08d827e1',
    },
  },
};
