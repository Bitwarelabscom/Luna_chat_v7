import { Router, Request, Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as graphService from './memorycore-graph.service.js';
import * as factsService from './facts.service.js';
import * as memorycoreClient from './memorycore.client.js';
import { config } from '../config/index.js';
import { query } from '../db/postgres.js';
import redis from '../db/redis.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ==============================
// Graph endpoints
// ==============================

/**
 * GET /api/memory-lab/graph/overview
 * Summary stats and top nodes by centrality
 */
router.get('/graph/overview', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const overview = await graphService.getGraphOverview(userId);
    res.json(overview);
  } catch (error) {
    logger.error('Failed to get graph overview', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get graph overview' });
  }
});

/**
 * GET /api/memory-lab/graph/nodes
 * Query params: limit, offset, type, search, sortBy, minEdgeCount
 */
router.get('/graph/nodes', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const nodes = await graphService.getGraphNodes(userId, {
      limit: parseInt(req.query.limit as string) || 100,
      offset: parseInt(req.query.offset as string) || 0,
      type: req.query.type as string | undefined,
      search: req.query.search as string | undefined,
      sortBy: req.query.sortBy as string | undefined,
      minEdgeCount: req.query.minEdgeCount ? parseInt(req.query.minEdgeCount as string) : undefined,
    });
    res.json({ nodes });
  } catch (error) {
    logger.error('Failed to get graph nodes', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get graph nodes' });
  }
});

/**
 * GET /api/memory-lab/graph/edges
 * Query params: nodeIds (comma-sep), type, minStrength
 */
router.get('/graph/edges', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const nodeIdsStr = req.query.nodeIds as string | undefined;
    const nodeIds = nodeIdsStr ? nodeIdsStr.split(',').filter(Boolean) : undefined;

    const edges = await graphService.getGraphEdges(userId, {
      nodeIds,
      type: req.query.type as string | undefined,
      minStrength: req.query.minStrength ? parseFloat(req.query.minStrength as string) : undefined,
    });
    res.json({ edges });
  } catch (error) {
    logger.error('Failed to get graph edges', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get graph edges' });
  }
});

/**
 * GET /api/memory-lab/graph/nodes/:nodeId/neighbors
 * Query params: depth, limit
 */
router.get('/graph/nodes/:nodeId/neighbors', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { nodeId } = req.params;
    const result = await graphService.getNodeNeighbors(nodeId, userId, {
      depth: parseInt(req.query.depth as string) || 1,
      limit: parseInt(req.query.limit as string) || 30,
    });
    res.json(result);
  } catch (error) {
    logger.error('Failed to get node neighbors', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get node neighbors' });
  }
});

/**
 * PATCH /api/memory-lab/graph/nodes/:nodeId
 * Body: { label?, type?, metadata? }
 */
router.patch('/graph/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { nodeId } = req.params;
    const { label, type, metadata } = req.body;

    const node = await graphService.updateNode(nodeId, userId, { label, type, metadata });
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    res.json({ node });
  } catch (error) {
    logger.error('Failed to update node', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update node' });
  }
});

/**
 * DELETE /api/memory-lab/graph/nodes/:nodeId
 * Soft-delete (set is_active=false)
 */
router.delete('/graph/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { nodeId } = req.params;
    const success = await graphService.deleteNode(nodeId, userId);
    res.json({ success });
  } catch (error) {
    logger.error('Failed to delete node', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete node' });
  }
});

/**
 * POST /api/memory-lab/graph/edges
 * Body: { sourceId, targetId, type, strength? }
 */
router.post('/graph/edges', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { sourceId, targetId, type, strength } = req.body;

    if (!sourceId || !targetId || !type) {
      res.status(400).json({ error: 'sourceId, targetId, and type are required' });
      return;
    }

    const { sessionId } = req.body;
    const edge = await graphService.createEdge(userId, { sourceId, targetId, type, strength, sessionId });
    res.json({ edge });
  } catch (error) {
    logger.error('Failed to create edge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create edge' });
  }
});

/**
 * DELETE /api/memory-lab/graph/edges/:edgeId
 * Soft-delete
 */
router.delete('/graph/edges/:edgeId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { edgeId } = req.params;
    const success = await graphService.deleteEdge(edgeId, userId);
    res.json({ success });
  } catch (error) {
    logger.error('Failed to delete edge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete edge' });
  }
});

/**
 * POST /api/memory-lab/graph/merge
 * Body: { sourceId, targetId, reason? }
 */
