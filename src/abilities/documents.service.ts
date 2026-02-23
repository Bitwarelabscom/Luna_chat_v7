import { pool } from '../db/index.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import logger from '../utils/logger.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import * as vision from './vision.service.js';
import pdfParse from 'pdf-parse';

const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || '/app/documents';
const MAX_CHUNK_SIZE = 1000; // characters per chunk
const CHUNK_OVERLAP = 200;

// SECURITY: Allowed file types whitelist
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdown', '.mkdn', '.json', '.csv', '.js', '.ts', '.html', '.xml', '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.pptx',
  // Image extensions
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
]);
const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
  // Image MIME types
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate uploaded file for security
 */
async function validateFile(
  buffer: Buffer,
  originalName: string,
  claimedMimeType: string
): Promise<{ isValid: boolean; error?: string; detectedMimeType?: string }> {
  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return { isValid: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
  }

  // Check extension
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { isValid: false, error: `File extension "${ext}" not allowed` };
  }

  // Detect actual MIME type from file content
  const detectedType = await fileTypeFromBuffer(buffer);
  const detectedMimeType = detectedType?.mime || claimedMimeType || 'application/octet-stream';

  // For text files, file-type may not detect MIME, so we trust the extension
  const isTextFile = ['.txt', '.md', '.markdown', '.mdown', '.mkdn', '.json', '.csv', '.js', '.ts', '.html', '.xml'].includes(ext);
  const isImageFile = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
  if (!isTextFile && !isImageFile && detectedType) {
    // For binary files, verify the detected MIME type is allowed
    if (!ALLOWED_MIME_TYPES.has(detectedType.mime)) {
      return { isValid: false, error: `Detected file type "${detectedType.mime}" not allowed` };
    }
  }

  // Prevent path traversal in filename
  const sanitizedName = path.basename(originalName);
  if (sanitizedName !== originalName || originalName.includes('..')) {
    return { isValid: false, error: 'Invalid filename detected' };
  }

  return { isValid: true, detectedMimeType };
}

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  size: number;  // Alias for frontend compatibility
  status: 'processing' | 'ready' | 'error';
  errorMessage?: string;
  createdAt: Date;
  uploadedAt: string;  // ISO string for frontend compatibility
  chunksCount: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  similarity?: number;
}

/**
 * Upload and process a document with security validation
 */
