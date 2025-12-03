import crypto from 'crypto';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import { encryptToken, decryptToken } from '../utils/encryption.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export type OAuthProvider = 'google' | 'microsoft';

export interface OAuthState {
  id: string;
  userId: string;
  provider: OAuthProvider;
  stateToken: string;
  codeVerifier?: string;
  scopes: string[];
  redirectUri: string;
  expiresAt: Date;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
}

export interface ConnectionStatus {
  provider: OAuthProvider;
  connected: boolean;
  email?: string;
  lastSyncAt?: Date;
  scopes?: string[];
}

// Provider configurations
const PROVIDER_CONFIGS: Record<OAuthProvider, {
  authUrl: string;
  tokenUrl: string;
  scopes: Record<string, string[]>;
}> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: {
      calendar: ['https://www.googleapis.com/auth/calendar'],
      email: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
      profile: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    },
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    scopes: {
      calendar: ['Calendars.ReadWrite'],
      email: ['Mail.Read', 'Mail.Send'],
      profile: ['User.Read'],
    },
  },
};

// ============================================
// OAuth Flow Functions
// ============================================

/**
 * Generate authorization URL for a provider
 */
export async function generateAuthUrl(
  userId: string,
  provider: OAuthProvider,
  requestedScopes: string[] = ['calendar', 'email']
): Promise<{ url: string; stateToken: string }> {
  // Check if provider is enabled
  const providerConfig = provider === 'google' ? config.oauth.google : config.oauth.microsoft;
  if (!providerConfig.enabled || !providerConfig.clientId) {
    throw new Error(`${provider} OAuth is not configured`);
  }

  // Generate state token and PKCE verifier
  const stateToken = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  // Build scopes
  const providerScopes = PROVIDER_CONFIGS[provider].scopes;
  const scopes = ['profile', ...requestedScopes]
    .flatMap(scope => providerScopes[scope] || []);

  // Build redirect URI
  const redirectUri = `${config.oauth.callbackBaseUrl}/api/integrations/oauth/${provider}/callback`;

  // Store state for verification
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  await pool.query(
    `INSERT INTO oauth_states (user_id, provider, state_token, code_verifier, scopes, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, provider, stateToken, codeVerifier, scopes, redirectUri, expiresAt]
  );

  // Build authorization URL
  let authUrl = PROVIDER_CONFIGS[provider].authUrl;
  if (provider === 'microsoft') {
    authUrl = authUrl.replace('{tenant}', config.oauth.microsoft.tenantId);
  }

  const params = new URLSearchParams({
    client_id: providerConfig.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state: stateToken,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  // Log event
  await logIntegrationEvent(userId, provider, 'auth_started', { scopes });

  return {
    url: `${authUrl}?${params.toString()}`,
    stateToken,
  };
}

/**
 * Handle OAuth callback and exchange code for tokens
 */
export async function handleCallback(
  provider: OAuthProvider,
  code: string,
  stateToken: string
): Promise<{ userId: string; tokens: OAuthTokens; email?: string }> {
  // Verify state
  const stateResult = await pool.query(
    `SELECT id, user_id, code_verifier, scopes, redirect_uri, expires_at
     FROM oauth_states
     WHERE state_token = $1 AND provider = $2`,
    [stateToken, provider]
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
  const scopes = state.scopes;

  // Delete used state
  await pool.query('DELETE FROM oauth_states WHERE id = $1', [state.id]);

  // Exchange code for tokens
  const providerConfig = provider === 'google' ? config.oauth.google : config.oauth.microsoft;
  let tokenUrl = PROVIDER_CONFIGS[provider].tokenUrl;
  if (provider === 'microsoft') {
    tokenUrl = tokenUrl.replace('{tenant}', config.oauth.microsoft.tenantId);
  }

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: providerConfig.clientId!,
      client_secret: providerConfig.clientSecret!,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    logger.error('Token exchange failed', { provider, error });
    throw new Error('Failed to exchange code for tokens');
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  const tokens: OAuthTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    scope: tokenData.scope,
  };

  // Get user email from provider
  const email = await getUserEmail(provider, tokens.accessToken);

  // Store connection
  await storeConnection(userId, provider, tokens, email, scopes);

  // Log event
  await logIntegrationEvent(userId, provider, 'auth_completed', { email, scopes });

  return { userId, tokens, email };
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(
  connectionId: string,
  connectionType: 'calendar' | 'email'
): Promise<OAuthTokens | null> {
  try {
    const table = connectionType === 'calendar' ? 'calendar_connections' : 'email_connections';
    const result = await pool.query(
      `SELECT id, user_id, provider, refresh_token_encrypted, encryption_key_id
       FROM ${table}
       WHERE id = $1 AND is_active = true`,
      [connectionId]
    );

    if (result.rows.length === 0) return null;

    const { user_id: userId, provider, refresh_token_encrypted: encryptedRefresh } = result.rows[0];

    if (!encryptedRefresh) {
      logger.warn('No refresh token available', { connectionId });
      return null;
    }

    const refreshToken = decryptToken(encryptedRefresh);
    const providerConfig = provider === 'google' ? config.oauth.google : config.oauth.microsoft;

    let tokenUrl = PROVIDER_CONFIGS[provider as OAuthProvider].tokenUrl;
    if (provider === 'microsoft') {
      tokenUrl = tokenUrl.replace('{tenant}', config.oauth.microsoft.tenantId);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: providerConfig.clientId!,
        client_secret: providerConfig.clientSecret!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      logger.error('Token refresh failed', { provider, status: response.status });
      return null;
    }

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const tokens: OAuthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    };

    // Update stored tokens
    await pool.query(
      `UPDATE ${table}
       SET access_token_encrypted = $2,
           refresh_token_encrypted = $3,
           token_expires_at = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [
        connectionId,
        encryptToken(tokens.accessToken),
        encryptToken(tokens.refreshToken || refreshToken),
        tokens.expiresAt,
      ]
    );

    await logIntegrationEvent(userId, provider, 'token_refreshed', {});

    return tokens;
  } catch (error) {
    logger.error('Failed to refresh token', {
      error: (error as Error).message,
      connectionId
    });
    return null;
  }
}

