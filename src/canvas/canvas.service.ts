import { query } from '../db/postgres.js';
import { redis } from '../db/redis.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as imageGeneration from '../abilities/image-generation.service.js';

// ============================================
// Pattern Detection Types
// ============================================

export interface EditPattern {
  type: 'type_addition' | 'error_handling' | 'documentation' | 'formatting' | 'best_practice' | 'async_pattern';
  description: string;
  occurrences: number;
  confidence: number;
  examples: string[];
}

export interface PatternDetection {
  id: string;
  userId: string;
  patternType: string;
  description: string;
  occurrences: number;
  confidence: number;
  examples: string[];
  promotedToRule: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Validation & Error Handling
// ============================================

const VALID_LANGUAGES = [
  'typescript', 'javascript', 'python', 'html', 'css',
  'markdown', 'json', 'sql', 'rust', 'cpp', 'java'
];

export class CanvasError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'INVALID_INPUT' | 'DATABASE_ERROR'
  ) {
    super(message);
    this.name = 'CanvasError';
  }
}

/**
 * Validate artifact input parameters
 */
function validateArtifactInput(
  type: string,
  title: string,
  content: string,
  language?: string
): void {
  if (!type || (type !== 'code' && type !== 'text')) {
    throw new CanvasError('Invalid artifact type. Must be "code" or "text"', 'INVALID_INPUT');
  }

  if (!title || title.trim().length === 0) {
    throw new CanvasError('Title is required', 'INVALID_INPUT');
  }

  if (title.length > 255) {
    throw new CanvasError('Title must be 255 characters or less', 'INVALID_INPUT');
  }

  if (!content || content.trim().length === 0) {
    throw new CanvasError('Content is required', 'INVALID_INPUT');
  }

  if (type === 'code' && language) {
    if (!VALID_LANGUAGES.includes(language)) {
      throw new CanvasError(`Invalid language. Must be one of: ${VALID_LANGUAGES.join(', ')}`, 'INVALID_INPUT');
    }
  }
}

// ============================================
// Type Definitions
// ============================================

export interface ArtifactContent {
  id: string;
  index: number;
  type: 'code' | 'text';
  title: string;
  language?: string;
  content: string;
  createdAt: Date;
}

export interface Artifact {
  id: string;
  userId: string;
  sessionId: string | null;
  currentIndex: number;
  contents: ArtifactContent[];
  createdAt: Date;
  updatedAt: Date;
}

export interface QuickAction {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  includeReflections: boolean;
  includePrefix: boolean;
  includeRecentHistory: boolean;
  createdAt: Date;
}

export interface Reflection {
  id: string;
  userId: string;
  type: 'style_rule' | 'content';
  value: string;
  createdAt: Date;
}

export interface ArtifactSummary {
  id: string;
  sessionId: string | null;
  currentIndex: number;
  title: string;
  type: 'code' | 'text';
  language?: string;
  updatedAt: Date;
}

export interface ArtifactFile {
  id: string;
  path: string;
  fileType: 'code' | 'text' | 'image' | 'asset';
  language?: string;
  storage: 'db' | 'fs';
  content?: string;
  fsPath?: string;
  mimeType?: string;
  sizeBytes?: number;
  updatedAt: Date;
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
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
};

const ARTIFACTS_WORKSPACE_ROOT = path.join(
  process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace'),
  'artifacts'
);

function getArtifactWorkspaceDir(userId: string, artifactId: string): string {
  return path.join(ARTIFACTS_WORKSPACE_ROOT, userId, artifactId);
}

