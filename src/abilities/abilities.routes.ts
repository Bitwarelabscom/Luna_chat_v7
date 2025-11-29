import { Router, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware.js';
import * as knowledge from './knowledge.service.js';
import * as tasks from './tasks.service.js';
import * as sandbox from './sandbox.service.js';
import * as workspace from './workspace.service.js';
import * as documents from './documents.service.js';
import * as tools from './tools.service.js';
import * as agentsService from './agents.service.js';
import * as calendar from './calendar.service.js';
import * as emailService from './email.service.js';
import * as checkins from './checkins.service.js';
import * as mood from './mood.service.js';
import { getAbilitySummary } from './orchestrator.js';
import logger from '../utils/logger.js';

// Helper to get userId from authenticated request
function getUserId(req: Request): string {
  return req.user!.userId;
}

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// All routes require authentication
router.use(authenticate as RequestHandler);

// ============================================
// ABILITIES SUMMARY
// ============================================

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getAbilitySummary(getUserId(req));
    res.json(summary);
  } catch (error) {
    logger.error('Failed to get abilities summary', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get abilities summary' });
  }
});

// ============================================
// KNOWLEDGE BASE
// ============================================

router.get('/knowledge', async (req: Request, res: Response) => {
  try {
    const { category, limit, offset } = req.query;
    const items = await knowledge.getKnowledgeItems(getUserId(req), {
      category: category as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json(items);
  } catch (error) {
    logger.error('Failed to get knowledge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get knowledge items' });
  }
});

router.post('/knowledge', async (req: Request, res: Response) => {
  try {
    const item = await knowledge.createKnowledgeItem(getUserId(req), req.body);
    res.status(201).json(item);
  } catch (error) {
    logger.error('Failed to create knowledge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create knowledge item' });
  }
});

router.get('/knowledge/search', async (req: Request, res: Response) => {
  try {
    const { q, limit } = req.query;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }
    const items = await knowledge.searchKnowledge(
      getUserId(req),
      q as string,
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(items);
  } catch (error) {
    logger.error('Failed to search knowledge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search knowledge' });
  }
});

router.put('/knowledge/:id', async (req: Request, res: Response) => {
  try {
    const item = await knowledge.updateKnowledgeItem(getUserId(req), req.params.id, req.body);
    if (!item) {
      res.status(404).json({ error: 'Knowledge item not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    logger.error('Failed to update knowledge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update knowledge item' });
  }
});

router.delete('/knowledge/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await knowledge.deleteKnowledgeItem(getUserId(req), req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Knowledge item not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete knowledge', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete knowledge item' });
  }
});

// ============================================
// TASKS
// ============================================

router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { status, priority, upcoming, limit } = req.query;
    const taskList = await tasks.getTasks(getUserId(req), {
      status: status as string,
      priority: priority as string,
      upcoming: upcoming === 'true',
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(taskList);
  } catch (error) {
    logger.error('Failed to get tasks', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const task = await tasks.createTask(getUserId(req), req.body);
    res.status(201).json(task);
  } catch (error) {
    logger.error('Failed to create task', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.post('/tasks/parse', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    const parsed = tasks.parseTaskFromText(text);
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse task' });
  }
});

router.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const task = await tasks.updateTask(getUserId(req), req.params.id, req.body);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  } catch (error) {
    logger.error('Failed to update task', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.put('/tasks/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const task = await tasks.updateTaskStatus(getUserId(req), req.params.id, status);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  } catch (error) {
    logger.error('Failed to update task status', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await tasks.deleteTask(getUserId(req), req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete task', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ============================================
// CODE EXECUTION
// ============================================

router.post('/code/execute', async (req: Request, res: Response) => {
  try {
    const { code, language, sessionId } = req.body;
    const result = await sandbox.executeCode(code, getUserId(req), sessionId, language);
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute code', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to execute code' });
  }
});

router.get('/code/history', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const executions = await sandbox.getRecentExecutions(
      getUserId(req),
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(executions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get execution history' });
  }
});

// ============================================
// WORKSPACE (persistent file storage + execution)
// ============================================

router.get('/workspace', async (req: Request, res: Response) => {
  try {
    const files = await workspace.listFiles(getUserId(req));
    res.json(files);
  } catch (error) {
    logger.error('Failed to list workspace files', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list workspace files' });
  }
});

router.get('/workspace/stats', async (req: Request, res: Response) => {
  try {
    const stats = await workspace.getWorkspaceStats(getUserId(req));
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get workspace stats', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get workspace stats' });
  }
});

router.get('/workspace/file/:filename', async (req: Request, res: Response) => {
  try {
    const content = await workspace.readFile(getUserId(req), req.params.filename);
    res.json({ filename: req.params.filename, content });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error('Failed to read workspace file', { error: message });
    res.status(500).json({ error: 'Failed to read workspace file' });
  }
});

router.post('/workspace', async (req: Request, res: Response) => {
  try {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      res.status(400).json({ error: 'filename and content are required' });
      return;
    }
    const file = await workspace.writeFile(getUserId(req), filename, content);
    res.status(201).json(file);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Failed to write workspace file', { error: message });
    res.status(400).json({ error: message });
  }
});

router.delete('/workspace/file/:filename', async (req: Request, res: Response) => {
  try {
    const deleted = await workspace.deleteFile(getUserId(req), req.params.filename);
    if (!deleted) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete workspace file', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete workspace file' });
  }
});

router.post('/workspace/execute/:filename', async (req: Request, res: Response) => {
  try {
    const { sessionId, args } = req.body;

    // First verify file exists
    const exists = await workspace.fileExists(getUserId(req), req.params.filename);
    if (!exists) {
      res.status(404).json({ error: `File not found: ${req.params.filename}` });
      return;
    }

    const result = await sandbox.executeWorkspaceFile(
      getUserId(req),
      req.params.filename,
      sessionId,
      args || []
    );
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute workspace file', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to execute workspace file' });
  }
});

