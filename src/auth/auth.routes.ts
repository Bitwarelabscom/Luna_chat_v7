import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as authService from './auth.service.js';
import { authenticate } from './auth.middleware.js';
import logger from '../utils/logger.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// Registration disabled - users are created manually

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data.email, data.password);

    res.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        settings: result.user.settings,
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
      res.status(401).json({ error: message });
      return;
    }

    logger.error('Login failed', { error: message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const data = refreshSchema.parse(req.body);
    const tokens = await authService.refreshTokens(data.refreshToken);

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
    res.json({ success: true });
  } catch (error) {
    logger.error('Logout failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Logout failed' });
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

export default router;
