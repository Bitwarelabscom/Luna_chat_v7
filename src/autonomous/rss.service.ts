import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as factsService from '../memory/facts.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface RssFeed {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  category: string | null;
  isActive: boolean;
  lastChecked: Date | null;
  lastError: string | null;
  errorCount: number;
  createdAt: Date;
}

export interface RssArticle {
  id: string;
  feedId: string;
  userId: string;
  externalId: string | null;
  title: string;
  url: string | null;
  summary: string | null;
  content: string | null;
  author: string | null;
  publishedAt: Date | null;
  isRead: boolean;
  isInteresting: boolean;
  lunaSummary: string | null;
  relevanceScore: number;
  relevanceReason: string | null;
  sharedWithUser: boolean;
  fetchedAt: Date;
}

export interface CreateFeedInput {
  url: string;
  title?: string;
  category?: string;
}

// ============================================
// Default RSS Feeds
// ============================================

const DEFAULT_FEEDS = [
  { url: 'https://hnrss.org/frontpage', title: 'Hacker News', category: 'tech' },
  { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', title: 'Ars Technica', category: 'tech' },
  { url: 'https://www.sciencedaily.com/rss/all.xml', title: 'Science Daily', category: 'science' },
  { url: 'https://www.nature.com/nature.rss', title: 'Nature', category: 'science' },
];

// ============================================
// Feed Management
// ============================================

export async function createFeed(userId: string, input: CreateFeedInput): Promise<RssFeed> {
  const result = await pool.query(
    `INSERT INTO rss_feeds (user_id, url, title, category)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url) DO UPDATE SET
       title = COALESCE($3, rss_feeds.title),
       category = COALESCE($4, rss_feeds.category),
       is_active = true
     RETURNING *`,
    [userId, input.url, input.title || null, input.category || null]
  );

  logger.info('RSS feed created/updated', { userId, url: input.url });

  return mapFeedRow(result.rows[0]);
}

export async function getFeed(feedId: string, userId: string): Promise<RssFeed | null> {
  const result = await pool.query(
    `SELECT * FROM rss_feeds WHERE id = $1 AND user_id = $2`,
    [feedId, userId]
  );

  return result.rows.length > 0 ? mapFeedRow(result.rows[0]) : null;
}

export async function getFeeds(userId: string, activeOnly = true): Promise<RssFeed[]> {
  const condition = activeOnly ? 'AND is_active = true' : '';
  const result = await pool.query(
    `SELECT * FROM rss_feeds WHERE user_id = $1 ${condition} ORDER BY created_at`,
    [userId]
  );

  return result.rows.map(mapFeedRow);
}

export async function deleteFeed(feedId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM rss_feeds WHERE id = $1 AND user_id = $2`,
    [feedId, userId]
  );

  return result.rowCount !== null && result.rowCount > 0;
}

export async function toggleFeed(feedId: string, userId: string, isActive: boolean): Promise<RssFeed | null> {
  const result = await pool.query(
    `UPDATE rss_feeds SET is_active = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [isActive, feedId, userId]
  );

  return result.rows.length > 0 ? mapFeedRow(result.rows[0]) : null;
}

export async function addDefaultFeeds(userId: string): Promise<RssFeed[]> {
  const feeds: RssFeed[] = [];

  for (const feed of DEFAULT_FEEDS) {
    const created = await createFeed(userId, feed);
    feeds.push(created);
  }

  return feeds;
}

// ============================================
// Article Management
// ============================================

