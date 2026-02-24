'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Music2, RefreshCw, Zap } from 'lucide-react';
import { useDJLunaStore } from '@/lib/dj-luna-store';
import type { SunoGeneration } from '@/lib/api/suno';

type StatusFilter = 'all' | 'pending' | 'processing' | 'completed' | 'failed';

const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'processing', 'completed', 'failed'];

const STATUS_BADGE: Record<SunoGeneration['status'], string> = {
  pending: 'bg-zinc-700/60 text-zinc-300 border border-zinc-600',
  processing: 'bg-blue-900/40 text-blue-300 border border-blue-700',
  completed: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700',
  failed: 'bg-red-900/40 text-red-300 border border-red-700',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatElapsed(from: string): string {
  const seconds = Math.floor((Date.now() - new Date(from).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${seconds % 60}s`;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export function GenerationsPanel() {
  const {
    generations, isLoadingGenerations, triggerBatch, pollGenerations,
    canvasContent, currentSong, activeStyle, triggerSongGeneration,
  } = useDJLunaStore();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // From Canvas state
  const [canvasTitleInput, setCanvasTitleInput] = useState(currentSong?.title || 'Untitled');
  const [canvasStyleInput, setCanvasStyleInput] = useState(activeStyle);
  const [isCanvasTriggering, setIsCanvasTriggering] = useState(false);
  const [canvasError, setCanvasError] = useState('');

  // Ambient Batch state
  const [showAmbient, setShowAmbient] = useState(false);
  const [count, setCount] = useState(3);
  const [styleInput, setStyleInput] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState('');

  const [, setClock] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync title when currentSong changes
  useEffect(() => {
    setCanvasTitleInput(currentSong?.title || 'Untitled');
  }, [currentSong?.title]);

  // Sync style when activeStyle changes
  useEffect(() => {
    setCanvasStyleInput(activeStyle);
  }, [activeStyle]);

  // Initial load
  useEffect(() => {
    void pollGenerations();
  }, [pollGenerations]);

  // Refresh clock every second for elapsed display
  useEffect(() => {
    const clockId = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(clockId);
  }, []);

  // Auto-refresh when any generations are in-flight
  const hasActive = generations.some(g => g.status === 'pending' || g.status === 'processing');

  useEffect(() => {
    if (hasActive) {
      pollRef.current = setInterval(() => {
        void pollGenerations();
      }, 15_000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasActive, pollGenerations]);

  const canvasIsEmpty = !canvasContent.trim();

  const handleGenerateFromCanvas = useCallback(async () => {
    if (canvasIsEmpty) return;
    setCanvasError('');
    setIsCanvasTriggering(true);
    try {
      await triggerSongGeneration(
        canvasTitleInput.trim() || 'Untitled',
        canvasContent,
        canvasStyleInput.trim() || activeStyle,
      );
      setTimeout(() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    } catch (err) {
      setCanvasError((err as Error).message || 'Failed to trigger');
    } finally {
      setIsCanvasTriggering(false);
    }
  }, [canvasIsEmpty, canvasTitleInput, canvasContent, canvasStyleInput, activeStyle, triggerSongGeneration]);

  const handleAmbientGenerate = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setTriggerError('');
    setIsTriggering(true);
    try {
      await triggerBatch(count, styleInput.trim() || undefined);
      setStyleInput('');
    } catch (err) {
      setTriggerError((err as Error).message || 'Failed to trigger');
    } finally {
      setIsTriggering(false);
    }
  }, [count, styleInput, triggerBatch]);

  const handleQuickGenerate = useCallback(async () => {
    setTriggerError('');
    setIsTriggering(true);
    try {
      await triggerBatch(3);
    } catch (err) {
      setTriggerError((err as Error).message || 'Failed');
    } finally {
      setIsTriggering(false);
    }
  }, [triggerBatch]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return generations;
    return generations.filter(g => g.status === statusFilter);
  }, [generations, statusFilter]);

  const counts = useMemo(() => ({
    all: generations.length,
    pending: generations.filter(g => g.status === 'pending').length,
    processing: generations.filter(g => g.status === 'processing').length,
    completed: generations.filter(g => g.status === 'completed').length,
    failed: generations.filter(g => g.status === 'failed').length,
  }), [generations]);

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-1.5">
          <Music2 className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-semibold text-gray-200">Suno Factory</span>
        </div>
        <button
          onClick={() => void pollGenerations()}
          disabled={isLoadingGenerations}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGenerations ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* From Canvas section */}
      <div className="px-3 py-2.5 border-b border-gray-800 bg-gray-900/40 shrink-0 space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">From Canvas</p>
        <div className="space-y-1.5">
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-8 shrink-0">Title</label>
            <input
              type="text"
              value={canvasTitleInput}
              onChange={e => setCanvasTitleInput(e.target.value)}
              placeholder="Song title..."
              className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-600"
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-8 shrink-0">Style</label>
            <input
              type="text"
              value={canvasStyleInput}
              onChange={e => setCanvasStyleInput(e.target.value)}
              placeholder="pop, 120bpm, female vocal..."
              className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-600"
            />
          </div>
        </div>
        {canvasError && <p className="text-xs text-red-400">{canvasError}</p>}
        <button
          onClick={() => void handleGenerateFromCanvas()}
          disabled={canvasIsEmpty || isCanvasTriggering}
          title={canvasIsEmpty ? 'Canvas is empty' : undefined}
          className="w-full py-1.5 text-xs bg-purple-800/60 hover:bg-purple-700/60 border border-purple-700 rounded text-purple-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          {isCanvasTriggering ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Triggering...</>
          ) : canvasIsEmpty ? (
            'Canvas is empty'
          ) : (
            <><Zap className="w-3 h-3" /> Generate 1 track</>
          )}
        </button>
      </div>

      {/* Ambient Batch (collapsible) */}
      <div className="border-b border-gray-800 shrink-0">
        <button
          onClick={() => setShowAmbient(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-900/40 transition-colors"
        >
          <span className="font-medium">Ambient Batch</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAmbient ? 'rotate-180' : ''}`} />
        </button>
        {showAmbient && (
          <form onSubmit={handleAmbientGenerate} className="px-3 pb-2.5 bg-gray-900/30 space-y-2">
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 shrink-0">Tracks</label>
              <input
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={e => setCount(Number(e.target.value))}
                className="w-14 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-purple-600"
              />
            </div>
            <input
              type="text"
              value={styleInput}
              onChange={e => setStyleInput(e.target.value)}
              placeholder="Style override (optional)..."
              className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-600"
            />
            {triggerError && <p className="text-xs text-red-400">{triggerError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleQuickGenerate}
                disabled={isTriggering}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 transition-colors disabled:opacity-50"
              >
                {isTriggering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Gen 3
              </button>
              <button
                type="submit"
                disabled={isTriggering}
                className="flex-1 py-1 text-xs bg-purple-800/60 hover:bg-purple-700/60 border border-purple-700 rounded text-purple-200 transition-colors disabled:opacity-50"
              >
                {isTriggering ? 'Triggering...' : 'Generate'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Status filters */}
      <div className="flex border-b border-gray-800 shrink-0 overflow-x-auto">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors capitalize ${
              statusFilter === f
                ? 'text-white border-b-2 border-purple-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {f} {counts[f] > 0 && <span className="ml-0.5 text-gray-600">({counts[f]})</span>}
          </button>
        ))}
      </div>

      {/* Generations list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 text-xs gap-2">
            <Music2 className="w-6 h-6 opacity-30" />
            <span>{statusFilter === 'all' ? 'No generations yet' : `No ${statusFilter} tracks`}</span>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filtered.map(gen => (
              <GenerationCard key={gen.id} gen={gen} formatElapsed={formatElapsed} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CardProps {
  gen: SunoGeneration;
  formatElapsed: (from: string) => string;
}

function GenerationCard({ gen, formatElapsed }: CardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-md p-2.5 space-y-1.5">
      {/* Title + badge */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-gray-200 truncate flex-1">{gen.title}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 capitalize ${STATUS_BADGE[gen.status]}`}>
          {gen.status}
        </span>
      </div>

      {/* Style */}
      {gen.style && (
        <p className="text-xs text-gray-500 truncate">{gen.style}</p>
      )}

      {/* BPM + Key chips */}
      {(gen.bpm || gen.key) && (
        <div className="flex gap-1.5">
          {gen.bpm && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">
              {gen.bpm} BPM
            </span>
          )}
          {gen.key && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">
              {gen.key}
            </span>
          )}
        </div>
      )}

      {/* Status-specific content */}
      {gen.status === 'pending' && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          In queue...
        </div>
      )}

      {gen.status === 'processing' && (
        <div className="flex items-center gap-1.5 text-xs text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          Generating... ({formatElapsed(gen.createdAt)})
        </div>
      )}

      {gen.status === 'completed' && (
        <div className="space-y-1">
          {gen.durationSeconds && (
            <span className="text-xs px-1.5 py-0.5 bg-emerald-900/30 border border-emerald-800 rounded text-emerald-400">
              {Math.floor(gen.durationSeconds / 60)}:{String(gen.durationSeconds % 60).padStart(2, '0')}
            </span>
          )}
          {gen.filePath && (
            <p className="text-xs text-gray-500 truncate" title={gen.filePath}>
              {basename(gen.filePath)}
            </p>
          )}
        </div>
      )}

      {gen.status === 'failed' && gen.errorMessage && (
        <p className="text-xs text-red-400 truncate" title={gen.errorMessage}>
          {gen.errorMessage}
        </p>
      )}

      {/* Timestamp */}
      <p className="text-xs text-gray-700">{formatDate(gen.createdAt)}</p>
    </div>
  );
}
