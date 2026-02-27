import { promises as fs } from 'fs';
import path from 'path';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

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

const KEYS = ['D minor', 'A minor', 'C major', 'G major', 'E minor', 'F major'];

const AMBIENT_PROMPT =
  '[Intro]\n[Atmospheric Pad]\n[Main Motif]\n[Soft Texture]\n[Light Harmonic Variation]\n[Return to Main Motif]\n[Outro]\n[Fade Out]';

const QWEN_PROMPT =
  'Output ONLY valid JSON with exactly these two fields: {"title": "<3-5 word ambient title>", "texture_tags": "<3-4 sonic descriptors>"}. Title: calm, poetic, atmospheric (e.g. "Still Rain Kyoto", "Faded Polaroid Glow", "Midnight Moss Garden"). Tags: specific acoustic textures e.g. "soft felt piano, tape hiss, vinyl crackle". Output JSON only, no explanation.';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Global Suno Submission Queue
// Only one Suno submission at a time across all pipelines
// Prevents Playwright browser crashes from concurrent requests
// ============================================================

interface QueueItem {
  gen: SunoGeneration;
  userId: string;
  styleOverride?: string;
  lyrics?: string;
  title?: string;
  resolve: () => void;
}

const sunoQueue: QueueItem[] = [];
let sunoQueueProcessing = false;

async function processSunoQueue(): Promise<void> {
  if (sunoQueueProcessing) return;
  sunoQueueProcessing = true;

  try {
    while (sunoQueue.length > 0) {
      const item = sunoQueue.shift()!;
      try {
        await processGeneration(item.gen, item.userId, item.styleOverride, item.lyrics, item.title);
      } catch (err) {
        logger.error('Suno queue processGeneration failed', { genId: item.gen.id, error: (err as Error).message });
      }
      item.resolve();

      // Wait 5s between submissions (submission-only, no polling)
      if (sunoQueue.length > 0) {
        await delay(5_000);
      }
    }
  } finally {
    sunoQueueProcessing = false;
  }
}

/**
 * Enqueue a generation into the global Suno submission queue.
 * Returns a promise that resolves when this specific generation completes.
 */
function enqueueGeneration(
  gen: SunoGeneration,
  userId: string,
  styleOverride?: string,
  lyrics?: string,
  title?: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    sunoQueue.push({ gen, userId, styleOverride, lyrics, title, resolve });
    logger.info('Suno generation enqueued', { genId: gen.id, queueLength: sunoQueue.length });
    // Kick off processing if not already running
    processSunoQueue().catch(err => {
      logger.error('Suno queue processor failed', { error: (err as Error).message });
    });
  });
}

/**
 * Get the current queue length (for monitoring/logging).
 */
export function getSunoQueueLength(): number {
  return sunoQueue.length;
}

/**
 * Generate a title and texture tags via Ollama (Qwen).
 */
async function generateTitleFromOllama(): Promise<{ title: string; textureTags: string }> {
  const ollamaUrl = config.suno.ollamaUrl;
  const model = config.suno.ollamaModel;

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      prompt: QWEN_PROMPT,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const raw = await response.json() as { response?: string };
  const parsed = JSON.parse(raw.response || '{}');
  return {
    title: parsed.title || 'Ambient Drift',
    textureTags: parsed.texture_tags || 'soft pad, gentle pulse',
  };
}

/**
 * Submit a generation to the Suno API.
 */
async function submitToSuno(payload: Record<string, unknown>): Promise<string> {
  const sunoUrl = config.suno.apiUrl;

  const response = await fetch(`${sunoUrl}/api/custom_generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Suno API returned HTTP ${response.status}: ${text}`);
  }

  const data = await response.json() as Array<{ id?: string }> | { id?: string };
  const items = Array.isArray(data) ? data : [data];
  const sunoId = items[0]?.id;
  if (!sunoId) {
    throw new Error('Suno API response missing track ID');
  }
  return sunoId;
}

interface PollResult {
  status: string;
  audioUrl: string;
  duration: number;
}

/**
 * Poll Suno API for track completion.
 */
