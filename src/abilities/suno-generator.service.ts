import { promises as fs } from 'fs';
import path from 'path';
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as n8nService from './n8n.service.js';

const MUSIC_DIR = '/mnt/data/media/Music';

export interface SunoGeneration {
  id: string;
  userId: string | null;
  title: string;
  style: string;
  bpm: number | null;
  key: string | null;
  n8nTaskId: string | null;
  sunoId: string | null;
  audioUrl: string | null;
  filePath: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage: string | null;
  durationSeconds: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

interface GenerationRow {
  id: string;
  user_id: string | null;
  title: string;
  style: string;
  bpm: number | null;
  key: string | null;
  n8n_task_id: string | null;
  suno_id: string | null;
  audio_url: string | null;
  file_path: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  duration_seconds: number | null;
  created_at: string;
  completed_at: string | null;
}

function rowToGeneration(row: GenerationRow): SunoGeneration {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    style: row.style,
    bpm: row.bpm,
    key: row.key,
    n8nTaskId: row.n8n_task_id,
    sunoId: row.suno_id,
    audioUrl: row.audio_url,
    filePath: row.file_path,
    status: row.status,
    errorMessage: row.error_message,
    durationSeconds: row.duration_seconds,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

/**
 * Sanitize a filename to prevent path traversal and invalid characters.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\.\./g, '-')
    .replace(/^\./g, '-')
    .trim()
    .substring(0, 150);
}

/**
 * Trigger a batch of ambient track generations.
 * Creates pending DB rows and fires one n8n webhook per track.
 */
export async function triggerBatch(
  userId: string,
  count: number,
  styleOverride?: string,
  lyrics?: string,
  title?: string,
): Promise<SunoGeneration[]> {
  const safeCount = Math.max(1, Math.min(10, Math.floor(count)));
  const generations: SunoGeneration[] = [];

  // Insert all DB rows immediately so we can return right away
  for (let i = 0; i < safeCount; i++) {
    const result = await pool.query<GenerationRow>(
      `INSERT INTO suno_generations (user_id, style, title)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, styleOverride || '', title || ''],
    );
    generations.push(rowToGeneration(result.rows[0]));
  }

  // Fire webhooks in background with 15s stagger between each.
  // Suno-api uses Playwright internally and cannot handle concurrent browser ops.
  const fireWebhooks = async () => {
    for (let i = 0; i < generations.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
      const gen = generations[i];
      const webhookResult = await n8nService.executeWebhook(
        'suno-generate',
        { taskId: gen.id, userId, count: 1, style_override: styleOverride || null, lyrics: lyrics || null, title: title || null },
        { userId },
      );
      if (!webhookResult.success) {
        await pool.query(
          `UPDATE suno_generations SET status = 'failed', error_message = $1 WHERE id = $2`,
          [webhookResult.error || 'Webhook trigger failed', gen.id],
        );
        logger.warn('Suno webhook failed', { genId: gen.id, error: webhookResult.error });
      } else {
        await pool.query(
          `UPDATE suno_generations SET status = 'processing' WHERE id = $1`,
          [gen.id],
        );
        logger.info('Suno generation triggered', { genId: gen.id, userId });
      }
    }
  };

  // Don't await - fire and forget so the HTTP response returns immediately
  fireWebhooks().catch((err) =>
    logger.error('Suno batch webhook loop failed', { error: (err as Error).message }),
  );

  return generations;
}

export interface CallbackPayload {
  taskId: string;
  userId?: string;
  title?: string;
  style?: string;
  bpm?: number;
  key?: string;
  audioUrl?: string;
  duration?: number;
  sunoId?: string;
  status?: string;
  error?: string;
}

/**
 * Handle the completion callback from n8n. Updates the DB row.
 * Downloads the audio file to disk if audioUrl is provided.
 * This function is called from the webhook route handler in the background.
 */
export async function handleCallback(payload: CallbackPayload): Promise<void> {
  const { taskId } = payload;

  // Verify the row exists
  const check = await pool.query<{ id: string }>(
    `SELECT id FROM suno_generations WHERE id = $1`,
    [taskId],
  );
  if (check.rows.length === 0) {
    logger.warn('Suno callback for unknown taskId', { taskId });
    return;
  }

  // Handle failure signal
  if (payload.status === 'failed' || payload.error) {
    await pool.query(
      `UPDATE suno_generations
       SET status = 'failed', error_message = $1, completed_at = NOW()
       WHERE id = $2`,
      [payload.error || 'Generation failed', taskId],
    );
    logger.info('Suno generation failed', { taskId, error: payload.error });
    return;
  }

  // Success path - download audio if URL provided
  let filePath: string | null = null;
  if (payload.audioUrl) {
    try {
      filePath = await downloadAndSave(payload.audioUrl, payload.title || 'ambient-track');
    } catch (err) {
      logger.error('Failed to download suno audio', { taskId, error: (err as Error).message });
      // Don't fail the whole record - still mark completed, just no local file
    }
  }

  await pool.query(
    `UPDATE suno_generations
     SET title = COALESCE($1, title),
         style = COALESCE($2, style),
         bpm = COALESCE($3, bpm),
         key = COALESCE($4, key),
         suno_id = $5,
         audio_url = $6,
         file_path = $7,
         duration_seconds = $8,
         status = 'completed',
         completed_at = NOW()
     WHERE id = $9`,
    [
      payload.title || null,
      payload.style || null,
      payload.bpm || null,
      payload.key || null,
      payload.sunoId || null,
      payload.audioUrl || null,
      filePath,
      payload.duration || null,
      taskId,
    ],
  );

  logger.info('Suno generation completed', { taskId, filePath, title: payload.title });

  // Check if this generation is linked to an album song
  try {
    const { handleSunoComplete } = await import('../ceo/album-pipeline.service.js');
    await handleSunoComplete(taskId);
  } catch (err) {
    logger.warn('Album pipeline callback check failed (non-fatal)', { taskId, error: (err as Error).message });
  }
}

/**
 * Download audio from Suno CDN. Tries WAV first, falls back to MP3.
 * Saves to /mnt/data/media/Music/ and returns the absolute file path.
 */
export async function downloadAndSave(audioUrl: string, title: string): Promise<string> {
  await fs.mkdir(MUSIC_DIR, { recursive: true });

  const safeTitle = sanitizeFilename(title);
  const ts = Date.now();

  // Try WAV first (same CDN path, .wav extension)
  const wavUrl = audioUrl.replace(/\.mp3$/, '.wav');
  let useWav = false;
  if (wavUrl !== audioUrl) {
    const check = await fetch(wavUrl, { method: 'HEAD' });
    useWav = check.ok;
  }

  const finalUrl = useWav ? wavUrl : audioUrl;
  const ext = useWav ? 'wav' : 'mp3';
  const destPath = path.join(MUSIC_DIR, `${safeTitle}-${ts}.${ext}`);

  const response = await fetch(finalUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));

  logger.info('Suno audio saved', { destPath, format: ext, bytes: arrayBuffer.byteLength });
  return destPath;
}

/**
 * Auto-fail processing rows older than 30 minutes with no callback.
 * Called by the job runner every 15 minutes.
 */
export async function failStaleGenerations(): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `UPDATE suno_generations
     SET status = 'failed',
         error_message = 'No callback received within 30 minutes',
         completed_at = NOW()
     WHERE status IN ('pending', 'processing')
       AND created_at < NOW() - INTERVAL '30 minutes'
     RETURNING id`,
  );
  return result.rowCount ?? 0;
}

/**
 * List recent generations for a user.
 */
export async function listGenerations(
  userId: string,
  limit = 50,
): Promise<SunoGeneration[]> {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const result = await pool.query<GenerationRow>(
    `SELECT * FROM suno_generations
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit],
  );
  return result.rows.map(rowToGeneration);
}
