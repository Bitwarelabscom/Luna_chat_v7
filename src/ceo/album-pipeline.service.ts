import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import { CEO_LUNA_MODE_PROMPT } from '../persona/luna.persona.js';
import * as workspaceService from '../abilities/workspace.service.js';
import * as sunoService from '../abilities/suno-generator.service.js';
import { analyzeLyrics } from '../abilities/lyric-checker.service.js';
import { getPresetById as getBuiltinPresetById, getDefaultSongCount, GENRE_PRESETS } from '../abilities/genre-presets.js';
import * as genreRegistry from '../abilities/genre-registry.service.js';
import type { ProviderId, ChatMessage } from '../llm/types.js';
import logger from '../utils/logger.js';

const OLLAMA_PROVIDERS = new Set<string>(['ollama', 'ollama_secondary', 'ollama_tertiary']);
const SUNO_STAGGER_MS = 30_000; // 30s between Suno submissions

// Prevent concurrent pipeline runs per production
const activePipelines = new Set<string>();

// Lightweight system prompt for pipeline lyric generation/revision.
// Replaces the full DJ Luna persona (~2000 tokens) with only lyric-relevant guidance (~200 tokens).
const LYRIC_PIPELINE_PROMPT = `You are an expert lyric writer for an autonomous music production pipeline.

Rhyme scheme definitions (referenced by name in the song prompt):
- ABAB: Alternating rhyme — lines 1 & 3 rhyme, lines 2 & 4 rhyme.
- AABB: Couplet rhyme — consecutive lines rhyme in pairs.
- ABCB: Ballad rhyme — only lines 2 & 4 rhyme.
- loose: Approximate or slant rhymes; no strict pattern required.
- none: No rhyming constraint; focus on rhythm and meaning.

Rules:
- Section tags inside [] (e.g. [Verse 1], [Chorus], [Bridge]) must ALWAYS be in English, even if the lyric text is in another language.
- Output ONLY the lyrics with section tags. No commentary, explanations, or markdown.
- Start with the first section tag immediately.`;

// ============================================================
// Types
// ============================================================

