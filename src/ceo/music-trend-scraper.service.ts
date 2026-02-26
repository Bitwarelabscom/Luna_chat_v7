import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import { GENRE_PRESETS } from '../abilities/genre-presets.js';
import { invalidateCache } from '../abilities/genre-registry.service.js';
import { enqueueCeoMessage } from './ceo.service.js';
import * as albumPipeline from './album-pipeline.service.js';
import * as triggerService from '../triggers/trigger.service.js';
import type { ChatMessage } from '../llm/types.js';
import { logActivity } from '../activity/activity.service.js';
import logger from '../utils/logger.js';

// Default artist names used when auto-generating albums from trends
const DEFAULT_TREND_ARTISTS = ['Bitwaretunes', 'Pillow Frequency', 'Coffee'];
const ALBUMS_PER_TREND = 3;

// ============================================================
// Types
// ============================================================

interface TrendItem {
  source: string;
  title: string;
  description: string;
  genres?: string[];
  artists?: string[];
  url?: string;
}

interface TrendAnalysis {
  emergingGenres: Array<{
    name: string;
    confidence: number;
    description: string;
    suggestedStyleTags: string;
    suggestedCategory: string;
    evidence: string;
    isNew: boolean; // true = not in existing 55 presets
  }>;
  signals: Array<{
    title: string;
    summary: string;
    confidence: number;
    actionable: boolean;
  }>;
}

// ============================================================
// Scraping Sources
// ============================================================

async function scrapeBillboard(): Promise<TrendItem[]> {
  const items: TrendItem[] = [];
  try {
    const response = await fetch('https://www.billboard.com/feed/', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Luna-MusicTrendBot/1.0' },
    });
    if (!response.ok) return items;
    const text = await response.text();

    // Parse RSS items - extract title and description
    const itemRegex = /<item>\s*<title><!\[CDATA\[(.*?)\]\]><\/title>.*?<description><!\[CDATA\[(.*?)\]\]><\/description>/gs;
    let match;
    let count = 0;
    while ((match = itemRegex.exec(text)) !== null && count < 20) {
      items.push({
        source: 'billboard',
        title: match[1].trim(),
        description: match[2].replace(/<[^>]*>/g, '').trim().slice(0, 500),
      });
      count++;
    }

    // Fallback: simpler regex if CDATA-free
    if (items.length === 0) {
      const simpleRegex = /<item>\s*<title>(.*?)<\/title>.*?<description>(.*?)<\/description>/gs;
      while ((match = simpleRegex.exec(text)) !== null && count < 20) {
        items.push({
          source: 'billboard',
          title: match[1].trim(),
          description: match[2].replace(/<[^>]*>/g, '').trim().slice(0, 500),
        });
        count++;
      }
    }
  } catch (err) {
    logger.warn('Billboard scrape failed', { error: (err as Error).message });
  }
  return items;
}

async function scrapePitchfork(): Promise<TrendItem[]> {
  const items: TrendItem[] = [];
  try {
    const response = await fetch('https://pitchfork.com/feed/feed-album-reviews/rss', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Luna-MusicTrendBot/1.0' },
    });
    if (!response.ok) return items;
    const text = await response.text();

    const itemRegex = /<item>\s*<title>(.*?)<\/title>.*?<description>(.*?)<\/description>/gs;
    let match;
    let count = 0;
    while ((match = itemRegex.exec(text)) !== null && count < 20) {
      items.push({
        source: 'pitchfork',
        title: match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        description: match[2].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 500),
      });
      count++;
    }
  } catch (err) {
    logger.warn('Pitchfork scrape failed', { error: (err as Error).message });
  }
  return items;
}

async function filterMusicNews(): Promise<TrendItem[]> {
  const items: TrendItem[] = [];
  try {
    const musicKeywords = ['genre', 'trending', 'viral', 'chart', 'music', 'album', 'artist', 'spotify', 'billboard', 'grammy'];
    const result = await pool.query<{ title: string; summary: string; source_url: string }>(
      `SELECT title, summary, source_url
       FROM newsfetcher_articles
       WHERE created_at > NOW() - INTERVAL '48 hours'
       ORDER BY created_at DESC
       LIMIT 100`,
    );

    for (const row of result.rows) {
      const text = `${row.title} ${row.summary}`.toLowerCase();
      const matches = musicKeywords.filter(kw => text.includes(kw));
      if (matches.length >= 2) {
        items.push({
          source: 'newsfetcher',
          title: row.title,
          description: row.summary?.slice(0, 500) || '',
          url: row.source_url,
        });
      }
    }
  } catch (err) {
    // newsfetcher_articles table may not exist
    logger.debug('Music news filter skipped', { error: (err as Error).message });
  }
  return items;
}

