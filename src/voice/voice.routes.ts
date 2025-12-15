/**
 * Voice Luna Routes
 *
 * Fast voice chat API endpoints that bypass the layered agent.
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as voiceChat from '../chat/voice-chat.service.js';
import logger from '../utils/logger.js';

// Helper to get userId from authenticated request
function getUserId(req: Request): string {
  return req.user!.userId;
}

const router = Router();

// All routes require authentication
router.use(authenticate as RequestHandler);

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * Get or create a voice session
 * POST /api/voice/session
 */
router.post('/session', async (req: Request, res: Response) => {
  try {
    const sessionId = await voiceChat.getOrCreateVoiceSession(getUserId(req));
    res.json({ sessionId });
  } catch (error) {
    logger.error('Failed to create voice session', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create voice session' });
  }
});

/**
 * Get session messages
 * GET /api/voice/session/:sessionId/messages
 */
router.get('/session/:sessionId/messages', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await voiceChat.getSessionMessages(sessionId, limit);
    res.json(messages);
  } catch (error) {
    logger.error('Failed to get voice messages', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get voice messages' });
  }
});

/**
 * Delete a voice session
 * DELETE /api/voice/session/:sessionId
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const deleted = await voiceChat.deleteSession(sessionId, getUserId(req));
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    logger.error('Failed to delete voice session', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete voice session' });
  }
});

// ============================================
// MESSAGING
// ============================================

const sendMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
});

/**
 * Send a voice chat message
 * POST /api/voice/session/:sessionId/send
 *
 * This is the fast path - no streaming, direct response for TTS
 */
router.post('/session/:sessionId/send', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const body = sendMessageSchema.parse(req.body);

    const result = await voiceChat.processMessage({
      sessionId,
      userId: getUserId(req),
      message: body.message,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to process voice message', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to process voice message' });
  }
});

export default router;
