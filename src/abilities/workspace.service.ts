import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_FILES_PER_USER = 2000;

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

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  permissions: string; // octal e.g. "644"
  isDirectory: boolean;
  isExecutable: boolean;
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;
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
 * Allows nested paths (e.g. dj-luna/My Project/song.md) but prevents traversal.
 */
function validateFilename(filename: string): { valid: boolean; error?: string } {
  // Prevent absolute paths and path traversal
  if (path.isAbsolute(filename) || filename.includes('..') || filename.includes('\\')) {
    return { valid: false, error: 'Invalid filename - path traversal not allowed' };
  }

  // Check each path segment is non-empty
  const parts = filename.split('/');
  for (const part of parts) {
    if (!part) return { valid: false, error: 'Invalid filename - empty path segment' };
  }

  // Extension check on the last segment only
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File extension "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` };
  }

  // Check filename length
  if (filename.length > 500) {
    return { valid: false, error: 'Filename too long (max 500 characters)' };
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
    // Ensure parent directories exist (supports nested paths like dj-luna/Project/song.md)
    await fs.mkdir(path.dirname(filePath), { recursive: true });

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
 * List files in user's workspace - reads from DB so nested paths are returned correctly.
 */
export async function listFiles(userId: string): Promise<WorkspaceFile[]> {
  try {
    const result = await pool.query(
      `SELECT id, filename, file_size, mime_type, created_at, updated_at
       FROM workspace_files WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.filename as string,
      path: row.filename as string,  // relative path, e.g. 'dj-luna/My Project/song.md'
      size: Number(row.file_size) || 0,
      mimeType: row.mime_type as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }));
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
 * Validate a directory path for security (no extension check needed)
 */
function validateDirPath(dirPath: string): { valid: boolean; error?: string } {
  if (path.isAbsolute(dirPath) || dirPath.includes('..') || dirPath.includes('\\')) {
    return { valid: false, error: 'Invalid path - path traversal not allowed' };
  }
  const parts = dirPath.split('/');
  for (const part of parts) {
    if (!part) return { valid: false, error: 'Invalid path - empty path segment' };
  }
  if (dirPath.length > 500) {
    return { valid: false, error: 'Path too long (max 500 characters)' };
  }
  return { valid: true };
}

// Allowed chmod modes whitelist
const ALLOWED_MODES = new Set([0o644, 0o640, 0o755, 0o750, 0o700, 0o600]);

/**
 * Rename/move a file within user's workspace
 */
export async function renameFile(
  userId: string,
  oldFilename: string,
  newFilename: string
): Promise<WorkspaceFile> {
  const oldValidation = validateFilename(oldFilename);
  if (!oldValidation.valid) throw new Error(oldValidation.error);
  const newValidation = validateFilename(newFilename);
  if (!newValidation.valid) throw new Error(newValidation.error);

  const userDir = getUserWorkspacePath(userId);
  const oldPath = path.join(userDir, oldFilename);
  const newPath = path.join(userDir, newFilename);

  // Check source exists
  try {
    await fs.access(oldPath);
  } catch {
    throw new Error(`File not found: ${oldFilename}`);
  }

  // Check destination doesn't exist
  try {
    await fs.access(newPath);
    throw new Error(`Destination already exists: ${newFilename}`);
  } catch (error) {
    if ((error as Error).message.includes('Destination already exists')) throw error;
    // ENOENT is expected - destination doesn't exist
  }

  // Ensure parent directory of destination exists
  await fs.mkdir(path.dirname(newPath), { recursive: true });

  // Rename on filesystem first
  await fs.rename(oldPath, newPath);

  try {
    // Update database
    const fileStat = await fs.stat(newPath);
    await pool.query(
      `UPDATE workspace_files
       SET filename = $1, file_path = $2, mime_type = $3, updated_at = NOW()
       WHERE user_id = $4 AND filename = $5`,
      [newFilename, newPath, getMimeType(newFilename), userId, oldFilename]
    );

    logger.info('Workspace file renamed', { userId, oldFilename, newFilename });

    return {
      id: '', // DB doesn't return id on update
      name: newFilename,
      path: newFilename,
      size: fileStat.size,
      mimeType: getMimeType(newFilename),
      createdAt: fileStat.birthtime,
      updatedAt: new Date(),
    };
  } catch (error) {
    // Rollback filesystem change on DB failure
    try { await fs.rename(newPath, oldPath); } catch { /* best effort */ }
    throw error;
  }
}

/**
 * Rename/move a directory and all files under it
 */
export async function renameDirectory(
  userId: string,
  oldPrefix: string,
  newPrefix: string
): Promise<{ success: boolean; filesUpdated: number }> {
  const oldValidation = validateDirPath(oldPrefix);
  if (!oldValidation.valid) throw new Error(oldValidation.error);
  const newValidation = validateDirPath(newPrefix);
  if (!newValidation.valid) throw new Error(newValidation.error);

  const userDir = getUserWorkspacePath(userId);
  const oldDirPath = path.join(userDir, oldPrefix);
  const newDirPath = path.join(userDir, newPrefix);

  // Check source exists
  try {
    const stat = await fs.stat(oldDirPath);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${oldPrefix}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory not found: ${oldPrefix}`);
    }
    throw error;
  }

  // Check destination doesn't exist
  try {
    await fs.access(newDirPath);
    throw new Error(`Destination already exists: ${newPrefix}`);
  } catch (error) {
    if ((error as Error).message.includes('Destination already exists')) throw error;
  }

  // Ensure parent of destination exists
  await fs.mkdir(path.dirname(newDirPath), { recursive: true });

  // Get client for transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find all files under old prefix
    const result = await client.query(
      `SELECT filename FROM workspace_files
       WHERE user_id = $1 AND filename LIKE $2`,
      [userId, oldPrefix + '/%']
    );

    // Update each filename in DB
    for (const row of result.rows) {
      const oldName = (row as Record<string, string>).filename;
      const newName = newPrefix + oldName.substring(oldPrefix.length);
      const newFilePath = path.join(userDir, newName);
      await client.query(
        `UPDATE workspace_files
         SET filename = $1, file_path = $2, mime_type = $3, updated_at = NOW()
         WHERE user_id = $4 AND filename = $5`,
        [newName, newFilePath, getMimeType(newName), userId, oldName]
      );
    }

    // Rename directory on filesystem
    await fs.rename(oldDirPath, newDirPath);

    await client.query('COMMIT');
    logger.info('Workspace directory renamed', { userId, oldPrefix, newPrefix, filesUpdated: result.rows.length });
    return { success: true, filesUpdated: result.rows.length };
  } catch (error) {
    await client.query('ROLLBACK');
    // Attempt filesystem rollback
    try { await fs.rename(newDirPath, oldDirPath); } catch { /* best effort */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create a directory in user's workspace (filesystem only - dirs are implicit from file paths)
 */
export async function createDirectory(userId: string, dirPath: string): Promise<void> {
  const validation = validateDirPath(dirPath);
  if (!validation.valid) throw new Error(validation.error);

  const userDir = await ensureUserWorkspace(userId);
  const fullPath = path.join(userDir, dirPath);
  await fs.mkdir(fullPath, { recursive: true, mode: 0o750 });
  logger.info('Workspace directory created', { userId, dirPath });
}

/**
 * Delete a directory and all files under it
 */
export async function deleteDirectory(
  userId: string,
  dirPath: string
): Promise<{ success: boolean; deletedCount: number }> {
  const validation = validateDirPath(dirPath);
  if (!validation.valid) throw new Error(validation.error);

  const userDir = getUserWorkspacePath(userId);
  const fullPath = path.join(userDir, dirPath);

  // Delete matching files from DB
  const result = await pool.query(
    `DELETE FROM workspace_files
     WHERE user_id = $1 AND (filename LIKE $2 OR filename = $3)
     RETURNING id`,
    [userId, dirPath + '/%', dirPath]
  );

  // Remove directory from filesystem
  try {
    await fs.rm(fullPath, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to remove directory from filesystem', { error: (error as Error).message, dirPath });
    }
  }

  logger.info('Workspace directory deleted', { userId, dirPath, deletedCount: result.rows.length });
  return { success: true, deletedCount: result.rows.length };
}

/**
 * Set file permissions (chmod) with allowed modes whitelist
 */
export async function setPermissions(
  userId: string,
  filename: string,
  mode: number
): Promise<FileInfo> {
  const validation = validateFilename(filename);
  if (!validation.valid) throw new Error(validation.error);

  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(`Permission mode ${mode.toString(8)} not allowed. Allowed: ${[...ALLOWED_MODES].map(m => m.toString(8)).join(', ')}`);
  }

  const userDir = getUserWorkspacePath(userId);
  const filePath = path.join(userDir, filename);

  await fs.chmod(filePath, mode);
  return getFileInfo(userId, filename);
}

/**
 * Get detailed file info including permissions
 */
export async function getFileInfo(userId: string, filename: string): Promise<FileInfo> {
  const validation = validateFilename(filename);
  if (!validation.valid) throw new Error(validation.error);

  const userDir = getUserWorkspacePath(userId);
  const filePath = path.join(userDir, filename);

  const stat = await fs.stat(filePath);
  const modeOctal = (stat.mode & 0o777).toString(8);

  return {
    name: path.basename(filename),
    path: filename,
    size: stat.size,
    mimeType: getMimeType(filename),
    permissions: modeOctal,
    isDirectory: stat.isDirectory(),
    isExecutable: !!(stat.mode & 0o111),
    createdAt: stat.birthtime,
    modifiedAt: stat.mtime,
    accessedAt: stat.atime,
  };
}

/**
 * List actual directories in user's workspace (supports showing empty folders)
 */
export async function listDirectories(userId: string): Promise<string[]> {
  const userDir = getUserWorkspacePath(userId);
  try {
    await fs.access(userDir);
  } catch {
    return [];
  }

  const dirs: string[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        dirs.push(relPath);
        await walk(path.join(dir, entry.name), relPath);
      }
    }
  }
  await walk(userDir, '');
  return dirs.sort();
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
  renameFile,
  renameDirectory,
  createDirectory,
  deleteDirectory,
  setPermissions,
  getFileInfo,
  listDirectories,
};