// ============================================================
// Main Scrape Function
// ============================================================

export async function scrapeMusicTrends(): Promise<TrendItem[]> {
  logger.info('Starting music trend scrape');

  const [billboard, pitchfork, news] = await Promise.allSettled([
    scrapeBillboard(),
    scrapePitchfork(),
    filterMusicNews(),
  ]);

  const items: TrendItem[] = [
    ...(billboard.status === 'fulfilled' ? billboard.value : []),
    ...(pitchfork.status === 'fulfilled' ? pitchfork.value : []),
    ...(news.status === 'fulfilled' ? news.value : []),
  ];

  // Store raw data
  if (items.length > 0) {
    try {
      await pool.query(
        `INSERT INTO music_trend_raw (source, raw_data) VALUES ($1, $2)`,
        ['combined', JSON.stringify(items)],
      );
    } catch (err) {
      logger.warn('Failed to store raw music trends', { error: (err as Error).message });
    }
  }

  logger.info('Music trend scrape complete', { total: items.length });
  return items;
}

// ============================================================
// LLM Trend Analysis
// ============================================================

const KNOWN_GENRE_IDS = GENRE_PRESETS.map(p => p.id);

export async function analyzeTrendsWithLLM(userId: string, items: TrendItem[]): Promise<TrendAnalysis | null> {
  if (items.length === 0) return null;

  const config = await getBackgroundFeatureModelConfig(userId, 'music_trend_analysis');
  const { provider, model } = config.primary;

  const itemSummary = items.slice(0, 30).map((item, i) =>
    `${i + 1}. [${item.source}] ${item.title}\n   ${item.description.slice(0, 200)}`
  ).join('\n\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You analyze music industry trends and identify emerging genres. You know these existing genre presets: ${KNOWN_GENRE_IDS.join(', ')}. Return ONLY valid JSON.`,
    },
    {
      role: 'user',
      content: `Analyze these music news/chart items for emerging genre trends:

${itemSummary}

Identify:
1. Emerging or trending genres NOT already in our preset list
2. Genre fusions or new subgenres gaining traction
3. Market signals relevant to music production

Return JSON:
{
  "emergingGenres": [
    {
      "name": "Genre Name",
      "confidence": 0.0-1.0,
      "description": "Brief description",
      "suggestedStyleTags": "suno-compatible style tags",
      "suggestedCategory": "one of: pop, rock, electronic, hip-hop, r-and-b, folk-country, latin, world, jazz-blues, chill, classical-cinematic, experimental",
      "evidence": "Why this is trending based on the data",
      "isNew": true
    }
  ],
  "signals": [
    {
      "title": "Signal title",
      "summary": "Brief summary",
      "confidence": 0.0-1.0,
      "actionable": true/false
    }
  ]
}

Only include genres with confidence >= 0.4. Only include signals that are actionable for a music production AI.`,
    },
  ];

  try {
    const result = await createCompletion(provider, model, messages, {
      temperature: 0.3,
      maxTokens: 3000,
      loggingContext: {
        userId,
        source: 'music-trend-scraper',
        nodeName: 'analyze-trends',
      },
    });

    const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const analysis: TrendAnalysis = JSON.parse(cleaned);

    // Validate and filter
    analysis.emergingGenres = (analysis.emergingGenres || []).filter(g =>
      g.name && g.confidence >= 0.4 && g.suggestedStyleTags
    );
    analysis.signals = (analysis.signals || []).filter(s =>
      s.title && s.confidence >= 0.3
    );

    return analysis;
  } catch (err) {
    logger.error('Music trend LLM analysis failed', { userId, error: (err as Error).message });

    // Try fallback
    try {
      const fallback = config.fallback;
      const result = await createCompletion(fallback.provider, fallback.model, messages, {
        temperature: 0.3,
        maxTokens: 3000,
        loggingContext: {
          userId,
          source: 'music-trend-scraper',
          nodeName: 'analyze-trends-fallback',
        },
      });
      const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch (fallbackErr) {
      logger.error('Music trend LLM fallback also failed', { error: (fallbackErr as Error).message });
      return null;
    }
  }
}

