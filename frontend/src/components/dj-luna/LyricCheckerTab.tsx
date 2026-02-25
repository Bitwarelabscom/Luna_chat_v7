'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Loader2, Wand2 } from 'lucide-react';
import { useDJLunaStore } from '@/lib/dj-luna-store';
import { GENRE_PRESETS } from '@/lib/genre-presets';
import { analyzeLyrics } from '@/lib/lyric-checker';
import type { LyricAnalysisResult } from '@/lib/lyric-checker';
import { getRhymeSuggestions } from '@/lib/api/dj';
import type { RhymeSuggestion } from '@/lib/api/dj';

export function LyricCheckerTab() {
  const { canvasContent, activeGenreId, setActiveGenreId } = useDJLunaStore();
  const selectedGenreId = activeGenreId ?? 'pop';
  const [result, setResult] = useState<LyricAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [llmSuggestions, setLlmSuggestions] = useState<RhymeSuggestion[]>([]);
  const [llmError, setLlmError] = useState<string | null>(null);

  const selectedPreset = GENRE_PRESETS.find(p => p.id === selectedGenreId) ?? GENRE_PRESETS[0];

  const handleAnalyze = useCallback(() => {
    if (!canvasContent.trim()) return;
    setIsAnalyzing(true);
    setResult(null);
    setLlmSuggestions([]);
    setLlmError(null);

    // Flush loading state, then run synchronous analysis
    setTimeout(() => {
      const analysis = analyzeLyrics(canvasContent, selectedPreset);
      setResult(analysis);
      setIsAnalyzing(false);

      // Auto-trigger LLM suggestions if there are orphan lines
      if (analysis.orphanLines.length > 0) {
        setIsFetchingSuggestions(true);
        getRhymeSuggestions(analysis.orphanLines, analysis.pairedContext)
          .then(resp => {
            setLlmSuggestions(resp.suggestions);
          })
          .catch(err => {
            setLlmError((err as Error).message || 'Failed to get suggestions');
          })
          .finally(() => {
            setIsFetchingSuggestions(false);
          });
      }
    }, 0);
  }, [canvasContent, selectedPreset]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950 text-gray-200">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-gray-700 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedGenreId}
            onChange={e => setActiveGenreId(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
          >
            {GENRE_PRESETS.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !canvasContent.trim()}
            className="flex items-center gap-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded text-xs font-medium transition-colors"
          >
            {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Analyze
          </button>
        </div>
        {selectedPreset && (
          <p className="text-xs text-gray-400 leading-relaxed">{selectedPreset.description}</p>
        )}
        {selectedPreset?.notes && (
          <p className="text-xs text-amber-400/80 leading-relaxed">{selectedPreset.notes}</p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {isAnalyzing && (
          <div className="flex items-center gap-2 text-gray-400 text-xs py-4">
            <Loader2 size={14} className="animate-spin" />
            Analyzing lyrics...
          </div>
        )}

        {result && (
          <>
            {/* Structure */}
            <section>
              <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Structure</h3>
              <div className="space-y-1">
                {result.structureChecks.map((check, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {check.found ? (
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                    ) : check.required ? (
                      <XCircle size={13} className="text-red-400 shrink-0" />
                    ) : (
                      <AlertCircle size={13} className="text-gray-500 shrink-0" />
                    )}
                    <span className={`capitalize ${check.found ? 'text-gray-200' : check.required ? 'text-red-300' : 'text-gray-500'}`}>
                      {check.expectedTag}
                    </span>
                    {!check.found && !check.required && (
                      <span className="text-gray-600">(optional)</span>
                    )}
                  </div>
                ))}
                {result.structureChecks.length === 0 && (
                  <p className="text-xs text-gray-500">No sections detected in lyrics.</p>
                )}
              </div>
            </section>

            {/* Syllables */}
            {result.syllableSummaries.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Syllables</h3>
                <div className="text-xs text-gray-500 mb-1.5">
                  Target range: {selectedPreset.syllableRange.min}-{selectedPreset.syllableRange.max} per line
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-left">
                      <th className="pb-1 font-normal">Section</th>
                      <th className="pb-1 font-normal text-right">Avg</th>
                      <th className="pb-1 font-normal text-right">Lines</th>
                      <th className="pb-1 font-normal text-right">Outliers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.syllableSummaries.map((s, i) => (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="py-1 text-gray-300">{s.sectionName}</td>
                        <td className={`py-1 text-right ${
                          s.avgSyllables < selectedPreset.syllableRange.min || s.avgSyllables > selectedPreset.syllableRange.max
                            ? 'text-amber-400'
                            : 'text-gray-300'
                        }`}>{s.avgSyllables}</td>
                        <td className="py-1 text-right text-gray-400">{s.lineCount}</td>
                        <td className={`py-1 text-right ${s.outlierCount > 0 ? 'text-amber-400' : 'text-gray-400'}`}>
                          {s.outlierCount > 0 ? s.outlierCount : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Rhyme Scheme */}
            {result.rhymeAnalyses.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  Rhyme Scheme
                  <span className="ml-2 font-normal text-gray-500 normal-case">target: {selectedPreset.rhymeScheme}</span>
                </h3>
                <div className="space-y-3">
                  {result.rhymeAnalyses.map((ra, i) => (
                    ra.lines.length > 0 && (
                      <div key={i} className="bg-gray-900 rounded p-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-300 font-medium">{ra.sectionName}</span>
                          <span className="font-mono text-xs text-purple-300 tracking-widest">{ra.scheme || '--'}</span>
                        </div>
                        {ra.orphanLines.length > 0 && (
                          <div className="space-y-0.5">
                            {ra.orphanLines.map((ol, j) => (
                              <div key={j} className="text-xs text-amber-400/80 flex items-start gap-1">
                                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                                <span className="truncate">{ol.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  ))}
                </div>
              </section>
            )}

            {/* AI Suggestions */}
            {(isFetchingSuggestions || llmSuggestions.length > 0 || llmError) && (
              <section>
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">AI Suggestions</h3>

                {isFetchingSuggestions && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin" />
                    Qwen is thinking...
                  </div>
                )}

                {llmError && !isFetchingSuggestions && (
                  <p className="text-xs text-red-400">{llmError}</p>
                )}

                {!isFetchingSuggestions && llmSuggestions.length > 0 && (
                  <div className="space-y-3">
                    {llmSuggestions.map((sug, i) => {
                      const orphan = result.orphanLines.find(o => o.lineIndex === sug.lineIndex);
                      return (
                        <div key={i} className="bg-gray-900 rounded p-2">
                          <p className="text-xs text-gray-400 mb-1.5 truncate">
                            <span className="text-gray-500">{orphan?.section}: </span>
                            {orphan?.line || `line ${sug.lineIndex}`}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {sug.suggestions.map((alt, j) => (
                              <span
                                key={j}
                                className="px-2 py-0.5 rounded-full bg-purple-900/50 border border-purple-700/50 text-xs text-purple-200"
                              >
                                ...{alt}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* No issues */}
            {result.orphanLines.length === 0 && result.structureChecks.every(c => c.found || !c.required) && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
                <CheckCircle2 size={14} />
                Lyrics look good for {selectedPreset.name}!
              </div>
            )}
          </>
        )}

        {!result && !isAnalyzing && (
          <p className="text-xs text-gray-500 py-4">Select a genre preset and click Analyze to check your lyrics.</p>
        )}
      </div>
    </div>
  );
}
