import { api } from './core';

// Integrations API
export interface OAuthConnection {
  provider: string;
  connected: boolean;
  email?: string;
  expiresAt?: string;
}

export interface EmailStatus {
  enabled: boolean;
  smtp: { configured: boolean; connected: boolean };
  imap: { configured: boolean; connected: boolean };
  approvedRecipients: string[];
}

export const integrationsApi = {
  getOAuthStatus: () =>
    api<{ connections: OAuthConnection[] }>('/api/integrations/oauth/status'),

  disconnectOAuth: (provider: string) =>
    api<{ success: boolean }>(`/api/integrations/oauth/${provider}`, { method: 'DELETE' }),

  getEmailStatus: () =>
    api<EmailStatus>('/api/email/status'),
};

// Spotify API
export interface SpotifyStatus {
  isLinked: boolean;
  spotifyId: string | null;
  displayName: string | null;
}

export interface SpotifyAuthUrl {
  url: string;
  stateToken: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: Array<{ url: string; width: number; height: number }>;
  uri: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  durationMs: number;
  uri: string;
  previewUrl: string | null;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  progressMs: number | null;
  item: SpotifyTrack | null;
  device: SpotifyDevice | null;
  shuffleState: boolean;
  repeatState: string;
}

export const spotifyApi = {
  // Get connection status
  getStatus: () =>
    api<SpotifyStatus>('/api/abilities/spotify/status'),

  // Get authorization URL to start OAuth flow
  getAuthUrl: () =>
    api<SpotifyAuthUrl>('/api/abilities/spotify/authorize'),

  // Disconnect Spotify
  disconnect: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/disconnect', { method: 'DELETE' }),

  // Get current playback state
  getPlaybackStatus: () =>
    api<{ state: SpotifyPlaybackState | null }>('/api/abilities/spotify/playback'),

  // Playback controls
  play: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/play', { method: 'POST' }),

  pause: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/pause', { method: 'POST' }),

  skipNext: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/next', { method: 'POST' }),

  skipPrevious: () =>
    api<{ success: boolean; message: string }>('/api/abilities/spotify/previous', { method: 'POST' }),
};