export async function uploadDocument(
  userId: string,
  file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }
): Promise<Document> {
  // SECURITY: Validate file before processing
  const validation = await validateFile(file.buffer, file.originalname, file.mimetype);
  if (!validation.isValid) {
    logger.warn('File upload rejected', { userId, reason: validation.error, filename: file.originalname });
    throw new Error(validation.error);
  }

  const docId = randomUUID();
  // SECURITY: Use random UUID for filename, store original name separately in database
  const ext = path.extname(file.originalname).toLowerCase();
  const secureFilename = `${docId}${ext}`;  // Random filename prevents path traversal
  const filename = `${userId}/${secureFilename}`;
  const storagePath = path.join(DOCUMENTS_DIR, filename);

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(storagePath), { recursive: true, mode: 0o750 });

    // Save file with restricted permissions
    await fs.writeFile(storagePath, file.buffer, { mode: 0o640 });

    // Use detected MIME type if available
    const mimeType = validation.detectedMimeType || file.mimetype;

    // Create database record
    const result = await pool.query(
      `INSERT INTO documents (id, user_id, filename, original_name, mime_type, file_size, storage_path, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
       RETURNING id, filename, original_name, mime_type, file_size, status, created_at`,
      [docId, userId, filename, file.originalname, mimeType, file.buffer.length, storagePath]
    );

    const doc = mapRowToDocument(result.rows[0]);

    // Process document asynchronously
    processDocument(docId, userId, storagePath, mimeType).catch(error => {
      logger.error('Document processing failed', { docId, error: (error as Error).message });
    });

    logger.info('Document uploaded successfully', { userId, docId, originalName: file.originalname });
    return doc;
  } catch (error) {
    logger.error('Failed to upload document', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Process document - extract text and create embeddings
 */
async function processDocument(
  docId: string,
  userId: string,
  storagePath: string,
  mimeType: string
): Promise<void> {
  try {
    // Read file content
    const content = await fs.readFile(storagePath);
    let text = '';

    // Check if this is an image - use vision AI for analysis
    if (vision.isImageMimeType(mimeType)) {
      logger.info('Processing image with vision AI', { docId, mimeType });
      try {
        const analysis = await vision.analyzeImage(content, mimeType, {
          prompt: `Analyze this image thoroughly. Describe:
1. What is shown in the image (objects, people, scenes, text)
2. Colors, composition, and visual style
3. Any text visible in the image (transcribe it)
4. Context and meaning if apparent
5. Any notable details or elements

Be detailed and specific so this description can be used for search and reference.`,
          loggingContext: {
            userId,
            nodeName: 'document_image_analysis',
          },
        });
        text = `[Image Analysis by ${analysis.model}]\n\n${analysis.description}`;
        logger.info('Image analyzed successfully', { docId, provider: analysis.provider, model: analysis.model });
      } catch (visionError) {
        logger.error('Vision analysis failed', { docId, error: (visionError as Error).message });
        throw new Error(`Image analysis failed: ${(visionError as Error).message}`);
      }
    }
    // Extract text based on mime type for non-images
    else if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown') {
      text = content.toString('utf-8');
    } else if (mimeType === 'application/json') {
      const json = JSON.parse(content.toString('utf-8'));
      text = JSON.stringify(json, null, 2);
    } else if (mimeType.includes('javascript') || mimeType.includes('typescript')) {
      text = content.toString('utf-8');
    } else if (mimeType === 'text/csv') {
      text = content.toString('utf-8');
    } else if (mimeType === 'text/html') {
      // Basic HTML text extraction
      text = content.toString('utf-8')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else if (mimeType === 'application/pdf') {
      try {
        const data = await (pdfParse as any)(content);
        text = data.text;
      } catch (pdfError) {
        logger.error('PDF parsing failed', { docId, error: (pdfError as Error).message });
        throw new Error('Failed to extract text from PDF');
      }
    } else {
      // Try to read as text
      text = content.toString('utf-8');
    }

    if (!text.trim()) {
      throw new Error('No text content could be extracted');
    }

    // Chunk the text
    const chunks = chunkText(text);

    // INSERT all chunks immediately (without embeddings) so the content is readable
    // right after text extraction - critical for images where vision analysis is done
    // but embedding generation still takes time
    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content)
         VALUES ($1, $2, $3)`,
        [docId, i, chunks[i]]
      );
    }

    logger.info('Document text extracted and chunks stored', { docId, chunks: chunks.length });

    // Now generate embeddings for each chunk and update in place
    for (let i = 0; i < chunks.length; i++) {
      const { embedding } = await generateEmbedding(chunks[i]);
      const vectorString = `[${embedding.join(',')}]`;
      await pool.query(
        `UPDATE document_chunks SET embedding = $1::vector
         WHERE document_id = $2 AND chunk_index = $3`,
        [vectorString, docId, i]
      );
    }

    // Mark as ready
    await pool.query(
      `UPDATE documents SET status = 'ready', updated_at = NOW() WHERE id = $1`,
      [docId]
    );

    logger.info('Document processed', { docId, chunks: chunks.length });
  } catch (error) {
    // Mark as error
    await pool.query(
      `UPDATE documents SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [docId, (error as Error).message]
    );
    throw error;
  }
}

/**
 * Chunk text into smaller pieces
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + MAX_CHUNK_SIZE;

    // Try to break at a sentence or paragraph
    if (end < text.length) {
      const breakPoints = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', '];
      for (const bp of breakPoints) {
        const lastBreak = text.lastIndexOf(bp, end);
        if (lastBreak > start + MAX_CHUNK_SIZE / 2) {
          end = lastBreak + bp.length;
          break;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (start >= text.length) break;
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Get user's documents
 */