async function ensureArtifactWorkspaceDir(userId: string, artifactId: string): Promise<string> {
  const dir = getArtifactWorkspaceDir(userId, artifactId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function sanitizeRelativeAssetPath(assetPath: string): string {
  const cleaned = assetPath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('..')) {
    throw new CanvasError('Invalid asset path', 'INVALID_INPUT');
  }
  return cleaned;
}

function insertImageIntoHtml(html: string, relativePath: string, altText: string): string {
  const imgTag = `<img src="${relativePath}" alt="${altText}" />`;
  if (html.includes('<!-- LUNA_IMAGE_PLACEHOLDER -->')) {
    return html.replace('<!-- LUNA_IMAGE_PLACEHOLDER -->', imgTag);
  }
  if (html.includes('data-luna-placeholder')) {
    return html.replace(/<[^>]*data-luna-placeholder[^>]*><\/[^>]+>/i, imgTag);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}\n  ${imgTag}`);
  }
  return `${imgTag}\n${html}`;
}

function zipDirectoryWithPython(sourceDir: string, outputZip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = `
import os, sys, zipfile
src = sys.argv[1]
dst = sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(src):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, src)
            zf.write(full, rel)
`;
    const child = spawn('python3', ['-c', script, sourceDir, outputZip], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `python zip exited with code ${code}`));
    });
  });
}

function getDefaultArtifactPath(type: 'code' | 'text', language?: string): string {
  if (type === 'code') {
    if ((language || '').toLowerCase() === 'html') {
      return 'index.html';
    }
    const extension = LANGUAGE_EXTENSIONS[(language || '').toLowerCase()] || 'txt';
    return `main.${extension}`;
  }
  return 'notes.txt';
}

async function upsertArtifactMainFile(
  artifactId: string,
  type: 'code' | 'text',
  language: string | undefined,
  content: string
): Promise<void> {
  const path = getDefaultArtifactPath(type, language);
  await query(
    `INSERT INTO artifact_files (artifact_id, path, file_type, language, storage, content, updated_at)
     VALUES ($1, $2, $3, $4, 'db', $5, NOW())
     ON CONFLICT (artifact_id, path)
     DO UPDATE SET
       file_type = EXCLUDED.file_type,
       language = EXCLUDED.language,
       storage = 'db',
       content = EXCLUDED.content,
       updated_at = NOW()`,
    [artifactId, path, type, language || null, content]
  );
}

async function createArtifactSnapshot(
  artifactId: string,
  versionIndex: number,
  summary?: string,
  entryFile?: string
): Promise<void> {
  const snapshotRows: any = await query(
    `INSERT INTO artifact_snapshots (artifact_id, version_index, summary, entry_file)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (artifact_id, version_index)
     DO UPDATE SET summary = COALESCE(EXCLUDED.summary, artifact_snapshots.summary)
     RETURNING id`,
    [artifactId, versionIndex, summary || null, entryFile || null]
  );

  if (!snapshotRows || snapshotRows.length === 0) {
    throw new CanvasError('Failed to create artifact snapshot', 'DATABASE_ERROR');
  }

  const snapshotId = snapshotRows[0].id;
  await query(
    `INSERT INTO artifact_snapshot_files
      (snapshot_id, path, file_type, language, storage, content, fs_path, mime_type, size_bytes)
     SELECT $1, path, file_type, language, storage, content, fs_path, mime_type, size_bytes
     FROM artifact_files
     WHERE artifact_id = $2
     ON CONFLICT (snapshot_id, path)
     DO UPDATE SET
       file_type = EXCLUDED.file_type,
       language = EXCLUDED.language,
       storage = EXCLUDED.storage,
       content = EXCLUDED.content,
       fs_path = EXCLUDED.fs_path,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes`,
    [snapshotId, artifactId]
  );
}

/**
 * Generate a new artifact with initial content
 */
export async function generateArtifact(
  userId: string,
  sessionId: string,
  type: 'code' | 'text',
  title: string,
  content: string,
  language?: string
): Promise<{ artifactId: string; content: ArtifactContent }> {
  try {
    // Validate input
    validateArtifactInput(type, title, content, language);

    // Create artifact record
    const artifactResult: any = await query(
      `INSERT INTO artifacts (user_id, session_id, current_index)
       VALUES ($1, $2, 1)
       RETURNING id, created_at`,
      [userId, sessionId]
    );

    if (!artifactResult || artifactResult.length === 0) {
      throw new CanvasError('Failed to create artifact', 'DATABASE_ERROR');
    }

    const artifactId = artifactResult[0].id;

    // Create initial content (index 1)
    const contentResult: any = await query(
      `INSERT INTO artifact_contents (artifact_id, index, type, title, language, content)
       VALUES ($1, 1, $2, $3, $4, $5)
       RETURNING id, index, type, title, language, content, created_at`,
      [artifactId, type, title, language || null, content]
    );

    if (!contentResult || contentResult.length === 0) {
      throw new CanvasError('Failed to create artifact content', 'DATABASE_ERROR');
    }

    const artifactContent: ArtifactContent = {
      id: contentResult[0].id,
      index: contentResult[0].index,
      type: contentResult[0].type,
      title: contentResult[0].title,
      language: contentResult[0].language,
      content: contentResult[0].content,
      createdAt: contentResult[0].created_at
    };

    await upsertArtifactMainFile(artifactId, type, language, content);
    await createArtifactSnapshot(
      artifactId,
      1,
      'Initial artifact snapshot',
      getDefaultArtifactPath(type, language)
    );

    logger.info('Artifact generated', { artifactId, userId, type, title: title.substring(0, 50) });

    return { artifactId, content: artifactContent };
  } catch (error) {
    if (error instanceof CanvasError) {
      throw error;
    }
    logger.error('Error generating artifact', { error: (error as Error).message, userId });
    throw new CanvasError('Failed to generate artifact', 'DATABASE_ERROR');
  }
}

/**
 * Rewrite an existing artifact - creates a new version
 */
export async function rewriteArtifact(
  userId: string,
  artifactId: string,
  newTitle: string | undefined,
  newContent: string
): Promise<{ content: ArtifactContent }> {
  try {
    // Validate input
    if (!newContent || newContent.trim().length === 0) {
      throw new CanvasError('Content is required', 'INVALID_INPUT');
    }

    if (newTitle && newTitle.length > 255) {
      throw new CanvasError('Title must be 255 characters or less', 'INVALID_INPUT');
    }

    // Get current artifact to verify ownership and get next index
    const artifactResult: any = await query(
      `SELECT id, user_id, current_index FROM artifacts WHERE id = $1`,
      [artifactId]
    );

    if (artifactResult.length === 0) {
      throw new CanvasError('Artifact not found', 'NOT_FOUND');
    }

    if (artifactResult[0].user_id !== userId) {
      throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
    }

    // Get current content for type, language, and pattern analysis
    const currentContent: any = await query(
      `SELECT type, title, language, content FROM artifact_contents
       WHERE artifact_id = $1 AND index = $2`,
      [artifactId, artifactResult[0].current_index]
    );

    if (currentContent.length === 0) {
      throw new CanvasError('Current content not found', 'NOT_FOUND');
    }

    const nextIndex = artifactResult[0].current_index + 1;
    const title = newTitle || currentContent[0].title;
    const type = currentContent[0].type;
    const language = currentContent[0].language;
    const oldContent = currentContent[0].content; // For pattern analysis

    // Create new version
    const contentResult: any = await query(
      `INSERT INTO artifact_contents (artifact_id, index, type, title, language, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, index, type, title, language, content, created_at`,
      [artifactId, nextIndex, type, title, language, newContent]
    );

    if (!contentResult || contentResult.length === 0) {
      throw new CanvasError('Failed to create new version', 'DATABASE_ERROR');
    }

    // Update artifact's current_index
    await query(
      `UPDATE artifacts SET current_index = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [nextIndex, artifactId]
    );

    const artifactContent: ArtifactContent = {
      id: contentResult[0].id,
      index: contentResult[0].index,
      type: contentResult[0].type,
      title: contentResult[0].title,
      language: contentResult[0].language,
      content: contentResult[0].content,
      createdAt: contentResult[0].created_at
    };

    await upsertArtifactMainFile(artifactId, type, language || undefined, newContent);
    await createArtifactSnapshot(
      artifactId,
      nextIndex,
      'Artifact rewrite snapshot',
      getDefaultArtifactPath(type, language || undefined)
    );

    logger.info('Artifact rewritten', { artifactId, userId, newVersion: nextIndex });

    // Analyze edit patterns asynchronously (non-blocking)
    analyzeArtifactEdit(userId, artifactId, oldContent, newContent).catch(err => {
      logger.error('Pattern analysis failed', { error: err.message, artifactId });
    });

    return { content: artifactContent };
  } catch (error) {
    if (error instanceof CanvasError) {
      throw error;
    }
    logger.error('Error rewriting artifact', { error: (error as Error).message, userId, artifactId });
    throw new CanvasError('Failed to rewrite artifact', 'DATABASE_ERROR');
  }
}

