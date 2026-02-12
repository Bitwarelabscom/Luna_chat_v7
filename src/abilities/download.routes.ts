import { Router, type Request, type Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as ytdlp from './ytdlp.service.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/media/download - Start a download
 */
router.post('/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoId, title, format } = req.body;

    if (!videoId || !title || !format) {
      res.status(400).json({ error: 'Missing required fields: videoId, title, format' });
      return;
    }

    if (format !== 'video' && format !== 'audio') {
      res.status(400).json({ error: 'Format must be "video" or "audio"' });
      return;
    }

    // Validate videoId format (alphanumeric + hyphens/underscores, 11 chars for YouTube)
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(videoId)) {
      res.status(400).json({ error: 'Invalid video ID format' });
      return;
    }

    logger.info('Download requested', { videoId, title, format });

    const job = format === 'audio'
      ? await ytdlp.downloadAudio(videoId, title)
      : await ytdlp.downloadVideo(videoId, title);

    res.json({ downloadId: job.id, status: job.status });
  } catch (error) {
    logger.error('Download start failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to start download' });
  }
});

/**
 * GET /api/media/download/:id/status - Check download progress
 */
router.get('/download/:id/status', (req: Request, res: Response): void => {
  const job = ytdlp.getDownloadStatus(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Download not found' });
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    filePath: job.filePath,
    error: job.error,
    duration: job.completedAt ? job.completedAt - job.startedAt : Date.now() - job.startedAt,
  });
});

/**
 * GET /api/media/downloads - List recent downloads
 */
router.get('/downloads', (_req: Request, res: Response): void => {
  const jobs = ytdlp.getAllDownloads();
  res.json({ downloads: jobs });
});

export default router;