// ============================================================
// Process Analysis Results
// ============================================================

export async function processAnalysisResults(userId: string, analysis: TrendAnalysis): Promise<void> {
  // Store market signals
  for (const signal of analysis.signals) {
    try {
      await pool.query(
        `INSERT INTO ceo_market_signals (user_id, signal_type, title, summary, confidence, actionable)
         VALUES ($1, 'music_trend', $2, $3, $4, $5)`,
        [userId, signal.title, signal.summary, signal.confidence, signal.actionable],
      );
    } catch (err) {
      logger.warn('Failed to store music trend signal', { error: (err as Error).message });
    }
  }

  // Process emerging genres - propose new ones
  for (const genre of analysis.emergingGenres) {
    if (!genre.isNew) continue; // Skip genres that already exist

    // Check if already proposed or approved
    const existing = await pool.query(
      `SELECT id FROM proposed_genre_presets
       WHERE user_id = $1 AND genre_id = $2 AND status IN ('pending', 'approved')`,
      [userId, slugify(genre.name)],
    );
    if (existing.rows.length > 0) continue;

    await generatePresetFromTrend(userId, genre);
  }

  // Mark raw data as processed
  await pool.query(
    `UPDATE music_trend_raw SET processed = true
     WHERE processed = false AND scraped_at > NOW() - INTERVAL '4 hours'`,
  );
}

// ============================================================
// Generate Full Preset from Trend
// ============================================================

async function generatePresetFromTrend(
  userId: string,
  trend: TrendAnalysis['emergingGenres'][0],
): Promise<void> {
  const genreId = slugify(trend.name);

  // Check if this genre ID already exists in builtins
  if (KNOWN_GENRE_IDS.includes(genreId)) return;

  const presetData = {
    id: genreId,
    name: trend.name,
    description: trend.description,
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'bridge', required: false },
    ],
    syllableRange: { min: 5, max: 10 },
    rhymeScheme: 'ABAB',
    notes: trend.evidence,
    defaultSongCount: 10,
    category: trend.suggestedCategory,
    styleTags: trend.suggestedStyleTags,
    bpmRange: { min: 90, max: 130 },
    energy: 'medium',
  };

  try {
    // Auto-approve the genre (insert with status='approved')
    const result = await pool.query<{ id: string }>(
      `INSERT INTO proposed_genre_presets (user_id, genre_id, name, category, preset_data, confidence, status, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved', NOW())
       RETURNING id`,
      [userId, genreId, trend.name, trend.suggestedCategory, JSON.stringify(presetData), trend.confidence],
    );

    // Invalidate genre registry cache so new genre is available
    invalidateCache(userId);

    logger.info('Auto-approved new genre from trend', { userId, genreId, name: trend.name, confidence: trend.confidence });

    // Notify about auto-approved genre
    await notifyNewGenreProposal(userId, trend, result.rows[0].id);

    // Queue 3 album productions for this new genre
    await queueTrendAlbums(userId, genreId, trend);
  } catch (err) {
    logger.warn('Failed to process genre from trend', { genreId, error: (err as Error).message });
  }
}

// ============================================================
// Auto-Queue Albums for Trend Genre
// ============================================================

