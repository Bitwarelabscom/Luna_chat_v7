import { Router, Request, Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as autonomousService from './autonomous.service.js';
import * as councilService from './council.service.js';
import * as goalsService from './goals.service.js';
import * as newsfetcherService from './newsfetcher.service.js';
import * as insightsService from './insights.service.js';
import * as questionsService from './questions.service.js';
import * as sessionWorkspaceService from './session-workspace.service.js';
import * as researchService from './research.service.js';
import * as friendService from './friend.service.js';
import * as friendVerificationService from './friend-verification.service.js';
import * as webfetchService from '../search/webfetch.service.js';
import { query } from '../db/postgres.js';
import { NEWS_CATEGORIES } from './news-filter.service.js';
import { syncAndEnrichNews } from './news-sync.service.js';
import * as newsAlertService from './news-alert.service.js';
import * as newsEnrichmentService from './news-enrichment.service.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================
// Status & Control
// ============================================

/**
 * GET /api/autonomous/status
 * Get autonomous mode status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const status = await autonomousService.getStatus(userId);

    res.json(status);
  } catch (error) {
    logger.error('Error getting autonomous status', { error });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * POST /api/autonomous/start
 * Start autonomous mode
 * Body:
 *   - taskDescription?: string - Optional task to work on
 *   - sessionMode?: 'standard' | 'expert_discussion' | 'research' - Session mode
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { taskDescription, sessionMode } = req.body as {
      taskDescription?: string;
      sessionMode?: 'standard' | 'expert_discussion' | 'research';
    };

    const session = await autonomousService.startSession(userId, {
      taskDescription,
      sessionMode,
    });

    res.json({ success: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start autonomous mode';
    logger.error('Error starting autonomous mode', { error });
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/autonomous/stop
 * Stop autonomous mode
 */
router.post('/stop', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const session = await autonomousService.stopSession(userId);

    res.json({ success: true, session });
  } catch (error) {
    logger.error('Error stopping autonomous mode', { error });
    res.status(500).json({ error: 'Failed to stop autonomous mode' });
  }
});

// ============================================
// Configuration
// ============================================

/**
 * GET /api/autonomous/config
 * Get autonomous configuration
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    let config = await autonomousService.getConfig(userId);

    // Create default config if none exists
    if (!config) {
      config = await autonomousService.createOrUpdateConfig(userId, {});
    }

    res.json({ config });
  } catch (error) {
    logger.error('Error getting autonomous config', { error });
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

/**
 * PUT /api/autonomous/config
 * Update autonomous configuration
 */
router.put('/config', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      enabled,
      autoStart,
      sessionIntervalMinutes,
      maxDailySessions,
      rssCheckIntervalMinutes,
      idleTimeoutMinutes,
    } = req.body;

    const config = await autonomousService.createOrUpdateConfig(userId, {
      enabled,
      autoStart,
      sessionIntervalMinutes,
      maxDailySessions,
      rssCheckIntervalMinutes,
      idleTimeoutMinutes,
    });

    res.json({ config });
  } catch (error) {
    logger.error('Error updating autonomous config', { error });
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// ============================================
// Sessions
// ============================================

/**
 * GET /api/autonomous/sessions
 * List autonomous sessions
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const sessions = await autonomousService.getSessions(userId, limit, offset);

    res.json({ sessions });
  } catch (error) {
    logger.error('Error getting sessions', { error });
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

/**
 * GET /api/autonomous/sessions/:id
 * Get session details
 */
router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.id;

    const session = await autonomousService.getSession(sessionId, userId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json(session);
  } catch (error) {
    logger.error('Error getting session', { error });
    return res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * GET /api/autonomous/sessions/:sessionId/deliberations
 * Get deliberations for a specific session
 */
router.get('/sessions/:sessionId/deliberations', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.sessionId;

    // Verify user owns this session
    const session = await autonomousService.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const deliberations = await councilService.getSessionDeliberations(sessionId);

    return res.json({ deliberations });
  } catch (error) {
    logger.error('Error getting session deliberations', { error });
    return res.status(500).json({ error: 'Failed to get session deliberations' });
  }
});

// ============================================
// Council
// ============================================

/**
 * GET /api/autonomous/council
 * List council members
 */
router.get('/council', async (_req: Request, res: Response) => {
  try {
    const members = await councilService.getCouncilMembers();

    res.json({ members });
  } catch (error) {
    logger.error('Error getting council members', { error });
    res.status(500).json({ error: 'Failed to get council members' });
  }
});

// ============================================
// Deliberations
// ============================================

/**
 * GET /api/autonomous/deliberations
 * List council deliberations
 */
router.get('/deliberations', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    const deliberations = await councilService.getDeliberations(userId, limit, offset);

    res.json({ deliberations });
  } catch (error) {
    logger.error('Error getting deliberations', { error });
    res.status(500).json({ error: 'Failed to get deliberations' });
  }
});

/**
 * GET /api/autonomous/deliberations/live
 * SSE endpoint for live deliberation streaming
 * NOTE: Must be defined BEFORE /deliberations/:id to avoid route conflict
 */
