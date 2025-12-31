'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

export interface PriceUpdate {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: number;
}

interface WebSocketMessage {
  type: 'price_update' | 'initial_prices' | 'pong';
  data?: PriceUpdate[];
  timestamp: number;
}

interface UseTradingWebSocketOptions {
  symbols?: string[];
  onPriceUpdate?: (updates: PriceUpdate[]) => void;
  enabled?: boolean;
}

// Stable empty array reference to prevent unnecessary re-renders
const EMPTY_SYMBOLS: string[] = [];

export function useTradingWebSocket(options: UseTradingWebSocketOptions = {}) {
  const { symbols: propSymbols, onPriceUpdate, enabled = true } = options;
  // Deep compare symbols to prevent reconnection when array values are the same
  const symbolsKey = (propSymbols || EMPTY_SYMBOLS).sort().join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const symbols = useMemo(() => propSymbols || EMPTY_SYMBOLS, [symbolsKey]);
  const [prices, setPrices] = useState<Map<string, PriceUpdate>>(new Map());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Store callback in ref to avoid triggering reconnection when callback changes
  const onPriceUpdateRef = useRef(onPriceUpdate);
  onPriceUpdateRef.current = onPriceUpdate;

  // Store symbols in ref to use in onopen without causing reconnection
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const connect = useCallback(() => {
    if (!enabled) return;

    // Don't create new connection if one exists
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In production (no API URL set), connect through nginx proxy
    // In development (API URL set), connect directly to the API server
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    let wsUrl: string;
    if (apiUrl) {
      // Development: connect directly to API server
      const apiWsUrl = apiUrl.replace(/^http/, 'ws');
      wsUrl = `${apiWsUrl}/ws/trading`;
    } else {
      // Production: go through nginx proxy
      wsUrl = `${protocol}//${window.location.host}/ws/trading`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);

        // Subscribe to specific symbols if provided (use ref for latest value)
        const currentSymbols = symbolsRef.current;
        if (currentSymbols.length > 0) {
          ws.send(JSON.stringify({
            type: 'subscribe',
            symbols: currentSymbols,
          }));
        }

        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'price_update' || message.type === 'initial_prices') {
            if (message.data && Array.isArray(message.data)) {
              setPrices((prev) => {
                const newPrices = new Map(prev);
                for (const update of message.data!) {
                  newPrices.set(update.symbol, update);
                }
                return newPrices;
              });

              if (onPriceUpdateRef.current) {
                onPriceUpdateRef.current(message.data);
              }
            }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Attempt to reconnect after 5 seconds
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 5000);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('WebSocket connection error');
      };
    } catch (err) {
      setError((err as Error).message);
    }
  }, [enabled]); // Only depend on enabled, not symbols

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Subscribe to new symbols when they change
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && symbols.length > 0) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        symbols,
      }));
    }
  }, [symbols]);

  // Get price for a specific symbol
  const getPrice = useCallback((symbol: string): PriceUpdate | undefined => {
    return prices.get(symbol);
  }, [prices]);

  // Get all prices as array
  const getAllPrices = useCallback((): PriceUpdate[] => {
    return Array.from(prices.values());
  }, [prices]);

  return {
    prices,
    connected,
    error,
    getPrice,
    getAllPrices,
  };
}

export default useTradingWebSocket;
