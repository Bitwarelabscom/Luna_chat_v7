/**
 * Binance WebSocket Service
 *
 * Streams real-time market data from Binance for the top 50 trading pairs.
 * Used for accurate price data and signals - Crypto.com is used for execution.
 *
 * Binance WebSocket limits:
 * - Max 5 streams per connection (combined stream)
 * - We use combined streams endpoint to get all pairs in fewer connections
 */

import WebSocket from 'ws';
import logger from '../utils/logger.js';
import * as redisTradingService from './redis-trading.service.js';
import { TOP_50_PAIRS, TIMEFRAMES, Timeframe } from './redis-trading.service.js';

// Binance WebSocket endpoints
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream';

// State
let combinedWs: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let heartbeatInterval: NodeJS.Timeout | null = null;

// Callbacks for price updates
type PriceCallback = (updates: redisTradingService.PriceData[]) => void;
type KlineCallback = (symbol: string, timeframe: Timeframe, candle: redisTradingService.OHLCV, isFinal: boolean) => void;
const priceCallbacks: PriceCallback[] = [];
const klineCallbacks: KlineCallback[] = [];


/**
 * Build combined stream URL for multiple streams
 */
function buildCombinedStreamUrl(streams: string[]): string {
  return `${BINANCE_WS_BASE}?streams=${streams.join('/')}`;
}

/**
 * Get all stream names we need to subscribe to
 */
function getAllStreams(): string[] {
  const streams: string[] = [];

  for (const symbol of TOP_50_PAIRS) {
    const lower = symbol.toLowerCase();
    // Mini ticker for price updates (more efficient than full ticker)
    streams.push(`${lower}@miniTicker`);
  }

  // Also subscribe to 24hr tickers for volume data (less frequent)
  streams.push('!miniTicker@arr'); // All mini tickers in one stream

  return streams;
}

/**
 * Get kline streams for a specific timeframe
 */
function getKlineStreams(timeframe: Timeframe): string[] {
  return TOP_50_PAIRS.map(symbol =>
    `${symbol.toLowerCase()}@kline_${timeframe}`
  );
}

/**
 * Parse Binance mini ticker message
 */
function parseMiniTicker(data: {
  s: string;  // Symbol
  c: string;  // Close price
  o: string;  // Open price
  h: string;  // High
  l: string;  // Low
  v: string;  // Base volume
  q: string;  // Quote volume
  E: number;  // Event time
}): redisTradingService.PriceData {
  const price = parseFloat(data.c);
  const openPrice = parseFloat(data.o);
  const change24h = openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0;

  return {
    symbol: data.s,
    price,
    change24h,
    volume24h: parseFloat(data.q), // Quote volume (USDT)
    high24h: parseFloat(data.h),
    low24h: parseFloat(data.l),
    timestamp: data.E,
    source: 'binance',
  };
}

/**
 * Parse Binance kline message
 */
function parseKline(data: {
  s: string;  // Symbol
  k: {
    t: number;   // Kline start time
    T: number;   // Kline close time
    s: string;   // Symbol
    i: string;   // Interval
    o: string;   // Open
    c: string;   // Close
    h: string;   // High
    l: string;   // Low
    v: string;   // Base volume
    n: number;   // Number of trades
    x: boolean;  // Is kline closed?
    q: string;   // Quote volume
  };
}): { symbol: string; timeframe: Timeframe; candle: redisTradingService.OHLCV; isFinal: boolean } {
  const k = data.k;
  return {
    symbol: data.s,
    timeframe: k.i as Timeframe,
    candle: {
      timestamp: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.q), // Quote volume
    },
    isFinal: k.x,
  };
}

/**
 * Handle incoming WebSocket message
 */
