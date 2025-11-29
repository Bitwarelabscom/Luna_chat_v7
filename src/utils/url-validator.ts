import { URL } from 'url';
import dns from 'dns/promises';
import logger from './logger.js';

// Private and reserved IP ranges that should be blocked
const BLOCKED_IP_PATTERNS = [
  /^127\./,                           // Loopback
  /^10\./,                            // Private Class A
  /^172\.(1[6-9]|2\d|3[01])\./,       // Private Class B
  /^192\.168\./,                      // Private Class C
  /^0\./,                             // Current network
  /^169\.254\./,                      // Link-local
  /^224\./,                           // Multicast
  /^240\./,                           // Reserved
  /^::1$/,                            // IPv6 loopback
  /^fc/,                              // IPv6 unique local
  /^fd/,                              // IPv6 unique local
  /^fe80/,                            // IPv6 link-local
  /^ff/,                              // IPv6 multicast
  /^localhost$/i,                     // localhost hostname
];

// Allowed schemes for external URLs
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/**
 * Check if an IP address is in a blocked range
 */
function isBlockedIP(ip: string): boolean {
  return BLOCKED_IP_PATTERNS.some(pattern => pattern.test(ip));
}

/**
 * Validate a URL for external API calls (SSRF protection)
 * @throws Error if URL is invalid or points to internal resources
 */
export async function validateExternalUrl(urlString: string, options: {
  allowHttp?: boolean;
  allowedHosts?: string[];
} = {}): Promise<void> {
  const { allowHttp = false, allowedHosts = [] } = options;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Check scheme
  if (!allowHttp && url.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`URL scheme "${url.protocol}" not allowed`);
  }

  // Check for IP address in hostname
  const hostname = url.hostname.toLowerCase();

  // Block direct IP addresses (except for specific allowed hosts)
  const isIPAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
  if (isIPAddress && !allowedHosts.includes(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new Error('URL points to blocked IP range');
    }
  }

  // Check hostname against blocked patterns
  if (isBlockedIP(hostname)) {
    throw new Error('URL hostname is blocked');
  }

  // Resolve hostname and check resolved IPs
  if (!isIPAddress) {
    try {
      const addresses = await dns.resolve(hostname);
      for (const addr of addresses) {
        if (isBlockedIP(addr)) {
          logger.warn('SSRF attempt blocked: URL resolves to blocked IP', { url: urlString, resolvedIP: addr });
          throw new Error('URL resolves to blocked IP range');
        }
      }
    } catch (err) {
      if ((err as Error).message.includes('blocked')) {
        throw err;
      }
      // DNS resolution failed - this could be a non-existent domain
      logger.warn('DNS resolution failed for URL', { url: urlString, error: (err as Error).message });
      throw new Error('Unable to resolve URL hostname');
    }
  }

  // Check port (block common internal service ports)
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const blockedPorts = ['22', '23', '25', '445', '3306', '5432', '6379', '27017'];
  if (blockedPorts.includes(port)) {
    throw new Error(`Port ${port} is not allowed for external requests`);
  }
}

/**
 * Validate and sanitize a URL for safe external requests
 * Returns the validated URL string or throws an error
 */
export async function sanitizeExternalUrl(urlString: string, options: {
  allowHttp?: boolean;
  allowedHosts?: string[];
} = {}): Promise<string> {
  await validateExternalUrl(urlString, options);

  // Parse and reconstruct URL to normalize it
  const url = new URL(urlString);
  return url.toString();
}

export default {
  validateExternalUrl,
  sanitizeExternalUrl,
};
