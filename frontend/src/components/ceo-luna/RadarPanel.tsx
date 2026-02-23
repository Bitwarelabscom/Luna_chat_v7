'use client';

import { useEffect } from 'react';
import { RefreshCw, Loader2, ExternalLink, Zap } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  opportunity: { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'Opportunity' },
  threat:      { bg: 'bg-red-900/40',     text: 'text-red-400',     label: 'Threat' },
  pricing:     { bg: 'bg-amber-900/40',   text: 'text-amber-400',   label: 'Pricing' },
  policy:      { bg: 'bg-blue-900/40',    text: 'text-blue-400',    label: 'Policy' },
  trend:       { bg: 'bg-purple-900/40',  text: 'text-purple-400',  label: 'Trend' },
};

export function RadarPanel() {
  const { radarSignals, isLoadingRadar, loadRadarSignals } = useCEOLunaStore();

  useEffect(() => {
    loadRadarSignals();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">Market Radar</span>
          {isLoadingRadar && <Loader2 size={12} className="text-gray-500 animate-spin" />}
        </div>
        <button
          onClick={() => loadRadarSignals()}
          disabled={isLoadingRadar}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh signals"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Signals */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoadingRadar && radarSignals.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-gray-500 animate-spin" />
          </div>
        )}

        {!isLoadingRadar && radarSignals.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">
            <p>No signals yet</p>
            <p className="text-xs mt-1 text-gray-700">Signals are collected during weekly CEO runs</p>
          </div>
        )}

        {radarSignals.map((signal) => {
          const style = TYPE_STYLES[signal.signalType] || TYPE_STYLES.trend;
          const confidencePct = Math.round(signal.confidence * 100);

          return (
            <div
              key={signal.id}
              className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-2"
            >
              {/* Type badge + title */}
              <div className="flex items-start gap-2">
                <span className={`shrink-0 px-2 py-0.5 text-xs rounded-full font-medium ${style.bg} ${style.text}`}>
                  {style.label}
                </span>
                <span className="text-sm font-medium text-gray-200 leading-snug">{signal.title}</span>
              </div>

              {/* Summary */}
              {signal.summary && (
                <p className="text-xs text-gray-400 leading-relaxed">{signal.summary}</p>
              )}

              {/* Footer row */}
              <div className="flex items-center gap-3 pt-1">
                {/* Confidence bar */}
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-xs text-gray-600">Confidence</span>
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden max-w-[80px]">
                    <div
                      className={`h-full rounded-full ${style.bg.replace('/40', '')} ${style.text}`}
                      style={{ width: `${confidencePct}%`, background: 'currentColor' }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${style.text}`}>{confidencePct}%</span>
                </div>

                {/* Actionable */}
                {signal.actionable && (
                  <span className="flex items-center gap-0.5 text-xs text-amber-400">
                    <Zap size={10} />
                    Actionable
                  </span>
                )}

                {/* Source URL */}
                {signal.sourceUrl && (
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <ExternalLink size={10} />
                    Source
                  </a>
                )}

                {/* Date */}
                <span className="text-xs text-gray-700">
                  {new Date(signal.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
