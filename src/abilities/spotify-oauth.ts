/**
 * Spotify OAuth Service
 *
 * OAuth authentication with Spotify for Luna users.
 */

import crypto from 'crypto';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import { encryptToken, decryptToken } from '../utils/encryption.js';
import logger from '../utils/logger.js';

// Spotify OAuth configuration
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_USER_URL = 'https://api.spotify.com/v1/me';

// Required scopes for full music control
const SPOTIFY_SCOPES = [
  // Playback control
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  // Library access
  'user-library-read',
  'user-library-modify',
  // Playlist access
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  // User info
  'user-read-email',
  'user-read-private',
  // Listening history for recommendations
  'user-top-read',
  'user-read-recently-played',
];

export interface SpotifyOAuthState {
  id: string;
  userId: string;
  stateToken: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export interface SpotifyUserProfile {
  id: string;
  displayName: string | null;
  email: string | null;
  product: string; // 'premium', 'free', etc.
  country: string;
  images: { url: string }[];
}

// =============================================================================
// OAuth Flow Functions
// =============================================================================

/**
 * Generate authorization URL for Spotify OAuth
 */
export async function generateSpotifyAuthUrl(userId: string): Promise<{ url: string; stateToken: string }> {
  const clientId = config.spotify?.clientId || process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error('Spotify client ID not configured');
  }

  // Generate state token and PKCE verifier
  const stateToken = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Build redirect URI
  const redirectUri = `${config.oauth.callbackBaseUrl}/api/abilities/spotify/callback`;

  // Store state for verification
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  await pool.query(
    `INSERT INTO oauth_states (user_id, provider, state_token, code_verifier, scopes, redirect_uri, expires_at)
     VALUES ($1, 'spotify', $2, $3, $4, $5, $6)`,
    [userId, stateToken, codeVerifier, SPOTIFY_SCOPES, redirectUri, expiresAt]
  );

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state: stateToken,
    scope: SPOTIFY_SCOPES.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    show_dialog: 'true', // Always show dialog to allow account switching
  });

  logger.info(`Generated Spotify auth URL for user ${userId}`);

  return {
    url: `${SPOTIFY_AUTH_URL}?${params.toString()}`,
    stateToken,
  };
}

/**
 * Handle OAuth callback and exchange code for tokens
 */
export async function handleSpotifyCallback(
  code: string,
  stateToken: string
): Promise<{ userId: string; profile: SpotifyUserProfile }> {
  // Verify state
  const stateResult = await pool.query(
    `SELECT id, user_id, code_verifier, redirect_uri, expires_at
     FROM oauth_states
     WHERE state_token = $1 AND provider = 'spotify'`,
    [stateToken]
  );

  if (stateResult.rows.length === 0) {
    throw new Error('Invalid state token');
  }

  const state = stateResult.rows[0];
  if (new Date(state.expires_at) < new Date()) {
    throw new Error('State token expired');
  }

  const userId = state.user_id;
  const codeVerifier = state.code_verifier;
  const redirectUri = state.redirect_uri;

  // Delete used state
  await pool.query('DELETE FROM oauth_states WHERE id = $1', [state.id]);

  // Exchange code for tokens
  const clientId = config.spotify?.clientId || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = config.spotify?.clientSecret || process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    logger.error(`Spotify token exchange failed: ${error}`);
    throw new Error('Failed to exchange code for tokens');
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  const tokens: SpotifyTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    scope: tokenData.scope,
  };

  // Get user profile
  const profile = await getSpotifyProfile(tokens.accessToken);

  // Store tokens
  await storeSpotifyTokens(userId, profile, tokens);

  logger.info(`Spotify OAuth completed for user ${userId} (Spotify: ${profile.id})`);

  return { userId, profile };
}

/**
 * Get Spotify user profile
 */
async function getSpotifyProfile(accessToken: string): Promise<SpotifyUserProfile> {
  const response = await fetch(SPOTIFY_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to get Spotify user profile');
  }

  const data = await response.json() as {
    id: string;
    display_name: string | null;
    email: string | null;
    product: string;
    country: string;
    images: { url: string }[];
  };

  return {
    id: data.id,
    displayName: data.display_name,
    email: data.email,
    product: data.product,
    country: data.country,
    images: data.images,
  };
}