router.post('/graph/merge', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { sourceId, targetId, reason } = req.body;

    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'sourceId and targetId are required' });
      return;
    }

    const survivor = await graphService.mergeNodes(userId, sourceId, targetId, reason);
    res.json({ node: survivor });
  } catch (error) {
    logger.error('Failed to merge nodes', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to merge nodes' });
  }
});

/**
 * POST /api/memory-lab/graph/split/:mergeId
 * Unmerge via merge_ledger
 */
router.post('/graph/split/:mergeId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { mergeId } = req.params;
    const nodes = await graphService.splitNode(userId, mergeId);
    res.json({ nodes });
  } catch (error) {
    logger.error('Failed to split node', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to split node' });
  }
});

/**
 * GET /api/memory-lab/graph/merge-candidates
 * Query params: minActivation, limit
 */
router.get('/graph/merge-candidates', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const candidates = await graphService.analyzeMergeCandidates(userId, {
      minActivation: parseInt(req.query.minActivation as string) || 2,
      limit: parseInt(req.query.limit as string) || 50,
    });
    res.json({ candidates });
  } catch (error) {
    logger.error('Failed to get merge candidates', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get merge candidates' });
  }
});

/**
 * POST /api/memory-lab/graph/purge-noise
 * Trigger noise cleanup for the authenticated user
 */
router.post('/graph/purge-noise', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await graphService.purgeNoiseNodes(userId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to purge noise nodes', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to purge noise nodes' });
  }
});

// ==============================
// Facts endpoints
// ==============================

/**
 * GET /api/memory-lab/facts
 * Query params: category, limit
 */
router.get('/facts', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const facts = await factsService.getUserFacts(userId, {
      category: req.query.category as string | undefined,
      limit: parseInt(req.query.limit as string) || 100,
    });
    res.json({ facts });
  } catch (error) {
    logger.error('Failed to get facts', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get facts' });
  }
});

/**
 * POST /api/memory-lab/facts
 * Body: { category, factKey, factValue, confidence? }
 */
router.post('/facts', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { category, factKey, factValue, confidence } = req.body;

    if (!category || !factKey || !factValue) {
      res.status(400).json({ error: 'category, factKey, and factValue are required' });
      return;
    }

    await factsService.storeFact(userId, {
      category,
      factKey,
      factValue,
      confidence: confidence ?? 1.0,
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to create fact', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create fact' });
  }
});

/**
 * PATCH /api/memory-lab/facts/:factId
 * Body: { factValue, reason? }
 */
router.patch('/facts/:factId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { factId } = req.params;
    const { factValue, reason } = req.body;

    if (!factValue) {
      res.status(400).json({ error: 'factValue is required' });
      return;
    }

    const result = await factsService.updateFact(userId, factId, factValue, reason);
    res.json(result);
  } catch (error) {
    logger.error('Failed to update fact', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update fact' });
  }
});

/**
 * DELETE /api/memory-lab/facts/:factId
 * Body: { reason? }
 */
router.delete('/facts/:factId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { factId } = req.params;
    const { reason } = req.body || {};

    const result = await factsService.deleteFact(userId, factId, reason);
    res.json(result);
  } catch (error) {
    logger.error('Failed to delete fact', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete fact' });
  }
});

/**
 * GET /api/memory-lab/facts/search
 * Query params: q
 */
router.get('/facts/search', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const searchTerm = req.query.q as string;

    if (!searchTerm) {
      res.status(400).json({ error: 'q parameter is required' });
      return;
    }

    const facts = await factsService.searchFacts(userId, searchTerm);
    res.json({ facts });
  } catch (error) {
    logger.error('Failed to search facts', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search facts' });
  }
});

/**
 * GET /api/memory-lab/facts/history
 * Query params: limit, offset
 */
router.get('/facts/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const history = await factsService.getFactCorrectionHistory(userId, {
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
    });
    res.json({ history });
  } catch (error) {
    logger.error('Failed to get fact history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get fact history' });
  }
});

// ==============================
// Consciousness endpoints (proxy existing)
// ==============================

router.get('/consciousness/metrics', async (req: Request, res: Response) => {
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

router.get('/consciousness/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 100;
    if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) {
      res.json({ history: [] });
      return;
    }
    const history = await memorycoreClient.getConsciousnessHistory(userId, { limit });
    res.json({ history });
  } catch (error) {
    logger.error('Failed to get consciousness history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get consciousness history' });
  }
});