interface ProductionRow {
  id: string;
  user_id: string;
  artist_name: string;
  genre: string;
  production_notes: string | null;
  album_count: number;
  planning_model: string | null;
  lyrics_model: string | null;
  forbidden_words: string | null;
  songs_per_album: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface AlbumItemRow {
  id: string;
  production_id: string;
  user_id: string;
  album_number: number;
  album_title: string | null;
  album_theme: string | null;
  cover_art_path: string | null;
  song_count: number;
  status: string;
  created_at: string;
}

interface AlbumSongRow {
  id: string;
  album_id: string;
  production_id: string;
  user_id: string;
  track_number: number;
  title: string;
  direction: string | null;
  style: string | null;
  genre_preset: string | null;
  workspace_path: string | null;
  lyrics_text: string | null;
  revision_count: number;
  retry_count: number;
  analysis_issues: string | null;
  suno_generation_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CreateProductionParams {
  artistName: string;
  genre: string;
  productionNotes?: string;
  albumCount?: number;
  planningModel?: string;
  lyricsModel?: string;
  forbiddenWords?: string;
  songsPerAlbum?: number;
}

export interface ProductionSummary {
  id: string;
  artistName: string;
  genre: string;
  albumCount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  totalSongs: number;
  completedSongs: number;
  failedSongs: number;
}

export interface ProductionDetail extends ProductionSummary {
  productionNotes: string | null;
  planningModel: string | null;
  lyricsModel: string | null;
  forbiddenWords: string | null;
  songsPerAlbum: number | null;
  albums: AlbumDetail[];
}

export interface AlbumDetail {
  id: string;
  albumNumber: number;
  albumTitle: string | null;
  albumTheme: string | null;
  coverArtPath: string | null;
  songCount: number;
  status: string;
  songs: SongDetail[];
}

export interface SongDetail {
  id: string;
  trackNumber: number;
  title: string;
  direction: string | null;
  style: string | null;
  genrePreset: string | null;
  workspacePath: string | null;
  status: string;
  revisionCount: number;
  analysisIssues: string[] | null;
  errorMessage: string | null;
  completedAt: string | null;
}

// ============================================================
// Production CRUD
// ============================================================

export async function createProduction(userId: string, params: CreateProductionParams): Promise<string> {
  const albumCount = Math.max(1, Math.min(10, params.albumCount ?? 1));
  const songsPerAlbum = params.songsPerAlbum ? Math.max(1, Math.min(20, params.songsPerAlbum)) : null;

  const result = await pool.query<{ id: string }>(
    `INSERT INTO album_productions (user_id, artist_name, genre, production_notes, album_count, planning_model, lyrics_model, forbidden_words, songs_per_album)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, params.artistName, params.genre, params.productionNotes || null, albumCount, params.planningModel || null, params.lyricsModel || null, params.forbiddenWords || null, songsPerAlbum],
  );

  return result.rows[0].id;
}

export async function listProductions(userId: string): Promise<ProductionSummary[]> {
  const result = await pool.query<ProductionRow & { total_songs: string; completed_songs: string; failed_songs: string }>(
    `SELECT p.*,
       COUNT(s.id) AS total_songs,
       COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed_songs,
       COUNT(s.id) FILTER (WHERE s.status = 'failed') AS failed_songs
     FROM album_productions p
     LEFT JOIN album_songs s ON s.production_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [userId],
  );

  return result.rows.map(r => ({
    id: r.id,
    artistName: r.artist_name,
    genre: r.genre,
    albumCount: r.album_count,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    errorMessage: r.error_message,
    totalSongs: parseInt(r.total_songs, 10),
    completedSongs: parseInt(r.completed_songs, 10),
    failedSongs: parseInt(r.failed_songs, 10),
  }));
}

export async function getProductionDetail(userId: string, productionId: string): Promise<ProductionDetail | null> {
  // Run all three queries in parallel since they are independent
  const [prodResult, albumsResult, songsResult] = await Promise.all([
    pool.query<ProductionRow>(
      `SELECT * FROM album_productions WHERE id = $1 AND user_id = $2`,
      [productionId, userId],
    ),
    pool.query<AlbumItemRow>(
      `SELECT * FROM album_items WHERE production_id = $1 ORDER BY album_number`,
      [productionId],
    ),
    pool.query<AlbumSongRow>(
      `SELECT * FROM album_songs WHERE production_id = $1 ORDER BY track_number`,
      [productionId],
    ),
  ]);

  if (prodResult.rows.length === 0) return null;
  const prod = prodResult.rows[0];

  const songsByAlbum = new Map<string, SongDetail[]>();
  for (const s of songsResult.rows) {
    const albumSongs = songsByAlbum.get(s.album_id) ?? [];
    albumSongs.push({
      id: s.id,
      trackNumber: s.track_number,
      title: s.title,
      direction: s.direction,
      style: s.style,
      genrePreset: s.genre_preset,
      workspacePath: s.workspace_path,
      status: s.status,
      revisionCount: s.revision_count,
      analysisIssues: s.analysis_issues ? JSON.parse(s.analysis_issues) : null,
      errorMessage: s.error_message,
      completedAt: s.completed_at,
    });
    songsByAlbum.set(s.album_id, albumSongs);
  }

  const albums: AlbumDetail[] = albumsResult.rows.map(a => ({
    id: a.id,
    albumNumber: a.album_number,
    albumTitle: a.album_title,
    albumTheme: a.album_theme,
    coverArtPath: a.cover_art_path,
    songCount: a.song_count,
    status: a.status,
    songs: songsByAlbum.get(a.id) ?? [],
  }));

  const totalSongs = songsResult.rows.length;
  const completedSongs = songsResult.rows.filter(s => s.status === 'completed').length;
  const failedSongs = songsResult.rows.filter(s => s.status === 'failed').length;

  return {
    id: prod.id,
    artistName: prod.artist_name,
    genre: prod.genre,
    albumCount: prod.album_count,
    status: prod.status,
    createdAt: prod.created_at,
    completedAt: prod.completed_at,
    errorMessage: prod.error_message,
    productionNotes: prod.production_notes,
    planningModel: prod.planning_model,
    lyricsModel: prod.lyrics_model,
    forbiddenWords: prod.forbidden_words,
    songsPerAlbum: prod.songs_per_album,
    totalSongs: totalSongs,
    completedSongs,
    failedSongs,
    albums,
  };
}

export async function getProductionProgress(userId: string, productionId: string): Promise<Record<string, number> | null> {
  const check = await pool.query(`SELECT id FROM album_productions WHERE id = $1 AND user_id = $2`, [productionId, userId]);
  if (check.rows.length === 0) return null;

  const result = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count FROM album_songs WHERE production_id = $1 GROUP BY status`,
    [productionId],
  );

  const counts: Record<string, number> = {};
  for (const r of result.rows) {
    counts[r.status] = parseInt(r.count, 10);
  }
  return counts;
}

// ============================================================
// Forbidden Word Helpers
// ============================================================

function parseForbiddenWords(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
}

function containsForbiddenWords(text: string, forbidden: string[]): string[] {
  if (!forbidden.length) return [];
  const lower = text.toLowerCase();
  return forbidden.filter(w => lower.includes(w));
}

function stripForbiddenWords(text: string, forbidden: string[]): string {
  let result = text;
  for (const word of forbidden) {
    const regex = new RegExp(word, 'gi');
    result = result.replace(regex, '***');
  }
  return result;
}

// ============================================================
// Album Planning (CEO Luna LLM)
// ============================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80)
    .replace(/^-|-$/g, '');
}

async function resolveModel(
  userId: string,
  configuredModel: string | null,
  taskType: string,
): Promise<{ provider: ProviderId; model: string }> {
  if (configuredModel) {
    // configuredModel format: "provider/model" or just "model"
    const parts = configuredModel.split('/');
    if (parts.length === 2) {
      return { provider: parts[0] as ProviderId, model: parts[1] };
    }
    // Fall through to user config
  }
  return getUserModelConfig(userId, taskType);
}

export async function planAlbums(productionId: string): Promise<void> {
  const prodResult = await pool.query<ProductionRow>(
    `SELECT * FROM album_productions WHERE id = $1`,
    [productionId],
  );
  if (prodResult.rows.length === 0) throw new Error('Production not found');
  const prod = prodResult.rows[0];

  const userId = prod.user_id;
  const { provider, model } = await resolveModel(userId, prod.planning_model, 'ceo_luna');

  // Try to read artist context from workspace
  let artistContext = '';
  try {
    const artistSlug = slugify(prod.artist_name);
    artistContext = await workspaceService.readFile(userId, `ceo-luna/artists/${artistSlug}.md`);
  } catch {
    // No artist file - that's fine, use minimal context
    artistContext = `Artist: ${prod.artist_name}\nGenre: ${prod.genre}`;
  }

  // Use genre registry to include user-approved presets
  const genrePreset = await genreRegistry.getPresetById(userId, prod.genre) ?? getBuiltinPresetById(prod.genre) ?? GENRE_PRESETS[0];
  const songCount = prod.songs_per_album ?? genrePreset.defaultSongCount ?? getDefaultSongCount(prod.genre);

  for (let albumNum = 1; albumNum <= prod.album_count; albumNum++) {
    const planPrompt = buildPlanningPrompt(prod, albumNum, artistContext, songCount, genrePreset);

    const messages: ChatMessage[] = [
      { role: 'system', content: CEO_LUNA_MODE_PROMPT + '\n\nYou are planning an album for autonomous music production. Return ONLY valid JSON, no markdown fences.' },
      { role: 'user', content: planPrompt },
    ];

    let planJson: { albumTitle: string; theme: string; songs: Array<{ title: string; direction: string; style: string }> };

    try {
      const result = await createCompletion(provider, model, messages, {
        temperature: 0.8,
        maxTokens: 4000,
        loggingContext: {
          userId,
          source: 'album-pipeline',
          nodeName: 'plan-album',
        },
      });

      // Parse JSON from response - strip markdown fences if present
      const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      planJson = JSON.parse(cleaned);
    } catch (err) {
      logger.error('Failed to plan album', { productionId, albumNum, error: (err as Error).message });
      await pool.query(
        `UPDATE album_productions SET status = 'failed', error_message = $1 WHERE id = $2`,
        [`Planning failed for album #${albumNum}: ${(err as Error).message}`, productionId],
      );
      return;
    }