/**
 * Store Spotify tokens in database
 */
async function storeSpotifyTokens(
  userId: string,
  profile: SpotifyUserProfile,
  tokens: SpotifyTokens
): Promise<void> {
  const encryptedAccess = encryptToken(tokens.accessToken);
  const encryptedRefresh = encryptToken(tokens.refreshToken);

  await pool.query(
    `INSERT INTO spotify_tokens
      (user_id, spotify_id, display_name, email, access_token, refresh_token, token_expires_at, scopes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       spotify_id = EXCLUDED.spotify_id,
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       scopes = EXCLUDED.scopes,
       updated_at = NOW()`,
    [
      userId,
      profile.id,
      profile.displayName,
      profile.email,
      encryptedAccess,
      encryptedRefresh,
      tokens.expiresAt,
      SPOTIFY_SCOPES,
    ]
  );

}

/**
 * Refresh Spotify tokens
 */
export async function refreshSpotifyTokens(userId: string): Promise<SpotifyTokens | null> {
  try {
    const result = await pool.query(
      `SELECT spotify_id, refresh_token FROM spotify_tokens WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const { spotify_id: spotifyId, refresh_token: encryptedRefresh } = result.rows[0];
    const refreshToken = decryptToken(encryptedRefresh);

    const clientId = config.spotify?.clientId || process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = config.spotify?.clientSecret || process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      logger.error('Spotify credentials not configured for token refresh');
      return null;
    }

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Spotify token refresh failed: ${error}`);
      return null;
    }

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const tokens: SpotifyTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken, // Spotify may not return new refresh token
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      scope: tokenData.scope,
    };

    // Update stored tokens
    await pool.query(
      `UPDATE spotify_tokens
       SET access_token = $2,
           refresh_token = $3,
           token_expires_at = $4,
           updated_at = NOW()
       WHERE user_id = $1`,
      [
        userId,
        encryptToken(tokens.accessToken),
        encryptToken(tokens.refreshToken),
        tokens.expiresAt,
      ]
    );

    logger.info(`Spotify tokens refreshed for user ${userId} (${spotifyId})`);

    return tokens;
  } catch (error) {
    logger.error(`Failed to refresh Spotify tokens for user ${userId}`, { error });
    return null;
  }
}

/**
 * Get valid Spotify access token (refreshing if needed)
 */
export async function getValidSpotifyToken(userId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT access_token, token_expires_at FROM spotify_tokens WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const { access_token: encryptedToken, token_expires_at: expiresAt } = result.rows[0];

    // Check if token is expired or about to expire (5 min buffer)
    const bufferTime = 5 * 60 * 1000;
    if (new Date(expiresAt).getTime() - bufferTime < Date.now()) {
      logger.info(`Spotify token expired for user ${userId}, refreshing...`);
      const refreshed = await refreshSpotifyTokens(userId);
      return refreshed?.accessToken || null;
    }

    return decryptToken(encryptedToken);
  } catch (error) {
    logger.error(`Failed to get valid Spotify token for user ${userId}`, { error });
    return null;
  }
}

/**
 * Check if user has direct Spotify tokens
 */
export async function hasDirectSpotifyTokens(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM spotify_tokens WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0;
}

/**
 * Get direct Spotify token info (without decrypting)
 */
export async function getSpotifyTokenInfo(userId: string): Promise<{
  spotifyId: string;
  displayName: string | null;
  email: string | null;
  expiresAt: Date;
} | null> {
  const result = await pool.query(
    `SELECT spotify_id, display_name, email, token_expires_at
     FROM spotify_tokens WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    spotifyId: row.spotify_id,
    displayName: row.display_name,
    email: row.email,
    expiresAt: new Date(row.token_expires_at),
  };
}

/**
 * Disconnect Spotify (remove direct tokens)
 */
export async function disconnectSpotify(userId: string): Promise<void> {
  await pool.query('DELETE FROM spotify_tokens WHERE user_id = $1', [userId]);
  await pool.query(
    `DELETE FROM spotify_user_links WHERE luna_user_id = $1 AND source = 'direct'`,
    [userId]
  );
  logger.info(`Spotify disconnected for user ${userId}`);
}
