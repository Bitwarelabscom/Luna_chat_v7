import { Request, Response, NextFunction } from 'express';
import { isIPBanned, getBanTimeRemaining } from './fail2ban.service.js';
import logger from '../utils/logger.js';

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
 * Fail2ban Middleware
 * Checks if the client IP is banned before processing requests
 */
export async function fail2banMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Always allow health checks
  if (req.path === '/api/health') {
    return next();
  }

  const clientIP = getClientIP(req);

  try {
    const banned = await isIPBanned(clientIP);

    if (banned) {
      const timeRemaining = await getBanTimeRemaining(clientIP);
      const days = Math.ceil(timeRemaining / 86400);

      logger.warn('Blocked request from banned IP', {
        ip: clientIP,
        path: req.path,
        method: req.method,
        banExpiresIn: `${days} days`
      });

      res.status(403).json({
        error: 'Access denied',
        message: `Your IP has been banned due to too many failed login attempts. Ban expires in ${days} day(s).`
      });
      return;
    }

    next();
  } catch (error) {
    // On database error, allow the request but log the error
    logger.error('Fail2ban middleware error', {
      error: (error as Error).message,
      ip: clientIP
    });
    next();
  }
}

export default fail2banMiddleware;
