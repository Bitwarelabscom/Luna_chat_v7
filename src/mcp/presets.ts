/**
 * MCP Server Presets
 * Pre-configured MCP servers that users can add with one click
 */

export interface McpPreset {
  name: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  category: 'finance' | 'productivity' | 'development' | 'data' | 'other';
  icon?: string;
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
  // Future presets can be added here:
  // 'coingecko': {
  //   name: 'CoinGecko',
  //   description: 'Cryptocurrency data from CoinGecko API',
  //   url: 'https://...',
  //   headers: {},
  //   category: 'finance',
  // },
};
