import { config } from '../config/index.js';
import { redis } from '../db/redis.js';
import { filterArticle, type FilterResult } from './news-filter.service.js';
import * as factsService from '../memory/facts.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface NewsArticle {
  id: number;
  title: string;
  url: string | null;
  publishedAt: string | null;
  sourceName: string;
  verificationStatus: 'Verified' | 'Likely' | 'Unconfirmed' | 'Conflicted' | 'False/Retraction';
  confidenceScore: number;
  signal: 'low' | 'medium' | 'high' | null;
  signalReason: string | null;
  topics: string[] | null;
  signalConfidence: number | null;
  defaultCategory: string | null;
}

export interface NewsClaim {
  id: number;
  claimText: string;
  verificationStatus: string;
  confidenceScore: number;
  scoreBreakdown: {
    independencePoints: number;
    primaryPoints: number;
    recencyPoints: number;
    consistencyPoints: number;
    trustPoints: number;
    independentSources: number;
    primaryEvidenceCount: number;
  };
  articleTitle: string;
  articleUrl: string | null;
  publishedAt: string | null;
}

interface RawArticle {
  id: number;
  title: string;
  canonical_url: string | null;
  published_at: string | null;
  verification_status: string;
  confidence_score: number;
  source_name: string;
  default_category: string | null;
}

interface RawClaim {
  id: number;
  claim_text: string;
  verification_status: string;
  confidence_score: number;
  score_breakdown: Record<string, number>;
  article_title: string;
  canonical_url: string | null;
  published_at: string | null;
}

// ============================================
// Config
// ============================================

function getBaseUrl(): string {
  return config.newsfetcher?.url || 'http://newsfetcher-app:8000';
}

function isEnabled(): boolean {
  return config.newsfetcher?.enabled !== false;
}

function getCacheTtl(): number {
  return config.newsfetcher?.cacheTtlSeconds || 3600;
}

// ============================================
// HTTP helpers
// ============================================

async function fetchJson<T>(path: string, timeoutMs = 10000): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Newsfetcher ${path} returned ${res.status}: ${await res.text()}`);
    }
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(path: string, _body?: unknown, timeoutMs = 30000): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: _body ? JSON.stringify(_body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Newsfetcher POST ${path} returned ${res.status}: ${await res.text()}`);
    }
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// Redis enrichment cache
// ============================================

function enrichmentKey(articleId: number): string {
  return `news:enrichment:${articleId}`;
}

async function getCachedEnrichment(articleId: number): Promise<FilterResult | null> {
  try {
    const raw = await redis.get(enrichmentKey(articleId));
    if (!raw) return null;
    return JSON.parse(raw) as FilterResult;
  } catch {
    return null;
  }
}

async function setCachedEnrichment(articleId: number, result: FilterResult): Promise<void> {
  try {
    await redis.set(enrichmentKey(articleId), JSON.stringify(result), 'EX', getCacheTtl());
  } catch (err) {
    logger.warn('Failed to cache enrichment', { articleId, error: (err as Error).message });
  }
}

// ============================================
// Public API
// ============================================

export async function getArticles(options: {
  q?: string;
  status?: string;
  minScore?: number;
  limit?: number;
  since?: string;
} = {}): Promise<NewsArticle[]> {
  if (!isEnabled()) return [];

  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (options.status) params.set('status', options.status);
  if (options.minScore) params.set('min_score', options.minScore.toString());
  if (options.since) params.set('since', options.since);
  params.set('limit', (options.limit || 2000).toString());

  const query = params.toString();
  const raw = await fetchJson<RawArticle[]>(`/articles?${query}`);

  // Attach cached AI enrichments
  const articles: NewsArticle[] = await Promise.all(
    raw.map(async (r) => {
      const enrichment = await getCachedEnrichment(r.id);
      return {
        id: r.id,
        title: r.title,
        url: r.canonical_url,
        publishedAt: r.published_at,
        sourceName: r.source_name,
        verificationStatus: r.verification_status as NewsArticle['verificationStatus'],
        confidenceScore: r.confidence_score,
        signal: enrichment ? (enrichment.priority === 'P1' ? 'high' : enrichment.priority === 'P2' ? 'medium' : 'low') : null,
        signalReason: enrichment?.reason || null,
        topics: enrichment?.topics || null,
        signalConfidence: enrichment?.confidence || null,
        defaultCategory: r.default_category || null,
      };
    })
  );

  return articles;
}

