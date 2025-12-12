'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, Filter, Trash2, AlertCircle, CheckCircle, Info, AlertTriangle, Clock } from 'lucide-react';

type LogLevel = 'info' | 'success' | 'warn' | 'error';

interface ActivityLog {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: Date;
  details?: string;
}

const levelConfig: Record<LogLevel, { icon: typeof Info; color: string; bg: string }> = {
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  success: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-400/10' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
};

export default function ActivityWindow() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Generate some sample activity logs for demonstration
  const generateSampleLogs = useCallback((): ActivityLog[] => {
    const sampleMessages: { level: LogLevel; message: string; details?: string }[] = [
      { level: 'info', message: 'Session started', details: 'New chat session initialized' },
      { level: 'success', message: 'Message sent successfully' },
      { level: 'info', message: 'Processing request...' },
      { level: 'success', message: 'Response generated', details: 'Tokens: 150 input, 320 output' },
      { level: 'info', message: 'Tool call: search_emails', details: 'Searching for recent emails' },
      { level: 'success', message: 'Tool completed: search_emails', details: 'Found 5 results' },
      { level: 'warn', message: 'Rate limit approaching', details: '80% of hourly quota used' },
      { level: 'info', message: 'Memory updated', details: 'New fact stored about user preferences' },
      { level: 'success', message: 'Calendar event created', details: 'Meeting tomorrow at 3pm' },
      { level: 'info', message: 'Spotify: Now playing', details: 'Artist - Song Title' },
      { level: 'error', message: 'Connection timeout', details: 'Retrying in 5 seconds...' },
      { level: 'success', message: 'Connection restored' },
    ];

    const now = Date.now();
    return sampleMessages.map((msg, idx) => ({
      id: `log-${idx}`,
      ...msg,
      timestamp: new Date(now - idx * 30000), // 30 seconds apart
    }));
  }, []);

  useEffect(() => {
    // Load initial logs
    setLogs(generateSampleLogs());
  }, [generateSampleLogs]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      // In a real implementation, this would fetch from an API
      // For now, just update the timestamps to simulate real-time activity
      setLogs(prev => {
        if (prev.length === 0) return generateSampleLogs();
        return prev;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, generateSampleLogs]);

  const handleClearLogs = () => {
    if (confirm('Clear all activity logs?')) {
      setLogs([]);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.level !== filter) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };


  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
          <span className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>Activity Log</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}>
            {filteredLogs.length} entries
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded transition ${autoRefresh ? 'text-[var(--theme-accent-primary)]' : ''}`}
            style={{ color: autoRefresh ? undefined : 'var(--theme-text-muted)' }}
            title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
          </button>
          <button
            onClick={handleClearLogs}
            className="p-1.5 rounded transition hover:bg-red-500/20"
            style={{ color: 'var(--theme-text-muted)' }}
            title="Clear logs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b"
        style={{ borderColor: 'var(--theme-border-default)' }}
      >
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogLevel | 'all')}
            className="text-sm py-1 px-2 rounded focus:outline-none"
            style={{
              background: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-primary)',
              border: '1px solid var(--theme-border-default)',
            }}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="flex-1 text-sm py-1.5 px-3 rounded focus:outline-none"
          style={{
            background: 'var(--theme-bg-input)',
            color: 'var(--theme-text-primary)',
            border: '1px solid var(--theme-border-default)',
          }}
        />
      </div>

      {/* Log List */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
            <Activity className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No activity logs</p>
            {(filter !== 'all' || search) && (
              <button
                onClick={() => { setFilter('all'); setSearch(''); }}
                className="text-sm mt-2 underline"
                style={{ color: 'var(--theme-accent-primary)' }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--theme-border-default)' }}>
            {filteredLogs.map((log) => {
              const config = levelConfig[log.level];
              const Icon = config.icon;
              return (
                <div
                  key={log.id}
                  className="px-4 py-3 hover:bg-[var(--theme-bg-tertiary)] transition"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-1 rounded ${config.bg}`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                          {log.message}
                        </span>
                        <span className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                          <Clock className="w-3 h-3" />
                          {formatTime(log.timestamp)}
                        </span>
                      </div>
                      {log.details && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
                          {log.details}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 border-t text-xs flex items-center justify-between"
        style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-muted)' }}
      >
        <span>
          {autoRefresh ? 'Auto-refreshing every 5s' : 'Auto-refresh paused'}
        </span>
        <span>
          Last updated: {formatTime(new Date())}
        </span>
      </div>
    </div>
  );
}
