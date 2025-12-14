'use client';

import { useState } from 'react';
import { Clock, Zap, Wrench, Hash, ChevronDown, ChevronUp, DollarSign, Brain, CheckCircle } from 'lucide-react';
import type { MessageMetrics as MetricsType } from '@/lib/api';

interface MessageMetricsProps {
  metrics?: MetricsType;
  role: 'user' | 'assistant' | 'system';
}

// Node display names for layered agent
const nodeNames: Record<string, string> = {
  plan: 'Plan',
  draft: 'Draft',
  critique: 'Review',
  repair: 'Repair',
};

export default function MessageMetrics({ metrics, role }: MessageMetricsProps) {
  const [expanded, setExpanded] = useState(false);

  if (!metrics) return null;

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTPS = (tps: number) => {
    if (tps === 0) return '-';
    return `${tps.toFixed(1)} t/s`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const formatCost = (cost: number) => {
    if (cost < 0.001) return `$${cost.toFixed(5)}`;
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(3)}`;
  };

  const hasBreakdown = metrics.llmBreakdown && metrics.llmBreakdown.length > 0;
  const totalTokens = metrics.promptTokens + metrics.completionTokens;

  return (
    <div className="mt-1.5 text-xs text-theme-text-muted">
      {/* Main metrics row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Processing time */}
        {metrics.processingTimeMs > 0 && (
          <div className="flex items-center gap-1" title="Processing time">
            <Clock className="w-3 h-3" />
            <span>{formatTime(metrics.processingTimeMs)}</span>
          </div>
        )}

        {/* Tokens per second */}
        {role === 'assistant' && metrics.tokensPerSecond > 0 && (
          <div className="flex items-center gap-1" title="Tokens per second">
            <Zap className="w-3 h-3" />
            <span>{formatTPS(metrics.tokensPerSecond)}</span>
          </div>
        )}

        {/* Token counts - clickable if breakdown available */}
        {totalTokens > 0 && (
          <button
            onClick={() => hasBreakdown && setExpanded(!expanded)}
            className={`flex items-center gap-1 ${hasBreakdown ? 'hover:text-theme-accent-primary cursor-pointer' : ''}`}
            title={hasBreakdown ? 'Click to see breakdown' : `Input: ${metrics.promptTokens}, Output: ${metrics.completionTokens}`}
            disabled={!hasBreakdown}
          >
            <Hash className="w-3 h-3" />
            <span>{formatTokens(totalTokens)}</span>
            {hasBreakdown && (
              expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
        )}

        {/* Total cost */}
        {metrics.totalCost !== undefined && metrics.totalCost > 0 && (
          <div className="flex items-center gap-1 text-green-400" title="Estimated cost">
            <DollarSign className="w-3 h-3" />
            <span>{formatCost(metrics.totalCost)}</span>
          </div>
        )}

        {/* Tools used */}
        {metrics.toolsUsed && metrics.toolsUsed.length > 0 && (
          <div className="flex items-center gap-1" title={`Tools: ${metrics.toolsUsed.join(', ')}`}>
            <Wrench className="w-3 h-3" />
            <span className="truncate max-w-[150px]">
              {metrics.toolsUsed.map(t => t.replace(/_/g, ' ')).join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Expandable breakdown */}
      {expanded && hasBreakdown && (
        <div className="mt-2 p-2 rounded-lg bg-theme-bg-tertiary border border-theme-border">
          <div className="text-[10px] uppercase tracking-wide text-theme-text-muted mb-2 flex items-center gap-1.5">
            <Brain className="w-3 h-3" />
            <span>LLM Call Breakdown</span>
          </div>
          <div className="space-y-1.5">
            {metrics.llmBreakdown!.map((call, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 py-1 px-1.5 rounded hover:bg-theme-bg-secondary transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                  <span className="font-medium text-theme-text-primary">
                    {nodeNames[call.node] || call.node}
                  </span>
                  <span className="text-theme-text-muted truncate">
                    {call.model}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span title="Input / Output tokens">
                    {formatTokens(call.inputTokens)} / {formatTokens(call.outputTokens)}
                  </span>
                  {call.durationMs && (
                    <span className="text-theme-text-muted">
                      {formatTime(call.durationMs)}
                    </span>
                  )}
                  <span className="text-green-400 w-14 text-right">
                    {formatCost(call.cost)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* Summary row */}
          <div className="mt-2 pt-2 border-t border-theme-border flex items-center justify-between text-theme-text-muted">
            <span>Total ({metrics.llmBreakdown!.length} calls)</span>
            <div className="flex items-center gap-3">
              <span>{formatTokens(metrics.promptTokens)} in / {formatTokens(metrics.completionTokens)} out</span>
              {metrics.totalCost !== undefined && (
                <span className="text-green-400 font-medium">{formatCost(metrics.totalCost)}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
