import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware.js';
import * as sessionService from './session.service.js';
import * as chatService from './chat.service.js';
import * as startupService from './startup.service.js';
import * as sessionActivityService from './session-activity.service.js';
import * as ttsService from '../llm/tts.service.js';
import * as documentsService from '../abilities/documents.service.js';
import { incrementRateLimit, incrementRateLimitCustom } from '../db/redis.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const router = Router();

// Apply authentication to all chat routes
router.use(authenticate);

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5, // Max 5 files per request
  },
});

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
  mode: z.enum(['assistant', 'companion', 'voice', 'dj_luna']).optional(),
});

const sendMessageSchema = z.object({
  message: z.string().min(1).max(32000),
  stream: z.boolean().optional(),
  projectMode: z.boolean().optional(),
  thinkingMode: z.boolean().optional(),
  novaMode: z.boolean().optional(),
});

const updateSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  mode: z.enum(['assistant', 'companion', 'voice', 'dj_luna']).optional(),
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

// POST /api/chat/sessions/:id/end - End session and trigger memory consolidation
// Called when browser closes (beforeunload) or user explicitly ends session
router.post('/sessions/:id/end', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user!.userId;

    // Verify session belongs to user
    const session = await sessionService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // End session explicitly (triggers MemoryCore consolidation)
    const success = await sessionActivityService.endSessionExplicitly(sessionId, userId);

    if (success) {
      logger.info('Session ended via API', { sessionId, userId });
      res.json({ success: true, message: 'Session consolidated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to consolidate session' });
    }
  } catch (error) {
    logger.error('End session failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// POST /api/chat/sessions/:id/startup - Generate dynamic startup greeting
router.post('/sessions/:id/startup', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.id;

    // Verify session ownership
    const session = await sessionService.getSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Check if session already has messages (prevent duplicate startup)
    const existingMessages = await sessionService.getSessionMessages(sessionId, { limit: 1 });
    if (existingMessages.length > 0) {
      res.status(400).json({ error: 'Session already has messages' });
      return;
    }

    // Generate startup message (returns null for assistant mode)
    const result = await startupService.generateStartupMessage(userId, sessionId, session.mode);

    if (result === null) {
      // Assistant mode: no startup message
      res.json({ message: null, suggestions: [] });
      return;
    }

    res.json(result);
  } catch (error) {
    logger.error('Startup generation failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to generate startup message' });
  }
});

// POST /api/chat/sessions/:id/send - Send message (supports file attachments)
router.post('/sessions/:id/send', rateLimit, upload.array('files', 5), async (req: Request, res: Response) => {
  try {
    // Parse request - support both JSON and FormData
    let data: any;
    let documentIds: string[] = [];

    if (req.is('multipart/form-data')) {
      // FormData request with potential file uploads
      data = {
        message: req.body.message,
        stream: req.body.stream === 'true' || req.body.stream === true,
        projectMode: req.body.projectMode === 'true' || req.body.projectMode === true,
        thinkingMode: req.body.thinkingMode === 'true' || req.body.thinkingMode === true,
        novaMode: req.body.novaMode === 'true' || req.body.novaMode === true,
      };

      // Process uploaded files
      const files = req.files as Express.Multer.File[];
      if (files && files.length > 0) {
        logger.info('Processing file uploads', { count: files.length, sessionId: req.params.id });

        for (const file of files) {
          try {
            const document = await documentsService.uploadDocument(req.user!.userId, file);
            documentIds.push(document.id);
          } catch (uploadError) {
            logger.error('File upload failed', {
              error: (uploadError as Error).message,
              filename: file.originalname
            });
            // Continue with other files
          }
        }
      }
    } else {
      // Standard JSON request
      data = sendMessageSchema.parse(req.body);
    }

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
        projectMode: data.projectMode,
        thinkingMode: data.thinkingMode,
        novaMode: data.novaMode,
        documentIds: documentIds.length > 0 ? documentIds : undefined,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          res.write(`data: ${JSON.stringify({ type: 'status', status: chunk.status })}\n\n`);
        } else if (chunk.type === 'reasoning') {
          res.write(`data: ${JSON.stringify({ type: 'reasoning', content: chunk.content })}\n\n`);
        } else if (chunk.type === 'content') {
          res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
        } else if (chunk.type === 'browser_action') {
          res.write(`data: ${JSON.stringify({ type: 'browser_action', action: chunk.action, url: chunk.url })}\n\n`);
        } else if (chunk.type === 'done') {
          res.write(`data: ${JSON.stringify({
            type: 'done',
            messageId: chunk.messageId,
            tokensUsed: chunk.tokensUsed,
            metrics: chunk.metrics,
          })}\n\n`);
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
        projectMode: data.projectMode,
        thinkingMode: data.thinkingMode,
        novaMode: data.novaMode,
        documentIds: documentIds.length > 0 ? documentIds : undefined,
      });

      res.json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Send message failed', { error: (error as Error).message });
    if (res.headersSent) {
      // Streaming was started, send error via SSE and end
      res.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
});

