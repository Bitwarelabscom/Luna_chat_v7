import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { encryptToken, decryptToken, isEncryptionAvailable } from '../utils/encryption.js';

export interface CalendarConnection {
  id: string;
  provider: 'google' | 'outlook' | 'caldav';
  calendarId?: string;
  isActive: boolean;
  lastSyncAt?: Date;
  createdAt: Date;
}

export interface CalendarEvent {
  id: string;
  externalId: string;
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  isAllDay: boolean;
  attendees?: Array<{ email: string; name?: string; status?: string }>;
}

/**
 * Store OAuth connection with encrypted tokens
 */
export async function storeCalendarConnection(
  userId: string,
  provider: 'google' | 'outlook' | 'caldav',
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    calendarId?: string;
  }
): Promise<CalendarConnection> {
  try {
    // SECURITY: Encrypt OAuth tokens before storing in database
    let accessTokenToStore = tokens.accessToken;
    let refreshTokenToStore = tokens.refreshToken;

    if (isEncryptionAvailable()) {
      accessTokenToStore = encryptToken(tokens.accessToken);
      refreshTokenToStore = encryptToken(tokens.refreshToken);
      logger.debug('OAuth tokens encrypted for storage', { userId, provider });
    } else {
      logger.warn('Encryption key not configured - storing OAuth tokens unencrypted', { userId, provider });
    }

    const result = await pool.query(
      `INSERT INTO calendar_connections (user_id, provider, access_token, refresh_token, token_expires_at, calendar_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         calendar_id = EXCLUDED.calendar_id,
         is_active = true,
         updated_at = NOW()
       RETURNING id, provider, calendar_id, is_active, last_sync_at, created_at`,
      [userId, provider, accessTokenToStore, refreshTokenToStore, tokens.expiresAt, tokens.calendarId]
    );

    logger.info('Stored calendar connection', { userId, provider });
    return mapRowToConnection(result.rows[0]);
  } catch (error) {
    logger.error('Failed to store calendar connection', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Get calendar connections for a user
 */
export async function getCalendarConnections(userId: string): Promise<CalendarConnection[]> {
  try {
    const result = await pool.query(
      `SELECT id, provider, calendar_id, is_active, last_sync_at, created_at
       FROM calendar_connections
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    return result.rows.map(mapRowToConnection);
  } catch (error) {
    logger.error('Failed to get calendar connections', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get upcoming events (from cache)
 */
export async function getUpcomingEvents(
  userId: string,
  options: { days?: number; limit?: number } = {}
): Promise<CalendarEvent[]> {
  const { days = 7, limit = 20 } = options;

  try {
    const result = await pool.query(
      `SELECT ce.id, ce.external_id, ce.title, ce.description, ce.start_at, ce.end_at, ce.location, ce.is_all_day, ce.attendees
       FROM calendar_events_cache ce
       JOIN calendar_connections cc ON cc.id = ce.connection_id
       WHERE cc.user_id = $1 AND cc.is_active = true
         AND ce.start_at BETWEEN NOW() AND NOW() + INTERVAL '${days} days'
       ORDER BY ce.start_at
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      externalId: row.external_id as string,
      title: row.title as string,
      description: row.description as string | undefined,
      startAt: row.start_at as Date,
      endAt: row.end_at as Date,
      location: row.location as string | undefined,
      isAllDay: row.is_all_day as boolean,
      attendees: row.attendees as CalendarEvent['attendees'],
    }));
  } catch (error) {
    logger.error('Failed to get upcoming events', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get today's events
 */
export async function getTodayEvents(userId: string): Promise<CalendarEvent[]> {
  try {
    const result = await pool.query(
      `SELECT ce.id, ce.external_id, ce.title, ce.description, ce.start_at, ce.end_at, ce.location, ce.is_all_day, ce.attendees
       FROM calendar_events_cache ce
       JOIN calendar_connections cc ON cc.id = ce.connection_id
       WHERE cc.user_id = $1 AND cc.is_active = true
         AND DATE(ce.start_at) = CURRENT_DATE
       ORDER BY ce.start_at`,
      [userId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      externalId: row.external_id as string,
      title: row.title as string,
      description: row.description as string | undefined,
      startAt: row.start_at as Date,
      endAt: row.end_at as Date,
      location: row.location as string | undefined,
      isAllDay: row.is_all_day as boolean,
      attendees: row.attendees as CalendarEvent['attendees'],
    }));
  } catch (error) {
    logger.error('Failed to get today events', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Sync events from provider (placeholder - needs actual API integration)
 */
export async function syncCalendarEvents(
  userId: string,
  connectionId: string
): Promise<number> {
  try {
    // Get connection details
    const connResult = await pool.query(
      `SELECT provider, access_token, refresh_token, token_expires_at
       FROM calendar_connections
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );

    if (connResult.rows.length === 0) {
      throw new Error('Calendar connection not found');
    }

    const conn = connResult.rows[0];

    // SECURITY: Decrypt OAuth tokens before use
    let accessToken = conn.access_token as string;
    let refreshToken = conn.refresh_token as string;

    if (isEncryptionAvailable() && accessToken.includes(':')) {
      // Token appears to be encrypted (contains colon separators)
      try {
        accessToken = decryptToken(accessToken);
        refreshToken = decryptToken(refreshToken);
      } catch (err) {
        logger.error('Failed to decrypt OAuth tokens', { error: (err as Error).message, connectionId });
        throw new Error('Token decryption failed');
      }
    }

    // TODO: Implement actual API calls based on provider using decrypted tokens
    // accessToken and refreshToken are now available for API calls

    // For now, just update last sync time
    await pool.query(
      `UPDATE calendar_connections SET last_sync_at = NOW() WHERE id = $1`,
      [connectionId]
    );

    logger.info('Calendar sync completed', { userId, connectionId, provider: conn.provider });
    return 0; // Return number of events synced
  } catch (error) {
    logger.error('Failed to sync calendar', { error: (error as Error).message, userId, connectionId });
    throw error;
  }
}

/**
 * Cache events (called after fetching from provider)
 */
export async function cacheEvents(
  connectionId: string,
  events: Array<Omit<CalendarEvent, 'id'>>
): Promise<void> {
  try {
    for (const event of events) {
      await pool.query(
        `INSERT INTO calendar_events_cache (connection_id, external_id, title, description, start_at, end_at, location, is_all_day, attendees)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (connection_id, external_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           start_at = EXCLUDED.start_at,
           end_at = EXCLUDED.end_at,
           location = EXCLUDED.location,
           is_all_day = EXCLUDED.is_all_day,
           attendees = EXCLUDED.attendees,
           synced_at = NOW()`,
        [connectionId, event.externalId, event.title, event.description, event.startAt, event.endAt, event.location, event.isAllDay, JSON.stringify(event.attendees)]
      );
    }
  } catch (error) {
    logger.error('Failed to cache events', { error: (error as Error).message, connectionId });
    throw error;
  }
}

/**
 * Disconnect calendar
 */
export async function disconnectCalendar(userId: string, connectionId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE calendar_connections SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to disconnect calendar', { error: (error as Error).message, userId });
    return false;
  }
}

/**
 * Format calendar for prompt
 */
export function formatCalendarForPrompt(events: CalendarEvent[]): string {
  if (events.length === 0) return '';

  const now = new Date();
  const formatted = events.slice(0, 5).map(event => {
    const start = new Date(event.startAt);
    const isToday = start.toDateString() === now.toDateString();
    const isTomorrow = start.toDateString() === new Date(now.getTime() + 86400000).toDateString();

    let dateStr = '';
    if (isToday) {
      dateStr = `Today ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (isTomorrow) {
      dateStr = `Tomorrow ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else {
      dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    let entry = `• ${event.title} - ${dateStr}`;
    if (event.location) entry += ` @ ${event.location}`;
    return entry;
  }).join('\n');

  return `[Upcoming Calendar]\n${formatted}`;
}

function mapRowToConnection(row: Record<string, unknown>): CalendarConnection {
  return {
    id: row.id as string,
    provider: row.provider as 'google' | 'outlook' | 'caldav',
    calendarId: row.calendar_id as string | undefined,
    isActive: row.is_active as boolean,
    lastSyncAt: row.last_sync_at as Date | undefined,
    createdAt: row.created_at as Date,
  };
}

export default {
  storeCalendarConnection,
  getCalendarConnections,
  getUpcomingEvents,
  getTodayEvents,
  syncCalendarEvents,
  cacheEvents,
  disconnectCalendar,
  formatCalendarForPrompt,
};
