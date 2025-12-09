/**
 * Spotify Music Control Service for Luna
 *
 * Provides full Spotify integration including:
 * - Playback control (play, pause, skip, volume, queue)
 * - Device management (list, transfer, preferred device)
 * - Search and discovery
 * - Playlist management
 * - Mood-based recommendations
 *
 * Uses Luna's direct OAuth for authentication.
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import {
  getValidSpotifyToken,
  hasDirectSpotifyTokens,
  getSpotifyTokenInfo,
} from './spotify-oauth.js';

// =============================================================================
// Types
// =============================================================================

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

export interface PlaybackState {
  isPlaying: boolean;
  progressMs: number | null;
  item: SpotifyTrack | null;
  device: SpotifyDevice | null;
  shuffleState: boolean;
  repeatState: string;
}

export interface CurrentlyPlaying {
  isPlaying: boolean;
  track: SpotifyTrack | null;
  progressMs: number;
  device: SpotifyDevice | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  images: Array<{ url: string }>;
  tracksTotal: number;
  uri: string;
  owner: { displayName: string };
}

export interface SearchResults {
  tracks: SpotifyTrack[];
  artists: SpotifyArtist[];
  albums: SpotifyAlbum[];
  playlists: SpotifyPlaylist[];
}

export interface PlayMusicOptions {
  query?: string;
  type?: 'track' | 'artist' | 'album' | 'playlist';
  uri?: string;
  uris?: string[];
  contextUri?: string;
  shuffle?: boolean;
  deviceId?: string;
}

export interface PlaybackResult {
  success: boolean;
  message: string;
  track?: SpotifyTrack;
  device?: SpotifyDevice;
}

export interface RecommendationOptions {
  mood?: string;
  seedTracks?: string[];
  seedArtists?: string[];
  seedGenres?: string[];
  limit?: number;
}

export interface SpotifyPreferences {
  id: string;
  userId: string;
  spotifyId: string | null;
  preferredDeviceId: string | null;
  preferredDeviceName: string | null;
  lastDeviceId: string | null;
  lastDeviceName: string | null;
  autoPlayOnDevice: boolean;
  volumeDefault: number;
}

// =============================================================================
// Spotify API Client
// =============================================================================

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// Rate limiter
class RateLimiter {
  private lastCall = 0;
  private minInterval: number;

  constructor(callsPerSecond: number = 10) {
    this.minInterval = 1000 / callsPerSecond;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

const rateLimiter = new RateLimiter(10);

/**
 * SpotifyClient - Wrapper for Spotify Web API
 */
