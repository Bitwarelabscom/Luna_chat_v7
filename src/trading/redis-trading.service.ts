/**
 * Redis Trading Data Service
 * Centralized data layer for real-time trading data
 *
 * Redis Schema:
 * - trading:prices:{symbol}              -> Hash (price, change24h, volume, timestamp)
 * - trading:ohlcv:{symbol}:{timeframe}   -> Sorted Set by timestamp (max 500 candles)
 * - trading:indicators:{symbol}:{tf}     -> Hash (rsi, macd_*, bollinger_*, ema_*)
 * - trading:signals:{userId}             -> List (recent 100 signals)
 * - trading:orderbook:{symbol}           -> Hash (bids, asks as JSON arrays)
 */

import { redis } from '../db/redis.js';
import logger from '../utils/logger.js';

// Prefixes
const PRICE_PREFIX = 'trading:prices:';
const OHLCV_PREFIX = 'trading:ohlcv:';
const INDICATOR_PREFIX = 'trading:indicators:';
const SIGNAL_PREFIX = 'trading:signals:';
const ORDERBOOK_PREFIX = 'trading:orderbook:';

// Limits
const MAX_CANDLES = 500;
const MAX_SIGNALS = 100;
const PRICE_TTL = 60; // 1 minute TTL for prices
const INDICATOR_TTL = 300; // 5 minute TTL for indicators

/**
 * Normalize symbol to Binance USDT format for cache lookups.
 * Crypto.com uses BTC_USD, but our cache uses Binance's BTCUSDT format.
 */
function normalizeSymbolForCache(symbol: string): string {
  // Already in Binance format (BTCUSDT)
  if (symbol.endsWith('USDT') && !symbol.includes('_')) {
    return symbol;
  }
  // Crypto.com format (BTC_USD) -> Binance format (BTCUSDT)
  if (symbol.includes('_USD')) {
    return symbol.replace('_USD', 'USDT');
  }
  // Handle other formats like BTCUSD -> BTCUSDT
  if (symbol.endsWith('USD') && !symbol.includes('_')) {
    return symbol.replace(/USD$/, 'USDT');
  }
  return symbol;
}

// Types
export interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
  source: 'binance' | 'crypto_com' | 'aggregated';
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  symbol: string;
  timeframe: string;
  timestamp: number;
  // RSI
  rsi?: number;
  // MACD
  macd_line?: number;
  macd_signal?: number;
  macd_histogram?: number;
  // Bollinger Bands
  bollinger_upper?: number;
  bollinger_middle?: number;
  bollinger_lower?: number;
  // EMAs
  ema_9?: number;
  ema_20?: number;
  ema_21?: number;
  ema_50?: number;
  ema_200?: number;
  // Volume
  volume_sma?: number;
  volume_ratio?: number;
  // Additional
  atr?: number;
  stoch_k?: number;
  stoch_d?: number;
  // ADX (trend strength)
  adx?: number;
  plus_di?: number;
  minus_di?: number;
}