/**
 * Revoke access and delete connection
 */
export async function revokeAccess(
  userId: string,
  provider: OAuthProvider
): Promise<void> {
  try {
    // Delete calendar connection
    await pool.query(
      `DELETE FROM calendar_connections WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );

    // Delete email connection
    await pool.query(
      `DELETE FROM email_connections WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );

    await logIntegrationEvent(userId, provider, 'access_revoked', {});
    logger.info('Revoked OAuth access', { userId, provider });
  } catch (error) {
    logger.error('Failed to revoke access', {
      error: (error as Error).message,
      userId, provider
    });
    throw error;
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get user email from provider
 */
async function getUserEmail(provider: OAuthProvider, accessToken: string): Promise<string | undefined> {
  try {
    let url: string;
    if (provider === 'google') {
      url = 'https://www.googleapis.com/oauth2/v2/userinfo';
    } else {
      url = 'https://graph.microsoft.com/v1.0/me';
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return undefined;

    const data = await response.json() as { email?: string; mail?: string; userPrincipalName?: string };
    return data.email || data.mail || data.userPrincipalName;
  } catch {
    return undefined;
  }
}

/**
 * Store OAuth connection
 */
async function storeConnection(
  userId: string,
  provider: OAuthProvider,
  tokens: OAuthTokens,
  email: string | undefined,
  scopes: string[]
): Promise<void> {
  const encryptedAccess = encryptToken(tokens.accessToken);
  const encryptedRefresh = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;

  // Check which services are authorized
  const hasCalendar = scopes.some(s =>
    s.includes('calendar') || s.includes('Calendar')
  );
  const hasEmail = scopes.some(s =>
    s.includes('gmail') || s.includes('Mail')
  );

  if (hasCalendar) {
    await pool.query(
      `INSERT INTO calendar_connections
        (user_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at, calendar_id, is_active)
       VALUES ($1, $2, $3, $4, $5, 'primary', true)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, calendar_connections.refresh_token_encrypted),
         token_expires_at = EXCLUDED.token_expires_at,
         is_active = true,
         updated_at = NOW()`,
      [userId, provider, encryptedAccess, encryptedRefresh, tokens.expiresAt]
    );
  }

  if (hasEmail && email) {
    await pool.query(
      `INSERT INTO email_connections
        (user_id, provider, email_address, access_token_encrypted, refresh_token_encrypted, token_expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         email_address = EXCLUDED.email_address,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, email_connections.refresh_token_encrypted),
         token_expires_at = EXCLUDED.token_expires_at,
         is_active = true,
         updated_at = NOW()`,
      [userId, provider, email, encryptedAccess, encryptedRefresh, tokens.expiresAt]
    );
  }
}

/**
 * Log integration event
 */
async function logIntegrationEvent(
  userId: string,
  provider: string,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO integration_events (user_id, provider, event_type, event_data)
       VALUES ($1, $2, $3, $4)`,
      [userId, provider, eventType, JSON.stringify(eventData)]
    );
  } catch (error) {
    logger.error('Failed to log integration event', {
      error: (error as Error).message
    });
  }
}

/**
 * Get integration status for a user
 */
export async function getIntegrationStatus(userId: string): Promise<ConnectionStatus[]> {
  const statuses: ConnectionStatus[] = [];

  try {
    // Check Google
    if (config.oauth.google.enabled) {
      const calResult = await pool.query(
        `SELECT is_active, last_sync_at FROM calendar_connections
         WHERE user_id = $1 AND provider = 'google'`,
        [userId]
      );
      const emailResult = await pool.query(
        `SELECT email_address, is_active, last_sync_at FROM email_connections
         WHERE user_id = $1 AND provider = 'google'`,
        [userId]
      );

      const connected = (calResult.rows[0]?.is_active || emailResult.rows[0]?.is_active) || false;
      statuses.push({
        provider: 'google',
        connected,
        email: emailResult.rows[0]?.email_address,
        lastSyncAt: calResult.rows[0]?.last_sync_at || emailResult.rows[0]?.last_sync_at,
      });
    }

    // Check Microsoft
    if (config.oauth.microsoft.enabled) {
      const calResult = await pool.query(
        `SELECT is_active, last_sync_at FROM calendar_connections
         WHERE user_id = $1 AND provider = 'microsoft'`,
        [userId]
      );
      const emailResult = await pool.query(
        `SELECT email_address, is_active, last_sync_at FROM email_connections
         WHERE user_id = $1 AND provider = 'microsoft'`,
        [userId]
      );

      const connected = (calResult.rows[0]?.is_active || emailResult.rows[0]?.is_active) || false;
      statuses.push({
        provider: 'microsoft',
        connected,
        email: emailResult.rows[0]?.email_address,
        lastSyncAt: calResult.rows[0]?.last_sync_at || emailResult.rows[0]?.last_sync_at,
      });
    }
  } catch (error) {
    logger.error('Failed to get integration status', {
      error: (error as Error).message,
      userId
    });
  }

  return statuses;
}

/**
 * Get valid access token (refreshing if needed)
 */
export async function getValidAccessToken(
  connectionId: string,
  connectionType: 'calendar' | 'email'
): Promise<string | null> {
  try {
    const table = connectionType === 'calendar' ? 'calendar_connections' : 'email_connections';
    const result = await pool.query(
      `SELECT access_token_encrypted, token_expires_at
       FROM ${table}
       WHERE id = $1 AND is_active = true`,
      [connectionId]
    );

    if (result.rows.length === 0) return null;

    const { access_token_encrypted: encrypted, token_expires_at: expiresAt } = result.rows[0];

    // Check if token is expired or about to expire (5 min buffer)
    const bufferTime = 5 * 60 * 1000;
    if (new Date(expiresAt).getTime() - bufferTime < Date.now()) {
      const refreshed = await refreshAccessToken(connectionId, connectionType);
      return refreshed?.accessToken || null;
    }

    return decryptToken(encrypted);
  } catch (error) {
    logger.error('Failed to get valid access token', {
      error: (error as Error).message,
      connectionId
    });
    return null;
  }
}

export default {
  generateAuthUrl,
  handleCallback,
  refreshAccessToken,
  revokeAccess,
  getIntegrationStatus,
  getValidAccessToken,
};