export class SpotifyClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    params?: Record<string, string | number | boolean>,
    body?: Record<string, unknown>
  ): Promise<T | null> {
    await rateLimiter.acquire();

    let url = `${SPOTIFY_API_BASE}${endpoint}`;
    if (params && method === 'GET') {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.append(key, String(value));
      }
      url += `?${searchParams.toString()}`;
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle specific status codes
      if (response.status === 204) {
        return null; // No content - success for some endpoints
      }

      if (response.status === 401) {
        throw new SpotifyError('Token expired', 'TOKEN_EXPIRED', true);
      }

      if (response.status === 403) {
        throw new SpotifyError('Premium required for playback control', 'PREMIUM_REQUIRED', false);
      }

      if (response.status === 404) {
        throw new SpotifyError('Resource not found', 'NOT_FOUND', false);
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new SpotifyError(
          `Rate limited. Retry after ${retryAfter || 'unknown'} seconds`,
          'RATE_LIMITED',
          true
        );
      }

      if (!response.ok) {
        const error = await response.text();
        throw new SpotifyError(`API error: ${response.status} - ${error}`, 'API_ERROR', false);
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof SpotifyError) throw error;
      logger.error(`Spotify API request failed: ${endpoint}`, { error });
      throw new SpotifyError('Network error', 'NETWORK_ERROR', true);
    }
  }

  // ---------------------------------------------------------------------------
  // Device Management
  // ---------------------------------------------------------------------------

  async getAvailableDevices(): Promise<SpotifyDevice[]> {
    const response = await this.request<{ devices: SpotifyApiDevice[] }>(
      'GET',
      '/me/player/devices'
    );

    return (response?.devices || []).map(mapDevice);
  }

  async transferPlayback(deviceId: string, play: boolean = false): Promise<void> {
    await this.request('PUT', '/me/player', undefined, {
      device_ids: [deviceId],
      play,
    });
  }

  // ---------------------------------------------------------------------------
  // Playback Control
  // ---------------------------------------------------------------------------

  async play(options?: {
    deviceId?: string;
    contextUri?: string;
    uris?: string[];
    offsetPosition?: number;
    positionMs?: number;
  }): Promise<void> {
    const params = options?.deviceId ? { device_id: options.deviceId } : undefined;
    const body: Record<string, unknown> = {};

    if (options?.contextUri) body.context_uri = options.contextUri;
    if (options?.uris) body.uris = options.uris;
    if (options?.offsetPosition !== undefined) body.offset = { position: options.offsetPosition };
    if (options?.positionMs !== undefined) body.position_ms = options.positionMs;

    await this.request('PUT', '/me/player/play', params, Object.keys(body).length ? body : undefined);
  }

  async pause(deviceId?: string): Promise<void> {
    const params = deviceId ? { device_id: deviceId } : undefined;
    await this.request('PUT', '/me/player/pause', params);
  }

  async next(deviceId?: string): Promise<void> {
    const params = deviceId ? { device_id: deviceId } : undefined;
    await this.request('POST', '/me/player/next', params);
  }

  async previous(deviceId?: string): Promise<void> {
    const params = deviceId ? { device_id: deviceId } : undefined;
    await this.request('POST', '/me/player/previous', params);
  }

  async seek(positionMs: number, deviceId?: string): Promise<void> {
    const params: Record<string, string | number> = { position_ms: positionMs };
    if (deviceId) params.device_id = deviceId;
    await this.request('PUT', '/me/player/seek', params);
  }

  async setVolume(volumePercent: number, deviceId?: string): Promise<void> {
    const params: Record<string, string | number> = {
      volume_percent: Math.max(0, Math.min(100, volumePercent)),
    };
    if (deviceId) params.device_id = deviceId;
    await this.request('PUT', '/me/player/volume', params);
  }

  async setShuffle(state: boolean, deviceId?: string): Promise<void> {
    const params: Record<string, string | boolean> = { state };
    if (deviceId) params.device_id = deviceId;
    await this.request('PUT', '/me/player/shuffle', params);
  }

  async setRepeat(state: 'track' | 'context' | 'off', deviceId?: string): Promise<void> {
    const params: Record<string, string> = { state };
    if (deviceId) params.device_id = deviceId;
    await this.request('PUT', '/me/player/repeat', params);
  }

  async addToQueue(uri: string, deviceId?: string): Promise<void> {
    const params: Record<string, string> = { uri };
    if (deviceId) params.device_id = deviceId;
    await this.request('POST', '/me/player/queue', params);
  }

  // ---------------------------------------------------------------------------
  // Playback State
  // ---------------------------------------------------------------------------

  async getCurrentlyPlaying(): Promise<CurrentlyPlaying | null> {
    const response = await this.request<SpotifyApiCurrentlyPlaying>(
      'GET',
      '/me/player/currently-playing'
    );

    if (!response) return null;

    return {
      isPlaying: response.is_playing,
      track: response.item ? mapTrack(response.item) : null,
      progressMs: response.progress_ms || 0,
      device: response.device ? mapDevice(response.device) : null,
    };
  }

  async getPlaybackState(): Promise<PlaybackState | null> {
    const response = await this.request<SpotifyApiPlaybackState>(
      'GET',
      '/me/player'
    );

    if (!response) return null;

    return {
      isPlaying: response.is_playing,
      progressMs: response.progress_ms,
      item: response.item ? mapTrack(response.item) : null,
      device: response.device ? mapDevice(response.device) : null,
      shuffleState: response.shuffle_state,
      repeatState: response.repeat_state,
    };
  }

  async getRecentlyPlayed(limit: number = 20): Promise<SpotifyTrack[]> {
    const response = await this.request<{ items: Array<{ track: SpotifyApiTrack }> }>(
      'GET',
      '/me/player/recently-played',
      { limit }
    );

    return (response?.items || []).map(item => mapTrack(item.track));
  }

  // ---------------------------------------------------------------------------
  // Search & Discovery
  // ---------------------------------------------------------------------------

  async search(
    query: string,
    types: ('track' | 'artist' | 'album' | 'playlist')[] = ['track'],
    limit: number = 10
  ): Promise<SearchResults> {
    const response = await this.request<SpotifyApiSearchResponse>(
      'GET',
      '/search',
      { q: query, type: types.join(','), limit }
    );

    return {
      tracks: (response?.tracks?.items || []).map(mapTrack),
      artists: (response?.artists?.items || []).map(mapArtist),
      albums: (response?.albums?.items || []).map(mapAlbum),
      playlists: (response?.playlists?.items || []).map(mapPlaylist),
    };
  }

  async getRecommendations(options: {
    seedTracks?: string[];
    seedArtists?: string[];
    seedGenres?: string[];
    targetEnergy?: number;
    targetValence?: number;
    targetTempo?: number;
    targetDanceability?: number;
    targetInstrumentalness?: number;
    targetAcousticness?: number;
    limit?: number;
  }): Promise<SpotifyTrack[]> {
    const params: Record<string, string | number> = {
      limit: options.limit || 20,
    };

    if (options.seedTracks?.length) params.seed_tracks = options.seedTracks.join(',');
    if (options.seedArtists?.length) params.seed_artists = options.seedArtists.join(',');
    if (options.seedGenres?.length) params.seed_genres = options.seedGenres.join(',');
    if (options.targetEnergy !== undefined) params.target_energy = options.targetEnergy;
    if (options.targetValence !== undefined) params.target_valence = options.targetValence;
    if (options.targetTempo !== undefined) params.target_tempo = options.targetTempo;
    if (options.targetDanceability !== undefined) params.target_danceability = options.targetDanceability;
    if (options.targetInstrumentalness !== undefined) params.target_instrumentalness = options.targetInstrumentalness;
    if (options.targetAcousticness !== undefined) params.target_acousticness = options.targetAcousticness;

    const response = await this.request<{ tracks: SpotifyApiTrack[] }>(
      'GET',
      '/recommendations',
      params
    );

    return (response?.tracks || []).map(mapTrack);
  }

  async getTopItems(
    type: 'artists' | 'tracks',
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
    limit: number = 20
  ): Promise<SpotifyTrack[] | SpotifyArtist[]> {
    const response = await this.request<{ items: SpotifyApiTrack[] | SpotifyApiArtist[] }>(
      'GET',
      `/me/top/${type}`,
      { time_range: timeRange, limit }
    );

    if (type === 'tracks') {
      return (response?.items || []).map(item => mapTrack(item as SpotifyApiTrack));
    }
    return (response?.items || []).map(item => mapArtist(item as SpotifyApiArtist));
  }

  // ---------------------------------------------------------------------------
  // Playlists
  // ---------------------------------------------------------------------------

  async getUserPlaylists(limit: number = 50): Promise<SpotifyPlaylist[]> {
    const response = await this.request<{ items: SpotifyApiPlaylist[] }>(
      'GET',
      '/me/playlists',
      { limit }
    );

    return (response?.items || []).map(mapPlaylist);
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylist | null> {
    const response = await this.request<SpotifyApiPlaylist>(
      'GET',
      `/playlists/${playlistId}`
    );

    return response ? mapPlaylist(response) : null;
  }

  async getPlaylistTracks(playlistId: string, limit: number = 100): Promise<SpotifyTrack[]> {
    const response = await this.request<{ items: Array<{ track: SpotifyApiTrack }> }>(
      'GET',
      `/playlists/${playlistId}/tracks`,
      { limit }
    );

    return (response?.items || []).map(item => mapTrack(item.track));
  }

  async createPlaylist(
    userId: string,
    name: string,
    description?: string,
    isPublic: boolean = false
  ): Promise<SpotifyPlaylist | null> {
    const response = await this.request<SpotifyApiPlaylist>(
      'POST',
      `/users/${userId}/playlists`,
      undefined,
      { name, description, public: isPublic }
    );

    return response ? mapPlaylist(response) : null;
  }

  async addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    // Spotify allows max 100 tracks per request
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      await this.request('POST', `/playlists/${playlistId}/tracks`, undefined, { uris: batch });
    }
  }

  // ---------------------------------------------------------------------------
  // User Profile
  // ---------------------------------------------------------------------------

  async getCurrentUser(): Promise<{ id: string; displayName: string; email: string } | null> {
    const response = await this.request<{ id: string; display_name: string; email: string }>(
      'GET',
      '/me'
    );

    if (!response) return null;
    return {
      id: response.id,
      displayName: response.display_name,
      email: response.email,
    };
  }
}

