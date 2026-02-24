import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

// Configuration for local media
const MEDIA_ROOT = '/mnt/data/media';
// Use relative path - frontend will prepend the correct API base URL
const API_BASE = '';

export interface LocalMediaItem {
  id: string;
  name: string;
  path: string;
  type: 'video' | 'audio';
  streamUrl?: string;
}

/**
 * Normalize query for better matching (e.g. "episode one" -> "E01")
 */
function normalizeQuery(query: string): string {
  return query.toLowerCase()
    .replace(/episode\s+one\b/g, 'e01')
    .replace(/episode\s+two\b/g, 'e02')
    .replace(/episode\s+three\b/g, 'e03')
    .replace(/episode\s+four\b/g, 'e04')
    .replace(/episode\s+five\b/g, 'e05')
    .replace(/episode\s+(\d+)\b/g, 'e$1')
    .replace(/season\s+(\d+)\b/g, 's$1');
}

/**
 * Recursively find media files in a directory.
 * Matches query words against both filename AND parent directory names,
 * so searching "Shantaram" finds files inside a "Shantaram" folder.
 */
async function findFiles(dir: string, query: string = ''): Promise<string[]> {
  let results: string[] = [];
  let list: string[] = [];

  try {
    list = await fs.readdir(dir);
  } catch (err) {
    logger.error('Failed to read directory', { dir, error: (err as Error).message });
    return [];
  }

  const normalizedQuery = normalizeQuery(query);
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

  for (const file of list) {
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (_err) {
      continue;
    }

    if (stat && stat.isDirectory()) {
      results = results.concat(await findFiles(filePath, query));
    } else {
      const ext = path.extname(file).toLowerCase();
      const isMedia = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac', '.wav', '.m4a'].includes(ext);

      if (isMedia) {
        if (!query) {
          results.push(filePath);
        } else {
          // Match against full path (includes parent dirs like "Shantaram/Season 01/...")
          const lowerPath = filePath.toLowerCase();
          const matches = queryWords.every(word => lowerPath.includes(word));
          if (matches) {
            results.push(filePath);
          }
        }
      }
    }
  }

  return results;
}

/**
 * Search local media library
 */
export async function searchLocalMedia(query: string, limit: number = 10): Promise<LocalMediaItem[]> {
  try {
    const files = await findFiles(MEDIA_ROOT, query);
    return files.slice(0, limit).map(filePath => {
      const ext = path.extname(filePath).toLowerCase();
      const type = ['.mp3', '.flac', '.wav', '.m4a'].includes(ext) ? 'audio' : 'video';
      const fileId = Buffer.from(filePath).toString('base64url');
      return {
        id: fileId,
        name: path.basename(filePath),
        path: filePath,
        type: type as 'video' | 'audio',
        streamUrl: `${API_BASE}/api/media/stream/${fileId}`,
      };
    });
  } catch (error) {
    logger.error('Local media search failed', { query, error: (error as Error).message });
    return [];
  }
}

/**
 * Get the stream URL for a file by its base64url-encoded ID
 */
export function getStreamUrl(fileId: string): string {
  return `${API_BASE}/api/media/stream/${fileId}`;
}

export function formatForPrompt(items: LocalMediaItem[], query: string): string {
  if (items.length === 0) {
    return `No local files found for "${query}".`;
  }

  const lines = [`Found ${items.length} file(s) in /mnt/data/media for "${query}":\n`];

  items.forEach((item, index) => {
    lines.push(`${index + 1}. **${item.name}** (ID: ${item.id})`);
    lines.push(`   Type: ${item.type} | Path: ${item.path}`);
    lines.push('');
  });

  lines.push('\nUse local_media_play with the ID to start streaming.');

  return lines.join('\n');
}
