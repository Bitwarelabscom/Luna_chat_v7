import { logger } from '../utils/logger.js';

// Binance Alpha API base URL
const BINANCE_ALPHA_BASE = 'https://www.binance.com';

// Alpha API endpoints
const ENDPOINTS = {
  TOKEN_LIST: '/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list',
  KLINES: '/bapi/defi/v1/public/alpha-trade/klines',
  TICKER_24HR: '/bapi/defi/v1/public/alpha-trade/ticker/24hr',
  TRADES: '/bapi/defi/v1/public/alpha-trade/trades',
};

// Types
export interface AlphaToken {
  tokenId: string;
  alphaId: string; // e.g., "ALPHA_497"
  symbol: string;
  name: string;
  chainId: string;
  chainName: string;
  contractAddress: string;
  decimals: number;
  iconUrl?: string;
  chainIconUrl?: string;
  // Price and market data (included in token list)
  price: string;
  percentChange24h: string;
  volume24h: string;
  marketCap: string;
  fdv: string;
  liquidity: string;
  totalSupply: string;
  circulatingSupply: string;
  holders: string;
  priceHigh24h?: string;
  priceLow24h?: string;
  count24h?: string;
  // Flags
  listingCex: boolean;
  hotTag: boolean;
  canTransfer: boolean;
  offline: boolean;
  onlineAirdrop: boolean;
  score: number;
}

export interface AlphaTokenListResponse {
  code: string;
  message: string;
  messageDetail?: string;
  success: boolean;
  data: AlphaToken[];
}

export interface AlphaKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
}

export interface AlphaKlinesResponse {
  code: string;
  message: string;
  messageDetail?: string;
  success: boolean;
  data: unknown[][];
}

export interface AlphaTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
}

export interface AlphaTickerResponse {
  code: string;
  message: string;
  messageDetail?: string;
  success: boolean;
  data: AlphaTicker | AlphaTicker[];
}

export interface AlphaTrade {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
}

export interface AlphaTradesResponse {
  code: string;
  message: string;
  messageDetail?: string;
  success: boolean;
  data: AlphaTrade[];
}

// Cache for token list (refreshed every 5 minutes for price updates)
let tokenListCache: { tokens: AlphaToken[]; timestamp: number } | null = null;
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (prices update frequently)

// Token symbol to alphaId mapping cache (e.g., "RAVE" -> "ALPHA_497")
const tokenIdMap = new Map<string, string>(); // symbol -> alphaId
const tokenSymbolMap = new Map<string, string>(); // alphaId -> symbol

export class BinanceAlphaClient {
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    const url = new URL(endpoint, BINANCE_ALPHA_BASE);

    // Add params to URL
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json() as T;

      if (!response.ok) {
        logger.error('Binance Alpha API error', { status: response.status, data });
        throw new Error(`Binance Alpha API error: ${response.status}`);
      }