export async function getArticles(
  userId: string,
  options: {
    feedId?: string;
    isInteresting?: boolean;
    sharedWithUser?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<RssArticle[]> {
  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (options.feedId) {
    conditions.push(`feed_id = $${paramIndex++}`);
    params.push(options.feedId);
  }

  if (options.isInteresting !== undefined) {
    conditions.push(`is_interesting = $${paramIndex++}`);
    params.push(options.isInteresting);
  }

  if (options.sharedWithUser !== undefined) {
    conditions.push(`shared_with_user = $${paramIndex++}`);
    params.push(options.sharedWithUser);
  }

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const result = await pool.query(
    `SELECT * FROM rss_articles
     WHERE ${conditions.join(' AND ')}
     ORDER BY published_at DESC NULLS LAST, fetched_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows.map(mapArticleRow);
}

export async function getInterestingArticles(userId: string, limit = 10): Promise<RssArticle[]> {
  return getArticles(userId, { isInteresting: true, sharedWithUser: false, limit });
}

export async function markArticleShared(articleId: string, userId: string): Promise<RssArticle | null> {
  const result = await pool.query(
    `UPDATE rss_articles SET shared_with_user = true WHERE id = $1 AND user_id = $2 RETURNING *`,
    [articleId, userId]
  );

  return result.rows.length > 0 ? mapArticleRow(result.rows[0]) : null;
}

export async function markArticleRead(articleId: string, userId: string): Promise<RssArticle | null> {
  const result = await pool.query(
    `UPDATE rss_articles SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *`,
    [articleId, userId]
  );

  return result.rows.length > 0 ? mapArticleRow(result.rows[0]) : null;
}

// ============================================
// RSS Fetching
// ============================================

export async function fetchAllFeeds(userId: string): Promise<number> {
  const feeds = await getFeeds(userId, true);
  let articlesAdded = 0;

  for (const feed of feeds) {
    try {
      const count = await fetchFeed(feed, userId);
      articlesAdded += count;
    } catch (error) {
      logger.error('Error fetching feed', { feedId: feed.id, url: feed.url, error });

      // Update error count
      await pool.query(
        `UPDATE rss_feeds SET last_error = $1, error_count = error_count + 1 WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', feed.id]
      );
    }
  }

  return articlesAdded;
}

async function fetchFeed(feed: RssFeed, userId: string): Promise<number> {
  // Fetch RSS feed using a simple fetch
  // Using SearXNG proxy or direct fetch based on SSRF protection
  const response = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Luna-RSS-Reader/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  const articles = parseRssFeed(xml, feed.id, userId);

  // Update feed last checked
  await pool.query(
    `UPDATE rss_feeds
     SET last_checked = NOW(), last_error = NULL, error_count = 0,
         title = COALESCE(title, $1)
     WHERE id = $2`,
    [extractFeedTitle(xml) || feed.title, feed.id]
  );

  // Insert new articles
  let addedCount = 0;
  for (const article of articles) {
    try {
      await pool.query(
        `INSERT INTO rss_articles (feed_id, user_id, external_id, title, url, summary, content, author, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (feed_id, external_id) DO NOTHING`,
        [
          article.feedId,
          article.userId,
          article.externalId,
          article.title,
          article.url,
          article.summary,
          article.content,
          article.author,
          article.publishedAt,
        ]
      );
      addedCount++;
    } catch {
      // Skip duplicates silently
    }
  }

  logger.info('Feed fetched', { feedId: feed.id, articlesFound: articles.length, articlesAdded: addedCount });

  return addedCount;
}

function parseRssFeed(xml: string, feedId: string, userId: string): Partial<RssArticle>[] {
  const articles: Partial<RssArticle>[] = [];

  // Simple regex-based RSS parsing (more robust parsing would use a proper XML parser)
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid');
    const description = extractTag(itemXml, 'description') || extractTag(itemXml, 'summary');
    const content = extractTag(itemXml, 'content:encoded') || extractTag(itemXml, 'content');
    const author = extractTag(itemXml, 'author') || extractTag(itemXml, 'dc:creator');
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'published');
    const guid = extractTag(itemXml, 'guid') || link;

    if (title) {
      articles.push({
        feedId,
        userId,
        externalId: guid ? hashString(guid) : null,
        title: decodeHtmlEntities(title),
        url: link || null,
        summary: description ? decodeHtmlEntities(stripHtml(description)).slice(0, 1000) : null,
        content: content ? decodeHtmlEntities(stripHtml(content)) : null,
        author: author ? decodeHtmlEntities(author) : null,
        publishedAt: pubDate ? new Date(pubDate) : null,
      });
    }
  }

  // Also try Atom format
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];

    const title = extractTag(entryXml, 'title');
    const link = extractAtomLink(entryXml);
    const summary = extractTag(entryXml, 'summary') || extractTag(entryXml, 'content');
    const author = extractTag(entryXml, 'name'); // Inside <author>
    const updated = extractTag(entryXml, 'updated') || extractTag(entryXml, 'published');
    const id = extractTag(entryXml, 'id') || link;

    if (title) {
      articles.push({
        feedId,
        userId,
        externalId: id ? hashString(id) : null,
        title: decodeHtmlEntities(title),
        url: link || null,
        summary: summary ? decodeHtmlEntities(stripHtml(summary)).slice(0, 1000) : null,
        author: author ? decodeHtmlEntities(author) : null,
        publishedAt: updated ? new Date(updated) : null,
      });
    }
  }

  return articles.slice(0, 50); // Limit to 50 articles per fetch
}

