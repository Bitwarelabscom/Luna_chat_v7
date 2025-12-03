import { pool } from '../db/index.js';
import { validateExternalUrl } from '../utils/url-validator.js';
import { createHash } from 'crypto';
import logger from '../utils/logger.js';
import { createChatCompletion } from '../llm/openai.client.js';

// ============================================
// Types
// ============================================

export interface FetchedPage {
  id: string;
  url: string;
  title: string | null;
  content: string;
  author: string | null;
  publishedDate: Date | null;
  wordCount: number;
  fetchedAt: Date;
  fromCache: boolean;
  metadata: Record<string, unknown> | null;
}

export interface FetchOptions {
  forceRefresh?: boolean;
  timeout?: number;
  maxContentLength?: number;
}

// Default options
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_MAX_CONTENT_LENGTH = 500000; // 500KB
const CACHE_TTL_HOURS = 24;

// Auto-fetch threshold for search results
export const AUTO_FETCH_RELEVANCE_THRESHOLD = 0.7;

// ============================================
// Web Page Fetching
// ============================================

export async function fetchPage(
  url: string,
  options: FetchOptions = {}
): Promise<FetchedPage> {
  const {
    forceRefresh = false,
    timeout = DEFAULT_TIMEOUT,
    maxContentLength = DEFAULT_MAX_CONTENT_LENGTH,
  } = options;

  // Validate URL for SSRF protection
  await validateExternalUrl(url, { allowHttp: true });

  const urlHash = createHash('sha256').update(url).digest('hex');

  // Check cache first (unless forcing refresh)
  if (!forceRefresh) {
    const cached = await getCachedPage(urlHash);
    if (cached) {
      return cached;
    }
  }

  // Fetch the page
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LunaBot/1.0; +https://luna.chat)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    // Check content length
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > maxContentLength) {
      throw new Error(`Content too large: ${contentLength} bytes`);
    }

    const html = await response.text();

    // Extract readable content
    const extracted = extractReadableContent(html);

    // Cache the result
    const page = await cachePage(url, urlHash, extracted);

    logger.info('Web page fetched', {
      url,
      title: extracted.title,
      wordCount: extracted.wordCount,
    });

    return page;
  } catch (error) {
    clearTimeout(timeoutId);

    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }

    throw error;
  }
}

export async function fetchAndSummarize(
  url: string,
  _userId: string,
  prompt?: string
): Promise<{ page: FetchedPage; summary: string }> {
  const page = await fetchPage(url);

  // Truncate content if too long
  const maxContextLength = 8000;
  const content = page.content.length > maxContextLength
    ? page.content.substring(0, maxContextLength) + '...[truncated]'
    : page.content;

  const systemPrompt = `You are an AI assistant summarizing web page content for research purposes.
Provide a concise but comprehensive summary that captures the key information.
Focus on facts, data, and actionable insights.`;

  const userPrompt = prompt
    ? `${prompt}\n\nWeb page content:\n\nTitle: ${page.title || 'Unknown'}\nURL: ${page.url}\n\n${content}`
    : `Summarize this web page:\n\nTitle: ${page.title || 'Unknown'}\nURL: ${page.url}\n\n${content}`;

  const result = await createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 1000,
  });

  const summary = result.content || 'Unable to generate summary.';

  return { page, summary };
}

export async function fetchMultiplePages(
  urls: string[],
  options: FetchOptions & { concurrency?: number } = {}
): Promise<FetchedPage[]> {
  const { concurrency = 3, ...fetchOptions } = options;

  const results: FetchedPage[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(url => fetchPage(url, fetchOptions))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push({
          url: batch[j],
          error: result.reason?.message || 'Unknown error',
        });
      }
    }
  }

  if (errors.length > 0) {
    logger.warn('Some pages failed to fetch', { errors });
  }

  return results;
}

// ============================================
// Cache Management
// ============================================

