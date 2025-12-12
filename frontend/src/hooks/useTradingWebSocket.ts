'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

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

export function useTradingWebSocket(options: UseTradingWebSocketOptions = {}) {
  const { symbols = [], onPriceUpdate, enabled = true } = options;
  const [prices, setPrices] = useState<Map<string, PriceUpdate>>(new Map());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In production (no API URL set), connect through nginx proxy at /luna-chat
    // In development (API URL set), connect directly to the API server
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    let wsUrl: string;
    if (apiUrl) {
      // Development: connect directly to API server
      const apiWsUrl = apiUrl.replace(/^http/, 'ws');
      wsUrl = `${apiWsUrl}/ws/trading`;
    } else {
      // Production: go through nginx proxy
      wsUrl = `${protocol}//${window.location.host}/luna-chat/ws/trading`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);

        // Subscribe to specific symbols if provided
        if (symbols.length > 0) {
          ws.send(JSON.stringify({
            type: 'subscribe',
            symbols,
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

              if (onPriceUpdate) {
                onPriceUpdate(message.data);
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
  }, [enabled, symbols, onPriceUpdate]);

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