    // Forbidden word validation on plan output
    const forbidden = parseForbiddenWords(prod.forbidden_words);
    if (forbidden.length > 0) {
      const textsToCheck = [
        planJson.albumTitle,
        ...planJson.songs.map(s => s.title),
        ...planJson.songs.map(s => s.direction),
      ];
      let found = textsToCheck.flatMap(t => containsForbiddenWords(t, forbidden));
      found = [...new Set(found)];

      if (found.length > 0) {
        // Retry up to 2 times with explicit correction
        let retried = false;
        for (let retry = 0; retry < 2 && found.length > 0; retry++) {
          logger.warn('Plan contains forbidden words, retrying', { productionId, albumNum, retry: retry + 1, found });
          const correctionPrompt = `Your previous plan contained these FORBIDDEN words: [${found.join(', ')}].
Rewrite the album plan without using any of these words: [${forbidden.join(', ')}].
Keep the same number of songs and overall concept but replace any titles or directions that use forbidden words.

Return ONLY valid JSON in the same format as before.`;

          try {
            const retryResult = await createCompletion(provider, model, [
              { role: 'system', content: CEO_LUNA_MODE_PROMPT + '\n\nYou are planning an album for autonomous music production. Return ONLY valid JSON, no markdown fences.' },
              { role: 'user', content: planPrompt },
              { role: 'assistant', content: JSON.stringify(planJson) },
              { role: 'user', content: correctionPrompt },
            ], {
              temperature: 0.8,
              maxTokens: 4000,
              loggingContext: { userId, source: 'album-pipeline', nodeName: 'plan-album-retry' },
            });
            const retryCleaned = retryResult.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            planJson = JSON.parse(retryCleaned);
            const retryTexts = [planJson.albumTitle, ...planJson.songs.map(s => s.title), ...planJson.songs.map(s => s.direction)];
            found = [...new Set(retryTexts.flatMap(t => containsForbiddenWords(t, forbidden)))];
            retried = true;
          } catch (retryErr) {
            logger.warn('Forbidden word retry failed', { productionId, albumNum, error: (retryErr as Error).message });
            break;
          }
        }

        // Last resort: strip forbidden words from titles/directions
        if (found.length > 0) {
          logger.warn('Stripping forbidden words as last resort', { productionId, albumNum, found });
          planJson.albumTitle = stripForbiddenWords(planJson.albumTitle, forbidden);
          for (const song of planJson.songs) {
            song.title = stripForbiddenWords(song.title, forbidden);
            song.direction = stripForbiddenWords(song.direction, forbidden);
          }
        } else if (retried) {
          logger.info('Forbidden words resolved after retry', { productionId, albumNum });
        }
      }
    }

    // Insert album item
    const albumSlug = slugify(planJson.albumTitle || `album-${albumNum}`);
    const albumResult = await pool.query<{ id: string }>(
      `INSERT INTO album_items (production_id, user_id, album_number, album_title, album_theme, song_count, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'planned')
       RETURNING id`,
      [productionId, userId, albumNum, planJson.albumTitle, planJson.theme, planJson.songs.length],
    );
    const albumId = albumResult.rows[0].id;

    // Insert songs
    for (let i = 0; i < planJson.songs.length; i++) {
      const song = planJson.songs[i];
      const songSlug = slugify(song.title);
      const wsPath = `dj-luna/${albumSlug}/${songSlug}.md`;

      await pool.query(
        `INSERT INTO album_songs (album_id, production_id, user_id, track_number, title, direction, style, genre_preset, workspace_path, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'planned')`,
        [albumId, productionId, userId, i + 1, song.title, song.direction, song.style, genrePreset.id, wsPath],
      );

      // Write initial workspace file with frontmatter
      const mdContent = `---\ntitle: ${song.title}\nproject: ${planJson.albumTitle}\nstyle: ${song.style}\nstatus: planned\ntrack: ${i + 1}\n---\n\n[Direction]\n${song.direction}\n`;
      try {
        await workspaceService.writeFile(userId, wsPath, mdContent);
      } catch (err) {
        logger.warn('Failed to write workspace file for song', { wsPath, error: (err as Error).message });
      }
    }

    // Update album status
    await pool.query(`UPDATE album_items SET status = 'planned' WHERE id = $1`, [albumId]);

    logger.info('Album planned', { productionId, albumNum, albumTitle: planJson.albumTitle, songs: planJson.songs.length });
  }

  // Mark production as planned
  await pool.query(
    `UPDATE album_productions SET status = 'planned' WHERE id = $1`,
    [productionId],
  );

  logger.info('Production planning complete', { productionId, albums: prod.album_count });
}

