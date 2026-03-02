import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as workspace from './workspace.service.js';

// ---- Types ----------------------------------------------------------------

export interface DailyNoteResult {
  filename: string;
  content: string;
  isNew: boolean;
}

export interface DailyNoteSummary {
  filename: string;
  date: string;
  size: number;
}

export interface TemplateSummary {
  filename: string;
  name: string;
}

export interface TemplateResult {
  filename: string;
  content: string;
}

// ---- Helpers --------------------------------------------------------------

/**
 * Format a Date as YYYY-MM-DD (local time).
 */
function formatDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a Date as a long human-readable string (e.g. "March 2, 2026").
 */
function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a Date as HH:MM (24h, local time).
 */
function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

/**
 * Parse a YYYY-MM-DD string and return a local Date at midnight.
 * Falls back to today if the string is missing or malformed.
 */
function parseDateString(dateStr?: string): Date {
  if (dateStr) {
    const parsed = new Date(`${dateStr}T00:00:00`);
    if (!isNaN(parsed.getTime())) return parsed;
    logger.warn('daily-notes: invalid date string, falling back to today', { dateStr });
  }
  return new Date();
}

/**
 * Build the default template content for a daily note.
 */
function buildDailyTemplate(d: Date): string {
  return `# ${formatDateLong(d)}

## Summary


## Notes


`;
}

// ---- Exported functions ---------------------------------------------------

/**
 * Get or create a daily note for the given user and optional date (YYYY-MM-DD).
 * If no date is provided, today's date is used.
 * The file is stored at daily/YYYY-MM-DD.md in the user's workspace.
 */
export async function getOrCreateDailyNote(
  userId: string,
  date?: string
): Promise<DailyNoteResult> {
  const d = parseDateString(date);
  const isoDate = formatDateIso(d);
  const filename = `daily/${isoDate}.md`;

  try {
    const exists = await workspace.fileExists(userId, filename);

    if (exists) {
      const content = await workspace.readFile(userId, filename);
      return { filename, content, isNew: false };
    }

    // Create the note from the default template
    const content = buildDailyTemplate(d);
    await workspace.writeFile(userId, filename, content);
    logger.info('daily-notes: created daily note', { userId, filename });
    return { filename, content, isNew: true };
  } catch (error) {
    logger.error('daily-notes: failed to get or create daily note', {
      error: (error as Error).message,
      userId,
      filename,
    });
    throw error;
  }
}

/**
 * List daily notes for a user, sorted newest first.
 * Queries workspace_files for files matching the daily/%.md pattern.
 */
export async function getDailyNotes(
  userId: string,
  limit = 30
): Promise<DailyNoteSummary[]> {
  try {
    const result = await pool.query(
      `SELECT filename, file_size
       FROM workspace_files
       WHERE user_id = $1
         AND filename LIKE 'daily/%.md'
       ORDER BY filename DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => {
      const filename = row.filename as string;
      // Extract the date portion: daily/YYYY-MM-DD.md -> YYYY-MM-DD
      const date = filename.replace(/^daily\//, '').replace(/\.md$/, '');
      return {
        filename,
        date,
        size: Number(row.file_size) || 0,
      };
    });
  } catch (error) {
    logger.error('daily-notes: failed to list daily notes', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * List template files available to a user.
 * Returns files under the templates/ directory from workspace_files.
 * The display name strips the "templates/" prefix and ".md" extension.
 */
export async function getTemplates(userId: string): Promise<TemplateSummary[]> {
  try {
    const result = await pool.query(
      `SELECT filename
       FROM workspace_files
       WHERE user_id = $1
         AND filename LIKE 'templates/%.md'
       ORDER BY filename ASC`,
      [userId]
    );

    return result.rows.map((row: Record<string, unknown>) => {
      const filename = row.filename as string;
      // Display name: strip directory prefix and extension
      const name = filename.replace(/^templates\//, '').replace(/\.md$/, '');
      return { filename, name };
    });
  } catch (error) {
    logger.error('daily-notes: failed to list templates', {
      error: (error as Error).message,
      userId,
    });
    return [];
  }
}

/**
 * Create a new file from a template, substituting supported variables.
 *
 * Supported variables:
 *   {{date}}      - today's date as YYYY-MM-DD
 *   {{time}}      - current time as HH:MM (24h)
 *   {{user_name}} - placeholder display name ("User")
 */
export async function createFromTemplate(
  userId: string,
  templateFilename: string,
  targetFilename: string
): Promise<TemplateResult> {
  try {
    // Read the template content
    const raw = await workspace.readFile(userId, templateFilename);

    // Substitute variables
    const now = new Date();
    const processed = raw
      .replace(/\{\{date\}\}/g, formatDateIso(now))
      .replace(/\{\{time\}\}/g, formatTime(now))
      .replace(/\{\{user_name\}\}/g, 'User');

    // Write to the target path
    await workspace.writeFile(userId, targetFilename, processed);
    logger.info('daily-notes: created file from template', {
      userId,
      templateFilename,
      targetFilename,
    });

    return { filename: targetFilename, content: processed };
  } catch (error) {
    logger.error('daily-notes: failed to create from template', {
      error: (error as Error).message,
      userId,
      templateFilename,
      targetFilename,
    });
    throw error;
  }
}

// ---- Default export -------------------------------------------------------

export default {
  getOrCreateDailyNote,
  getDailyNotes,
  getTemplates,
  createFromTemplate,
};