router.post('/consciousness/analyze', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    if (!config.memorycore.enabled || !config.memorycore.consciousnessEnabled) {
      res.status(400).json({ error: 'Consciousness analysis is not enabled' });
      return;
    }
    const metrics = await memorycoreClient.triggerConsciousnessAnalysis(userId);
    res.json({ metrics });
  } catch (error) {
    logger.error('Failed to trigger analysis', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to trigger analysis' });
  }
});

router.get('/consciousness/health', async (_req: Request, res: Response) => {
  try {
    if (!config.memorycore.enabled) {
      res.json({ healthy: false, neuralsleep: false });
      return;
    }
    const healthy = await memorycoreClient.healthCheck();
    res.json({
      healthy,
      neuralsleep: healthy && config.memorycore.consciousnessEnabled,
    });
  } catch (error) {
    logger.error('Failed to check consciousness health', { error: (error as Error).message });
    res.json({ healthy: false, neuralsleep: false });
  }
});

router.get('/consolidation/logs', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!config.memorycore.enabled) {
      res.json({ logs: [] });
      return;
    }

    const response = await fetch(
      `${config.memorycore.url}/api/consolidation/logs/${userId}?limit=${limit}`,
      { method: 'GET', headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      res.json({ logs: [] });
      return;
    }

    const data = await response.json() as { logs: Array<Record<string, unknown>> };
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

// ==============================
// LNN Live endpoints
// ==============================

/**
 * GET /api/memory-lab/lnn/emotional-trajectory
 * Recent emotional valence data from message_embeddings
 */
router.get('/lnn/emotional-trajectory', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 100;

    const rows = await query<{
      created_at: Date;
      emotional_valence: string;
      attention_score: string;
    }>(
      `SELECT created_at, emotional_valence, attention_score
       FROM message_embeddings
       WHERE user_id = $1 AND emotional_valence IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    const trajectory = rows.reverse().map(row => ({
      timestamp: row.created_at.toISOString(),
      valence: parseFloat(row.emotional_valence),
      attentionScore: parseFloat(row.attention_score || '0'),
    }));

    res.json({ trajectory });
  } catch (error) {
    logger.error('Failed to get emotional trajectory', { error: (error as Error).message });
    res.json({ trajectory: [] });
  }
});

/**
 * GET /api/memory-lab/lnn/centroid-drift
 * Compute cosine drift between successive message embeddings
 */
router.get('/lnn/centroid-drift', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 50;

    // Get successive embeddings and compute cosine distance
    const rows = await query<{
      created_at: Date;
      drift: string;
    }>(
      `WITH ordered AS (
        SELECT created_at, embedding,
               LAG(embedding) OVER (ORDER BY created_at) as prev_embedding
        FROM message_embeddings
        WHERE user_id = $1 AND embedding IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $2
      )
      SELECT created_at,
             CASE
               WHEN prev_embedding IS NOT NULL
               THEN 1.0 - (embedding <=> prev_embedding)
               ELSE 0
             END as drift
      FROM ordered
      WHERE prev_embedding IS NOT NULL
      ORDER BY created_at ASC`,
      [userId, limit]
    );

    const driftData = rows.map(row => ({
      timestamp: row.created_at.toISOString(),
      drift: parseFloat(row.drift),
    }));

    res.json({ drift: driftData });
  } catch (error) {
    logger.error('Failed to get centroid drift', { error: (error as Error).message });
    res.json({ drift: [] });
  }
});

/**
 * GET /api/memory-lab/lnn/session-enrichment
 * Latest attention/valence/centroid from Redis
 */
router.get('/lnn/session-enrichment', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get latest session activity data from Redis
    let enrichment: Record<string, unknown> = {};
    try {
            const keys = await redis.keys(`session:activity:*`);
      const data: Array<{ sessionId: string; lastActivity: string }> = [];

      for (const key of keys.slice(0, 10)) {
        const val = await redis.get(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.userId === userId) {
              data.push({ sessionId: key.replace('session:activity:', ''), lastActivity: parsed.lastActivity || val });
            }
          } catch {
            data.push({ sessionId: key.replace('session:activity:', ''), lastActivity: val });
          }
        }
      }

      enrichment = { sessions: data };
    } catch {
      enrichment = { sessions: [] };
    }

    res.json(enrichment);
  } catch (error) {
    logger.error('Failed to get session enrichment', { error: (error as Error).message });
    res.json({ sessions: [] });
  }
});

export default router;