function buildPlanningPrompt(
  prod: ProductionRow,
  albumNum: number,
  artistContext: string,
  songCount: number,
  genrePreset?: { styleTags?: string; bpmRange?: { min: number; max: number }; energy?: string },
): string {
  const styleHint = genrePreset?.styleTags
    ? `\nDefault style tags for this genre: ${genrePreset.styleTags}`
    : '';
  const bpmHint = genrePreset?.bpmRange
    ? `\nBPM range: ${genrePreset.bpmRange.min}-${genrePreset.bpmRange.max}`
    : '';
  const energyHint = genrePreset?.energy
    ? `\nEnergy level: ${genrePreset.energy}`
    : '';

  const forbiddenHint = prod.forbidden_words
    ? `\n\nFORBIDDEN WORDS - These words must NOT appear anywhere in album title, song titles, or creative directions: [${prod.forbidden_words}]`
    : '';

  return `Plan album #${albumNum} of ${prod.album_count} for the artist "${prod.artist_name}".

Genre: ${prod.genre}${styleHint}${bpmHint}${energyHint}
${prod.production_notes ? `Production notes: ${prod.production_notes}` : ''}${forbiddenHint}

Artist context:
${artistContext}

Requirements:
- Plan exactly ${songCount} songs for this album
- Each song needs a title, creative direction (2-3 sentences describing mood/theme/story), and Suno style tags
- The album needs a cohesive theme and title
- Style tags should be detailed Suno-compatible strings (e.g. "128 BPM, Deep House, Melodic, Female Vocal")
- Use the genre's default style tags as a base but vary per song for diversity
- Song titles should be creative and fit the genre
- Creative directions should give enough context for a lyrics writer to craft full lyrics

Return JSON in this exact format:
{
  "albumTitle": "Album Title Here",
  "theme": "2-3 sentence album theme description",
  "songs": [
    {
      "title": "Song Title",
      "direction": "Creative direction for this song...",
      "style": "Suno style tags here"
    }
  ]
}`;
}

// ============================================================
// Lyrics Writing (DJ Luna LLM)
// ============================================================

