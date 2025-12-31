import { Router, Request, Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as memorycoreClient from '../memory/memorycore.client.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/consciousness/metrics
 * Get current consciousness metrics for the authenticated user
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) {
      res.json({ metrics: null });
      return;
    }

    const metrics = await memorycoreClient.getConsciousnessMetrics(userId);
    res.json({ metrics });
  } catch (error) {
    logger.error('Failed to get consciousness metrics', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get consciousness metrics' });
  }
});

/**
 * GET /api/consciousness/history
 * Get historical consciousness metrics for research tracking
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 100;
    const since = req.query.since as string | undefined;

    if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) {
      res.json({ history: [] });
      return;
    }

    const options: { limit: number; since?: Date } = { limit };
    if (since) {
      options.since = new Date(since);
    }

    const history = await memorycoreClient.getConsciousnessHistory(userId, options);
    res.json({ history });
  } catch (error) {
    logger.error('Failed to get consciousness history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get consciousness history' });
  }
});

/**
 * POST /api/consciousness/analyze
 * Trigger consciousness analysis for the authenticated user
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) {
      res.status(400).json({ error: 'Consciousness analysis is not enabled' });
      return;
    }

    const metrics = await memorycoreClient.triggerConsciousnessAnalysis(userId);

    if (!metrics) {
      res.status(500).json({ error: 'Analysis failed' });
      return;
    }

    res.json({ metrics });
  } catch (error) {
    logger.error('Failed to trigger consciousness analysis', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to trigger analysis' });
  }
});

/**
 * GET /api/consciousness/health
 * Check health of consciousness services (MemoryCore + NeuralSleep)
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    if (!config.memorycore.enabled) {
      res.json({
        healthy: false,
        neuralsleep: false,
        message: 'MemoryCore is not enabled',
      });
      return;
    }

    const memorycoreHealthy = await memorycoreClient.healthCheck();

    // For now, we assume NeuralSleep health is tied to MemoryCore
    // MemoryCore checks NeuralSleep health internally
    res.json({
      healthy: memorycoreHealthy,
      neuralsleep: memorycoreHealthy && config.memorycore.consciousnessEnabled,
    });
  } catch (error) {
    logger.error('Failed to check consciousness health', { error: (error as Error).message });
    res.json({
      healthy: false,
      neuralsleep: false,
      message: 'Health check failed',
    });
  }
});

/**
 * GET /api/consolidation/logs
 * Get consolidation event logs
 * Note: This proxies to MemoryCore's consolidation logs endpoint
 * Route is mounted at /api/consolidation, so this handles /api/consolidation/logs
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!config.memorycore.enabled) {
      res.json({ logs: [] });
      return;
    }

    // Fetch consolidation logs from MemoryCore
    const response = await fetch(
      `${config.memorycore.url}/api/consolidation/logs/${userId}?limit=${limit}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        res.json({ logs: [] });
        return;
      }
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as { logs: Array<{
      id: number;
      consolidationType: string;
      timestamp: string;
      status: string;
      eventsProcessed?: number;
      patternsExtracted?: number;
      errorDetails?: string;
    }> };

    // Transform to match frontend ConsolidationEvent interface
    const transformedLogs = (data.logs || []).map(log => ({
      id: String(log.id),
      userId,
      consolidationType: log.consolidationType,
      status: log.status,
      startedAt: log.timestamp,
      episodicEventsProcessed: log.eventsProcessed,
      patternsExtracted: log.patternsExtracted,
      error: log.errorDetails,
    }));

    res.json({ logs: transformedLogs });
  } catch (error) {
    logger.error('Failed to get consolidation logs', { error: (error as Error).message });
    res.json({ logs: [] });
  }
});

export default router;
