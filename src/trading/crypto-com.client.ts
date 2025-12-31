// Crypto.com Exchange API Client
// Implements IMarginExchangeClient with support for margin trading (1x-10x leverage)

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import type {
  IMarginExchangeClient,
  ExchangeType,
  ExchangeCredentials,
  ConnectionTestResult,
  AccountInfo,
  AccountBalance,
  MarginAccountBalance,
  ExchangeOrder,
  OrderParams,
  TickerPrice,
  Ticker24hr,
  Kline,
  SymbolInfo,
  MarginPosition,
  OrderFill,
} from './exchange.interface.js';
import { toCryptoComSymbol, toBinanceSymbol } from './symbol-utils.js';

// Crypto.com Exchange API endpoints
const CRYPTO_COM_API_BASE = 'https://api.crypto.com/exchange/v1';
const CRYPTO_COM_WS_USER = 'wss://stream.crypto.com/exchange/v1/user';
const CRYPTO_COM_WS_MARKET = 'wss://stream.crypto.com/exchange/v1/market';

// Symbol info cache
const symbolInfoCache = new Map<string, { info: CryptoComInstrument; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

// Crypto.com specific types
interface CryptoComResponse<T = unknown> {
  id: number;
  method: string;
  code: number;
  result?: T;
  message?: string;
}

interface CryptoComInstrument {
  symbol: string;
  inst_type: string;
  display_name: string;
  base_ccy: string;
  quote_ccy: string;
  quote_decimals: number;
  quantity_decimals: number;
  price_tick_size: string;
  qty_tick_size: string;
  max_leverage: string;
  tradable: boolean;
  min_quantity?: string;
}

interface CryptoComOrderResult {
  order_id: string;
  client_oid?: string;
  status: string;
  side: string;
  instrument_name: string;
  type: string;
  price?: string;
  quantity: string;
  cumulative_quantity: string;
  cumulative_value: string;
  avg_price?: string;
  time_in_force?: string;
  create_time: number;
  update_time: number;
  fee_currency?: string;
  fee?: string;
}

interface CryptoComBalanceResult {
  data: Array<{
    instrument_name: string;
    total_available_balance: string;
    total_margin_balance: string;
    total_cash_balance: string;
    position_balances: Array<{
      instrument_name: string;
      quantity: string;
      reserved_qty: string;
      market_value: string;
      max_withdrawal_balance: string;
      collateral_eligible: boolean;
    }>;
  }>;
}

interface CryptoComMarginBalanceResult {
  total_margin_balance: string;
  total_available_balance: string;
  total_initial_margin: string;
  total_maintenance_margin: string;
  is_liquidating: boolean;
  positions: Array<{
    instrument_name: string;
    quantity: string;
    average_price: string;
    market_value: string;
    unrealized_pnl: string;
    liquidation_price: string;
  }>;
}

interface CryptoComTickerResult {
  data: Array<{
    i: string; // instrument_name
    a: string; // best ask
    b: string; // best bid
    c: string; // 24h price change
    h: string; // 24h high
    l: string; // 24h low
    v: string; // 24h volume
    vv: string; // 24h volume in quote currency
    oi?: string; // open interest
    t: number; // timestamp
  }>;
}

interface CryptoComCandlestickResult {
  data: Array<{
    t: number; // timestamp
    o: string; // open
    h: string; // high
    l: string; // low
    c: string; // close
    v: string; // volume
  }>;
}

export class CryptoComClient implements IMarginExchangeClient {
  readonly exchangeType: ExchangeType = 'crypto_com';
  readonly supportsMargin: boolean = true;

  private apiKey: string;
  private apiSecret: string;
  private currentLeverage: number = 1;
  private requestId: number = 1;

  constructor(credentials: ExchangeCredentials, leverage?: number) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    if (leverage) {
      this.currentLeverage = Math.min(Math.max(leverage, 1), 10);
    }
  }

  /**
   * Generate HMAC-SHA256 signature for Crypto.com API
   * Format: method + id + api_key + params_string + nonce
   */
  private generateSignature(
    method: string,
    id: number,
    params: Record<string, unknown>,
    nonce: number
  ): string {
    // Sort params alphabetically and create string
    const sortedKeys = Object.keys(params).sort();
    let paramString = '';
    for (const key of sortedKeys) {
      const value = params[key];
      if (value !== undefined && value !== null) {
        paramString += key + String(value);
      }
    }

    const signPayload = method + String(id) + this.apiKey + paramString + String(nonce);
    return crypto.createHmac('sha256', this.apiSecret).update(signPayload).digest('hex');
  }

  /**
   * Make API request to Crypto.com Exchange
   * Public endpoints use GET, private endpoints use POST
   */
  private async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    isPrivate: boolean = false
  ): Promise<T> {
    const url = `${CRYPTO_COM_API_BASE}/${method}`;

    try {
      let response: Response;

      if (isPrivate) {
        // Private endpoints use POST with signature
        const id = this.requestId++;
        const nonce = Date.now();

        const body = {
          id,
          method,
          params,
          nonce,
          api_key: this.apiKey,
          sig: this.generateSignature(method, id, params, nonce),
        };

        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } else {
        // Public endpoints use GET with query params
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
        }
        const queryString = queryParams.toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;

        response = await fetch(fullUrl, {
          method: 'GET',
        });
      }

      const data = (await response.json()) as CryptoComResponse<T>;

      if (data.code !== 0) {
        const errorMsg = data.message || `Crypto.com API error: ${data.code}`;
        logger.error('Crypto.com API error', { method, code: data.code, message: data.message });
        throw new Error(errorMsg);
      }

      return data.result as T;
    } catch (error) {
      logger.error('Crypto.com request failed', { method, error });
      throw error;
    }
  }

  // ============ Connection & Authentication ============

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      // Test with a simple account balance request
      await this.request<CryptoComBalanceResult>('private/user-balance', {}, true);
      return {
        success: true,
        canTrade: true,
      };
    } catch (error) {
      return {
        success: false,
        canTrade: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const result = await this.request<CryptoComBalanceResult>('private/user-balance', {}, true);

    // Extract balances from position_balances in the first data entry
    const accountData = result.data?.[0];
    const positionBalances = accountData?.position_balances || [];

    const balances: AccountBalance[] = positionBalances.map((pos) => ({
      asset: pos.instrument_name,
      free: pos.max_withdrawal_balance || pos.quantity,
      locked: pos.reserved_qty || '0',
    }));

    return {
      balances,
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: 'SPOT',
      permissions: ['SPOT', 'MARGIN'],
    };
  }

  // ============ Market Data ============

  async getTickerPrice(symbol?: string): Promise<TickerPrice | TickerPrice[]> {
    const params: Record<string, unknown> = {};
    if (symbol) {
      params.instrument_name = toCryptoComSymbol(symbol);
    }

    const result = await this.request<CryptoComTickerResult>('public/get-tickers', params);

    const tickers = result.data.map((t) => ({
      symbol: toBinanceSymbol(t.i), // Normalize to Binance format for internal use
      price: t.a, // Use ask price as current price
    }));

    if (symbol && tickers.length > 0) {
      return tickers[0];
    }
    return tickers;
  }

  async getTicker24hr(symbol?: string): Promise<Ticker24hr | Ticker24hr[]> {
    const params: Record<string, unknown> = {};
    if (symbol) {
      params.instrument_name = toCryptoComSymbol(symbol);
    }

    const result = await this.request<CryptoComTickerResult>('public/get-tickers', params);

    const tickers = result.data.map((t) => {
      const lastPrice = t.a; // Best ask price as current price
      // t.c is already the 24h change as decimal (e.g., -0.0641 = -6.41%)
      const changeDecimal = parseFloat(t.c);
      const priceChangePercent = (changeDecimal * 100).toFixed(2);
      // Calculate absolute price change from percentage
      const currentPrice = parseFloat(lastPrice);
      const previousPrice = currentPrice / (1 + changeDecimal);
      const priceChange = (currentPrice - previousPrice).toFixed(8);

      return {
        symbol: toBinanceSymbol(t.i),
        lastPrice,
        priceChange,
        priceChangePercent,
        highPrice: t.h,
        lowPrice: t.l,
        volume: t.v,
        quoteVolume: t.vv,
      };
    });

    if (symbol && tickers.length > 0) {
      return tickers[0];
    }
    return tickers;
  }

  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 100,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]> {
    // Map interval to Crypto.com format
    const intervalMap: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '6h': '6h',
      '12h': '12h',
      '1d': '1D',
      '1w': '1W',
      '1M': '1M',
    };

    const params: Record<string, unknown> = {
      instrument_name: toCryptoComSymbol(symbol),
      timeframe: intervalMap[interval] || interval,
      count: limit,
    };

    if (startTime) {
      params.start_ts = startTime;
    }
    if (endTime) {
      params.end_ts = endTime;
    }

    const result = await this.request<CryptoComCandlestickResult>(
      'public/get-candlestick',
      params
    );

    return result.data.map((k) => ({
      openTime: k.t,
      open: k.o,
      high: k.h,
      low: k.l,
      close: k.c,
      volume: k.v,
      closeTime: k.t + this.intervalToMs(interval),
      quoteAssetVolume: '0', // Not provided by Crypto.com
      numberOfTrades: 0, // Not provided by Crypto.com
    }));
  }

  private intervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)([mhDWM])$/);
    if (!match) return 60000;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'D':
        return value * 24 * 60 * 60 * 1000;
      case 'W':
        return value * 7 * 24 * 60 * 60 * 1000;
      case 'M':
        return value * 30 * 24 * 60 * 60 * 1000;
      default:
        return 60000;
    }
  }

  // ============ Trading ============

  async placeOrder(params: OrderParams): Promise<ExchangeOrder> {
    // Generate unique client order ID
    const clientOid = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const orderParams: Record<string, unknown> = {
      instrument_name: toCryptoComSymbol(params.symbol),
      side: params.side,
      type: this.mapOrderType(params.type),
      client_oid: clientOid,
    };

    if (params.quantity) {
      orderParams.quantity = params.quantity;
    }

    if (params.quoteOrderQty) {
      // Round to 2 decimal places for USD notional
      const notionalValue = parseFloat(params.quoteOrderQty);
      orderParams.notional = notionalValue.toFixed(2);
    }

    if (params.price && params.type !== 'MARKET') {
      orderParams.price = params.price;
    }

    if (params.stopPrice) {
      orderParams.trigger_price = params.stopPrice;
    }

    if (params.timeInForce) {
      orderParams.time_in_force = this.mapTimeInForce(params.timeInForce);
    }

    // Only add spot_margin if explicitly using margin trading
    if (params.marginMode === 'MARGIN') {
      orderParams.spot_margin = 'MARGIN';
    }

    logger.info('Placing Crypto.com order', { orderParams });

    const result = await this.request<{ order_id: string; client_oid?: string }>(
      'private/create-order',
      orderParams,
      true
    );

    logger.info('Crypto.com order response', { result });

    // Create-order only returns order_id, construct response from input params
    return {
      orderId: result.order_id,
      clientOrderId: result.client_oid,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: 'NEW',
      price: params.price || '0',
      quantity: params.quantity || '0',
      executedQty: '0',
      cumulativeQuoteQty: '0',
      timeInForce: params.timeInForce,
      transactTime: Date.now(),
      fills: [],
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<ExchangeOrder> {
    await this.request<{ order_id: string }>(
      'private/cancel-order',
      {
        instrument_name: toCryptoComSymbol(symbol),
        order_id: orderId,
      },
      true
    );

    // Cancel only returns order_id, construct minimal response
    return {
      orderId,
      symbol,
      side: 'BUY',
      type: 'LIMIT',
      status: 'CANCELED',
      price: '0',
      quantity: '0',
      executedQty: '0',
      cumulativeQuoteQty: '0',
      transactTime: Date.now(),
      fills: [],
    };
  }

  async getOrder(_symbol: string, orderId: string | number): Promise<ExchangeOrder> {
    const orderIdStr = String(orderId);

    // Try get-order-detail first
    try {
      const result = await this.request<{ order_info: CryptoComOrderResult }>(
        'private/get-order-detail',
        {
          order_id: orderIdStr,
        },
        true
      );

      if (result.order_info) {
        return this.mapOrderResult(result.order_info);
      }
    } catch (err) {
      logger.debug('Order not in get-order-detail', { orderId: orderIdStr });
    }

    // Try get-order-history for completed orders (first without symbol filter, then with)
    try {
      // First try without symbol filter to get ALL recent orders
      // Note: Crypto.com returns data in `data` not `order_list`
      const allHistoryResult = await this.request<{ data: CryptoComOrderResult[], order_list?: CryptoComOrderResult[] }>(
        'private/get-order-history',
        { page_size: 20 },
        true
      );

      // API returns data in either `data` or `order_list` depending on version
      const allOrders = allHistoryResult.data || allHistoryResult.order_list || [];

      // Check if our order is in the general history
      let order = allOrders.find(o => o.order_id === orderIdStr);
      if (order) {
        logger.info('Found order in all history', { orderId: orderIdStr, status: order.status });
        return this.mapOrderResult(order);
      }

      // Also try with symbol filter
      const historyResult = await this.request<{ data: CryptoComOrderResult[], order_list?: CryptoComOrderResult[] }>(
        'private/get-order-history',
        {
          instrument_name: toCryptoComSymbol(_symbol),
          page_size: 50,
        },
        true
      );

      const orders = historyResult.data || historyResult.order_list || [];
      order = orders.find(o => o.order_id === orderIdStr);
      if (order) {
        logger.info('Found order in history', { orderId: orderIdStr, status: order.status });
        return this.mapOrderResult(order);
      }
    } catch (historyErr) {
      logger.warn('Failed to check order history', { orderId: orderIdStr, error: (historyErr as Error).message });
    }

    // Try get-trades for filled market orders (they may not appear in order history immediately)
    try {
      type TradeInfo = {
        trade_id: string;
        order_id: string;
        instrument_name: string;
        side: string;
        traded_price: string;
        traded_quantity: string;
        fee: string;
        fee_currency: string;
        create_time: number;
      };
      const tradesResult = await this.request<{ data?: TradeInfo[], trade_list?: TradeInfo[] }>(
        'private/get-trades',
        {
          instrument_name: toCryptoComSymbol(_symbol),
          page_size: 50,
        },
        true
      );

      const tradeList = tradesResult.data || tradesResult.trade_list || [];
      if (tradeList.length > 0) {
        const trades = tradeList.filter(t => t.order_id === orderIdStr);
        if (trades.length > 0) {
          // Aggregate trades for this order
          const totalQty = trades.reduce((sum, t) => sum + parseFloat(t.traded_quantity), 0);
          const totalValue = trades.reduce((sum, t) => sum + parseFloat(t.traded_price) * parseFloat(t.traded_quantity), 0);
          const avgPrice = totalQty > 0 ? totalValue / totalQty : 0;

          logger.info('Found order in trades', {
            orderId: orderIdStr,
            tradeCount: trades.length,
            totalQty,
            avgPrice
          });

          return {
            orderId: orderIdStr,
            clientOrderId: '',
            symbol: _symbol,
            side: trades[0].side.toUpperCase(),
            type: 'MARKET',
            status: 'FILLED',
            price: avgPrice.toString(),
            quantity: totalQty.toString(),
            executedQty: totalQty.toString(),
            cumulativeQuoteQty: totalValue.toString(),
            transactTime: trades[0].create_time,
            fills: trades.map(t => ({
              price: t.traded_price,
              qty: t.traded_quantity,
              commission: t.fee || '0',
              commissionAsset: t.fee_currency || 'USD',
            })),
          };
        }
      }
    } catch (tradesErr) {
      logger.debug('Failed to check trades', { orderId: orderIdStr });
    }

    // Order not found in any endpoint - DON'T assume cancelled
    // Market orders may fill before APIs update, return PENDING to retry later
    logger.warn('Order not found on Crypto.com yet', { orderId: orderIdStr, symbol: _symbol });
    return {
      orderId: orderIdStr,
      clientOrderId: '',
      symbol: _symbol,
      side: 'BUY',
      type: 'MARKET',
      status: 'PENDING', // Changed from CANCELED - let order monitor retry
      price: '0',
      quantity: '0',
      executedQty: '0',
      cumulativeQuoteQty: '0',
      transactTime: Date.now(),
      fills: [],
    };
  }

  async getOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
    const params: Record<string, unknown> = {};
    if (symbol) {
      params.instrument_name = toCryptoComSymbol(symbol);
    }

    const result = await this.request<{ data?: CryptoComOrderResult[], order_list?: CryptoComOrderResult[] }>(
      'private/get-open-orders',
      params,
      true
    );

    const orders = result.data || result.order_list || [];
    return orders.map((o) => this.mapOrderResult(o));
  }

  async getAllOrders(symbol: string, limit: number = 50): Promise<ExchangeOrder[]> {
    const result = await this.request<{ data?: CryptoComOrderResult[], order_list?: CryptoComOrderResult[] }>(
      'private/get-order-history',
      {
        instrument_name: toCryptoComSymbol(symbol),
        page_size: limit,
      },
      true
    );

    const orders = result.data || result.order_list || [];
    return orders.map((o) => this.mapOrderResult(o));
  }

  /**
   * Get trade history for a symbol - useful for verifying filled orders
   */
  async getTrades(symbol: string, limit: number = 20): Promise<Array<{
    trade_id: string;
    order_id: string;
    instrument_name: string;
    side: string;
    traded_price: string;
    traded_quantity: string;
    fee: string;
    fee_currency: string;
    create_time: number;
  }>> {
    type TradeData = {
      trade_id: string;
      order_id: string;
      instrument_name: string;
      side: string;
      traded_price: string;
      traded_quantity: string;
      fee: string;
      fee_currency: string;
      create_time: number;
    };
    const result = await this.request<{ data?: TradeData[], trade_list?: TradeData[] }>(
      'private/get-trades',
      {
        instrument_name: toCryptoComSymbol(symbol),
        page_size: limit,
      },
      true
    );

    return result.data || result.trade_list || [];
  }

  // ============ Symbol Information ============

  async getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
    const cryptoSymbol = toCryptoComSymbol(symbol);

    // Check cache
    const cached = symbolInfoCache.get(cryptoSymbol);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return this.mapInstrumentToSymbolInfo(cached.info);
    }

    try {
      // Crypto.com API returns instruments in result.data (not result.instruments)
      const result = await this.request<{ data: CryptoComInstrument[] }>(
        'public/get-instruments',
        {}
      );

      const instruments = result.data || [];
      const instrument = instruments.find((i) => i.symbol === cryptoSymbol);
      if (instrument) {
        symbolInfoCache.set(cryptoSymbol, { info: instrument, timestamp: Date.now() });
        return this.mapInstrumentToSymbolInfo(instrument);
      }

      // Symbol not found in instruments
      logger.warn('Symbol not found in Crypto.com instruments', {
        symbol: cryptoSymbol,
        totalInstruments: instruments.length,
      });
      return null;
    } catch (error) {
      logger.error('Failed to get symbol info', {
        symbol,
        cryptoSymbol,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getLotSizeFilter(symbol: string): Promise<{ stepSize: string; minQty: string } | null> {
    const info = await this.getSymbolInfo(symbol);
    if (!info) return null;
    return {
      stepSize: info.stepSize,
      minQty: info.minQty,
    };
  }

  async getMinNotional(symbol: string): Promise<string | null> {
    const info = await this.getSymbolInfo(symbol);
    return info?.minNotional || null;
  }

  // ============ Margin Trading (IMarginExchangeClient) ============

  async setLeverage(leverage: number): Promise<void> {
    // Validate leverage (1-10 per our requirements)
    const validLeverage = Math.min(Math.max(Math.floor(leverage), 1), 10);

    await this.request(
      'private/change-account-leverage',
      {
        leverage: validLeverage,
      },
      true
    );

    this.currentLeverage = validLeverage;
    logger.info('Crypto.com leverage updated', { leverage: validLeverage });
  }

  async getLeverage(): Promise<number> {
    return this.currentLeverage;
  }

  async getMarginBalance(): Promise<MarginAccountBalance[]> {
    const result = await this.request<CryptoComBalanceResult>('private/user-balance', {}, true);

    const accountData = result.data?.[0];
    const positionBalances = accountData?.position_balances || [];

    return positionBalances.map((pos) => ({
      asset: pos.instrument_name,
      free: pos.max_withdrawal_balance || pos.quantity,
      locked: pos.reserved_qty || '0',
      borrowed: '0',
      interest: '0',
      netAsset: pos.quantity,
    }));
  }

  async getMarginAccountInfo(): Promise<{
    totalEquity: number;
    availableMargin: number;
    usedMargin: number;
    marginRatio: number;
  }> {
    // Try to get margin-specific info
    try {
      const result = await this.request<CryptoComMarginBalanceResult>(
        'private/margin/get-user-config',
        {},
        true
      );

      return {
        totalEquity: parseFloat(result.total_margin_balance),
        availableMargin: parseFloat(result.total_available_balance),
        usedMargin: parseFloat(result.total_initial_margin),
        marginRatio:
          parseFloat(result.total_initial_margin) / parseFloat(result.total_margin_balance),
      };
    } catch {
      // Fallback to regular balance if margin endpoint not available
      const accountInfo = await this.getAccountInfo();
      const usdtBalance = accountInfo.balances.find(
        (b) => b.asset === 'USDT' || b.asset === 'USDC'
      );
      const available = parseFloat(usdtBalance?.free || '0');

      return {
        totalEquity: available,
        availableMargin: available,
        usedMargin: 0,
        marginRatio: 0,
      };
    }
  }

  async placeMarginOrder(params: OrderParams): Promise<ExchangeOrder> {
    // Force margin mode and apply leverage
    return this.placeOrder({
      ...params,
      marginMode: 'MARGIN',
      leverage: params.leverage || this.currentLeverage,
    });
  }

  async closeMarginPosition(symbol: string, side: 'long' | 'short'): Promise<ExchangeOrder> {
    // Get current position to determine quantity
    const positions = await this.getMarginPositions();
    const position = positions.find((p) => p.symbol === toBinanceSymbol(symbol) && p.side === side);

    if (!position) {
      throw new Error(`No ${side} position found for ${symbol}`);
    }

    // Place opposite order to close
    const closeSide = side === 'long' ? 'SELL' : 'BUY';
    return this.placeMarginOrder({
      symbol,
      side: closeSide as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity: String(position.quantity),
      marginMode: 'MARGIN',
    });
  }

  async getMarginPositions(): Promise<MarginPosition[]> {
    try {
      const result = await this.request<CryptoComMarginBalanceResult>(
        'private/margin/get-user-config',
        {},
        true
      );

      return (result.positions || []).map((p) => {
        const qty = parseFloat(p.quantity);
        return {
          symbol: toBinanceSymbol(p.instrument_name),
          side: qty >= 0 ? 'long' : 'short',
          entryPrice: parseFloat(p.average_price),
          quantity: Math.abs(qty),
          leverage: this.currentLeverage,
          liquidationPrice: p.liquidation_price ? parseFloat(p.liquidation_price) : null,
          unrealizedPnl: parseFloat(p.unrealized_pnl),
          marginUsed: parseFloat(p.market_value) / this.currentLeverage,
        } as MarginPosition;
      });
    } catch {
      // Return empty if margin endpoint not available
      return [];
    }
  }

  // ============ Helper Methods ============

  private mapOrderType(type: string): string {
    const typeMap: Record<string, string> = {
      MARKET: 'MARKET',
      LIMIT: 'LIMIT',
      STOP_LOSS: 'STOP_LOSS',
      STOP_LIMIT: 'STOP_LIMIT',
      TAKE_PROFIT: 'TAKE_PROFIT',
      TAKE_PROFIT_LIMIT: 'TAKE_PROFIT_LIMIT',
    };
    return typeMap[type] || type;
  }

  private mapTimeInForce(tif: string): string {
    const tifMap: Record<string, string> = {
      GTC: 'GOOD_TILL_CANCEL',
      IOC: 'IMMEDIATE_OR_CANCEL',
      FOK: 'FILL_OR_KILL',
    };
    return tifMap[tif] || tif;
  }

  private mapOrderResult(order: CryptoComOrderResult): ExchangeOrder {
    const fills: OrderFill[] = [];

    // If order is filled, create a fill entry
    if (order.status === 'FILLED' && order.avg_price) {
      fills.push({
        price: order.avg_price,
        qty: order.cumulative_quantity,
        commission: order.fee || '0',
        commissionAsset: order.fee_currency || 'USDT',
      });
    }

    return {
      orderId: order.order_id,
      clientOrderId: order.client_oid,
      symbol: toBinanceSymbol(order.instrument_name),
      side: order.side,
      type: order.type,
      status: this.mapOrderStatus(order.status),
      price: order.price || '0',
      quantity: order.quantity,
      executedQty: order.cumulative_quantity,
      cumulativeQuoteQty: order.cumulative_value,
      timeInForce: order.time_in_force,
      transactTime: order.update_time,
      fills,
    };
  }

  private mapOrderStatus(status: string): string {
    const statusMap: Record<string, string> = {
      ACTIVE: 'NEW',
      PENDING: 'NEW',
      FILLED: 'FILLED',
      CANCELED: 'CANCELED',
      CANCELLED: 'CANCELED',
      EXPIRED: 'EXPIRED',
      REJECTED: 'REJECTED',
    };
    return statusMap[status] || status;
  }

  private mapInstrumentToSymbolInfo(inst: CryptoComInstrument): SymbolInfo {
    return {
      symbol: toBinanceSymbol(inst.symbol),
      status: inst.tradable ? 'TRADING' : 'BREAK',
      baseAsset: inst.base_ccy,
      quoteAsset: inst.quote_ccy,
      stepSize: inst.qty_tick_size,
      minQty: inst.min_quantity || inst.qty_tick_size,
      minNotional: '10', // Default, Crypto.com doesn't expose this directly
      tickSize: inst.price_tick_size,
    };
  }

  // ============ Static WebSocket Helpers ============

  static getMarketWebSocketUrl(): string {
    return CRYPTO_COM_WS_MARKET;
  }

  static getUserWebSocketUrl(): string {
    return CRYPTO_COM_WS_USER;
  }

  static getTickerStreamSubscription(symbols: string[]): object {
    const channels = symbols.map((s) => `ticker.${toCryptoComSymbol(s)}`);
    return {
      id: Date.now(),
      method: 'subscribe',
      params: {
        channels,
      },
    };
  }
}
