import { query } from '../db/postgres.js';
import logger from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';

// Project types
export type ProjectType = 'web' | 'fullstack' | 'python' | 'node';
export type ProjectStatus = 'planning' | 'questioning' | 'building' | 'paused' | 'review' | 'complete' | 'error';
export type StepType = 'question' | 'generate_file' | 'generate_image' | 'execute' | 'preview' | 'modify';
export type StepStatus = 'pending' | 'active' | 'waiting_input' | 'complete' | 'completed' | 'error' | 'skipped';

export interface ProjectQuestion {
  id: string;
  question: string;
  options?: string[];
  type: 'text' | 'choice' | 'multiselect';
  category: string;
  required: boolean;
}

export interface ProjectStep {
  id: string;
  stepNumber: number;
  description: string;
  stepType: StepType;
  filename?: string;
  requiresApproval: boolean;
  status: StepStatus;
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ProjectFile {
  id: string;
  filename: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  isGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  userId: string;
  sessionId: string | null;
  name: string;
  description: string;
  type: ProjectType;
  status: ProjectStatus;
  currentStep: number;
  plan: ProjectStep[];
  questions: ProjectQuestion[];
  answers: Record<string, string | string[]>;
  files: ProjectFile[];
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectRow {
  id: string;
  user_id: string;
  session_id: string | null;
  name: string;
  description: string | null;
  type: string;
  status: string;
  current_step: number;
  plan: ProjectStep[] | string;
  questions: ProjectQuestion[] | string;
  answers: Record<string, string | string[]> | string;
  created_at: Date;
  updated_at: Date;
}

interface ProjectFileRow {
  id: string;
  project_id: string;
  filename: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
  is_generated: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ProjectStepRow {
  id: string;
  project_id: string;
  step_number: number;
  description: string;
  step_type: string;
  filename: string | null;
  requires_approval: boolean;
  status: string;
  result: string | null;
  error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

/**
 * Get project directory path
 */
export function getProjectPath(userId: string, projectName: string): string {
  // Sanitize project name for filesystem
  const safeName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
  return path.join(WORKSPACE_DIR, userId, 'projects', safeName);
}

// Alias for compatibility
export const getProjectDirectory = getProjectPath;

/**
 * Ensure project directory exists
 */
async function ensureProjectDirectory(userId: string, projectName: string): Promise<string> {
  const projectDir = getProjectPath(userId, projectName);
  await fs.mkdir(projectDir, { recursive: true, mode: 0o750 });
  // Create subdirectories for organization
  await fs.mkdir(path.join(projectDir, 'images'), { recursive: true, mode: 0o750 });
  await fs.mkdir(path.join(projectDir, 'src'), { recursive: true, mode: 0o750 });
  return projectDir;
}

/**
 * Create a new project
 */
export async function createProject(
  userId: string,
  sessionId: string | null,
  name: string,
  description: string,
  type: ProjectType = 'web'
): Promise<Project> {
  const projectId = randomUUID();

  // Create project directory
  await ensureProjectDirectory(userId, name);

  // Insert into database
  const rows = await query<ProjectRow>(
    `INSERT INTO projects (id, user_id, session_id, name, description, type, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'planning')
     RETURNING *`,
    [projectId, userId, sessionId, name, description, type]
  );

  const row = rows[0];
  logger.info('Project created', { projectId, userId, name, type });

  return rowToProject(row);
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<Project | null> {
  const rows = await query<ProjectRow>(
    'SELECT * FROM projects WHERE id = $1',
    [projectId]
  );

  if (rows.length === 0) return null;

  const project = rowToProject(rows[0]);

  // Load files
  project.files = await getProjectFiles(projectId);

  // Load steps from database
  project.plan = await getProjectSteps(projectId);

  return project;
}

/**
 * Get active project for user (most recent non-complete project)
 */
export async function getActiveProject(userId: string): Promise<Project | null> {
  if (!userId) {
    return null;
  }
  const rows = await query<ProjectRow>(
    `SELECT * FROM projects
     WHERE user_id = $1 AND status NOT IN ('complete', 'error')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) return null;

  const project = rowToProject(rows[0]);
  project.files = await getProjectFiles(project.id);
  project.plan = await getProjectSteps(project.id);

  return project;
}

/**
 * Get all projects for a user
 */
export async function getUserProjects(userId: string): Promise<Project[]> {
  if (!userId) {
    return [];
  }
  const rows = await query<ProjectRow>(
    `SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );

  return rows.map(rowToProject);
}

/**
 * Update project status
 */
export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus,
  currentStep?: number
): Promise<void> {
  const updates: string[] = ['status = $2'];
  const params: (string | number)[] = [projectId, status];

  if (currentStep !== undefined) {
    updates.push(`current_step = $${params.length + 1}`);
    params.push(currentStep);
  }

  await query(
    `UPDATE projects SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
    params
  );

  logger.debug('Project status updated', { projectId, status, currentStep });
}

/**
 * Set project questions (during planning phase)
 */
export async function setProjectQuestions(
  projectId: string,
  questions: ProjectQuestion[]
): Promise<void> {
  await query(
    `UPDATE projects SET questions = $2, status = 'questioning', updated_at = NOW() WHERE id = $1`,
    [projectId, JSON.stringify(questions)]
  );

  logger.debug('Project questions set', { projectId, questionCount: questions.length });
}

/**
 * Save user answers to project questions
 */
export async function saveProjectAnswers(
  projectId: string,
  answers: Record<string, string | string[]>
): Promise<void> {
  await query(
    `UPDATE projects SET answers = $2, updated_at = NOW() WHERE id = $1`,
    [projectId, JSON.stringify(answers)]
  );

  logger.debug('Project answers saved', { projectId });
}

/**
 * Set project plan (after questions answered)
 */
export async function setProjectPlan(
  projectId: string,
  steps: Omit<ProjectStep, 'id'>[]
): Promise<ProjectStep[]> {
  // Clear existing steps
  await query('DELETE FROM project_steps WHERE project_id = $1', [projectId]);

  // Insert new steps
  const createdSteps: ProjectStep[] = [];
  for (const step of steps) {
    const stepId = randomUUID();
    await query(
      `INSERT INTO project_steps (id, project_id, step_number, description, step_type, filename, requires_approval, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [stepId, projectId, step.stepNumber, step.description, step.stepType, step.filename || null, step.requiresApproval || false, step.status]
    );
    createdSteps.push({ ...step, id: stepId });
  }

  // Update project status
  await query(
    `UPDATE projects SET status = 'building', current_step = 0, updated_at = NOW() WHERE id = $1`,
    [projectId]
  );

  logger.info('Project plan set', { projectId, stepCount: steps.length });

  return createdSteps;
}

/**
 * Get project steps
 */
export async function getProjectSteps(projectId: string): Promise<ProjectStep[]> {
  const rows = await query<ProjectStepRow>(
    'SELECT * FROM project_steps WHERE project_id = $1 ORDER BY step_number',
    [projectId]
  );

  return rows.map(row => ({
    id: row.id,
    stepNumber: row.step_number,
    description: row.description,
    stepType: row.step_type as StepType,
    filename: row.filename || undefined,
    requiresApproval: row.requires_approval,
    status: row.status as StepStatus,
    result: row.result || undefined,
    error: row.error || undefined,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
  }));
}

/**
 * Update step status
 */
export async function updateStepStatus(
  projectId: string,
  stepNumber: number,
  status: StepStatus,
  result?: string,
  error?: string
): Promise<void> {
  const updates: string[] = ['status = $3'];
  const params: (string | number)[] = [projectId, stepNumber, status];

  if (status === 'active') {
    updates.push('started_at = NOW()');
  }

  if (status === 'complete' || status === 'error') {
    updates.push('completed_at = NOW()');
  }

  if (result !== undefined) {
    params.push(result);
    updates.push(`result = $${params.length}`);
  }

  if (error !== undefined) {
    params.push(error);
    updates.push(`error = $${params.length}`);
  }

  await query(
    `UPDATE project_steps SET ${updates.join(', ')}
     WHERE project_id = $1 AND step_number = $2`,
    params
  );

  // Update project current step
  await query(
    `UPDATE projects SET current_step = $2, updated_at = NOW() WHERE id = $1`,
    [projectId, stepNumber]
  );
}

/**
 * Get current step for project
 */
export async function getCurrentStep(projectId: string): Promise<ProjectStep | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  return project.plan.find(s => s.stepNumber === project.currentStep) || null;
}

/**
 * Get next pending step
 */
export async function getNextPendingStep(projectId: string): Promise<ProjectStep | null> {
  const rows = await query<ProjectStepRow>(
    `SELECT * FROM project_steps
     WHERE project_id = $1 AND status = 'pending'
     ORDER BY step_number
     LIMIT 1`,
    [projectId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    stepNumber: row.step_number,
    description: row.description,
    stepType: row.step_type as StepType,
    filename: row.filename || undefined,
    requiresApproval: row.requires_approval,
    status: row.status as StepStatus,
    result: row.result || undefined,
    error: row.error || undefined,
  };
}

/**
 * Write a file to project
 */
export async function writeProjectFile(
  projectId: string,
  userId: string,
  projectName: string,
  filename: string,
  content: string,
  fileType?: string
): Promise<ProjectFile> {
  const projectDir = getProjectPath(userId, projectName);
  await ensureProjectDirectory(userId, projectName);

  // Determine subdirectory based on file type
  let subdir = '';
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
    subdir = 'images';
  } else if (['.js', '.ts', '.py', '.css'].includes(ext) && !filename.includes('/')) {
    subdir = 'src';
  }

  const fullPath = subdir ? path.join(projectDir, subdir, filename) : path.join(projectDir, filename);
  const relativePath = subdir ? path.join(subdir, filename) : filename;

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true, mode: 0o750 });

  // Write file
  const buffer = Buffer.from(content, 'utf-8');
  await fs.writeFile(fullPath, buffer, { mode: 0o640 });

  const stat = await fs.stat(fullPath);
  const fileId = randomUUID();

  // Store in database
  await query(
    `INSERT INTO project_files (id, project_id, filename, file_path, file_type, file_size, is_generated)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (project_id, filename) DO UPDATE SET
       file_path = EXCLUDED.file_path,
       file_size = EXCLUDED.file_size,
       updated_at = NOW()
     RETURNING id`,
    [fileId, projectId, relativePath, fullPath, fileType || getMimeType(filename), stat.size]
  );

  logger.info('Project file written', { projectId, filename: relativePath, size: stat.size });

  return {
    id: fileId,
    filename: relativePath,
    filePath: fullPath,
    fileType: fileType || getMimeType(filename),
    fileSize: stat.size,
    isGenerated: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Write binary file to project (for images)
 */
export async function writeProjectBinaryFile(
  projectId: string,
  userId: string,
  projectName: string,
  filename: string,
  content: Buffer,
  fileType?: string
): Promise<ProjectFile> {
  const projectDir = getProjectPath(userId, projectName);
  await ensureProjectDirectory(userId, projectName);

  // Images go in images subdirectory
  const ext = path.extname(filename).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
  const subdir = isImage ? 'images' : '';

  const fullPath = subdir ? path.join(projectDir, subdir, filename) : path.join(projectDir, filename);
  const relativePath = subdir ? path.join(subdir, filename) : filename;

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true, mode: 0o750 });

  // Write file
  await fs.writeFile(fullPath, content, { mode: 0o640 });

  const stat = await fs.stat(fullPath);
  const fileId = randomUUID();

  // Store in database
  await query(
    `INSERT INTO project_files (id, project_id, filename, file_path, file_type, file_size, is_generated)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (project_id, filename) DO UPDATE SET
       file_path = EXCLUDED.file_path,
       file_size = EXCLUDED.file_size,
       updated_at = NOW()
     RETURNING id`,
    [fileId, projectId, relativePath, fullPath, fileType || getMimeType(filename), stat.size]
  );

  logger.info('Project binary file written', { projectId, filename: relativePath, size: stat.size });

  return {
    id: fileId,
    filename: relativePath,
    filePath: fullPath,
    fileType: fileType || getMimeType(filename),
    fileSize: stat.size,
    isGenerated: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Read a project file
 */
export async function readProjectFile(
  userId: string,
  projectName: string,
  filename: string
): Promise<string> {
  const projectDir = getProjectPath(userId, projectName);
  const fullPath = path.join(projectDir, filename);

  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filename}`);
    }
    throw error;
  }
}

/**
 * Get project files
 */
async function getProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const rows = await query<ProjectFileRow>(
    'SELECT * FROM project_files WHERE project_id = $1 ORDER BY filename',
    [projectId]
  );

  return rows.map(row => ({
    id: row.id,
    filename: row.filename,
    filePath: row.file_path,
    fileType: row.file_type || 'text/plain',
    fileSize: row.file_size,
    isGenerated: row.is_generated,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * List project files from filesystem
 */
export async function listProjectFiles(
  userId: string,
  projectName: string
): Promise<{ filename: string; size: number; isDirectory: boolean }[]> {
  const projectDir = getProjectPath(userId, projectName);
  const files: { filename: string; size: number; isDirectory: boolean }[] = [];

  async function walk(dir: string, prefix: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
        if (entry.isDirectory()) {
          files.push({ filename: relativePath, size: 0, isDirectory: true });
          await walk(path.join(dir, entry.name), relativePath);
        } else {
          const stat = await fs.stat(path.join(dir, entry.name));
          files.push({ filename: relativePath, size: stat.size, isDirectory: false });
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  await walk(projectDir);
  return files;
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string, userId: string): Promise<boolean> {
  const project = await getProject(projectId);
  if (!project || project.userId !== userId) return false;

  // Delete project directory
  const projectDir = getProjectPath(userId, project.name);
  try {
    await fs.rm(projectDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }

  // Delete from database (cascades to files and steps)
  await query('DELETE FROM projects WHERE id = $1', [projectId]);

  logger.info('Project deleted', { projectId, userId });
  return true;
}

/**
 * Check if message is steering an active project
 * Must be explicit project-related commands, not just containing common words
 */
export function isSteeringMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim();

  // Short messages (< 50 chars) with control words are likely project steering
  const shortControlPatterns = [
    'stop', 'pause', 'wait', 'hold on', 'cancel',
    'continue', 'go ahead', 'looks good', 'proceed', 'next',
    'skip', 'redo', 'restart', 'resume',
  ];
  if (lowerMessage.length < 50 && shortControlPatterns.some(p => lowerMessage.includes(p))) {
    return true;
  }

  // Explicit project modification phrases (more specific)
  const explicitProjectPhrases = [
    'change the project', 'update the project', 'modify the project',
    'change the page', 'update the page', 'modify the page',
    'change the landing', 'update the landing',
    'add to the project', 'remove from the project',
    'change that to', 'make it more', 'make it less',
    'actually, make', 'instead, use', 'instead of',
    'for the project', 'in the project',
    'change the color', 'change the font', 'change the style',
    'add a button', 'add a section', 'remove the',
  ];

  return explicitProjectPhrases.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Check if message indicates project creation intent
 * Only triggers for complex multi-file projects, not simple file requests
 */
export function isProjectCreationIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Explicit project keywords that indicate multi-file project intent
  const projectKeywords = [
    'website', 'web site', 'webpage', 'web page',
    'landing page', 'application', 'app',
    'project', 'portfolio', 'dashboard',
    'e-commerce', 'ecommerce', 'store',
    'blog', 'forum', 'social',
  ];

  // Simple file requests should NOT trigger project flow
  // These should use workspace_write tool instead
  const simpleFilePatterns = [
    /^(create|write|make|generate)\s+(a\s+)?(\w+\s+)?(file|script)/i,
    /^(create|write|make)\s+.{0,30}\.(html|css|js|py|txt|md|json|yaml)/i,
    /hello\s*world/i,
    /just\s+(a\s+)?(simple|basic|plain)/i,
    /single\s+(file|page)/i,
  ];

  // If it looks like a simple file request, don't trigger project flow
  if (simpleFilePatterns.some(pattern => pattern.test(lowerMessage))) {
    return false;
  }

  const hasCreationVerb = ['create', 'build', 'make', 'generate', 'design', 'develop'].some(
    verb => lowerMessage.includes(verb)
  );

  const hasProjectNoun = projectKeywords.some(
    noun => lowerMessage.includes(noun)
  );

  // Require BOTH a creation verb AND a project-type noun
  // Single "html" or "page" is not enough - needs to be "website", "landing page", etc.
  return hasCreationVerb && hasProjectNoun;
}

/**
 * Convert database row to Project object
 */
function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    name: row.name,
    description: row.description || '',
    type: row.type as ProjectType,
    status: row.status as ProjectStatus,
    currentStep: row.current_step,
    plan: typeof row.plan === 'string' ? JSON.parse(row.plan) : (row.plan || []),
    questions: typeof row.questions === 'string' ? JSON.parse(row.questions) : (row.questions || []),
    answers: typeof row.answers === 'string' ? JSON.parse(row.answers) : (row.answers || {}),
    files: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.json': 'application/json',
    '.py': 'text/x-python',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

export default {
  createProject,
  getProject,
  getActiveProject,
  getUserProjects,
  updateProjectStatus,
  setProjectQuestions,
  saveProjectAnswers,
  setProjectPlan,
  updateStepStatus,
  getCurrentStep,
  getNextPendingStep,
  writeProjectFile,
  writeProjectBinaryFile,
  readProjectFile,
  listProjectFiles,
  deleteProject,
  isSteeringMessage,
  isProjectCreationIntent,
  getProjectPath,
};
