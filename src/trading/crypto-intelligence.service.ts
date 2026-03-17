import { pool } from '../db/index.js';
import redis from '../db/redis.js';
import logger from '../utils/logger.js';

// ============================================================
// Types
// ============================================================

export interface CryptoNewsItem {
  source: string;
  title: string;
  description: string;
  url?: string;
}

export interface FearGreedResult {
  value: number;
  classification: string;
  timestamp?: string;
}

export interface SocialSentimentItem {
  title: string;
  score: number;
  numComments: number;
  url: string;
}

export interface FundingRateItem {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

export interface IntelligencePacket {
  news: CryptoNewsItem[];
  fearGreed: FearGreedResult | null;
  socialSentiment: SocialSentimentItem[];
  fundingRates: FundingRateItem[];
  orderbookImbalances: unknown[];
  liquidations: unknown[];
  lastScrapeAt: string | null;
}

// ============================================================
// Redis Keys + TTLs
// ============================================================

const REDIS_KEYS = {
  news: 'trading:intel:news',
  social: 'trading:intel:social',
  fearGreed: 'trading:intel:fear_greed',
  funding: 'trading:intel:funding',
  orderbook: 'trading:intel:orderbook',
  liquidations: 'trading:intel:liquidations',
  lastScrape: 'trading:intel:last_scrape',
  breakingNews: 'trading:intel:breaking_news',
} as const;

const TTL = {
  news: 43200,        // 12h
  social: 21600,      // 6h
  fearGreed: 3600,    // 1h
  funding: 3600,      // 1h
  orderbook: 1800,    // 30min
  liquidations: 3600, // 1h
  lastScrape: 86400,  // 24h
  breakingNews: 3600, // 1h
} as const;

// ============================================================
// RSS Parse Helper
// ============================================================

function parseRssItems(text: string, source: string, maxItems: number): CryptoNewsItem[] {
  const items: CryptoNewsItem[] = [];

  // Try CDATA-wrapped pattern first
  const cdataPattern = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<description><!\[CDATA\[(.*?)\]\]><\/description>/g;
  let m = cdataPattern.exec(text);
  while (m !== null && items.length < maxItems) {
    items.push({
      source,
      title: m[1].trim(),
      description: m[2].replace(/<[^>]*>/g, '').trim().slice(0, 500),
    });
    m = cdataPattern.exec(text);
  }

  // Fallback: plain tags
  if (items.length === 0) {
    const plainPattern = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<description>(.*?)<\/description>/g;
    let pm = plainPattern.exec(text);
    while (pm !== null && items.length < maxItems) {
      items.push({
        source,
        title: pm[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        description: pm[2].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 500),
      });
      pm = plainPattern.exec(text);
    }
  }

  return items;
}

// ============================================================
// Scrapers
// ============================================================

export async function scrapeCryptoNews(): Promise<CryptoNewsItem[]> {
  const allItems: CryptoNewsItem[] = [];

  const sources = [
    { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  ];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Luna-CryptoIntelBot/1.0' },
      });
      if (!response.ok) {
        logger.warn(`Crypto news scrape failed: ${source.name}`, { status: response.status });
        continue;
      }
      const text = await response.text();
      const items = parseRssItems(text, source.name, 15);
      allItems.push(...items);
    } catch (err) {
      logger.warn(`Crypto news scrape error: ${source.name}`, { error: (err as Error).message });
    }
  }

  return allItems;
}

export async function scrapeFearGreedIndex(): Promise<FearGreedResult | null> {
  try {
    const response = await fetch('https://api.alternative.me/fng/', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Luna-CryptoIntelBot/1.0' },
    });
    if (!response.ok) {
      logger.warn('Fear & Greed fetch failed', { status: response.status });
      return null;
    }
    const json = await response.json() as {
      data?: Array<{ value: string; value_classification: string; timestamp: string }>;
    };
    const entry = json.data?.[0];
    if (!entry) return null;
    return {
      value: parseInt(entry.value, 10),
      classification: entry.value_classification,
      timestamp: entry.timestamp,
    };
  } catch (err) {
    logger.warn('Fear & Greed scrape failed', { error: (err as Error).message });
    return null;
  }
}