export async function getDocuments(
  userId: string,
  options: { status?: string; limit?: number } = {}
): Promise<Document[]> {
  const { status, limit = 50 } = options;

  try {
    let query = `
      SELECT d.id, d.filename, d.original_name, d.mime_type, d.file_size, d.status, d.error_message, d.created_at,
             COALESCE(c.chunk_count, 0) as chunk_count
      FROM documents d
      LEFT JOIN (
        SELECT document_id, COUNT(*) as chunk_count
        FROM document_chunks
        GROUP BY document_id
      ) c ON c.document_id = d.id
      WHERE d.user_id = $1
    `;
    const params: (string | number)[] = [userId];

    if (status) {
      query += ` AND d.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows.map(mapRowToDocument);
  } catch (error) {
    logger.error('Failed to get documents', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Search across documents
 */
export async function searchDocuments(
  userId: string,
  query: string,
  options: { documentId?: string; limit?: number } = {}
): Promise<DocumentChunk[]> {
  const { documentId, limit = 5 } = options;

  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    let sqlQuery = `
      SELECT dc.id, dc.document_id, dc.chunk_index, dc.content,
             1 - (dc.embedding <=> $1::vector) as similarity
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE d.user_id = $2 AND d.status = 'ready'
        AND 1 - (dc.embedding <=> $1::vector) > 0.3
    `;
    const params: (string | number)[] = [vectorString, userId];

    if (documentId) {
      sqlQuery += ` AND dc.document_id = $3`;
      params.push(documentId);
    }

    sqlQuery += ` ORDER BY dc.embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sqlQuery, params);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      documentId: row.document_id as string,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      similarity: parseFloat(row.similarity as string),
    }));
  } catch (error) {
    logger.error('Failed to search documents', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Delete a document
 */
export async function deleteDocument(userId: string, docId: string): Promise<boolean> {
  try {
    // Get storage path
    const result = await pool.query(
      `SELECT storage_path FROM documents WHERE id = $1 AND user_id = $2`,
      [docId, userId]
    );

    if (result.rows.length === 0) return false;

    // Delete file
    try {
      await fs.unlink(result.rows[0].storage_path);
    } catch {
      // File might not exist
    }

    // Delete from database (cascades to chunks)
    await pool.query(`DELETE FROM documents WHERE id = $1`, [docId]);

    return true;
  } catch (error) {
    logger.error('Failed to delete document', { error: (error as Error).message, userId, docId });
    return false;
  }
}

/**
 * Format document search results for prompt
 */
export function formatDocumentsForPrompt(chunks: DocumentChunk[]): string {
  if (chunks.length === 0) return '';

  const formatted = chunks.map((chunk, i) =>
    `[Document ${i + 1}]\n${chunk.content.slice(0, 500)}${chunk.content.length > 500 ? '...' : ''}`
  ).join('\n\n');

  return `[Relevant Document Excerpts]\n${formatted}`;
}

const INLINE_DOC_THRESHOLD = 2000; // chars - non-image docs smaller than this are injected inline

/**
 * Build a context block for the given document IDs.
 * Images: always inject inline (vision analysis is the only way to access image content).
 * Small docs (<= 2000 chars): inject inline.
 * Large docs: mention with note to use search_documents tool.
 * Still-processing docs: tell Luna the file is being analyzed so it can inform the user.
 */
export async function getDocumentContextBlock(
  documentIds: string[],
  userId: string
): Promise<string> {
  if (!documentIds || documentIds.length === 0) return '';

  const sections: string[] = [];

  for (const docId of documentIds) {
    try {
      // Fetch document metadata - include all statuses (not just 'ready') so we can
      // handle processing/error states gracefully
      const docResult = await pool.query(
        `SELECT original_name, mime_type, status FROM documents WHERE id = $1 AND user_id = $2`,
        [docId, userId]
      );
      if (docResult.rows.length === 0) continue;

      const originalName = docResult.rows[0].original_name as string;
      const mimeType = docResult.rows[0].mime_type as string;
      const status = docResult.rows[0].status as string;

      if (status === 'error') {
        sections.push(`--- ${originalName} (analysis failed - could not extract content) ---`);
        continue;
      }

      // Fetch all chunks ordered by index - chunks are inserted right after text
      // extraction so they may exist even while status is still 'processing'
      const chunkResult = await pool.query(
        `SELECT content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index ASC`,
        [docId]
      );

      const isImage = mimeType.startsWith('image/');

      if (chunkResult.rows.length === 0) {
        // No chunks yet - vision analysis still in progress
        if (status === 'processing') {
          sections.push(`--- ${originalName} (still being analyzed - let the user know and they can resend the message in a moment) ---`);
        }
        continue;
      }

      const fullContent = (chunkResult.rows as { content: string }[])
        .map(r => r.content)
        .join('\n');

      if (isImage || fullContent.length <= INLINE_DOC_THRESHOLD) {
        // Images always inline (vision analysis IS the content); small docs inline too
        sections.push(`--- ${originalName} ---\n${fullContent}`);
      } else {
        sections.push(`--- ${originalName} (large file - use search_documents tool to search its contents) ---`);
      }
    } catch (err) {
      logger.warn('Failed to fetch document for context block', { docId, error: (err as Error).message });
    }
  }

  if (sections.length === 0) return '';
  return `[Attached Files]\n${sections.join('\n\n')}`;
}

function mapRowToDocument(row: Record<string, unknown>): Document {
  const fileSize = row.file_size as number;
  const createdAt = row.created_at as Date;
  return {
    id: row.id as string,
    filename: row.filename as string,
    originalName: row.original_name as string,
    mimeType: row.mime_type as string,
    fileSize,
    size: fileSize,  // Alias for frontend compatibility
    status: row.status as 'processing' | 'ready' | 'error',
    errorMessage: row.error_message as string | undefined,
    createdAt,
    uploadedAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),  // ISO string for frontend
    chunksCount: Number(row.chunk_count) || 0,
  };
}

export default {
  uploadDocument,
  getDocuments,
  searchDocuments,
  deleteDocument,
  formatDocumentsForPrompt,
  getDocumentContextBlock,
};
