import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import logger from '../utils/logger.js';

// CIDR notation support
interface CIDRRange {
  network: bigint;
  mask: bigint;
  isIPv6: boolean;
}

let allowedIPs: Set<string> = new Set();
let allowedCIDRs: CIDRRange[] = [];
let lastLoadTime = 0;

const WHITELIST_FILE = process.env.IP_WHITELIST_FILE || '/run/secrets/allowed_ips';
const RELOAD_INTERVAL = 30000; // Check file every 30 seconds

/**
 * Parse an IP address to bigint for CIDR comparison
 */
function ipToBigInt(ip: string): { value: bigint; isIPv6: boolean } | null {
  // Handle IPv4
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let value = BigInt(0);
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) return null;
      value = (value << BigInt(8)) + BigInt(num);
    }
    return { value, isIPv6: false };
  }

  // Handle IPv6
  if (ip.includes(':')) {
    // Expand :: notation
    let expanded = ip;
    if (ip.includes('::')) {
      const parts = ip.split('::');
      const left = parts[0] ? parts[0].split(':') : [];
      const right = parts[1] ? parts[1].split(':') : [];
      const missing = 8 - left.length - right.length;
      const middle = Array(missing).fill('0');
      expanded = [...left, ...middle, ...right].join(':');
    }

    const parts = expanded.split(':');
    if (parts.length !== 8) return null;

    let value = BigInt(0);
    for (const part of parts) {
      const num = parseInt(part || '0', 16);
      if (isNaN(num) || num < 0 || num > 0xffff) return null;
      value = (value << BigInt(16)) + BigInt(num);
    }
    return { value, isIPv6: true };
  }

  return null;
}

/**
 * Parse CIDR notation (e.g., 192.168.1.0/24)
 */
function parseCIDR(cidr: string): CIDRRange | null {
  const [ip, prefixStr] = cidr.split('/');
  if (!ip || !prefixStr) return null;

  const parsed = ipToBigInt(ip);
  if (!parsed) return null;

  const prefix = parseInt(prefixStr, 10);
  const maxBits = parsed.isIPv6 ? 128 : 32;

  if (isNaN(prefix) || prefix < 0 || prefix > maxBits) return null;

  // Create mask
  const mask = prefix === 0 ? BigInt(0) : (BigInt(-1) << BigInt(maxBits - prefix)) & ((BigInt(1) << BigInt(maxBits)) - BigInt(1));
  const network = parsed.value & mask;

  return { network, mask, isIPv6: parsed.isIPv6 };
}

/**
 * Check if an IP matches a CIDR range
 */
function ipMatchesCIDR(ip: string, cidr: CIDRRange): boolean {
  const parsed = ipToBigInt(ip);
  if (!parsed || parsed.isIPv6 !== cidr.isIPv6) return false;

  return (parsed.value & cidr.mask) === cidr.network;
}

/**
 * Load allowed IPs from config file
 */
function loadAllowedIPs(): void {
  try {
    if (!fs.existsSync(WHITELIST_FILE)) {
      logger.warn('IP whitelist file not found, allowing all IPs', { file: WHITELIST_FILE });
      allowedIPs = new Set(['*']);
      allowedCIDRs = [];
      return;
    }

    const content = fs.readFileSync(WHITELIST_FILE, 'utf-8');
    const newIPs = new Set<string>();
    const newCIDRs: CIDRRange[] = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Check for CIDR notation
      if (trimmed.includes('/')) {
        const cidr = parseCIDR(trimmed);
        if (cidr) {
          newCIDRs.push(cidr);
        } else {
          logger.warn('Invalid CIDR in whitelist', { cidr: trimmed });
        }
      } else {
        // Single IP
        newIPs.add(trimmed);
      }
    }

    allowedIPs = newIPs;
    allowedCIDRs = newCIDRs;
    lastLoadTime = Date.now();

    logger.info('IP whitelist loaded', {
      ips: allowedIPs.size,
      cidrs: allowedCIDRs.length
    });
  } catch (error) {
    logger.error('Failed to load IP whitelist', { error: (error as Error).message });
  }
}

/**
 * Check if an IP is allowed
 */
function isIPAllowed(ip: string): boolean {
  // Allow all if wildcard
  if (allowedIPs.has('*')) return true;

  // Normalize IP (handle IPv4-mapped IPv6)
  let normalizedIP = ip;
  if (ip.startsWith('::ffff:')) {
    normalizedIP = ip.substring(7);
  }

  // Direct match
  if (allowedIPs.has(normalizedIP)) return true;
  if (allowedIPs.has(ip)) return true;

  // CIDR match
  for (const cidr of allowedCIDRs) {
    if (ipMatchesCIDR(normalizedIP, cidr)) return true;
    if (normalizedIP !== ip && ipMatchesCIDR(ip, cidr)) return true;
  }

  return false;
}

/**
 * Get client IP from request (handles proxies)
 */
function getClientIP(req: Request): string {
  // X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    return ips[0].trim();
  }

  // X-Real-IP header (nginx)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  // Fallback to socket address
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * IP Whitelist Middleware
 * Blocks all requests from non-whitelisted IPs
 */
export function ipWhitelistMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Reload whitelist periodically
  if (Date.now() - lastLoadTime > RELOAD_INTERVAL) {
    loadAllowedIPs();
  }

  // Always allow health checks (needed for Docker health checks from internal network)
  if (req.path === '/api/health') {
    return next();
  }

  const clientIP = getClientIP(req);

  if (isIPAllowed(clientIP)) {
    return next();
  }

  logger.warn('Blocked request from non-whitelisted IP', {
    ip: clientIP,
    path: req.path,
    method: req.method
  });

  res.status(403).json({ error: 'Access denied' });
}

// Initial load
loadAllowedIPs();

export default ipWhitelistMiddleware;
