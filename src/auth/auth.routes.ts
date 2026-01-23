import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import * as authService from './auth.service.js';
import { authenticate } from './auth.middleware.js';
import { generateWsToken } from './jwt.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import type { AuthTokens } from '../types/index.js';
import * as fail2banService from '../security/fail2ban.service.js';

const router = Router();

// SECURITY: Rate limit login attempts to prevent brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  handler: (req, res) => {
    logger.warn('Login rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many login attempts, please try again later' });
  },
});

// SECURITY: Rate limit token refresh attempts
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 attempts per minute
  message: { error: 'Too many refresh attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const isProd = config.nodeEnv === 'production';

// Check if request is from local/WireGuard network (HTTP access)
function isLocalRequest(req: Request): boolean {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  return origin.includes('://luna:') ||
         origin.includes('10.0.0.') ||
         origin.includes('localhost') ||
         origin.includes('127.0.0.1') ||
         host.includes('10.0.0.') ||
         host.includes('localhost');
}

function getAccessCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd && !isLocalRequest(req),
    path: '/',
  };
}

function getRefreshCookieOptions(req: Request) {
  return {
    ...getAccessCookieOptions(req),
    // Align cookie lifetime with refresh token lifetime (default 30d)
    maxAge: (() => {
    const match = (config.jwt.refreshExpiresIn as string).match(/^(\d+)([smhd])$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  })(),
  };
}

function setAuthCookies(req: Request, res: Response, tokens: AuthTokens) {
  const accessOpts = getAccessCookieOptions(req);
  const refreshOpts = getRefreshCookieOptions(req);
  res.cookie('accessToken', tokens.accessToken, {
    ...accessOpts,
    maxAge: tokens.expiresIn * 1000,
  });
  res.cookie('refreshToken', tokens.refreshToken, refreshOpts);
}

function clearAuthCookies(req: Request, res: Response) {
  const accessOpts = getAccessCookieOptions(req);
  const refreshOpts = getRefreshCookieOptions(req);
  res.clearCookie('accessToken', accessOpts);
  res.clearCookie('refreshToken', refreshOpts);
}

function getCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1] || '') : undefined;
}

// Registration disabled - users are created manually

// Helper to get client IP
function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    return ips[0].trim();
  }
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const clientIP = getClientIP(req);

  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data.email, data.password);

    // SECURITY: Clear fail2ban attempts on successful login
    await fail2banService.clearAttempts(clientIP);

    setAuthCookies(req, res, result.tokens);

    res.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        avatarUrl: result.user.avatarUrl,
        settings: result.user.settings,
        createdAt: result.user.createdAt,
      },
      ...result.tokens,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }

    const message = (error as Error).message;
    if (message === 'Invalid credentials') {
      // SECURITY: Record failed login attempt for fail2ban
      const wasBanned = await fail2banService.recordFailedAttempt(clientIP);
      if (wasBanned) {
        res.status(403).json({
          error: 'Access denied',
          message: 'Your IP has been banned due to too many failed login attempts.'
        });
        return;
      }
      res.status(401).json({ error: message });
      return;
    }

    logger.error('Login failed', { error: message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', refreshLimiter, async (req: Request, res: Response) => {
  try {
    const cookieRefresh = getCookie(req, 'refreshToken');
    const bodyRefresh = (() => {
      try {
        return refreshSchema.parse(req.body).refreshToken;
      } catch {
        return undefined;
      }
    })();

    const refreshToken = cookieRefresh || bodyRefresh;
    if (!refreshToken) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    const tokens = await authService.refreshTokens(refreshToken);

    setAuthCookies(req, res, tokens);

    res.json(tokens);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }

    logger.debug('Token refresh failed', { error: (error as Error).message });
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    await authService.logout(req.user!.userId);
    clearAuthCookies(req, res);
    res.json({ success: true });
  } catch (error) {
    logger.error('Logout failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Logout failed' });
  }
});

// POST /api/auth/auto-login - Passwordless login for trusted local network devices
// SECURITY: Only works from 10.0.0.x network (enforced by nginx, verified here)
router.post('/auto-login', async (req: Request, res: Response) => {
  try {
    const clientIP = getClientIP(req);

    // SECURITY: Only allow from local network
    if (!clientIP.startsWith('10.0.0.') && clientIP !== '127.0.0.1') {
      logger.warn('Auto-login attempt from unauthorized IP', { ip: clientIP });
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Get the first (and likely only) user for auto-login
    const user = await authService.getFirstUser();
    if (!user) {
      res.status(404).json({ error: 'No user found' });
      return;
    }

    const tokens = await authService.generateTokensForUser(user.id);

    logger.info('Auto-login successful', { userId: user.id, ip: clientIP });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        settings: user.settings,
        createdAt: user.createdAt,
      },
      ...tokens,
    });
  } catch (error) {
    logger.error('Auto-login failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Auto-login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await authService.getUserById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      settings: user.settings,
      createdAt: user.createdAt,
    });
  } catch (error) {
    logger.error('Get user failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/ws-token - Get short-lived WebSocket token
router.post('/ws-token', authenticate, (req: Request, res: Response) => {
  const wsToken = generateWsToken(req.user!.userId);
  res.json({ token: wsToken });
});

export default router;
