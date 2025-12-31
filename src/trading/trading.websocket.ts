/**
 * Trading WebSocket Service
 *
 * Connects to Crypto.com WebSocket streams for real-time price data
 * and broadcasts updates to connected frontend clients.
 */

import WebSocket from 'ws';
import logger from '../utils/logger.js';
import * as cryptoComWs from './crypto-com.websocket.js';
import * as binanceWs from './binance.websocket.js';
import { toCryptoComSymbol } from './symbol-utils.js';
import * as redisTradingService from './redis-trading.service.js';

// Types
interface PriceUpdate {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: number;
  exchange: 'crypto_com';
}

// Client management
const clients = new Set<WebSocket>();
const clientSubscriptions = new Map<WebSocket, Set<string>>();

// Price cache for instant responses
const priceCache = new Map<string, PriceUpdate>();

// Default symbols to track (Crypto.com USD pairs)
const DEFAULT_SYMBOLS = [
  'BTC_USD', 'ETH_USD', 'SOL_USD', 'XRP_USD',
  'ADA_USD', 'DOGE_USD', 'AVAX_USD', 'DOT_USD', 'LINK_USD',
  'BONK_USD', 'SHIB_USD', 'PEPE_USD'
];

/**
 * Broadcast price updates to subscribed clients
 */
function broadcastPriceUpdates(updates: PriceUpdate[]): void {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const subscriptions = clientSubscriptions.get(client);
    if (!subscriptions) continue;

    // Filter updates to only symbols this client subscribed to
    const clientUpdates = updates.filter(u =>
      subscriptions.has(u.symbol) ||
      subscriptions.has(toCryptoComSymbol(u.symbol)) ||
      subscriptions.has('*')
    );

    if (clientUpdates.length > 0) {
      client.send(JSON.stringify({
        type: 'price_update',
        data: clientUpdates,
        timestamp: Date.now(),
      }));
    }
  }
}

// Signal subscriptions for research mode
const signalSubscriptions = new Map<WebSocket, string>(); // ws -> userId

/**
 * Broadcast research signal to subscribed clients
 */
export function broadcastSignal(userId: string, signal: unknown): void {
  for (const [client, subUserId] of signalSubscriptions.entries()) {
    if (subUserId === userId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'research_signal',
        signal,
        timestamp: Date.now(),
      }));
    }
  }
}

/**
 * Handle new client connection
 */
export function handleClientConnection(ws: WebSocket): void {
  clients.add(ws);
  clientSubscriptions.set(ws, new Set(DEFAULT_SYMBOLS));

  logger.info('Trading WebSocket client connected', { totalClients: clients.size });

  // Send initial prices from cache
  const initialPrices: PriceUpdate[] = [];
  for (const symbol of DEFAULT_SYMBOLS) {
    const cached = priceCache.get(symbol);
    if (cached) initialPrices.push(cached);
  }

  if (initialPrices.length > 0) {
    ws.send(JSON.stringify({
      type: 'initial_prices',
      data: initialPrices,
      timestamp: Date.now(),
    }));
  }

  // Handle client messages
  ws.on('message', (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString());
      handleClientMessage(ws, message);
    } catch (error) {
      logger.error('Invalid client message', { error: (error as Error).message });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    clientSubscriptions.delete(ws);
    signalSubscriptions.delete(ws);
    logger.info('Trading WebSocket client disconnected', { totalClients: clients.size });
  });

  ws.on('error', (error) => {
    logger.error('Client WebSocket error', { error: error.message });
  });
}

/**
 * Handle messages from client
 */