// =============================================================================
// Service-Level Functions
// =============================================================================

/**
 * Check if a user has Spotify linked (via direct OAuth)
 */
export async function isSpotifyLinked(userId: string): Promise<boolean> {
  return await hasDirectSpotifyTokens(userId);
}

/**
 * Get a Spotify client for a Luna user
 * Uses direct Luna OAuth tokens
 */
export async function getSpotifyClient(userId: string): Promise<SpotifyClient | null> {
  if (await hasDirectSpotifyTokens(userId)) {
    const accessToken = await getValidSpotifyToken(userId);
    if (accessToken) {
      logger.debug(`Using Spotify token for user ${userId}`);
      return new SpotifyClient(accessToken);
    }
    logger.warn(`Spotify tokens found but invalid for user ${userId}`);
  }

  logger.debug(`No Spotify connection for user ${userId}`);
  return null;
}

// =============================================================================
// Preferences & Device Management
// =============================================================================

/**
 * Get Spotify preferences for a user
 */
export async function getSpotifyPreferences(userId: string): Promise<SpotifyPreferences | null> {
  const result = await pool.query<SpotifyPreferences>(
    `SELECT id, user_id as "userId",
            spotify_id as "spotifyId", preferred_device_id as "preferredDeviceId",
            preferred_device_name as "preferredDeviceName",
            last_device_id as "lastDeviceId", last_device_name as "lastDeviceName",
            auto_play_on_device as "autoPlayOnDevice", volume_default as "volumeDefault"
     FROM spotify_preferences
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

/**
 * Set preferred Spotify device
 */
export async function setPreferredDevice(
  userId: string,
  deviceId: string,
  deviceName: string
): Promise<void> {
  await pool.query(
    `INSERT INTO spotify_preferences (user_id, preferred_device_id, preferred_device_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       preferred_device_id = $2,
       preferred_device_name = $3,
       updated_at = NOW()`,
    [userId, deviceId, deviceName]
  );
}

/**
 * Update last used device
 */
export async function updateLastDevice(
  userId: string,
  deviceId: string,
  deviceName: string
): Promise<void> {
  await pool.query(
    `UPDATE spotify_preferences
     SET last_device_id = $2, last_device_name = $3, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, deviceId, deviceName]
  );
}