router.get('/deliberations/live', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Get current active session from DB
  const status = await autonomousService.getStatus(userId);
  const sessionId = status.currentSession?.id;

  if (!sessionId) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No active session' })}\n\n`);
    res.end();
    return;
  }

  // Start heartbeat immediately to keep connection alive
  const pingInterval = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })}\n\n`);
    } catch {
      // Connection closed, interval will be cleared in close handler
    }
  }, 30000);

  // Send connected message first
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Try to subscribe to live updates
  let unsubscribe = autonomousService.subscribeToSession(sessionId, (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Connection closed
    }
  });

  // Check if session is running in memory
  let isRunning = autonomousService.isSessionRunning(sessionId);

  if (!isRunning) {
    // Session may be initializing or was orphaned - load history first
    const deliberations = await councilService.getSessionDeliberations(sessionId);

    if (deliberations.length > 0) {
      const latest = deliberations[deliberations.length - 1];
      res.write(`data: ${JSON.stringify({
        type: 'history_load',
        deliberations,
        currentLoop: latest.loopNumber || 1
      })}\n\n`);
    }

    // Wait briefly and retry subscription (session may be initializing)
    await new Promise(r => setTimeout(r, 500));
    unsubscribe = autonomousService.subscribeToSession(sessionId, (data) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Connection closed
      }
    });

    // Check again
    isRunning = autonomousService.isSessionRunning(sessionId);
    if (!isRunning) {
      // Session truly not running - notify user but keep connection open for heartbeat
      res.write(`data: ${JSON.stringify({
        type: 'session_paused',
        message: 'Session was interrupted. Click Start to resume.'
      })}\n\n`);
    }
  }

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    unsubscribe();
  });
});

/**
 * GET /api/autonomous/deliberations/:id
 * Get deliberation details
 */
router.get('/deliberations/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const deliberationId = req.params.id;

    const deliberation = await councilService.getDeliberation(deliberationId, userId);

    if (!deliberation) {
      return res.status(404).json({ error: 'Deliberation not found' });
    }

    return res.json(deliberation);
  } catch (error) {
    logger.error('Error getting deliberation', { error });
    return res.status(500).json({ error: 'Failed to get deliberation' });
  }
});

// ============================================
// Goals
// ============================================

/**
 * GET /api/autonomous/goals
 * List goals
 */
router.get('/goals', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const status = req.query.status as goalsService.Goal['status'] | undefined;
    const goalType = req.query.type as goalsService.Goal['goalType'] | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const goals = await goalsService.getGoals(userId, { status, goalType, limit, offset });

    res.json({ goals });
  } catch (error) {
    logger.error('Error getting goals', { error });
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

/**
 * POST /api/autonomous/goals
 * Create a goal
 */
router.post('/goals', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { goalType, title, description, targetMetric, priority, dueDate, parentGoalId } = req.body;

    if (!goalType || !title) {
      return res.status(400).json({ error: 'goalType and title are required' });
    }

    const goal = await goalsService.createGoal(userId, {
      goalType,
      title,
      description,
      targetMetric,
      priority,
      dueDate,
      parentGoalId,
      createdBy: 'user',
    });

    return res.status(201).json({ goal });
  } catch (error) {
    logger.error('Error creating goal', { error });
    return res.status(500).json({ error: 'Failed to create goal' });
  }
});

/**
 * PUT /api/autonomous/goals/:id
 * Update a goal
 */
router.put('/goals/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const goalId = req.params.id;
    const { title, description, targetMetric, status, priority, dueDate } = req.body;

    const goal = await goalsService.updateGoal(goalId, userId, {
      title,
      description,
      targetMetric,
      status,
      priority,
      dueDate,
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    return res.json({ goal });
  } catch (error) {
    logger.error('Error updating goal', { error });
    return res.status(500).json({ error: 'Failed to update goal' });
  }
});

/**
 * DELETE /api/autonomous/goals/:id
 * Delete a goal
 */
router.delete('/goals/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const goalId = req.params.id;

    const deleted = await goalsService.deleteGoal(goalId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting goal', { error });
    return res.status(500).json({ error: 'Failed to delete goal' });
  }
});

/**
 * GET /api/autonomous/goals/stats
 * Get goal statistics
 */
router.get('/goals/stats', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const stats = await goalsService.getGoalStats(userId);

    res.json({ stats });
  } catch (error) {
    logger.error('Error getting goal stats', { error });
    res.status(500).json({ error: 'Failed to get goal stats' });
  }
});

// ============================================
// Achievements
// ============================================

/**
 * GET /api/autonomous/achievements
 * List achievements (journal entries)
 */
router.get('/achievements', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const achievements = await goalsService.getAchievements(userId, { limit, offset });

    res.json({ achievements });
  } catch (error) {
    logger.error('Error getting achievements', { error });
    res.status(500).json({ error: 'Failed to get achievements' });
  }
});

/**
 * POST /api/autonomous/achievements/:id/celebrate
 * Mark achievement as celebrated
 */
router.post('/achievements/:id/celebrate', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const achievementId = req.params.id;

    const achievement = await goalsService.markAchievementCelebrated(achievementId, userId);

    if (!achievement) {
      return res.status(404).json({ error: 'Achievement not found' });
    }

    return res.json({ achievement });
  } catch (error) {
    logger.error('Error celebrating achievement', { error });
    return res.status(500).json({ error: 'Failed to celebrate achievement' });
  }
});

// ============================================
// News (Newsfetcher Integration)
// ============================================

/**
 * GET /api/autonomous/news/articles
 * Query local enriched articles with optional filters (category, priority, q, limit)
 */
router.get('/news/articles', async (req: Request, res: Response) => {
  try {
    const { q, limit, category, priority } = req.query;

    // Query from local enriched articles (3-day window, enriched only)
    let sql = `SELECT id, title, url, author, published_at, category, priority,
               priority_reason, source_type, enriched_at, notification_sent,
               newsfetcher_id, fetched_at
               FROM rss_articles WHERE enriched_at IS NOT NULL
               AND published_at >= NOW() - INTERVAL '3 days'`;
    const params: any[] = [];
    let paramIdx = 1;

    if (category && category !== 'all') {
      sql += ` AND category = $${paramIdx++}`;
      params.push(category);
    }
    if (priority && priority !== 'all') {
      sql += ` AND priority = $${paramIdx++}`;
      params.push(priority);
    }
    if (q) {
      sql += ` AND title ILIKE $${paramIdx++}`;
      params.push(`%${q}%`);
    }

    sql += ` ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT $${paramIdx++}`;
    params.push(parseInt(limit as string) || 50);

    const rows = await query(sql, params);

    const articles = rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      publishedAt: r.published_at,
      sourceName: r.author || 'Unknown',
      category: r.category,
      priority: r.priority,
      priorityReason: r.priority_reason,
      sourceType: r.source_type,
      enrichedAt: r.enriched_at,
      notificationSent: r.notification_sent,
      // Backwards compat fields
      verificationStatus: 'Unconfirmed',
      confidenceScore: 0,
      signal: r.priority === 'P1' ? 'high' : r.priority === 'P2' ? 'medium' : 'low',
      signalReason: r.priority_reason,
      topics: [],
      signalConfidence: null,
    }));

    res.json({ articles });
  } catch (error) {
    logger.error('Error getting news articles', { error });
    res.status(500).json({ error: 'Failed to get news articles' });
  }
});

/**
 * GET /api/autonomous/news/claims
 * Query newsfetcher claims with optional filters
 */
router.get('/news/claims', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const minScore = req.query.min_score ? parseInt(req.query.min_score as string) : undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const claims = await newsfetcherService.getClaims({ status, minScore, limit });

    res.json({ claims });
  } catch (error) {
    logger.error('Error getting news claims', { error });
    res.status(500).json({ error: 'Failed to get news claims' });
  }
});

/**
 * POST /api/autonomous/news/enrich/start
 * Start batch enrichment in background. Poll /news/dashboard for progress.
 */
router.post('/news/enrich/start', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await newsEnrichmentService.startBatchEnrich(userId);
    res.json(result);
  } catch (error) {
    logger.error('Error starting enrichment', { error });
    res.status(500).json({ error: 'Failed to start enrichment' });
  }
});

/**
 * POST /api/autonomous/news/enrich/stop
 * Request enrichment to stop
 */
router.post('/news/enrich/stop', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    await newsEnrichmentService.requestStop(userId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error stopping enrichment', { error });
    res.status(500).json({ error: 'Failed to stop enrichment' });
  }
});

/**
 * POST /api/autonomous/news/enrich/:id
 * Trigger AI enrichment for a single article
 */
router.post('/news/enrich/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const articleId = parseInt(req.params.id);

    if (isNaN(articleId)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const article = await newsfetcherService.enrichArticleById(articleId, userId);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    return res.json({ article });
  } catch (error) {
    logger.error('Error enriching article', { error });
    return res.status(500).json({ error: 'Failed to enrich article' });
  }
});

/**
 * POST /api/autonomous/news/enrich
 * Batch-enrich recent articles with AI filter
 */
router.post('/news/enrich', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);

    const enrichedCount = await newsfetcherService.batchEnrichArticles(userId, limit);

    res.json({ enrichedCount });
  } catch (error) {
    logger.error('Error batch enriching articles', { error });
    res.status(500).json({ error: 'Failed to batch enrich articles' });
  }
});

/**
 * POST /api/autonomous/news/ingest
 * Trigger manual newsfetcher ingestion
 */
router.post('/news/ingest', async (_req: Request, res: Response) => {
  try {
    const result = await newsfetcherService.triggerIngestion();

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error triggering news ingestion', { error });
    res.status(500).json({ error: 'Failed to trigger ingestion' });
  }
});

/**
 * GET /api/autonomous/news/health
 * Newsfetcher health check
 */
router.get('/news/health', async (_req: Request, res: Response) => {
  try {
    const result = await newsfetcherService.healthCheck();

    res.json(result);
  } catch (error) {
    logger.error('Error checking newsfetcher health', { error });
    res.status(500).json({ healthy: false, error: 'Health check failed' });
  }
});

/**
 * GET /api/autonomous/news/categories
 * List categories with article counts
 */
router.get('/news/categories', async (_req: Request, res: Response) => {
  try {
    const counts = await query(
      `SELECT category, COUNT(*) as count FROM rss_articles
       WHERE category IS NOT NULL AND published_at >= NOW() - INTERVAL '3 days'
       GROUP BY category ORDER BY count DESC`
    );
    const countMap = new Map((counts as any[]).map((r: any) => [r.category, parseInt(r.count)]));
    const categories = NEWS_CATEGORIES.map(c => ({
      ...c,
      count: countMap.get(c.id) || 0,
    }));
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/autonomous/news/alerts/thresholds
 * Get user's alert thresholds
 */
router.get('/news/alerts/thresholds', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const thresholds = await newsAlertService.getThresholds(userId);
    res.json(thresholds);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch thresholds' });
  }
});

/**
 * PUT /api/autonomous/news/alerts/thresholds
 * Set alert thresholds for a user
 */
router.put('/news/alerts/thresholds', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { thresholds } = req.body;
    if (!Array.isArray(thresholds)) {
      return res.status(400).json({ error: 'thresholds must be an array' });
    }
    await newsAlertService.setThresholds(userId, thresholds);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to set thresholds' });
  }
});

/**
 * POST /api/autonomous/news/sync
 * Manual trigger of sync + enrich + alert cycle
 */
router.post('/news/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await syncAndEnrichNews(userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync news' });
  }
});

// ============================================
// News Dashboard & Enrichment Control
// ============================================

/**
 * GET /api/autonomous/news/dashboard
 * Stats: total, enriched, unprocessed, priority/category breakdown, enrichment state
 */
router.get('/news/dashboard', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const stats = await newsEnrichmentService.getDashboardStats(userId);
    res.json(stats);
  } catch (error) {
    logger.error('Error getting news dashboard', { error });
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

/**
 * GET /api/autonomous/news/queue
 * Unclassified articles (enriched_at IS NULL, 3-day window)
 */
router.get('/news/queue', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const rows = await query(
      `SELECT id, title, url, author, published_at, source_type, fetched_at
       FROM rss_articles
       WHERE enriched_at IS NULL AND published_at >= NOW() - INTERVAL '3 days'
       ORDER BY published_at DESC LIMIT $1`,
      [limit]
    );

    const articles = (rows as any[]).map((r: any) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      author: r.author,
      publishedAt: r.published_at,
      sourceType: r.source_type,
      fetchedAt: r.fetched_at,
    }));

    res.json({ articles, total: articles.length });
  } catch (error) {
    logger.error('Error getting news queue', { error });
    res.status(500).json({ error: 'Failed to get news queue' });
  }
});

// (enrich/start and enrich/stop moved before /enrich/:id to avoid param capture)

// ============================================
// Insights
// ============================================

/**
 * GET /api/autonomous/insights
 * Get proactive insights
 */
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const unshared = req.query.unshared === 'true';
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    const insights = await insightsService.getInsights(userId, {
      unsharedOnly: unshared,
      limit,
      offset,
    });

    res.json({ insights });
  } catch (error) {
    logger.error('Error getting insights', { error });
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

/**
 * POST /api/autonomous/insights/:id/shared
 * Mark insight as shared
 */
router.post('/insights/:id/shared', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const insightId = req.params.id;

    const insight = await insightsService.markInsightShared(insightId, userId);

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    return res.json({ insight });
  } catch (error) {
    logger.error('Error marking insight shared', { error });
    return res.status(500).json({ error: 'Failed to mark insight shared' });
  }
});

/**
 * POST /api/autonomous/insights/:id/dismiss
 * Dismiss an insight
 */
router.post('/insights/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const insightId = req.params.id;

    const insight = await insightsService.dismissInsight(insightId, userId);

    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    return res.json({ insight });
  } catch (error) {
    logger.error('Error dismissing insight', { error });
    return res.status(500).json({ error: 'Failed to dismiss insight' });
  }
});

// ============================================
// Learnings
// ============================================

/**
 * GET /api/autonomous/learnings
 * Get session learnings
 */
router.get('/learnings', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const learnings = await insightsService.getLearnings(userId, { limit, offset });

    res.json({ learnings });
  } catch (error) {
    logger.error('Error getting learnings', { error });
    res.status(500).json({ error: 'Failed to get learnings' });
  }
});

// ============================================
// User Availability
// ============================================

/**
 * GET /api/autonomous/availability
 * Get user availability for questions
 */
router.get('/availability', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const available = await questionsService.getUserAvailability(userId);

    res.json({ available });
  } catch (error) {
    logger.error('Error getting availability', { error });
    res.status(500).json({ error: 'Failed to get availability' });
  }
});

/**
 * PUT /api/autonomous/availability
 * Set user availability for questions
 */
router.put('/availability', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { available } = req.body;

    if (typeof available !== 'boolean') {
      return res.status(400).json({ error: 'available must be a boolean' });
    }

    await questionsService.setUserAvailability(userId, available);

    return res.json({ available });
  } catch (error) {
    logger.error('Error setting availability', { error });
    return res.status(500).json({ error: 'Failed to set availability' });
  }
});

// ============================================
// Questions
// ============================================

/**
 * GET /api/autonomous/questions
 * Get pending questions
 */
router.get('/questions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const questions = await questionsService.getPendingQuestions(userId, limit);

    res.json({ questions });
  } catch (error) {
    logger.error('Error getting questions', { error });
    res.status(500).json({ error: 'Failed to get questions' });
  }
});

/**
 * GET /api/autonomous/questions/:id
 * Get a specific question
 */
router.get('/questions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id;

    const question = await questionsService.getQuestion(questionId, userId);

    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    return res.json({ question });
  } catch (error) {
    logger.error('Error getting question', { error });
    return res.status(500).json({ error: 'Failed to get question' });
  }
});

/**
 * POST /api/autonomous/questions/:id/answer
 * Answer a question - also resumes the session if it was paused waiting for answer
 */
router.post('/questions/:id/answer', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id;
    const { response } = req.body;

    if (!response || typeof response !== 'string') {
      return res.status(400).json({ error: 'response is required' });
    }

    const question = await questionsService.answerQuestion(questionId, userId, response);

    if (!question) {
      return res.status(404).json({ error: 'Question not found or already answered' });
    }

    // If the question was associated with a session, try to resume that session
    if (question.sessionId) {
      const session = await autonomousService.getSession(question.sessionId, userId);
      if (session && session.status === 'paused') {
        logger.info('Resuming session after question answered', { sessionId: question.sessionId });
        await autonomousService.resumeSession(userId);
      }
    }

    return res.json({ question });
  } catch (error) {
    logger.error('Error answering question', { error });
    return res.status(500).json({ error: 'Failed to answer question' });
  }
});

/**
 * POST /api/autonomous/questions/:id/dismiss
 * Dismiss a question
 */
router.post('/questions/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id;

    const success = await questionsService.dismissQuestion(questionId, userId);

    if (!success) {
      return res.status(404).json({ error: 'Question not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error dismissing question', { error });
    return res.status(500).json({ error: 'Failed to dismiss question' });
  }
});

// ============================================
// Session Workspace Notes
// ============================================

/**
 * GET /api/autonomous/sessions/:sessionId/notes
 * Get session notes
 */
router.get('/sessions/:sessionId/notes', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const noteType = req.query.type as sessionWorkspaceService.NoteType | undefined;
    const phase = req.query.phase as string | undefined;

    const notes = await sessionWorkspaceService.getSessionNotes(sessionId, { noteType, phase });

    res.json({ notes });
  } catch (error) {
    logger.error('Error getting session notes', { error });
    res.status(500).json({ error: 'Failed to get session notes' });
  }
});

/**
 * POST /api/autonomous/sessions/:sessionId/notes
 * Add a session note
 */
router.post('/sessions/:sessionId/notes', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.sessionId;
    const { noteType, content, title, phase, goalId, metadata } = req.body;

    if (!noteType || !content) {
      return res.status(400).json({ error: 'noteType and content are required' });
    }

    const validTypes = ['planning', 'observation', 'finding', 'decision', 'question', 'summary'];
    if (!validTypes.includes(noteType)) {
      return res.status(400).json({ error: `noteType must be one of: ${validTypes.join(', ')}` });
    }

    const note = await sessionWorkspaceService.addNote(sessionId, userId, {
      noteType,
      content,
      title,
      phase,
      goalId,
      metadata,
    });

    return res.status(201).json({ note });
  } catch (error) {
    logger.error('Error adding session note', { error });
    return res.status(500).json({ error: 'Failed to add session note' });
  }
});

/**
 * GET /api/autonomous/sessions/:sessionId/summary
 * Get session summary
 */
router.get('/sessions/:sessionId/summary', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;

    const summary = await sessionWorkspaceService.getSessionSummary(sessionId);

    res.json({ summary });
  } catch (error) {
    logger.error('Error getting session summary', { error });
    res.status(500).json({ error: 'Failed to get session summary' });
  }
});

// ============================================
// Research Collections
// ============================================

/**
 * GET /api/autonomous/research
 * List research collections
 */
router.get('/research', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const status = req.query.status as researchService.ResearchCollection['status'] | undefined;
    const goalId = req.query.goalId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const collections = await researchService.getCollections(userId, { status, goalId, limit });

    res.json({ collections });
  } catch (error) {
    logger.error('Error getting research collections', { error });
    res.status(500).json({ error: 'Failed to get research collections' });
  }
});

/**
 * POST /api/autonomous/research
 * Create research collection
 */
router.post('/research', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { title, description, goalId, sessionId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const collection = await researchService.createCollection(userId, {
      title,
      description,
      goalId,
      sessionId,
    });

    return res.status(201).json({ collection });
  } catch (error) {
    logger.error('Error creating research collection', { error });
    return res.status(500).json({ error: 'Failed to create research collection' });
  }
});

/**
 * GET /api/autonomous/research/search
 * Search across research items
 * NOTE: Must be defined BEFORE /research/:id to avoid route conflict
 */
router.get('/research/search', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const query = req.query.q as string;
    const collectionId = req.query.collectionId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    if (!query) {
      return res.status(400).json({ error: 'q (query) is required' });
    }

    const results = await researchService.searchResearch(userId, query, { collectionId, limit });

    return res.json({ results });
  } catch (error) {
    logger.error('Error searching research', { error });
    return res.status(500).json({ error: 'Failed to search research' });
  }
});

/**
 * GET /api/autonomous/research/:id
 * Get research collection
 */
router.get('/research/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const collectionId = req.params.id;

    const collection = await researchService.getCollection(collectionId, userId);

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    return res.json({ collection });
  } catch (error) {
    logger.error('Error getting research collection', { error });
    return res.status(500).json({ error: 'Failed to get research collection' });
  }
});

/**
 * PUT /api/autonomous/research/:id
 * Update research collection
 */
router.put('/research/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const collectionId = req.params.id;
    const { title, description, status } = req.body;

    const collection = await researchService.updateCollection(collectionId, userId, {
      title,
      description,
      status,
    });

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    return res.json({ collection });
  } catch (error) {
    logger.error('Error updating research collection', { error });
    return res.status(500).json({ error: 'Failed to update research collection' });
  }
});

/**
 * DELETE /api/autonomous/research/:id
 * Delete research collection
 */
router.delete('/research/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const collectionId = req.params.id;

    const deleted = await researchService.deleteCollection(collectionId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting research collection', { error });
    return res.status(500).json({ error: 'Failed to delete research collection' });
  }
});

/**
 * GET /api/autonomous/research/:id/items
 * Get research items in collection
 */
router.get('/research/:id/items', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const collectionId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const items = await researchService.getCollectionItems(collectionId, userId, limit);

    res.json({ items });
  } catch (error) {
    logger.error('Error getting research items', { error });
    res.status(500).json({ error: 'Failed to get research items' });
  }
});

/**
 * POST /api/autonomous/research/:id/items
 * Add research item to collection
 */
router.post('/research/:id/items', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const collectionId = req.params.id;
    const { sourceType, sourceUrl, title, content, summary, keyFindings, relevanceScore, tags, metadata } = req.body;

    if (!sourceType) {
      return res.status(400).json({ error: 'sourceType is required' });
    }

    const validTypes = ['web_page', 'search_result', 'rss_article', 'document', 'user_input'];
    if (!validTypes.includes(sourceType)) {
      return res.status(400).json({ error: `sourceType must be one of: ${validTypes.join(', ')}` });
    }

    const item = await researchService.addResearchItem(collectionId, userId, {
      sourceType,
      sourceUrl,
      title,
      content,
      summary,
      keyFindings,
      relevanceScore,
      tags,
      metadata,
    });

    return res.status(201).json({ item });
  } catch (error) {
    logger.error('Error adding research item', { error });
    return res.status(500).json({ error: 'Failed to add research item' });
  }
});

/**
 * POST /api/autonomous/research/:id/summarize
 * Generate summary for collection
 */
router.post('/research/:id/summarize', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const collectionId = req.params.id;

    const summary = await researchService.summarizeCollection(collectionId, userId);

    res.json({ summary });
  } catch (error) {
    logger.error('Error summarizing research collection', { error });
    res.status(500).json({ error: 'Failed to summarize research collection' });
  }
});

// ============================================
// Web Fetch
// ============================================

/**
 * POST /api/autonomous/webfetch
 * Fetch and extract web page content
 */
router.post('/webfetch', async (req: Request, res: Response) => {
  try {
    const { url, forceRefresh } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const page = await webfetchService.fetchPage(url, { forceRefresh });

    return res.json({ page });
  } catch (error) {
    logger.error('Error fetching web page', { error });
    const message = (error as Error).message;
    // Return specific error messages for user-facing issues
    if (message.includes('HTTPS') || message.includes('blocked') || message.includes('timeout')) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: 'Failed to fetch web page' });
  }
});

/**
 * POST /api/autonomous/webfetch/summarize
 * Fetch web page and generate summary
 */
router.post('/webfetch/summarize', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { url, prompt } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const result = await webfetchService.fetchAndSummarize(url, userId, prompt);

    return res.json(result);
  } catch (error) {
    logger.error('Error fetching and summarizing web page', { error });
    const message = (error as Error).message;
    if (message.includes('HTTPS') || message.includes('blocked') || message.includes('timeout')) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: 'Failed to fetch and summarize web page' });
  }
});

// ============================================
// Friends
// ============================================

/**
 * GET /api/autonomous/friends
 * List Luna's AI friends
 */
router.get('/friends', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const friends = await friendService.getFriends(userId);

    res.json({ friends });
  } catch (error) {
    logger.error('Error getting friends', { error });
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

/**
 * POST /api/autonomous/friends
 * Create a new friend personality
 */
router.post('/friends', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { name, personality, systemPrompt, avatarEmoji, color } = req.body;

    if (!name || !personality || !systemPrompt) {
      return res.status(400).json({ error: 'name, personality, and systemPrompt are required' });
    }

    const friend = await friendService.createFriend(userId, {
      name,
      personality,
      systemPrompt,
      avatarEmoji,
      color,
    });

    return res.status(201).json({ friend });
  } catch (error) {
    logger.error('Error creating friend', { error });
    return res.status(500).json({ error: 'Failed to create friend' });
  }
});

/**
 * PUT /api/autonomous/friends/:id
 * Update a friend personality (only custom friends, not defaults)
 */
router.put('/friends/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const friendId = req.params.id;
    const { name, personality, systemPrompt, avatarEmoji, color } = req.body;

    const friend = await friendService.updateFriend(friendId, userId, {
      name,
      personality,
      systemPrompt,
      avatarEmoji,
      color,
    });

    if (!friend) {
      return res.status(404).json({ error: 'Friend not found or is a default friend' });
    }

    return res.json({ friend });
  } catch (error) {
    logger.error('Error updating friend', { error });
    return res.status(500).json({ error: 'Failed to update friend' });
  }
});

/**
 * DELETE /api/autonomous/friends/:id
 * Delete a custom friend (cannot delete defaults)
 */
router.delete('/friends/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const friendId = req.params.id;

    const deleted = await friendService.deleteFriend(friendId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Friend not found or is a default friend' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting friend', { error });
    return res.status(500).json({ error: 'Failed to delete friend' });
  }
});

/**
 * POST /api/autonomous/friends/discuss
 * Manually trigger a friend discussion
 */
router.post('/friends/discuss', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { friendId, topic, rounds } = req.body;

    // Get current session or null if none active
    const status = await autonomousService.getStatus(userId);
    const sessionId = status.currentSession?.id || null;

    // Select topic if not provided
    let discussionTopic = topic;
    let context = '';
    let triggerType: 'pattern' | 'interest' | 'fact' | 'random' = 'random';
    let topicCandidateId: string | undefined;

    if (!discussionTopic) {
      const topicData = await friendService.selectDiscussionTopic(userId);
      if (!topicData) {
        return res.status(400).json({ error: 'No patterns or facts available to discuss. Chat more with Luna first!' });
      }
      discussionTopic = topicData.topic;
      context = topicData.context;
      triggerType = topicData.triggerType;
      topicCandidateId = topicData.topicCandidateId;
    }

    const conversation = await friendService.startFriendDiscussion(
      sessionId,
      userId,
      discussionTopic,
      context,
      triggerType,
      rounds || 5,
      friendId,
      topicCandidateId
    );

    return res.json({ conversation });
  } catch (error) {
    logger.error('Error starting friend discussion', { error });
    return res.status(500).json({ error: 'Failed to start friend discussion' });
  }
});

/**
 * GET /api/autonomous/friends/discussions
 * Get recent friend discussions
 */
router.get('/friends/discussions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const discussions = await friendService.getRecentDiscussions(userId, limit);

    res.json({ discussions });
  } catch (error) {
    logger.error('Error getting friend discussions', { error });
    res.status(500).json({ error: 'Failed to get friend discussions' });
  }
});

/**
 * GET /api/autonomous/friends/topics
 * List recent mined topics and their status
 */
router.get('/friends/topics', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const topics = await friendVerificationService.listRecentTopicCandidates(userId, limit);

    res.json({ topics });
  } catch (error) {
    logger.error('Error getting friend topics', { error });
    res.status(500).json({ error: 'Failed to get friend topics' });
  }
});

/**
 * POST /api/autonomous/friends/topics
 * Manually add a gossip topic to the queue
 */
router.post('/friends/topics', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { topicText, motivation, importance = 3, suggestedFriendId } = req.body;

    if (!topicText || typeof topicText !== 'string' || !topicText.trim()) {
      return res.status(400).json({ error: 'topicText is required' });
    }

    const topic = await friendVerificationService.addManualTopicCandidate(
      userId,
      topicText.trim(),
      motivation ? String(motivation).trim() : null,
      Math.min(5, Math.max(1, parseInt(String(importance)) || 3)),
      suggestedFriendId || null
    );

    return res.json({ topic });
  } catch (error) {
    logger.error('Error adding gossip topic', { error });
    return res.status(500).json({ error: 'Failed to add topic' });
  }
});

/**
 * PATCH /api/autonomous/friends/topics/:id
 * Update a gossip topic (importance, motivation, suggestedFriendId, status)
 */
router.patch('/friends/topics/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const topicId = req.params.id;
    const { importance, motivation, suggestedFriendId, status } = req.body;

    const updates: Parameters<typeof friendVerificationService.updateTopicCandidate>[2] = {};
    if (importance !== undefined) updates.importance = Math.min(5, Math.max(1, parseInt(String(importance)) || 3));
    if ('motivation' in req.body) updates.motivation = motivation ? String(motivation).trim() : null;
    if ('suggestedFriendId' in req.body) updates.suggestedFriendId = suggestedFriendId || null;
    if (status !== undefined) {
      const validStatuses = ['pending', 'approved', 'rejected', 'consumed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.status = status;
    }

    const topic = await friendVerificationService.updateTopicCandidate(topicId, userId, updates);

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    return res.json({ topic });
  } catch (error) {
    logger.error('Error updating gossip topic', { error });
    return res.status(500).json({ error: 'Failed to update topic' });
  }
});

/**
 * DELETE /api/autonomous/friends/topics/:id
 * Delete a gossip topic
 */
router.delete('/friends/topics/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const topicId = req.params.id;

    const deleted = await friendVerificationService.deleteTopicCandidate(topicId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting gossip topic', { error });
    return res.status(500).json({ error: 'Failed to delete topic' });
  }
});

/**
 * GET /api/autonomous/friends/discussions/:id
 * Get a specific friend discussion
 */
router.get('/friends/discussions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const discussionId = req.params.id;

    const discussion = await friendService.getDiscussion(discussionId, userId);

    if (!discussion) {
      return res.status(404).json({ error: 'Discussion not found' });
    }

    return res.json({ discussion });
  } catch (error) {
    logger.error('Error getting friend discussion', { error });
    return res.status(500).json({ error: 'Failed to get friend discussion' });
  }
});

/**
 * DELETE /api/autonomous/friends/discussions/:id
 * Delete a friend discussion
 */
router.delete('/friends/discussions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const discussionId = req.params.id;

    const deleted = await friendService.deleteDiscussion(discussionId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Discussion not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting friend discussion', { error });
    return res.status(500).json({ error: 'Failed to delete friend discussion' });
  }
});

/**
 * POST /api/autonomous/friends/discuss/stream
 * Start a friend discussion with SSE streaming for theater mode
 */
router.post('/friends/discuss/stream', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { friendId, topic, rounds } = req.body;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const status = await autonomousService.getStatus(userId);
    const sessionId = status.currentSession?.id || null;

    let discussionTopic = topic;
    let context = '';
    let triggerType: 'pattern' | 'interest' | 'fact' | 'random' = 'random';
    let topicCandidateId: string | undefined;

    if (!discussionTopic) {
      const topicData = await friendService.selectDiscussionTopic(userId);
      if (!topicData) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'No patterns or facts available to discuss. Chat more with Luna first!' })}\n\n`);
        res.end();
        return;
      }
      discussionTopic = topicData.topic;
      context = topicData.context;
      triggerType = topicData.triggerType;
      topicCandidateId = topicData.topicCandidateId;
    }

    await friendService.startFriendDiscussionStreaming(
      sessionId,
      userId,
      discussionTopic,
      context,
      triggerType,
      rounds || 5,
      friendId,
      topicCandidateId,
      (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    );

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    logger.error('Error in streaming friend discussion', { error });
    res.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
    res.end();
  }
});

