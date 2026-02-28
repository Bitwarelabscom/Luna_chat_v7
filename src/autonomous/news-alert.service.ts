import { query } from '../db/postgres.js';
import { enqueueTrigger } from '../triggers/trigger.service.js';
import logger from '../utils/logger.js';

export interface EnrichedArticle {
  id: number;
  title: string;
  url: string | null;
  source_name: string;
  category: string;
  priority: string;
  priority_reason: string | null;
}

const PRIORITY_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

/**
 * Check if an article meets the user's alert threshold for its category,
 * and send a notification if so.
 */
export async function checkAndSendAlerts(userId: string, article: EnrichedArticle): Promise<boolean> {
  try {
    // Get user threshold for this category
    const thresholds = await query(
      `SELECT min_priority, delivery_method FROM news_alert_thresholds
       WHERE user_id = $1 AND category = $2`,
      [userId, article.category]
    );

    let minPriority = 'P1'; // Default: only P1 alerts
    let deliveryMethod = 'telegram';

    if (thresholds.length > 0) {
      const t = thresholds[0] as any;
      minPriority = t.min_priority;
      deliveryMethod = t.delivery_method;
    }

    // 'off' means no alerts for this category
    if (minPriority === 'off') return false;

    // Check if article priority meets threshold
    const articleRank = PRIORITY_RANK[article.priority] || 4;
    const thresholdRank = PRIORITY_RANK[minPriority] || 1;

    if (articleRank > thresholdRank) return false;

    // Format alert message
    const priorityEmoji = article.priority === 'P1' ? '[BREAKING]' : article.priority === 'P2' ? '[IMPORTANT]' : '[NEWS]';
    const message = `${priorityEmoji} [${article.priority} ${article.category.toUpperCase()}] ${article.title}\n${article.source_name}${article.url ? `\n${article.url}` : ''}`;

    // Send via configured delivery method
    if (deliveryMethod === 'telegram') {
      await enqueueTrigger({
        userId,
        triggerSource: 'event',
        triggerType: 'news_alert',
        message,
        deliveryMethod: 'telegram',
        payload: {
          articleId: article.id,
          category: article.category,
          priority: article.priority,
        },
      });
    }

    logger.info('News alert sent', {
      userId,
      articleId: article.id,
      category: article.category,
      priority: article.priority,
      deliveryMethod,
    });

    return true;
  } catch (error) {
    logger.error('Failed to check/send alert', { userId, articleId: article.id, error });
    return false;
  }
}

/**
 * Get all alert thresholds for a user
 */
export async function getThresholds(userId: string): Promise<Array<{ category: string; minPriority: string; deliveryMethod: string }>> {
  const rows = await query(
    `SELECT category, min_priority, delivery_method FROM news_alert_thresholds WHERE user_id = $1 ORDER BY category`,
    [userId]
  );
  return rows.map((r: any) => ({
    category: r.category,
    minPriority: r.min_priority,
    deliveryMethod: r.delivery_method,
  }));
}

/**
 * Set alert thresholds for a user (upsert)
 */
export async function setThresholds(
  userId: string,
  thresholds: Array<{ category: string; minPriority: string; deliveryMethod?: string }>
): Promise<void> {
  for (const t of thresholds) {
    await query(
      `INSERT INTO news_alert_thresholds (user_id, category, min_priority, delivery_method, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, category) DO UPDATE
       SET min_priority = $3, delivery_method = $4, updated_at = NOW()`,
      [userId, t.category, t.minPriority, t.deliveryMethod || 'telegram']
    );
  }
}