// ============================================
// DOCUMENTS
// ============================================

router.get('/documents', async (req: Request, res: Response) => {
  try {
    const { status, limit } = req.query;
    const docs = await documents.getDocuments(getUserId(req), {
      status: status as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(docs);
  } catch (error) {
    logger.error('Failed to get documents', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get documents' });
  }
});

router.post('/documents', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const doc = await documents.uploadDocument(getUserId(req), {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    res.status(201).json(doc);
  } catch (error) {
    logger.error('Failed to upload document', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

router.get('/documents/search', async (req: Request, res: Response) => {
  try {
    const { q, documentId, limit } = req.query;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }
    const chunks = await documents.searchDocuments(getUserId(req), q as string, {
      documentId: documentId as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(chunks);
  } catch (error) {
    logger.error('Failed to search documents', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

router.delete('/documents/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await documents.deleteDocument(getUserId(req), req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete document', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ============================================
// CUSTOM TOOLS
// ============================================

router.get('/tools', async (req: Request, res: Response) => {
  try {
    const { enabledOnly } = req.query;
    const toolList = await tools.getTools(getUserId(req), enabledOnly === 'true');
    res.json(toolList);
  } catch (error) {
    logger.error('Failed to get tools', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get tools' });
  }
});

router.post('/tools', async (req: Request, res: Response) => {
  try {
    const tool = await tools.createTool(getUserId(req), req.body);
    res.status(201).json(tool);
  } catch (error) {
    logger.error('Failed to create tool', { error: (error as Error).message });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/tools/:name/execute', async (req: Request, res: Response) => {
  try {
    const result = await tools.executeTool(getUserId(req), req.params.name, req.body);
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute tool', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to execute tool' });
  }
});

router.put('/tools/:id', async (req: Request, res: Response) => {
  try {
    const tool = await tools.updateTool(getUserId(req), req.params.id, req.body);
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }
    res.json(tool);
  } catch (error) {
    logger.error('Failed to update tool', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update tool' });
  }
});

router.delete('/tools/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await tools.deleteTool(getUserId(req), req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete tool', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete tool' });
  }
});

// ============================================
// AGENTS
// ============================================

router.get('/agents', async (req: Request, res: Response) => {
  try {
    const customAgents = await agentsService.getAgents(getUserId(req));
    const builtIn = agentsService.getBuiltInAgents();
    res.json({ builtIn, custom: customAgents });
  } catch (error) {
    logger.error('Failed to get agents', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get agents' });
  }
});

router.post('/agents', async (req: Request, res: Response) => {
  try {
    const agent = await agentsService.createAgent(getUserId(req), req.body);
    res.status(201).json(agent);
  } catch (error) {
    logger.error('Failed to create agent', { error: (error as Error).message });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/agents/execute', async (req: Request, res: Response) => {
  try {
    const { agentName, task, context } = req.body;
    const result = await agentsService.executeAgentTask(getUserId(req), { agentName, task, context });
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute agent', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to execute agent task' });
  }
});

router.post('/agents/orchestrate', async (req: Request, res: Response) => {
  try {
    const { task, context } = req.body;
    const result = await agentsService.orchestrateTask(getUserId(req), task, context);
    res.json(result);
  } catch (error) {
    logger.error('Failed to orchestrate task', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to orchestrate task' });
  }
});

router.delete('/agents/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await agentsService.deleteAgent(getUserId(req), req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete agent', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// ============================================
// MOOD / EMOTIONAL INTELLIGENCE
// ============================================

router.get('/mood/history', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const history = await mood.getMoodHistory(
      getUserId(req),
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(history);
  } catch (error) {
    logger.error('Failed to get mood history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get mood history' });
  }
});

router.get('/mood/trends', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const trends = await mood.getMoodTrends(
      getUserId(req),
      days ? parseInt(days as string, 10) : undefined
    );
    res.json(trends);
  } catch (error) {
    logger.error('Failed to get mood trends', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get mood trends' });
  }
});

// ============================================
// CHECK-INS
// ============================================

router.get('/checkins', async (req: Request, res: Response) => {
  try {
    const schedules = await checkins.getCheckinSchedules(getUserId(req));
    const builtIn = checkins.getBuiltInCheckins();
    res.json({ builtIn, schedules });
  } catch (error) {
    logger.error('Failed to get check-ins', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get check-ins' });
  }
});

router.post('/checkins', async (req: Request, res: Response) => {
  try {
    const schedule = await checkins.createCheckinSchedule(getUserId(req), req.body);
    res.status(201).json(schedule);
  } catch (error) {
    logger.error('Failed to create check-in', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create check-in' });
  }
});

router.get('/checkins/history', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const history = await checkins.getCheckinHistory(
      getUserId(req),
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(history);
  } catch (error) {
    logger.error('Failed to get check-in history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get check-in history' });
  }
});

router.put('/checkins/:id', async (req: Request, res: Response) => {
  try {
    const schedule = await checkins.updateCheckinSchedule(getUserId(req), req.params.id, req.body);
    if (!schedule) {
      res.status(404).json({ error: 'Check-in not found' });
      return;
    }
    res.json(schedule);
  } catch (error) {
    logger.error('Failed to update check-in', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update check-in' });
  }
});

router.delete('/checkins/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await checkins.deleteCheckinSchedule(getUserId(req), req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Check-in not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete check-in', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

// ============================================
// CALENDAR (placeholder - needs OAuth setup)
// ============================================

router.get('/calendar/connections', async (req: Request, res: Response) => {
  try {
    const connections = await calendar.getCalendarConnections(getUserId(req));
    res.json(connections);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get calendar connections' });
  }
});

router.get('/calendar/events', async (req: Request, res: Response) => {
  try {
    const { days, limit } = req.query;
    const events = await calendar.getUpcomingEvents(getUserId(req), {
      days: days ? parseInt(days as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get calendar events' });
  }
});

router.get('/calendar/today', async (req: Request, res: Response) => {
  try {
    const events = await calendar.getTodayEvents(getUserId(req));
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get today events' });
  }
});

// ============================================
// EMAIL (placeholder - needs OAuth setup)
// ============================================

router.get('/email/connections', async (req: Request, res: Response) => {
  try {
    const connections = await emailService.getEmailConnections(getUserId(req));
    res.json(connections);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get email connections' });
  }
});

router.get('/email/recent', async (req: Request, res: Response) => {
  try {
    const { limit, unreadOnly, important } = req.query;
    const emails = await emailService.getRecentEmails(getUserId(req), {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
      important: important === 'true',
    });
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get recent emails' });
  }
});

router.get('/email/search', async (req: Request, res: Response) => {
  try {
    const { q, limit } = req.query;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }
    const emails = await emailService.searchEmails(
      getUserId(req),
      q as string,
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search emails' });
  }
});

router.get('/email/summary', async (req: Request, res: Response) => {
  try {
    const summary = await emailService.getEmailSummary(getUserId(req));
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get email summary' });
  }
});

export default router;