// ============================================
// Autonomous Learning (Knowledge Evolution)
// ============================================

/**
 * GET /api/autonomous/learning/trust-scores
 * List source trust scores
 */
router.get('/learning/trust-scores', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const { getAllTrustScores } = await import('./source-trust.service.js');
    const scores = await getAllTrustScores(category);

    res.json({ scores });
  } catch (error) {
    logger.error('Error getting trust scores', { error });
    res.status(500).json({ error: 'Failed to get trust scores' });
  }
});

/**
 * PUT /api/autonomous/learning/trust-scores/:domain
 * Update trust score for a domain
 */
router.put('/learning/trust-scores/:domain', async (req: Request, res: Response) => {
  try {
    const domain = req.params.domain;
    const { trustScore, category, updateReason } = req.body;

    if (typeof trustScore !== 'number' || trustScore < 0 || trustScore > 1) {
      return res.status(400).json({ error: 'trustScore must be a number between 0 and 1' });
    }

    if (!updateReason) {
      return res.status(400).json({ error: 'updateReason is required' });
    }

    const { updateTrustScore } = await import('./source-trust.service.js');
    await updateTrustScore(domain, trustScore, updateReason, category);

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error updating trust score', { error });
    return res.status(500).json({ error: 'Failed to update trust score' });
  }
});