async function writeLyrics(songId: string): Promise<void> {
  const songResult = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs WHERE id = $1`,
    [songId],
  );
  if (songResult.rows.length === 0) throw new Error('Song not found');
  const song = songResult.rows[0];

  // Load context
  const albumResult = await pool.query<AlbumItemRow>(
    `SELECT * FROM album_items WHERE id = $1`,
    [song.album_id],
  );
  const album = albumResult.rows[0];

  const prodResult = await pool.query<ProductionRow>(
    `SELECT * FROM album_productions WHERE id = $1`,
    [song.production_id],
  );
  const prod = prodResult.rows[0];

  // Read artist context
  let artistContext = '';
  try {
    const artistSlug = slugify(prod.artist_name);
    artistContext = await workspaceService.readFile(prod.user_id, `ceo-luna/artists/${artistSlug}.md`);
  } catch {
    artistContext = `Artist: ${prod.artist_name}`;
  }

  const genrePreset = await genreRegistry.getPresetById(prod.user_id, song.genre_preset ?? prod.genre)
    ?? getBuiltinPresetById(song.genre_preset ?? prod.genre);
  const { provider, model } = await resolveModel(prod.user_id, prod.lyrics_model, 'dj_luna');

  // Build the lyrics prompt
  const structureGuide = genrePreset
    ? genrePreset.structure.map(s => `[${s.tag}]${s.required ? ' (required)' : ' (optional)'}`).join(', ')
    : 'Standard verse-chorus structure';

  const prompt = `Write complete lyrics for the following song:

Title: ${song.title}
Album: ${album.album_title ?? 'Untitled Album'}
Album Theme: ${album.album_theme ?? 'No specific theme'}
Artist: ${prod.artist_name}
Genre: ${prod.genre}
Style Tags: ${song.style ?? ''}
Creative Direction: ${song.direction ?? 'No specific direction'}

Artist Context:
${artistContext.slice(0, 800)}

Genre structure guide: ${structureGuide}
${genrePreset ? `Rhyme scheme: ${genrePreset.rhymeScheme}` : ''}
${genrePreset ? `Syllable range per line: ${genrePreset.syllableRange.min}-${genrePreset.syllableRange.max}` : ''}
${genrePreset ? `Notes: ${genrePreset.notes}` : ''}

IMPORTANT:
- Write full, complete lyrics with section tags [Verse 1], [Chorus], etc.
- Follow the genre's rhyme scheme strictly
- Keep syllable counts within range
- All section tags MUST be in English inside brackets
- Output ONLY the lyrics with section tags. No commentary before or after.
- Start with the first section tag immediately.${prod.forbidden_words ? `\n- FORBIDDEN WORDS: Do NOT use these words anywhere in the lyrics: [${prod.forbidden_words}]` : ''}`;

  // Mark as WIP
  await pool.query(`UPDATE album_songs SET status = 'lyrics_wip' WHERE id = $1`, [songId]);

  const messages: ChatMessage[] = [
    { role: 'system', content: LYRIC_PIPELINE_PROMPT },
    { role: 'user', content: prompt },
  ];

  try {
    const result = await createCompletion(provider, model, messages, {
      temperature: 0.9,
      maxTokens: 3000,
      loggingContext: {
        userId: prod.user_id,
        source: 'album-pipeline',
        nodeName: 'write-lyrics',
      },
    });

    let lyrics = extractLyrics(result.content);

    if (!lyrics || lyrics.trim().length < 50) {
      throw new Error('LLM returned insufficient lyrics content');
    }

    // Forbidden word check on lyrics
    const lyricsForbidden = parseForbiddenWords(prod.forbidden_words);
    if (lyricsForbidden.length > 0) {
      let foundInLyrics = containsForbiddenWords(lyrics, lyricsForbidden);
      for (let retry = 0; retry < 2 && foundInLyrics.length > 0; retry++) {
        logger.warn('Lyrics contain forbidden words, retrying', { songId, retry: retry + 1, found: foundInLyrics });
        const fixMessages: ChatMessage[] = [
          { role: 'system', content: LYRIC_PIPELINE_PROMPT },
          { role: 'assistant', content: lyrics },
          { role: 'user', content: `Your lyrics contain FORBIDDEN words: [${foundInLyrics.join(', ')}]. Rewrite the lyrics without using any of these words: [${lyricsForbidden.join(', ')}]. Output ONLY the revised lyrics with section tags.` },
        ];
        try {
          const fixResult = await createCompletion(provider, model, fixMessages, {
            temperature: 0.7,
            maxTokens: 3000,
            loggingContext: { userId: prod.user_id, source: 'album-pipeline', nodeName: 'fix-forbidden-lyrics' },
          });
          const fixedLyrics = extractLyrics(fixResult.content);
          if (fixedLyrics && fixedLyrics.trim().length >= 50) {
            lyrics = fixedLyrics;
          }
          foundInLyrics = containsForbiddenWords(lyrics, lyricsForbidden);
        } catch (fixErr) {
          logger.warn('Forbidden word lyrics fix failed', { songId, error: (fixErr as Error).message });
          break;
        }
      }
      if (foundInLyrics.length > 0) {
        logger.warn('Lyrics still contain forbidden words after retries, accepting as-is', { songId, found: foundInLyrics });
      }
    }

    // Write to workspace
    if (song.workspace_path) {
      const mdContent = `---\ntitle: ${song.title}\nproject: ${album.album_title ?? 'Untitled'}\nstyle: ${song.style ?? ''}\nstatus: lyrics_review\ntrack: ${song.track_number}\n---\n\n${lyrics}\n`;
      try {
        await workspaceService.writeFile(prod.user_id, song.workspace_path, mdContent);
      } catch (err) {
        logger.warn('Failed to write lyrics to workspace', { songId, error: (err as Error).message });
      }
    }

    // Update DB
    await pool.query(
      `UPDATE album_songs SET lyrics_text = $1, status = 'lyrics_review' WHERE id = $2`,
      [lyrics, songId],
    );

    logger.info('Lyrics written for song', { songId, title: song.title, length: lyrics.length });
  } catch (err) {
    logger.error('Failed to write lyrics', { songId, error: (err as Error).message });
    await pool.query(
      `UPDATE album_songs SET status = 'planned', error_message = $1 WHERE id = $2`,
      [`Lyrics generation failed: ${(err as Error).message}`, songId],
    );
  }
}

function extractLyrics(content: string): string {
  // Find the first section tag and extract everything from there
  const sectionPattern = /\[(Verse|Chorus|Bridge|Intro|Outro|Drop|Hook|Pre-Chorus|Post-Chorus|Breakdown|Solo|Refrain|Build|Break|End|Instrumental)[^\]]*\]/i;
  const match = content.match(sectionPattern);
  if (match && match.index !== undefined) {
    return content.slice(match.index).trim();
  }
  // If no section tags found, return the whole content
  return content.trim();
}

// ============================================================
// Lyrics Analysis
// ============================================================

async function reviewLyrics(songId: string): Promise<void> {
  const songResult = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs WHERE id = $1`,
    [songId],
  );
  if (songResult.rows.length === 0) return;
  const song = songResult.rows[0];

  if (!song.lyrics_text) {
    // No lyrics to review, send back to writing
    await pool.query(`UPDATE album_songs SET status = 'planned' WHERE id = $1`, [songId]);
    return;
  }

  const prodResult = await pool.query<ProductionRow>(
    `SELECT * FROM album_productions WHERE id = $1`,
    [song.production_id],
  );
  const prod = prodResult.rows[0];

  const genrePreset = await genreRegistry.getPresetById(prod.user_id, song.genre_preset ?? prod.genre)
    ?? getBuiltinPresetById(song.genre_preset ?? prod.genre);
  if (!genrePreset) {
    // No preset to check against, approve as-is
    await pool.query(`UPDATE album_songs SET status = 'lyrics_approved' WHERE id = $1`, [songId]);
    return;
  }

  const analysis = analyzeLyrics(song.lyrics_text, genrePreset);

  if (analysis.issues.length === 0) {
    // All good - approve
    await pool.query(
      `UPDATE album_songs SET status = 'lyrics_approved', analysis_issues = NULL WHERE id = $1`,
      [songId],
    );
    logger.info('Lyrics approved', { songId, title: song.title });
    return;
  }

  // Issues found
  const currentRevisions = song.revision_count;
  const { provider, model: _model } = await resolveModel(prod.user_id, prod.lyrics_model, 'dj_luna');
  const isOllama = OLLAMA_PROVIDERS.has(provider);
  const maxRevisions = isOllama ? 3 : 1; // paid models: 1 revision (2 calls total)

  if (currentRevisions >= maxRevisions) {
    // Max revisions reached - approve as-is
    await pool.query(
      `UPDATE album_songs SET status = 'lyrics_approved', analysis_issues = $1 WHERE id = $2`,
      [JSON.stringify(analysis.issues), songId],
    );
    logger.info('Lyrics approved after max revisions', { songId, title: song.title, maxRevisions, issues: analysis.issues });
    return;
  }

  // Try to fix issues via LLM
  logger.info('Lyrics need revision', { songId, title: song.title, revision: currentRevisions + 1, issues: analysis.issues });

  const { model } = await resolveModel(prod.user_id, prod.lyrics_model, 'dj_luna');

  const revisionPrompt = `Here are lyrics that need revision. Fix the following issues while keeping the song's spirit intact:

Issues to fix:
${analysis.issues.map(i => `- ${i}`).join('\n')}

Current lyrics:
${song.lyrics_text}

Genre: ${prod.genre}
${genrePreset ? `Required structure: ${genrePreset.structure.filter(s => s.required).map(s => `[${s.tag}]`).join(', ')}` : ''}
${genrePreset ? `Rhyme scheme: ${genrePreset.rhymeScheme}` : ''}
${genrePreset ? `Syllable range: ${genrePreset.syllableRange.min}-${genrePreset.syllableRange.max}` : ''}

IMPORTANT:
- Fix ONLY the reported issues
- Keep the song's theme, story, and style
- Output ONLY the revised lyrics with section tags
- All section tags MUST be in English inside brackets`;

  const messages: ChatMessage[] = [
    { role: 'system', content: LYRIC_PIPELINE_PROMPT },
    { role: 'user', content: revisionPrompt },
  ];

  try {
    const result = await createCompletion(provider, model, messages, {
      temperature: 0.7,
      maxTokens: 3000,
      loggingContext: {
        userId: prod.user_id,
        source: 'album-pipeline',
        nodeName: 'revise-lyrics',
      },
    });

    const revisedLyrics = extractLyrics(result.content);

    if (!revisedLyrics || revisedLyrics.trim().length < 50) {
      throw new Error('Revision returned insufficient content');
    }

    // Write revised lyrics
    const albumResult = await pool.query<AlbumItemRow>(`SELECT * FROM album_items WHERE id = $1`, [song.album_id]);
    const album = albumResult.rows[0];

    if (song.workspace_path) {
      const mdContent = `---\ntitle: ${song.title}\nproject: ${album?.album_title ?? 'Untitled'}\nstyle: ${song.style ?? ''}\nstatus: lyrics_review\ntrack: ${song.track_number}\n---\n\n${revisedLyrics}\n`;
      try {
        await workspaceService.writeFile(prod.user_id, song.workspace_path, mdContent);
      } catch (err) {
        logger.warn('Failed to write revised lyrics', { songId, error: (err as Error).message });
      }
    }

    await pool.query(
      `UPDATE album_songs SET lyrics_text = $1, revision_count = $2, analysis_issues = $3, status = 'lyrics_review' WHERE id = $4`,
      [revisedLyrics, currentRevisions + 1, JSON.stringify(analysis.issues), songId],
    );
  } catch (err) {
    logger.error('Failed to revise lyrics', { songId, error: (err as Error).message });
    // Approve as-is on revision failure
    await pool.query(
      `UPDATE album_songs SET status = 'lyrics_approved', analysis_issues = $1 WHERE id = $2`,
      [JSON.stringify(analysis.issues), songId],
    );
  }
}

