import { Router, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware.js';
import * as backgroundService from './background.service.js';
import logger from '../utils/logger.js';

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Helper to get userId from authenticated request
function getUserId(req: Request): string {
  return req.user!.userId;
}

// All routes require authentication
router.use(authenticate as RequestHandler);

/**
 * GET /api/backgrounds - List user's backgrounds
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const backgrounds = await backgroundService.getUserBackgrounds(getUserId(req));
    res.json({ backgrounds });
  } catch (error) {
    logger.error('Failed to get backgrounds', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get backgrounds' });
  }
});

/**
 * GET /api/backgrounds/active - Get user's active background
 */
router.get('/active', async (req: Request, res: Response) => {
  try {
    const background = await backgroundService.getActiveBackground(getUserId(req));
    res.json({ background });
  } catch (error) {
    logger.error('Failed to get active background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get active background' });
  }
});

/**
 * POST /api/backgrounds/generate - Generate a new background
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, style, setActive } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const result = await backgroundService.generateBackground(
      getUserId(req),
      prompt,
      style || 'custom'
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Optionally set as active immediately
    if (setActive && result.background) {
      await backgroundService.setActiveBackground(getUserId(req), result.background.id);
      result.background.isActive = true;
    }

    res.status(201).json({ background: result.background });
  } catch (error) {
    logger.error('Failed to generate background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to generate background' });
  }
});

/**
 * POST /api/backgrounds/upload - Upload a custom background
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const result = await backgroundService.uploadBackground(getUserId(req), {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
    });

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({ background: result.background });
  } catch (error) {
    logger.error('Failed to upload background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to upload background' });
  }
});

/**
 * GET /api/backgrounds/generated-images - List generated chat images for this user
 */
router.get('/generated-images', async (req: Request, res: Response) => {
  try {
    const images = await backgroundService.listUserGeneratedImages(getUserId(req));
    res.json({ images });
  } catch (error) {
    logger.error('Failed to get generated images for backgrounds', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get generated images' });
  }
});

/**
 * POST /api/backgrounds/from-generated - Import generated chat image as background
 */
router.post('/from-generated', async (req: Request, res: Response) => {
  try {
    const { filename, setActive } = req.body;
    if (!filename || typeof filename !== 'string') {
      res.status(400).json({ error: 'filename is required' });
      return;
    }

    const result = await backgroundService.importGeneratedImageAsBackground(getUserId(req), filename);
    if (!result.success || !result.background) {
      res.status(400).json({ error: result.error || 'Failed to import generated image' });
      return;
    }

    const shouldSetActive = setActive !== false;
    if (shouldSetActive) {
      await backgroundService.setActiveBackground(getUserId(req), result.background.id);
      result.background.isActive = true;
    }

    res.status(201).json({ background: result.background });
  } catch (error) {
    logger.error('Failed to import generated image as background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to import generated image as background' });
  }
});

/**
 * PUT /api/backgrounds/:id/activate - Set a background as active
 */
router.put('/:id/activate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await backgroundService.setActiveBackground(getUserId(req), id);

    if (!result.success) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({ success: true, background: result.background });
  } catch (error) {
    logger.error('Failed to activate background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to activate background' });
  }
});

/**
 * PUT /api/backgrounds/reset - Reset to default (no active background)
 */
router.put('/reset', async (req: Request, res: Response) => {
  try {
    const result = await backgroundService.setActiveBackground(getUserId(req), null);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to reset background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to reset background' });
  }
});

/**
 * DELETE /api/backgrounds/:id - Delete a background
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await backgroundService.deleteBackground(getUserId(req), id);

    if (!result.success) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete background', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete background' });
  }
});

export default router;