/**
 * GET /api/autonomous/learning/trust-scores/auto-discovered
 * List auto-discovered domains for review
 */
router.get('/learning/trust-scores/auto-discovered', async (_req: Request, res: Response) => {
  try {
    const { getAutoDiscoveredDomains } = await import('./source-trust.service.js');
    const domains = await getAutoDiscoveredDomains();

    res.json({ domains });
  } catch (error) {
    logger.error('Error getting auto-discovered domains', { error });
    res.status(500).json({ error: 'Failed to get auto-discovered domains' });
  }
});

/**
 * POST /api/autonomous/learning/trust-scores/:domain/confirm
 * Confirm an auto-discovered domain, optionally adjusting its trust score
 */
router.post('/learning/trust-scores/:domain/confirm', async (req: Request, res: Response) => {
  try {
    const domain = req.params.domain;
    const { trustScore } = req.body;

    if (trustScore !== undefined && (typeof trustScore !== 'number' || trustScore < 0 || trustScore > 1)) {
      return res.status(400).json({ error: 'trustScore must be a number between 0 and 1' });
    }

    const { confirmDomain } = await import('./source-trust.service.js');
    await confirmDomain(domain, trustScore);

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error confirming domain', { error });
    return res.status(500).json({ error: 'Failed to confirm domain' });
  }
});