function handleClientMessage(ws: WebSocket, message: { type: string; symbols?: string[]; userId?: string }): void {
  switch (message.type) {
    case 'subscribe':
      if (message.symbols && Array.isArray(message.symbols)) {
        const subs = clientSubscriptions.get(ws) || new Set();
        message.symbols.forEach(s => {
          // Normalize to Crypto.com format
          subs.add(toCryptoComSymbol(s));
        });
        clientSubscriptions.set(ws, subs);

        // Send cached prices for new subscriptions
        const prices: PriceUpdate[] = [];
        for (const symbol of message.symbols) {
          const normalizedSymbol = toCryptoComSymbol(symbol);
          const cached = priceCache.get(normalizedSymbol);
          if (cached) prices.push(cached);
        }
        if (prices.length > 0) {
          ws.send(JSON.stringify({
            type: 'price_update',
            data: prices,
            timestamp: Date.now(),
          }));
        }
      }
      break;

    case 'unsubscribe':
      if (message.symbols && Array.isArray(message.symbols)) {
        const subs = clientSubscriptions.get(ws);
        if (subs) {
          message.symbols.forEach(s => subs.delete(toCryptoComSymbol(s)));
        }
      }
      break;

    case 'subscribe_signals':
      if (message.userId) {
        signalSubscriptions.set(ws, message.userId);
        logger.info('Client subscribed to research signals', { userId: message.userId });
      }
      break;

    case 'unsubscribe_signals':
      signalSubscriptions.delete(ws);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      logger.warn('Unknown client message type', { type: message.type });
  }
}

/**
 * Get cached price for a symbol
 */
export function getCachedPrice(symbol: string): PriceUpdate | undefined {
  // Try both formats
  const cryptoComSymbol = toCryptoComSymbol(symbol);
  return priceCache.get(cryptoComSymbol) || priceCache.get(symbol);
}

/**
 * Get all cached prices
 */
export function getAllCachedPrices(): PriceUpdate[] {
  return Array.from(priceCache.values());
}

/**
 * Initialize WebSocket service - Crypto.com for execution + Binance for indicators
 */
export function initializeTradingWebSocket(): void {
  // Connect to Binance for accurate price data and historical candles (for indicators)
  binanceWs.initializeBinanceWebSocket({
    fetchHistory: true, // Fetch historical candles to populate Redis
    klineTimeframes: ['1m', '5m', '15m', '1h'], // Timeframes for indicator calculation
  }).catch(err => {
    logger.error('Failed to initialize Binance WebSocket', { error: err.message });
  });

  // Connect to Crypto.com and forward price updates (for execution)
  cryptoComWs.initializeCryptoComWebSocket();
  cryptoComWs.onPriceUpdate((updates) => {
    // Convert to our format and broadcast
    const priceUpdates: PriceUpdate[] = updates.map(u => ({
      symbol: u.symbol,
      price: u.price,
      change24h: u.change24h,
      high24h: u.high24h,
      low24h: u.low24h,
      volume: u.volume,
      exchange: 'crypto_com' as const,
    }));

    // Update cache with Crypto.com prices
    for (const update of priceUpdates) {
      priceCache.set(update.symbol, update);
    }

    // Write prices to Redis for centralized data access
    const redisPrices: redisTradingService.PriceData[] = priceUpdates.map(u => ({
      symbol: u.symbol,
      price: u.price,
      change24h: u.change24h,
      volume24h: u.volume,
      high24h: u.high24h,
      low24h: u.low24h,
      timestamp: Date.now(),
      source: 'crypto_com' as const,
    }));
    redisTradingService.setPrices(redisPrices).catch(err => {
      logger.error('Failed to write prices to Redis', { error: err.message });
    });

    // Broadcast to clients
    broadcastPriceUpdates(priceUpdates);
  });

  logger.info('Trading WebSocket service initialized (Binance + Crypto.com)');
}

/**
 * Cleanup on shutdown
 */
export function shutdownTradingWebSocket(): void {
  // Shutdown Binance WebSocket
  binanceWs.shutdownBinanceWebSocket();

  // Shutdown Crypto.com WebSocket
  cryptoComWs.shutdownCryptoComWebSocket();

  for (const client of clients) {
    client.close();
  }
  clients.clear();
  clientSubscriptions.clear();

  logger.info('Trading WebSocket service shut down');
}

export default {
  handleClientConnection,
  getCachedPrice,
  getAllCachedPrices,
  initializeTradingWebSocket,
  shutdownTradingWebSocket,
  broadcastSignal,
};
