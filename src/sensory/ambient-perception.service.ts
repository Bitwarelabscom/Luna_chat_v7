/**
 * Ambient Perception Service - Luna's sensory grounding
 *
 * Aggregates "sensory" signals into a unified perception summary:
 * - System vitals (CPU, memory, disk)
 * - Desktop context (what the user has open)
 * - Time context (time of day, day of week, season)
 * - Docker container health
 * - Activity patterns (busy period? quiet night?)
 *
 * Redis-cached (60s TTL) to avoid per-message polling.
 */

import { config } from '../config/index.js';
import { getDesktopContext } from '../desktop/desktop.websocket.js';
import logger from '../utils/logger.js';

// In-memory cache (Redis would be used in production but this avoids dependency)
const perceptionCache = new Map<string, { summary: string; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Get time context: time of day, day of week, season.
 */
function getTimeContext(): string {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Stockholm' });
  const month = now.getMonth(); // 0-indexed

  // Time of day
  let timeOfDay: string;
  if (hour >= 5 && hour < 9) timeOfDay = 'early morning';
  else if (hour >= 9 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 14) timeOfDay = 'midday';
  else if (hour >= 14 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 20) timeOfDay = 'evening';
  else if (hour >= 20 && hour < 23) timeOfDay = 'late evening';
  else timeOfDay = 'night';

  // Season (Northern hemisphere, Sweden)
  let season: string;
  if (month >= 2 && month <= 4) season = 'spring';
  else if (month >= 5 && month <= 7) season = 'summer';
  else if (month >= 8 && month <= 10) season = 'autumn';
  else season = 'winter';

  return `${timeOfDay}, ${dayOfWeek}, ${season}`;
}

/**
 * Get system vitals from /proc (lightweight, no external deps).
 */
async function getSystemVitals(): Promise<string> {
  try {
    const os = await import('os');
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.round((1 - freeMem / totalMem) * 100);
    const load1m = loadAvg[0].toFixed(1);

    if (memUsage > 90) return `server under load (${memUsage}% RAM, load ${load1m})`;
    if (memUsage > 70) return `server moderately busy (${memUsage}% RAM)`;
    return 'server running smoothly';
  } catch {
    return 'server status unknown';
  }
}

/**
 * Detect activity patterns based on time and recent interaction.
 */
function getActivityPattern(hour: number, dayOfWeek: string): string {
  const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday';

  if (hour >= 0 && hour < 6) return 'quiet hours';
  if (hour >= 6 && hour < 9) return isWeekend ? 'relaxed weekend morning' : 'start of the workday';
  if (hour >= 9 && hour < 17) return isWeekend ? 'weekend' : 'work hours';
  if (hour >= 17 && hour < 21) return 'evening wind-down';
  return 'late night';
}

/**
 * Build the ambient perception context (~50 tokens).
 * Cached for 60 seconds to avoid per-message overhead.
 */
export async function buildAmbientContext(userId: string): Promise<string> {
  if (!config.lunaAffect?.enabled) return '';

  // Check cache
  const cached = perceptionCache.get(userId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.summary;
  }

  try {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Stockholm' });

    // Gather signals in parallel
    const [timeCtx, systemVitals, desktopCtx] = await Promise.all([
      Promise.resolve(getTimeContext()),
      getSystemVitals(),
      Promise.resolve(getDesktopContext(userId)),
    ]);

    const activityPattern = getActivityPattern(hour, dayOfWeek);

    // Build natural language summary
    const parts: string[] = [];

    // Time and activity
    parts.push(timeCtx);

    // System health (only mention if noteworthy)
    if (systemVitals !== 'server running smoothly') {
      parts.push(systemVitals);
    }

    // Desktop context (only if available)
    if (desktopCtx) {
      // Extract just the app name, not the full context
      const appMatch = desktopCtx.match(/active window: (.+?)(?:\n|$)/i);
      if (appMatch) {
        parts.push(`user is in ${appMatch[1]}`);
      }
    }

    // Activity pattern
    parts.push(activityPattern);

    const summary = `[Ambient Perception]\n${parts.join(', ')}`;

    // Cache
    if (perceptionCache.size >= 200) {
      const oldest = [...perceptionCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      if (oldest) perceptionCache.delete(oldest[0]);
    }
    perceptionCache.set(userId, { summary, cachedAt: Date.now() });

    return summary;
  } catch (error) {
    logger.debug('Ambient perception failed', { error: (error as Error).message });
    return '';
  }
}

export default { buildAmbientContext };