/**
 * GET /api/autonomous/learning/gaps
 * Get knowledge gaps identified by session analysis
 */
router.get('/learning/gaps', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const { query } = await import('../db/postgres.js');

    let sql = 'SELECT * FROM knowledge_gaps WHERE user_id = $1';
    const params: (string | number)[] = [userId];

    if (status) {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY priority DESC, identified_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const rows = await query<any>(sql, params);

    const gaps = rows.map((row) => ({
      id: row.id,
      gapDescription: row.gap_description,
      priority: parseFloat(row.priority),
      suggestedQueries: row.suggested_queries,
      category: row.category,
      identifiedAt: row.identified_at,
      status: row.status,
      researchSessionId: row.research_session_id,
      failureReason: row.failure_reason,
      completedAt: row.completed_at,
      retryCount: row.retry_count || 0,
      retryAfter: row.retry_after,
      lastRetryAt: row.last_retry_at,
      bestQuery: row.best_query,
      mentionCount: row.mention_count || 0,
      sessionCount: row.session_count || 0,
      lastMentionedAt: row.last_mentioned_at,
    }));

    res.json({ gaps });
  } catch (error) {
    logger.error('Error getting knowledge gaps', { error });
    res.status(500).json({ error: 'Failed to get knowledge gaps' });
  }
});