/**
 * Get active or preferred device
 */
export async function getActiveOrPreferredDevice(
  userId: string,
  client: SpotifyClient
): Promise<SpotifyDevice | null> {
  const devices = await client.getAvailableDevices();

  // First, check for an active device
  const activeDevice = devices.find(d => d.isActive);
  if (activeDevice) {
    await updateLastDevice(userId, activeDevice.id, activeDevice.name);
    return activeDevice;
  }

  // Fall back to preferred device
  const prefs = await getSpotifyPreferences(userId);
  if (prefs?.preferredDeviceId) {
    const preferred = devices.find(d => d.id === prefs.preferredDeviceId);
    if (preferred) return preferred;
  }

  // Fall back to last used device
  if (prefs?.lastDeviceId) {
    const last = devices.find(d => d.id === prefs.lastDeviceId);
    if (last) return last;
  }

  // Return first available device
  return devices[0] || null;
}

// =============================================================================
// High-Level Playback Functions
// =============================================================================

/**
 * Play music with various options
 */
export async function playMusic(
  userId: string,
  options: PlayMusicOptions
): Promise<PlaybackResult> {
  const client = await getSpotifyClient(userId);
  if (!client) {
    return { success: false, message: 'Spotify not connected. Link your account first.' };
  }

  try {
    // Get device
    let deviceId = options.deviceId;
    if (!deviceId) {
      const device = await getActiveOrPreferredDevice(userId, client);
      if (!device) {
        return {
          success: false,
          message: 'No Spotify device found. Open Spotify on a device first.',
        };
      }
      deviceId = device.id;
    }

    // If we have a direct URI, play it
    if (options.uri) {
      if (options.uri.includes(':track:')) {
        await client.play({ deviceId, uris: [options.uri] });
      } else {
        await client.play({ deviceId, contextUri: options.uri });
      }

      // Get what's playing now
      const state = await client.getCurrentlyPlaying();
      return {
        success: true,
        message: 'Playing',
        track: state?.track || undefined,
      };
    }

    // If we have URIs array
    if (options.uris?.length) {
      await client.play({ deviceId, uris: options.uris });
      const state = await client.getCurrentlyPlaying();
      return {
        success: true,
        message: 'Playing',
        track: state?.track || undefined,
      };
    }

    // If we have a context URI (playlist/album)
    if (options.contextUri) {
      await client.play({ deviceId, contextUri: options.contextUri });
      if (options.shuffle) {
        await client.setShuffle(true, deviceId);
      }
      const state = await client.getCurrentlyPlaying();
      return {
        success: true,
        message: 'Playing',
        track: state?.track || undefined,
      };
    }

    // Search and play
    if (options.query) {
      const searchType = options.type || 'track';
      const results = await client.search(options.query, [searchType], 1);

      if (searchType === 'track' && results.tracks.length > 0) {
        const track = results.tracks[0];
        await client.play({ deviceId, uris: [track.uri] });
        return { success: true, message: `Playing "${track.name}" by ${track.artists[0]?.name}`, track };
      }

      if (searchType === 'artist' && results.artists.length > 0) {
        const artist = results.artists[0];
        await client.play({ deviceId, contextUri: artist.uri });
        if (options.shuffle !== false) {
          await client.setShuffle(true, deviceId);
        }
        return { success: true, message: `Playing ${artist.name}` };
      }

      if (searchType === 'album' && results.albums.length > 0) {
        const album = results.albums[0];
        await client.play({ deviceId, contextUri: album.uri });
        return { success: true, message: `Playing album "${album.name}"` };
      }

      if (searchType === 'playlist' && results.playlists.length > 0) {
        const playlist = results.playlists[0];
        await client.play({ deviceId, contextUri: playlist.uri });
        if (options.shuffle !== false) {
          await client.setShuffle(true, deviceId);
        }
        return { success: true, message: `Playing playlist "${playlist.name}"` };
      }

      return { success: false, message: `No ${searchType} found for "${options.query}"` };
    }

    // Just resume playback
    await client.play({ deviceId });
    const state = await client.getCurrentlyPlaying();
    return {
      success: true,
      message: 'Resuming playback',
      track: state?.track || undefined,
    };
  } catch (error) {
    return handleSpotifyError(error);
  }
}