export async function getClaims(options: {
  status?: string;
  minScore?: number;
  limit?: number;
} = {}): Promise<NewsClaim[]> {
  if (!isEnabled()) return [];

  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.minScore) params.set('min_score', options.minScore.toString());
  params.set('limit', (options.limit || 50).toString());

  const query = params.toString();
  const raw = await fetchJson<RawClaim[]>(`/claims?${query}`);

  return raw.map((r) => ({
    id: r.id,
    claimText: r.claim_text,
    verificationStatus: r.verification_status,
    confidenceScore: r.confidence_score,
    scoreBreakdown: {
      independencePoints: r.score_breakdown?.independence_points ?? 0,
      primaryPoints: r.score_breakdown?.primary_points ?? 0,
      recencyPoints: r.score_breakdown?.recency_points ?? 0,
      consistencyPoints: r.score_breakdown?.consistency_points ?? 0,
      trustPoints: r.score_breakdown?.trust_points ?? 0,
      independentSources: r.score_breakdown?.independent_sources ?? 0,
      primaryEvidenceCount: r.score_breakdown?.primary_evidence_count ?? 0,
    },
    articleTitle: r.article_title,
    articleUrl: r.canonical_url,
    publishedAt: r.published_at,
  }));
}

export async function triggerIngestion(): Promise<{ ingested: number }> {
  if (!isEnabled()) return { ingested: 0 };

  const result = await postJson<Record<string, number>>('/ingest/run');
  return { ingested: Object.values(result).reduce((a, b) => a + b, 0) };
}

export async function healthCheck(): Promise<{ healthy: boolean; status?: string }> {
  try {
    const result = await fetchJson<{ status: string }>('/health', 5000);
    return { healthy: result.status === 'ok', status: result.status };
  } catch (err) {
    return { healthy: false, status: (err as Error).message };
  }
}

export async function enrichArticleById(articleId: number, userId: string): Promise<NewsArticle | null> {
  if (!isEnabled()) return null;

  // Fetch this specific article
  const articles = await getArticles({ limit: 200 });
  const article = articles.find(a => a.id === articleId);
  if (!article) return null;

  // Get user interests for personalized filtering
  const facts = await factsService.getUserFacts(userId, { limit: 10 });
  const interests = facts
    .filter(f => f.category === 'hobby' || f.category === 'preference')
    .map(f => f.factValue);

  // Run Qwen filter
  const result = await filterArticle(article.title, null, interests, userId);

  // Cache in Redis
  await setCachedEnrichment(articleId, result);

  return {
    ...article,
    signal: result.priority === 'P1' ? 'high' : result.priority === 'P2' ? 'medium' : 'low',
    signalReason: result.reason,
    topics: result.topics,
    signalConfidence: result.confidence,
  };
}

export async function batchEnrichArticles(userId: string, limit = 25): Promise<number> {
  if (!isEnabled()) return 0;

  // Fetch recent articles
  const articles = await getArticles({ limit });

  // Get user interests
  const facts = await factsService.getUserFacts(userId, { limit: 10 });
  const interests = facts
    .filter(f => f.category === 'hobby' || f.category === 'preference')
    .map(f => f.factValue);

  let enrichedCount = 0;

  for (const article of articles) {
    // Skip already enriched
    if (article.signal !== null) continue;

    try {
      const result = await filterArticle(article.title, null, interests, userId);
      await setCachedEnrichment(article.id, result);
      enrichedCount++;

      // Rate limit - 500ms between calls to not overload Ollama
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      logger.warn('Failed to enrich article', { articleId: article.id, error: (err as Error).message });
    }
  }

  logger.info('Batch enrichment completed', { enrichedCount, total: articles.length, userId });
  return enrichedCount;
}

export async function getInterestingArticles(limit = 10): Promise<NewsArticle[]> {
  if (!isEnabled()) return [];

  // Get articles with high confidence scores (Verified/Likely tend to have higher scores)
  const articles = await getArticles({ minScore: 50, limit: limit * 3 });

  // Filter to high-signal enriched articles or high-confidence verified ones
  const interesting = articles.filter(a => {
    // Include if AI enrichment says high/medium signal
    if (a.signal === 'high' || a.signal === 'medium') return true;
    // Include if verification status is strong
    if (a.verificationStatus === 'Verified' || a.verificationStatus === 'Likely') return true;
    // Include if confidence score is high
    if (a.confidenceScore >= 70) return true;
    return false;
  });

  return interesting.slice(0, limit);
}