/**
 * POST /api/autonomous/learning/gaps/:id/approve
 * Manually approve a rejected knowledge gap
 */
router.post('/learning/gaps/:id/approve', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const gapId = parseInt(req.params.id);

    if (isNaN(gapId)) {
      return res.status(400).json({ error: 'Invalid gap ID' });
    }

    const { query } = await import('../db/postgres.js');
    const { embedApprovedGap } = await import('./autonomous-learning.orchestrator.js');

    // Fetch gap with verification details
    const gapRows = await query<any>(
      `SELECT kg.*, ars.verification_result
       FROM knowledge_gaps kg
       LEFT JOIN autonomous_research_sessions ars ON kg.id = ars.knowledge_gap_id
       WHERE kg.id = $1 AND kg.user_id = $2`,
      [gapId, userId]
    );

    if (gapRows.length === 0) {
      return res.status(404).json({ error: 'Knowledge gap not found' });
    }

    const gap = gapRows[0];

    // Validate gap is in rejected status and requires manual approval
    if (gap.status !== 'rejected') {
      return res.status(400).json({
        error: 'Gap must be in rejected status to approve',
        currentStatus: gap.status
      });
    }

    if (!gap.manual_approval_required) {
      return res.status(400).json({
        error: 'This gap does not require manual approval'
      });
    }

    // Update gap status to verified
    await query(
      `UPDATE knowledge_gaps
       SET
         status = 'verified',
         manual_approval_required = false,
         failure_reason = NULL,
         completed_at = NOW()
       WHERE id = $1`,
      [gapId]
    );

    // Update verification result with manual approval flag
    const verificationResult = typeof gap.verification_result === 'string'
      ? JSON.parse(gap.verification_result)
      : (gap.verification_result || {});
    verificationResult.manually_approved = true;
    verificationResult.manual_approval_timestamp = new Date().toISOString();
    verificationResult.manual_approval_user_id = userId;

    await query(
      `UPDATE autonomous_research_sessions
       SET verification_result = $1
       WHERE knowledge_gap_id = $2`,
      [JSON.stringify(verificationResult), gapId]
    );

    // Log the manual approval action
    await query(
      `INSERT INTO autonomous_learning_log (user_id, action_type, details, success, timestamp)
       VALUES ($1, $2, $3, true, NOW())`,
      [userId, 'manual_approval', JSON.stringify({
        gapId,
        previousStatus: 'rejected',
        newStatus: 'verified',
      })]
    );

    // Trigger embedding asynchronously (don't await)
    embedApprovedGap(gapId, userId).catch((error) => {
      logger.error('Error embedding approved gap', { gapId, userId, error });
    });

    return res.json({
      success: true,
      gap: {
        id: gapId,
        status: 'verified',
        manuallyApproved: true
      }
    });
  } catch (error) {
    logger.error('Error approving knowledge gap', { error });
    return res.status(500).json({ error: 'Failed to approve knowledge gap' });
  }
});

