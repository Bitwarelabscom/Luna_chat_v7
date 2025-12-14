/**
 * Activity Routes
 *
 * API endpoints for activity log retrieval and management.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as activityService from './activity.service.js';
import logger from '../utils/logger.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const GetRecentQuerySchema = z.object({
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
  category: z.enum(['llm_call', 'tool_invoke', 'memory_op', 'state_event', 'error', 'background', 'system']).optional(),
  level: z.enum(['info', 'success', 'warn', 'error']).optional(),
  after: z.string().optional().transform(v => v ? new Date(v) : undefined),
});

const GetArchiveQuerySchema = z.object({
  startDate: z.string().optional().transform(v => v ? new Date(v) : undefined),
  endDate: z.string().optional().transform(v => v ? new Date(v) : undefined),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 100),
});

// ============================================
// Routes
// ============================================

/**
 * GET /api/activity
 * Get recent activity for the current user
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = GetRecentQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
    }

    const { limit, category, level, after } = parsed.data;

    const logs = await activityService.getRecentActivity(req.user!.userId, {
      limit,
      category: category as activityService.ActivityCategory,
      level: level as activityService.ActivityLevel,
      after,
    });

    return res.json({ logs });
  } catch (error) {
    logger.error('Failed to get recent activity', { error: (error as Error).message });
    return res.status(500).json({ error: 'Failed to get activity' });
  }
});

/**
 * GET /api/activity/session/:sessionId
 * Get activity for a specific session
 */
router.get('/session/:sessionId', authenticate, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    const logs = await activityService.getSessionActivity(sessionId, limit);

    return res.json({ logs });
  } catch (error) {
    logger.error('Failed to get session activity', { error: (error as Error).message });
    return res.status(500).json({ error: 'Failed to get session activity' });
  }
});

/**
 * GET /api/activity/archive
 * Get archived activity
 */
router.get('/archive', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = GetArchiveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
    }

    const { startDate, endDate, limit } = parsed.data;

    const logs = await activityService.getArchivedActivity(req.user!.userId, {
      startDate,
      endDate,
      limit,
    });

    return res.json({ logs });
  } catch (error) {
    logger.error('Failed to get archived activity', { error: (error as Error).message });
    return res.status(500).json({ error: 'Failed to get archived activity' });
  }
});

/**
 * DELETE /api/activity
 * Clear user's activity logs
 */
router.delete('/', authenticate, async (req: Request, res: Response) => {
  try {
    await activityService.clearUserLogs(req.user!.userId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to clear activity logs', { error: (error as Error).message });
    return res.status(500).json({ error: 'Failed to clear activity logs' });
  }
});

/**
 * POST /api/activity/archive-now
 * Manually trigger archival (admin only, for testing)
 */
router.post('/archive-now', authenticate, async (req: Request, res: Response) => {
  try {
    const daysToKeep = req.body.daysToKeep || 7;
    const archivedCount = await activityService.archiveOldLogs(daysToKeep);
    return res.json({ success: true, archivedCount });
  } catch (error) {
    logger.error('Failed to archive activity logs', { error: (error as Error).message });
    return res.status(500).json({ error: 'Failed to archive activity logs' });
  }
});

export default router;