async function queueTrendAlbums(
  userId: string,
  genreId: string,
  trend: TrendAnalysis['emergingGenres'][0],
): Promise<void> {
  // Get existing artist names, fall back to defaults
  let artists: string[];
  try {
    const existingArtists = await albumPipeline.listArtists(userId);
    artists = existingArtists.length > 0 ? existingArtists : DEFAULT_TREND_ARTISTS;
  } catch {
    artists = DEFAULT_TREND_ARTISTS;
  }

  const queuedIds: string[] = [];

  for (let i = 0; i < ALBUMS_PER_TREND; i++) {
    const artistName = artists[i % artists.length];
    try {
      // Create production
      const productionId = await albumPipeline.createProduction(userId, {
        artistName,
        genre: genreId,
        productionNotes: `Auto-generated from music trend: "${trend.name}" (${Math.round(trend.confidence * 100)}% confidence). ${trend.evidence}`,
        albumCount: 1,
      });

      logger.info('Auto-queued album production from trend', { userId, productionId, genreId, artistName, index: i + 1 });

      // Plan albums immediately
      await albumPipeline.planAlbums(productionId);

      // Only approve the FIRST production immediately.
      // Subsequent ones stay in 'planned' and get auto-approved by
      // autoApproveNextTrendProduction() when the previous one completes.
      // This prevents multiple concurrent pipelines from overloading Suno.
      if (i === 0) {
        const approved = await albumPipeline.approveProduction(userId, productionId);
        if (approved) {
          logger.info('Auto-approved first album production', { productionId, genreId });
        }
      } else {
        logger.info('Album production planned, will auto-approve when previous completes', { productionId, genreId, queuePosition: i + 1 });
      }

      queuedIds.push(productionId);

      // Small delay between productions to avoid hammering LLM
      if (i < ALBUMS_PER_TREND - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      logger.error('Failed to auto-queue album from trend', {
        userId, genreId, artistName, index: i + 1,
        error: (err as Error).message,
      });
    }
  }

  // Notify about queued productions
  if (queuedIds.length > 0) {
    const msg = `[Auto-Production] Queued ${queuedIds.length} album(s) for new trend genre "${trend.name}".\n` +
      `Artists: ${artists.slice(0, queuedIds.length).join(', ')}\n` +
      `Productions are now running the full pipeline (planning -> lyrics -> Suno).`;

    await enqueueCeoMessage(userId, 'music_trend_auto_production', msg, 7);

    try {
      await triggerService.enqueueTrigger({
        userId,
        triggerSource: 'event',
        triggerType: 'music_trend_auto_production',
        payload: { genreId, genreName: trend.name, productionIds: queuedIds },
        message: msg,
        deliveryMethod: 'sse',
        priority: 7,
      });
    } catch (err) {
      logger.warn('Failed to send SSE for auto-production', { error: (err as Error).message });
    }
  }
}

// ============================================================
// Multi-Channel Notifications
// ============================================================

async function notifyNewGenreProposal(
  userId: string,
  trend: TrendAnalysis['emergingGenres'][0],
  proposalId: string,
): Promise<void> {
  const confidencePct = Math.round(trend.confidence * 100);
  const message = `[Music Trend] New genre auto-approved: "${trend.name}" (${confidencePct}% confidence)\n` +
    `Category: ${trend.suggestedCategory}\n` +
    `Style: ${trend.suggestedStyleTags}\n` +
    `Evidence: ${trend.evidence}\n` +
    `${ALBUMS_PER_TREND} albums are being auto-generated. Proposal ID: ${proposalId}`;

  // Always: CEO Luna chat message
  if (trend.confidence >= 0.5) {
    await enqueueCeoMessage(userId, 'music_trend_genre_proposal', message, 6);
  }

  // SSE badge for autonomous notifications
  if (trend.confidence >= 0.5) {
    try {
      await triggerService.enqueueTrigger({
        userId,
        triggerSource: 'event',
        triggerType: 'music_trend_genre_proposal',
        payload: { proposalId, genreName: trend.name, confidence: trend.confidence },
        message,
        deliveryMethod: 'sse',
        priority: 7,
      });
    } catch (err) {
      logger.warn('Failed to send SSE notification for genre proposal', { error: (err as Error).message });
    }
  }

  // High-confidence: also Telegram
  if (trend.confidence >= 0.7) {
    try {
      await triggerService.enqueueTrigger({
        userId,
        triggerSource: 'event',
        triggerType: 'music_trend_genre_proposal_telegram',
        payload: { proposalId, genreName: trend.name, confidence: trend.confidence },
        message: `New genre trend: "${trend.name}" (${confidencePct}%)\nStyle: ${trend.suggestedStyleTags}`,
        deliveryMethod: 'telegram',
        priority: 7,
      });
    } catch (err) {
      logger.warn('Failed to send Telegram notification for genre proposal', { error: (err as Error).message });
    }
  }
}

// ============================================================
// Full Scrape + Analysis Pipeline (called by job runner)
// ============================================================

export async function runMusicTrendPipeline(): Promise<void> {
  logger.info('Running music trend pipeline');

  // Scrape
  const items = await scrapeMusicTrends();

  // Get active users (users with CEO config)
  const usersResult = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM ceo_configs LIMIT 10`,
  );

  if (items.length === 0) {
    logger.info('No music trend items found, skipping analysis');
    // Warn all CEO users that scraping returned 0 items
    for (const row of usersResult.rows) {
      logActivity({
        userId: row.user_id,
        category: 'background',
        eventType: 'music_trend_scrape_empty',
        level: 'warn',
        title: 'Music trend scraper: all sources returned 0 items',
        source: 'music-trend-scraper',
      }).catch(e => logger.debug('Activity log failed', { err: (e as Error).message }));
    }
    return;
  }

  for (const row of usersResult.rows) {
    try {
      // Log scrape success
      logActivity({
        userId: row.user_id,
        category: 'background',
        eventType: 'music_trend_scrape_complete',
        level: 'success',
        title: `Music trend scraper: ${items.length} items scraped`,
        details: { itemCount: items.length },
        source: 'music-trend-scraper',
      }).catch(e => logger.debug('Activity log failed', { err: (e as Error).message }));

      const analysis = await analyzeTrendsWithLLM(row.user_id, items);
      if (analysis) {
        await processAnalysisResults(row.user_id, analysis);
      }
    } catch (err) {
      logger.error('Music trend analysis failed for user', { userId: row.user_id, error: (err as Error).message });
      logActivity({
        userId: row.user_id,
        category: 'error',
        eventType: 'music_trend_analysis_failed',
        level: 'error',
        title: 'Music trend analysis failed',
        message: (err as Error).message,
        source: 'music-trend-scraper',
      }).catch(e => logger.debug('Activity log failed', { err: (e as Error).message }));
    }
  }

  logger.info('Music trend pipeline complete');
}

// ============================================================
// Manual Scrape Trigger (for single user)
// ============================================================

export async function runMusicTrendPipelineForUser(userId: string): Promise<{ items: number; genres: number; signals: number }> {
  const items = await scrapeMusicTrends();
  if (items.length === 0) {
    return { items: 0, genres: 0, signals: 0 };
  }

  const analysis = await analyzeTrendsWithLLM(userId, items);
  if (!analysis) {
    return { items: items.length, genres: 0, signals: 0 };
  }

  await processAnalysisResults(userId, analysis);

  return {
    items: items.length,
    genres: analysis.emergingGenres.filter(g => g.isNew).length,
    signals: analysis.signals.length,
  };
}

// ============================================================
// Genre Proposal Management
// ============================================================

export async function listProposedGenres(userId: string, status = 'pending'): Promise<Array<{
  id: string;
  genreId: string;
  name: string;
  category: string;
  presetData: Record<string, unknown>;
  confidence: number;
  status: string;
  createdAt: string;
}>> {
  const result = await pool.query(
    `SELECT id, genre_id, name, category, preset_data, confidence, status, created_at
     FROM proposed_genre_presets
     WHERE user_id = $1 AND status = $2
     ORDER BY confidence DESC, created_at DESC
     LIMIT 50`,
    [userId, status],
  );

  return result.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    genreId: r.genre_id as string,
    name: r.name as string,
    category: r.category as string,
    presetData: r.preset_data as Record<string, unknown>,
    confidence: Number(r.confidence),
    status: r.status as string,
    createdAt: r.created_at as string,
  }));
}

export async function approveProposedGenre(userId: string, proposalId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE proposed_genre_presets SET status = 'approved', reviewed_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING id`,
    [proposalId, userId],
  );

  if ((result.rowCount ?? 0) > 0) {
    invalidateCache(userId);
    return true;
  }
  return false;
}

export async function rejectProposedGenre(userId: string, proposalId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE proposed_genre_presets SET status = 'rejected', reviewed_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING id`,
    [proposalId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function editProposedGenre(
  userId: string,
  proposalId: string,
  presetData: Record<string, unknown>,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE proposed_genre_presets SET preset_data = $1
     WHERE id = $2 AND user_id = $3 AND status = 'pending'
     RETURNING id`,
    [JSON.stringify(presetData), proposalId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================
// Helpers
// ============================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60)
    .replace(/^-|-$/g, '');
}
