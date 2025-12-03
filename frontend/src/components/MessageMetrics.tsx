'use client';

import { Clock, Zap, Wrench, Hash } from 'lucide-react';
import type { MessageMetrics as MetricsType } from '@/lib/api';

interface MessageMetricsProps {
  metrics?: MetricsType;
  role: 'user' | 'assistant' | 'system';
}

export default function MessageMetrics({ metrics, role }: MessageMetricsProps) {
  if (!metrics) return null;

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTPS = (tps: number) => {
    if (tps === 0) return '-';
    return `${tps.toFixed(1)} t/s`;
  };

  const formatTokens = (prompt: number, completion: number) => {
    return `${prompt}/${completion}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-theme-text-muted">
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

      {/* Token counts */}
      {(metrics.promptTokens > 0 || metrics.completionTokens > 0) && (
        <div className="flex items-center gap-1" title={`Input: ${metrics.promptTokens}, Output: ${metrics.completionTokens}`}>
          <Hash className="w-3 h-3" />
          <span>{formatTokens(metrics.promptTokens, metrics.completionTokens)}</span>
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
  );
}