// ============================================================
// Suno Submission
// ============================================================

async function submitToSuno(songId: string): Promise<void> {
  const songResult = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs WHERE id = $1 AND status = 'lyrics_approved'`,
    [songId],
  );
  if (songResult.rows.length === 0) return;
  const song = songResult.rows[0];

  try {
    const generations = await sunoService.triggerBatch(
      song.user_id,
      1,
      song.style ?? undefined,
      song.lyrics_text ?? undefined,
      song.title,
    );

    if (generations.length > 0) {
      await pool.query(
        `UPDATE album_songs SET suno_generation_id = $1, status = 'suno_pending' WHERE id = $2`,
        [generations[0].id, songId],
      );
      logger.info('Song submitted to Suno', { songId, title: song.title, generationId: generations[0].id });
    } else {
      throw new Error('triggerBatch returned no generations');
    }
  } catch (err) {
    logger.error('Failed to submit song to Suno', { songId, error: (err as Error).message });
    await pool.query(
      `UPDATE album_songs SET status = 'failed', error_message = $1 WHERE id = $2`,
      [`Suno submission failed: ${(err as Error).message}`, songId],
    );
  }
}

// ============================================================
// Suno Callback Handler
// ============================================================

export async function handleSunoComplete(sunoGenerationId: string): Promise<void> {
  // Check if this generation is linked to an album song
  const songResult = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs WHERE suno_generation_id = $1`,
    [sunoGenerationId],
  );
  if (songResult.rows.length === 0) return; // Not an album song
  const song = songResult.rows[0];

  // Check generation status
  const genResult = await pool.query<{ status: string; error_message: string | null }>(
    `SELECT status, error_message FROM suno_generations WHERE id = $1`,
    [sunoGenerationId],
  );
  if (genResult.rows.length === 0) return;
  const gen = genResult.rows[0];

  if (gen.status === 'completed') {
    await pool.query(
      `UPDATE album_songs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [song.id],
    );
    logger.info('Album song completed via Suno', { songId: song.id, title: song.title });
  } else if (gen.status === 'failed') {
    await pool.query(
      `UPDATE album_songs SET status = 'failed', error_message = $1 WHERE id = $2`,
      [gen.error_message ?? 'Suno generation failed', song.id],
    );
    logger.warn('Album song Suno generation failed', { songId: song.id, title: song.title });
  }

  // Check album completion
  await checkAlbumCompletion(song.album_id);
  // Check production completion
  await checkProductionCompletion(song.production_id);
}

async function checkAlbumCompletion(albumId: string): Promise<void> {
  const result = await pool.query<{ total: string; done: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'skipped')) AS done
     FROM album_songs WHERE album_id = $1`,
    [albumId],
  );

  const { total, done } = result.rows[0];
  if (parseInt(total, 10) > 0 && parseInt(done, 10) >= parseInt(total, 10)) {
    await pool.query(`UPDATE album_items SET status = 'completed' WHERE id = $1`, [albumId]);
  }
}

async function checkProductionCompletion(productionId: string): Promise<void> {
  const result = await pool.query<{ total: string; done: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) AS done
     FROM album_items WHERE production_id = $1`,
    [productionId],
  );

  const { total, done } = result.rows[0];
  if (parseInt(total, 10) > 0 && parseInt(done, 10) >= parseInt(total, 10)) {
    await pool.query(
      `UPDATE album_productions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [productionId],
    );
    logger.info('Production completed', { productionId });
  }
}

// ============================================================
// Approve Production (start autonomous execution)
// ============================================================

