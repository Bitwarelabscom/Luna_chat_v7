import { Router, Request, Response } from 'express';
import * as projectService from './project.service.js';
import logger from '../utils/logger.js';

const router = Router();

// Helper to get user ID from request
function getUserId(req: Request): string {
  return (req as Request & { user?: { userId: string } }).user?.userId || '';
}

/**
 * GET /api/projects - List user's projects
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const projects = await projectService.getUserProjects(userId);
    res.json({ projects });
  } catch (error) {
    logger.error('Failed to list projects', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * GET /api/projects/active - Get active project
 */
router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const project = await projectService.getActiveProject(userId);
    res.json({ project });
  } catch (error) {
    logger.error('Failed to get active project', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get active project' });
  }
});

/**
 * GET /api/projects/:id - Get project by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const project = await projectService.getProject(id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Verify ownership
    const userId = getUserId(req);
    if (project.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ project });
  } catch (error) {
    logger.error('Failed to get project', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * POST /api/projects - Create new project
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { name, description, type, sessionId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const project = await projectService.createProject(
      userId,
      sessionId || null,
      name,
      description || '',
      type || 'web'
    );

    res.status(201).json({ project });
  } catch (error) {
    logger.error('Failed to create project', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * PUT /api/projects/:id/status - Update project status
 */
router.put('/:id/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, currentStep } = req.body;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await projectService.updateProjectStatus(id, status, currentStep);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update project status', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update project status' });
  }
});

/**
 * POST /api/projects/:id/questions - Set project questions
 */
router.post('/:id/questions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { questions } = req.body;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await projectService.setProjectQuestions(id, questions);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to set project questions', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set project questions' });
  }
});

/**
 * POST /api/projects/:id/answers - Save answers to project questions
 */
router.post('/:id/answers', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { answers } = req.body;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await projectService.saveProjectAnswers(id, answers);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to save project answers', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to save project answers' });
  }
});

/**
 * POST /api/projects/:id/plan - Set project plan
 */
router.post('/:id/plan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { steps } = req.body;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const createdSteps = await projectService.setProjectPlan(id, steps);
    res.json({ success: true, steps: createdSteps });
  } catch (error) {
    logger.error('Failed to set project plan', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set project plan' });
  }
});

/**
 * PUT /api/projects/:id/steps/:stepNumber - Update step status
 */
router.put('/:id/steps/:stepNumber', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, stepNumber } = req.params;
    const { status, result, error } = req.body;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await projectService.updateStepStatus(id, parseInt(stepNumber), status, result, error);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update step status', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update step status' });
  }
});

/**
 * GET /api/projects/:id/files - List project files
 */
router.get('/:id/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const files = await projectService.listProjectFiles(userId, project.name);
    res.json({ files });
  } catch (error) {
    logger.error('Failed to list project files', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list project files' });
  }
});

/**
 * GET /api/projects/:id/files/:filename - Read project file
 */
router.get('/:id/files/*', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const filename = req.params[0]; // Everything after /files/
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const content = await projectService.readProjectFile(userId, project.name, filename);
    res.json({ content, filename });
  } catch (error) {
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    logger.error('Failed to read project file', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to read project file' });
  }
});

/**
 * POST /api/projects/:id/files - Write project file
 */
router.post('/:id/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { filename, content, fileType } = req.body;
    const userId = getUserId(req);

    const project = await projectService.getProject(id);
    if (!project || project.userId !== userId) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!filename || content === undefined) {
      res.status(400).json({ error: 'Filename and content are required' });
      return;
    }

    const file = await projectService.writeProjectFile(
      id, userId, project.name, filename, content, fileType
    );

    res.status(201).json({ file });
  } catch (error) {
    logger.error('Failed to write project file', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to write project file' });
  }
});

/**
 * DELETE /api/projects/:id - Delete project
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const deleted = await projectService.deleteProject(id, userId);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete project', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
