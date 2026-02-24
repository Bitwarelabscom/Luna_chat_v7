'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, PauseCircle, PlayCircle, PlusCircle, RefreshCw } from 'lucide-react';
import {
  addBuildNote,
  continueBuild,
  doneBuild,
  fetchBuildHistory,
  pauseBuild,
  startBuild,
  type BuildHistoryItem,
  type BuildNote,
} from '@/lib/api/ceo';

type StatusFilter = 'all' | 'active' | 'paused' | 'done';

const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'paused', 'done'];

const STATUS_STYLES: Record<BuildHistoryItem['status'], string> = {
  active: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700',
  paused: 'bg-amber-900/40 text-amber-300 border border-amber-700',
  done: 'bg-slate-700/60 text-slate-200 border border-slate-500',
};

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function noteSourceStyle(note: BuildNote): string {
  if (note.source === 'checkin') {
    return 'bg-blue-900/40 text-blue-300 border border-blue-800';
  }
  return 'bg-zinc-800 text-zinc-300 border border-zinc-700';
}

export function BuildsPanel() {
  const [builds, setBuilds] = useState<BuildHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState('');
  const [taskName, setTaskName] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [activeActionByBuild, setActiveActionByBuild] = useState<Record<string, 'pause' | 'continue' | 'done' | 'note'>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [, setClock] = useState(() => Date.now());

  const loadBuilds = useCallback(async (showSpinner = true) => {
    if (showSpinner) setIsLoading(true);
    setError('');
    try {
      const result = await fetchBuildHistory();
      setBuilds(result.builds);
    } catch (err) {
      setError((err as Error).message || 'Failed to load build history');
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBuilds();
  }, [loadBuilds]);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const filteredBuilds = useMemo(() => {
    if (statusFilter === 'all') return builds;
    return builds.filter((build) => build.status === statusFilter);
  }, [builds, statusFilter]);

  const counts = useMemo(() => ({
    all: builds.length,
    active: builds.filter((build) => build.status === 'active').length,
    paused: builds.filter((build) => build.status === 'paused').length,
    done: builds.filter((build) => build.status === 'done').length,
  }), [builds]);

  const getLiveElapsed = useCallback((build: BuildHistoryItem): number => {
    if (build.status !== 'active') return build.elapsedSeconds;
    const activeSeconds = Math.floor((Date.now() - new Date(build.sessionStartedAt).getTime()) / 1000);
    return Math.max(build.elapsedSeconds, build.elapsedSeconds + activeSeconds);
  }, []);

  const runBuildAction = useCallback(async (
    buildId: string,
    action: 'pause' | 'continue' | 'done' | 'note',
    work: () => Promise<void>,
  ) => {
    setActiveActionByBuild((prev) => ({ ...prev, [buildId]: action }));
    setError('');
    try {
      await work();
      await loadBuilds(false);
    } catch (err) {
      setError((err as Error).message || 'Build update failed');
    } finally {
      setActiveActionByBuild((prev) => {
        const next = { ...prev };
        delete next[buildId];
        return next;
      });
    }
  }, [loadBuilds]);

  const handleStartBuild = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = taskName.trim();
    if (!trimmed || isStarting) return;
    setIsStarting(true);
    setError('');
    try {
      await startBuild(trimmed);
      setTaskName('');
      await loadBuilds(false);
    } catch (err) {
      setError((err as Error).message || 'Failed to start build');
    } finally {
      setIsStarting(false);
    }
  };

  const handleAddNote = async (build: BuildHistoryItem) => {
    const note = (noteDrafts[build.id] || '').trim();
    if (!note) return;
    await runBuildAction(build.id, 'note', async () => {
      await addBuildNote(build.buildNum, note);
      setNoteDrafts((prev) => ({ ...prev, [build.id]: '' }));
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="px-4 py-3 border-b border-gray-700 space-y-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-300">Builds</div>
            <div className="text-xs text-gray-600">Tracks build status and Luna check-in notes from your Telegram replies.</div>
          </div>
          <button
            onClick={() => loadBuilds()}
            disabled={isLoading}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh builds"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        <form onSubmit={handleStartBuild} className="flex items-center gap-2">
          <input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Start a build task (e.g. ceo-luna builds tab)"
            className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600"
          />
          <button
            type="submit"
            disabled={isStarting || taskName.trim().length === 0}
            className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isStarting ? <Loader2 size={12} className="animate-spin" /> : <PlusCircle size={12} />}
            Start
          </button>
        </form>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-gray-800 overflow-x-auto shrink-0">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={`shrink-0 px-2 py-0.5 text-xs rounded transition-colors capitalize ${
              statusFilter === filter
                ? 'bg-slate-700 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {filter} ({counts[filter]})
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-4 mt-3 text-xs text-red-300 bg-red-900/20 border border-red-800 rounded px-3 py-2 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoading && builds.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-gray-500 animate-spin" />
          </div>
        )}

        {!isLoading && filteredBuilds.length === 0 && (
          <div className="text-center py-12 text-sm text-gray-600">
            No builds in &quot;{statusFilter}&quot;
          </div>
        )}

        {filteredBuilds.map((build) => {
          const actionState = activeActionByBuild[build.id];
          const isBusy = Boolean(actionState);
          const notes = build.notes || [];

          return (
            <div key={build.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-gray-200 font-medium truncate">
                    Build #{build.buildNum} - {build.taskName}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Started: {formatDate(build.startedAt)} {build.completedAt ? `| Completed: ${formatDate(build.completedAt)}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_STYLES[build.status]}`}>
                    {build.status}
                  </span>
                  <div className="text-xs text-blue-300 mt-1">{formatElapsed(getLiveElapsed(build))} elapsed</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {build.status === 'active' && (
                  <>
                    <button
                      onClick={() => runBuildAction(build.id, 'pause', async () => { await pauseBuild(build.buildNum); })}
                      disabled={isBusy}
                      className="px-2 py-1 text-xs rounded bg-amber-900/30 text-amber-300 border border-amber-700 hover:bg-amber-900/50 disabled:opacity-50 flex items-center gap-1"
                    >
                      {actionState === 'pause' ? <Loader2 size={11} className="animate-spin" /> : <PauseCircle size={11} />}
                      Pause
                    </button>
                    <button
                      onClick={() => runBuildAction(build.id, 'done', async () => { await doneBuild(build.buildNum); })}
                      disabled={isBusy}
                      className="px-2 py-1 text-xs rounded bg-emerald-900/30 text-emerald-300 border border-emerald-700 hover:bg-emerald-900/50 disabled:opacity-50 flex items-center gap-1"
                    >
                      {actionState === 'done' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      Done
                    </button>
                  </>
                )}

                {build.status === 'paused' && (
                  <>
                    <button
                      onClick={() => runBuildAction(build.id, 'continue', async () => { await continueBuild(build.buildNum); })}
                      disabled={isBusy}
                      className="px-2 py-1 text-xs rounded bg-blue-900/30 text-blue-300 border border-blue-700 hover:bg-blue-900/50 disabled:opacity-50 flex items-center gap-1"
                    >
                      {actionState === 'continue' ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />}
                      Continue
                    </button>
                    <button
                      onClick={() => runBuildAction(build.id, 'done', async () => { await doneBuild(build.buildNum); })}
                      disabled={isBusy}
                      className="px-2 py-1 text-xs rounded bg-emerald-900/30 text-emerald-300 border border-emerald-700 hover:bg-emerald-900/50 disabled:opacity-50 flex items-center gap-1"
                    >
                      {actionState === 'done' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      Done
                    </button>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={noteDrafts[build.id] || ''}
                    onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [build.id]: e.target.value }))}
                    placeholder="Add update note"
                    className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2.5 py-1.5 border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600"
                  />
                  <button
                    onClick={() => handleAddNote(build)}
                    disabled={isBusy || !(noteDrafts[build.id] || '').trim()}
                    className="px-2.5 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionState === 'note' ? 'Saving...' : 'Note'}
                  </button>
                </div>

                <div className="space-y-1.5">
                  {notes.length === 0 && (
                    <div className="text-xs text-gray-600">No notes yet.</div>
                  )}

                  {notes.slice(0, 8).map((note) => (
                    <div key={note.id} className="text-xs bg-gray-800/70 border border-gray-700 rounded px-2.5 py-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${noteSourceStyle(note)}`}>
                          {note.source}
                        </span>
                        <span className="text-gray-600">{formatDate(note.createdAt)}</span>
                      </div>
                      <div className="text-gray-300 leading-relaxed">{note.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