export async function scrapeSocialSentiment(): Promise<SocialSentimentItem[]> {
  const items: SocialSentimentItem[] = [];
  try {
    const response = await fetch('https://www.reddit.com/r/cryptocurrency/hot.json?limit=20', {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Luna-CryptoIntelBot/1.0',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      logger.warn('Reddit social sentiment fetch failed', { status: response.status });
      return items;
    }
    const json = await response.json() as {
      data?: {
        children?: Array<{
          data: {
            title: string;
            score: number;
            num_comments: number;
            permalink: string;
          };
        }>;
      };
    };
    const children = json.data?.children ?? [];
    for (const child of children) {
      const post = child.data;
      items.push({
        title: post.title,
        score: post.score,
        numComments: post.num_comments,
        url: `https://reddit.com${post.permalink}`,
      });
    }
  } catch (err) {
    logger.warn('Reddit social sentiment scrape failed', { error: (err as Error).message });
  }
  return items;
}

export async function scrapeFundingRates(): Promise<FundingRateItem[]> {
  const items: FundingRateItem[] = [];
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?limit=20', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Luna-CryptoIntelBot/1.0' },
    });
    if (!response.ok) {
      logger.warn('Binance funding rates fetch failed', { status: response.status });
      return items;
    }
    const json = await response.json() as Array<{
      symbol: string;
      fundingRate: string;
      fundingTime: number;
    }>;
    for (const entry of json) {
      items.push({
        symbol: entry.symbol,
        fundingRate: entry.fundingRate,
        fundingTime: entry.fundingTime,
      });
    }
  } catch (err) {
    logger.warn('Binance funding rates scrape failed', { error: (err as Error).message });
  }
  return items;
}

// Placeholder -- will use existing exchange client later
export async function scrapeOrderbookImbalances(): Promise<unknown[]> {
  return [];
}

// Placeholder
export async function detectLiquidations(): Promise<unknown[]> {
  return [];
}

// ============================================================
// Breaking News Detection
// ============================================================

const BREAKING_KEYWORDS = [
  'hack',
  'sec',
  'ban',
  'crash',
  'pump',
  'exploit',
  'regulation',
  'emergency',
  'blackrock',
  'etf',
  'lawsuit',
];

export async function detectBreakingNewsKeywords(headlines: string[]): Promise<void> {
  for (const headline of headlines) {
    const lower = headline.toLowerCase();
    const matched = BREAKING_KEYWORDS.find(kw => lower.includes(kw));
    if (matched) {
      try {
        await redis.setex(
          REDIS_KEYS.breakingNews,
          TTL.breakingNews,
          JSON.stringify({ headline, keyword: matched, detectedAt: new Date().toISOString() }),
        );
        logger.info('Breaking crypto news keyword detected', {
          keyword: matched,
          headline: headline.slice(0, 120),
        });
      } catch (err) {
        logger.warn('Failed to store breaking news in Redis', { error: (err as Error).message });
      }
      // Only store the first match
      break;
    }
  }
}

// ============================================================
// Full Scrape Orchestration
// ============================================================

