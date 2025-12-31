/**
 * Crypto.com Exchange WebSocket Service
 *
 * Connects to Crypto.com WebSocket streams for real-time price data.
 * Used alongside the Binance WebSocket to provide prices for both exchanges.
 */

import WebSocket from 'ws';
import logger from '../utils/logger.js';
import { toCryptoComSymbol, toBinanceSymbol } from './symbol-utils.js';

// Crypto.com WebSocket URLs
const CRYPTO_COM_WS_MARKET = 'wss://stream.crypto.com/exchange/v1/market';

// Types for Crypto.com WebSocket messages
interface CryptoComMessage {
  id: number;
  method: string;
  code?: number;
  result?: {
    channel?: string;
    subscription?: string;
    data?: CryptoComTickerData[];
  };
}

interface CryptoComTickerData {
  i: string;    // Instrument name (e.g., BTC_USDT)
  h: string;    // 24h high
  l: string;    // 24h low
  a: string;    // Latest trade price
  c: string;    // 24h price change
  b: string;    // Best bid price
  k: string;    // Best ask price
  v: string;    // 24h volume
  vv: string;   // 24h volume in USD
  oi?: string;  // Open interest (futures only)
  t: number;    // Update timestamp
}

interface PriceUpdate {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: number;
  exchange: 'crypto_com';
}

// Connection state
let cryptoComWs: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isConnecting = false;
let heartbeatInterval: NodeJS.Timeout | null = null;
let messageId = 1;

// Price cache
const priceCache = new Map<string, PriceUpdate>();

// Subscribed symbols
const subscribedSymbols = new Set<string>();

// Callbacks for price updates
const priceUpdateCallbacks: ((updates: PriceUpdate[]) => void)[] = [];

// Default USDT pairs to track
const DEFAULT_CRYPTO_COM_SYMBOLS = [
  'BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'SOL_USDT', 'XRP_USDT',
  'ADA_USDT', 'DOGE_USDT', 'AVAX_USDT', 'DOT_USDT', 'LINK_USDT',
  'CRO_USDT', 'MATIC_USDT', 'ATOM_USDT', 'LTC_USDT', 'UNI_USDT'
];

/**
 * Generate a unique message ID
 */
function getMessageId(): number {
  return messageId++;
}

/**
 * Connect to Crypto.com WebSocket
 */
export function connectToCryptoCom(): void {
  if (isConnecting || (cryptoComWs && cryptoComWs.readyState === WebSocket.OPEN)) {
    return;
  }

  isConnecting = true;

  logger.info('Connecting to Crypto.com WebSocket', { url: CRYPTO_COM_WS_MARKET });

  cryptoComWs = new WebSocket(CRYPTO_COM_WS_MARKET);

  cryptoComWs.on('open', () => {
    isConnecting = false;
    logger.info('Connected to Crypto.com WebSocket');

    // Start heartbeat
    startHeartbeat();

    // Subscribe to default symbols
    subscribeToSymbols(DEFAULT_CRYPTO_COM_SYMBOLS);
  });

  cryptoComWs.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString()) as CryptoComMessage;
      handleCryptoComMessage(message);
    } catch (error) {
      logger.error('Failed to parse Crypto.com message', { error: (error as Error).message });
    }
  });

  cryptoComWs.on('error', (error) => {
    logger.error('Crypto.com WebSocket error', { error: error.message });
  });

  cryptoComWs.on('close', () => {
    isConnecting = false;
    stopHeartbeat();
    logger.warn('Crypto.com WebSocket closed, reconnecting in 5s');

    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      connectToCryptoCom();
    }, 5000);
  });
}

/**
 * Handle messages from Crypto.com WebSocket
 */
function handleCryptoComMessage(message: CryptoComMessage): void {
  // Handle heartbeat response
  if (message.method === 'public/heartbeat') {
    // Respond to heartbeat
    sendMessage({
      id: message.id,
      method: 'public/respond-heartbeat',
    });
    return;
  }

  // Handle subscription response
  if (message.method === 'subscribe' && message.result?.channel === 'ticker') {
    logger.debug('Crypto.com subscription confirmed', {
      subscription: message.result.subscription,
    });
    return;
  }

  // Handle ticker updates
  if (message.result?.channel === 'ticker' && message.result.data) {
    const updates: PriceUpdate[] = [];

    for (const ticker of message.result.data) {
      const price = parseFloat(ticker.a);
      const changeAmount = parseFloat(ticker.c);
      const changePercent = price > 0 ? (changeAmount / (price - changeAmount)) * 100 : 0;

      const update: PriceUpdate = {
        symbol: ticker.i,
        price,
        change24h: changePercent,
        high24h: parseFloat(ticker.h),
        low24h: parseFloat(ticker.l),
        volume: parseFloat(ticker.v),
        exchange: 'crypto_com',
      };

      priceCache.set(ticker.i, update);
      updates.push(update);
    }

    if (updates.length > 0) {
      // Notify all registered callbacks
      for (const callback of priceUpdateCallbacks) {
        try {
          callback(updates);
        } catch (err) {
          logger.error('Price update callback error', { error: (err as Error).message });
        }
      }
    }
  }
}

