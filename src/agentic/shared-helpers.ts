/**
 * Shared helper functions used across tool-executor.ts and orchestrator.ts.
 */

import logger from '../utils/logger.js';

/**
 * Convert a Date (whose h/m/s are in the user's local timezone)
 * to the equivalent UTC Date.
 */
export function convertLocalTimeToUTC(localDate: Date, timezone: string): Date {
  try {
    const year = localDate.getFullYear();
    const month = localDate.getMonth() + 1;
    const day = localDate.getDate();
    const hours = localDate.getHours();
    const minutes = localDate.getMinutes();

    const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    const utcDate = new Date(isoString + 'Z');
    const localizedString = utcDate.toLocaleString('en-US', { timeZone: timezone, hour12: false });
    const parsedBack = new Date(localizedString);

    const offset = parsedBack.getTime() - utcDate.getTime();
    return new Date(utcDate.getTime() - offset);
  } catch (error) {
    logger.warn('Failed to convert timezone, using local time as UTC', { error: (error as Error).message, timezone });
    return localDate;
  }
}
