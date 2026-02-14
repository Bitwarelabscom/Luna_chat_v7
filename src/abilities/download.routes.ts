import { Router, type Request, type Response } from 'express';
import { createReadStream, statSync } from 'fs';
import path from 'path';
import { authenticate } from '../auth/auth.middleware.js';
import * as ytdlp from './ytdlp.service.js';
import logger from '../utils/logger.js';

const router = Router();

// MIME types for media files
const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

// Media root for path validation
const MEDIA_ROOT = '/mnt/data/media';

// All routes require authentication
router.use(authenticate);

// Allow cross-origin media requests (needed for browser <video> elements on different ports)
router.use((_req: Request, res: Response, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

/**
 * GET /api/media/stream/:id - Stream a local media file
 * Supports HTTP Range requests for seeking
 */
router.get('/stream/:id', (req: Request, res: Response): void => {
  try {
    // Decode base64url ID to file path
    const filePath = Buffer.from(req.params.id, 'base64url').toString();

    // Validate path is under media root (prevent path traversal)
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(MEDIA_ROOT)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Get file stats
    let stat;
    try {
      stat = statSync(resolved);
    } catch (_err) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const fileSize = stat.size;
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Handle Range requests (needed for video seeking)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      createReadStream(resolved, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      createReadStream(resolved).pipe(res);
    }
  } catch (error) {
    logger.error('Stream failed', { id: req.params.id, error: (error as Error).message });
    res.status(500).json({ error: 'Stream failed' });
  }
});

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