export interface TradingSignal {
  id: string;
  symbol: string;
  type: 'buy' | 'sell' | 'alert';
  strength: 'strong' | 'medium' | 'weak';
  reason: string;
  indicators: string[];
  price: number;
  timestamp: number;
  ruleId?: string;
  ruleName?: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

// Price operations
export async function setPrice(data: PriceData): Promise<void> {
  const key = `${PRICE_PREFIX}${data.symbol}`;
  await redis.hset(key, {
    symbol: data.symbol,
    price: data.price.toString(),
    change24h: data.change24h.toString(),
    volume24h: data.volume24h.toString(),
    high24h: data.high24h.toString(),
    low24h: data.low24h.toString(),
    timestamp: data.timestamp.toString(),
    source: data.source,
  });
  await redis.expire(key, PRICE_TTL);
}

export async function getPrice(symbol: string): Promise<PriceData | null> {
  // Try original symbol first
  let key = `${PRICE_PREFIX}${symbol}`;
  let data = await redis.hgetall(key);

  // If not found, try alternative formats
  if (!data || !data.price) {
    if (symbol.includes('_')) {
      // Crypto.com format (BTC_USD) -> try Binance format (BTCUSDT)
      const binanceSymbol = normalizeSymbolForCache(symbol);
      key = `${PRICE_PREFIX}${binanceSymbol}`;
      data = await redis.hgetall(key);

      // Also try _USDT format (BTC_USD -> BTC_USDT)
      if (!data || !data.price) {
        key = `${PRICE_PREFIX}${symbol}T`;
        data = await redis.hgetall(key);
      }
    } else if (symbol.endsWith('USD')) {
      // BTCUSD -> BTCUSDT
      key = `${PRICE_PREFIX}${symbol}T`;
      data = await redis.hgetall(key);
    }
  }

  if (!data || !data.price) return null;

  return {
    symbol: data.symbol,
    price: parseFloat(data.price),
    change24h: parseFloat(data.change24h),
    volume24h: parseFloat(data.volume24h),
    high24h: parseFloat(data.high24h),
    low24h: parseFloat(data.low24h),
    timestamp: parseInt(data.timestamp, 10),
    source: data.source as PriceData['source'],
  };
}

export async function getAllPrices(): Promise<PriceData[]> {
  const keys = await redis.keys(`${PRICE_PREFIX}*`);
  if (keys.length === 0) return [];

  const prices: PriceData[] = [];
  for (const key of keys) {
    const symbol = key.replace(PRICE_PREFIX, '');
    const price = await getPrice(symbol);
    if (price) prices.push(price);
  }
  return prices;
}

/**
 * Get prices for multiple symbols in a single batch operation
 * Much more efficient than calling getPrice() in a loop
 */
export async function getPricesBatch(symbols: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  if (symbols.length === 0) return priceMap;

  const pipeline = redis.pipeline();
  for (const symbol of symbols) {
    pipeline.hget(`${PRICE_PREFIX}${symbol}`, 'price');
  }

  const results = await pipeline.exec();
  if (!results) return priceMap;

  for (let i = 0; i < symbols.length; i++) {
    const [err, price] = results[i] as [Error | null, string | null];
    if (!err && price) {
      priceMap.set(symbols[i], parseFloat(price));
    }
  }

  return priceMap;
}

export async function setPrices(prices: PriceData[]): Promise<void> {
  const pipeline = redis.pipeline();
  for (const data of prices) {
    const key = `${PRICE_PREFIX}${data.symbol}`;
    pipeline.hset(key, {
      symbol: data.symbol,
      price: data.price.toString(),
      change24h: data.change24h.toString(),
      volume24h: data.volume24h.toString(),
      high24h: data.high24h.toString(),
      low24h: data.low24h.toString(),
      timestamp: data.timestamp.toString(),
      source: data.source,
    });
    pipeline.expire(key, PRICE_TTL);
  }
  await pipeline.exec();
}

// OHLCV operations
export async function addCandle(
  symbol: string,
  timeframe: string,
  candle: OHLCV
): Promise<void> {
  const key = `${OHLCV_PREFIX}${symbol}:${timeframe}`;
  const value = JSON.stringify(candle);

  // Add candle with timestamp as score
  await redis.zadd(key, candle.timestamp, value);

  // Trim to max candles (keep newest)
  const count = await redis.zcard(key);
  if (count > MAX_CANDLES) {
    await redis.zremrangebyrank(key, 0, count - MAX_CANDLES - 1);
  }
}

export async function addCandles(
  symbol: string,
  timeframe: string,
  candles: OHLCV[]
): Promise<void> {
  if (candles.length === 0) return;

  const key = `${OHLCV_PREFIX}${symbol}:${timeframe}`;
  const pipeline = redis.pipeline();

  // Add all candles
  for (const candle of candles) {
    pipeline.zadd(key, candle.timestamp, JSON.stringify(candle));
  }
  await pipeline.exec();

  // Trim to max candles
  const count = await redis.zcard(key);
  if (count > MAX_CANDLES) {
    await redis.zremrangebyrank(key, 0, count - MAX_CANDLES - 1);
  }
}

export async function getCandles(
  symbol: string,
  timeframe: string,
  limit: number = MAX_CANDLES
): Promise<OHLCV[]> {
  const normalizedSymbol = normalizeSymbolForCache(symbol);
  const key = `${OHLCV_PREFIX}${normalizedSymbol}:${timeframe}`;
  // Get newest candles (by score descending), then reverse for chronological order
  const data = await redis.zrevrange(key, 0, limit - 1);
  return data.map((item) => JSON.parse(item) as OHLCV).reverse();
}

export async function getLatestCandle(
  symbol: string,
  timeframe: string
): Promise<OHLCV | null> {
  const key = `${OHLCV_PREFIX}${symbol}:${timeframe}`;
  const data = await redis.zrevrange(key, 0, 0);
  if (data.length === 0) return null;
  return JSON.parse(data[0]) as OHLCV;
}

export async function getCandlesSince(
  symbol: string,
  timeframe: string,
  sinceTimestamp: number
): Promise<OHLCV[]> {
  const normalizedSymbol = normalizeSymbolForCache(symbol);
  const key = `${OHLCV_PREFIX}${normalizedSymbol}:${timeframe}`;
  const data = await redis.zrangebyscore(key, sinceTimestamp, '+inf');
  return data.map((item) => JSON.parse(item) as OHLCV);
}

// Indicator operations
export async function setIndicators(indicators: Indicators): Promise<void> {
  const key = `${INDICATOR_PREFIX}${indicators.symbol}:${indicators.timeframe}`;
  const data: Record<string, string> = {
    symbol: indicators.symbol,
    timeframe: indicators.timeframe,
    timestamp: indicators.timestamp.toString(),
  };

  // Only set defined values
  if (indicators.rsi !== undefined) data.rsi = indicators.rsi.toString();
  if (indicators.macd_line !== undefined) data.macd_line = indicators.macd_line.toString();
  if (indicators.macd_signal !== undefined) data.macd_signal = indicators.macd_signal.toString();
  if (indicators.macd_histogram !== undefined) data.macd_histogram = indicators.macd_histogram.toString();
  if (indicators.bollinger_upper !== undefined) data.bollinger_upper = indicators.bollinger_upper.toString();
  if (indicators.bollinger_middle !== undefined) data.bollinger_middle = indicators.bollinger_middle.toString();
  if (indicators.bollinger_lower !== undefined) data.bollinger_lower = indicators.bollinger_lower.toString();
  if (indicators.ema_9 !== undefined) data.ema_9 = indicators.ema_9.toString();
  if (indicators.ema_21 !== undefined) data.ema_21 = indicators.ema_21.toString();
  if (indicators.ema_50 !== undefined) data.ema_50 = indicators.ema_50.toString();
  if (indicators.ema_200 !== undefined) data.ema_200 = indicators.ema_200.toString();
  if (indicators.volume_sma !== undefined) data.volume_sma = indicators.volume_sma.toString();
  if (indicators.volume_ratio !== undefined) data.volume_ratio = indicators.volume_ratio.toString();
  if (indicators.atr !== undefined) data.atr = indicators.atr.toString();
  if (indicators.stoch_k !== undefined) data.stoch_k = indicators.stoch_k.toString();
  if (indicators.stoch_d !== undefined) data.stoch_d = indicators.stoch_d.toString();
  if (indicators.adx !== undefined) data.adx = indicators.adx.toString();
  if (indicators.plus_di !== undefined) data.plus_di = indicators.plus_di.toString();
  if (indicators.minus_di !== undefined) data.minus_di = indicators.minus_di.toString();
  if (indicators.ema_20 !== undefined) data.ema_20 = indicators.ema_20.toString();

  await redis.hset(key, data);
  await redis.expire(key, INDICATOR_TTL);
}

export async function getIndicators(
  symbol: string,
  timeframe: string
): Promise<Indicators | null> {
  // Normalize symbol to Binance USDT format for cache lookup
  const normalizedSymbol = normalizeSymbolForCache(symbol);
  const key = `${INDICATOR_PREFIX}${normalizedSymbol}:${timeframe}`;
  const data = await redis.hgetall(key);
  if (!data || !data.timestamp) return null;

  const indicators: Indicators = {
    symbol: data.symbol,
    timeframe: data.timeframe,
    timestamp: parseInt(data.timestamp, 10),
  };

  if (data.rsi) indicators.rsi = parseFloat(data.rsi);
  if (data.macd_line) indicators.macd_line = parseFloat(data.macd_line);
  if (data.macd_signal) indicators.macd_signal = parseFloat(data.macd_signal);
  if (data.macd_histogram) indicators.macd_histogram = parseFloat(data.macd_histogram);
  if (data.bollinger_upper) indicators.bollinger_upper = parseFloat(data.bollinger_upper);
  if (data.bollinger_middle) indicators.bollinger_middle = parseFloat(data.bollinger_middle);
  if (data.bollinger_lower) indicators.bollinger_lower = parseFloat(data.bollinger_lower);
  if (data.ema_9) indicators.ema_9 = parseFloat(data.ema_9);
  if (data.ema_21) indicators.ema_21 = parseFloat(data.ema_21);
  if (data.ema_50) indicators.ema_50 = parseFloat(data.ema_50);
  if (data.ema_200) indicators.ema_200 = parseFloat(data.ema_200);
  if (data.volume_sma) indicators.volume_sma = parseFloat(data.volume_sma);
  if (data.volume_ratio) indicators.volume_ratio = parseFloat(data.volume_ratio);
  if (data.atr) indicators.atr = parseFloat(data.atr);
  if (data.stoch_k) indicators.stoch_k = parseFloat(data.stoch_k);
  if (data.stoch_d) indicators.stoch_d = parseFloat(data.stoch_d);
  if (data.adx) indicators.adx = parseFloat(data.adx);
  if (data.plus_di) indicators.plus_di = parseFloat(data.plus_di);
  if (data.minus_di) indicators.minus_di = parseFloat(data.minus_di);
  if (data.ema_20) indicators.ema_20 = parseFloat(data.ema_20);

  return indicators;
}

export async function getAllIndicatorsForSymbol(
  symbol: string
): Promise<Map<string, Indicators>> {
  // Normalize symbol to Binance USDT format for cache lookup
  const normalizedSymbol = normalizeSymbolForCache(symbol);
  const pattern = `${INDICATOR_PREFIX}${normalizedSymbol}:*`;
  const keys = await redis.keys(pattern);
  const result = new Map<string, Indicators>();

  for (const key of keys) {
    const timeframe = key.split(':').pop()!;
    const indicators = await getIndicators(symbol, timeframe);
    if (indicators) {
      result.set(timeframe, indicators);
    }
  }

  return result;
}

// Signal operations
export async function addSignal(userId: string, signal: TradingSignal): Promise<void> {
  const key = `${SIGNAL_PREFIX}${userId}`;

  // Add to front of list
  await redis.lpush(key, JSON.stringify(signal));

  // Trim to max signals
  await redis.ltrim(key, 0, MAX_SIGNALS - 1);
}

export async function getSignals(
  userId: string,
  limit: number = 50
): Promise<TradingSignal[]> {
  const key = `${SIGNAL_PREFIX}${userId}`;
  const data = await redis.lrange(key, 0, limit - 1);
  return data.map((item) => JSON.parse(item) as TradingSignal);
}

export async function clearSignals(userId: string): Promise<void> {
  const key = `${SIGNAL_PREFIX}${userId}`;
  await redis.del(key);
}

// Order book operations
export async function setOrderBook(orderBook: OrderBook): Promise<void> {
  const key = `${ORDERBOOK_PREFIX}${orderBook.symbol}`;
  await redis.hset(key, {
    symbol: orderBook.symbol,
    bids: JSON.stringify(orderBook.bids.slice(0, 20)), // Top 20 levels
    asks: JSON.stringify(orderBook.asks.slice(0, 20)),
    timestamp: orderBook.timestamp.toString(),
  });
  await redis.expire(key, 30); // 30 second TTL
}

export async function getOrderBook(symbol: string): Promise<OrderBook | null> {
  const key = `${ORDERBOOK_PREFIX}${symbol}`;
  const data = await redis.hgetall(key);
  if (!data || !data.bids) return null;

  return {
    symbol: data.symbol,
    bids: JSON.parse(data.bids) as OrderBookLevel[],
    asks: JSON.parse(data.asks) as OrderBookLevel[],
    timestamp: parseInt(data.timestamp, 10),
  };
}

// Utility functions
export async function clearAllTradingData(): Promise<void> {
  const patterns = [
    `${PRICE_PREFIX}*`,
    `${OHLCV_PREFIX}*`,
    `${INDICATOR_PREFIX}*`,
    `${SIGNAL_PREFIX}*`,
    `${ORDERBOOK_PREFIX}*`,
  ];

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  logger.info('Cleared all trading data from Redis');
}

export async function getTradingDataStats(): Promise<{
  priceCount: number;
  ohlcvKeys: number;
  indicatorKeys: number;
  signalUsers: number;
}> {
  const [priceKeys, ohlcvKeys, indicatorKeys, signalKeys] = await Promise.all([
    redis.keys(`${PRICE_PREFIX}*`),
    redis.keys(`${OHLCV_PREFIX}*`),
    redis.keys(`${INDICATOR_PREFIX}*`),
    redis.keys(`${SIGNAL_PREFIX}*`),
  ]);

  return {
    priceCount: priceKeys.length,
    ohlcvKeys: ohlcvKeys.length,
    indicatorKeys: indicatorKeys.length,
    signalUsers: signalKeys.length,
  };
}

// Top 45 trading pairs available on Crypto.com (Binance format for WebSocket)
// Removed: TRX, MATIC, MKR, FTM, EOS (not on Crypto.com)
export const TOP_50_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'SHIBUSDT', 'DOTUSDT', 'LINKUSDT',
  'LTCUSDT', 'BCHUSDT', 'ATOMUSDT', 'UNIUSDT', 'XLMUSDT',
  'ETCUSDT', 'NEARUSDT', 'APTUSDT', 'FILUSDT', 'ARBUSDT',
  'OPUSDT', 'INJUSDT', 'SUIUSDT', 'LDOUSDT', 'IMXUSDT',
  'RUNEUSDT', 'SEIUSDT', 'TIAUSDT', 'AAVEUSDT', 'GRTUSDT',
  'ALGOUSDT', 'SANDUSDT', 'MANAUSDT', 'AXSUSDT', 'THETAUSDT',
  'EGLDUSDT', 'FLOWUSDT', 'XTZUSDT', 'SNXUSDT', 'CHZUSDT',
  'GALAUSDT', 'APEUSDT', 'CRVUSDT', 'DYDXUSDT', 'BONKUSDT',
];

// Standard timeframes
export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

// Timeframe to milliseconds mapping
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export default {
  // Price
  setPrice,
  getPrice,
  getAllPrices,
  getPricesBatch,
  setPrices,
  // OHLCV
  addCandle,
  addCandles,
  getCandles,
  getLatestCandle,
  getCandlesSince,
  // Indicators
  setIndicators,
  getIndicators,
  getAllIndicatorsForSymbol,
  // Signals
  addSignal,
  getSignals,
  clearSignals,
  // Order book
  setOrderBook,
  getOrderBook,
  // Utility
  clearAllTradingData,
  getTradingDataStats,
  // Constants
  TOP_50_PAIRS,
  TIMEFRAMES,
  TIMEFRAME_MS,
};
