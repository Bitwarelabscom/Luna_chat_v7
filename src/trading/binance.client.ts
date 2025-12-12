import crypto from 'crypto';
import { logger } from '../utils/logger.js';

// Binance API endpoints
const BINANCE_API_BASE = 'https://api.binance.com';
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443';

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface AccountBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface AccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: AccountBalance[];
  permissions: string[];
}

export interface TickerPrice {
  symbol: string;
  price: string;
}

export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

export interface Trade {
  symbol: string;
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
}

export interface Order {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  fills: Array<{
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
  }>;
}

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export interface SymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
}

export interface SymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: SymbolFilter[];
}

// Cache for symbol info to avoid repeated API calls
const symbolInfoCache = new Map<string, { info: SymbolInfo; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT_LIMIT';
  quantity?: string;
  quoteOrderQty?: string; // For market orders - spend this much quote currency
  price?: string;
  stopPrice?: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export class BinanceClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(credentials: BinanceCredentials) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
  }

  private generateSignature(queryString: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    params: Record<string, string | number | undefined> = {},
    signed: boolean = false
  ): Promise<T> {
    const url = new URL(endpoint, BINANCE_API_BASE);

    // Filter out undefined params
    const filteredParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        filteredParams[key] = String(value);
      }
    }

    if (signed) {
      filteredParams.timestamp = Date.now().toString();
      filteredParams.recvWindow = '5000';
      const queryString = new URLSearchParams(filteredParams).toString();
      filteredParams.signature = this.generateSignature(queryString);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (this.apiKey) {
      headers['X-MBX-APIKEY'] = this.apiKey;
    }

    let body: string | undefined;
    if (method === 'GET' || method === 'DELETE') {
      url.search = new URLSearchParams(filteredParams).toString();
    } else {
      body = new URLSearchParams(filteredParams).toString();
    }

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body,
      });

      const data = await response.json() as T & { msg?: string };

      if (!response.ok) {
        logger.error('Binance API error', { status: response.status, data });
        throw new Error(data.msg || `Binance API error: ${response.status}`);
      }

      return data as T;
    } catch (error) {
      logger.error('Binance request failed', { endpoint, error });
      throw error;
    }
  }

  // Public endpoints (no signature needed)

  async ping(): Promise<boolean> {
    try {
      await this.request<{}>('/api/v3/ping');
      return true;
    } catch {
      return false;
    }
  }

  async getServerTime(): Promise<number> {
    const data = await this.request<{ serverTime: number }>('/api/v3/time');
    return data.serverTime;
  }

  async getTickerPrice(symbol?: string): Promise<TickerPrice | TickerPrice[]> {
    const params = symbol ? { symbol } : {};
    return this.request<TickerPrice | TickerPrice[]>('/api/v3/ticker/price', 'GET', params);
  }

  async getTicker24hr(symbol?: string): Promise<Ticker24hr | Ticker24hr[]> {
    const params = symbol ? { symbol } : {};
    return this.request<Ticker24hr | Ticker24hr[]>('/api/v3/ticker/24hr', 'GET', params);
  }

  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 100,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]> {
    const rawData = await this.request<unknown[][]>('/api/v3/klines', 'GET', {
      symbol,
      interval,
      limit,
      startTime,
      endTime,
    });

    return rawData.map((k) => ({
      openTime: k[0] as number,
      open: k[1] as string,
      high: k[2] as string,
      low: k[3] as string,
      close: k[4] as string,
      volume: k[5] as string,
      closeTime: k[6] as number,
      quoteAssetVolume: k[7] as string,
      numberOfTrades: k[8] as number,
      takerBuyBaseAssetVolume: k[9] as string,
      takerBuyQuoteAssetVolume: k[10] as string,
    }));
  }

  // Private endpoints (signature needed)

  async getAccountInfo(): Promise<AccountInfo> {
    return this.request<AccountInfo>('/api/v3/account', 'GET', {}, true);
  }

  async getMyTrades(symbol: string, limit: number = 50): Promise<Trade[]> {
    return this.request<Trade[]>('/api/v3/myTrades', 'GET', { symbol, limit }, true);
  }

  async getAllMyTrades(symbols: string[], limit: number = 10): Promise<Trade[]> {
    const allTrades: Trade[] = [];
    for (const symbol of symbols) {
      try {
        const trades = await this.getMyTrades(symbol, limit);
        allTrades.push(...trades);
      } catch (error) {
        // Skip symbols with no trades or errors
        logger.debug('Failed to get trades for symbol', { symbol, error });
      }
    }
    // Sort by time descending
    return allTrades.sort((a, b) => b.time - a.time);
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params = symbol ? { symbol } : {};
    return this.request<Order[]>('/api/v3/openOrders', 'GET', params, true);
  }

  async getAllOrders(symbol: string, limit: number = 50): Promise<Order[]> {
    return this.request<Order[]>('/api/v3/allOrders', 'GET', { symbol, limit }, true);
  }

  async getOrder(symbol: string, orderId: number): Promise<Order> {
    return this.request<Order>('/api/v3/order', 'GET', { symbol, orderId }, true);
  }

  async placeOrder(params: OrderParams): Promise<Order> {
    const orderParams: Record<string, string | number | undefined> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
    };

    if (params.quantity) {
      orderParams.quantity = params.quantity;
    }

    if (params.quoteOrderQty) {
      orderParams.quoteOrderQty = params.quoteOrderQty;
    }

    if (params.price && params.type !== 'MARKET') {
      orderParams.price = params.price;
    }

    if (params.stopPrice) {
      orderParams.stopPrice = params.stopPrice;
    }

    if (params.timeInForce && params.type !== 'MARKET') {
      orderParams.timeInForce = params.timeInForce;
    } else if (params.type === 'LIMIT') {
      orderParams.timeInForce = 'GTC';
    }

    return this.request<Order>('/api/v3/order', 'POST', orderParams, true);
  }

  async cancelOrder(symbol: string, orderId: number): Promise<Order> {
    return this.request<Order>('/api/v3/order', 'DELETE', { symbol, orderId }, true);
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    return this.request<Order[]>('/api/v3/openOrders', 'DELETE', { symbol }, true);
  }

  // Get symbol info (exchange info) for lot size and price filters
  async getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
    // Check cache first
    const cached = symbolInfoCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.info;
    }

    try {
      const response = await this.request<{ symbols: SymbolInfo[] }>(
        '/api/v3/exchangeInfo',
        'GET',
        { symbol }
      );
      const info = response.symbols.find((s) => s.symbol === symbol);
      if (info) {
        symbolInfoCache.set(symbol, { info, timestamp: Date.now() });
        return info;
      }
      return null;
    } catch (error) {
      logger.error('Failed to get symbol info', { symbol, error });
      return null;
    }
  }

  // Get LOT_SIZE filter for a symbol
  async getLotSizeFilter(symbol: string): Promise<{ stepSize: string; minQty: string } | null> {
    const info = await this.getSymbolInfo(symbol);
    if (!info) return null;

    const lotSize = info.filters.find((f) => f.filterType === 'LOT_SIZE');
    if (lotSize && lotSize.stepSize && lotSize.minQty) {
      return { stepSize: lotSize.stepSize, minQty: lotSize.minQty };
    }
    return null;
  }

  // Get MIN_NOTIONAL filter for a symbol
  async getMinNotional(symbol: string): Promise<string | null> {
    const info = await this.getSymbolInfo(symbol);
    if (!info) return null;

    const notional = info.filters.find((f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
    return notional?.minNotional || null;
  }

  // Test connectivity with API keys
  async testConnection(): Promise<{ success: boolean; canTrade: boolean; error?: string }> {
    try {
      const accountInfo = await this.getAccountInfo();
      return {
        success: true,
        canTrade: accountInfo.canTrade,
      };
    } catch (error) {
      return {
        success: false,
        canTrade: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Get WebSocket stream URL for real-time data
  static getTickerStreamUrl(symbols: string[]): string {
    const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join('/');
    return `${BINANCE_WS_BASE}/stream?streams=${streams}`;
  }

  static getKlineStreamUrl(symbol: string, interval: string): string {
    return `${BINANCE_WS_BASE}/ws/${symbol.toLowerCase()}@kline_${interval}`;
  }

  static getTradeStreamUrl(symbol: string): string {
    return `${BINANCE_WS_BASE}/ws/${symbol.toLowerCase()}@trade`;
  }
}

// Helper to format quantities for Binance (respects LOT_SIZE rules)
export function formatQuantity(quantity: number, stepSize: string): string {
  const step = parseFloat(stepSize);
  const precision = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
  const rounded = Math.floor(quantity / step) * step;
  return rounded.toFixed(precision);
}

// Helper to format price for Binance (respects PRICE_FILTER rules)
export function formatPrice(price: number, tickSize: string): string {
  const tick = parseFloat(tickSize);
  const precision = tickSize.includes('.') ? tickSize.split('.')[1].replace(/0+$/, '').length : 0;
  const rounded = Math.round(price / tick) * tick;
  return rounded.toFixed(precision);
}
