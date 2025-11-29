import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as sessionService from './session.service.js';
import * as chatService from './chat.service.js';
import { incrementRateLimit } from '../db/redis.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const router = Router();

// Apply authentication to all chat routes
router.use(authenticate);

// Rate limiting middleware
async function rateLimit(req: Request, res: Response, next: () => void) {
  const userId = req.user!.userId;
  const count = await incrementRateLimit(userId);

  res.setHeader('X-RateLimit-Limit', config.rateLimit.maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, config.rateLimit.maxRequests - count));

  if (count > config.rateLimit.maxRequests) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    });
    return;
  }

  next();
}

const createSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  mode: z.enum(['assistant', 'companion']).optional(),
});

const sendMessageSchema = z.object({
  message: z.string().min(1).max(32000),
  stream: z.boolean().optional(),
});

const updateSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  mode: z.enum(['assistant', 'companion']).optional(),
  isArchived: z.boolean().optional(),
});

// POST /api/chat/sessions - Create new session
router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const data = createSessionSchema.parse(req.body);
    const session = await sessionService.createSession({
      userId: req.user!.userId,
      ...data,
    });

    res.status(201).json(session);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Create session failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/chat/sessions - List user sessions
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    // SECURITY: Bounds checking for pagination parameters
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const includeArchived = req.query.archived === 'true';

    const sessions = await sessionService.getUserSessions(req.user!.userId, {
      limit,
      offset,
      includeArchived,
    });

    res.json({ sessions, limit, offset });
  } catch (error) {
    logger.error('List sessions failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /api/chat/sessions/:id - Get session with messages
router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await sessionService.getSession(req.params.id, req.user!.userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages = await sessionService.getSessionMessages(session.id);

    res.json({ ...session, messages });
  } catch (error) {
    logger.error('Get session failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// PATCH /api/chat/sessions/:id - Update session
router.patch('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const data = updateSessionSchema.parse(req.body);
    const session = await sessionService.updateSession(
      req.params.id,
      req.user!.userId,
      data
    );

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Update session failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// DELETE /api/chat/sessions/:id - Delete session
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await sessionService.deleteSession(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete session failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// POST /api/chat/sessions/:id/send - Send message
router.post('/sessions/:id/send', rateLimit, async (req: Request, res: Response) => {
  try {
    const data = sendMessageSchema.parse(req.body);

    // Verify session ownership
    const session = await sessionService.getSession(req.params.id, req.user!.userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (data.stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream = chatService.streamMessage({
        sessionId: session.id,
        userId: req.user!.userId,
        message: data.message,
        mode: session.mode,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          res.write(`data: ${JSON.stringify({ type: 'status', status: chunk.status })}\n\n`);
        } else if (chunk.type === 'content') {
          res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
        } else if (chunk.type === 'done') {
          res.write(`data: ${JSON.stringify({ type: 'done', messageId: chunk.messageId, tokensUsed: chunk.tokensUsed })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Non-streaming response
      const result = await chatService.processMessage({
        sessionId: session.id,
        userId: req.user!.userId,
        message: data.message,
        mode: session.mode,
      });

      res.json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Send message failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