/**
 * Pause playback
 */
export async function pauseMusic(userId: string): Promise<PlaybackResult> {
  const client = await getSpotifyClient(userId);
  if (!client) {
    return { success: false, message: 'Spotify not connected' };
  }

  try {
    await client.pause();
    return { success: true, message: 'Paused' };
  } catch (error) {
    return handleSpotifyError(error);
  }
}

/**
 * Skip to next/previous track
 */
export async function skipTrack(
  userId: string,
  direction: 'next' | 'previous'
): Promise<PlaybackResult> {
  const client = await getSpotifyClient(userId);
  if (!client) {
    return { success: false, message: 'Spotify not connected' };
  }

  try {
    if (direction === 'next') {
      await client.next();
    } else {
      await client.previous();
    }

    // Wait a moment for Spotify to update
    await new Promise(resolve => setTimeout(resolve, 300));
    const state = await client.getCurrentlyPlaying();

    return {
      success: true,
      message: direction === 'next' ? 'Skipped to next track' : 'Went to previous track',
      track: state?.track || undefined,
    };
  } catch (error) {
    return handleSpotifyError(error);
  }
}

/**
 * Set volume
 */
export async function setVolume(userId: string, volume: number): Promise<PlaybackResult> {
  const client = await getSpotifyClient(userId);
  if (!client) {
    return { success: false, message: 'Spotify not connected' };
  }

  try {
    await client.setVolume(volume);
    return { success: true, message: `Volume set to ${volume}%` };
  } catch (error) {
    return handleSpotifyError(error);
  }
}

