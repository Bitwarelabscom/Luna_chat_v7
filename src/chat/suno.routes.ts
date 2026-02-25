import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as sunoService from '../abilities/suno-generator.service.js';
import logger from '../utils/logger.js';

// ============================================================
// Authenticated router - mounts at /api/suno
// ============================================================

const router = Router();
router.use(authenticate as RequestHandler);

const generateSchema = z.object({
  count: z.number().int().min(1).max(10),
  style_override: z.string().max(500).optional(),
  lyrics: z.string().max(5000).optional(),
  title: z.string().max(300).optional(),
});

const generationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// POST /api/suno/generate
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { count, style_override, lyrics, title } = generateSchema.parse(req.body);
    const generations = await sunoService.triggerBatch(req.user!.userId, count, style_override, lyrics, title);
    res.status(201).json({ generations, count: generations.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to trigger suno generation', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to trigger generation' });
  }
});

// GET /api/suno/generations
router.get('/generations', async (req: Request, res: Response) => {
  try {
    const { limit } = generationsQuerySchema.parse(req.query);
    const generations = await sunoService.listGenerations(req.user!.userId, limit ?? 50);
    res.json({ generations });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to list suno generations', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list generations' });
  }
});

export default router;

// ============================================================
// Webhook router - no auth, mounts at /api/webhooks
// Protected by Docker-internal network only (172.x.x.x)
// ============================================================

const callbackSchema = z.object({
  taskId: z.string().min(1).max(200),
  userId: z.string().optional(),
  title: z.string().max(300).optional(),
  style: z.string().max(1000).optional(),
  bpm: z.number().optional(),
  key: z.string().max(20).optional(),
  audioUrl: z.string().url().optional(),
  duration: z.number().optional(),
  sunoId: z.string().max(200).optional(),
  status: z.string().max(20).optional(),
  error: z.string().max(1000).optional(),
});

export const sunoWebhookRouter = Router();

// POST /api/webhooks/suno-complete
sunoWebhookRouter.post('/suno-complete', (req: Request, res: Response) => {
  // Respond immediately - processing happens in background
  let payload: z.infer<typeof callbackSchema>;
  try {
    payload = callbackSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  res.json({ received: true });

  // Process async in background
  sunoService.handleCallback(payload).catch(err => {
    logger.error('Suno callback processing failed', { taskId: payload.taskId, error: (err as Error).message });
  });
});
