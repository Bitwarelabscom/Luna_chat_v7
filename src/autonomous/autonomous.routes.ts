import { Router, Request, Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as autonomousService from './autonomous.service.js';
import * as councilService from './council.service.js';
import * as goalsService from './goals.service.js';
import * as rssService from './rss.service.js';
import * as insightsService from './insights.service.js';
import * as questionsService from './questions.service.js';
import * as sessionWorkspaceService from './session-workspace.service.js';
import * as researchService from './research.service.js';
import * as friendService from './friend.service.js';
import * as webfetchService from '../search/webfetch.service.js';
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

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Get current active session
  const status = await autonomousService.getStatus(userId);
  const sessionId = status.currentSession?.id;

  if (!sessionId) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'No active session' })}\n\n`);
    res.end();
    return;
  }

  // Subscribe to session updates
  const unsubscribe = autonomousService.subscribeToSession(sessionId, (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
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
// RSS Feeds
// ============================================

/**
 * GET /api/autonomous/rss/feeds
 * List RSS feeds
 */
router.get('/rss/feeds', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const feeds = await rssService.getFeeds(userId, false);

    res.json({ feeds });
  } catch (error) {
    logger.error('Error getting feeds', { error });
    res.status(500).json({ error: 'Failed to get feeds' });
  }
});

/**
 * POST /api/autonomous/rss/feeds
 * Add RSS feed
 */
router.post('/rss/feeds', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { url, title, category } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const feed = await rssService.createFeed(userId, { url, title, category });

    return res.status(201).json({ feed });
  } catch (error) {
    logger.error('Error creating feed', { error });
    return res.status(500).json({ error: 'Failed to create feed' });
  }
});

/**
 * DELETE /api/autonomous/rss/feeds/:id
 * Remove RSS feed
 */
router.delete('/rss/feeds/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const feedId = req.params.id;

    const deleted = await rssService.deleteFeed(feedId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting feed', { error });
    return res.status(500).json({ error: 'Failed to delete feed' });
  }
});

/**
 * POST /api/autonomous/rss/feeds/defaults
 * Add default RSS feeds
 */
router.post('/rss/feeds/defaults', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const feeds = await rssService.addDefaultFeeds(userId);

    res.json({ feeds });
  } catch (error) {
    logger.error('Error adding default feeds', { error });
    res.status(500).json({ error: 'Failed to add default feeds' });
  }
});

/**
 * POST /api/autonomous/rss/fetch
 * Manually trigger RSS fetch
 */
router.post('/rss/fetch', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const articlesAdded = await rssService.fetchAllFeeds(userId);

    res.json({ success: true, articlesAdded });
  } catch (error) {
    logger.error('Error fetching feeds', { error });
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

/**
 * GET /api/autonomous/rss/articles
 * Get RSS articles
 */
router.get('/rss/articles', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const interesting = req.query.interesting === 'true';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const articles = await rssService.getArticles(userId, {
      isInteresting: interesting ? true : undefined,
      limit,
      offset,
    });

    res.json({ articles });
  } catch (error) {
    logger.error('Error getting articles', { error });
    res.status(500).json({ error: 'Failed to get articles' });
  }
});

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

    if (!discussionTopic) {
      const topicData = await friendService.selectDiscussionTopic(userId);
      if (!topicData) {
        return res.status(400).json({ error: 'No patterns or facts available to discuss. Chat more with Luna first!' });
      }
      discussionTopic = topicData.topic;
      context = topicData.context;
      triggerType = topicData.triggerType;
    }

    const conversation = await friendService.startFriendDiscussion(
      sessionId,
      userId,
      discussionTopic,
      context,
      triggerType,
      rounds || 5,
      friendId
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
    }

    await friendService.startFriendDiscussionStreaming(
      sessionId,
      userId,
      discussionTopic,
      context,
      triggerType,
      rounds || 5,
      friendId,
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

export default router;