function handleMessage(raw: WebSocket.Data): void {
  try {
    const message = JSON.parse(raw.toString());

    // Combined stream format: { stream: 'btcusdt@miniTicker', data: {...} }
    if (message.stream && message.data) {
      const stream = message.stream as string;
      const data = message.data;

      // Mini ticker (individual)
      if (stream.endsWith('@miniTicker')) {
        const priceData = parseMiniTicker(data);
        // Write to Redis
        redisTradingService.setPrice(priceData).catch(err => {
          logger.error('Failed to write Binance price to Redis', { error: err.message });
        });
        // Notify callbacks
        for (const cb of priceCallbacks) {
          cb([priceData]);
        }
      }

      // All mini tickers array
      if (stream === '!miniTicker@arr') {
        const updates: redisTradingService.PriceData[] = [];
        for (const ticker of data) {
          if (TOP_50_PAIRS.includes(ticker.s)) {
            updates.push(parseMiniTicker(ticker));
          }
        }
        if (updates.length > 0) {
          // Batch write to Redis
          redisTradingService.setPrices(updates).catch(err => {
            logger.error('Failed to write Binance prices to Redis', { error: err.message });
          });
          // Notify callbacks
          for (const cb of priceCallbacks) {
            cb(updates);
          }
        }
      }

      // Kline data
      if (stream.includes('@kline_')) {
        const parsed = parseKline(data);
        // Write to Redis when candle closes
        if (parsed.isFinal) {
          redisTradingService.addCandle(parsed.symbol, parsed.timeframe, parsed.candle).catch(err => {
            logger.error('Failed to write Binance candle to Redis', { error: err.message });
          });
        }
        // Notify callbacks
        for (const cb of klineCallbacks) {
          cb(parsed.symbol, parsed.timeframe, parsed.candle, parsed.isFinal);
        }
      }
    }
  } catch (error) {
    logger.error('Error parsing Binance message', { error: (error as Error).message });
  }
}

/**
 * Connect to Binance combined stream
 */
function connect(): void {
  if (isShuttingDown) return;

  const streams = getAllStreams();
  const url = buildCombinedStreamUrl(streams);

  logger.info('Connecting to Binance WebSocket', { streamCount: streams.length });

  combinedWs = new WebSocket(url);

  combinedWs.on('open', () => {
    logger.info('Binance WebSocket connected', { pairs: TOP_50_PAIRS.length });

    // Start heartbeat (Binance sends pings, we respond with pongs automatically)
    heartbeatInterval = setInterval(() => {
      if (combinedWs?.readyState === WebSocket.OPEN) {
        combinedWs.ping();
      }
    }, 30000);
  });

  combinedWs.on('message', handleMessage);

  combinedWs.on('close', (code, reason) => {
    logger.warn('Binance WebSocket closed', { code, reason: reason.toString() });
    cleanup();
    scheduleReconnect();
  });

  combinedWs.on('error', (error) => {
    logger.error('Binance WebSocket error', { error: error.message });
  });

  combinedWs.on('pong', () => {
    // Heartbeat response received
  });
}

/**
 * Connect to kline streams for a specific timeframe
 */
let klineConnections: Map<Timeframe, WebSocket> = new Map();

function connectKlineStream(timeframe: Timeframe): void {
  if (isShuttingDown) return;

  const streams = getKlineStreams(timeframe);
  const url = buildCombinedStreamUrl(streams);

  logger.info('Connecting to Binance kline stream', { timeframe, streamCount: streams.length });

  const ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('Binance kline stream connected', { timeframe });
    klineConnections.set(timeframe, ws);
  });

  ws.on('message', handleMessage);

  ws.on('close', (code, reason) => {
    logger.warn('Binance kline stream closed', { timeframe, code, reason: reason.toString() });
    klineConnections.delete(timeframe);
    // Reconnect after delay
    if (!isShuttingDown) {
      setTimeout(() => connectKlineStream(timeframe), 5000);
    }
  });

  ws.on('error', (error) => {
    logger.error('Binance kline stream error', { timeframe, error: error.message });
  });
}

/**
 * Clean up resources
 */
function cleanup(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  combinedWs = null;
}

/**
 * Schedule reconnect with exponential backoff
 */
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function scheduleReconnect(): void {
  if (isShuttingDown) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;

  logger.info('Scheduling Binance reconnect', { delay, attempt: reconnectAttempts });

  reconnectTimeout = setTimeout(() => {
    connect();
  }, delay);
}

