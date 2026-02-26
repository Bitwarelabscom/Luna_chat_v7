'use client';

import { useEffect, useRef, useState } from 'react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import type { ProductionSummary, ProductionDetail, AlbumDetail, SongDetail, CreateProductionParams } from '@/lib/api/ceo';
import {
  createProduction,
  fetchProductionDetail,
  approveProduction,
  cancelProduction,
} from '@/lib/api/ceo';
import { settingsApi } from '@/lib/api/settings';
import type { LLMProvider } from '@/lib/api/settings';

// ============================================================
// Status badges
// ============================================================

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-yellow-600',
  planned: 'bg-blue-600',
  in_progress: 'bg-emerald-600',
  completed: 'bg-green-600',
  failed: 'bg-red-600',
  lyrics_wip: 'bg-yellow-500',
  lyrics_review: 'bg-orange-500',
  lyrics_approved: 'bg-teal-500',
  suno_pending: 'bg-purple-500',
  suno_processing: 'bg-indigo-500',
  skipped: 'bg-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  const bg = STATUS_COLORS[status] ?? 'bg-gray-600';
  return (
    <span className={`${bg} text-white text-xs px-2 py-0.5 rounded-full`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ============================================================
// Create Form
// ============================================================

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { genres, artists, loadGenres, loadArtists } = useCEOLunaStore();
  const initialized = useRef(false);

  const [artistName, setArtistName] = useState('');
  const [genre, setGenre] = useState('');
  const [notes, setNotes] = useState('');
  const [albumCount, setAlbumCount] = useState(1);
  const [forbiddenWords, setForbiddenWords] = useState('neon, static');
  const [songsPerAlbum, setSongsPerAlbum] = useState<number | ''>('');
  const [provider, setProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadGenres();
      loadArtists();
      settingsApi.getStaticModels().then(data => {
        setProviders(data.providers.filter(p => p.enabled));
      }).catch(() => { /* ignore */ });
    }
  }, [loadGenres, loadArtists]);

  // Reset tracks when genre changes (pick up new genre default)
  const prevGenre = useRef(genre);
  useEffect(() => {
    if (genre !== prevGenre.current) {
      prevGenre.current = genre;
      setSongsPerAlbum('');
    }
  }, [genre]);

  // Get selected genre's default song count for placeholder
  const selectedGenre = genres.find(g => g.id === genre);
  const genreDefaultSongs = selectedGenre?.defaultSongCount ?? 10;

  // Filter models for selected provider
  const providerModels = provider
    ? (providers.find(p => p.id === provider)?.models ?? [])
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistName.trim() || !genre) return;
    setCreating(true);
    setError('');
    try {
      const params: CreateProductionParams = {
        artistName: artistName.trim(),
        genre,
        albumCount,
      };
      if (notes.trim()) params.productionNotes = notes.trim();
      if (forbiddenWords.trim()) params.forbiddenWords = forbiddenWords.trim();
      if (songsPerAlbum !== '' && songsPerAlbum > 0) params.songsPerAlbum = songsPerAlbum;
      if (provider && modelId) {
        const modelStr = `${provider}/${modelId}`;
        params.planningModel = modelStr;
        params.lyricsModel = modelStr;
      }
      await createProduction(params);
      setArtistName('');
      setGenre('');
      setNotes('');
      setAlbumCount(1);
      setSongsPerAlbum('');
      onCreated();
    } catch (err) {
      setError((err as Error).message || 'Failed to create production');
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-gray-900 rounded-lg border border-gray-700">
      {/* Title row with model selectors */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-200">New Album Production</h3>
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={provider}
            onChange={e => { setProvider(e.target.value); setModelId(''); }}
            className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-300 focus:outline-none focus:border-slate-500"
          >
            <option value="">Provider (default)</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={modelId}
            onChange={e => setModelId(e.target.value)}
            disabled={!provider}
            className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-300 disabled:opacity-50 focus:outline-none focus:border-slate-500"
          >
            <option value="">Model (default)</option>
            {providerModels.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Artist name with autocomplete */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Artist Name</label>
          <input
            list="artist-options"
            value={artistName}
            onChange={e => setArtistName(e.target.value)}
            placeholder="Artist name..."
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-slate-500"
            required
          />
          <datalist id="artist-options">
            {artists.map(a => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>

        {/* Genre dropdown */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Genre</label>
          <select
            value={genre}
            onChange={e => setGenre(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-slate-500"
            required
          >
            <option value="">Select genre...</option>
            {genres.filter(g => g.source !== 'custom').map(g => (
              <option key={g.id} value={g.id}>{g.name} ({g.defaultSongCount} songs)</option>
            ))}
            {genres.some(g => g.source === 'custom') && (
              <>
                <option disabled>---- Custom DJ Presets ----</option>
                {genres.filter(g => g.source === 'custom').map(g => (
                  <option key={g.id} value={g.id}>[Custom] {g.name} ({g.defaultSongCount} songs)</option>
                ))}
              </>
            )}
          </select>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Production Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Theme, mood, direction..."
          className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-slate-500 resize-none"
          rows={2}
        />
      </div>

      {/* Forbidden words */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Forbidden Words (comma-separated)</label>
        <input
          type="text"
          value={forbiddenWords}
          onChange={e => setForbiddenWords(e.target.value)}
          placeholder="neon, static, ..."
          className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-slate-500"
        />
      </div>

      <div className="flex items-center gap-3">
        {/* Album count */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Albums:</label>
          <input
            type="number"
            min={1}
            max={10}
            value={albumCount}
            onChange={e => setAlbumCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
            className="w-16 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-slate-500"
          />
        </div>

        {/* Tracks per album */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Tracks:</label>
          <input
            type="number"
            min={1}
            max={20}
            value={songsPerAlbum}
            onChange={e => {
              const val = e.target.value;
              if (val === '') { setSongsPerAlbum(''); return; }
              const num = parseInt(val);
              if (num >= 1 && num <= 20) setSongsPerAlbum(num);
            }}
            placeholder={String(genreDefaultSongs)}
            className="w-16 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-slate-500"
          />
        </div>

        <button
          type="submit"
          disabled={creating || !artistName.trim() || !genre}
          className="ml-auto px-4 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          {creating ? 'Creating...' : 'Start Production'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}

// ============================================================
// Production Card
// ============================================================

function ProductionCard({ prod, onRefresh }: { prod: ProductionSummary; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const progressPct = prod.totalSongs > 0
    ? Math.round((prod.completedSongs / prod.totalSongs) * 100)
    : 0;

  // Auto-refresh expanded detail every 30s when production is active
  const isActive = ['planning', 'planned', 'in_progress'].includes(prod.status);
  useEffect(() => {
    if (!expanded || !isActive) return;
    const interval = setInterval(async () => {
      try {
        const { production } = await fetchProductionDetail(prod.id);
        setDetail(production);
      } catch {
        // ignore
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [expanded, isActive, prod.id]);

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    setLoadingDetail(true);
    try {
      const { production } = await fetchProductionDetail(prod.id);
      setDetail(production);
    } catch (err) {
      console.error('Failed to load production detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await approveProduction(prod.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to approve:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    setActionLoading(true);
    try {
      await cancelProduction(prod.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to cancel:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={handleExpand}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge status={prod.status} />
          <span className="text-sm font-medium text-gray-200 truncate">{prod.artistName}</span>
          <span className="text-xs text-gray-500">{prod.genre} - {prod.albumCount} album(s)</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {prod.totalSongs > 0 && (
            <span className="text-xs text-gray-400">{prod.completedSongs}/{prod.totalSongs} songs</span>
          )}
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Progress bar */}
      {prod.totalSongs > 0 && (
        <div className="px-4 pb-2">
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700/50">
          {/* Action buttons */}
          <div className="flex gap-2 mt-3 mb-3">
            {prod.status === 'planned' && (
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600 text-white rounded transition-colors"
              >
                {actionLoading ? '...' : 'Approve & Start'}
              </button>
            )}
            {['planning', 'planned', 'in_progress'].includes(prod.status) && (
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-500 disabled:bg-gray-600 text-white rounded transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={async () => {
                setLoadingDetail(true);
                try {
                  const { production } = await fetchProductionDetail(prod.id);
                  setDetail(production);
                } catch {
                  // ignore
                } finally {
                  setLoadingDetail(false);
                }
              }}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingDetail ? (
            <p className="text-xs text-gray-500">Loading details...</p>
          ) : detail ? (
            <div className="space-y-3">
              {detail.albums.map(album => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          ) : null}

          {prod.errorMessage && (
            <p className="text-xs text-red-400 mt-2">{prod.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Album Card
// ============================================================

function AlbumCard({ album }: { album: AlbumDetail }) {
  const [showSongs, setShowSongs] = useState(false);
  const completedSongs = album.songs.filter(s => s.status === 'completed').length;

  return (
    <div className="bg-gray-800/50 rounded border border-gray-700/50">
      <button
        onClick={() => setShowSongs(!showSongs)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/80 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-gray-300">#{album.albumNumber}</span>
          <span className="text-sm text-gray-200 truncate">{album.albumTitle ?? 'Untitled Album'}</span>
          <StatusBadge status={album.status} />
        </div>
        <span className="text-xs text-gray-500 shrink-0">{completedSongs}/{album.songs.length} done</span>
      </button>

      {album.albumTheme && (
        <p className="px-3 pb-1 text-xs text-gray-500 italic">{album.albumTheme}</p>
      )}

      {showSongs && (
        <div className="px-3 pb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700/50">
                <th className="py-1 text-left w-8">#</th>
                <th className="py-1 text-left">Title</th>
                <th className="py-1 text-left w-24">Status</th>
                <th className="py-1 text-right w-12">Rev</th>
              </tr>
            </thead>
            <tbody>
              {album.songs.map(song => (
                <SongRow key={song.id} song={song} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Song Row
// ============================================================

function SongRow({ song }: { song: SongDetail }) {
  return (
    <tr className="border-b border-gray-700/30 hover:bg-gray-800/40">
      <td className="py-1 text-gray-500">{song.trackNumber}</td>
      <td className="py-1 text-gray-300 truncate max-w-[200px]">{song.title}</td>
      <td className="py-1"><StatusBadge status={song.status} /></td>
      <td className="py-1 text-right text-gray-500">{song.revisionCount > 0 ? song.revisionCount : '-'}</td>
    </tr>
  );
}

// ============================================================
// Main Component
// ============================================================

export function AlbumCreatorTab() {
  const { productions, isLoadingProductions, loadProductions } = useCEOLunaStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadProductions();
    }
  }, [loadProductions]);

  // Auto-refresh every 30s when any production is active
  const hasActive = productions.some(p => ['planning', 'planned', 'in_progress'].includes(p.status));
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(loadProductions, 30_000);
    return () => clearInterval(interval);
  }, [hasActive, loadProductions]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Create form */}
        <CreateForm onCreated={loadProductions} />

        {/* Productions list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-300">Productions</h3>
            <button
              onClick={loadProductions}
              disabled={isLoadingProductions}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {isLoadingProductions ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {productions.length === 0 && !isLoadingProductions && (
            <p className="text-sm text-gray-600 text-center py-6">No productions yet. Create one above.</p>
          )}

          <div className="space-y-2">
            {productions.map(prod => (
              <ProductionCard key={prod.id} prod={prod} onRefresh={loadProductions} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
