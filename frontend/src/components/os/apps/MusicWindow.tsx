'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Music, Play, Pause, SkipBack, SkipForward, Volume2,
  RefreshCw, ExternalLink, Disc, Smartphone, Link2
} from 'lucide-react';
import { spotifyApi, type SpotifyStatus, type SpotifyPlaybackState } from '@/lib/api';

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export default function MusicWindow() {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [controlLoading, setControlLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await spotifyApi.getStatus();
      setStatus(data);
    } catch (error) {
      console.error('Failed to load Spotify status:', error);
      setStatus({ isLinked: false, spotifyId: null, displayName: null });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlaybackState = useCallback(async () => {
    try {
      const response = await spotifyApi.getPlaybackStatus();
      setPlaybackState(response.state);
    } catch (error) {
      // Silently ignore
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Poll for playback state when connected
  useEffect(() => {
    if (status?.isLinked) {
      fetchPlaybackState();
      const interval = setInterval(fetchPlaybackState, 3000);
      return () => clearInterval(interval);
    }
  }, [status?.isLinked, fetchPlaybackState]);

  const handleConnect = async () => {
    try {
      setConnecting(true);
      const { url } = await spotifyApi.getAuthUrl();
      const width = 500;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        url,
        'spotify-auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setConnecting(false);
          loadStatus();
        }
      }, 500);
    } catch (error) {
      console.error('Failed to start Spotify auth:', error);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Spotify?')) return;
    try {
      await spotifyApi.disconnect();
      setPlaybackState(null);
      await loadStatus();
    } catch (error) {
      console.error('Failed to disconnect Spotify:', error);
    }
  };

  const handlePlayPause = async () => {
    if (controlLoading) return;
    setControlLoading(true);
    try {
      if (playbackState?.isPlaying) {
        await spotifyApi.pause();
      } else {
        await spotifyApi.play();
      }
      await fetchPlaybackState();
    } catch (error) {
      console.error('Failed to toggle playback:', error);
    } finally {
      setControlLoading(false);
    }
  };

  const handleSkipPrevious = async () => {
    if (controlLoading) return;
    setControlLoading(true);
    try {
      await spotifyApi.skipPrevious();
      await fetchPlaybackState();
    } catch (error) {
      console.error('Failed to skip previous:', error);
    } finally {
      setControlLoading(false);
    }
  };

  const handleSkipNext = async () => {
    if (controlLoading) return;
    setControlLoading(true);
    try {
      await spotifyApi.skipNext();
      await fetchPlaybackState();
    } catch (error) {
      console.error('Failed to skip next:', error);
    } finally {
      setControlLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--theme-bg-primary)' }}>
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
      </div>
    );
  }

  if (!status?.isLinked) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8" style={{ background: 'var(--theme-bg-primary)' }}>
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
          style={{ background: 'linear-gradient(135deg, #1DB954, #1ed760)' }}
        >
          <Music className="w-12 h-12 text-white" />
        </div>
        <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--theme-text-primary)' }}>
          Connect Spotify
        </h2>
        <p className="text-sm text-center mb-6 max-w-xs" style={{ color: 'var(--theme-text-muted)' }}>
          Connect your Spotify account to control playback and let Luna play music for you
        </p>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 px-6 py-3 rounded-full text-white font-medium transition hover:opacity-90 disabled:opacity-50"
          style={{ background: '#1DB954' }}
        >
          {connecting ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Link2 className="w-5 h-5" />
          )}
          Connect with Spotify
        </button>
      </div>
    );
  }

  // Get track info
  const track = playbackState?.item;
  const albumArt = track?.album.images[0]?.url;
  const progressPercent = track && playbackState?.progressMs
    ? (playbackState.progressMs / track.durationMs) * 100
    : 0;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: '#1DB954' }}
          >
            <Music className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
              Spotify
            </div>
            <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              {status.displayName || 'Connected'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchPlaybackState}
            className="p-1.5 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
            style={{ color: 'var(--theme-text-muted)' }}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleDisconnect}
            className="text-xs px-2 py-1 rounded transition"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Now Playing */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {/* Album Art */}
        <div
          className="w-48 h-48 rounded-lg flex items-center justify-center mb-6 shadow-lg overflow-hidden"
          style={{ background: 'var(--theme-bg-tertiary)' }}
        >
          {albumArt ? (
            <img
              src={albumArt}
              alt={track?.album.name || 'Album art'}
              className="w-full h-full object-cover"
            />
          ) : (
            <Disc className="w-24 h-24 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
          )}
        </div>

        {/* Track Info */}
        <div className="text-center mb-4 max-w-[280px]">
          <h2 className="text-lg font-medium mb-1 truncate" style={{ color: 'var(--theme-text-primary)' }}>
            {track?.name || 'No Track Playing'}
          </h2>
          <p className="text-sm truncate" style={{ color: 'var(--theme-text-muted)' }}>
            {track?.artists.map(a => a.name).join(', ') || 'Ask Luna to play some music'}
          </p>
        </div>

        {/* Progress Bar */}
        {track && (
          <div className="w-full max-w-[280px] mb-4">
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: 'var(--theme-bg-tertiary)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${progressPercent}%`, background: '#1DB954' }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                {formatTime(playbackState?.progressMs || 0)}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                {formatTime(track.durationMs)}
              </span>
            </div>
          </div>
        )}

        {/* Playback Controls */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleSkipPrevious}
            disabled={controlLoading}
            className="p-2 rounded-full transition hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-50"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <SkipBack className="w-5 h-5" />
          </button>
          <button
            onClick={handlePlayPause}
            disabled={controlLoading}
            className="p-4 rounded-full transition disabled:opacity-50"
            style={{ background: '#1DB954', color: 'white' }}
          >
            {playbackState?.isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6" />
            )}
          </button>
          <button
            onClick={handleSkipNext}
            disabled={controlLoading}
            className="p-2 rounded-full transition hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-50"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* Volume */}
        {playbackState?.device?.volumePercent !== null && playbackState?.device?.volumePercent !== undefined && (
          <div className="flex items-center gap-3 w-48">
            <Volume2 className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
            <div
              className="flex-1 h-1 rounded-full"
              style={{ background: 'var(--theme-bg-tertiary)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${playbackState.device.volumePercent}%`, background: 'var(--theme-accent-primary)' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Devices Section */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              {playbackState?.device?.name || 'No active device'}
            </span>
          </div>
          <a
            href="https://open.spotify.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs transition hover:underline"
            style={{ color: '#1DB954' }}
          >
            Open Spotify
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Info Footer */}
      {!playbackState?.device && (
        <div
          className="px-4 py-2 text-center border-t"
          style={{ borderColor: 'var(--theme-border-default)' }}
        >
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            Playback control requires an active Spotify session.
            <br />
            Open Spotify on any device to enable controls.
          </p>
        </div>
      )}
    </div>
  );
}
