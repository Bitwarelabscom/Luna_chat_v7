import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as workspace from './workspace.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikilinkMatch {
  text: string;
  alias?: string;
}

export interface Backlink {
  sourceFile: string;
  linkText: string;
  snippet: string;
}

export interface ForwardLink {
  targetFile: string;
  linkText: string;
}

export interface FilenameResult {
  filename: string;
}

export interface NoteGraphNode {
  filename: string;
  title: string;
  linkCount: number;
  lastModified: string;
}

export interface NoteGraphEdge {
  source: string;
  target: string;
  linkText: string;
}

export interface NoteGraph {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
}

// ---------------------------------------------------------------------------
// Wikilink parsing
// ---------------------------------------------------------------------------

/**
 * Parse all [[target]] and [[target|alias]] wikilinks from content.
 * Returns unique matches deduplicated by text+alias combination.
 */
export function parseWikilinks(content: string): WikilinkMatch[] {
  // Match [[target]] and [[target|alias]] patterns
  const regex = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;
  const seen = new Set<string>();
  const results: WikilinkMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const text = match[1].trim();
    const alias = match[2]?.trim();

    if (!text) continue;

    const key = `${text}||${alias ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry: WikilinkMatch = { text };
    if (alias) entry.alias = alias;
    results.push(entry);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Link resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a wikilink text to an actual workspace filename for a given user.
 *
 * Resolution order:
 * 1. Exact match on filename
 * 2. Case-insensitive match on filename (ILIKE)
 * 3. Try appending .md extension (exact + case-insensitive)
 * 4. Partial path match -- link text matches the last segment of a nested path
 */
export async function resolveLink(userId: string, linkText: string): Promise<string | null> {
  const text = linkText.trim();

  try {
    // 1. Exact match
    const exactResult = await pool.query<{ filename: string }>(
      `SELECT filename FROM workspace_files
       WHERE user_id = $1 AND filename = $2
       LIMIT 1`,
      [userId, text]
    );
    if (exactResult.rows.length > 0) return exactResult.rows[0].filename;

    // 2. Case-insensitive match
    const iLikeResult = await pool.query<{ filename: string }>(
      `SELECT filename FROM workspace_files
       WHERE user_id = $1 AND filename ILIKE $2
       LIMIT 1`,
      [userId, text]
    );
    if (iLikeResult.rows.length > 0) return iLikeResult.rows[0].filename;

    // 3a. Try with .md extension (exact)
    const withMd = text.endsWith('.md') ? text : `${text}.md`;
    if (withMd !== text) {
      const mdExact = await pool.query<{ filename: string }>(
        `SELECT filename FROM workspace_files
         WHERE user_id = $1 AND filename = $2
         LIMIT 1`,
        [userId, withMd]
      );
      if (mdExact.rows.length > 0) return mdExact.rows[0].filename;

      // 3b. .md extension, case-insensitive
      const mdILike = await pool.query<{ filename: string }>(
        `SELECT filename FROM workspace_files
         WHERE user_id = $1 AND filename ILIKE $2
         LIMIT 1`,
        [userId, withMd]
      );
      if (mdILike.rows.length > 0) return mdILike.rows[0].filename;
    }

    // 4. Nested path -- match by last segment (filename after the last '/')
    //    e.g. link text "My Note" matches "projects/My Note.md"
    const segmentResult = await pool.query<{ filename: string }>(
      `SELECT filename FROM workspace_files
       WHERE user_id = $1
         AND (
           filename ILIKE $2
           OR filename ILIKE $3
         )
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, `%/${text}`, `%/${text}.md`]
    );
    if (segmentResult.rows.length > 0) return segmentResult.rows[0].filename;

    return null;
  } catch (err) {
    logger.warn('resolveLink error', { userId, linkText, error: (err as Error).message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Update file links (call on file save)
// ---------------------------------------------------------------------------

/**
 * Parse wikilinks in content, resolve targets, then replace all stored
 * note_links for source_file with the fresh set.
 *
 * Unresolvable links are stored with link_text only -- target_file is set to
 * the raw link text so it can be matched later when the target is created.
 */
export async function updateFileLinks(
  userId: string,
  filename: string,
  content: string
): Promise<void> {
  const links = parseWikilinks(content);

  // Resolve all link targets concurrently
  const resolved = await Promise.all(
    links.map(async (link) => {
      const target = await resolveLink(userId, link.text);
      return { linkText: link.text, targetFile: target ?? link.text };
    })
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete old links for this source file
    await client.query(
      `DELETE FROM note_links WHERE user_id = $1 AND source_file = $2`,
      [userId, filename]
    );

    // Insert new links (ignore duplicates from the UNIQUE constraint)
    for (const { linkText, targetFile } of resolved) {
      await client.query(
        `INSERT INTO note_links (user_id, source_file, target_file, link_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, source_file, target_file, link_text) DO NOTHING`,
        [userId, filename, targetFile, linkText]
      );
    }

    await client.query('COMMIT');
    logger.debug('updateFileLinks completed', { userId, filename, linkCount: resolved.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('updateFileLinks failed', { userId, filename, error: (err as Error).message });
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Snippet extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract a short context snippet from file content around a [[link]] match.
 * Returns up to 3 lines centered on the first occurrence of [[linkText]].
 */
function extractSnippet(content: string, linkText: string): string {
  const lines = content.split('\n');
  const pattern = new RegExp(`\\[\\[${escapeRegex(linkText)}(?:\\|[^\\]]*)?\\]\\]`, 'i');

  const matchIndex = lines.findIndex((line) => pattern.test(line));
  if (matchIndex === -1) return '';

  const start = Math.max(0, matchIndex - 1);
  const end = Math.min(lines.length - 1, matchIndex + 1);
  return lines
    .slice(start, end + 1)
    .join('\n')
    .trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

/**
 * Return all notes that link to the given filename, with a context snippet
 * showing the line(s) containing the [[link]].
 */
export async function getBacklinks(
  userId: string,
  filename: string
): Promise<Backlink[]> {
  try {
    const result = await pool.query<{ source_file: string; link_text: string }>(
      `SELECT source_file, link_text
       FROM note_links
       WHERE user_id = $1 AND target_file = $2
       ORDER BY source_file`,
      [userId, filename]
    );

    const backlinks: Backlink[] = await Promise.all(
      result.rows.map(async (row) => {
        const sourceFile = row.source_file;
        const linkText = row.link_text;
        let snippet = '';

        try {
          const content = await workspace.readFile(userId, sourceFile);
          snippet = extractSnippet(content, linkText);
        } catch {
          // Source file may have been deleted -- snippet stays empty
        }

        return { sourceFile, linkText, snippet };
      })
    );

    return backlinks;
  } catch (err) {
    logger.error('getBacklinks failed', { userId, filename, error: (err as Error).message });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Forward links
// ---------------------------------------------------------------------------

/**
 * Return all notes that the given filename links to.
 */
export async function getForwardLinks(
  userId: string,
  filename: string
): Promise<ForwardLink[]> {
  try {
    const result = await pool.query<{ target_file: string; link_text: string }>(
      `SELECT target_file, link_text
       FROM note_links
       WHERE user_id = $1 AND source_file = $2
       ORDER BY target_file`,
      [userId, filename]
    );

    return result.rows.map((row) => ({
      targetFile: row.target_file,
      linkText: row.link_text,
    }));
  } catch (err) {
    logger.error('getForwardLinks failed', { userId, filename, error: (err as Error).message });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filename autocomplete search
// ---------------------------------------------------------------------------

/**
 * Search workspace filenames by prefix or substring for wikilink autocomplete.
 * Case-insensitive. Returns up to `limit` results (default 20).
 */
export async function searchFilenames(
  userId: string,
  query: string,
  limit = 20
): Promise<FilenameResult[]> {
  if (!query) return [];

  try {
    const result = await pool.query<{ filename: string }>(
      `SELECT filename
       FROM workspace_files
       WHERE user_id = $1 AND filename ILIKE $2
       ORDER BY
         CASE WHEN filename ILIKE $3 THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT $4`,
      [userId, `%${query}%`, `${query}%`, limit]
    );

    return result.rows.map((row) => ({ filename: row.filename }));
  } catch (err) {
    logger.error('searchFilenames failed', { userId, query, error: (err as Error).message });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Note graph
// ---------------------------------------------------------------------------

/**
 * Build a graph of all linked notes for a user.
 *
 * Nodes include every file that appears as a source or target in note_links,
 * plus a total link count (in + out) and last-modified timestamp from
 * workspace_files (NULL for unresolved phantom targets).
 *
 * Edges are the raw note_links rows.
 */
export async function getNoteGraph(userId: string): Promise<NoteGraph> {
  try {
    // Fetch all edges for this user
    const edgeResult = await pool.query<{
      source_file: string;
      target_file: string;
      link_text: string;
    }>(
      `SELECT source_file, target_file, link_text
       FROM note_links
       WHERE user_id = $1
       ORDER BY source_file, target_file`,
      [userId]
    );

    const edges: NoteGraphEdge[] = edgeResult.rows.map((row) => ({
      source: row.source_file,
      target: row.target_file,
      linkText: row.link_text,
    }));

    // Collect all unique filenames referenced in edges
    const filenameSet = new Set<string>();
    for (const edge of edges) {
      filenameSet.add(edge.source);
      filenameSet.add(edge.target);
    }

    if (filenameSet.size === 0) {
      return { nodes: [], edges: [] };
    }

    // Count out-links per source and in-links per target
    const linkCountMap = new Map<string, number>();
    for (const edge of edges) {
      linkCountMap.set(edge.source, (linkCountMap.get(edge.source) ?? 0) + 1);
      linkCountMap.set(edge.target, (linkCountMap.get(edge.target) ?? 0) + 1);
    }

    // Fetch metadata for files that exist in workspace_files
    const filenameArray = Array.from(filenameSet);
    const metaResult = await pool.query<{
      filename: string;
      updated_at: Date;
    }>(
      `SELECT filename, updated_at
       FROM workspace_files
       WHERE user_id = $1 AND filename = ANY($2)`,
      [userId, filenameArray]
    );

    const metaMap = new Map<string, Date>();
    for (const row of metaResult.rows) {
      metaMap.set(row.filename, row.updated_at);
    }

    // Build node list
    const nodes: NoteGraphNode[] = filenameArray.map((filename) => {
      // Derive a human-readable title from the filename:
      // strip leading path segments and extension, replace hyphens/underscores with spaces
      const basename = filename.split('/').pop() ?? filename;
      const title = basename
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]/g, ' ');

      const lastModifiedDate = metaMap.get(filename);
      const lastModified = lastModifiedDate
        ? lastModifiedDate.toISOString()
        : new Date(0).toISOString();

      return {
        filename,
        title,
        linkCount: linkCountMap.get(filename) ?? 0,
        lastModified,
      };
    });

    return { nodes, edges };
  } catch (err) {
    logger.error('getNoteGraph failed', { userId, error: (err as Error).message });
    return { nodes: [], edges: [] };
  }
}

// ---------------------------------------------------------------------------
// Default export (convenience object)
// ---------------------------------------------------------------------------

const noteLinkService = {
  parseWikilinks,
  resolveLink,
  updateFileLinks,
  getBacklinks,
  getForwardLinks,
  searchFilenames,
  getNoteGraph,
};

export default noteLinkService;