/**
 * Fetch initial historical klines from REST API
 */
async function fetchHistoricalKlines(symbol: string, timeframe: Timeframe, limit: number = 500): Promise<void> {
  try {
    const interval = timeframe;
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Binance kline format: [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]
    // Timestamps are numbers, OHLCV values are strings
    const data = await response.json() as (number | string)[][];
    const candles: redisTradingService.OHLCV[] = data.map(k => ({
      timestamp: Number(k[0]),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[7])), // Quote volume
    }));

    await redisTradingService.addCandles(symbol, timeframe, candles);
    logger.debug('Fetched historical klines', { symbol, timeframe, count: candles.length });
  } catch (error) {
    logger.error('Failed to fetch historical klines', {
      symbol,
      timeframe,
      error: (error as Error).message,
    });
  }
}

/**
 * Fetch historical data for all symbols and timeframes
 */
async function fetchAllHistoricalData(): Promise<void> {
  logger.info('Fetching historical data for all symbols and timeframes');

  // Fetch in batches to avoid rate limits
  const BATCH_SIZE = 10;
  const BATCH_DELAY = 1000; // 1 second between batches

  for (const timeframe of TIMEFRAMES) {
    for (let i = 0; i < TOP_50_PAIRS.length; i += BATCH_SIZE) {
      const batch = TOP_50_PAIRS.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(symbol => fetchHistoricalKlines(symbol, timeframe)));

      if (i + BATCH_SIZE < TOP_50_PAIRS.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }
    logger.info('Completed historical fetch for timeframe', { timeframe });
  }

  logger.info('Historical data fetch complete');
}

// Public API

/**
 * Register callback for price updates
 */
export function onPriceUpdate(callback: PriceCallback): void {
  priceCallbacks.push(callback);
}

/**
 * Register callback for kline updates
 */
export function onKlineUpdate(callback: KlineCallback): void {
  klineCallbacks.push(callback);
}

/**
 * Initialize Binance WebSocket service
 */
export async function initializeBinanceWebSocket(options?: {
  fetchHistory?: boolean;
  klineTimeframes?: Timeframe[];
}): Promise<void> {
  const { fetchHistory = true, klineTimeframes = ['1m', '5m', '15m'] } = options || {};

  isShuttingDown = false;
  reconnectAttempts = 0;

  // Connect to main price stream
  connect();

  // Connect to kline streams for specified timeframes
  for (const timeframe of klineTimeframes) {
    connectKlineStream(timeframe);
  }

  // Fetch historical data if requested
  if (fetchHistory) {
    // Run in background, don't block initialization
    fetchAllHistoricalData().catch(err => {
      logger.error('Historical data fetch failed', { error: err.message });
    });
  }

  logger.info('Binance WebSocket service initialized', {
    pairs: TOP_50_PAIRS.length,
    klineTimeframes,
  });
}

/**
 * Shutdown Binance WebSocket service
 */
export function shutdownBinanceWebSocket(): void {
  isShuttingDown = true;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  cleanup();

  if (combinedWs) {
    combinedWs.close();
    combinedWs = null;
  }

  // Close all kline connections
  for (const [timeframe, ws] of klineConnections) {
    ws.close();
    logger.info('Closed kline connection', { timeframe });
  }
  klineConnections.clear();

  priceCallbacks.length = 0;
  klineCallbacks.length = 0;

  logger.info('Binance WebSocket service shut down');
}

/**
 * Check if connected
 */
export function isConnected(): boolean {
  return combinedWs?.readyState === WebSocket.OPEN;
}

/**
 * Get connection status
 */
export function getStatus(): {
  connected: boolean;
  pairs: number;
  klineConnections: string[];
} {
  return {
    connected: isConnected(),
    pairs: TOP_50_PAIRS.length,
    klineConnections: Array.from(klineConnections.keys()),
  };
}

export default {
  initializeBinanceWebSocket,
  shutdownBinanceWebSocket,
  onPriceUpdate,
  onKlineUpdate,
  isConnected,
  getStatus,
  fetchHistoricalKlines,
};