      return data;
    } catch (error) {
      logger.error('Binance Alpha request failed', { endpoint, error });
      throw error;
    }
  }

  /**
   * Get list of all available Alpha tokens
   */
  async getTokenList(forceRefresh = false): Promise<AlphaToken[]> {
    // Check cache
    if (!forceRefresh && tokenListCache && Date.now() - tokenListCache.timestamp < TOKEN_CACHE_TTL) {
      return tokenListCache.tokens;
    }

    try {
      const response = await this.request<AlphaTokenListResponse>(ENDPOINTS.TOKEN_LIST);

      if (response.code !== '000000' || !response.success) {
        throw new Error(response.message || 'Failed to fetch Alpha token list');
      }

      const tokens = response.data || [];

      // Update caches
      tokenListCache = { tokens, timestamp: Date.now() };
      tokenIdMap.clear();
      tokenSymbolMap.clear();

      for (const token of tokens) {
        tokenIdMap.set(token.symbol.toUpperCase(), token.alphaId);
        tokenSymbolMap.set(token.alphaId, token.symbol.toUpperCase());
      }

      logger.debug('Alpha token list refreshed', { count: tokens.length });
      return tokens;
    } catch (error) {
      logger.error('Failed to fetch Alpha token list', { error });
      throw error;
    }
  }

  /**
   * Get Alpha token ID for a symbol (returns "ALPHA_XXX" format)
   */
  async getTokenId(symbol: string): Promise<string | null> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache first
    if (tokenIdMap.has(upperSymbol)) {
      return tokenIdMap.get(upperSymbol) || null;
    }

    // Refresh token list
    await this.getTokenList(true);

    return tokenIdMap.get(upperSymbol) || null;
  }

  /**
   * Build Alpha symbol format: ALPHA_XXX{quoteAsset}
   * Input can be symbol (e.g., "RAVE") or already an alphaId (e.g., "ALPHA_497")
   */
  async buildAlphaSymbol(baseSymbol: string, quoteAsset = 'USDT'): Promise<string | null> {
    // If already in ALPHA_ format, just append quote asset
    if (baseSymbol.startsWith('ALPHA_')) {
      // Extract numeric part if needed
      const match = baseSymbol.match(/ALPHA_(\d+)/);
      if (match) {
        return `ALPHA_${match[1]}${quoteAsset}`;
      }
      return null;
    }

    const alphaId = await this.getTokenId(baseSymbol);
    if (!alphaId) {
      return null;
    }
    // alphaId is "ALPHA_XXX", extract the number part
    const match = alphaId.match(/ALPHA_(\d+)/);
    if (!match) {
      return null;
    }
    return `ALPHA_${match[1]}${quoteAsset}`;
  }

  /**
   * Get token details by symbol (includes price data from cached list)
   */
  async getTokenBySymbol(symbol: string): Promise<AlphaToken | null> {
    const tokens = await this.getTokenList();
    const upperSymbol = symbol.toUpperCase();
    return tokens.find(t => t.symbol.toUpperCase() === upperSymbol) || null;
  }

  /**
   * Get multiple token prices at once (from cached token list)
   */
  async getTokenPrices(symbols: string[]): Promise<Array<{
    symbol: string;
    name: string;
    price: number;
    change24h: number;
    volume24h: number;
    marketCap: number;
    liquidity: number;
    chain: string;
  }>> {
    const tokens = await this.getTokenList();
    const upperSymbols = new Set(symbols.map(s => s.toUpperCase()));

    return tokens
      .filter(t => upperSymbols.has(t.symbol.toUpperCase()))
      .map(t => ({
        symbol: t.symbol,
        name: t.name,
        price: parseFloat(t.price) || 0,
        change24h: parseFloat(t.percentChange24h) || 0,
        volume24h: parseFloat(t.volume24h) || 0,
        marketCap: parseFloat(t.marketCap) || 0,
        liquidity: parseFloat(t.liquidity) || 0,
        chain: t.chainName,
      }));
  }

  /**
   * Get top tokens by volume
   */
  async getTopTokensByVolume(limit = 20): Promise<AlphaToken[]> {
    const tokens = await this.getTokenList();
    return [...tokens]
      .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))
      .slice(0, limit);
  }

  /**
   * Get hot tokens (marked with hotTag)
   */
  async getHotTokens(): Promise<AlphaToken[]> {
    const tokens = await this.getTokenList();
    return tokens.filter(t => t.hotTag);
  }

  /**
   * Get Klines/candlestick data for an Alpha token
   */
  async getKlines(
    symbol: string,
    interval: string,
    limit = 100,
    startTime?: number,
    endTime?: number
  ): Promise<AlphaKline[]> {
    // Symbol should be in format ALPHA_{tokenId}USDT
    // If not, try to build it
    let alphaSymbol = symbol;
    if (!symbol.startsWith('ALPHA_')) {
      const built = await this.buildAlphaSymbol(symbol);
      if (!built) {
        throw new Error(`Unknown Alpha token: ${symbol}`);
      }
      alphaSymbol = built;
    }

    const response = await this.request<AlphaKlinesResponse>(ENDPOINTS.KLINES, {
      symbol: alphaSymbol,
      interval,
      limit,
      startTime,
      endTime,
    });

    if (response.code !== '000000' || !response.success) {
      throw new Error(response.message || 'Failed to fetch Alpha klines');
    }

    // Parse kline data (similar format to Spot API)
    return (response.data || []).map((k) => ({
      openTime: k[0] as number,
      open: k[1] as string,
      high: k[2] as string,
      low: k[3] as string,
      close: k[4] as string,
      volume: k[5] as string,
      closeTime: k[6] as number,
      quoteVolume: k[7] as string,
      trades: k[8] as number,
      takerBuyBaseVolume: k[9] as string,
      takerBuyQuoteVolume: k[10] as string,
    }));
  }

  /**
   * Get 24hr ticker for Alpha token(s)
   */
  async getTicker24hr(symbol?: string): Promise<AlphaTicker | AlphaTicker[]> {
    let alphaSymbol = symbol;
    if (symbol && !symbol.startsWith('ALPHA_')) {
      const built = await this.buildAlphaSymbol(symbol);
      if (!built) {
        throw new Error(`Unknown Alpha token: ${symbol}`);
      }
      alphaSymbol = built;
    }

    const params: Record<string, string | undefined> = {};
    if (alphaSymbol) {
      params.symbol = alphaSymbol;
    }

    const response = await this.request<AlphaTickerResponse>(ENDPOINTS.TICKER_24HR, params);

    if (response.code !== '000000' || !response.success) {
      throw new Error(response.message || 'Failed to fetch Alpha ticker');
    }

    return response.data;
  }

  /**
   * Get recent trades for Alpha token
   */
  async getTrades(symbol: string, limit = 50): Promise<AlphaTrade[]> {
    let alphaSymbol = symbol;
    if (!symbol.startsWith('ALPHA_')) {
      const built = await this.buildAlphaSymbol(symbol);
      if (!built) {
        throw new Error(`Unknown Alpha token: ${symbol}`);
      }
      alphaSymbol = built;
    }

    const response = await this.request<AlphaTradesResponse>(ENDPOINTS.TRADES, {
      symbol: alphaSymbol,
      limit,
    });

    if (response.code !== '000000' || !response.success) {
      throw new Error(response.message || 'Failed to fetch Alpha trades');
    }

    return response.data || [];
  }

  /**
   * Get current price for an Alpha token (uses cached token list for efficiency)
   */
  async getPrice(symbol: string): Promise<{
    symbol: string;
    name: string;
    price: number;
    change24h: number;
    volume24h: number;
    marketCap: number;
    high24h: number;
    low24h: number;
    chain: string;
  } | null> {
    try {
      const token = await this.getTokenBySymbol(symbol);
      if (!token) {
        return null;
      }
      return {
        symbol: token.symbol,
        name: token.name,
        price: parseFloat(token.price) || 0,
        change24h: parseFloat(token.percentChange24h) || 0,
        volume24h: parseFloat(token.volume24h) || 0,
        marketCap: parseFloat(token.marketCap) || 0,
        high24h: parseFloat(token.priceHigh24h || '0') || 0,
        low24h: parseFloat(token.priceLow24h || '0') || 0,
        chain: token.chainName,
      };
    } catch (error) {
      logger.error('Failed to get Alpha price', { symbol, error });
      return null;
    }
  }

  /**
   * Search Alpha tokens by name or symbol
   */
  async searchTokens(query: string): Promise<AlphaToken[]> {
    const tokens = await this.getTokenList();
    const lowerQuery = query.toLowerCase();

    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(lowerQuery) ||
        t.name.toLowerCase().includes(lowerQuery)
    );
  }
}

// Singleton instance for public data (no auth needed)
export const alphaClient = new BinanceAlphaClient();
