import { query } from '../db/postgres.js';
import { readFile as readWorkspaceFile, writeFile as writeWorkspaceFile } from '../abilities/workspace.service.js';
import { readProjectFile, writeProjectFile } from '../abilities/project.service.js';
import logger from '../utils/logger.js';
import * as Y from 'yjs';
import * as path from 'path';

interface FileEditorMapping {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string;
  editor_document_id: string;
  last_synced_at: string;
  created_at: string;
}

interface EditorDocument {
  name: string;
  content: Buffer | null;
}

const TEXT_MIME_PREFIXES = [
  'text/',
  'application/javascript',
  'application/typescript',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/sql',
  'application/x-sh',
  'application/x-python',
];

/**
 * Check if a file is a text file based on MIME type or extension
 */
export function isTextFile(mimeTypeOrFilename: string): boolean {
  // Check MIME type
  if (TEXT_MIME_PREFIXES.some(prefix => mimeTypeOrFilename.startsWith(prefix))) {
    return true;
  }
  // Check extension as fallback
  const ext = path.extname(mimeTypeOrFilename).toLowerCase();
  const textExtensions = new Set([
    '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
    '.xml', '.yaml', '.yml', '.csv', '.sql', '.sh', '.py', '.r', '.ipynb',
  ]);
  return textExtensions.has(ext);
}

/**
 * Generate a document ID for the editor based on source type
 */
function generateDocumentId(userId: string, sourceType: string, sourceId: string): string {
  if (sourceType === 'workspace') {
    return `workspace:${userId}:${sourceId}`;
  }
  // project sourceId is already "projectId:filename"
  return `project:${sourceId}`;
}

/**
 * Get or create a mapping between a filesystem file and an editor document.
 * If no mapping exists, reads the file content and initializes a Y.js document.
 */
export async function getOrCreateEditorMapping(
  userId: string,
  sourceType: 'workspace' | 'project',
  sourceId: string
): Promise<{ documentId: string; documentName: string; isNew: boolean; initialContent?: string }> {
  // Check for existing mapping
  const existing = await query<FileEditorMapping>(
    'SELECT * FROM file_editor_mappings WHERE user_id = $1 AND source_type = $2 AND source_id = $3',
    [userId, sourceType, sourceId]
  );

  if (existing.length > 0) {
    const mapping = existing[0];
    return {
      documentId: mapping.editor_document_id,
      documentName: mapping.editor_document_id,
      isNew: false,
    };
  }

  // Create new mapping
  const documentId = generateDocumentId(userId, sourceType, sourceId);

  // Read file content from filesystem
  let fileContent: string;
  try {
    if (sourceType === 'workspace') {
      fileContent = await readWorkspaceFile(userId, sourceId);
    } else {
      // sourceId format: "projectId:filename"
      const [projectId, ...filenameParts] = sourceId.split(':');
      const filename = filenameParts.join(':');
      // Need to look up project name from projectId
      const projectRows = await query<{ name: string }>(
        'SELECT name FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, userId]
      );
      if (projectRows.length === 0) {
        throw new Error('Project not found');
      }
      fileContent = await readProjectFile(userId, projectRows[0].name, filename);
    }
  } catch (error) {
    logger.error('Failed to read source file for editor bridge', { sourceType, sourceId, error });
    throw error;
  }

  // Store mapping (don't pre-create Y.js doc - let TipTap handle initialization)
  await query(
    `INSERT INTO file_editor_mappings (user_id, source_type, source_id, editor_document_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, source_type, source_id) DO UPDATE
     SET editor_document_id = EXCLUDED.editor_document_id`,
    [userId, sourceType, sourceId, documentId]
  );

  logger.info('Created editor bridge mapping', { userId, sourceType, sourceId, documentId });

  return {
    documentId,
    documentName: documentId,
    isNew: true,
    initialContent: fileContent,
  };
}

/**
 * Sync editor document content back to the filesystem
 */
export async function syncEditorToFile(
  userId: string,
  documentId: string
): Promise<{ success: boolean }> {
  // Find the mapping
  const mappings = await query<FileEditorMapping>(
    'SELECT * FROM file_editor_mappings WHERE editor_document_id = $1 AND user_id = $2',
    [documentId, userId]
  );

  if (mappings.length === 0) {
    throw new Error('No mapping found for this document');
  }

  const mapping = mappings[0];

  // Load the Y.js document from the database
  const docs = await query<EditorDocument>(
    'SELECT content FROM editor_documents WHERE name = $1',
    [documentId]
  );

  if (docs.length === 0 || !docs[0].content) {
    throw new Error('Editor document not found');
  }

  // Extract plain text from Y.js document
  const ydoc = new Y.Doc();
  const uint8Array = new Uint8Array(docs[0].content);
  Y.applyUpdate(ydoc, uint8Array);

  const xmlFragment = ydoc.getXmlFragment('default');
  const plainText = extractTextFromXmlFragment(xmlFragment);
  ydoc.destroy();

  // Write back to filesystem
  try {
    if (mapping.source_type === 'workspace') {
      await writeWorkspaceFile(userId, mapping.source_id, plainText);
    } else {
      // source_id format: "projectId:filename"
      const [projectId, ...filenameParts] = mapping.source_id.split(':');
      const filename = filenameParts.join(':');
      const projectRows = await query<{ name: string }>(
        'SELECT name FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, userId]
      );
      if (projectRows.length === 0) {
        throw new Error('Project not found');
      }
      await writeProjectFile(projectId, userId, projectRows[0].name, filename, plainText);
    }
  } catch (error) {
    logger.error('Failed to sync editor to file', { documentId, error });
    throw error;
  }

  // Update last_synced_at
  await query(
    'UPDATE file_editor_mappings SET last_synced_at = CURRENT_TIMESTAMP WHERE id = $1',
    [mapping.id]
  );

  logger.debug('Synced editor to file', { documentId, sourceType: mapping.source_type, sourceId: mapping.source_id });

  return { success: true };
}

/**
 * Extract plain text from a Y.js XmlFragment (TipTap document structure)
 */
function extractTextFromXmlFragment(fragment: Y.XmlFragment): string {
  const lines: string[] = [];

  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement) {
      lines.push(extractTextFromElement(child));
    } else if (child instanceof Y.XmlText) {
      lines.push(child.toString());
    }
  }

  return lines.join('\n');
}

/**
 * Extract text from a Y.js XmlElement recursively
 */
function extractTextFromElement(element: Y.XmlElement): string {
  const parts: string[] = [];

  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (child instanceof Y.XmlText) {
      parts.push(child.toString());
    } else if (child instanceof Y.XmlElement) {
      parts.push(extractTextFromElement(child));
    }
  }

  return parts.join('');
}