/**
 * GET /api/autonomous/learning/research-sessions
 * Get autonomous research sessions
 */
router.get('/learning/research-sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const { query } = await import('../db/postgres.js');

    const rows = await query<any>(
      `SELECT * FROM autonomous_research_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    const sessions = rows.map((row) => ({
      id: row.id,
      knowledgeGapId: row.knowledge_gap_id,
      userId: row.user_id,
      topic: row.topic,
      searchQueries: row.search_queries,
      sourcesFound: row.sources_found,
      trustedSourcesCount: row.trusted_sources_count,
      findings: row.findings,
      verificationResult: row.verification_result,
      friendDiscussionId: row.friend_discussion_id,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));

    res.json({ sessions });
  } catch (error) {
    logger.error('Error getting research sessions', { error });
    res.status(500).json({ error: 'Failed to get research sessions' });
  }
});

/**
 * GET /api/autonomous/learning/research-sessions/:id
 * Get a specific research session with details
 */
router.get('/learning/research-sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.id;

    const { query } = await import('../db/postgres.js');

    const rows = await query<any>(
      `SELECT * FROM autonomous_research_sessions
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Research session not found' });
    }

    const row = rows[0];
    const session = {
      id: row.id,
      knowledgeGapId: row.knowledge_gap_id,
      userId: row.user_id,
      topic: row.topic,
      searchQueries: row.search_queries,
      sourcesFound: row.sources_found,
      trustedSourcesCount: row.trusted_sources_count,
      findings: row.findings,
      verificationResult: row.verification_result,
      friendDiscussionId: row.friend_discussion_id,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };

    return res.json({ session });
  } catch (error) {
    logger.error('Error getting research session', { error });
    return res.status(500).json({ error: 'Failed to get research session' });
  }
});

