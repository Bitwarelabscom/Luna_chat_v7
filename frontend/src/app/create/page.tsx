'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { createApi } from '@/lib/api/create';
import { Music, Send, Loader2, CheckCircle, XCircle, Clock, Download, Play, Pause } from 'lucide-react';

interface SongDetail {
  trackNumber: number;
  title: string;
  status: string;
  streamUrl: string | null;
  durationSeconds: number | null;
}

interface RequestDetail {
  id: string;
  ideaText: string;
  status: string;
  productionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  songs: SongDetail[];
}

interface RequestSummary {
  id: string;
  ideaText: string;
  status: string;
  productionId: string | null;
  createdAt: string;
  completedAt: string | null;
  songCount?: number;
  completedSongs?: number;
}

const SUGGESTIONS = [
  '5 reggae songs about summer vibes and good times',
  '3 lo-fi chill beats for studying late at night',
  '4 synth-pop songs about city lights and neon dreams',
  '5 acoustic folk songs about traveling the world',
  '3 boom-bap hip-hop tracks about hustle and ambition',
];

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'pending':
    case 'processing':
    case 'lyrics_approved':
    case 'suno_pending':
    case 'suno_processing':
      return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
    default:
      return <Clock className="w-4 h-4 text-theme-text-muted" />;
  }
}

function SongStatusLabel({ status }: { status: string }) {
  const labels: Record<string, string> = {
    lyrics_approved: 'Lyrics ready',
    suno_pending: 'Queued for Suno',
    suno_processing: 'Generating music...',
    completed: 'Ready',
    failed: 'Failed',
  };
  return <span className="text-xs text-theme-text-muted">{labels[status] || status}</span>;
}

function AudioPlayer({ src, title }: { src: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button onClick={toggle} className="p-1.5 rounded-full bg-theme-accent-primary hover:bg-theme-accent-hover transition" title={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause className="w-3.5 h-3.5 text-theme-text-primary" /> : <Play className="w-3.5 h-3.5 text-theme-text-primary" />}
      </button>
      <a
        href={src}
        download={`${title}.mp3`}
        className="p-1.5 rounded-full bg-theme-bg-tertiary hover:bg-theme-border transition"
        title="Download"
      >
        <Download className="w-3.5 h-3.5 text-theme-text-secondary" />
      </a>
    </div>
  );
}