async function pollSuno(sunoId: string): Promise<PollResult> {
  const sunoUrl = config.suno.apiUrl;

  const response = await fetch(`${sunoUrl}/api/get?ids=${sunoId}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return { status: 'unknown', audioUrl: '', duration: 0 };
  }

  const data = await response.json() as Array<{ status?: string; audio_url?: string; duration?: number }> | { status?: string; audio_url?: string; duration?: number };
  const items = Array.isArray(data) ? data : [data];
  const track = items[0] || {};
  return {
    status: track.status || 'unknown',
    audioUrl: track.audio_url || '',
    duration: Math.round(track.duration || 0),
  };
}

/**
 * Submit a single track to Suno. Does NOT poll -- polling is handled
 * separately by pollProcessingGenerations() on a 60s job timer.
 * This keeps the queue fast (~5s per item instead of ~10min).
 */
async function processGeneration(
  gen: SunoGeneration,
  userId: string,
  styleOverride?: string,
  lyrics?: string,
  title?: string,
): Promise<void> {
  const taskId = gen.id;

  try {
    // Mark as processing
    await pool.query(`UPDATE suno_generations SET status = 'processing' WHERE id = $1`, [taskId]);
    logger.info('Suno generation started', { taskId, userId });

    let finalTitle: string;
    let finalStyle: string;
    let bpm: number | null = null;
    let key: string | null = null;
    let sunoPayload: Record<string, unknown>;

    if (lyrics) {
      // Song mode: use provided lyrics and title
      finalTitle = title || 'Untitled';
      finalStyle = styleOverride || 'pop, 120bpm, female vocal';
      sunoPayload = {
        prompt: lyrics,
        tags: finalStyle,
        title: finalTitle,
        make_instrumental: false,
      };
    } else {
      // Ambient mode: generate title via Ollama
      let textureTags = 'soft pad, gentle pulse';
      finalTitle = 'Ambient Drift';
      try {
        const ollamaResult = await generateTitleFromOllama();
        finalTitle = ollamaResult.title;
        textureTags = ollamaResult.textureTags;
      } catch (err) {
        logger.warn('Ollama title generation failed, using defaults', { taskId, error: (err as Error).message });
      }

      bpm = Math.floor(Math.random() * 21) + 60;
      key = KEYS[Math.floor(Math.random() * KEYS.length)];
      finalStyle = styleOverride || `${textureTags}, ${bpm}bpm, ${key}, instrumental, ambient`;

      sunoPayload = {
        prompt: AMBIENT_PROMPT,
        tags: finalStyle,
        title: finalTitle,
        make_instrumental: true,
        negative_tags: 'vocals, speech, lyrics, singing',
      };
    }

    // Submit to Suno and store sunoId - no polling
    const sunoId = await submitToSuno(sunoPayload);
    await pool.query(
      `UPDATE suno_generations SET suno_id = $1, title = $2, style = $3, bpm = $4, key = $5 WHERE id = $6`,
      [sunoId, finalTitle, finalStyle, bpm, key, taskId],
    );
    logger.info('Suno track submitted', { taskId, sunoId });
  } catch (err) {
    logger.error('Suno processGeneration failed', { taskId, error: (err as Error).message });
    await handleCallback({
      taskId,
      status: 'failed',
      error: (err as Error).message,
    }).catch((cbErr) => {
      logger.error('Failed to record generation failure', { taskId, error: (cbErr as Error).message });
    });
  }
}

/**
 * Poll all in-flight Suno generations and handle completed/failed ones.
 * Called by the job runner every 60 seconds.
 */
export async function pollProcessingGenerations(): Promise<void> {
  const processing = await pool.query<GenerationRow>(
    `SELECT * FROM suno_generations
     WHERE status = 'processing' AND suno_id IS NOT NULL
       AND created_at > NOW() - INTERVAL '30 minutes'`,
  );

  if (processing.rows.length === 0) return;

  logger.info('Polling processing Suno generations', { count: processing.rows.length });

  for (const row of processing.rows) {
    const gen = rowToGeneration(row);
    if (!gen.sunoId) continue;
    try {
      const result = await pollSuno(gen.sunoId);
      logger.info('Suno poll result', { genId: gen.id, sunoId: gen.sunoId, status: result.status });

      if (result.status === 'complete') {
        await handleCallback({
          taskId: gen.id,
          userId: gen.userId ?? undefined,
          title: gen.title,
          style: gen.style,
          audioUrl: result.audioUrl,
          duration: result.duration,
          sunoId: gen.sunoId,
        });
      }
      // If still processing, leave it - next poll cycle or failStaleGenerations handles timeout
    } catch (err) {
      logger.warn('Poll failed for generation', { genId: gen.id, error: (err as Error).message });
    }
  }
}

/**
 * Trigger a batch of track generations.
 * Creates pending DB rows and fires processGeneration() per track with 15s stagger.
 * Returns immediately (same contract as before).
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

  // Enqueue all generations into the global queue.
  // The queue processes one at a time with 30s stagger to avoid Playwright crashes.
  for (const gen of generations) {
    enqueueGeneration(gen, userId, styleOverride, lyrics, title).catch((err) =>
      logger.error('Suno enqueue failed', { genId: gen.id, error: (err as Error).message }),
    );
  }

  return generations;
}

export interface CallbackPayload {
  taskId: string;
  userId?: string;
  title?: string;
  style?: string;
  bpm?: number | null;
  key?: string | null;
  audioUrl?: string;
  duration?: number;
  sunoId?: string;
  status?: string;
  error?: string;
}

/**
 * Handle the completion of a generation. Updates the DB row.
 * Downloads the audio file to disk if audioUrl is provided.
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

    // Notify album pipeline of failure
    try {
      const { handleSunoComplete } = await import('../ceo/album-pipeline.service.js');
      await handleSunoComplete(taskId);
    } catch (err) {
      logger.warn('Album pipeline failure callback check failed (non-fatal)', { taskId, error: (err as Error).message });
    }
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

  // Notify album pipeline for each failed generation so linked album_songs
  // transition out of suno_pending
  if ((result.rowCount ?? 0) > 0) {
    try {
      const { handleSunoComplete } = await import('../ceo/album-pipeline.service.js');
      for (const row of result.rows) {
        try {
          await handleSunoComplete(row.id);
        } catch (err) {
          logger.warn('Failed to notify album pipeline of stale generation', { genId: row.id, error: (err as Error).message });
        }
      }
    } catch {
      // album-pipeline import failed - non-fatal
    }
  }

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
