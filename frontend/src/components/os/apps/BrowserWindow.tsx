'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, RefreshCw, ArrowLeft, ArrowRight, Home, Lock, AlertCircle } from 'lucide-react';
import { useWindowStore } from '@/lib/window-store';

const BROWSER_VIEWPORT_WIDTH = 1280;
const BROWSER_VIEWPORT_HEIGHT = 720;
const BROWSER_ASPECT_RATIO = BROWSER_VIEWPORT_WIDTH / BROWSER_VIEWPORT_HEIGHT;

interface BrowserWindowProps {
  initialUrl?: string;
}

export function BrowserWindow({ initialUrl = 'https://www.google.com' }: BrowserWindowProps) {
  // Check for pending URL from visual browse action on mount
  const consumePendingBrowserUrl = useWindowStore((state) => state.consumePendingBrowserUrl);
  const pendingBrowserUrl = useWindowStore((state) => state.pendingBrowserUrl);
  const isLunaControlling = useWindowStore((state) => state.isLunaControlling);
  const initialPendingUrl = useRef<string | null>(null);

  // Only consume on first render
  if (initialPendingUrl.current === null) {
    initialPendingUrl.current = consumePendingBrowserUrl() || '';
  }
  const startUrl = initialPendingUrl.current || initialUrl;

  const [url, setUrl] = useState(startUrl);
  const [inputUrl, setInputUrl] = useState(startUrl);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<{ entries: string[]; index: number }>(() => ({
    entries: startUrl ? [startUrl] : [],
    index: startUrl ? 0 : -1,
  }));

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const navigateRef = useRef<((url: string) => void) | null>(null);
  const navigationIntentRef = useRef<'navigate' | 'back' | 'forward' | 'refresh' | null>(null);

  const canGoBack = historyState.index > 0;
  const canGoForward = historyState.index >= 0 && historyState.index < historyState.entries.length - 1;

  const mapClientToBrowserCoordinates = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) {
      return null;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    // The browser frame is rendered using object-contain, so account for letterboxing.
    const renderedWidth = Math.min(rect.width, rect.height * BROWSER_ASPECT_RATIO);
    const renderedHeight = renderedWidth / BROWSER_ASPECT_RATIO;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;

    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;

    if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) {
      return null;
    }

    return {
      x: Math.round((localX / renderedWidth) * BROWSER_VIEWPORT_WIDTH),
      y: Math.round((localY / renderedHeight) * BROWSER_VIEWPORT_HEIGHT),
    };
  }, []);

  const applyNavigationToHistory = useCallback((nextUrl: string) => {
    setHistoryState((prev) => {
      const intent = navigationIntentRef.current;
      const { entries, index } = prev;

      const appendAsNewEntry = () => {
        const baseEntries = index >= 0 ? entries.slice(0, index + 1) : [];
        baseEntries.push(nextUrl);
        return {
          entries: baseEntries,
          index: baseEntries.length - 1,
        };
      };

      if (intent === 'back') {
        const expectedIndex = Math.max(index - 1, 0);
        if (entries[expectedIndex] === nextUrl) {
          return { entries, index: expectedIndex };
        }

        const existingIndex = entries.lastIndexOf(nextUrl);
        if (existingIndex !== -1) {
          return { entries, index: existingIndex };
        }

        return appendAsNewEntry();
      }

      if (intent === 'forward') {
        const expectedIndex = Math.min(index + 1, entries.length - 1);
        if (entries[expectedIndex] === nextUrl) {
          return { entries, index: expectedIndex };
        }

        const existingIndex = entries.indexOf(nextUrl);
        if (existingIndex !== -1) {
          return { entries, index: existingIndex };
        }

        return appendAsNewEntry();
      }

      if (intent === 'refresh') {
        if (index >= 0 && entries[index] === nextUrl) {
          return prev;
        }
        return appendAsNewEntry();
      }

      if (index >= 0 && entries[index] === nextUrl) {
        return prev;
      }

      return appendAsNewEntry();
    });

    navigationIntentRef.current = null;
  }, []);

  // Connect to browser WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let cancelled = false;

    const connect = async () => {
      try {
        // Fetch short-lived WebSocket token
        const tokenRes = await fetch('/api/auth/ws-token', {
          method: 'POST',
          credentials: 'include',
        });

        if (!tokenRes.ok) {
          if (tokenRes.status === 401) {
            setError('Authentication required - please log in');
          } else {
            setError('Failed to get authentication token');
          }
          return;
        }

        const { token } = await tokenRes.json();

        if (cancelled) return;

        // Determine WebSocket URL
        // In production (via nginx), use same host
        // In development or direct access, use the API server
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

        let wsUrl: string;
        if (apiUrl) {
          wsUrl = `${apiUrl.replace(/^http/, 'ws')}/ws/browser?token=${encodeURIComponent(token)}`;
        } else if (window.location.hostname === 'luna.bitwarelabs.com') {
          // Production via nginx proxy: use same host
          wsUrl = `${protocol}//${window.location.host}/ws/browser?token=${encodeURIComponent(token)}`;
        } else {
          // Development/direct access: Connect to API server directly
          const apiHost = window.location.hostname === 'localhost'
            ? 'localhost:3005'
            : `${window.location.hostname.replace(':3004', '')}:3005`;
          wsUrl = `ws://${apiHost}/ws/browser?token=${encodeURIComponent(token)}`;
        }

        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            switch (msg.type) {
              case 'browser_ready':
                setIsLoading(false);
                // Navigate to initial URL (could be pending visual browse URL)
                if (startUrl) {
                  navigate(startUrl);
                }
                break;

              case 'browser_frame':
                setFrame(`data:image/jpeg;base64,${msg.data}`);
                break;

              case 'browser_navigated':
                setUrl(msg.url);
                setInputUrl(msg.url);
                setIsLoading(false);
                applyNavigationToHistory(msg.url);
                break;

              case 'browser_error':
                setError(msg.error);
                setIsLoading(false);
                break;

              case 'error':
                // Handle authentication errors from server
                if (msg.code === 4001) {
                  setError('Authentication required - please log in');
                } else if (msg.code === 4002) {
                  setError('Session expired - please refresh the page');
                } else {
                  setError(msg.error || 'Connection error');
                }
                break;

              case 'pong':
                // Heartbeat response
                break;
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          setError('WebSocket connection error');
          setIsConnected(false);
        };

        ws.onclose = (event) => {
          setIsConnected(false);
          // Show meaningful error based on close code
          if (event.code === 4001) {
            setError('Authentication required - please log in');
          } else if (event.code === 4002) {
            setError('Session expired - please refresh the page');
          } else if (event.code === 4003) {
            setError('Failed to start browser session');
          }
        };

        // Heartbeat
        heartbeat = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);

      } catch (err) {
        console.error('Failed to connect to browser:', err);
        setError('Failed to connect to browser');
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      if (ws) ws.close();
    };
  }, [startUrl, applyNavigationToHistory]);

  const navigate = useCallback((targetUrl: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    navigationIntentRef.current = 'navigate';
    setIsLoading(true);
    setError(null);
    wsRef.current.send(JSON.stringify({
      type: 'navigate',
      url: targetUrl,
    }));
  }, []);

  // Store navigate in ref for use in effect
  navigateRef.current = navigate;

  // Watch for new pending URLs while browser is open (for subsequent Luna searches)
  useEffect(() => {
    if (pendingBrowserUrl && isConnected && navigateRef.current) {
      const urlToNavigate = consumePendingBrowserUrl();
      if (urlToNavigate) {
        navigateRef.current(urlToNavigate);
      }
    }
  }, [pendingBrowserUrl, isConnected, consumePendingBrowserUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let targetUrl = inputUrl.trim();

    // Add protocol if missing
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    navigate(targetUrl);
  };

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const coords = mapClientToBrowserCoordinates(e.clientX, e.clientY);
    if (!coords) {
      return;
    }

    canvasRef.current?.focus();
    wsRef.current.send(JSON.stringify({
      type: 'click',
      x: coords.x,
      y: coords.y,
    }));
  }, [mapClientToBrowserCoordinates]);

  const handleScroll = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    e.preventDefault();
    canvasRef.current?.focus();
    wsRef.current.send(JSON.stringify({
      type: 'scroll',
      deltaY: e.deltaY,
    }));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Prevent default for common browser shortcuts
    if (['Tab', 'Enter', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      wsRef.current.send(JSON.stringify({
        type: 'keypress',
        key: e.key,
      }));
    } else if (e.key.length === 1) {
      // Single character keys
      wsRef.current.send(JSON.stringify({
        type: 'type',
        text: e.key,
      }));
    }
  }, []);

  const handleBack = () => {
    if (!canGoBack || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    navigationIntentRef.current = 'back';
    setIsLoading(true);
    setError(null);
    wsRef.current.send(JSON.stringify({ type: 'back' }));
  };

  const handleForward = () => {
    if (!canGoForward || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    navigationIntentRef.current = 'forward';
    setIsLoading(true);
    setError(null);
    wsRef.current.send(JSON.stringify({ type: 'forward' }));
  };

  const handleRefresh = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    navigationIntentRef.current = 'refresh';
    setIsLoading(true);
    setError(null);
    wsRef.current.send(JSON.stringify({ type: 'refresh' }));
  };

  const handleHome = () => {
    navigate('https://www.google.com');
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Browser Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{
          background: 'var(--theme-bg-secondary)',
          borderColor: 'var(--theme-border)',
        }}
      >
        {/* Navigation Buttons */}
        <button
          onClick={handleBack}
          className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
          disabled={!canGoBack}
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <button
          onClick={handleForward}
          className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
          disabled={!canGoForward}
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <button
          onClick={handleRefresh}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="Refresh"
        >
          <RefreshCw
            className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
            style={{ color: 'var(--theme-text-secondary)' }}
          />
        </button>
        <button
          onClick={handleHome}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="Home"
        >
          <Home className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>

        {/* URL Bar */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center">
          <div
            className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{
              background: 'var(--theme-bg-tertiary)',
              border: '1px solid var(--theme-border)',
            }}
          >
            {url.startsWith('https://') ? (
              <Lock className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
            ) : (
              <Globe className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-secondary)' }} />
            )}
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="flex-1 bg-transparent text-sm focus:outline-none"
              style={{ color: 'var(--theme-text-primary)' }}
              placeholder="Enter URL..."
            />
          </div>
        </form>

        {/* Connection Status */}
        <div className="flex items-center gap-2">
          {isLunaControlling && (
            <span
              className="text-[11px] px-2 py-1 rounded-full animate-pulse"
              style={{
                background: 'rgba(59, 130, 246, 0.15)',
                color: 'var(--theme-accent-primary)',
                border: '1px solid rgba(59, 130, 246, 0.45)',
              }}
            >
              Luna is controlling
            </span>
          )}
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Browser Content */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden cursor-pointer"
        style={{ background: '#fff' }}
        onClick={handleClick}
        onWheel={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {!isConnected ? (
          <div
            className="absolute inset-0 flex items-center justify-center flex-col gap-4"
            style={{ background: 'var(--theme-bg-primary)' }}
          >
            <Globe className="w-16 h-16" style={{ color: 'var(--theme-text-secondary)' }} />
            <p className="text-lg" style={{ color: 'var(--theme-text-secondary)' }}>
              Connecting to browser...
            </p>
          </div>
        ) : error ? (
          <div
            className="absolute inset-0 flex items-center justify-center flex-col gap-4"
            style={{ background: 'var(--theme-bg-primary)' }}
          >
            <AlertCircle className="w-16 h-16 text-red-500" />
            <p className="text-lg text-red-500">{error}</p>
            <button
              onClick={() => setError(null)}
              className="px-4 py-2 rounded-lg"
              style={{
                background: 'var(--theme-accent-primary)',
                color: 'var(--theme-bg-primary)',
              }}
            >
              Retry
            </button>
          </div>
        ) : frame ? (
          <img
            src={frame}
            alt="Browser view"
            className="w-full h-full object-contain"
            draggable={false}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'var(--theme-bg-primary)' }}
          >
            <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
          </div>
        )}

        {isLoading && frame && (
          <div className="absolute top-0 left-0 right-0 h-1">
            <div
              className="h-full animate-pulse"
              style={{
                background: 'var(--theme-accent-primary)',
                width: '30%',
                animation: 'loading 1.5s ease-in-out infinite',
              }}
            />
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}

export default BrowserWindow;