/**
 * Add track to queue
 */
export async function addToQueue(userId: string, query: string): Promise<PlaybackResult> {
  const client = await getSpotifyClient(userId);
  if (!client) {
    return { success: false, message: 'Spotify not connected' };
  }

  try {
    const results = await client.search(query, ['track'], 1);
    if (results.tracks.length === 0) {
      return { success: false, message: `No track found for "${query}"` };
    }

    const track = results.tracks[0];
    await client.addToQueue(track.uri);
    return {
      success: true,
      message: `Added "${track.name}" to queue`,
      track,
    };
  } catch (error) {
    return handleSpotifyError(error);
  }
}

/**
 * Get playback status
 */
export async function getPlaybackStatus(userId: string): Promise<PlaybackState | null> {
  const client = await getSpotifyClient(userId);
  if (!client) return null;

  try {
    return await client.getPlaybackState();
  } catch {
    return null;
  }
}

/**
 * Get available devices
 */
export async function getAvailableDevices(userId: string): Promise<SpotifyDevice[]> {
  const client = await getSpotifyClient(userId);
  if (!client) return [];

  try {
    return await client.getAvailableDevices();
  } catch {
    return [];
  }
}

/**
 * Transfer playback to device
 */
export async function transferPlayback(
  userId: string,
  deviceId: string,
  play: boolean = false
): Promise<PlaybackResult> {
  const client = await getSpotifyClient(userId);
  if (!client) {
    return { success: false, message: 'Spotify not connected' };
  }

  try {
    await client.transferPlayback(deviceId, play);
    const devices = await client.getAvailableDevices();
    const device = devices.find(d => d.id === deviceId);
    if (device) {
      await updateLastDevice(userId, deviceId, device.name);
    }
    return { success: true, message: `Playback transferred to ${device?.name || 'device'}` };
  } catch (error) {
    return handleSpotifyError(error);
  }
}

/**
 * Search Spotify
 */
export async function search(
  userId: string,
  query: string,
  type: 'track' | 'artist' | 'album' | 'playlist' = 'track',
  limit: number = 10
): Promise<SearchResults | null> {
  const client = await getSpotifyClient(userId);
  if (!client) return null;

  try {
    return await client.search(query, [type], limit);
  } catch {
    return null;
  }
}

/**
 * Get mood-based recommendations
 */
export async function getRecommendations(
  userId: string,
  options: RecommendationOptions
): Promise<SpotifyTrack[]> {
  const client = await getSpotifyClient(userId);
  if (!client) return [];

  try {
    // Map mood to audio features
    const moodFeatures = options.mood ? MOOD_TO_FEATURES[options.mood.toLowerCase()] : {};

    // Get seeds - use provided ones or fall back to user's top tracks
    let seedTracks = options.seedTracks || [];
    let seedArtists = options.seedArtists || [];
    const seedGenres = options.seedGenres || [];

    // If no seeds provided, use user's top tracks
    if (!seedTracks.length && !seedArtists.length && !seedGenres.length) {
      const topTracks = await client.getTopItems('tracks', 'short_term', 5) as SpotifyTrack[];
      seedTracks = topTracks.slice(0, 2).map(t => t.id);
    }

    return await client.getRecommendations({
      seedTracks,
      seedArtists,
      seedGenres,
      ...moodFeatures,
      limit: options.limit || 20,
    });
  } catch (error) {
    logger.error(`Failed to get recommendations for user ${userId}`, { error });
    return [];
  }
}

// =============================================================================
// Mood-to-Audio-Features Mapping
// =============================================================================