/**
 * Update a highlighted portion of an artifact
 */
export async function updateHighlighted(
  userId: string,
  artifactId: string,
  startIndex: number,
  endIndex: number,
  newContent: string
): Promise<{ content: ArtifactContent }> {
  // Get current content
  const artifactResult: any = await query(
    `SELECT a.user_id, a.current_index, ac.content, ac.type, ac.title, ac.language
     FROM artifacts a
     JOIN artifact_contents ac ON a.id = ac.artifact_id AND a.current_index = ac.index
     WHERE a.id = $1`,
    [artifactId]
  );

  if (artifactResult.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }

  if (artifactResult[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  const currentContent = artifactResult[0].content;
  const before = currentContent.substring(0, startIndex);
  const after = currentContent.substring(endIndex);
  const updatedContent = before + newContent + after;

  // Create new version with updated content
  return rewriteArtifact(userId, artifactId, undefined, updatedContent);
}

/**
 * Get the most recently updated artifact ID for a session
 */
export async function getLatestArtifactIdForSession(
  userId: string,
  sessionId: string
): Promise<string | null> {
  const result: any = await query(
    `SELECT id
     FROM artifacts
     WHERE user_id = $1 AND session_id = $2
     ORDER BY updated_at DESC`,
    [userId, sessionId]
  );

  if (!result || result.length === 0) {
    return null;
  }

  if (result.length > 1) {
    logger.warn('Multiple artifacts in session - resolving to most recent', {
      sessionId,
      userId,
      artifactCount: result.length,
      resolvedArtifactId: result[0].id,
    });
  }

  return result[0].id;
}

/**
 * List artifact summaries for a user, optionally scoped to a session
 */
export async function listArtifacts(
  userId: string,
  options?: { sessionId?: string; limit?: number }
): Promise<ArtifactSummary[]> {
  const sessionFilter = options?.sessionId ? 'AND a.session_id = $2' : '';
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const params = options?.sessionId ? [userId, options.sessionId, limit] : [userId, limit];
  const limitParam = options?.sessionId ? '$3' : '$2';

  const rows: any = await query(
    `SELECT a.id, a.session_id, a.current_index, a.updated_at, ac.title, ac.type, ac.language
     FROM artifacts a
     JOIN artifact_contents ac ON a.id = ac.artifact_id AND a.current_index = ac.index
     WHERE a.user_id = $1 ${sessionFilter}
     ORDER BY a.updated_at DESC
     LIMIT ${limitParam}`,
    params
  );

  return rows.map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    currentIndex: row.current_index,
    title: row.title,
    type: row.type,
    language: row.language || undefined,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get a specific artifact version for loading or download
 */
export async function getArtifactVersion(
  userId: string,
  artifactId: string,
  index?: number
): Promise<ArtifactContent> {
  const artifactResult: any = await query(
    `SELECT user_id, current_index FROM artifacts WHERE id = $1`,
    [artifactId]
  );

  if (artifactResult.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }

  if (artifactResult[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  const resolvedIndex = typeof index === 'number' ? index : artifactResult[0].current_index;
  const contentResult: any = await query(
    `SELECT id, index, type, title, language, content, created_at
     FROM artifact_contents
     WHERE artifact_id = $1 AND index = $2`,
    [artifactId, resolvedIndex]
  );

  if (contentResult.length === 0) {
    throw new CanvasError('Version not found', 'NOT_FOUND');
  }

  return {
    id: contentResult[0].id,
    index: contentResult[0].index,
    type: contentResult[0].type,
    title: contentResult[0].title,
    language: contentResult[0].language,
    content: contentResult[0].content,
    createdAt: contentResult[0].created_at
  };
}

export async function listArtifactSnapshots(
  userId: string,
  artifactId: string
): Promise<Array<{ versionIndex: number; createdAt: Date; entryFile?: string }>> {
  const artifactRows: any = await query(
    `SELECT user_id FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (artifactRows.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }
  if (artifactRows[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  const rows: any = await query(
    `SELECT version_index, created_at, entry_file
     FROM artifact_snapshots
     WHERE artifact_id = $1
     ORDER BY version_index ASC`,
    [artifactId]
  );

  return rows.map((row: any) => ({
    versionIndex: row.version_index,
    createdAt: row.created_at,
    entryFile: row.entry_file || undefined,
  }));
}

export async function listArtifactFiles(
  userId: string,
  artifactId: string,
  index?: number
): Promise<ArtifactFile[]> {
  const artifactRows: any = await query(
    `SELECT user_id, current_index FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (artifactRows.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }
  if (artifactRows[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  if (typeof index === 'number') {
    const snapshotRows: any = await query(
      `SELECT id FROM artifact_snapshots WHERE artifact_id = $1 AND version_index = $2`,
      [artifactId, index]
    );
    if (snapshotRows.length === 0) {
      throw new CanvasError('Snapshot not found', 'NOT_FOUND');
    }
    const rows: any = await query(
      `SELECT id, path, file_type, language, storage, content, fs_path, mime_type, size_bytes, created_at
       FROM artifact_snapshot_files
       WHERE snapshot_id = $1
       ORDER BY path ASC`,
      [snapshotRows[0].id]
    );
    return rows.map((row: any) => ({
      id: row.id,
      path: row.path,
      fileType: row.file_type,
      language: row.language || undefined,
      storage: row.storage,
      content: row.content || undefined,
      fsPath: row.fs_path || undefined,
      mimeType: row.mime_type || undefined,
      sizeBytes: row.size_bytes || undefined,
      updatedAt: row.created_at,
    }));
  }

  let rows: any = await query(
    `SELECT id, path, file_type, language, storage, content, fs_path, mime_type, size_bytes, updated_at
     FROM artifact_files
     WHERE artifact_id = $1
     ORDER BY path ASC`,
    [artifactId]
  );

  // Backfill working files from legacy single-file content if needed
  if (rows.length === 0) {
    const currentVersion = await getArtifactVersion(userId, artifactId, artifactRows[0].current_index);
    await upsertArtifactMainFile(
      artifactId,
      currentVersion.type,
      currentVersion.language,
      currentVersion.content
    );
    await createArtifactSnapshot(
      artifactId,
      currentVersion.index,
      'Backfilled snapshot from legacy artifact content',
      getDefaultArtifactPath(currentVersion.type, currentVersion.language)
    );
    rows = await query(
      `SELECT id, path, file_type, language, storage, content, fs_path, mime_type, size_bytes, updated_at
       FROM artifact_files
       WHERE artifact_id = $1
       ORDER BY path ASC`,
      [artifactId]
    );
  }

  return rows.map((row: any) => ({
    id: row.id,
    path: row.path,
    fileType: row.file_type,
    language: row.language || undefined,
    storage: row.storage,
    content: row.content || undefined,
    fsPath: row.fs_path || undefined,
    mimeType: row.mime_type || undefined,
    sizeBytes: row.size_bytes || undefined,
    updatedAt: row.updated_at,
  }));
}

export async function saveArtifactFile(
  userId: string,
  artifactId: string,
  path: string,
  content: string,
  language?: string
): Promise<{ versionIndex: number }> {
  if (!path || !path.trim()) {
    throw new CanvasError('File path is required', 'INVALID_INPUT');
  }
  if (typeof content !== 'string') {
    throw new CanvasError('File content is required', 'INVALID_INPUT');
  }
  if (language && !VALID_LANGUAGES.includes(language)) {
    throw new CanvasError(`Invalid language. Must be one of: ${VALID_LANGUAGES.join(', ')}`, 'INVALID_INPUT');
  }

  const artifactRows: any = await query(
    `SELECT user_id, current_index FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (artifactRows.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }
  if (artifactRows[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  const cleanPath = path.replace(/^\/+/, '').trim();
  const lowerPath = cleanPath.toLowerCase();
  const codeLike = ['.html', '.css', '.js', '.ts', '.json', '.md', '.sql', '.py', '.rs', '.cpp', '.java'];
  const fileType: 'code' | 'text' = codeLike.some(ext => lowerPath.endsWith(ext)) ? 'code' : 'text';

  await query(
    `INSERT INTO artifact_files (artifact_id, path, file_type, language, storage, content, updated_at)
     VALUES ($1, $2, $3, $4, 'db', $5, NOW())
     ON CONFLICT (artifact_id, path)
     DO UPDATE SET
       file_type = EXCLUDED.file_type,
       language = EXCLUDED.language,
       storage = 'db',
       content = EXCLUDED.content,
       updated_at = NOW()`,
    [artifactId, cleanPath, fileType, language || null, content]
  );

  const currentVersion = await getArtifactVersion(userId, artifactId, artifactRows[0].current_index);
  const mainPath = getDefaultArtifactPath(currentVersion.type, currentVersion.language);
  let mainContent = currentVersion.content;

  if (cleanPath === mainPath) {
    mainContent = content;
  } else {
    const mainRows: any = await query(
      `SELECT content FROM artifact_files WHERE artifact_id = $1 AND path = $2`,
      [artifactId, mainPath]
    );
    if (mainRows.length > 0 && typeof mainRows[0].content === 'string') {
      mainContent = mainRows[0].content;
    } else {
      await upsertArtifactMainFile(artifactId, currentVersion.type, currentVersion.language, currentVersion.content);
    }
  }

  const rewritten = await rewriteArtifact(userId, artifactId, undefined, mainContent);
  return { versionIndex: rewritten.content.index };
}

export async function generateArtifactImage(
  userId: string,
  artifactId: string,
  prompt: string,
  options?: { filename?: string; autoInsert?: boolean }
): Promise<{ assetPath: string; versionIndex: number }> {
  if (!prompt || !prompt.trim()) {
    throw new CanvasError('Prompt is required', 'INVALID_INPUT');
  }

  const artifactRows: any = await query(
    `SELECT user_id, current_index FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (artifactRows.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }
  if (artifactRows[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  const artifactDir = await ensureArtifactWorkspaceDir(userId, artifactId);
  const imageResult = await imageGeneration.generateProjectImage(
    userId,
    artifactDir,
    prompt,
    options?.filename
  );
  if (!imageResult.success || !imageResult.filePath || !imageResult.relativePath) {
    throw new CanvasError(imageResult.error || 'Failed to generate image', 'DATABASE_ERROR');
  }

  const relativePath = sanitizeRelativeAssetPath(imageResult.relativePath);
  const stat = await fsp.stat(imageResult.filePath);
  await query(
    `INSERT INTO artifact_files
      (artifact_id, path, file_type, storage, fs_path, mime_type, size_bytes, updated_at)
     VALUES ($1, $2, 'image', 'fs', $3, $4, $5, NOW())
     ON CONFLICT (artifact_id, path)
     DO UPDATE SET
       file_type = 'image',
       storage = 'fs',
       fs_path = EXCLUDED.fs_path,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       updated_at = NOW()`,
    [artifactId, relativePath, imageResult.filePath, `image/${path.extname(relativePath).replace('.', '') || 'png'}`, stat.size]
  );

  // Keep compatibility by creating a new version index even when only assets change
  const currentVersion = await getArtifactVersion(userId, artifactId, artifactRows[0].current_index);
  let mainContent = currentVersion.content;

  if (options?.autoInsert && currentVersion.type === 'code' && (currentVersion.language || '').toLowerCase() === 'html') {
    mainContent = insertImageIntoHtml(mainContent, relativePath, prompt.slice(0, 80));
  }

  const rewritten = await rewriteArtifact(userId, artifactId, undefined, mainContent);
  return { assetPath: relativePath, versionIndex: rewritten.content.index };
}

export async function resolveArtifactAssetPath(
  userId: string,
  artifactId: string,
  requestedPath: string
): Promise<{ absolutePath?: string; mimeType?: string; content?: string }> {
  const cleanPath = sanitizeRelativeAssetPath(requestedPath);
  const artifactRows: any = await query(
    `SELECT user_id FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (artifactRows.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }
  if (artifactRows[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  const rows: any = await query(
    `SELECT storage, fs_path, mime_type, content
     FROM artifact_files
     WHERE artifact_id = $1 AND path = $2
     LIMIT 1`,
    [artifactId, cleanPath]
  );
  if (rows.length === 0) {
    throw new CanvasError('Asset not found', 'NOT_FOUND');
  }

  const row = rows[0];

  // Try filesystem first
  if (row.storage === 'fs' && row.fs_path && fs.existsSync(row.fs_path)) {
    return { absolutePath: row.fs_path, mimeType: row.mime_type || undefined };
  }

  // Fall back to DB content
  if (row.content != null) {
    return { content: row.content, mimeType: row.mime_type || undefined };
  }

  throw new CanvasError('Asset file missing', 'NOT_FOUND');
}

export async function buildArtifactExportZip(
  userId: string,
  artifactId: string,
  index?: number
): Promise<{ zipPath: string; filename: string }> {
  const artifact = await getArtifact(userId, artifactId);
  const versionIndex = typeof index === 'number' ? index : artifact.currentIndex;
  const files = await listArtifactFiles(userId, artifactId, versionIndex);

  const stageDir = await fsp.mkdtemp(path.join(os.tmpdir(), `artifact-${artifactId}-`));
  for (const file of files) {
    const rel = sanitizeRelativeAssetPath(file.path);
    const outPath = path.join(stageDir, rel);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });

    if (file.storage === 'db') {
      await fsp.writeFile(outPath, file.content || '', 'utf8');
    } else if (file.storage === 'fs' && file.fsPath && fs.existsSync(file.fsPath)) {
      await fsp.copyFile(file.fsPath, outPath);
    }
  }

  const zipPath = path.join(os.tmpdir(), `artifact-${artifactId}-v${versionIndex}-${randomUUID()}.zip`);
  await zipDirectoryWithPython(stageDir, zipPath);
  await fsp.rm(stageDir, { recursive: true, force: true });
  return { zipPath, filename: `artifact-${artifactId}-v${versionIndex}.zip` };
}

/**
 * Get artifact with all versions
 */
export async function getArtifact(userId: string, artifactId: string): Promise<Artifact> {
  const artifactResult: any = await query(
    `SELECT id, user_id, session_id, current_index, created_at, updated_at
     FROM artifacts WHERE id = $1`,
    [artifactId]
  );

  if (artifactResult.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }

  if (artifactResult[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  // Get all versions
  const contentsResult: any = await query(
    `SELECT id, index, type, title, language, content, created_at
     FROM artifact_contents
     WHERE artifact_id = $1
     ORDER BY index ASC`,
    [artifactId]
  );

  const contents: ArtifactContent[] = contentsResult.map((row: any) => ({
    id: row.id,
    index: row.index,
    type: row.type,
    title: row.title,
    language: row.language,
    content: row.content,
    createdAt: row.created_at
  }));

  return {
    id: artifactResult[0].id,
    userId: artifactResult[0].user_id,
    sessionId: artifactResult[0].session_id,
    currentIndex: artifactResult[0].current_index,
    contents,
    createdAt: artifactResult[0].created_at,
    updatedAt: artifactResult[0].updated_at
  };
}

/**
 * Navigate to a specific version
 */
export async function navigateToVersion(
  userId: string,
  artifactId: string,
  index: number
): Promise<{ content: ArtifactContent }> {
  // Verify ownership
  const artifactResult: any = await query(
    `SELECT user_id FROM artifacts WHERE id = $1`,
    [artifactId]
  );

  if (artifactResult.length === 0) {
    throw new CanvasError('Artifact not found', 'NOT_FOUND');
  }

  if (artifactResult[0].user_id !== userId) {
    throw new CanvasError('Unauthorized', 'UNAUTHORIZED');
  }

  // Get content at specified index
  const contentResult: any = await query(
    `SELECT id, index, type, title, language, content, created_at
     FROM artifact_contents
     WHERE artifact_id = $1 AND index = $2`,
    [artifactId, index]
  );

  if (contentResult.length === 0) {
    throw new CanvasError('Version not found', 'NOT_FOUND');
  }

  // Update current_index
  await query(
    `UPDATE artifacts SET current_index = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [index, artifactId]
  );

  return {
    content: {
      id: contentResult[0].id,
      index: contentResult[0].index,
      type: contentResult[0].type,
      title: contentResult[0].title,
      language: contentResult[0].language,
      content: contentResult[0].content,
      createdAt: contentResult[0].created_at
    }
  };
}

/**
 * Get user's reflections (style rules and content preferences)
 */
export async function getUserReflections(userId: string): Promise<Reflection[]> {
  const result: any = await query(
    `SELECT id, user_id, type, value, created_at
     FROM reflections
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    value: row.value,
    createdAt: row.created_at
  }));
}

/**
 * Add a reflection
 */
export async function addReflection(
  userId: string,
  type: 'style_rule' | 'content',
  value: string
): Promise<Reflection> {
  const result: any = await query(
    `INSERT INTO reflections (user_id, type, value)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, type, value, created_at`,
    [userId, type, value]
  );

  return {
    id: result[0].id,
    userId: result[0].user_id,
    type: result[0].type,
    value: result[0].value,
    createdAt: result[0].created_at
  };
}

/**
 * Get user's quick actions
 */
export async function getUserQuickActions(userId: string): Promise<QuickAction[]> {
  const result: any = await query(
    `SELECT id, user_id, title, prompt, include_reflections, include_prefix, include_recent_history, created_at
     FROM quick_actions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    prompt: row.prompt,
    includeReflections: row.include_reflections,
    includePrefix: row.include_prefix,
    includeRecentHistory: row.include_recent_history,
    createdAt: row.created_at
  }));
}

/**
 * Create a quick action
 */
export async function createQuickAction(
  userId: string,
  title: string,
  prompt: string,
  includeReflections: boolean = false,
  includePrefix: boolean = true,
  includeRecentHistory: boolean = true
): Promise<QuickAction> {
  const result: any = await query(
    `INSERT INTO quick_actions (user_id, title, prompt, include_reflections, include_prefix, include_recent_history)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, title, prompt, include_reflections, include_prefix, include_recent_history, created_at`,
    [userId, title, prompt, includeReflections, includePrefix, includeRecentHistory]
  );

  return {
    id: result[0].id,
    userId: result[0].user_id,
    title: result[0].title,
    prompt: result[0].prompt,
    includeReflections: result[0].include_reflections,
    includePrefix: result[0].include_prefix,
    includeRecentHistory: result[0].include_recent_history,
    createdAt: result[0].created_at
  };
}

/**
 * Delete a quick action
 */
export async function deleteQuickAction(userId: string, actionId: string): Promise<void> {
  await query(
    `DELETE FROM quick_actions WHERE id = $1 AND user_id = $2`,
    [actionId, userId]
  );
}

// ============================================
// Canvas Style Rules (Neo4j Integration)
// ============================================

/**
 * Add a canvas style rule for a user
 * Style rules guide future artifact generation
 */
export async function addStyleRule(userId: string, rule: string): Promise<boolean> {
  const { syncCanvasStyleRule } = await import('../graph/entity-graph.service.js');
  return syncCanvasStyleRule(userId, rule);
}

/**
 * Get canvas style rules for a user
 * Returns up to `limit` most recent style rules
 */
export async function getStyleRules(userId: string, limit: number = 5): Promise<string[]> {
  const { getCanvasStyleRules } = await import('../graph/entity-graph.service.js');
  return getCanvasStyleRules(userId, limit);
}

/**
 * Delete a canvas style rule
 */
export async function deleteStyleRule(userId: string, rule: string): Promise<boolean> {
  const { deleteCanvasStyleRule } = await import('../graph/entity-graph.service.js');
  return deleteCanvasStyleRule(userId, rule);
}

/**
 * Format style rules for injection into LLM context
 * Returns a formatted string block or empty string if no rules
 */
export function formatStyleRules(rules: string[]): string {
  if (rules.length === 0) return '';

  const formattedRules = rules.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n');

  return `[Canvas Style Rules]
The following style preferences should guide artifact generation:
${formattedRules}

Apply these rules when generating or modifying code/text artifacts.
`;
}

/**
 * Get canvas-specific memory context from MemoryCore
 * Fetches consolidated preferences relevant to code/text generation
 */
export async function getCanvasMemoryContext(userId: string): Promise<string> {
  try {
    const memorycoreClient = await import('../memory/memorycore.client.js');

    // Get consolidated user model (includes preferences + known facts)
    const consolidatedModel = await memorycoreClient.getConsolidatedModel(userId);

    if (!consolidatedModel) return '';

    const contextParts: string[] = [];

    // Format preferences (filter for high confidence, coding-related ones)
    if (consolidatedModel.preferences && consolidatedModel.preferences.length > 0) {
      const relevantPrefs = consolidatedModel.preferences
        .filter(p => p.confidence > 0.6) // Higher threshold for artifact generation
        .slice(0, 5)
        .map(p => `- ${p.theme}`);

      if (relevantPrefs.length > 0) {
        contextParts.push('[User Preferences for Artifacts]');
        contextParts.push(...relevantPrefs);
      }
    }

    // Format known facts (technical knowledge, frameworks, patterns)
    if (consolidatedModel.knownFacts && consolidatedModel.knownFacts.length > 0) {
      const relevantFacts = consolidatedModel.knownFacts
        .filter(f => f.confidence > 0.6)
        .slice(0, 5)
        .map(f => `- ${f.theme}`);

      if (relevantFacts.length > 0) {
        if (contextParts.length > 0) contextParts.push('');
        contextParts.push('[Known User Context]');
        contextParts.push(...relevantFacts);
      }
    }

    if (contextParts.length === 0) return '';

    contextParts.push('');
    contextParts.push('Use this context to personalize artifact generation.');

    return contextParts.join('\n');
  } catch (error) {
    // Silently fail if MemoryCore unavailable
    return '';
  }
}

// ============================================
// Automatic Pattern Detection & Reflection
// ============================================

/**
 * Analyze the diff between two artifact versions to detect patterns
 */
function analyzeVersionDiff(oldContent: string, newContent: string): EditPattern[] {
  const patterns: EditPattern[] = [];

  // Skip analysis if changes are too small (< 10 chars)
  const diffSize = Math.abs(newContent.length - oldContent.length);
  if (diffSize < 10) return patterns;

  // Pattern 1: Type additions (TypeScript)
  if (detectTypeAdditions(oldContent, newContent)) {
    patterns.push({
      type: 'type_addition',
      description: 'Adds explicit TypeScript types to functions and variables',
      occurrences: 1,
      confidence: 0.8,
      examples: [extractDiffExample(oldContent, newContent, 100)]
    });
  }

  // Pattern 2: Error handling (try-catch)
  if (detectErrorHandling(oldContent, newContent)) {
    patterns.push({
      type: 'error_handling',
      description: 'Wraps code in try-catch blocks for error handling',
      occurrences: 1,
      confidence: 0.8,
      examples: [extractDiffExample(oldContent, newContent, 100)]
    });
  }

  // Pattern 3: Documentation (comments, JSDoc)
  if (detectDocumentation(oldContent, newContent)) {
    patterns.push({
      type: 'documentation',
      description: 'Adds comments and documentation to code',
      occurrences: 1,
      confidence: 0.8,
      examples: [extractDiffExample(oldContent, newContent, 100)]
    });
  }

  // Pattern 4: Async/await conversion
  if (detectAsyncPattern(oldContent, newContent)) {
    patterns.push({
      type: 'async_pattern',
      description: 'Converts promises to async/await pattern',
      occurrences: 1,
      confidence: 0.8,
      examples: [extractDiffExample(oldContent, newContent, 100)]
    });
  }

  return patterns;
}

/**
 * Detect if TypeScript types were added
 */
function detectTypeAdditions(oldContent: string, newContent: string): boolean {
  // Check for type annotations that weren't there before
  const typePatterns = [
    /:\s*(string|number|boolean|object|any|void|Promise|Array)/g,
    /interface\s+\w+/g,
    /type\s+\w+\s*=/g,
    /<\w+>/g // Generics
  ];

  const oldTypeCount = typePatterns.reduce((count, pattern) => {
    return count + (oldContent.match(pattern)?.length || 0);
  }, 0);

  const newTypeCount = typePatterns.reduce((count, pattern) => {
    return count + (newContent.match(pattern)?.length || 0);
  }, 0);

  // Significant increase in type annotations
  return newTypeCount > oldTypeCount + 2;
}

/**
 * Detect if error handling was added
 */
function detectErrorHandling(oldContent: string, newContent: string): boolean {
  const oldTryCatch = (oldContent.match(/try\s*\{/g)?.length || 0);
  const newTryCatch = (newContent.match(/try\s*\{/g)?.length || 0);

  const oldCatch = (oldContent.match(/catch\s*\(/g)?.length || 0);
  const newCatch = (newContent.match(/catch\s*\(/g)?.length || 0);

  // Added try-catch blocks
  return (newTryCatch > oldTryCatch) && (newCatch > oldCatch);
}

/**
 * Detect if documentation was added
 */
function detectDocumentation(oldContent: string, newContent: string): boolean {
  // Count comment blocks
  const oldComments = (oldContent.match(/\/\*\*[\s\S]*?\*\//g)?.length || 0) +
                      (oldContent.match(/\/\/.+/g)?.length || 0);
  const newComments = (newContent.match(/\/\*\*[\s\S]*?\*\//g)?.length || 0) +
                      (newContent.match(/\/\/.+/g)?.length || 0);

  // Check for JSDoc patterns
  const oldJSDoc = (oldContent.match(/@param|@returns|@description/g)?.length || 0);
  const newJSDoc = (newContent.match(/@param|@returns|@description/g)?.length || 0);

  // Significant increase in comments or JSDoc
  return (newComments > oldComments + 2) || (newJSDoc > oldJSDoc);
}

/**
 * Detect async/await pattern changes
 */
function detectAsyncPattern(oldContent: string, newContent: string): boolean {
  // Check if .then() was replaced with await
  const oldThen = (oldContent.match(/\.then\(/g)?.length || 0);
  const newThen = (newContent.match(/\.then\(/g)?.length || 0);

  const oldAwait = (oldContent.match(/await\s+/g)?.length || 0);
  const newAwait = (newContent.match(/await\s+/g)?.length || 0);

  // Converted from .then() to await
  return (oldThen > newThen) && (newAwait > oldAwait);
}

/**
 * Extract a sample of the diff for examples
 */
function extractDiffExample(_oldContent: string, newContent: string, maxLength: number): string {
  // Simple extraction - take first maxLength chars of new content
  if (newContent.length <= maxLength) return newContent;
  return newContent.substring(0, maxLength) + '...';
}

/**
 * Track a detected pattern in the database
 * Increments occurrence count if pattern already exists
 */
export async function trackPattern(userId: string, pattern: EditPattern): Promise<void> {
  try {
    // Check if this pattern type already exists for this user
    const existing: any = await query(
      `SELECT id, occurrences, examples FROM pattern_detections
       WHERE user_id = $1 AND pattern_type = $2 AND promoted_to_rule = false`,
      [userId, pattern.type]
    );

    if (existing.length > 0) {
      // Update existing pattern
      const newOccurrences = existing[0].occurrences + 1;
      const newConfidence = Math.min(0.95, newOccurrences * 0.15); // Max 0.95 confidence

      // Merge examples (keep last 5)
      const existingExamples = existing[0].examples || [];
      const mergedExamples = [...existingExamples, ...pattern.examples].slice(-5);

      await query(
        `UPDATE pattern_detections
         SET occurrences = $1, confidence = $2, examples = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newOccurrences, newConfidence, JSON.stringify(mergedExamples), existing[0].id]
      );

      logger.info('Pattern occurrence updated', {
        userId,
        patternType: pattern.type,
        occurrences: newOccurrences,
        confidence: newConfidence
      });
    } else {
      // Create new pattern detection
      await query(
        `INSERT INTO pattern_detections (user_id, pattern_type, description, occurrences, confidence, examples)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, pattern.type, pattern.description, pattern.occurrences, pattern.confidence, JSON.stringify(pattern.examples)]
      );

      logger.info('New pattern detected', {
        userId,
        patternType: pattern.type,
        description: pattern.description
      });
    }
  } catch (error) {
    logger.error('Error tracking pattern', { error: (error as Error).message, userId, patternType: pattern.type });
  }
}

/**
 * Check if patterns are ready for promotion to style rules
 * Auto-promotes patterns with confidence >= 0.7 and occurrences >= 3
 */
export async function promoteEligiblePatterns(userId: string): Promise<string[]> {
  const promotedRules: string[] = [];

  try {
    // Find patterns ready for promotion
    const eligible: any = await query(
      `SELECT id, pattern_type, description, occurrences, confidence
       FROM pattern_detections
       WHERE user_id = $1 AND promoted_to_rule = false AND confidence >= 0.7 AND occurrences >= 3`,
      [userId]
    );

    for (const pattern of eligible) {
      // Convert pattern to natural language style rule
      const styleRule = generateStyleRuleFromPattern(pattern.pattern_type, pattern.description);

      // Add to Neo4j as style rule
      const success = await addStyleRule(userId, styleRule);

      if (success) {
        // Mark pattern as promoted
        await query(
          `UPDATE pattern_detections
           SET promoted_to_rule = true, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [pattern.id]
        );

        promotedRules.push(styleRule);

        logger.info('Pattern promoted to style rule', {
          userId,
          patternType: pattern.pattern_type,
          styleRule,
          occurrences: pattern.occurrences,
          confidence: pattern.confidence
        });
      }
    }
  } catch (error) {
    logger.error('Error promoting patterns', { error: (error as Error).message, userId });
  }

  return promotedRules;
}

/**
 * Generate a natural language style rule from a pattern
 */
export function generateStyleRuleFromPattern(patternType: string, description: string): string {
  const templates: Record<string, string> = {
    type_addition: 'Always add explicit TypeScript types to functions and variables',
    error_handling: 'Wrap async operations and error-prone code in try-catch blocks',
    documentation: 'Add comprehensive comments and JSDoc documentation to all functions',
    async_pattern: 'Use async/await instead of Promise.then() chains',
    formatting: 'Follow consistent code formatting and style conventions',
    best_practice: 'Apply modern JavaScript/TypeScript best practices'
  };

  return templates[patternType] || description;
}

/**
 * Analyze artifact edit and track patterns (async, non-blocking)
 * Called after rewrite_artifact or update_highlighted
 */
export async function analyzeArtifactEdit(
  userId: string,
  artifactId: string,
  oldContent: string,
  newContent: string
): Promise<void> {
  // Run async without blocking
  setImmediate(async () => {
    try {
      // Detect patterns from diff
      const patterns = analyzeVersionDiff(oldContent, newContent);

      if (patterns.length === 0) return;

      // Track each detected pattern
      for (const pattern of patterns) {
        await trackPattern(userId, pattern);
      }

      // Check if any patterns are ready for promotion
      const promotedRules = await promoteEligiblePatterns(userId);

      if (promotedRules.length > 0) {
        logger.info('Auto-promoted patterns to style rules', {
          userId,
          artifactId,
          promotedRules
        });
        // Store notification for consumption in next chat response
        try {
          const key = `user:pattern_notification:${userId}`;
          await redis.set(key, JSON.stringify(promotedRules), 'EX', 3600);
        } catch (redisErr) {
          logger.error('Failed to store pattern notification', { error: (redisErr as Error).message });
        }
      }
    } catch (error) {
      logger.error('Error analyzing artifact edit', {
        error: (error as Error).message,
        userId,
        artifactId
      });
    }
  });
}

/**
 * Clean up filesystem-stored artifact files for a session.
 * Call before deleting a session to prevent orphaned files.
 */
export async function cleanupSessionArtifactFiles(sessionId: string): Promise<void> {
  const rows: any = await query(
    `SELECT af.fs_path
     FROM artifact_files af
     JOIN artifacts a ON a.id = af.artifact_id
     WHERE a.session_id = $1 AND af.storage = 'fs' AND af.fs_path IS NOT NULL
     UNION
     SELECT asf.fs_path
     FROM artifact_snapshot_files asf
     JOIN artifact_snapshots s ON s.id = asf.snapshot_id
     JOIN artifacts a ON a.id = s.artifact_id
     WHERE a.session_id = $1 AND asf.storage = 'fs' AND asf.fs_path IS NOT NULL`,
    [sessionId]
  );

  let cleaned = 0;
  for (const row of rows) {
    try {
      if (row.fs_path && fs.existsSync(row.fs_path)) {
        await fsp.unlink(row.fs_path);
        cleaned++;
      }
    } catch (err) {
      logger.warn('Failed to delete artifact file', { fsPath: row.fs_path, error: (err as Error).message });
    }
  }

  // Also try to remove artifact workspace directories for this session
  const artifactRows: any = await query(
    `SELECT id, user_id FROM artifacts WHERE session_id = $1`,
    [sessionId]
  );
  for (const artifact of artifactRows) {
    try {
      const dir = getArtifactWorkspaceDir(artifact.user_id, artifact.id);
      if (fs.existsSync(dir)) {
        await fsp.rm(dir, { recursive: true, force: true });
        cleaned++;
      }
    } catch (err) {
      logger.warn('Failed to remove artifact workspace dir', { artifactId: artifact.id, error: (err as Error).message });
    }
  }

  if (cleaned > 0) {
    logger.info('Cleaned up artifact files for session', { sessionId, filesRemoved: cleaned });
  }
}

/**
 * Consume pending pattern promotion notification for a user.
 * Returns the promoted rules (if any) and deletes the notification.
 */
export async function consumePatternNotification(userId: string): Promise<string[] | null> {
  try {
    const key = `user:pattern_notification:${userId}`;
    const data = await redis.get(key);
    if (!data) return null;
    await redis.del(key);
    return JSON.parse(data) as string[];
  } catch {
    return null;
  }
}
