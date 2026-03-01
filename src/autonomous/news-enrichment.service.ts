import { redis } from '../db/redis.js';
import { query } from '../db/postgres.js';
import { filterArticle } from './news-filter.service.js';
import { checkAndSendAlerts } from './news-alert.service.js';
import * as factsService from '../memory/facts.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface EnrichmentState {
  running: boolean;
  total: number;
  processed: number;
  startedAt: string | null;
  stopRequested: boolean;
  recentClassifications: RecentClassification[];
}

export interface RecentClassification {
  id: string;
  title: string;
  category: string;
  priority: string;
  reason: string;
  classifiedAt: string;
}

export interface EnrichmentProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'stopped' | 'error';
  total?: number;
  processed?: number;
  article?: RecentClassification;
  rate?: number;
  eta?: number;
  error?: string;
}

export interface DashboardStats {
  total: number;
  enriched: number;
  unprocessed: number;
  priorityBreakdown: Array<{ priority: string; count: number }>;
  categoryBreakdown: Array<{ category: string; count: number }>;
  enrichmentState: EnrichmentState;
  recentClassifications: RecentClassification[];
}

// ============================================
// Redis state management
// ============================================

function stateKey(userId: string): string {
  return `news:enrichment:${userId}`;
}

const DEFAULT_STATE: EnrichmentState = {
  running: false,
  total: 0,
  processed: 0,
  startedAt: null,
  stopRequested: false,
  recentClassifications: [],
};

export async function getEnrichmentState(userId: string): Promise<EnrichmentState> {
  try {
    const raw = await redis.get(stateKey(userId));
    if (!raw) return { ...DEFAULT_STATE };
    return JSON.parse(raw) as EnrichmentState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function setEnrichmentState(userId: string, state: EnrichmentState): Promise<void> {
  await redis.set(stateKey(userId), JSON.stringify(state), 'EX', 3600);
}

export async function requestStop(userId: string): Promise<void> {
  const state = await getEnrichmentState(userId);
  state.stopRequested = true;
  await setEnrichmentState(userId, state);
}

// ============================================
// Dashboard stats
// ============================================

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const [totalRow, enrichedRow, priorityRows, categoryRows] = await Promise.all([
    query(
      `SELECT COUNT(*) as count FROM rss_articles
       WHERE published_at >= NOW() - INTERVAL '3 days'`
    ),
    query(
      `SELECT COUNT(*) as count FROM rss_articles
       WHERE enriched_at IS NOT NULL AND published_at >= NOW() - INTERVAL '3 days'`
    ),
    query(
      `SELECT priority, COUNT(*) as count FROM rss_articles
       WHERE enriched_at IS NOT NULL AND published_at >= NOW() - INTERVAL '3 days'
       GROUP BY priority ORDER BY priority`
    ),
    query(
      `SELECT category, COUNT(*) as count FROM rss_articles
       WHERE enriched_at IS NOT NULL AND published_at >= NOW() - INTERVAL '3 days'
       GROUP BY category ORDER BY count DESC`
    ),
  ]);

  const total = parseInt((totalRow as any)[0]?.count || '0');
  const enriched = parseInt((enrichedRow as any)[0]?.count || '0');
  const enrichmentState = await getEnrichmentState(userId);

  return {
    total,
    enriched,
    unprocessed: total - enriched,
    priorityBreakdown: (priorityRows as any[]).map((r: any) => ({
      priority: r.priority,
      count: parseInt(r.count),
    })),
    categoryBreakdown: (categoryRows as any[]).map((r: any) => ({
      category: r.category,
      count: parseInt(r.count),
    })),
    enrichmentState,
    recentClassifications: enrichmentState.recentClassifications,
  };
}

// ============================================
// Batch enrichment with progress (async generator)
// ============================================

export async function* batchEnrichWithProgress(
  userId: string
): AsyncGenerator<EnrichmentProgressEvent> {
  // Get unenriched articles in 3-day window
  const unenriched = await query(
    `SELECT id, title, url, author, newsfetcher_id FROM rss_articles
     WHERE enriched_at IS NULL AND published_at >= NOW() - INTERVAL '3 days'
     ORDER BY published_at DESC`
  );

  const total = unenriched.length;
  if (total === 0) {
    yield { type: 'complete', total: 0, processed: 0 };
    return;
  }

  // Get user interests
  const facts = await factsService.getUserFacts(userId, { limit: 10 });
  const interests = facts
    .filter((f: any) => f.category === 'hobby' || f.category === 'preference')
    .map((f: any) => f.factValue);

  // Set initial state
  const state: EnrichmentState = {
    running: true,
    total,
    processed: 0,
    startedAt: new Date().toISOString(),
    stopRequested: false,
    recentClassifications: [],
  };
  await setEnrichmentState(userId, state);

  yield { type: 'start', total };

  const startTime = Date.now();
  let processed = 0;

  for (const row of unenriched) {
    // Check stop request
    const currentState = await getEnrichmentState(userId);
    if (currentState.stopRequested) {
      state.running = false;
      state.stopRequested = false;
      state.processed = processed;
      await setEnrichmentState(userId, state);
      yield { type: 'stopped', total, processed };
      return;
    }

    const article = row as any;

    try {
      const classification = await filterArticle(
        article.title,
        null,
        interests,
        userId
      );

      await query(
        `UPDATE rss_articles
         SET category = $1, priority = $2, priority_reason = $3, enriched_at = NOW()
         WHERE id = $4`,
        [classification.category, classification.priority, classification.reason, article.id]
      );

      processed++;

      const recentItem: RecentClassification = {
        id: article.id,
        title: article.title,
        category: classification.category,
        priority: classification.priority,
        reason: classification.reason,
        classifiedAt: new Date().toISOString(),
      };

      // Keep last 20 recent classifications
      state.recentClassifications.unshift(recentItem);
      if (state.recentClassifications.length > 20) {
        state.recentClassifications = state.recentClassifications.slice(0, 20);
      }
      state.processed = processed;
      await setEnrichmentState(userId, state);

      // Check alerts
      try {
        const enrichedRow = await query(
          `SELECT id, title, url, author, category, priority, priority_reason
           FROM rss_articles WHERE id = $1`,
          [article.id]
        );
        if (enrichedRow.length > 0) {
          const sent = await checkAndSendAlerts(userId, enrichedRow[0] as any);
          if (sent) {
            await query(
              'UPDATE rss_articles SET notification_sent = true WHERE id = $1',
              [article.id]
            );
          }
        }
      } catch (alertErr) {
        logger.warn('Alert check failed during enrichment', { id: article.id, error: (alertErr as Error).message });
      }

      // Calculate rate and ETA
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / (elapsed / 60); // articles per minute
      const remaining = total - processed;
      const eta = rate > 0 ? Math.ceil(remaining / (rate / 60)) : 0; // seconds

      yield {
        type: 'progress',
        total,
        processed,
        article: recentItem,
        rate: Math.round(rate * 10) / 10,
        eta,
      };

      // Throttle between articles
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.warn('Failed to enrich article', { id: article.id, error: (err as Error).message });
      processed++;
    }
  }

  // Done
  state.running = false;
  state.processed = processed;
  await setEnrichmentState(userId, state);

  yield { type: 'complete', total, processed };
}