export async function runFullScrape(): Promise<void> {
  logger.info('Starting crypto intelligence full scrape');

  const [
    newsResult,
    fearGreedResult,
    socialResult,
    fundingResult,
    orderbookResult,
    liquidationsResult,
  ] = await Promise.allSettled([
    scrapeCryptoNews(),
    scrapeFearGreedIndex(),
    scrapeSocialSentiment(),
    scrapeFundingRates(),
    scrapeOrderbookImbalances(),
    detectLiquidations(),
  ]);

  const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
  const fearGreed = fearGreedResult.status === 'fulfilled' ? fearGreedResult.value : null;
  const social = socialResult.status === 'fulfilled' ? socialResult.value : [];
  const funding = fundingResult.status === 'fulfilled' ? fundingResult.value : [];
  const orderbook = orderbookResult.status === 'fulfilled' ? orderbookResult.value : [];
  const liquidations = liquidationsResult.status === 'fulfilled' ? liquidationsResult.value : [];

  logger.info('Crypto intelligence scrape results', {
    news: news.length,
    fearGreed: fearGreed ? `${fearGreed.value} (${fearGreed.classification})` : 'failed',
    social: social.length,
    funding: funding.length,
    orderbook: orderbook.length,
    liquidations: liquidations.length,
  });

  // Store each result to Redis -- errors per key are isolated
  const storeOps: Promise<unknown>[] = [];

  if (news.length > 0) {
    storeOps.push(
      redis.setex(REDIS_KEYS.news, TTL.news, JSON.stringify(news)).catch(err =>
        logger.warn('Failed to store news in Redis', { error: (err as Error).message }),
      ),
    );
    storeOps.push(detectBreakingNewsKeywords(news.map(n => n.title)));
  }

  if (fearGreed !== null) {
    storeOps.push(
      redis.setex(REDIS_KEYS.fearGreed, TTL.fearGreed, JSON.stringify(fearGreed)).catch(err =>
        logger.warn('Failed to store fear/greed in Redis', { error: (err as Error).message }),
      ),
    );
  }

  if (social.length > 0) {
    storeOps.push(
      redis.setex(REDIS_KEYS.social, TTL.social, JSON.stringify(social)).catch(err =>
        logger.warn('Failed to store social sentiment in Redis', { error: (err as Error).message }),
      ),
    );
  }

  if (funding.length > 0) {
    storeOps.push(
      redis.setex(REDIS_KEYS.funding, TTL.funding, JSON.stringify(funding)).catch(err =>
        logger.warn('Failed to store funding rates in Redis', { error: (err as Error).message }),
      ),
    );
  }

  storeOps.push(
    redis.setex(REDIS_KEYS.orderbook, TTL.orderbook, JSON.stringify(orderbook)).catch(err =>
      logger.warn('Failed to store orderbook in Redis', { error: (err as Error).message }),
    ),
  );

  storeOps.push(
    redis.setex(REDIS_KEYS.liquidations, TTL.liquidations, JSON.stringify(liquidations)).catch(err =>
      logger.warn('Failed to store liquidations in Redis', { error: (err as Error).message }),
    ),
  );

  const now = new Date().toISOString();
  storeOps.push(
    redis.setex(REDIS_KEYS.lastScrape, TTL.lastScrape, now).catch(err =>
      logger.warn('Failed to store last scrape timestamp in Redis', { error: (err as Error).message }),
    ),
  );

  await Promise.allSettled(storeOps);

  // Log scrape summary to PostgreSQL
  try {
    await pool.query(
      `INSERT INTO trading_intelligence_log (source, category, title, summary, raw_data, scraped_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'scraper',
        'full_scrape',
        'Intelligence scrape summary',
        `News: ${news.length}, Fear/Greed: ${fearGreed?.value ?? 'N/A'} (${fearGreed?.classification ?? 'N/A'}), Social: ${social.length}, Funding: ${funding.length}`,
        JSON.stringify({ newsCount: news.length, fearGreed, socialCount: social.length, fundingCount: funding.length, orderbookCount: orderbook.length, liquidationsCount: liquidations.length }),
        now,
      ],
    );
  } catch (err) {
    logger.warn('Failed to log scrape to trading_intelligence_log', { error: (err as Error).message });
  }

  logger.info('Crypto intelligence full scrape complete', { lastScrapeAt: now });
}

// ============================================================
// Intelligence Packet Assembly
// ============================================================

export async function getIntelligencePacket(): Promise<IntelligencePacket> {
  const keyList = [
    REDIS_KEYS.news,
    REDIS_KEYS.fearGreed,
    REDIS_KEYS.social,
    REDIS_KEYS.funding,
    REDIS_KEYS.orderbook,
    REDIS_KEYS.liquidations,
    REDIS_KEYS.lastScrape,
  ] as const;

  const results = await Promise.all(
    Array.from(keyList).map(k => redis.get(k).catch(() => null)),
  );

  const [
    newsRaw,
    fearGreedRaw,
    socialRaw,
    fundingRaw,
    orderbookRaw,
    liquidationsRaw,
    lastScrapeRaw,
  ] = results;

  const parseJson = <T>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  return {
    news: parseJson<CryptoNewsItem[]>(newsRaw, []),
    fearGreed: parseJson<FearGreedResult | null>(fearGreedRaw, null),
    socialSentiment: parseJson<SocialSentimentItem[]>(socialRaw, []),
    fundingRates: parseJson<FundingRateItem[]>(fundingRaw, []),
    orderbookImbalances: parseJson<unknown[]>(orderbookRaw, []),
    liquidations: parseJson<unknown[]>(liquidationsRaw, []),
    lastScrapeAt: lastScrapeRaw,
  };
}