function extractTag(xml: string, tagName: string): string | null {
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  // Handle regular content
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function extractAtomLink(xml: string): string | null {
  const linkRegex = /<link[^>]*href=["']([^"']+)["'][^>]*>/i;
  const match = linkRegex.exec(xml);
  return match ? match[1] : null;
}

function extractFeedTitle(xml: string): string | null {
  // Try to get feed title from channel or feed element
  const channelMatch = /<channel[^>]*>([\s\S]*?)<item/i.exec(xml);
  if (channelMatch) {
    return extractTag(channelMatch[1], 'title');
  }

  const feedMatch = /<feed[^>]*>([\s\S]*?)<entry/i.exec(xml);
  if (feedMatch) {
    return extractTag(feedMatch[1], 'title');
  }

  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ============================================
// Relevance Analysis
// ============================================

export async function analyzeArticleRelevance(userId: string, articleId: string): Promise<RssArticle | null> {
  const result = await pool.query(
    `SELECT * FROM rss_articles WHERE id = $1 AND user_id = $2`,
    [articleId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const article = mapArticleRow(result.rows[0]);

  // Get user interests from facts
  const facts = await factsService.getUserFacts(userId, { limit: 20 });
  const interests = facts
    .filter(f => f.category === 'hobby' || f.category === 'preference')
    .map(f => f.factValue)
    .join(', ');

  // Get user's model config
  const { provider, model } = await getUserModelConfig(userId, 'main_chat');

  // Analyze relevance
  const messages = [
    {
      role: 'system' as const,
      content: `You are analyzing article relevance for a user. Rate the relevance from 0 to 1 and explain why.
User interests: ${interests || 'Unknown'}

Respond in JSON format: {"score": 0.0-1.0, "reason": "brief explanation", "summary": "1-2 sentence summary of the article"}`,
    },
    {
      role: 'user' as const,
      content: `Article title: ${article.title}
Summary: ${article.summary || 'No summary available'}`,
    },
  ];

  try {
    const response = await createCompletion(provider, model, messages, {
      temperature: 0.3,
      maxTokens: 300,
    });

    // Parse JSON response
    const analysis = JSON.parse(response.content);

    // Update article
    await pool.query(
      `UPDATE rss_articles
       SET relevance_score = $1, relevance_reason = $2, luna_summary = $3, is_interesting = $4
       WHERE id = $5`,
      [
        analysis.score,
        analysis.reason,
        analysis.summary,
        analysis.score >= 0.6,
        articleId,
      ]
    );

    return {
      ...article,
      relevanceScore: analysis.score,
      relevanceReason: analysis.reason,
      lunaSummary: analysis.summary,
      isInteresting: analysis.score >= 0.6,
    };
  } catch (error) {
    logger.error('Error analyzing article relevance', { articleId, error });
    return article;
  }
}

export async function analyzeRecentArticles(userId: string, limit = 20): Promise<number> {
  // Get unanalyzed articles
  const result = await pool.query(
    `SELECT id FROM rss_articles
     WHERE user_id = $1 AND relevance_score = 0 AND fetched_at > NOW() - INTERVAL '7 days'
     ORDER BY fetched_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  let analyzed = 0;
  for (const row of result.rows) {
    await analyzeArticleRelevance(userId, row.id);
    analyzed++;

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return analyzed;
}

// ============================================
// Helpers
// ============================================

function mapFeedRow(row: Record<string, unknown>): RssFeed {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    url: row.url as string,
    title: row.title as string | null,
    category: row.category as string | null,
    isActive: row.is_active as boolean,
    lastChecked: row.last_checked ? new Date(row.last_checked as string) : null,
    lastError: row.last_error as string | null,
    errorCount: row.error_count as number,
    createdAt: new Date(row.created_at as string),
  };
}

function mapArticleRow(row: Record<string, unknown>): RssArticle {
  return {
    id: row.id as string,
    feedId: row.feed_id as string,
    userId: row.user_id as string,
    externalId: row.external_id as string | null,
    title: row.title as string,
    url: row.url as string | null,
    summary: row.summary as string | null,
    content: row.content as string | null,
    author: row.author as string | null,
    publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    isRead: row.is_read as boolean,
    isInteresting: row.is_interesting as boolean,
    lunaSummary: row.luna_summary as string | null,
    relevanceScore: row.relevance_score as number,
    relevanceReason: row.relevance_reason as string | null,
    sharedWithUser: row.shared_with_user as boolean,
    fetchedAt: new Date(row.fetched_at as string),
  };
}
