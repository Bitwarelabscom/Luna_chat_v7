import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { encryptToken, decryptToken, isEncryptionAvailable } from '../utils/encryption.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

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
  reminderMinutes?: number | null;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  isAllDay?: boolean;
  reminderMinutes?: number | null;
}


/**
 * Generate iCal VEVENT string
 */
function generateICalEvent(event: CreateEventInput & { uid: string }): string {
  const formatDate = (date: Date, allDay: boolean): string => {
    if (allDay) {
      return date.toISOString().slice(0, 10).replace(/-/g, '');
    }
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const now = new Date();
  const dtStart = formatDate(event.startAt, !!event.isAllDay);
  const dtEnd = formatDate(event.endAt, !!event.isAllDay);
  const dtstamp = formatDate(now, false);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Luna Chat//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
  ];

  if (event.isAllDay) {
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
  } else {
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
  }

  lines.push(`SUMMARY:${escapeICalText(event.title)}`);

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICalText(event.location)}`);
  }

  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Escape text for iCal format
 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Parse iCal VEVENT from string
 */
function parseICalEvent(icalString: string): Partial<CalendarEvent> | null {
  try {
    const lines = icalString.split(/\r?\n/);
    const event: Partial<CalendarEvent> = {};

    for (const line of lines) {
      if (line.startsWith('UID:')) {
        event.externalId = line.substring(4);
      } else if (line.startsWith('SUMMARY:')) {
        event.title = unescapeICalText(line.substring(8));
      } else if (line.startsWith('DESCRIPTION:')) {
        event.description = unescapeICalText(line.substring(12));
      } else if (line.startsWith('LOCATION:')) {
        event.location = unescapeICalText(line.substring(9));
      } else if (line.startsWith('DTSTART')) {
        const { date, allDay } = parseICalDate(line);
        event.startAt = date;
        event.isAllDay = allDay;
      } else if (line.startsWith('DTEND')) {
        const { date } = parseICalDate(line);
        event.endAt = date;
      }
    }

    return event.externalId ? event : null;
  } catch (error) {
    logger.error('Failed to parse iCal event', { error: (error as Error).message });
    return null;
  }
}

/**
 * Unescape iCal text
 */
function unescapeICalText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse iCal date string
 */
function parseICalDate(line: string): { date: Date; allDay: boolean } {
  const allDay = line.includes('VALUE=DATE:');
  const match = line.match(/(\d{8}T?\d{0,6}Z?)/);

  if (!match) {
    return { date: new Date(), allDay: false };
  }

  const dateStr = match[1];

  if (allDay || dateStr.length === 8) {
    // Date only: YYYYMMDD
    const year = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6)) - 1;
    const day = parseInt(dateStr.slice(6, 8));
    return { date: new Date(year, month, day), allDay: true };
  } else {
    // DateTime: YYYYMMDDTHHMMSSZ
    const year = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6)) - 1;
    const day = parseInt(dateStr.slice(6, 8));
    const hour = parseInt(dateStr.slice(9, 11)) || 0;
    const minute = parseInt(dateStr.slice(11, 13)) || 0;
    const second = parseInt(dateStr.slice(13, 15)) || 0;

    if (dateStr.endsWith('Z')) {
      return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), allDay: false };
    }
    return { date: new Date(year, month, day, hour, minute, second), allDay: false };
  }
}


/**
 * Get or create user calendar in Radicale
 */
async function ensureUserCalendar(userId: string): Promise<string> {
  const calendarPath = `${userId}/calendar`;
  const radicaleUrl = config.radicale.url;

  try {
    // Check if calendar exists
    const checkResponse = await fetch(`${radicaleUrl}/${calendarPath}/`, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype />
  </d:prop>
</d:propfind>`,
    });

    if (checkResponse.status === 404) {
      // Create user principal first
      await fetch(`${radicaleUrl}/${userId}/`, {
        method: 'MKCOL',
      });

      // Create the calendar
      const mkcalResponse = await fetch(`${radicaleUrl}/${calendarPath}/`, {
        method: 'MKCALENDAR',
        headers: {
          'Content-Type': 'application/xml',
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>Calendar</d:displayname>
      <c:calendar-description>User calendar</c:calendar-description>
    </d:prop>
  </d:set>
</c:mkcalendar>`,
      });

      if (!mkcalResponse.ok && mkcalResponse.status !== 201) {
        logger.warn('MKCALENDAR returned non-success status', { status: mkcalResponse.status, userId });
      }

      logger.info('Created user calendar in Radicale', { userId });
    }

    return calendarPath;
  } catch (error) {
    logger.error('Failed to ensure user calendar exists', { error: (error as Error).message, userId });
    return calendarPath;
  }
}

/**
 * Create a calendar event in Radicale
 */
export async function createEvent(
  userId: string,
  input: CreateEventInput
): Promise<CalendarEvent> {
  if (!config.radicale.enabled) {
    throw new Error('Radicale calendar is not enabled');
  }

  const calendarPath = await ensureUserCalendar(userId);
  const radicaleUrl = config.radicale.url;
  const uid = `${uuidv4()}@luna-chat`;
  const eventPath = `${calendarPath}/${uid}.ics`;

  const icalData = generateICalEvent({ ...input, uid });

  try {
    const response = await fetch(`${radicaleUrl}/${eventPath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
      },
      body: icalData,
    });

    if (!response.ok && response.status !== 201) {
      throw new Error(`Failed to create event: ${response.status}`);
    }

    const event: CalendarEvent = {
      id: uid,
      externalId: uid,
      title: input.title,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location,
      isAllDay: input.isAllDay || false,
      reminderMinutes: input.reminderMinutes ?? null,
    };

    // Also cache in database for fast querying
    await cacheEventInDb(userId, event);

    logger.info('Created calendar event', { userId, eventId: uid });
    return event;
  } catch (error) {
    logger.error('Failed to create calendar event', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Update a calendar event in Radicale
 */
export async function updateEvent(
  userId: string,
  eventId: string,
  input: Partial<CreateEventInput>
): Promise<CalendarEvent> {
  if (!config.radicale.enabled) {
    throw new Error('Radicale calendar is not enabled');
  }

  // First get the existing event
  const existing = await getEvent(userId, eventId);
  if (!existing) {
    throw new Error('Event not found');
  }

  const calendarPath = await ensureUserCalendar(userId);
  const radicaleUrl = config.radicale.url;
  const eventPath = `${calendarPath}/${eventId}.ics`;

  const updatedEvent = {
    title: input.title || existing.title,
    description: input.description !== undefined ? input.description : existing.description,
    startAt: input.startAt || existing.startAt,
    endAt: input.endAt || existing.endAt,
    location: input.location !== undefined ? input.location : existing.location,
    isAllDay: input.isAllDay !== undefined ? input.isAllDay : existing.isAllDay,
    reminderMinutes: input.reminderMinutes !== undefined ? input.reminderMinutes : existing.reminderMinutes,
    uid: eventId,
  };

  const icalData = generateICalEvent(updatedEvent);

  try {
    const response = await fetch(`${radicaleUrl}/${eventPath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
      },
      body: icalData,
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`Failed to update event: ${response.status}`);
    }

    const event: CalendarEvent = {
      id: eventId,
      externalId: eventId,
      ...updatedEvent,
    };

    // Update cache in database
    await cacheEventInDb(userId, event);

    logger.info('Updated calendar event', { userId, eventId });
    return event;
  } catch (error) {
    logger.error('Failed to update calendar event', { error: (error as Error).message, userId, eventId });
    throw error;
  }
}

/**
 * Delete a calendar event from Radicale
 */
export async function deleteEvent(userId: string, eventId: string): Promise<boolean> {
  if (!config.radicale.enabled) {
    throw new Error('Radicale calendar is not enabled');
  }

  const calendarPath = await ensureUserCalendar(userId);
  const radicaleUrl = config.radicale.url;
  const eventPath = `${calendarPath}/${eventId}.ics`;

  try {
    const response = await fetch(`${radicaleUrl}/${eventPath}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 204 && response.status !== 404) {
      throw new Error(`Failed to delete event: ${response.status}`);
    }

    // Remove from database cache
    await removeEventFromDb(userId, eventId);

    logger.info('Deleted calendar event', { userId, eventId });
    return true;
  } catch (error) {
    logger.error('Failed to delete calendar event', { error: (error as Error).message, userId, eventId });
    throw error;
  }
}

/**
 * Get a single event by ID
 */
export async function getEvent(userId: string, eventId: string): Promise<CalendarEvent | null> {
  if (!config.radicale.enabled) {
    return null;
  }

  const calendarPath = await ensureUserCalendar(userId);
  const radicaleUrl = config.radicale.url;
  const eventPath = `${calendarPath}/${eventId}.ics`;

  try {
    const response = await fetch(`${radicaleUrl}/${eventPath}`, {
      method: 'GET',
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get event: ${response.status}`);
    }

    const icalData = await response.text();
    const parsed = parseICalEvent(icalData);

    if (!parsed) {
      return null;
    }

    return {
      id: eventId,
      externalId: parsed.externalId || eventId,
      title: parsed.title || 'Untitled',
      description: parsed.description,
      startAt: parsed.startAt || new Date(),
      endAt: parsed.endAt || new Date(),
      location: parsed.location,
      isAllDay: parsed.isAllDay || false,
    };
  } catch (error) {
    logger.error('Failed to get calendar event', { error: (error as Error).message, userId, eventId });
    return null;
  }
}

/**
 * Get all events from Radicale calendar within a date range
 */
export async function getEventsFromRadicale(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  if (!config.radicale.enabled) {
    return [];
  }

  const calendarPath = await ensureUserCalendar(userId);
  const radicaleUrl = config.radicale.url;

  const formatICalDate = (date: Date): string => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  try {
    const response = await fetch(`${radicaleUrl}/${calendarPath}/`, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '1',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${formatICalDate(startDate)}" end="${formatICalDate(endDate)}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to query events: ${response.status}`);
    }

    const xmlText = await response.text();
    const events: CalendarEvent[] = [];

    // Simple regex-based parsing of the response
    const calendarDataMatches = xmlText.matchAll(/<c:calendar-data[^>]*>([\s\S]*?)<\/c:calendar-data>/g);

    for (const match of calendarDataMatches) {
      const icalData = match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');

      const parsed = parseICalEvent(icalData);
      if (parsed && parsed.externalId) {
        events.push({
          id: parsed.externalId,
          externalId: parsed.externalId,
          title: parsed.title || 'Untitled',
          description: parsed.description,
          startAt: parsed.startAt || new Date(),
          endAt: parsed.endAt || new Date(),
          location: parsed.location,
          isAllDay: parsed.isAllDay || false,
        });
      }
    }

    return events.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  } catch (error) {
    logger.error('Failed to get events from Radicale', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Cache event in database for fast querying
 */
async function cacheEventInDb(userId: string, event: CalendarEvent): Promise<void> {
  try {
    // Get or create internal caldav connection
    let connResult = await pool.query(
      `SELECT id FROM calendar_connections
       WHERE user_id = $1 AND provider = 'caldav' AND calendar_id = 'internal'`,
      [userId]
    );

    let connectionId: string;

    if (connResult.rows.length === 0) {
      const insertResult = await pool.query(
        `INSERT INTO calendar_connections (user_id, provider, calendar_id, is_active)
         VALUES ($1, 'caldav', 'internal', true)
         RETURNING id`,
        [userId]
      );
      connectionId = insertResult.rows[0].id;
    } else {
      connectionId = connResult.rows[0].id;
    }

    await pool.query(
      `INSERT INTO calendar_events_cache (connection_id, external_id, title, description, start_at, end_at, location, is_all_day, reminder_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (connection_id, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         start_at = EXCLUDED.start_at,
         end_at = EXCLUDED.end_at,
         location = EXCLUDED.location,
         is_all_day = EXCLUDED.is_all_day,
         reminder_minutes = EXCLUDED.reminder_minutes,
         synced_at = NOW()`,
      [connectionId, event.externalId, event.title, event.description, event.startAt, event.endAt, event.location, event.isAllDay, event.reminderMinutes ?? null]
    );
  } catch (error) {
    logger.error('Failed to cache event in database', { error: (error as Error).message });
  }
}

/**
 * Remove event from database cache
 */
async function removeEventFromDb(userId: string, eventId: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM calendar_events_cache
       WHERE external_id = $1
       AND connection_id IN (
         SELECT id FROM calendar_connections WHERE user_id = $2
       )`,
      [eventId, userId]
    );
  } catch (error) {
    logger.error('Failed to remove event from database', { error: (error as Error).message });
  }
}

/**
 * Sync events from Radicale to database cache
 */
export async function syncFromRadicale(userId: string): Promise<number> {
  if (!config.radicale.enabled) {
    return 0;
  }

  const now = new Date();
  const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year ahead

  try {
    const events = await getEventsFromRadicale(userId, startDate, endDate);

    for (const event of events) {
      await cacheEventInDb(userId, event);
    }

    logger.info('Synced events from Radicale', { userId, count: events.length });
    return events.length;
  } catch (error) {
    logger.error('Failed to sync from Radicale', { error: (error as Error).message, userId });
    return 0;
  }
}

/**
 * Store OAuth connection with encrypted tokens (for external providers)
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

  // First try to sync from Radicale if enabled
  if (config.radicale.enabled) {
    await syncFromRadicale(userId).catch(() => {});
  }

  try {
    const result = await pool.query(
      `SELECT ce.id, ce.external_id, ce.title, ce.description, ce.start_at, ce.end_at, ce.location, ce.is_all_day, ce.attendees, ce.reminder_minutes
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
      reminderMinutes: row.reminder_minutes as number | null,
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
  // First try to sync from Radicale if enabled
  if (config.radicale.enabled) {
    await syncFromRadicale(userId).catch(() => {});
  }

  try {
    const result = await pool.query(
      `SELECT ce.id, ce.external_id, ce.title, ce.description, ce.start_at, ce.end_at, ce.location, ce.is_all_day, ce.attendees, ce.reminder_minutes
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
      reminderMinutes: row.reminder_minutes as number | null,
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
      `SELECT provider, access_token, refresh_token, token_expires_at, calendar_id
       FROM calendar_connections
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );

    if (connResult.rows.length === 0) {
      throw new Error('Calendar connection not found');
    }

    const conn = connResult.rows[0];

    // If it's the internal caldav connection, sync from Radicale
    if (conn.provider === 'caldav' && conn.calendar_id === 'internal') {
      return await syncFromRadicale(userId);
    }

    // SECURITY: Decrypt OAuth tokens before use
    let accessToken = conn.access_token as string;
    let refreshToken = conn.refresh_token as string;

    if (isEncryptionAvailable() && accessToken && accessToken.includes(':')) {
      try {
        accessToken = decryptToken(accessToken);
        refreshToken = decryptToken(refreshToken);
      } catch (err) {
        logger.error('Failed to decrypt OAuth tokens', { error: (err as Error).message, connectionId });
        throw new Error('Token decryption failed');
      }
    }

    // TODO: Implement actual API calls based on provider using decrypted tokens

    // For now, just update last sync time
    await pool.query(
      `UPDATE calendar_connections SET last_sync_at = NOW() WHERE id = $1`,
      [connectionId]
    );

    logger.info('Calendar sync completed', { userId, connectionId, provider: conn.provider });
    return 0;
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

    // Use 24h format (sv-SE locale)
    const timeStr = start.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    let dateStr = '';
    if (isToday) {
      dateStr = `Today ${timeStr}`;
    } else if (isTomorrow) {
      dateStr = `Tomorrow ${timeStr}`;
    } else {
      const dayStr = start.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
      dateStr = `${dayStr} ${timeStr}`;
    }

    let entry = `- ${event.title} - ${dateStr}`;
    if (event.location) entry += ` @ ${event.location}`;
    return entry;
  }).join('\n');

  return `[Upcoming Calendar]\n${formatted}`;
}

/**
 * Get calendar status for displaying in UI
 */
export async function getCalendarStatus(userId: string): Promise<{
  enabled: boolean;
  connected: boolean;
  eventCount: number;
  lastSync: Date | null;
}> {
  const enabled = config.radicale.enabled;

  if (!enabled) {
    return { enabled: false, connected: false, eventCount: 0, lastSync: null };
  }

  // Check if Radicale is reachable
  let connected = false;
  try {
    const response = await fetch(`${config.radicale.url}/.well-known/caldav`);
    connected = response.ok || response.status === 301 || response.status === 302;
  } catch {
    connected = false;
  }

  // Get event count and last sync from the internal caldav connection
  try {
    const result = await pool.query(
      `SELECT
        cc.last_sync_at,
        COUNT(ce.id) as event_count
       FROM calendar_connections cc
       LEFT JOIN calendar_events_cache ce ON ce.connection_id = cc.id
       WHERE cc.user_id = $1 AND cc.provider = 'caldav' AND cc.calendar_id = 'internal'
       GROUP BY cc.id`,
      [userId]
    );

    if (result.rows.length > 0) {
      return {
        enabled,
        connected,
        eventCount: parseInt(result.rows[0].event_count, 10) || 0,
        lastSync: result.rows[0].last_sync_at || null,
      };
    }
  } catch (error) {
    logger.error('Failed to get calendar status', { error: (error as Error).message, userId });
  }

  return { enabled, connected, eventCount: 0, lastSync: null };
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
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  getEventsFromRadicale,
  syncFromRadicale,
  storeCalendarConnection,
  getCalendarConnections,
  getUpcomingEvents,
  getTodayEvents,
  syncCalendarEvents,
  cacheEvents,
  disconnectCalendar,
  formatCalendarForPrompt,
  getCalendarStatus,
};
