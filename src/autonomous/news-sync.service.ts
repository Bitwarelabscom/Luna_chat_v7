import { query } from '../db/postgres.js';
import * as newsfetcherService from './newsfetcher.service.js';
import { filterArticle, type NewsCategory } from './news-filter.service.js';
import { checkAndSendAlerts } from './news-alert.service.js';
import * as factsService from '../memory/facts.service.js';
import logger from '../utils/logger.js';

export interface SyncResult {
  synced: number;
  enriched: number;
  alerts: number;
}

export async function syncAndEnrichNews(userId: string): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, enriched: 0, alerts: 0 };

  try {
    // 1. Pull articles from newsfetcher
    const articles = await newsfetcherService.getArticles({ limit: 100 });

    // 2. Sync to local rss_articles
    for (const article of articles) {
      try {
        const existing = await query(
          'SELECT id FROM rss_articles WHERE newsfetcher_id = $1',
          [article.id]
        );
        if (existing.length > 0) continue;

        await query(
          `INSERT INTO rss_articles (title, url, source_name, published_at, source_type, newsfetcher_id, created_at)
           VALUES ($1, $2, $3, $4, 'newsfetcher', $5, NOW())
           ON CONFLICT DO NOTHING`,
          [
            article.title,
            article.url,
            article.sourceName,
            article.publishedAt,
            article.id
          ]
        );
        result.synced++;
      } catch (err) {
        logger.warn('Failed to sync article', { articleId: article.id, error: (err as Error).message });
      }
    }

    // 3. Enrich un-enriched articles
    const unenriched = await query(
      `SELECT id, title, url, source_name, newsfetcher_id FROM rss_articles
       WHERE enriched_at IS NULL AND source_type = 'newsfetcher'
       ORDER BY created_at DESC LIMIT 50`
    );

    if (unenriched.length > 0) {
      // Get user interests for personalized filtering
      const facts = await factsService.getUserFacts(userId, { limit: 10 });
      const interests = facts
        .filter((f: any) => f.category === 'hobby' || f.category === 'preference')
        .map((f: any) => f.factValue);

      for (const row of unenriched) {
        try {
          // Find matching newsfetcher article for default_category hint
          const nfArticle = articles.find(a => a.id === (row as any).newsfetcher_id);
          const defaultCategory = nfArticle?.defaultCategory || undefined;

          const classification = await filterArticle(
            (row as any).title,
            null,
            interests,
            userId,
            defaultCategory
          );

          await query(
            `UPDATE rss_articles
             SET category = $1, priority = $2, priority_reason = $3,
                 enriched_at = NOW()
             WHERE id = $4`,
            [classification.category, classification.priority, classification.reason, (row as any).id]
          );
          result.enriched++;

          // Rate limit
          await new Promise(r => setTimeout(r, 400));
        } catch (err) {
          logger.warn('Failed to enrich article', { id: (row as any).id, error: (err as Error).message });
        }
      }
    }

    // 4. Check alerts for newly enriched articles
    const unnotified = await query(
      `SELECT id, title, url, source_name, category, priority, priority_reason
       FROM rss_articles
       WHERE notification_sent = false AND enriched_at IS NOT NULL AND category IS NOT NULL
       ORDER BY enriched_at DESC LIMIT 50`
    );

    for (const article of unnotified) {
      try {
        const sent = await checkAndSendAlerts(userId, article as any);
        if (sent) result.alerts++;
        // Mark as processed regardless
        await query(
          'UPDATE rss_articles SET notification_sent = true WHERE id = $1',
          [(article as any).id]
        );
      } catch (err) {
        logger.warn('Failed to check alerts', { id: (article as any).id, error: (err as Error).message });
      }
    }

    logger.info('News sync complete', { ...result, userId });
  } catch (error) {
    logger.error('News sync failed', { error, userId });
  }

  return result;
}

// Re-export NewsCategory for convenience
export type { NewsCategory };
