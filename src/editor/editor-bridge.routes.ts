import { Router, Request, Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { getOrCreateEditorMapping, syncEditorToFile, isTextFile } from './editor-bridge.service.js';
import logger from '../utils/logger.js';

const router = Router();

router.use(authenticate);

function getUserId(req: Request): string {
  return (req as Request & { user?: { userId: string } }).user?.userId || '';
}

/**
 * GET /api/editor/bridge/workspace/:filename
 * Get or create editor mapping for a workspace file
 */
router.get('/workspace/:filename', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const filename = decodeURIComponent(req.params.filename);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!isTextFile(filename)) {
      res.status(400).json({ error: 'Only text files can be opened in the editor' });
      return;
    }

    const result = await getOrCreateEditorMapping(userId, 'workspace', filename);
    res.json(result);
  } catch (error) {
    logger.error('Failed to get workspace editor mapping', { error });
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/editor/bridge/project/:projectId/:filename
 * Get or create editor mapping for a project file
 */
router.get('/project/:projectId/:filename', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { projectId } = req.params;
    const filename = decodeURIComponent(req.params.filename);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!isTextFile(filename)) {
      res.status(400).json({ error: 'Only text files can be opened in the editor' });
      return;
    }

    const sourceId = `${projectId}:${filename}`;
    const result = await getOrCreateEditorMapping(userId, 'project', sourceId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to get project editor mapping', { error });
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/editor/bridge/sync/:documentId
 * Sync editor content back to the source file
 */
router.post('/sync/:documentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const documentId = decodeURIComponent(req.params.documentId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await syncEditorToFile(userId, documentId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to sync editor to file', { error });
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