async function getCachedPage(urlHash: string): Promise<FetchedPage | null> {
  const result = await pool.query(
    `SELECT * FROM web_page_cache
     WHERE url_hash = $1 AND expires_at > NOW()`,
    [urlHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    content: row.content,
    author: row.author,
    publishedDate: row.published_date,
    wordCount: row.word_count,
    fetchedAt: row.extracted_at,
    fromCache: true,
    metadata: row.metadata,
  };
}

async function cachePage(
  url: string,
  urlHash: string,
  extracted: ExtractedContent
): Promise<FetchedPage> {
  const result = await pool.query(
    `INSERT INTO web_page_cache
     (url, url_hash, title, content, word_count, author, published_date, metadata, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '${CACHE_TTL_HOURS} hours')
     ON CONFLICT (url) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       word_count = EXCLUDED.word_count,
       author = EXCLUDED.author,
       published_date = EXCLUDED.published_date,
       metadata = EXCLUDED.metadata,
       extracted_at = NOW(),
       expires_at = NOW() + INTERVAL '${CACHE_TTL_HOURS} hours'
     RETURNING *`,
    [
      url,
      urlHash,
      extracted.title,
      extracted.content,
      extracted.wordCount,
      extracted.author,
      extracted.publishedDate,
      extracted.metadata ? JSON.stringify(extracted.metadata) : null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to cache page');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    content: row.content,
    author: row.author,
    publishedDate: row.published_date,
    wordCount: row.word_count,
    fetchedAt: row.extracted_at,
    fromCache: false,
    metadata: row.metadata,
  };
}

export async function cleanExpiredCache(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM web_page_cache WHERE expires_at < NOW()`,
    []
  );

  const count = result.rowCount ?? 0;

  if (count > 0) {
    logger.info('Cleaned expired web page cache', { count });
  }

  return count;
}

// ============================================
// Content Extraction (Readability-style)
// ============================================

interface ExtractedContent {
  title: string | null;
  content: string;
  author: string | null;
  publishedDate: Date | null;
  wordCount: number;
  metadata: Record<string, unknown> | null;
}

function extractReadableContent(html: string): ExtractedContent {
  // Remove scripts, styles, and other non-content elements
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');

  // Extract title
  const titleMatch = cleaned.match(/<title[^>]*>([^<]*)<\/title>/i);
  const h1Match = cleaned.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  const title = titleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || null;

  // Extract author from meta tags
  const authorMatch = cleaned.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["']/i)
    || cleaned.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']author["']/i);
  const author = authorMatch?.[1]?.trim() || null;

  // Extract published date
  const dateMatch = cleaned.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']*)["']/i)
    || cleaned.match(/<time[^>]*datetime=["']([^"']*)["']/i);
  let publishedDate: Date | null = null;
  if (dateMatch?.[1]) {
    const parsed = new Date(dateMatch[1]);
    if (!isNaN(parsed.getTime())) {
      publishedDate = parsed;
    }
  }

  // Try to find main content area
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const contentDiv = cleaned.match(/<div[^>]*class=["'][^"']*(?:content|article|post|entry)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

  let contentHtml = articleMatch?.[1] || mainMatch?.[1] || contentDiv?.[1] || cleaned;

  // Convert to text
  let content = contentHtml
    // Replace block elements with newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // Calculate word count
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  return {
    title,
    content,
    author,
    publishedDate,
    wordCount,
    metadata: null,
  };
}

// ============================================
// Search Result Auto-Fetch
// ============================================

export interface SearchResultWithContent {
  url: string;
  title: string;
  snippet: string;
  relevanceScore: number;
  fetchedContent?: FetchedPage;
  fetchError?: string;
}

export async function autoFetchHighRelevanceResults(
  searchResults: Array<{ url: string; title: string; snippet: string }>,
  relevanceScores: number[],
  options: FetchOptions = {}
): Promise<SearchResultWithContent[]> {
  const results: SearchResultWithContent[] = [];

  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const score = relevanceScores[i] ?? 0;

    const enhanced: SearchResultWithContent = {
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      relevanceScore: score,
    };

    // Auto-fetch if relevance is high enough
    if (score >= AUTO_FETCH_RELEVANCE_THRESHOLD) {
      try {
        enhanced.fetchedContent = await fetchPage(result.url, options);
      } catch (error) {
        enhanced.fetchError = (error as Error).message;
        logger.warn('Failed to auto-fetch high-relevance result', {
          url: result.url,
          error: enhanced.fetchError,
        });
      }
    }

    results.push(enhanced);
  }

  return results;
}

// ============================================
// Formatting for Context
// ============================================

export function formatPageForContext(page: FetchedPage, maxLength = 4000): string {
  let text = `## ${page.title || 'Untitled Page'}\n`;
  text += `Source: ${page.url}\n`;

  if (page.author) {
    text += `Author: ${page.author}\n`;
  }

  if (page.publishedDate) {
    text += `Published: ${page.publishedDate.toISOString().split('T')[0]}\n`;
  }

  text += `\n${page.content}`;

  // Truncate if too long
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...[truncated]';
  }

  return text;
}

export function formatPagesForContext(pages: FetchedPage[], maxTotalLength = 8000): string {
  if (pages.length === 0) {
    return '';
  }

  const perPageLimit = Math.floor(maxTotalLength / pages.length);
  const formatted = pages.map(p => formatPageForContext(p, perPageLimit));

  return formatted.join('\n\n---\n\n');
}
