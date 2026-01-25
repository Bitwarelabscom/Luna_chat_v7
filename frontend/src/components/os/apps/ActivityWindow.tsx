'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  RefreshCw,
  Filter,
  Trash2,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  Clock,
  Brain,
  Wrench,
  Database,
  Layers,
  Settings,
  Wifi,
  WifiOff,
  DollarSign,
  Zap,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Code,
  FileText,
  Copy,
  Check,
} from 'lucide-react';
import { useActivityStream } from '@/hooks/useActivityStream';
import {
  useActivityStore,
  type Activity as ActivityType,
  type ActivityCategory,
  type ActivityLevel,
  categoryConfig,
  levelConfig,
} from '@/lib/activity-store';

// Icon mapping for categories
const categoryIcons: Record<ActivityCategory, typeof Brain> = {
  llm_call: Brain,
  tool_invoke: Wrench,
  memory_op: Database,
  state_event: Layers,
  error: AlertCircle,
  background: Activity,
  system: Settings,
};

// Icon mapping for levels
const levelIcons: Record<ActivityLevel, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warn: AlertTriangle,
  error: AlertCircle,
};

export default function ActivityWindow() {
  const {
    isConnected,
    error,
    isLoading,
    refresh,
    clearAll,
    todayStats,
  } = useActivityStream();

  const activities = useActivityStore((state) => state.activities);
  const activeFilter = useActivityStore((state) => state.activeFilter);
  const levelFilter = useActivityStore((state) => state.levelFilter);
  const searchQuery = useActivityStore((state) => state.searchQuery);
  const setActiveFilter = useActivityStore((state) => state.setActiveFilter);
  const setLevelFilter = useActivityStore((state) => state.setLevelFilter);
  const setSearchQuery = useActivityStore((state) => state.setSearchQuery);

  // Track expanded activities
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter activities
  const filteredActivities = useMemo(() => {
    return activities.filter((activity) => {
      // Category filter
      if (activeFilter !== 'all' && activity.category !== activeFilter) {
        return false;
      }
      // Level filter
      if (levelFilter !== 'all' && activity.level !== levelFilter) {
        return false;
      }
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchTitle = activity.title.toLowerCase().includes(query);
        const matchMessage = activity.message?.toLowerCase().includes(query);
        const matchSource = activity.source?.toLowerCase().includes(query);
        if (!matchTitle && !matchMessage && !matchSource) {
          return false;
        }
      }
      return true;
    });
  }, [activities, activeFilter, levelFilter, searchQuery]);

  const handleClearLogs = async () => {
    if (confirm('Clear all activity logs?')) {
      await clearAll();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  // Render compact details (shown when collapsed)
  const renderCompactDetails = (activity: ActivityType) => {
    const details = activity.details;
    if (!details) return null;

    if (activity.category === 'llm_call') {
      const inputTokens = details.inputTokens as number | undefined;
      const outputTokens = details.outputTokens as number | undefined;
      const cost = details.cost as number | undefined;
      const model = details.model as string | undefined;

      return (
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {model && <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-bg-tertiary)' }}>{model}</span>}
          {inputTokens !== undefined && <span>{formatTokens(inputTokens)} in</span>}
          {outputTokens !== undefined && <span>{formatTokens(outputTokens)} out</span>}
          {cost !== undefined && <span className="text-green-400">{formatCost(cost)}</span>}
          {activity.durationMs && <span>{activity.durationMs}ms</span>}
        </div>
      );
    }

    if (activity.category === 'tool_invoke') {
      const toolName = details.toolName as string | undefined;
      const success = details.success as boolean | undefined;
      return (
        <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {toolName && <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-bg-tertiary)' }}>{toolName}</span>}
          {success !== undefined && (
            <span className={success ? 'text-green-400' : 'text-red-400'}>
              {success ? 'Success' : 'Failed'}
            </span>
          )}
          {activity.durationMs && <span>{activity.durationMs}ms</span>}
        </div>
      );
    }

    // Generic details display
    return (
      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--theme-text-muted)' }}>
        {activity.message || JSON.stringify(details)}
      </p>
    );
  };

  // Render expanded details (shown when clicked)
  const renderExpandedDetails = (activity: ActivityType) => {
    const details = activity.details;
    if (!details) return null;

    if (activity.category === 'llm_call') {
      const messages = details.messages as Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> | undefined;
      const tools = details.tools as Array<{ name: string; description?: string }> | undefined;
      const response = details.response as { content: string; finishReason: string; toolCalls?: Array<{ name: string; arguments: string }> } | undefined;
      const temperature = details.temperature as number | undefined;
      const maxTokens = details.maxTokens as number | undefined;
      const reasoning = details.reasoning as string | undefined;

      return (
        <div
          className="mt-3 space-y-3 text-xs border-t pt-3"
          style={{ borderColor: 'var(--theme-border-default)' }}
        >
          {/* Request Parameters */}
          <div className="flex items-center gap-4" style={{ color: 'var(--theme-text-muted)' }}>
            {temperature !== undefined && <span>temp: {temperature}</span>}
            {maxTokens !== undefined && <span>max_tokens: {maxTokens}</span>}
            {tools && tools.length > 0 && <span>tools: {tools.length}</span>}
          </div>

          {/* Messages */}
          {messages && messages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="font-medium">Messages ({messages.length})</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(JSON.stringify(messages, null, 2), `${activity.id}-messages`);
                  }}
                  className="ml-auto p-1 rounded hover:bg-[var(--theme-bg-tertiary)]"
                  title="Copy messages"
                >
                  {copiedId === `${activity.id}-messages` ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : (
                    <Copy className="w-3 h-3" style={{ color: 'var(--theme-text-muted)' }} />
                  )}
                </button>
              </div>
              <div
                className="space-y-2 max-h-64 overflow-auto rounded p-2"
                style={{ background: 'var(--theme-bg-tertiary)' }}
              >
                {messages.map((msg, idx) => (
                  <div key={idx} className="border-l-2 pl-2" style={{
                    borderColor: msg.role === 'system' ? '#a855f7' :
                                 msg.role === 'user' ? '#3b82f6' :
                                 msg.role === 'assistant' ? '#10b981' :
                                 msg.role === 'tool' ? '#f59e0b' : 'var(--theme-border-default)'
                  }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium" style={{
                        color: msg.role === 'system' ? '#a855f7' :
                               msg.role === 'user' ? '#3b82f6' :
                               msg.role === 'assistant' ? '#10b981' :
                               msg.role === 'tool' ? '#f59e0b' : 'var(--theme-text-primary)'
                      }}>
                        {msg.role}
                      </span>
                      {msg.tool_call_id && (
                        <span className="text-xs px-1 rounded" style={{ background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-muted)' }}>
                          {msg.tool_call_id}
                        </span>
                      )}
                    </div>
                    <pre
                      className="whitespace-pre-wrap break-words text-xs"
                      style={{ color: 'var(--theme-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      {msg.content || (msg.tool_calls ? JSON.stringify(msg.tool_calls, null, 2) : '[empty]')}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tools */}
          {tools && tools.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
                <Wrench className="w-3.5 h-3.5" />
                <span className="font-medium">Tools Available ({tools.length})</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {tools.map((tool, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded text-xs"
                    style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
                    title={tool.description}
                  >
                    {tool.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Response */}
          {response && (
            <div>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
                <FileText className="w-3.5 h-3.5" />
                <span className="font-medium">Response</span>
                <span className="text-xs px-1 rounded" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}>
                  {response.finishReason}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(response.content, `${activity.id}-response`);
                  }}
                  className="ml-auto p-1 rounded hover:bg-[var(--theme-bg-tertiary)]"
                  title="Copy response"
                >
                  {copiedId === `${activity.id}-response` ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : (
                    <Copy className="w-3 h-3" style={{ color: 'var(--theme-text-muted)' }} />
                  )}
                </button>
              </div>
              <div
                className="rounded p-2 max-h-48 overflow-auto"
                style={{ background: 'var(--theme-bg-tertiary)' }}
              >
                <pre
                  className="whitespace-pre-wrap break-words text-xs"
                  style={{ color: 'var(--theme-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {response.content || '[empty response]'}
                </pre>
                {response.toolCalls && response.toolCalls.length > 0 && (
                  <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--theme-border-default)' }}>
                    <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>Tool Calls:</span>
                    {response.toolCalls.map((tc, idx) => (
                      <div key={idx} className="mt-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--theme-text-secondary)' }}>{tc.name}</span>
                        <pre
                          className="whitespace-pre-wrap break-words text-xs mt-0.5"
                          style={{ color: 'var(--theme-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}
                        >
                          {tc.arguments}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reasoning */}
          {reasoning && (
            <div>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
                <Brain className="w-3.5 h-3.5" />
                <span className="font-medium">Reasoning</span>
              </div>
              <div
                className="rounded p-2 max-h-32 overflow-auto"
                style={{ background: 'var(--theme-bg-tertiary)' }}
              >
                <pre
                  className="whitespace-pre-wrap break-words text-xs"
                  style={{ color: 'var(--theme-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {reasoning}
                </pre>
              </div>
            </div>
          )}

          {/* Copy full JSON */}
          <div className="flex justify-end pt-2 border-t" style={{ borderColor: 'var(--theme-border-default)' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(JSON.stringify(details, null, 2), `${activity.id}-full`);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-[var(--theme-bg-tertiary)]"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              {copiedId === `${activity.id}-full` ? (
                <>
                  <Check className="w-3 h-3 text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Code className="w-3 h-3" />
                  Copy Full JSON
                </>
              )}
            </button>
          </div>
        </div>
      );
    }

    // For tool invocations, show args and result
    if (activity.category === 'tool_invoke') {
      const args = details.args as Record<string, unknown> | undefined;
      const resultPreview = details.resultPreview as string | undefined;

      return (
        <div
          className="mt-3 space-y-3 text-xs border-t pt-3"
          style={{ borderColor: 'var(--theme-border-default)' }}
        >
          {args && (
            <div>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
                <Code className="w-3.5 h-3.5" />
                <span className="font-medium">Arguments</span>
              </div>
              <div
                className="rounded p-2 max-h-32 overflow-auto"
                style={{ background: 'var(--theme-bg-tertiary)' }}
              >
                <pre
                  className="whitespace-pre-wrap break-words text-xs"
                  style={{ color: 'var(--theme-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>
            </div>
          )}
          {resultPreview && (
            <div>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
                <FileText className="w-3.5 h-3.5" />
                <span className="font-medium">Result Preview</span>
              </div>
              <div
                className="rounded p-2 max-h-32 overflow-auto"
                style={{ background: 'var(--theme-bg-tertiary)' }}
              >
                <pre
                  className="whitespace-pre-wrap break-words text-xs"
                  style={{ color: 'var(--theme-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {resultPreview}
                </pre>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Generic expanded view - show all details as JSON
    return (
      <div
        className="mt-3 text-xs border-t pt-3"
        style={{ borderColor: 'var(--theme-border-default)' }}
      >
        <div
          className="rounded p-2 max-h-48 overflow-auto"
          style={{ background: 'var(--theme-bg-tertiary)' }}
        >
          <pre
            className="whitespace-pre-wrap break-words text-xs"
            style={{ color: 'var(--theme-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}
          >
            {JSON.stringify(details, null, 2)}
          </pre>
        </div>
      </div>
    );
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
          <span className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>Activity</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
          >
            {filteredActivities.length}
          </span>
          {/* Connection status */}
          {isConnected ? (
            <span title="Connected">
              <Wifi className="w-3.5 h-3.5 text-green-400" />
            </span>
          ) : (
            <span title={error || 'Disconnected'}>
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className={`p-1.5 rounded transition hover:bg-[var(--theme-bg-tertiary)] ${isLoading ? 'animate-spin' : ''}`}
            style={{ color: 'var(--theme-text-muted)' }}
            title="Refresh"
            disabled={isLoading}
          >
            <RefreshCw className="w-4 h-4" />
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

      {/* Today's Stats Bar */}
      <div
        className="flex items-center gap-4 px-4 py-2 border-b text-xs"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-tertiary)' }}
      >
        <div className="flex items-center gap-1.5" style={{ color: 'var(--theme-text-muted)' }}>
          <Brain className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
          <span>{todayStats.llmCalls} calls</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ color: 'var(--theme-text-muted)' }}>
          <Zap className="w-3.5 h-3.5 text-yellow-400" />
          <span>{formatTokens(todayStats.totalTokens)} tokens</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ color: 'var(--theme-text-muted)' }}>
          <DollarSign className="w-3.5 h-3.5 text-green-400" />
          <span>{formatCost(todayStats.totalCost)} today</span>
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
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as ActivityCategory | 'all')}
            className="text-sm py-1 px-2 rounded focus:outline-none"
            style={{
              background: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-primary)',
              border: '1px solid var(--theme-border-default)',
            }}
          >
            <option value="all">All Types</option>
            <option value="llm_call">LLM Calls</option>
            <option value="tool_invoke">Tools</option>
            <option value="memory_op">Memory</option>
            <option value="state_event">State</option>
            <option value="error">Errors</option>
            <option value="background">Background</option>
            <option value="system">System</option>
          </select>
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as ActivityLevel | 'all')}
          className="text-sm py-1 px-2 rounded focus:outline-none"
          style={{
            background: 'var(--theme-bg-tertiary)',
            color: 'var(--theme-text-primary)',
            border: '1px solid var(--theme-border-default)',
          }}
        >
          <option value="all">All Levels</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="flex-1 text-sm py-1.5 px-3 rounded focus:outline-none"
          style={{
            background: 'var(--theme-bg-input)',
            color: 'var(--theme-text-primary)',
            border: '1px solid var(--theme-border-default)',
          }}
        />
      </div>

      {/* Activity List */}
      <div className="flex-1 overflow-auto">
        {isLoading && activities.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
          </div>
        ) : filteredActivities.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-full"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <Activity className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No activity logs</p>
            {(activeFilter !== 'all' || levelFilter !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setActiveFilter('all');
                  setLevelFilter('all');
                  setSearchQuery('');
                }}
                className="text-sm mt-2 underline"
                style={{ color: 'var(--theme-accent-primary)' }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--theme-border-default)' }}>
            {filteredActivities.map((activity) => {
              const levelCfg = levelConfig[activity.level];
              const LevelIcon = levelIcons[activity.level];
              const CategoryIcon = categoryIcons[activity.category];
              const categoryCfg = categoryConfig[activity.category];
              const isExpanded = expandedIds.has(activity.id);
              const hasDetails = activity.details && Object.keys(activity.details).length > 0;

              return (
                <div
                  key={activity.id}
                  className={`px-4 py-3 transition ${hasDetails ? 'cursor-pointer hover:bg-[var(--theme-bg-tertiary)]' : ''}`}
                  onClick={() => hasDetails && toggleExpanded(activity.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Expand indicator */}
                    {hasDetails && (
                      <div className="pt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
                        ) : (
                          <ChevronRight className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
                        )}
                      </div>
                    )}
                    {/* Level indicator */}
                    <div className={`p-1 rounded ${levelCfg.bg}`}>
                      <LevelIcon className={`w-4 h-4 ${levelCfg.color}`} />
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <CategoryIcon
                            className="w-3.5 h-3.5 flex-shrink-0"
                            style={{ color: `var(--theme-${categoryCfg.color}-500, var(--theme-text-muted))` }}
                          />
                          <span
                            className="text-sm font-medium truncate"
                            style={{ color: 'var(--theme-text-primary)' }}
                          >
                            {activity.title}
                          </span>
                        </div>
                        <span
                          className="flex items-center gap-1 text-xs flex-shrink-0"
                          style={{ color: 'var(--theme-text-muted)' }}
                        >
                          <Clock className="w-3 h-3" />
                          {formatTime(activity.createdAt)}
                        </span>
                      </div>
                      {/* Compact Details (always shown) */}
                      {renderCompactDetails(activity)}
                      {/* Expanded Details (shown when clicked) */}
                      {isExpanded && renderExpandedDetails(activity)}
                      {/* Source */}
                      {activity.source && !activity.details && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
                          {activity.source}
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
          {isConnected ? 'Real-time updates active' : error || 'Connecting...'}
        </span>
        <span>
          {activities.length} total entries
        </span>
      </div>
    </div>
  );
}