export default function CreatePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const [idea, setIdea] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [activeRequest, setActiveRequest] = useState<RequestDetail | null>(null);
  const [history, setHistory] = useState<RequestSummary[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/create');
    }
  }, [authLoading, isAuthenticated, router]);

  const loadHistory = useCallback(async () => {
    try {
      const { requests } = await createApi.listRequests();
      setHistory(requests);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadHistory();
    }
  }, [isAuthenticated, loadHistory]);

  const startPolling = useCallback((requestId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const detail = await createApi.getRequest(requestId);
        setActiveRequest(detail);

        const allDone = detail.status === 'completed' && detail.songs.length > 0 &&
          detail.songs.every(s => s.status === 'completed' || s.status === 'failed');
        const requestFailed = detail.status === 'failed';

        if (allDone || requestFailed) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadHistory();
        }
      } catch {
        // ignore polling errors
      }
    }, 10000);
  }, [loadHistory]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim() || submitting) return;

    setError('');
    setSubmitting(true);

    try {
      const { requestId } = await createApi.submitIdea(idea.trim());
      setIdea('');
      const detail = await createApi.getRequest(requestId);
      setActiveRequest(detail);
      startPolling(requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const viewRequest = async (id: string) => {
    try {
      const detail = await createApi.getRequest(id);
      setActiveRequest(detail);
      if (detail.status !== 'completed' && detail.status !== 'failed') {
        startPolling(id);
      } else if (detail.songs.some(s => s.status !== 'completed' && s.status !== 'failed')) {
        startPolling(id);
      }
    } catch {
      // ignore
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme-bg-primary">
        <Loader2 className="w-8 h-8 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const completedSongs = activeRequest?.songs.filter(s => s.status === 'completed') || [];
  const totalSongs = activeRequest?.songs.length || 0;
  const progress = totalSongs > 0 ? Math.round((completedSongs.length / totalSongs) * 100) : 0;

  return (
    <div className="min-h-screen bg-theme-bg-primary">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-theme-accent-primary mb-4">
            <Music className="w-8 h-8 text-theme-text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Create Music</h1>
          <p className="text-theme-text-muted mt-2">Describe your idea and we&apos;ll create a full album</p>
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="mb-8">
          {error && (
            <div className="p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="relative">
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe your music idea... e.g. '5 reggae songs about summer vibes'"
              maxLength={1000}
              rows={3}
              className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-lg focus:ring-2 focus:ring-theme-accent-primary focus:border-transparent outline-none transition text-theme-text-primary placeholder-theme-text-muted resize-none"
            />
            <span className="absolute bottom-2 right-3 text-xs text-theme-text-muted">{idea.length}/1000</span>
          </div>

          {/* Suggestion chips */}
          {!idea && (
            <div className="flex flex-wrap gap-2 mt-3">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIdea(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-border transition"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || idea.trim().length < 10}
            className="w-full mt-4 py-3 bg-theme-accent-primary hover:bg-theme-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition flex items-center justify-center gap-2 text-theme-text-primary"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Create Album
              </>
            )}
          </button>
        </form>

        {/* Active request status */}
        {activeRequest && (
          <div className="mb-8 p-4 bg-theme-bg-secondary border border-theme-border rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <StatusIcon status={activeRequest.status} />
              <span className="text-sm font-medium text-theme-text-primary capitalize">{activeRequest.status}</span>
              {activeRequest.status === 'processing' && (
                <span className="text-xs text-theme-text-muted ml-auto">Claude is writing your album...</span>
              )}
            </div>

            <p className="text-sm text-theme-text-secondary mb-3 italic">&quot;{activeRequest.ideaText}&quot;</p>

            {activeRequest.errorMessage && (
              <div className="p-2 mb-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                {activeRequest.errorMessage}
              </div>
            )}

            {/* Progress bar */}
            {totalSongs > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-theme-text-muted mb-1">
                  <span>{completedSongs.length} / {totalSongs} songs ready</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-theme-accent-primary rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Song list */}
            {activeRequest.songs.length > 0 && (
              <div className="space-y-2">
                {activeRequest.songs.map(song => (
                  <div key={song.trackNumber} className="flex items-center gap-3 p-2 bg-theme-bg-tertiary rounded">
                    <span className="text-xs text-theme-text-muted w-6 text-right">{song.trackNumber}.</span>
                    <span className="text-sm text-theme-text-primary flex-1">{song.title}</span>
                    <StatusIcon status={song.status} />
                    <SongStatusLabel status={song.status} />
                    {song.status === 'completed' && song.streamUrl && (
                      <AudioPlayer src={song.streamUrl} title={song.title} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-theme-text-primary mb-3">Previous Requests</h2>
            <div className="space-y-2">
              {history.map(req => (
                <button
                  key={req.id}
                  onClick={() => viewRequest(req.id)}
                  className="w-full text-left p-3 bg-theme-bg-secondary border border-theme-border rounded-lg hover:border-theme-accent-primary transition"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon status={req.status} />
                    <span className="text-sm text-theme-text-primary flex-1 truncate">{req.ideaText}</span>
                    {req.songCount !== undefined && req.songCount > 0 && (
                      <span className="text-xs text-theme-text-muted">
                        {req.completedSongs}/{req.songCount} songs
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-theme-text-muted mt-1">
                    {new Date(req.createdAt).toLocaleDateString()} {new Date(req.createdAt).toLocaleTimeString()}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