export async function approveProduction(userId: string, productionId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE album_productions SET status = 'in_progress'
     WHERE id = $1 AND user_id = $2 AND status = 'planned'
     RETURNING id`,
    [productionId, userId],
  );
  if ((result.rowCount ?? 0) === 0) return false;

  // Also set all albums to in_progress
  await pool.query(
    `UPDATE album_items SET status = 'in_progress' WHERE production_id = $1`,
    [productionId],
  );

  logger.info('Production approved for execution', { productionId });

  // Kick off the full pipeline immediately in background
  runFullPipeline(productionId).catch(err => {
    logger.error('Background pipeline failed', { productionId, error: (err as Error).message });
  });

  return true;
}

// ============================================================
// Cancel Production
// ============================================================

export async function cancelProduction(userId: string, productionId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE album_productions SET status = 'failed', error_message = 'Cancelled by user'
     WHERE id = $1 AND user_id = $2 AND status IN ('planning', 'planned', 'in_progress')
     RETURNING id`,
    [productionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================
// Full Pipeline - runs all LLM calls back-to-back, then staggers Suno
// ============================================================

async function isProductionCancelled(productionId: string): Promise<boolean> {
  const r = await pool.query<{ status: string }>(`SELECT status FROM album_productions WHERE id = $1`, [productionId]);
  return r.rows.length === 0 || r.rows[0].status === 'failed';
}

/**
 * External trigger for the full pipeline (e.g. from /run endpoint).
 * Fire-and-forget.
 */
export function triggerFullPipeline(productionId: string): void {
  runFullPipeline(productionId).catch(err => {
    logger.error('Triggered pipeline failed', { productionId, error: (err as Error).message });
  });
}

async function runFullPipeline(productionId: string): Promise<void> {
  if (activePipelines.has(productionId)) {
    logger.info('Pipeline already running, skipping duplicate', { productionId });
    return;
  }
  activePipelines.add(productionId);
  try {
    await runFullPipelineInner(productionId);
  } finally {
    activePipelines.delete(productionId);
  }
}

async function runFullPipelineInner(productionId: string): Promise<void> {
  logger.info('Starting full pipeline run', { productionId });

  // Phase 1: Write + review lyrics for ALL songs back-to-back (no delays)
  const songsResult = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs
     WHERE production_id = $1 AND status IN ('planned', 'lyrics_wip', 'lyrics_review')
     ORDER BY track_number`,
    [productionId],
  );

  for (const song of songsResult.rows) {
    if (await isProductionCancelled(productionId)) {
      logger.info('Pipeline aborted - production cancelled', { productionId });
      return;
    }

    try {
      // Write lyrics if needed
      if (song.status === 'planned' || song.status === 'lyrics_wip') {
        await writeLyrics(song.id);
      }

      // Review + revise loop until approved
      let reviewing = true;
      while (reviewing) {
        if (await isProductionCancelled(productionId)) return;

        // Re-read current status (only fetch status column, not full row)
        const current = await pool.query<{ status: string }>(`SELECT status FROM album_songs WHERE id = $1`, [song.id]);
        if (current.rows.length === 0) break;

        if (current.rows[0].status === 'lyrics_review') {
          await reviewLyrics(song.id);
        } else {
          // lyrics_approved, failed, or something else - move on
          reviewing = false;
        }
      }

      logger.info('Song lyrics phase complete', { songId: song.id, title: song.title });
    } catch (err) {
      logger.error('Song lyrics phase failed', { songId: song.id, title: song.title, error: (err as Error).message });
    }
  }

  // Phase 2: Submit all approved songs to Suno with 15s stagger
  const approvedSongs = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs
     WHERE production_id = $1 AND status = 'lyrics_approved'
     ORDER BY track_number`,
    [productionId],
  );

  logger.info('Lyrics phase done, submitting to Suno', {
    productionId,
    approvedCount: approvedSongs.rows.length,
  });

  for (let i = 0; i < approvedSongs.rows.length; i++) {
    if (await isProductionCancelled(productionId)) {
      logger.info('Pipeline aborted before Suno - production cancelled', { productionId });
      return;
    }

    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, SUNO_STAGGER_MS));
    }

    try {
      await submitToSuno(approvedSongs.rows[i].id);
    } catch (err) {
      logger.error('Suno submission failed in pipeline', {
        songId: approvedSongs.rows[i].id,
        error: (err as Error).message,
      });
    }
  }

  logger.info('Full pipeline run complete', { productionId });
}

// ============================================================
// Pipeline Worker (safety net - called by job runner every 5 min)
// ============================================================

export async function runPipelineStep(): Promise<void> {
  // Find active productions that might have stuck songs
  const activeProds = await pool.query<{ id: string }>(
    `SELECT id FROM album_productions WHERE status = 'in_progress' ORDER BY created_at LIMIT 5`,
  );

  if (activeProds.rows.length === 0) {
    // Even with no active productions, check for retryable failed songs
    // in completed productions
    await retryFailedSongsGlobal();
    // Auto-approve next planned trend production if previous completed
    await autoApproveNextTrendProduction();
    return;
  }

  for (const prod of activeProds.rows) {
    try {
      await recoverStuckSongs(prod.id);
    } catch (err) {
      logger.error('Pipeline recovery step failed', { productionId: prod.id, error: (err as Error).message });
    }
  }

  // Retry failed songs across all completed/in_progress productions
  await retryFailedSongsGlobal();
  // Auto-approve next planned trend production if previous completed
  await autoApproveNextTrendProduction();
}

async function recoverStuckSongs(productionId: string): Promise<void> {
  // Check for suno_pending songs whose generation already completed (missed callback)
  const staleSuno = await pool.query(
    `SELECT s.id, s.suno_generation_id FROM album_songs s
     JOIN suno_generations g ON s.suno_generation_id = g.id
     WHERE s.production_id = $1
       AND s.status = 'suno_pending'
       AND g.status IN ('completed', 'failed')`,
    [productionId],
  );

  for (const row of staleSuno.rows) {
    const r = row as { id: string; suno_generation_id: string };
    await handleSunoComplete(r.suno_generation_id);
  }

  // Check if the full pipeline died mid-run (songs still in planned/lyrics_review/lyrics_wip)
  // If so, re-trigger the full pipeline to continue where it left off
  const unfinished = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM album_songs
     WHERE production_id = $1 AND status IN ('planned', 'lyrics_wip', 'lyrics_review')`,
    [productionId],
  );
  if (parseInt(unfinished.rows[0].cnt, 10) > 0) {
    logger.info('Recovery: re-triggering full pipeline for unfinished songs', {
      productionId,
      unfinished: unfinished.rows[0].cnt,
    });
    // Run inline (already inside the job runner) instead of fire-and-forget
    await runFullPipeline(productionId);
    return; // runFullPipeline handles everything including Suno submission
  }

  // Check for lyrics_approved songs that somehow weren't submitted to Suno
  const orphanApproved = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs
     WHERE production_id = $1 AND status = 'lyrics_approved'
     ORDER BY track_number`,
    [productionId],
  );

  for (let i = 0; i < orphanApproved.rows.length; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, SUNO_STAGGER_MS));
    await submitToSuno(orphanApproved.rows[i].id);
  }

  // Check production completion
  await checkProductionCompletion(productionId);
}

// ============================================================
// Failed Song Retry Logic
// ============================================================

const MAX_SONG_RETRIES = 3;

