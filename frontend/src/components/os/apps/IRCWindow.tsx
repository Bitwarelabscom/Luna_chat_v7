'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Hash, 
  Send, 
  Users, 
  Settings, 
  Info,
  Circle,
  Clock,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  User as UserIcon,
  X,
  Shield,
  AlertCircle
} from 'lucide-react';
import { useActivityStore } from '@/lib/activity-store';
import { abilitiesApi, api } from '@/lib/api';

export default function IRCWindow() {
  const [target, setTarget] = useState('#luna');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  
  // Settings form
  const [server, setServer] = useState('luna.bitwarelabs.com');
  const [port, setPort] = useState(12500);
  const [nick, setNick] = useState('Luna');
  const [channels, setChannels] = useState('#luna');
  const [tls, setTls] = useState(false);

  const activities = useActivityStore((state) => state.activities);
  const loadActivities = useActivityStore((state) => state.loadActivities);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Debug: log activities change
  useEffect(() => {
    const ircActs = activities.filter(a => a.category === 'irc');
    console.log('[IRC] Total IRC activities in store:', ircActs.length);
    if (ircActs.length > 0) {
      console.log('[IRC] Latest IRC activity:', ircActs[0]);
    }
  }, [activities]);

  // Fetch history from backend
  const fetchHistory = async () => {
    try {
      console.log('[IRC] Fetching history...');
      const data = await api<any[]>('/api/activity?category=irc&limit=100');
      console.log('[IRC] History received:', data?.length || 0, 'items');
      if (data && Array.isArray(data)) {
        loadActivities(data);
      }
      setHistoryLoaded(true);
    } catch (error) {
      console.error('[IRC] Failed to fetch IRC history:', error);
    }
  };

  // Filter IRC messages for the current target
  const filteredMessages = useMemo(() => {
    const filtered = activities
      .filter(a => {
        if (a.category !== 'irc') return false;
        
        // Show all IRC messages for now to debug, or try broad matching
        const details = a.details as any;
        const msgTarget = details?.target || '';
        const msgTitle = a.title || '';
        
        const match = target === 'all' || 
                      (typeof msgTarget === 'string' && msgTarget.toLowerCase() === target.toLowerCase()) || 
                      msgTitle.toLowerCase().includes(target.toLowerCase());
        
        return match;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    console.log(`[IRC] Filtered messages for ${target}:`, filtered.length);
    return filtered;
  }, [activities, target]);

  // Extract errors from activity stream
  const lastError = useMemo(() => {
    const errors = activities.filter(a => a.category === 'irc' && a.eventType === 'error');
    return errors.length > 0 ? errors[errors.length - 1] : null;
  }, [activities]);

  const fetchStatus = async () => {
    try {
      const s = await abilitiesApi.getIRCStatus();
      console.log('[IRC] Status fetched:', s);
      setStatus(s);
      if (s) {
        setServer(s.server);
        setPort(s.port);
        setNick(s.nick);
        setChannels(s.channels.join(', '));
        setTls(s.tls || false);
      }
    } catch (error) {
      console.error('[IRC] Failed to fetch IRC status:', error);
    }
  };

  // Initial load
  useEffect(() => {
    fetchStatus();
    fetchHistory();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!message.trim() || isSending || !status?.connected) return;

    setIsSending(true);
    const msgText = message.trim();
    setMessage('');
    try {
      console.log(`[IRC] Sending message to ${target}: ${msgText}`);
      await abilitiesApi.sendIRCMessage(target, msgText);
    } catch (error) {
      console.error('[IRC] Failed to send IRC message:', error);
      setMessage(msgText); // Restore if failed
    } finally {
      setIsSending(false);
    }
  };

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      console.log(`[IRC] Connecting to ${server}:${port}...`);
      await abilitiesApi.connectIRC({
        server,
        port: Number(port),
        nick,
        channels: channels.split(',').map(c => c.trim()).filter(Boolean),
        tls
      });
      setShowSettings(false);
      setTimeout(fetchStatus, 3000); 
    } catch (error) {
      console.error('[IRC] Failed to connect to IRC:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      console.log('[IRC] Disconnecting...');
      await abilitiesApi.disconnectIRC();
      fetchStatus();
    } catch (error) {
      console.error('[IRC] Failed to disconnect from IRC:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0 cursor-pointer" onClick={() => setTarget('all')}>
            <Hash className="w-4 h-4 text-green-500" />
            <span className="font-bold text-sm" style={{ color: 'var(--theme-text-primary)' }}>{target}</span>
          </div>
          <div className="h-3 w-px bg-gray-700 shrink-0" />
          <div className="flex items-center gap-1.5 text-xs truncate" style={{ color: 'var(--theme-text-muted)' }}>
            <Circle className={`w-2 h-2 ${status?.connected ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'}`} />
            <span className="truncate">{status?.connected ? `${status.nick} @ ${status.server}` : 'Disconnected'}</span>
            {status?.tls && (
              <span title="Secure connection">
                <Shield className="w-3 h-3 text-cyan-400 ml-1" />
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button 
            onClick={() => { fetchStatus(); fetchHistory(); }}
            className={`p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)] ${isLoading ? 'animate-spin' : ''}`}
            style={{ color: 'var(--theme-text-muted)' }}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)] ${showSettings ? 'bg-[var(--theme-bg-tertiary)]' : ''}`}
            style={{ color: showSettings ? 'var(--theme-accent-primary)' : 'var(--theme-text-muted)' }}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Settings Overlay */}
        {showSettings && (
          <div className="absolute inset-0 z-10 flex flex-col p-6 overflow-y-auto" style={{ background: 'var(--theme-bg-primary)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Server className="w-5 h-5 text-green-500" />
                Connection Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-white/10 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Server Address</label>
                <input 
                  type="text" 
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="w-full bg-[var(--theme-bg-input)] border border-[var(--theme-border-default)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Nickname</label>
                  <input 
                    type="text" 
                    value={nick}
                    onChange={(e) => setNick(e.target.value)}
                    className="w-full bg-[var(--theme-bg-input)] border border-[var(--theme-border-default)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Port</label>
                  <input 
                    type="number" 
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full bg-[var(--theme-bg-input)] border border-[var(--theme-border-default)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-gray-500">Channels (comma separated)</label>
                <input 
                  type="text" 
                  value={channels}
                  onChange={(e) => setChannels(e.target.value)}
                  className="w-full bg-[var(--theme-bg-input)] border border-[var(--theme-border-default)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>

              <div className="flex items-center gap-3 p-3 rounded bg-white/5 border border-white/10">
                <input 
                  type="checkbox" 
                  id="tls-toggle"
                  checked={tls}
                  onChange={(e) => setTls(e.target.checked)}
                  className="w-4 h-4 rounded accent-green-500"
                />
                <label htmlFor="tls-toggle" className="text-sm cursor-pointer select-none flex items-center gap-2">
                  <Shield className={`w-4 h-4 ${tls ? 'text-cyan-400' : 'text-gray-500'}`} />
                  Use SSL/TLS (Secure Connection)
                </label>
              </div>

              <div className="pt-4 flex gap-3">
                {status?.connected ? (
                  <button 
                    onClick={handleDisconnect}
                    disabled={isLoading}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded transition disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button 
                    onClick={handleConnect}
                    disabled={isLoading}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-black font-bold py-2 rounded transition disabled:opacity-50"
                  >
                    Connect
                  </button>
                )}
                <button 
                  onClick={() => setShowSettings(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sidebar */}
        <div className="w-48 border-r flex flex-col hidden md:flex shrink-0" style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}>
          <div className="p-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>Channels</span>
              <Plus className="w-3 h-3 cursor-pointer hover:text-white" />
            </div>
            <div className="space-y-0.5">
              <div 
                onClick={() => setTarget('all')}
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm ${target === 'all' ? 'bg-[var(--theme-bg-tertiary)] text-white' : 'text-gray-400 hover:bg-[var(--theme-bg-tertiary)] hover:text-gray-200'}`}
              >
                <Info className="w-3.5 h-3.5 opacity-50" />
                <span>All Messages</span>
              </div>
              {(status?.channels || ['#luna']).map((ch: string) => (
                <div 
                  key={ch}
                  onClick={() => setTarget(ch)}
                  className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm ${target === ch ? 'bg-[var(--theme-bg-tertiary)] text-white' : 'text-gray-400 hover:bg-[var(--theme-bg-tertiary)] hover:text-gray-200'}`}
                >
                  <Hash className="w-3.5 h-3.5 opacity-50" />
                  <span className="truncate">{ch.replace('#', '')}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-auto p-3 border-t" style={{ borderColor: 'var(--theme-border-default)' }}>
            {lastError && !status?.connected && (
              <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 flex gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="break-words">{lastError.message}</span>
              </div>
            )}
            <div 
              onClick={status?.connected ? handleDisconnect : handleConnect}
              className={`flex items-center gap-2 text-xs cursor-pointer p-1 rounded hover:bg-white/5 ${status?.connected ? 'text-red-400 hover:text-red-300' : 'text-green-400 hover:text-green-300'}`}
            >
              {status?.connected ? <LogOut className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{status?.connected ? 'Disconnect' : 'Connect'}</span>
            </div>
          </div>
        </div>

        {/* Message Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-sm"
          >
            {!status?.connected && !filteredMessages.length ? (
              <div className="h-full flex flex-col items-center justify-center opacity-40 text-center p-6">
                <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center mb-4">
                  <Circle className="w-4 h-4 fill-red-500 text-red-500" />
                </div>
                <h3 className="text-lg font-bold mb-2">Not Connected</h3>
                <p className="text-xs text-gray-500 mb-6">Connect to an IRC server to start chatting with Luna.</p>
                {lastError && (
                  <div className="mb-6 p-3 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400 max-w-sm mx-auto">
                    <strong>Error:</strong> {lastError.message}
                  </div>
                )}
                <button 
                  onClick={() => setShowSettings(true)}
                  className="px-4 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400 transition"
                >
                  Open Settings
                </button>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-20">
                <Hash className="w-16 h-16 mb-4" />
                <p>No messages in {target}</p>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                if (msg.eventType === 'error') {
                  return (
                    <div key={msg.id} className="flex gap-3 items-center py-1 text-red-400 italic text-xs">
                      <AlertCircle className="w-3 h-3" />
                      <span>Error: {msg.message}</span>
                    </div>
                  );
                }

                // Parse the message format "<nick> text"
                const match = msg.message?.match(/^<([^>]+)>\s*(.*)/);
                const nick = match ? match[1] : msg.details?.nick as string || 'system';
                const text = match ? match[2] : msg.message;
                const isLuna = nick === status?.nick || nick === 'Luna';

                return (
                  <div key={msg.id} className="group flex gap-3 items-baseline py-0.5 hover:bg-white/5 px-2 -mx-2 rounded">
                    <span className="text-[10px] w-10 text-gray-600 shrink-0 tabular-nums">
                      {formatTime(msg.createdAt)}
                    </span>
                    <span className={`font-bold shrink-0 ${isLuna ? 'text-cyan-400' : 'text-pink-400'}`}>
                      {nick}
                    </span>
                    <span className="text-gray-200 break-words">
                      {text}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 pt-0">
            <form 
              onSubmit={handleSendMessage}
              className={`flex items-center gap-2 p-2 rounded-lg border focus-within:ring-1 ${!status?.connected ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ 
                background: 'var(--theme-bg-input)', 
                borderColor: 'var(--theme-border-default)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
              }}
            >
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={status?.connected ? `Message ${target}...` : 'Connect to start chatting'}
                className="flex-1 bg-transparent border-none outline-none text-sm py-1 px-2"
                style={{ color: 'var(--theme-text-primary)' }}
                disabled={isSending || !status?.connected}
              />
              <button 
                type="submit"
                disabled={!message.trim() || isSending || !status?.connected}
                className="p-1.5 rounded-md transition disabled:opacity-50 hover:bg-white/10"
                style={{ color: 'var(--theme-accent-primary)' }}
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
