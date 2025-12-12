/**
 * Trading WebSocket Service
 *
 * Connects to Binance WebSocket streams for real-time price data
 * and broadcasts updates to connected frontend clients.
 */

import WebSocket from 'ws';
import logger from '../utils/logger.js';

// Binance WebSocket base URL
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';

// Types
interface MiniTicker {
  e: string;      // Event type
  E: number;      // Event time
  s: string;      // Symbol
  c: string;      // Close price
  o: string;      // Open price
  h: string;      // High price
  l: string;      // Low price
  v: string;      // Total traded base asset volume
  q: string;      // Total traded quote asset volume
}

interface PriceUpdate {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: number;
}

// Client management
const clients = new Set<WebSocket>();
const clientSubscriptions = new Map<WebSocket, Set<string>>();

// Binance connection
let binanceWs: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isConnecting = false;

// Price cache for instant responses
const priceCache = new Map<string, PriceUpdate>();

// Default symbols to track
const DEFAULT_SYMBOLS = [
  'BTCUSDC', 'ETHUSDC', 'BNBUSDC', 'SOLUSDC', 'XRPUSDC',
  'ADAUSDC', 'DOGEUSDC', 'AVAXUSDC', 'DOTUSDC', 'LINKUSDC'
];

/**
 * Connect to Binance WebSocket
 */
function connectToBinance(): void {
  if (isConnecting || (binanceWs && binanceWs.readyState === WebSocket.OPEN)) {
    return;
  }

  isConnecting = true;

  // Create stream URL for all mini tickers
  const streamUrl = `${BINANCE_WS_BASE}/!miniTicker@arr`;

  logger.info('Connecting to Binance WebSocket', { url: streamUrl });

  binanceWs = new WebSocket(streamUrl);

  binanceWs.on('open', () => {
    isConnecting = false;
    logger.info('Connected to Binance WebSocket');
  });

  binanceWs.on('message', (data: WebSocket.Data) => {
    try {
      const tickers = JSON.parse(data.toString()) as MiniTicker[];

      // Filter to only symbols we care about
      const trackedSymbols = new Set<string>();
      for (const subs of clientSubscriptions.values()) {
        for (const s of subs) trackedSymbols.add(s);
      }
      // Always track defaults
      DEFAULT_SYMBOLS.forEach(s => trackedSymbols.add(s));

      const updates: PriceUpdate[] = [];

      for (const ticker of tickers) {
        if (!trackedSymbols.has(ticker.s)) continue;

        const openPrice = parseFloat(ticker.o);
        const closePrice = parseFloat(ticker.c);
        const change24h = openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : 0;

        const update: PriceUpdate = {
          symbol: ticker.s,
          price: closePrice,
          change24h,
          high24h: parseFloat(ticker.h),
          low24h: parseFloat(ticker.l),
          volume: parseFloat(ticker.v),
        };

        priceCache.set(ticker.s, update);
        updates.push(update);
      }

      if (updates.length > 0) {
        broadcastPriceUpdates(updates);
      }
    } catch (error) {
      logger.error('Failed to parse Binance message', { error: (error as Error).message });
    }
  });

  binanceWs.on('error', (error) => {
    logger.error('Binance WebSocket error', { error: error.message });
  });

  binanceWs.on('close', () => {
    isConnecting = false;
    logger.warn('Binance WebSocket closed, reconnecting in 5s');

    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      connectToBinance();
    }, 5000);
  });
}

/**
 * Broadcast price updates to subscribed clients
 */
function broadcastPriceUpdates(updates: PriceUpdate[]): void {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const subscriptions = clientSubscriptions.get(client);
    if (!subscriptions) continue;

    // Filter updates to only symbols this client subscribed to
    const clientUpdates = updates.filter(u => subscriptions.has(u.symbol) || subscriptions.has('*'));

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

  // Ensure Binance connection is active
  connectToBinance();
}

/**
 * Handle messages from client
 */
function handleClientMessage(ws: WebSocket, message: { type: string; symbols?: string[]; userId?: string }): void {
  switch (message.type) {
    case 'subscribe':
      if (message.symbols && Array.isArray(message.symbols)) {
        const subs = clientSubscriptions.get(ws) || new Set();
        message.symbols.forEach(s => subs.add(s.toUpperCase()));
        clientSubscriptions.set(ws, subs);

        // Send cached prices for new subscriptions
        const prices: PriceUpdate[] = [];
        for (const symbol of message.symbols) {
          const cached = priceCache.get(symbol.toUpperCase());
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
          message.symbols.forEach(s => subs.delete(s.toUpperCase()));
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
  return priceCache.get(symbol.toUpperCase());
}

/**
 * Get all cached prices
 */
export function getAllCachedPrices(): PriceUpdate[] {
  return Array.from(priceCache.values());
}

/**
 * Initialize WebSocket service
 */
export function initializeTradingWebSocket(): void {
  connectToBinance();
  logger.info('Trading WebSocket service initialized');
}

/**
 * Cleanup on shutdown
 */
export function shutdownTradingWebSocket(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  if (binanceWs) {
    binanceWs.close();
    binanceWs = null;
  }

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
