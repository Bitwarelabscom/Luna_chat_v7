'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, ExternalLink, Zap, CheckCircle, XCircle, Music, Radar } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

type RadarFilter = 'all' | 'market' | 'music_trend';

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  opportunity:  { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'Opportunity' },
  threat:       { bg: 'bg-red-900/40',     text: 'text-red-400',     label: 'Threat' },
  pricing:      { bg: 'bg-amber-900/40',   text: 'text-amber-400',   label: 'Pricing' },
  policy:       { bg: 'bg-blue-900/40',    text: 'text-blue-400',    label: 'Policy' },
  trend:        { bg: 'bg-purple-900/40',  text: 'text-purple-400',  label: 'Trend' },
  music_trend:  { bg: 'bg-fuchsia-900/40', text: 'text-fuchsia-400', label: 'Music' },
};

const FILTER_TABS: Array<{ id: RadarFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'market', label: 'Market' },
  { id: 'music_trend', label: 'Music Trends' },
];

export function RadarPanel() {
  const {
    radarSignals, isLoadingRadar, loadRadarSignals,
    radarFilter, setRadarFilter,
    proposedGenres, isLoadingProposedGenres, loadProposedGenres,
    approveProposedGenre, rejectProposedGenre,
  } = useCEOLunaStore();
  const [isScraping, setIsScraping] = useState(false);

  useEffect(() => {
    loadRadarSignals();
    loadProposedGenres();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredSignals = radarSignals.filter(signal => {
    if (radarFilter === 'all') return true;
    if (radarFilter === 'music_trend') return signal.signalType === 'music_trend';
    return signal.signalType !== 'music_trend';
  });

  const handleScrapeNow = async () => {
    setIsScraping(true);
    try {
      const { triggerMusicScrape } = await import('@/lib/api/ceo');
      await triggerMusicScrape();
      // Reload data after scrape
      await Promise.all([loadRadarSignals(), loadProposedGenres()]);
    } catch (err) {
      console.error('Scrape failed:', err);
    } finally {
      setIsScraping(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">Market Radar</span>
          {isLoadingRadar && <Loader2 size={12} className="text-gray-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          {radarFilter === 'music_trend' && (
            <button
              onClick={handleScrapeNow}
              disabled={isScraping}
              className="flex items-center gap-1 px-2 py-1 text-xs text-fuchsia-400 hover:bg-fuchsia-900/30 rounded transition-colors disabled:opacity-50"
              title="Scan for music trends now"
            >
              {isScraping ? <Loader2 size={10} className="animate-spin" /> : <Radar size={10} />}
              Scan Now
            </button>
          )}
          <button
            onClick={() => { loadRadarSignals(); loadProposedGenres(); }}
            disabled={isLoadingRadar}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh signals"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setRadarFilter(tab.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              radarFilter === tab.id
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoadingRadar && radarSignals.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-gray-500 animate-spin" />
          </div>
        )}

        {!isLoadingRadar && filteredSignals.length === 0 && proposedGenres.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">
            <p>No signals yet</p>
            <p className="text-xs mt-1 text-gray-700">
              {radarFilter === 'music_trend'
                ? 'Use "Scan Now" to search for music trends'
                : 'Signals are collected during weekly CEO runs'}
            </p>
          </div>
        )}

        {/* Proposed Genres Section (only on music_trend filter) */}
        {radarFilter === 'music_trend' && proposedGenres.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Music size={12} className="text-fuchsia-400" />
              <span className="text-xs font-semibold text-fuchsia-300 uppercase tracking-wider">
                Proposed Genres ({proposedGenres.length})
              </span>
              {isLoadingProposedGenres && <Loader2 size={10} className="text-gray-500 animate-spin" />}
            </div>

            {proposedGenres.map(genre => {
              const confidencePct = Math.round(genre.confidence * 100);
              const styleTags = (genre.presetData?.styleTags as string) || '';

              return (
                <div
                  key={genre.id}
                  className="bg-gray-900 border border-fuchsia-800/30 rounded-lg p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 px-2 py-0.5 text-xs rounded-full font-medium bg-fuchsia-900/40 text-fuchsia-400">
                        {genre.category}
                      </span>
                      <span className="text-sm font-medium text-gray-200 leading-snug">{genre.name}</span>
                    </div>

                    {/* Approve / Reject buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => approveProposedGenre(genre.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-900/30 rounded transition-colors"
                        title="Approve genre"
                      >
                        <CheckCircle size={12} />
                        Approve
                      </button>
                      <button
                        onClick={() => rejectProposedGenre(genre.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 rounded transition-colors"
                        title="Reject genre"
                      >
                        <XCircle size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Style tags preview */}
                  {styleTags && (
                    <p className="text-xs text-gray-500 font-mono truncate">{styleTags}</p>
                  )}

                  {/* Confidence bar */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-600">Confidence</span>
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden max-w-[100px]">
                      <div
                        className="h-full rounded-full bg-fuchsia-500"
                        style={{ width: `${confidencePct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-fuchsia-400">{confidencePct}%</span>
                    <span className="text-xs text-gray-700 ml-auto">
                      {new Date(genre.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Separator */}
            <div className="border-t border-gray-800 pt-2" />
          </div>
        )}

        {/* Signals */}
        {filteredSignals.map((signal) => {
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
