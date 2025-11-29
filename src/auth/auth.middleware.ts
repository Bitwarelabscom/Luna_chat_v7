import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';
import logger from '../utils/logger.js';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
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