/**
 * GET /api/autonomous/learning/log
 * Get autonomous learning activity log
 */
router.get('/learning/log', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const actionType = req.query.actionType as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const { query } = await import('../db/postgres.js');

    let sql = 'SELECT * FROM autonomous_learning_log WHERE user_id = $1';
    const params: (string | number)[] = [userId];

    if (actionType) {
      sql += ' AND action_type = $2';
      params.push(actionType);
    }

    sql += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const rows = await query<any>(sql, params);

    const logs = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      actionType: row.action_type,
      details: row.details,
      success: row.success,
      errorMessage: row.error_message,
      timestamp: row.timestamp,
    }));

    res.json({ logs });
  } catch (error) {
    logger.error('Error getting learning log', { error });
    res.status(500).json({ error: 'Failed to get learning log' });
  }
});

/**
 * GET /api/autonomous/learning/stats
 * Get autonomous learning statistics
 */
router.get('/learning/stats', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { query } = await import('../db/postgres.js');

    // Get gap counts by status
    const gapStats = await query<any>(
      `SELECT status, COUNT(*) as count
       FROM knowledge_gaps
       WHERE user_id = $1
       GROUP BY status`,
      [userId]
    );

    // Get total research sessions
    const sessionCount = await query<any>(
      `SELECT COUNT(*) as count
       FROM autonomous_research_sessions
       WHERE user_id = $1`,
      [userId]
    );

    // Get embedded knowledge count
    const embeddedCount = await query<any>(
      `SELECT COUNT(*) as count
       FROM knowledge_gaps
       WHERE user_id = $1 AND status = 'embedded'`,
      [userId]
    );

    // Get recent activity (last 7 days)
    const recentActivity = await query<any>(
      `SELECT DATE(timestamp) as date, COUNT(*) as count
       FROM autonomous_learning_log
       WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(timestamp)
       ORDER BY date DESC`,
      [userId]
    );

    const stats = {
      gapsByStatus: gapStats.reduce((acc: Record<string, number>, row) => {
        acc[row.status] = parseInt(row.count, 10);
        return acc;
      }, {}),
      totalResearchSessions: parseInt(sessionCount[0]?.count || '0', 10),
      knowledgeEmbedded: parseInt(embeddedCount[0]?.count || '0', 10),
      recentActivity: recentActivity.map((row) => ({
        date: row.date,
        count: parseInt(row.count, 10),
      })),
    };

    res.json({ stats });
  } catch (error) {
    logger.error('Error getting learning stats', { error });
    res.status(500).json({ error: 'Failed to get learning stats' });
  }
});

export default router;