const MOOD_TO_FEATURES: Record<string, Record<string, number>> = {
  happy: { targetValence: 0.8, targetEnergy: 0.7, targetTempo: 120 },
  sad: { targetValence: 0.2, targetEnergy: 0.3, targetTempo: 80 },
  energetic: { targetValence: 0.7, targetEnergy: 0.9, targetTempo: 140 },
  calm: { targetValence: 0.5, targetEnergy: 0.3, targetTempo: 90 },
  focused: { targetValence: 0.5, targetEnergy: 0.5, targetInstrumentalness: 0.7, targetTempo: 100 },
  workout: { targetValence: 0.7, targetEnergy: 0.95, targetTempo: 150 },
  sleep: { targetValence: 0.3, targetEnergy: 0.1, targetAcousticness: 0.8, targetTempo: 60 },
  party: { targetValence: 0.9, targetEnergy: 0.9, targetDanceability: 0.9, targetTempo: 128 },
  chill: { targetValence: 0.6, targetEnergy: 0.4, targetTempo: 100 },
  romantic: { targetValence: 0.6, targetEnergy: 0.4, targetAcousticness: 0.6, targetTempo: 100 },
  angry: { targetValence: 0.3, targetEnergy: 0.9, targetTempo: 140 },
  melancholic: { targetValence: 0.3, targetEnergy: 0.4, targetAcousticness: 0.5, targetTempo: 85 },
};

// =============================================================================
// Formatting for LLM
// =============================================================================

/**
 * Format Spotify state for the LLM prompt context
 */
