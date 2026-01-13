import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';
import logger from '../utils/logger.js';

// Auto-auth user for WireGuard network (10.0.0.x)
const WIREGUARD_USER = {
  userId: '727e0045-3858-4e42-b81e-4d48d980a59d',
  email: 'henke@bitwarelabs.com',
  type: 'access' as const
};

function isWireGuardRequest(req: Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || '';
  // Also check X-Forwarded-For for requests through proxies
  const forwardedFor = req.headers['x-forwarded-for'];
  const originalIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : '';

  // Trust WireGuard (10.0.0.x) and Docker internal network (172.x.x.x for frontend proxy)
  const isTrusted = (addr: string) =>
    addr.startsWith('10.0.0.') || addr.includes('10.0.0.') ||
    addr.startsWith('172.') || addr.includes('172.');
  return isTrusted(ip) || isTrusted(originalIp);
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Auto-authenticate WireGuard requests
  if (isWireGuardRequest(req)) {
    req.user = WIREGUARD_USER;
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  // Prefer Authorization header, but fall back to httpOnly cookie
  const headerToken = (() => {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
    return parts[1];
  })();

  const cookieHeader = req.headers.cookie || '';
  const cookieToken = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('accessToken='))
    ?.split('=')[1] || null;

  const token = headerToken || cookieToken;

  try {
    if (!token) {
      res.status(401).json({ error: 'No authorization provided' });
      return;
    }

    const payload = verifyToken(token);

    if (payload.type !== 'access') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    req.user = payload;
    next();
  } catch (error) {
    logger.debug('Token verification failed', { error: (error as Error).message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  // Auto-authenticate WireGuard requests
  if (isWireGuardRequest(req)) {
    req.user = WIREGUARD_USER;
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  const headerToken = (() => {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
    return parts[1];
  })();

  const cookieHeader = req.headers.cookie || '';
  const cookieToken = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('accessToken='))
    ?.split('=')[1] || null;

  const token = headerToken || cookieToken;

  try {
    if (!token) {
      next();
      return;
    }

    const payload = verifyToken(token);
    if (payload.type === 'access') {
      req.user = payload;
    }
  } catch {
    // Token invalid, continue without auth
  }

  next();
}