/**
 * Send a message to Crypto.com WebSocket
 */
function sendMessage(message: Record<string, unknown>): void {
  if (cryptoComWs && cryptoComWs.readyState === WebSocket.OPEN) {
    cryptoComWs.send(JSON.stringify(message));
  }
}

/**
 * Start heartbeat to keep connection alive
 */
function startHeartbeat(): void {
  stopHeartbeat();
  // Crypto.com sends heartbeats every 30 seconds, we respond to them
  // But we also send our own pings to detect disconnection
  heartbeatInterval = setInterval(() => {
    if (cryptoComWs && cryptoComWs.readyState === WebSocket.OPEN) {
      cryptoComWs.ping();
    }
  }, 30000);
}

/**
 * Stop heartbeat
 */
function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Subscribe to ticker updates for symbols
 */
export function subscribeToSymbols(symbols: string[]): void {
  if (!cryptoComWs || cryptoComWs.readyState !== WebSocket.OPEN) {
    // Queue for when connection is established
    symbols.forEach(s => subscribedSymbols.add(toCryptoComSymbol(s)));
    return;
  }

  const cryptoComSymbols = symbols.map(s => toCryptoComSymbol(s));

  // Subscribe to each symbol
  for (const symbol of cryptoComSymbols) {
    if (subscribedSymbols.has(symbol)) continue;

    subscribedSymbols.add(symbol);

    sendMessage({
      id: getMessageId(),
      method: 'subscribe',
      params: {
        channels: [`ticker.${symbol}`],
      },
    });
  }

  logger.debug('Subscribed to Crypto.com symbols', { count: cryptoComSymbols.length });
}

/**
 * Unsubscribe from ticker updates for symbols
 */
export function unsubscribeFromSymbols(symbols: string[]): void {
  if (!cryptoComWs || cryptoComWs.readyState !== WebSocket.OPEN) {
    symbols.forEach(s => subscribedSymbols.delete(toCryptoComSymbol(s)));
    return;
  }

  const cryptoComSymbols = symbols.map(s => toCryptoComSymbol(s));

  for (const symbol of cryptoComSymbols) {
    if (!subscribedSymbols.has(symbol)) continue;

    subscribedSymbols.delete(symbol);

    sendMessage({
      id: getMessageId(),
      method: 'unsubscribe',
      params: {
        channels: [`ticker.${symbol}`],
      },
    });
  }
}

/**
 * Register a callback for price updates
 */
export function onPriceUpdate(callback: (updates: PriceUpdate[]) => void): () => void {
  priceUpdateCallbacks.push(callback);
  return () => {
    const index = priceUpdateCallbacks.indexOf(callback);
    if (index > -1) {
      priceUpdateCallbacks.splice(index, 1);
    }
  };
}

/**
 * Get cached price for a symbol (accepts both formats)
 */
export function getCachedPrice(symbol: string): PriceUpdate | undefined {
  // Try exact match first
  let cached = priceCache.get(symbol);
  if (cached) return cached;

  // Try Crypto.com format
  const cryptoComSymbol = toCryptoComSymbol(symbol);
  cached = priceCache.get(cryptoComSymbol);
  if (cached) return cached;

  // Try Binance format
  const binanceSymbol = toBinanceSymbol(symbol);
  for (const [key, value] of priceCache.entries()) {
    if (toBinanceSymbol(key) === binanceSymbol) {
      return value;
    }
  }

  return undefined;
}

/**
 * Get all cached prices
 */
export function getAllCachedPrices(): PriceUpdate[] {
  return Array.from(priceCache.values());
}

/**
 * Check if connected
 */
export function isConnected(): boolean {
  return cryptoComWs !== null && cryptoComWs.readyState === WebSocket.OPEN;
}

/**
 * Initialize WebSocket service
 */
export function initializeCryptoComWebSocket(): void {
  connectToCryptoCom();
  logger.info('Crypto.com WebSocket service initialized');
}

/**
 * Cleanup on shutdown
 */
export function shutdownCryptoComWebSocket(): void {
  stopHeartbeat();

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (cryptoComWs) {
    cryptoComWs.close();
    cryptoComWs = null;
  }

  subscribedSymbols.clear();
  priceCache.clear();
  priceUpdateCallbacks.length = 0;

  logger.info('Crypto.com WebSocket service shut down');
}

export default {
  connectToCryptoCom,
  subscribeToSymbols,
  unsubscribeFromSymbols,
  onPriceUpdate,
  getCachedPrice,
  getAllCachedPrices,
  isConnected,
  initializeCryptoComWebSocket,
  shutdownCryptoComWebSocket,
};
