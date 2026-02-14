import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_FILES_PER_USER = 100;

// Allowed file extensions for workspace
const ALLOWED_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.json', '.txt', '.md', '.markdown', '.mdown', '.mkdn', '.csv', '.xml', '.yaml', '.yml',
  '.html', '.css', '.sql', '.sh', '.r', '.ipynb',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.pptx'
]);

export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceStats {
  totalFiles: number;
  totalSize: number;
  maxFiles: number;
  maxFileSize: number;
}

/**
 * Get user's workspace directory path
 */
export function getUserWorkspacePath(userId: string): string {
  return path.join(WORKSPACE_DIR, userId);
}

/**
 * Get file:// URL for a workspace file (for browser navigation)
 */
export function getWorkspaceFileUrl(userId: string, filename: string): string {
  // In sandbox, workspace is mounted at /workspace
  const filePath = path.join('/workspace', userId, filename);
  return `file://${filePath}`;
}

/**
 * Validate filename for security
 */
function validateFilename(filename: string): { valid: boolean; error?: string } {
  // Check for path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, error: 'Invalid filename - path traversal not allowed' };
  }

  // Check extension
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File extension "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` };
  }

  // Check filename length
  if (filename.length > 255) {
    return { valid: false, error: 'Filename too long (max 255 characters)' };
  }

  return { valid: true };
}

/**
 * Ensure user workspace directory exists
 */
async function ensureUserWorkspace(userId: string): Promise<string> {
  const userDir = getUserWorkspacePath(userId);
  await fs.mkdir(userDir, { recursive: true, mode: 0o750 });
  return userDir;
}

/**
 * Write a file to user's workspace
 */
export async function writeFile(
  userId: string,
  filename: string,
  content: string
): Promise<WorkspaceFile> {
  const contentBuffer = Buffer.from(content, 'utf-8');
  return writeBuffer(userId, filename, contentBuffer);
}

/**
 * Write a binary buffer to user's workspace
 */
export async function writeBuffer(
  userId: string,
  filename: string,
  buffer: Buffer
): Promise<WorkspaceFile> {
  // Validate filename
  const validation = validateFilename(filename);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Check content size
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  // Check user file count
  const stats = await getWorkspaceStats(userId);
  if (stats.totalFiles >= MAX_FILES_PER_USER) {
    throw new Error(`Maximum files reached (${MAX_FILES_PER_USER}). Delete some files first.`);
  }

  const userDir = await ensureUserWorkspace(userId);
  const filePath = path.join(userDir, filename);
  const fileId = randomUUID();

  try {
    // Write file
    await fs.writeFile(filePath, buffer, { mode: 0o640 });

    // Get file stats
    const fileStat = await fs.stat(filePath);

    // Store in database
    await pool.query(
      `INSERT INTO workspace_files (id, user_id, filename, file_path, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, filename) DO UPDATE SET
         file_size = EXCLUDED.file_size,
         updated_at = NOW()
       RETURNING id`,
      [fileId, userId, filename, filePath, fileStat.size, getMimeType(filename)]
    );

    logger.info('Workspace file written', { userId, filename, size: fileStat.size });

    return {
      id: fileId,
      name: filename,
      path: filePath,
      size: fileStat.size,
      mimeType: getMimeType(filename),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    logger.error('Failed to write workspace file', { error: (error as Error).message, userId, filename });
    throw error;
  }
}

/**
 * Read a file from user's workspace
 */
export async function readFile(userId: string, filename: string): Promise<string> {
  const validation = validateFilename(filename);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const userDir = getUserWorkspacePath(userId);
  const filePath = path.join(userDir, filename);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filename}`);
    }
    throw error;
  }
}

/**
 * Delete a file from user's workspace
 */
export async function deleteFile(userId: string, filename: string): Promise<boolean> {
  const validation = validateFilename(filename);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const userDir = getUserWorkspacePath(userId);
  const filePath = path.join(userDir, filename);

  try {
    await fs.unlink(filePath);

    // Remove from database
    await pool.query(
      'DELETE FROM workspace_files WHERE user_id = $1 AND filename = $2',
      [userId, filename]
    );

    logger.info('Workspace file deleted', { userId, filename });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * List files in user's workspace
 */
export async function listFiles(userId: string): Promise<WorkspaceFile[]> {
  const userDir = getUserWorkspacePath(userId);

  try {
    await fs.access(userDir);
  } catch {
    return []; // Directory doesn't exist yet
  }

  try {
    const files = await fs.readdir(userDir);
    const fileList: WorkspaceFile[] = [];

    for (const filename of files) {
      const filePath = path.join(userDir, filename);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          fileList.push({
            id: '', // Will be populated from DB if needed
            name: filename,
            path: filePath,
            size: stat.size,
            mimeType: getMimeType(filename),
            createdAt: stat.birthtime,
            updatedAt: stat.mtime,
          });
        }
      } catch {
        // Skip files we can't stat
      }
    }

    return fileList.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  } catch (error) {
    logger.error('Failed to list workspace files', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Check if a file exists in user's workspace
 */
export async function fileExists(userId: string, filename: string): Promise<boolean> {
  const validation = validateFilename(filename);
  if (!validation.valid) {
    return false;
  }

  const userDir = getUserWorkspacePath(userId);
  const filePath = path.join(userDir, filename);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get workspace statistics for a user
 */
export async function getWorkspaceStats(userId: string): Promise<WorkspaceStats> {
  const files = await listFiles(userId);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    totalFiles: files.length,
    totalSize,
    maxFiles: MAX_FILES_PER_USER,
    maxFileSize: MAX_FILE_SIZE,
  };
}

/**
 * Get file path for sandbox execution
 * Returns the path as seen from inside the sandbox container
 */
export function getSandboxFilePath(userId: string, filename: string): string {
  // In sandbox, workspace is mounted at /workspace
  return path.join('/workspace', userId, filename);
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.py': 'text/x-python',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.mdown': 'text/markdown',
    '.mkdn': 'text/markdown',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.sql': 'application/sql',
    '.sh': 'application/x-sh',
    '.r': 'text/x-r',
    '.ipynb': 'application/x-ipynb+json',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeTypes[ext] || 'text/plain';
}

export default {
  writeFile,
  readFile,
  deleteFile,
  listFiles,
  fileExists,
  getWorkspaceStats,
  getSandboxFilePath,
  getUserWorkspacePath,
  getWorkspaceFileUrl,
};
