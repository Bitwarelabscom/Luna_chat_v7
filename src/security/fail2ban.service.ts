import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// Configuration
const MAX_FAILED_ATTEMPTS = 5;  // Ban after this many failed attempts
const BAN_DURATION_DAYS = 7;    // Ban duration in days
const WHITELISTED_IPS = ['94.234.64.182'];  // IPs that are never banned
const WHITELISTED_PREFIXES = ['10.0.0.', '127.0.0.'];  // IP prefixes that are never banned

function isWhitelisted(ip: string): boolean {
  if (WHITELISTED_IPS.includes(ip)) return true;
  return WHITELISTED_PREFIXES.some(prefix => ip.startsWith(prefix));
}

export interface IPBanStatus {
  ip: string;
  failedAttempts: number;
  bannedUntil: Date | null;
  isBanned: boolean;
}

/**
 * Get the ban status for an IP
 */
export async function getBanStatus(ip: string): Promise<IPBanStatus | null> {
  try {
    const result = await pool.query(
      `SELECT ip, failed_attempts, banned_until, last_attempt
       FROM ip_bans
       WHERE ip = $1`,
      [ip]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const bannedUntil = row.banned_until ? new Date(row.banned_until) : null;
    const isBanned = bannedUntil ? bannedUntil > new Date() : false;

    return {
      ip: row.ip,
      failedAttempts: row.failed_attempts,
      bannedUntil,
      isBanned
    };
  } catch (error) {
    logger.error('Failed to get ban status', { error: (error as Error).message, ip });
    return null;
  }
}

/**
 * Check if an IP is currently banned
 */
export async function isIPBanned(ip: string): Promise<boolean> {
  if (isWhitelisted(ip)) return false;
  const status = await getBanStatus(ip);
  return status?.isBanned ?? false;
}

/**
 * Record a failed login attempt
 * Returns true if the IP is now banned
 */
export async function recordFailedAttempt(ip: string): Promise<boolean> {
  // Skip whitelisted IPs
  if (isWhitelisted(ip)) {
    logger.debug('Skipping fail2ban for whitelisted IP', { ip });
    return false;
  }

  try {
    // Get current status
    const status = await getBanStatus(ip);

    // If already banned, extend the ban
    if (status?.isBanned) {
      logger.warn('Attempted login from banned IP', { ip });
      return true;
    }

    const newAttempts = (status?.failedAttempts ?? 0) + 1;
    const shouldBan = newAttempts >= MAX_FAILED_ATTEMPTS;
    const bannedUntil = shouldBan
      ? new Date(Date.now() + BAN_DURATION_DAYS * 24 * 60 * 60 * 1000)
      : null;

    // Upsert the record
    await pool.query(
      `INSERT INTO ip_bans (ip, failed_attempts, banned_until, last_attempt)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (ip) DO UPDATE SET
         failed_attempts = $2,
         banned_until = $3,
         last_attempt = NOW()`,
      [ip, newAttempts, bannedUntil]
    );

    if (shouldBan) {
      logger.warn('IP banned due to failed login attempts', {
        ip,
        attempts: newAttempts,
        bannedUntil: bannedUntil?.toISOString()
      });
    } else {
      logger.info('Failed login attempt recorded', {
        ip,
        attempts: newAttempts,
        maxAttempts: MAX_FAILED_ATTEMPTS
      });
    }

    return shouldBan;
  } catch (error) {
    logger.error('Failed to record failed attempt', { error: (error as Error).message, ip });
    return false;
  }
}

/**
 * Clear failed attempts for an IP (on successful login)
 */
export async function clearAttempts(ip: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM ip_bans WHERE ip = $1`,
      [ip]
    );
    logger.debug('Cleared failed attempts for IP', { ip });
  } catch (error) {
    logger.error('Failed to clear attempts', { error: (error as Error).message, ip });
  }
}

/**
 * Unban an IP manually
 */
export async function unbanIP(ip: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM ip_bans WHERE ip = $1 RETURNING ip`,
      [ip]
    );

    if (result.rows.length > 0) {
      logger.info('IP manually unbanned', { ip });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to unban IP', { error: (error as Error).message, ip });
    return false;
  }
}

/**
 * Get all currently banned IPs
 */
export async function getBannedIPs(): Promise<IPBanStatus[]> {
  try {
    const result = await pool.query(
      `SELECT ip, failed_attempts, banned_until
       FROM ip_bans
       WHERE banned_until > NOW()
       ORDER BY banned_until DESC`
    );

    return result.rows.map(row => ({
      ip: row.ip,
      failedAttempts: row.failed_attempts,
      bannedUntil: new Date(row.banned_until),
      isBanned: true
    }));
  } catch (error) {
    logger.error('Failed to get banned IPs', { error: (error as Error).message });
    return [];
  }
}

/**
 * Get time remaining on ban (in seconds)
 */
export async function getBanTimeRemaining(ip: string): Promise<number> {
  const status = await getBanStatus(ip);
  if (!status?.isBanned || !status.bannedUntil) return 0;

  return Math.max(0, Math.floor((status.bannedUntil.getTime() - Date.now()) / 1000));
}

export default {
  getBanStatus,
  isIPBanned,
  recordFailedAttempt,
  clearAttempts,
  unbanIP,
  getBannedIPs,
  getBanTimeRemaining
};
