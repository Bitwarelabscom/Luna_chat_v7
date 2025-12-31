// Exchange abstraction interface
// Crypto.com is the primary exchange

export type ExchangeType = 'crypto_com';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'STOP_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT';
export type MarginMode = 'SPOT' | 'MARGIN';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface AccountBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface MarginAccountBalance extends AccountBalance {
  borrowed: string;
  interest: string;
  netAsset: string;
}

export interface OrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
}

export interface ExchangeOrder {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  price?: string;
  quantity: string;
  executedQty: string;
  cumulativeQuoteQty: string;
  timeInForce?: string;
  transactTime?: number;
  fills?: OrderFill[];
  // Extended fields for calculated values
  averagePrice?: number;
  total?: number;
  fee?: number;
  feeAsset?: string;
}

export interface OrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: TimeInForce;
  // Crypto.com margin-specific
  marginMode?: MarginMode;
  leverage?: number;
}

export interface TickerPrice {
  symbol: string;
  price: string;
}

export interface Ticker24hr {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
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
}

export interface SymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  stepSize: string;
  minQty: string;
  minNotional: string;
  tickSize: string;
}

export interface AccountInfo {
  balances: AccountBalance[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType?: string;
  permissions?: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  canTrade: boolean;
  error?: string;
}

// Base interface for all exchange clients
export interface IExchangeClient {
  readonly exchangeType: ExchangeType;
  readonly supportsMargin: boolean;

  // Connection & Authentication
  testConnection(): Promise<ConnectionTestResult>;
  getAccountInfo(): Promise<AccountInfo>;

  // Market Data
  getTickerPrice(symbol?: string): Promise<TickerPrice | TickerPrice[]>;
  getTicker24hr(symbol?: string): Promise<Ticker24hr | Ticker24hr[]>;
  getKlines(
    symbol: string,
    interval: string,
    limit?: number,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]>;

  // Trading
  placeOrder(params: OrderParams): Promise<ExchangeOrder>;
  cancelOrder(symbol: string, orderId: string): Promise<ExchangeOrder>;
  getOrder(symbol: string, orderId: string | number): Promise<ExchangeOrder>;
  getOpenOrders(symbol?: string): Promise<ExchangeOrder[]>;
  getAllOrders(symbol: string, limit?: number): Promise<ExchangeOrder[]>;

  // Symbol Information
  getSymbolInfo(symbol: string): Promise<SymbolInfo | null>;
  getLotSizeFilter(symbol: string): Promise<{ stepSize: string; minQty: string } | null>;
  getMinNotional(symbol: string): Promise<string | null>;
}

// Extended interface for exchanges that support margin trading
export interface IMarginExchangeClient extends IExchangeClient {
  // Leverage Management
  setLeverage(leverage: number): Promise<void>;
  getLeverage(): Promise<number>;

  // Margin Account
  getMarginBalance(): Promise<MarginAccountBalance[]>;
  getMarginAccountInfo(): Promise<{
    totalEquity: number;
    availableMargin: number;
    usedMargin: number;
    marginRatio: number;
  }>;

  // Margin Trading
  placeMarginOrder(params: OrderParams): Promise<ExchangeOrder>;
  closeMarginPosition(symbol: string, side: 'long' | 'short'): Promise<ExchangeOrder>;
  getMarginPositions(): Promise<MarginPosition[]>;
}

export interface MarginPosition {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  marginUsed: number;
}

// Type guard to check if client supports margin
export function isMarginClient(client: IExchangeClient): client is IMarginExchangeClient {
  return client.supportsMargin;
}
