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
import * as lunaMedia from './luna-media.service.js';
import * as facts from '../memory/facts.service.js';
import * as spotify from './spotify.service.js';
import * as irc from './irc.service.js';
import * as spotifyOAuth from './spotify-oauth.js';
import { getAbilitySummary } from './orchestrator.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Helper to get userId from authenticated request
function getUserId(req: Request): string {
  return req.user!.userId;
}

/**
 * Parse date string in user's timezone and return UTC Date
 * @param dateStr - Date string in format "2025-12-08T12:30" or "2025-12-08T12:30:00" (no timezone)
 * @param userTimezone - IANA timezone string (e.g., "Europe/Stockholm", "America/New_York")
 * @returns Date object in UTC
 */
function parseUserTime(dateStr: string, userTimezone: string = 'Europe/Stockholm'): Date {
  // Validate timezone is a valid IANA timezone
  let timezone = userTimezone;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    logger.warn('Invalid timezone provided, falling back to Europe/Stockholm', { provided: userTimezone });
    timezone = 'Europe/Stockholm';
  }

  // Parse the date components from the input string
  const [datePart, timePart] = dateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes, seconds = 0] = (timePart || '00:00:00').split(':').map(s => parseInt(s) || 0);

  // Create a date object representing this time in the user's timezone
  // We do this by finding the UTC offset for this specific date/time in the user's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Create a reference date to get the timezone offset
  // We use the target date to correctly handle DST
  const refDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  const parts = formatter.formatToParts(refDate);
  const tzPart = parts.find(p => p.type === 'timeZoneName');
  const offsetStr = tzPart?.value || 'GMT+01:00';

  // Parse offset (GMT+01:00 -> +60, GMT-05:00 -> -300)
  const offsetMatch = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
  let offsetMinutes = 60; // Default to +1 hour (Stockholm standard time)
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const offsetHours = parseInt(offsetMatch[2]);
    const offsetMins = parseInt(offsetMatch[3]);
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  // Create the UTC date by subtracting the offset
  // If user says "14:00" in Stockholm (GMT+1), UTC is "13:00"
  const utcTime = Date.UTC(year, month - 1, day, hours, minutes, seconds) - offsetMinutes * 60 * 1000;
  return new Date(utcTime);
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
    res.json({ tasks: taskList });
  } catch (error) {
    logger.error('Failed to get tasks', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const task = await tasks.createTask(getUserId(req), req.body);
    res.status(201).json({ task });
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
    res.json({ task });
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
    res.json({ task });
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

router.get('/workspace/file/*', async (req: Request, res: Response) => {
  try {
    const filename = (req.params as Record<string, string>)[0];
    const content = await workspace.readFile(getUserId(req), filename);
    res.json({ filename, content });
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

// Upload file to workspace (multipart form)
router.post('/workspace/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Use original filename
    const filename = req.file.originalname;
    const content = req.file.buffer.toString('utf-8');

    const file = await workspace.writeFile(getUserId(req), filename, content);
    res.status(201).json(file);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Failed to upload workspace file', { error: message });
    res.status(400).json({ error: message });
  }
});

// Update existing workspace file
router.put('/workspace/file/*', async (req: Request, res: Response) => {
  try {
    const filename = (req.params as Record<string, string>)[0];
    const { content } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Verify file exists
    const exists = await workspace.fileExists(getUserId(req), filename);
    if (!exists) {
      res.status(404).json({ error: `File not found: ${filename}` });
      return;
    }

    const file = await workspace.writeFile(getUserId(req), filename, content);
    res.json(file);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Failed to update workspace file', { error: message });
    res.status(400).json({ error: message });
  }
});

router.delete('/workspace/file/*', async (req: Request, res: Response) => {
  try {
    const filename = (req.params as Record<string, string>)[0];
    const deleted = await workspace.deleteFile(getUserId(req), filename);
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

// Rename workspace file
router.post('/workspace/rename', async (req: Request, res: Response) => {
  try {
    const { oldFilename, newFilename } = req.body;
    if (!oldFilename || !newFilename) {
      res.status(400).json({ error: 'oldFilename and newFilename are required' });
      return;
    }
    const file = await workspace.renameFile(getUserId(req), oldFilename, newFilename);
    res.json(file);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error('Failed to rename workspace file', { error: message });
    res.status(400).json({ error: message });
  }
});

// Rename workspace directory
router.post('/workspace/rename-directory', async (req: Request, res: Response) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      res.status(400).json({ error: 'oldPath and newPath are required' });
      return;
    }
    const result = await workspace.renameDirectory(getUserId(req), oldPath, newPath);
    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error('Failed to rename workspace directory', { error: message });
    res.status(400).json({ error: message });
  }
});

// Create workspace directory
router.post('/workspace/mkdir', async (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    await workspace.createDirectory(getUserId(req), dirPath);
    res.status(201).json({ success: true, path: dirPath });
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Failed to create workspace directory', { error: message });
    res.status(400).json({ error: message });
  }
});

// Set file permissions
router.post('/workspace/chmod', async (req: Request, res: Response) => {
  try {
    const { filename, mode } = req.body;
    if (!filename || mode === undefined) {
      res.status(400).json({ error: 'filename and mode are required' });
      return;
    }
    const modeNum = typeof mode === 'string' ? parseInt(mode, 8) : mode;
    const info = await workspace.setPermissions(getUserId(req), filename, modeNum);
    res.json(info);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Failed to set file permissions', { error: message });
    res.status(400).json({ error: message });
  }
});

// Get file info
router.get('/workspace/info/*', async (req: Request, res: Response) => {
  try {
    const filename = (req.params as Record<string, string>)[0];
    const info = await workspace.getFileInfo(getUserId(req), filename);
    res.json(info);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('ENOENT') || message.includes('not found')) {
      res.status(404).json({ error: `File not found: ${(req.params as Record<string, string>)[0]}` });
      return;
    }
    logger.error('Failed to get file info', { error: message });
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// Delete workspace directory
router.delete('/workspace/directory/*', async (req: Request, res: Response) => {
  try {
    const dirPath = (req.params as Record<string, string>)[0];
    const result = await workspace.deleteDirectory(getUserId(req), dirPath);
    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Failed to delete workspace directory', { error: message });
    res.status(400).json({ error: message });
  }
});

// List workspace directories
router.get('/workspace/directories', async (req: Request, res: Response) => {
  try {
    const dirs = await workspace.listDirectories(getUserId(req));
    res.json(dirs);
  } catch (error) {
    logger.error('Failed to list workspace directories', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list workspace directories' });
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
    res.json({ documents: docs });
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
// LUNA MEDIA (Videos + Generated Images)
// ============================================

router.get('/luna/media', async (req: Request, res: Response) => {
  try {
    const { response, mood: moodParam } = req.query;

    if (!response || !moodParam) {
      res.status(400).json({ error: 'Both response and mood parameters are required' });
      return;
    }

    const media = await lunaMedia.selectMedia(
      response as string,
      moodParam as string
    );
    res.json(media);
  } catch (error) {
    logger.error('Failed to select Luna media', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to select Luna media' });
  }
});

router.get('/luna/videos', async (_req: Request, res: Response) => {
  try {
    const videos = lunaMedia.getAvailableVideos();
    res.json({ videos });
  } catch (error) {
    logger.error('Failed to get Luna videos', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Luna videos' });
  }
});

router.get('/luna/cached-images', async (_req: Request, res: Response) => {
  try {
    const images = lunaMedia.getCachedMoodImages();
    res.json({ images });
  } catch (error) {
    logger.error('Failed to get cached mood images', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get cached mood images' });
  }
});

router.post('/luna/generate-image', async (req: Request, res: Response) => {
  try {
    const { mood: moodParam } = req.body;

    if (!moodParam) {
      res.status(400).json({ error: 'mood parameter is required' });
      return;
    }

    const cached = lunaMedia.isMoodImageCached(moodParam);
    const url = await lunaMedia.generateMoodImage(moodParam);

    res.json({
      url,
      cached,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to generate mood image', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to generate mood image' });
  }
});

// ============================================
// LUNA AVATAR (Loop-based video system)
// ============================================

// Get current avatar state for user
router.get('/luna/avatar/state', async (req: Request, res: Response) => {
  try {
    const state = lunaMedia.getAvatarStateForUser(getUserId(req));
    res.json({ state });
  } catch (error) {
    logger.error('Failed to get avatar state', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get avatar state' });
  }
});

// Get next video in current loop set
router.get('/luna/avatar/next', async (req: Request, res: Response) => {
  try {
    const { set } = req.query;
    const video = lunaMedia.getNextLoopVideo(getUserId(req), set as string | undefined);
    if (video) {
      res.json(video);
    } else {
      res.status(404).json({ error: 'No loop videos available' });
    }
  } catch (error) {
    logger.error('Failed to get next loop video', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get next loop video' });
  }
});

// Get info about available loop sets
router.get('/luna/avatar/loop-sets', async (_req: Request, res: Response) => {
  try {
    const loopSets = lunaMedia.getLoopSetsInfo();
    res.json({ loopSets });
  } catch (error) {
    logger.error('Failed to get loop sets info', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get loop sets info' });
  }
});

// Get available special gestures
router.get('/luna/avatar/specials', async (_req: Request, res: Response) => {
  try {
    const specials = lunaMedia.getAvailableSpecialGestures();
    res.json({ specials });
  } catch (error) {
    logger.error('Failed to get special gestures', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get special gestures' });
  }
});

// Queue a special gesture to play
router.post('/luna/avatar/special', async (req: Request, res: Response) => {
  try {
    const { gesture } = req.body;
    if (!gesture) {
      res.status(400).json({ error: 'gesture parameter is required' });
      return;
    }

    const queued = lunaMedia.queueSpecialGesture(getUserId(req), gesture);
    if (queued) {
      const next = lunaMedia.getNextSpecialGesture(getUserId(req));
      res.json({ queued: true, video: next });
    } else {
      res.status(404).json({ error: 'Gesture not available', gesture });
    }
  } catch (error) {
    logger.error('Failed to queue special gesture', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to queue special gesture' });
  }
});

// Mark special gesture as finished
router.post('/luna/avatar/special/finish', async (req: Request, res: Response) => {
  try {
    lunaMedia.finishSpecialGesture(getUserId(req));
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to finish special gesture', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to finish special gesture' });
  }
});

// Set loop set based on mood
router.post('/luna/avatar/mood', async (req: Request, res: Response) => {
  try {
    const { mood } = req.body;
    if (!mood) {
      res.status(400).json({ error: 'mood parameter is required' });
      return;
    }

    const newSet = lunaMedia.setLoopSetForMood(getUserId(req), mood);
    res.json({ loopSet: newSet });
  } catch (error) {
    logger.error('Failed to set mood loop set', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set mood loop set' });
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
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get calendar events' });
  }
});

router.get('/calendar/today', async (req: Request, res: Response) => {
  try {
    const events = await calendar.getTodayEvents(getUserId(req));
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get today events' });
  }
});

router.get('/calendar/status', async (req: Request, res: Response) => {
  try {
    const status = await calendar.getCalendarStatus(getUserId(req));
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get calendar status' });
  }
});

router.post('/calendar/events', async (req: Request, res: Response) => {
  try {
    const { title, description, startAt, endAt, location, isAllDay, reminderMinutes, timezone } = req.body;
    if (!title || !startAt || !endAt) {
      res.status(400).json({ error: 'title, startAt, and endAt are required' });
      return;
    }
    // Use provided timezone or default to Europe/Stockholm
    const userTimezone = timezone || 'Europe/Stockholm';
    const event = await calendar.createEvent(getUserId(req), {
      title,
      description,
      startAt: parseUserTime(startAt, userTimezone),
      endAt: parseUserTime(endAt, userTimezone),
      location,
      isAllDay: isAllDay || false,
      reminderMinutes: reminderMinutes !== undefined ? reminderMinutes : null,
    });
    res.status(201).json(event);
  } catch (error) {
    logger.error('Failed to create calendar event', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

router.get('/calendar/events/:id', async (req: Request, res: Response) => {
  try {
    const event = await calendar.getEvent(getUserId(req), req.params.id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    res.json(event);
  } catch (error) {
    logger.error('Failed to get calendar event', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get calendar event' });
  }
});

router.put('/calendar/events/:id', async (req: Request, res: Response) => {
  try {
    const { title, description, startAt, endAt, location, isAllDay, reminderMinutes, timezone } = req.body;
    // Use provided timezone or default to Europe/Stockholm
    const userTimezone = timezone || 'Europe/Stockholm';
    const event = await calendar.updateEvent(getUserId(req), req.params.id, {
      title,
      description,
      startAt: startAt ? parseUserTime(startAt, userTimezone) : undefined,
      endAt: endAt ? parseUserTime(endAt, userTimezone) : undefined,
      location,
      isAllDay,
      reminderMinutes: reminderMinutes !== undefined ? reminderMinutes : undefined,
    });
    res.json(event);
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'Event not found') {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    logger.error('Failed to update calendar event', { error: message });
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

router.delete('/calendar/events/:id', async (req: Request, res: Response) => {
  try {
    await calendar.deleteEvent(getUserId(req), req.params.id);
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete calendar event', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete calendar event' });
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

// ============================================
// FACTS / MEMORY
// ============================================

router.get('/facts', async (req: Request, res: Response) => {
  try {
    const { category, limit } = req.query;
    const userFacts = await facts.getUserFacts(getUserId(req), {
      category: category as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json(userFacts);
  } catch (error) {
    logger.error('Failed to get facts', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get facts' });
  }
});

router.get('/facts/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }
    const results = await facts.searchFacts(getUserId(req), q as string);
    res.json(results);
  } catch (error) {
    logger.error('Failed to search facts', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search facts' });
  }
});

router.get('/facts/history', async (req: Request, res: Response) => {
  try {
    const { limit, offset } = req.query;
    const history = await facts.getFactCorrectionHistory(getUserId(req), {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json(history);
  } catch (error) {
    logger.error('Failed to get fact history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get fact correction history' });
  }
});

router.get('/facts/:id', async (req: Request, res: Response) => {
  try {
    const fact = await facts.getFactById(getUserId(req), req.params.id);
    if (!fact) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }
    res.json(fact);
  } catch (error) {
    logger.error('Failed to get fact', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get fact' });
  }
});

router.put('/facts/:id', async (req: Request, res: Response) => {
  try {
    const { value, reason } = req.body;
    if (!value) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    const result = await facts.updateFact(getUserId(req), req.params.id, value, reason);
    if (!result.success) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }
    res.json({ success: true, oldValue: result.oldValue, newValue: value });
  } catch (error) {
    logger.error('Failed to update fact', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update fact' });
  }
});

router.delete('/facts/:id', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const result = await facts.deleteFact(getUserId(req), req.params.id, reason);
    if (!result.success) {
      res.status(404).json({ error: 'Fact not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete fact', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete fact' });
  }
});

// ============================================
// SPOTIFY MUSIC CONTROL
// ============================================

// Get Spotify connection status
router.get('/spotify/status', async (req: Request, res: Response) => {
  try {
    const status = await spotify.getConnectionStatus(getUserId(req));
    res.json(status);
  } catch (error) {
    logger.error('Failed to get Spotify status', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Spotify status' });
  }
});

// Start Spotify OAuth flow - get authorization URL
router.get('/spotify/authorize', async (req: Request, res: Response) => {
  try {
    const { url, stateToken } = await spotifyOAuth.generateSpotifyAuthUrl(getUserId(req));
    res.json({ url, stateToken });
  } catch (error) {
    logger.error('Failed to generate Spotify auth URL', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to start Spotify authorization' });
  }
});

// Spotify OAuth callback (handles redirect from Spotify)
router.get('/spotify/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.warn(`Spotify auth denied: ${error}`);
      // Redirect to frontend with error
      res.redirect(`${process.env.FRONTEND_URL || 'https://luna.bitwarelabs.com'}/settings?spotify_error=${error}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    const { userId, profile } = await spotifyOAuth.handleSpotifyCallback(
      code as string,
      state as string
    );

    logger.info(`Spotify connected for user ${userId}: ${profile.displayName} (${profile.id})`);

    // Redirect to frontend settings with success
    res.redirect(`${process.env.FRONTEND_URL || 'https://luna.bitwarelabs.com'}/settings?spotify_connected=true`);
  } catch (error) {
    logger.error('Spotify OAuth callback failed', { error: (error as Error).message });
    res.redirect(`${process.env.FRONTEND_URL || 'https://luna.bitwarelabs.com'}/settings?spotify_error=auth_failed`);
  }
});

// Disconnect Spotify
router.delete('/spotify/disconnect', async (req: Request, res: Response) => {
  try {
    await spotifyOAuth.disconnectSpotify(getUserId(req));
    res.json({ success: true, message: 'Spotify disconnected' });
  } catch (error) {
    logger.error('Failed to disconnect Spotify', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to disconnect Spotify' });
  }
});

// Get current playback state
router.get('/spotify/playback', async (req: Request, res: Response) => {
  try {
    const state = await spotify.getPlaybackStatus(getUserId(req));
    res.json({ state });
  } catch (error) {
    logger.error('Failed to get playback state', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get playback state' });
  }
});

// Play music
router.post('/spotify/play', async (req: Request, res: Response) => {
  try {
    const { query, type, uri, uris, contextUri, shuffle, deviceId } = req.body;
    const result = await spotify.playMusic(getUserId(req), {
      query,
      type,
      uri,
      uris,
      contextUri,
      shuffle,
      deviceId,
    });
    res.json(result);
  } catch (error) {
    logger.error('Failed to play music', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to play music' });
  }
});

// Pause playback
router.post('/spotify/pause', async (req: Request, res: Response) => {
  try {
    const result = await spotify.pauseMusic(getUserId(req));
    res.json(result);
  } catch (error) {
    logger.error('Failed to pause music', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to pause music' });
  }
});

// Skip to next track
router.post('/spotify/next', async (req: Request, res: Response) => {
  try {
    const result = await spotify.skipTrack(getUserId(req), 'next');
    res.json(result);
  } catch (error) {
    logger.error('Failed to skip track', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to skip track' });
  }
});

// Go to previous track
router.post('/spotify/previous', async (req: Request, res: Response) => {
  try {
    const result = await spotify.skipTrack(getUserId(req), 'previous');
    res.json(result);
  } catch (error) {
    logger.error('Failed to go to previous track', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to go to previous track' });
  }
});

// Set volume
router.post('/spotify/volume', async (req: Request, res: Response) => {
  try {
    const { volume } = req.body;
    if (typeof volume !== 'number' || volume < 0 || volume > 100) {
      res.status(400).json({ error: 'volume must be a number between 0 and 100' });
      return;
    }
    const result = await spotify.setVolume(getUserId(req), volume);
    res.json(result);
  } catch (error) {
    logger.error('Failed to set volume', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set volume' });
  }
});

// Add to queue
router.post('/spotify/queue', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const result = await spotify.addToQueue(getUserId(req), query);
    res.json(result);
  } catch (error) {
    logger.error('Failed to add to queue', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// Get available devices
router.get('/spotify/devices', async (req: Request, res: Response) => {
  try {
    const devices = await spotify.getAvailableDevices(getUserId(req));
    res.json({ devices });
  } catch (error) {
    logger.error('Failed to get devices', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

// Transfer playback to device
router.post('/spotify/devices/transfer', async (req: Request, res: Response) => {
  try {
    const { deviceId, play } = req.body;
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    const result = await spotify.transferPlayback(getUserId(req), deviceId, play);
    res.json(result);
  } catch (error) {
    logger.error('Failed to transfer playback', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to transfer playback' });
  }
});

// Set preferred device
router.put('/spotify/devices/preferred', async (req: Request, res: Response) => {
  try {
    const { deviceId, deviceName } = req.body;
    if (!deviceId || !deviceName) {
      res.status(400).json({ error: 'deviceId and deviceName are required' });
      return;
    }
    await spotify.setPreferredDevice(getUserId(req), deviceId, deviceName);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to set preferred device', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set preferred device' });
  }
});

// Search Spotify
router.get('/spotify/search', async (req: Request, res: Response) => {
  try {
    const { q, type, limit } = req.query;
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }
    const results = await spotify.search(
      getUserId(req),
      q as string,
      (type as 'track' | 'artist' | 'album' | 'playlist') || 'track',
      limit ? parseInt(limit as string, 10) : 10
    );
    res.json(results);
  } catch (error) {
    logger.error('Failed to search Spotify', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search Spotify' });
  }
});

// Get recommendations
router.get('/spotify/recommendations', async (req: Request, res: Response) => {
  try {
    const { mood, seedTracks, seedArtists, seedGenres, limit } = req.query;
    const tracks = await spotify.getRecommendations(getUserId(req), {
      mood: mood as string,
      seedTracks: seedTracks ? (seedTracks as string).split(',') : undefined,
      seedArtists: seedArtists ? (seedArtists as string).split(',') : undefined,
      seedGenres: seedGenres ? (seedGenres as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string, 10) : 20,
    });
    res.json({ tracks });
  } catch (error) {
    logger.error('Failed to get recommendations', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Get Spotify preferences
router.get('/spotify/preferences', async (req: Request, res: Response) => {
  try {
    const prefs = await spotify.getSpotifyPreferences(getUserId(req));
    res.json(prefs);
  } catch (error) {
    logger.error('Failed to get Spotify preferences', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Spotify preferences' });
  }
});

// ============================================
// IRC
// ============================================

router.get('/irc/status', async (_req: Request, res: Response) => {
  try {
    const status = irc.ircService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get IRC status' });
  }
});

router.post('/irc/connect', async (req: Request, res: Response) => {
  try {
    const { server, port, nick, channels, tls } = req.body;
    await irc.ircService.connect(getUserId(req), {
      server: server || config.irc.server,
      port: port || config.irc.port,
      nick: nick || config.irc.nick,
      channels: channels || config.irc.channels,
      tls: tls ?? false,
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to connect to IRC', { error: (error as Error).message });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/irc/disconnect', async (_req: Request, res: Response) => {
  try {
    irc.ircService.disconnect();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect from IRC' });
  }
});

router.post('/irc/send', async (req: Request, res: Response) => {
  try {
    const { target, message } = req.body;
    if (!target || !message) {
      res.status(400).json({ error: 'target and message are required' });
      return;
    }
    await irc.ircService.sendMessage(target, message);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to send IRC message', { error: (error as Error).message });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/irc/join', async (req: Request, res: Response) => {
  try {
    const { channel } = req.body;
    if (!channel) {
      res.status(400).json({ error: 'channel is required' });
      return;
    }
    irc.ircService.joinChannel(channel);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join channel' });
  }
});

router.post('/irc/leave', async (req: Request, res: Response) => {
  try {
    const { channel } = req.body;
    if (!channel) {
      res.status(400).json({ error: 'channel is required' });
      return;
    }
    irc.ircService.partChannel(channel);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave channel' });
  }
});

export default router;
