import express, { Request, Response } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as canvasService from './canvas.service.js';
import { CanvasError } from './canvas.service.js';
import fsp from 'fs/promises';

const router = express.Router();

function inferDownloadMetadata(type: 'code' | 'text', language: string | undefined, title: string): { filename: string; contentType: string } {
  const extensionMap: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    html: 'html',
    css: 'css',
    markdown: 'md',
    json: 'json',
    sql: 'sql',
    rust: 'rs',
    cpp: 'cpp',
    java: 'java',
    text: 'txt',
  };

  const contentTypeMap: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    javascript: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    markdown: 'text/markdown; charset=utf-8',
    sql: 'text/plain; charset=utf-8',
  };

  const safeBase = (title || 'artifact')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'artifact';

  const key = (language || (type === 'text' ? 'text' : '')).toLowerCase();
  const ext = extensionMap[key] || (type === 'text' ? 'txt' : 'txt');
  const contentType = contentTypeMap[key] || 'text/plain; charset=utf-8';
  return { filename: `${safeBase}.${ext}`, contentType };
}

/**
 * Helper function to handle Canvas errors consistently
 */
function handleCanvasError(error: unknown, res: Response): void {
  if (error instanceof CanvasError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      UNAUTHORIZED: 403,
      INVALID_INPUT: 400,
      DATABASE_ERROR: 500,
    };
    const status = statusMap[error.code] || 500;
    res.status(status).json({ error: error.message, code: error.code });
  } else {
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * List recent artifacts (optionally scoped to a session)
 */
router.get('/artifacts', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const parsedLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const artifacts = await canvasService.listArtifacts(userId, { sessionId, limit });
    res.json(artifacts);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Get artifact with all versions
 */
router.get('/artifacts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const artifactId = req.params.id;
    const artifact = await canvasService.getArtifact(userId, artifactId);
    res.json(artifact);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Download a specific artifact version (or current version)
 */
router.get('/artifacts/:id/download', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const artifactId = req.params.id;
    const parsedIndex = typeof req.query.index === 'string' ? parseInt(req.query.index, 10) : undefined;
    const index = Number.isFinite(parsedIndex) ? parsedIndex : undefined;
    const version = await canvasService.getArtifactVersion(userId, artifactId, index);
    const { filename, contentType } = inferDownloadMetadata(version.type, version.language, version.title);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(version.content);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * List artifact snapshots (project-level versions)
 */
router.get('/artifacts/:id/snapshots', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const snapshots = await canvasService.listArtifactSnapshots(userId, req.params.id);
    res.json(snapshots);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * List artifact files (current working set or specific snapshot)
 */
router.get('/artifacts/:id/files', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsedIndex = typeof req.query.index === 'string' ? parseInt(req.query.index, 10) : undefined;
    const index = Number.isFinite(parsedIndex) ? parsedIndex : undefined;
    const files = await canvasService.listArtifactFiles(userId, req.params.id, index);
    res.json(files);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Save one DB-backed artifact file and create a new snapshot version
 */
router.post('/artifacts/:id/files', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { path, content, language } = req.body;
    if (typeof path !== 'string' || typeof content !== 'string') {
      res.status(400).json({ error: 'path and content are required' });
      return;
    }
    const result = await canvasService.saveArtifactFile(userId, req.params.id, path, content, language);
    res.json(result);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Generate an image asset for an artifact project and optionally auto-insert into HTML
 */
router.post('/artifacts/:id/images/generate', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { prompt, filename, autoInsert } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    const result = await canvasService.generateArtifactImage(userId, req.params.id, prompt, {
      filename: typeof filename === 'string' ? filename : undefined,
      autoInsert: autoInsert !== false,
    });
    res.json(result);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Serve artifact-local filesystem assets for preview (authenticated)
 */
router.get('/artifacts/:id/assets/*', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const requestedPath = req.params[0];
    const resolved = await canvasService.resolveArtifactAssetPath(userId, req.params.id, requestedPath);
    if (resolved.mimeType) {
      res.type(resolved.mimeType);
    }
    res.sendFile(resolved.absolutePath);
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Export artifact project snapshot as ZIP
 */
router.get('/artifacts/:id/export.zip', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsedIndex = typeof req.query.index === 'string' ? parseInt(req.query.index, 10) : undefined;
    const index = Number.isFinite(parsedIndex) ? parsedIndex : undefined;
    const result = await canvasService.buildArtifactExportZip(userId, req.params.id, index);
    res.download(result.zipPath, result.filename, async () => {
      try {
        await fsp.unlink(result.zipPath);
      } catch {
        // best effort cleanup
      }
    });
  } catch (error) {
    handleCanvasError(error, res);
  }
});

/**
 * Navigate to specific version
 */
router.post('/artifacts/:id/navigate', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const artifactId = req.params.id;
    const { index } = req.body;

    if (typeof index !== 'number') {
      res.status(400).json({ error: 'Invalid index' });
      return;
    }

    const result = await canvasService.navigateToVersion(userId, artifactId, index);
    res.json(result);
  } catch (error: any) {
    console.error('Error navigating to version:', error);
    if (error.message === 'Artifact not found' || error.message === 'Version not found') {
      res.status(404).json({ error: error.message });
    } else if (error.message === 'Unauthorized') {
      res.status(403).json({ error: 'Unauthorized' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * Get user's reflections (style rules and content preferences)
 */
router.get('/reflections', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reflections = await canvasService.getUserReflections(userId);
    res.json(reflections);
  } catch (error) {
    console.error('Error fetching reflections:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Add a reflection
 */
router.post('/reflections', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { type, value } = req.body;

    if (!type || !value) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (type !== 'style_rule' && type !== 'content') {
      res.status(400).json({ error: 'Invalid reflection type' });
      return;
    }

    const reflection = await canvasService.addReflection(userId, type, value);
    res.json(reflection);
  } catch (error) {
    console.error('Error adding reflection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get user's canvas style rules (from Neo4j)
 */
router.get('/style-rules', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const styleRules = await canvasService.getStyleRules(userId, limit);
    res.json(styleRules);
  } catch (error) {
    console.error('Error fetching style rules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Add a canvas style rule (to Neo4j)
 */
router.post('/style-rules', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { rule } = req.body;

    if (!rule || typeof rule !== 'string') {
      res.status(400).json({ error: 'Missing or invalid rule field' });
      return;
    }

    const success = await canvasService.addStyleRule(userId, rule);
    res.json({ success, rule });
  } catch (error) {
    console.error('Error adding style rule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Delete a canvas style rule (from Neo4j)
 */
router.delete('/style-rules', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { rule } = req.body;

    if (!rule || typeof rule !== 'string') {
      res.status(400).json({ error: 'Missing or invalid rule field' });
      return;
    }

    const success = await canvasService.deleteStyleRule(userId, rule);
    res.json({ success });
  } catch (error) {
    console.error('Error deleting style rule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get user's detected patterns (for review before promotion)
 */
router.get('/patterns', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { query: dbQuery } = await import('../db/postgres.js');
    const patterns: any = await dbQuery(
      `SELECT id, pattern_type, description, occurrences, confidence, examples, promoted_to_rule, created_at, updated_at
       FROM pattern_detections
       WHERE user_id = $1
       ORDER BY confidence DESC, occurrences DESC`,
      [userId]
    );

    res.json(patterns.map((p: any) => ({
      id: p.id,
      patternType: p.pattern_type,
      description: p.description,
      occurrences: p.occurrences,
      confidence: p.confidence,
      examples: p.examples,
      promotedToRule: p.promoted_to_rule,
      createdAt: p.created_at,
      updatedAt: p.updated_at
    })));
  } catch (error) {
    console.error('Error fetching patterns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manually promote a pattern to a style rule
 */
router.post('/patterns/:id/promote', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const patternId = req.params.id;
    const { query: dbQuery } = await import('../db/postgres.js');

    // Get pattern
    const patterns: any = await dbQuery(
      `SELECT pattern_type, description, promoted_to_rule FROM pattern_detections
       WHERE id = $1 AND user_id = $2`,
      [patternId, userId]
    );

    if (patterns.length === 0) {
      res.status(404).json({ error: 'Pattern not found' });
      return;
    }

    if (patterns[0].promoted_to_rule) {
      res.status(400).json({ error: 'Pattern already promoted' });
      return;
    }

    // Generate style rule
    const styleRule = req.body.customRule || canvasService.generateStyleRuleFromPattern(
      patterns[0].pattern_type,
      patterns[0].description
    );

    // Add to Neo4j
    const success = await canvasService.addStyleRule(userId, styleRule);

    if (!success) {
      res.status(500).json({ error: 'Failed to add style rule' });
      return;
    }

    // Mark as promoted
    await dbQuery(
      `UPDATE pattern_detections
       SET promoted_to_rule = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [patternId]
    );

    res.json({ success: true, styleRule });
  } catch (error) {
    console.error('Error promoting pattern:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Dismiss a pattern (delete it)
 */
router.delete('/patterns/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const patternId = req.params.id;
    const { query: dbQuery } = await import('../db/postgres.js');

    await dbQuery(
      `DELETE FROM pattern_detections WHERE id = $1 AND user_id = $2`,
      [patternId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting pattern:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get user's quick actions
 */
router.get('/quick-actions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const quickActions = await canvasService.getUserQuickActions(userId);
    res.json(quickActions);
  } catch (error) {
    console.error('Error fetching quick actions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create a quick action
 */
router.post('/quick-actions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { title, prompt, includeReflections, includePrefix, includeRecentHistory } = req.body;

    if (!title || !prompt) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const quickAction = await canvasService.createQuickAction(
      userId,
      title,
      prompt,
      includeReflections,
      includePrefix,
      includeRecentHistory
    );

    res.json(quickAction);
  } catch (error) {
    console.error('Error creating quick action:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Delete a quick action
 */
router.delete('/quick-actions/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const actionId = req.params.id;
    await canvasService.deleteQuickAction(userId, actionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting quick action:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
