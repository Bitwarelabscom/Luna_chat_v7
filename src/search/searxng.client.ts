import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { SearchResult } from '../types/index.js';

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  score?: number;
}

interface SearXNGResponse {
  query: string;
  results: SearXNGResult[];
  number_of_results: number;
}

export async function search(query: string, options?: {
  engines?: string[];
  categories?: string[];
  language?: string;
  maxResults?: number;
}): Promise<SearchResult[]> {
  if (!config.searxng.enabled) {
    logger.debug('SearXNG disabled, skipping search');
    return [];
  }

  const {
    engines = ['google', 'bing', 'duckduckgo'],
    categories = ['general'],
    language = 'en',
    maxResults = 10,
  } = options || {};

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language,
    categories: categories.join(','),
    engines: engines.join(','),
  });

  try {
    const response = await fetch(`${config.searxng.url}/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned ${response.status}`);
    }

    const data = await response.json() as SearXNGResponse;

    const results: SearchResult[] = data.results
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content || '',
        engine: r.engine,
      }));

    logger.debug('Search completed', { query, resultsCount: results.length });
    return results;
  } catch (error) {
    logger.error('SearXNG search failed', { query, error: (error as Error).message });
    return [];
  }
}

export async function healthCheck(): Promise<boolean> {
  if (!config.searxng.enabled) return true;

  try {
    const response = await fetch(`${config.searxng.url}/healthz`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    // Try basic search as fallback health check
    try {
      await search('test', { maxResults: 1 });
      return true;
    } catch {
      return false;
    }
  }
}

export default { search, healthCheck };
