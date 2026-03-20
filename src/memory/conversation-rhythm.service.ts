/**
 * Conversation Rhythm Service - In-memory message rhythm awareness
 *
 * Tracks recent message lengths per session to detect user energy/pace.
 * No database, no migration - bounded in-memory Map only.
 */

interface RhythmEntry {
  role: string;
  length: number;
}

const sessionRhythm = new Map<string, RhythmEntry[]>();
const MAX_SESSIONS = 200;
const MAX_ENTRIES_PER_SESSION = 10;

/**
 * Track a message for rhythm analysis.
 */
export function trackMessage(sessionId: string, role: string, contentLength: number): void {
  // Bound the map size
  if (!sessionRhythm.has(sessionId) && sessionRhythm.size >= MAX_SESSIONS) {
    const firstKey = sessionRhythm.keys().next().value;
    if (firstKey !== undefined) sessionRhythm.delete(firstKey);
  }

  const entries = sessionRhythm.get(sessionId) || [];
  entries.push({ role, length: contentLength });

  // Keep only recent entries
  if (entries.length > MAX_ENTRIES_PER_SESSION) {
    entries.splice(0, entries.length - MAX_ENTRIES_PER_SESSION);
  }

  sessionRhythm.set(sessionId, entries);
}

/**
 * Get a rhythm hint based on recent user message lengths.
 * Returns "brief", "detailed", or "" (no clear pattern).
 */
export function getRhythmHint(sessionId: string): string {
  const entries = sessionRhythm.get(sessionId);
  if (!entries) return '';

  // Look at last 5 user messages
  const userMessages = entries.filter(e => e.role === 'user').slice(-5);
  if (userMessages.length < 3) return '';

  const avgLength = userMessages.reduce((sum, m) => sum + m.length, 0) / userMessages.length;

  if (avgLength < 30) return 'brief';
  if (avgLength > 200) return 'detailed';
  return '';
}

/**
 * Clear rhythm data for a session.
 */
export function clearSession(sessionId: string): void {
  sessionRhythm.delete(sessionId);
}