// TTS rate limiting - 10 requests per minute
async function ttsRateLimit(req: Request, res: Response, next: () => void) {
  const userId = req.user!.userId;
  const count = await incrementRateLimitCustom(`tts:${userId}`, 60); // 1 minute window

  res.setHeader('X-RateLimit-Limit', '10');
  res.setHeader('X-RateLimit-Remaining', Math.max(0, 10 - count).toString());

  if (count > 10) {
    res.status(429).json({
      error: 'TTS rate limit exceeded',
      retryAfter: 60,
    });
    return;
  }

  next();
}

const ttsSchema = z.object({
  text: z.string().min(1).max(5000),   // ElevenLabs v3 allows 5k chars
  voiceId: z.string().optional(),       // Override default voice
  stream: z.boolean().optional(),       // Request streaming response
  voiceSettings: z.object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
  }).optional(),
});

// POST /api/chat/tts - Text to speech (ElevenLabs)
router.post('/tts', ttsRateLimit, async (req: Request, res: Response) => {
  try {
    // Check if ElevenLabs is enabled
    if (!ttsService.isEnabled()) {
      res.status(503).json({ error: 'TTS service not configured' });
      return;
    }

    const data = ttsSchema.parse(req.body);

    if (data.stream) {
      // Streaming response
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');

      const audioStream = await ttsService.streamSpeech({
        text: data.text,
        voiceId: data.voiceId,
        voiceSettings: data.voiceSettings,
      });

      // Pipe the audio stream to the response
      audioStream.pipe(res);

      audioStream.on('error', (error) => {
        logger.error('TTS stream error', { error: error.message });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream failed' });
        }
      });
    } else {
      // Buffered response
      const audioBuffer = await ttsService.synthesizeSpeech({
        text: data.text,
        voiceId: data.voiceId,
        voiceSettings: data.voiceSettings,
      });

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.send(audioBuffer);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('TTS failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to synthesize speech' });
  }
});

const editMessageSchema = z.object({
  content: z.string().min(1).max(32000),
});

// PATCH /api/chat/sessions/:sessionId/messages/:messageId - Edit message
router.patch('/sessions/:sessionId/messages/:messageId', async (req: Request, res: Response) => {
  try {
    const data = editMessageSchema.parse(req.body);

    // Verify session ownership
    const session = await sessionService.getSession(req.params.sessionId, req.user!.userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Update the message
    const updated = await sessionService.updateMessage(
      req.params.messageId,
      req.params.sessionId,
      data.content
    );

    if (!updated) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Edit message failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// POST /api/chat/sessions/:sessionId/messages/:messageId/regenerate - Regenerate response
router.post('/sessions/:sessionId/messages/:messageId/regenerate', rateLimit, async (req: Request, res: Response) => {
  try {
    // Verify session ownership
    const session = await sessionService.getSession(req.params.sessionId, req.user!.userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Get the message to regenerate from
    const messages = await sessionService.getSessionMessages(session.id);
    const messageIndex = messages.findIndex(m => m.id === req.params.messageId);

    if (messageIndex === -1) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const targetMessage = messages[messageIndex];

    // Find the user message to regenerate from
    let userMessageContent: string;
    let deleteFromIndex: number;

    if (targetMessage.role === 'assistant') {
      // Find the preceding user message
      const userMessage = messages.slice(0, messageIndex).reverse().find(m => m.role === 'user');
      if (!userMessage) {
        res.status(400).json({ error: 'No user message found to regenerate from' });
        return;
      }
      userMessageContent = userMessage.content;
      deleteFromIndex = messages.findIndex(m => m.id === userMessage.id);
    } else if (targetMessage.role === 'user') {
      userMessageContent = targetMessage.content;
      deleteFromIndex = messageIndex;
    } else {
      res.status(400).json({ error: 'Cannot regenerate from system messages' });
      return;
    }

    // Delete messages from the target onwards
    const messagesToDelete = messages.slice(deleteFromIndex);
    for (const msg of messagesToDelete) {
      await sessionService.deleteMessage(msg.id, session.id);
    }

    // Streaming response for regeneration
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = chatService.streamMessage({
      sessionId: session.id,
      userId: req.user!.userId,
      message: userMessageContent,
      mode: session.mode,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'status') {
        res.write(`data: ${JSON.stringify({ type: 'status', status: chunk.status })}\n\n`);
      } else if (chunk.type === 'reasoning') {
        res.write(`data: ${JSON.stringify({ type: 'reasoning', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'content') {
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'browser_action') {
        res.write(`data: ${JSON.stringify({ type: 'browser_action', action: chunk.action, url: chunk.url })}\n\n`);
      } else if (chunk.type === 'done') {
        res.write(`data: ${JSON.stringify({
          type: 'done',
          messageId: chunk.messageId,
          tokensUsed: chunk.tokensUsed,
          metrics: chunk.metrics,
        })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    logger.error('Regenerate message failed', { error: (error as Error).message });
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to regenerate message' });
    }
  }
});

export default router;