export function formatSpotifyForPrompt(
  state: PlaybackState | null,
  devices?: SpotifyDevice[]
): string {
  const parts: string[] = [];

  if (!state && (!devices || devices.length === 0)) {
    return '';
  }

  parts.push('[Spotify]');

  if (state?.isPlaying && state.item) {
    const track = state.item;
    const artists = track.artists.map(a => a.name).join(', ');
    const progress = formatDuration(state.progressMs || 0);
    const duration = formatDuration(track.durationMs);

    parts.push(`Now playing: "${track.name}" by ${artists}`);
    parts.push(`Progress: ${progress} / ${duration}`);

    if (state.device) {
      parts.push(`Device: ${state.device.name}`);
    }
    if (state.shuffleState) {
      parts.push('Shuffle: on');
    }
  } else if (state?.item) {
    parts.push('Playback paused');
    parts.push(`Last track: "${state.item.name}"`);
  } else {
    parts.push('Nothing playing');
  }

  if (devices && devices.length > 0) {
    const deviceNames = devices.map(d => d.isActive ? `${d.name} (active)` : d.name);
    parts.push(`Available devices: ${deviceNames.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Format Spotify tools for the LLM
 */
export function formatSpotifyForLLM(): Array<{
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return [
    {
      type: 'function',
      function: {
        name: 'spotify_play',
        description: 'Play music on Spotify. Can play a specific track, artist, album, playlist by name, or resume playback.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query - song name, artist, album, or playlist' },
            type: { type: 'string', enum: ['track', 'artist', 'album', 'playlist'], description: 'Type of content to play. Default: track' },
            shuffle: { type: 'boolean', description: 'Enable shuffle mode for artist/playlist' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_pause',
        description: 'Pause Spotify playback',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_next',
        description: 'Skip to the next track',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_previous',
        description: 'Go back to the previous track',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_volume',
        description: 'Set Spotify volume (0-100)',
        parameters: {
          type: 'object',
          properties: {
            volume: { type: 'number', minimum: 0, maximum: 100, description: 'Volume percentage' },
          },
          required: ['volume'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_queue',
        description: 'Add a track to the playback queue',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Track name to search and add to queue' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_status',
        description: 'Get current Spotify playback status including what is playing',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_search',
        description: 'Search Spotify for tracks, artists, albums, or playlists',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: { type: 'string', enum: ['track', 'artist', 'album', 'playlist'], description: 'Type to search. Default: track' },
            limit: { type: 'number', minimum: 1, maximum: 20, description: 'Number of results. Default: 5' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_recommendations',
        description: 'Get music recommendations based on mood or preferences',
        parameters: {
          type: 'object',
          properties: {
            mood: {
              type: 'string',
              enum: ['happy', 'sad', 'energetic', 'calm', 'focused', 'workout', 'sleep', 'party', 'chill', 'romantic'],
              description: 'Target mood for recommendations',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spotify_devices',
        description: 'List available Spotify devices or transfer playback to a device',
        parameters: {
          type: 'object',
          properties: {
            transferTo: { type: 'string', description: 'Device name to transfer playback to (optional)' },
          },
        },
      },
    },
  ];
}

// =============================================================================
// Connection Status
// =============================================================================

/**
 * Get Spotify connection status for a user
 */
export async function getConnectionStatus(userId: string): Promise<{
  isLinked: boolean;
  spotifyId: string | null;
  displayName: string | null;
}> {
  const tokenInfo = await getSpotifyTokenInfo(userId);

  if (tokenInfo) {
    return {
      isLinked: true,
      spotifyId: tokenInfo.spotifyId,
      displayName: tokenInfo.displayName,
    };
  }

  return {
    isLinked: false,
    spotifyId: null,
    displayName: null,
  };
}

// =============================================================================
// Error Handling
// =============================================================================

export class SpotifyError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

function handleSpotifyError(error: unknown): PlaybackResult {
  if (error instanceof SpotifyError) {
    switch (error.code) {
      case 'TOKEN_EXPIRED':
        return { success: false, message: 'Session expired. Please try again.' };
      case 'PREMIUM_REQUIRED':
        return { success: false, message: 'Spotify Premium is required for playback control.' };
      case 'NO_ACTIVE_DEVICE':
        return { success: false, message: 'No active Spotify device. Open Spotify on a device first.' };
      case 'RATE_LIMITED':
        return { success: false, message: 'Too many requests. Please wait a moment.' };
      default:
        return { success: false, message: error.message };
    }
  }

  logger.error('Unexpected Spotify error', { error });
  return { success: false, message: 'Something went wrong with Spotify.' };
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Spotify API response types (snake_case from API)
interface SpotifyApiDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
}

interface SpotifyApiArtist {
  id: string;
  name: string;
  uri: string;
}

interface SpotifyApiAlbum {
  id: string;
  name: string;
  images: Array<{ url: string; width: number; height: number }>;
  uri: string;
}

interface SpotifyApiTrack {
  id: string;
  name: string;
  artists: SpotifyApiArtist[];
  album: SpotifyApiAlbum;
  duration_ms: number;
  uri: string;
  preview_url: string | null;
}

interface SpotifyApiPlaylist {
  id: string;
  name: string;
  description: string | null;
  images: Array<{ url: string }>;
  tracks: { total: number };
  uri: string;
  owner: { display_name: string };
}

interface SpotifyApiCurrentlyPlaying {
  is_playing: boolean;
  item: SpotifyApiTrack | null;
  progress_ms: number | null;
  device?: SpotifyApiDevice;
}

interface SpotifyApiPlaybackState {
  is_playing: boolean;
  progress_ms: number | null;
  item: SpotifyApiTrack | null;
  device: SpotifyApiDevice;
  shuffle_state: boolean;
  repeat_state: string;
}

interface SpotifyApiSearchResponse {
  tracks?: { items: SpotifyApiTrack[] };
  artists?: { items: SpotifyApiArtist[] };
  albums?: { items: SpotifyApiAlbum[] };
  playlists?: { items: SpotifyApiPlaylist[] };
}

// Mappers
function mapDevice(d: SpotifyApiDevice): SpotifyDevice {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: d.is_active,
    isRestricted: d.is_restricted,
    volumePercent: d.volume_percent,
  };
}

function mapArtist(a: SpotifyApiArtist): SpotifyArtist {
  return { id: a.id, name: a.name, uri: a.uri };
}

function mapAlbum(a: SpotifyApiAlbum): SpotifyAlbum {
  return { id: a.id, name: a.name, images: a.images, uri: a.uri };
}

function mapTrack(t: SpotifyApiTrack): SpotifyTrack {
  return {
    id: t.id,
    name: t.name,
    artists: t.artists.map(mapArtist),
    album: mapAlbum(t.album),
    durationMs: t.duration_ms,
    uri: t.uri,
    previewUrl: t.preview_url,
  };
}

function mapPlaylist(p: SpotifyApiPlaylist): SpotifyPlaylist {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    images: p.images,
    tracksTotal: p.tracks.total,
    uri: p.uri,
    owner: { displayName: p.owner.display_name },
  };
}
