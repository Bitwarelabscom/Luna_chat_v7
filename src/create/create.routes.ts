import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as createService from './create-request.service.js';
import logger from '../utils/logger.js';

const router = Router();

router.use(authenticate as RequestHandler);

const ideaSchema = z.object({
  idea: z.string().min(10, 'Idea must be at least 10 characters').max(1000, 'Idea must be under 1000 characters'),
});

// POST /api/create/request - Submit a music idea
router.post('/request', async (req: Request, res: Response) => {
  try {
    const { idea } = ideaSchema.parse(req.body);
    const result = await createService.submitCreateRequest(req.user!.userId, idea);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    const message = (error as Error).message;
    if (message.includes('wait at least')) {
      res.status(429).json({ error: message });
      return;
    }
    logger.error('Failed to submit create request', { error: message });
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// GET /api/create/requests - List user's requests
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const requests = await createService.listRequests(req.user!.userId);
    res.json({ requests });
  } catch (error) {
    logger.error('Failed to list create requests', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list requests' });
  }
});

// GET /api/create/requests/:id - Get request detail with song progress
router.get('/requests/:id', async (req: Request, res: Response) => {
  try {
    const detail = await createService.getRequestDetail(req.user!.userId, req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    res.json(detail);
  } catch (error) {
    logger.error('Failed to get create request', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get request' });
  }
});

export default router;
