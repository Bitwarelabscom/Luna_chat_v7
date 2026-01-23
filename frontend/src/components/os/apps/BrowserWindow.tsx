'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, RefreshCw, ArrowLeft, ArrowRight, Home, Lock, AlertCircle } from 'lucide-react';
import { useWindowStore } from '@/lib/window-store';

interface BrowserWindowProps {
  initialUrl?: string;
}

export function BrowserWindow({ initialUrl = 'https://www.google.com' }: BrowserWindowProps) {
  // Check for pending URL from visual browse action on mount
  const consumePendingBrowserUrl = useWindowStore((state) => state.consumePendingBrowserUrl);
  const pendingBrowserUrl = useWindowStore((state) => state.pendingBrowserUrl);
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

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const navigateRef = useRef<((url: string) => void) | null>(null);

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
        const isProduction = window.location.hostname === 'luna.bitwarelabs.com';
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

        let wsUrl: string;
        if (isProduction) {
          // Production: WebSocket through nginx proxy
          wsUrl = `${protocol}//${window.location.host}/ws/browser?token=${encodeURIComponent(token)}`;
        } else {
          // Development/direct access: Connect to API server directly
          // API is on port 3005 on the same network
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
  }, [startUrl]);

  const navigate = useCallback((targetUrl: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

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
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (1280 / rect.width));
    const y = Math.round((e.clientY - rect.top) * (720 / rect.height));

    wsRef.current.send(JSON.stringify({
      type: 'click',
      x,
      y,
    }));
  }, []);

  const handleScroll = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

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

  const handleRefresh = () => {
    navigate(url);
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
          className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
          disabled
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <button
          className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
          disabled
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
        <div className="flex items-center gap-1.5">
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