/**
 * Find and retry failed songs across all non-cancelled productions.
 * Called by runPipelineStep every 5 minutes.
 */
async function retryFailedSongsGlobal(): Promise<void> {
  const failedSongs = await pool.query<AlbumSongRow>(
    `SELECT s.* FROM album_songs s
     JOIN album_productions p ON s.production_id = p.id
     WHERE s.status = 'failed'
       AND s.retry_count < $1
       AND p.status IN ('in_progress', 'completed')
     ORDER BY s.created_at ASC
     LIMIT 5`,
    [MAX_SONG_RETRIES],
  );

  if (failedSongs.rows.length === 0) return;

  logger.info('Retrying failed songs', { count: failedSongs.rows.length });

  for (const song of failedSongs.rows) {
    try {
      await retrySingleSong(song);
    } catch (err) {
      logger.error('Failed to retry song', { songId: song.id, error: (err as Error).message });
    }
  }
}

/**
 * Retry a single failed song: increment retry_count, reset to lyrics_approved, re-submit to Suno.
 */
async function retrySingleSong(song: AlbumSongRow): Promise<void> {
  const newRetryCount = song.retry_count + 1;
  logger.info('Retrying failed song', {
    songId: song.id,
    title: song.title,
    attempt: newRetryCount,
    maxRetries: MAX_SONG_RETRIES,
  });

  // Increment retry_count and reset status to lyrics_approved for re-submission
  await pool.query(
    `UPDATE album_songs
     SET status = 'lyrics_approved',
         retry_count = $1,
         error_message = NULL,
         suno_generation_id = NULL
     WHERE id = $2`,
    [newRetryCount, song.id],
  );

  // Re-submit to Suno
  await submitToSuno(song.id);
}

/**
 * Manually retry all failed songs in a specific production.
 * Called from the retry-failed API endpoint.
 */
export async function retryFailedSongs(userId: string, productionId: string): Promise<{ retriedCount: number }> {
  // Verify the production belongs to the user and isn't cancelled
  const prodCheck = await pool.query<{ status: string }>(
    `SELECT status FROM album_productions WHERE id = $1 AND user_id = $2`,
    [productionId, userId],
  );

  if (prodCheck.rows.length === 0) {
    throw new Error('Production not found');
  }

  if (prodCheck.rows[0].status === 'failed') {
    // Check if it was user-cancelled vs auto-failed
    const cancelCheck = await pool.query<{ error_message: string | null }>(
      `SELECT error_message FROM album_productions WHERE id = $1`,
      [productionId],
    );
    if (cancelCheck.rows[0]?.error_message === 'Cancelled by user') {
      throw new Error('Cannot retry a cancelled production');
    }
  }

  const failedSongs = await pool.query<AlbumSongRow>(
    `SELECT * FROM album_songs
     WHERE production_id = $1
       AND status = 'failed'
       AND retry_count < $2
     ORDER BY track_number`,
    [productionId, MAX_SONG_RETRIES],
  );

  if (failedSongs.rows.length === 0) {
    return { retriedCount: 0 };
  }

  // If production was marked completed, set it back to in_progress
  await pool.query(
    `UPDATE album_productions SET status = 'in_progress', completed_at = NULL
     WHERE id = $1 AND status = 'completed'`,
    [productionId],
  );

  // Also update album statuses back to in_progress
  const albumIds = [...new Set(failedSongs.rows.map(s => s.album_id))];
  for (const albumId of albumIds) {
    await pool.query(
      `UPDATE album_items SET status = 'in_progress' WHERE id = $1 AND status = 'completed'`,
      [albumId],
    );
  }

  let retriedCount = 0;
  for (const song of failedSongs.rows) {
    try {
      await retrySingleSong(song);
      retriedCount++;
    } catch (err) {
      logger.error('Manual retry failed for song', { songId: song.id, error: (err as Error).message });
    }
  }

  logger.info('Manual retry triggered', { productionId, retriedCount, totalFailed: failedSongs.rows.length });
  return { retriedCount };
}

// ============================================================
// Auto-approve Next Trend Production
// ============================================================

/**
 * When a trend-generated production completes, auto-approve the next
 * one in 'planned' status from the same trend batch.
 * This serializes album execution to prevent Suno overload.
 */
async function autoApproveNextTrendProduction(): Promise<void> {
  // Find the oldest planned production that has trend-related notes
  // but only if there are no currently in_progress productions
  const inProgressCount = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM album_productions WHERE status = 'in_progress'`,
  );

  if (parseInt(inProgressCount.rows[0].cnt, 10) > 0) {
    return; // Still have active pipelines, don't approve more
  }

  const nextPlanned = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM album_productions
     WHERE status = 'planned'
       AND production_notes LIKE '%Auto-generated from music trend%'
     ORDER BY created_at ASC
     LIMIT 1`,
  );

  if (nextPlanned.rows.length === 0) return;

  const { id: productionId, user_id: userId } = nextPlanned.rows[0];
  logger.info('Auto-approving next trend production', { productionId });

  const approved = await approveProduction(userId, productionId);
  if (approved) {
    logger.info('Next trend production auto-approved and pipeline started', { productionId });
  }
}

// ============================================================
// Artist Management
// ============================================================

export async function listArtists(userId: string): Promise<string[]> {
  try {
    const files = await workspaceService.listFiles(userId);
    return files
      .filter(f => f.path.startsWith('ceo-luna/artists/') && f.path.endsWith('.md'))
      .map(f => {
        const name = f.path.replace('ceo-luna/artists/', '').replace('.md', '');
        return name;
      });
  } catch {
    return [];
  }
}

export async function readArtist(userId: string, name: string): Promise<string | null> {
  try {
    const slug = slugify(name);
    return await workspaceService.readFile(userId, `ceo-luna/artists/${slug}.md`);
  } catch {
    return null;
  }
}

export async function writeArtist(userId: string, name: string, content: string): Promise<void> {
  const slug = slugify(name);
  await workspaceService.writeFile(userId, `ceo-luna/artists/${slug}.md`, content);
}
