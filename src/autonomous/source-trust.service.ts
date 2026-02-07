/**
 * Source Trust Manager
 * Manages trust scores for domains used in autonomous research
 */

import { query } from '../db/postgres.js';

export interface SourceTrustScore {
  id: number;
  domain: string;
  trustScore: number; // 0-1 scale
  category: string;
  lastUpdated: Date;
  updateReason: string;
}

export interface TrustCategory {
  category: string;
  averageTrust: number;
  count: number;
}

/**
 * Get trust score for a specific domain
 */
export async function getTrustScore(domain: string): Promise<number | null> {
  // Extract root domain (remove www, subdomains)
  const rootDomain = extractRootDomain(domain);

  const rows = await query<any>(
    'SELECT trust_score FROM source_trust_scores WHERE domain = $1',
    [rootDomain]
  );

  if (rows.length === 0) {
    return null; // Unknown domain
  }

  return parseFloat(rows[0].trust_score);
}

/**
 * Get all trust scores, optionally filtered by category
 */
export async function getAllTrustScores(category?: string): Promise<SourceTrustScore[]> {
  let sql = 'SELECT * FROM source_trust_scores';
  const params: string[] = [];

  if (category) {
    sql += ' WHERE category = $1';
    params.push(category);
  }

  sql += ' ORDER BY trust_score DESC, domain ASC';

  const rows = await query<any>(sql, params);

  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    trustScore: parseFloat(row.trust_score),
    category: row.category,
    lastUpdated: row.last_updated,
    updateReason: row.update_reason,
  }));
}

/**
 * Update trust score for a domain
 */
export async function updateTrustScore(
  domain: string,
  trustScore: number,
  updateReason: string,
  category?: string
): Promise<void> {
  if (trustScore < 0 || trustScore > 1) {
    throw new Error('Trust score must be between 0 and 1');
  }

  const rootDomain = extractRootDomain(domain);

  if (category) {
    await query(
      `INSERT INTO source_trust_scores (domain, trust_score, category, update_reason, last_updated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (domain) DO UPDATE
       SET trust_score = $2, category = $3, update_reason = $4, last_updated = NOW()`,
      [rootDomain, trustScore, category, updateReason]
    );
  } else {
    await query(
      `INSERT INTO source_trust_scores (domain, trust_score, update_reason, last_updated)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (domain) DO UPDATE
       SET trust_score = $2, update_reason = $3, last_updated = NOW()`,
      [rootDomain, trustScore, updateReason]
    );
  }
}

/**
 * Get trust statistics by category
 */
export async function getTrustStatsByCategory(): Promise<TrustCategory[]> {
  const rows = await query<any>(
    `SELECT
       category,
       AVG(trust_score) as average_trust,
       COUNT(*) as count
     FROM source_trust_scores
     WHERE category IS NOT NULL
     GROUP BY category
     ORDER BY average_trust DESC`
  );

  return rows.map((row) => ({
    category: row.category,
    averageTrust: parseFloat(row.average_trust),
    count: parseInt(row.count, 10),
  }));
}

/**
 * Check if a URL meets the minimum trust threshold
 */
export async function meetsTrustThreshold(url: string, threshold: number = 0.8): Promise<boolean> {
  const domain = extractDomainFromUrl(url);
  const trustScore = await getTrustScore(domain);

  if (trustScore === null) {
    return false; // Unknown domains don't meet threshold
  }

  return trustScore >= threshold;
}

/**
 * Filter URLs by trust threshold
 */
export async function filterByTrust(urls: string[], threshold: number = 0.8): Promise<string[]> {
  const trustChecks = await Promise.all(
    urls.map(async (url) => ({
      url,
      trusted: await meetsTrustThreshold(url, threshold),
    }))
  );

  return trustChecks.filter((check) => check.trusted).map((check) => check.url);
}

/**
 * Get trust scores for multiple URLs
 */
export async function getBulkTrustScores(urls: string[]): Promise<Map<string, number | null>> {
  const domains = urls.map((url) => extractDomainFromUrl(url));
  const uniqueDomains = [...new Set(domains)];

  if (uniqueDomains.length === 0) {
    return new Map();
  }

  const rows = await query<any>(
    `SELECT domain, trust_score FROM source_trust_scores WHERE domain = ANY($1)`,
    [uniqueDomains]
  );

  const trustMap = new Map<string, number>();
  rows.forEach((row) => {
    trustMap.set(row.domain, parseFloat(row.trust_score));
  });

  // Map URLs to their trust scores
  const urlTrustMap = new Map<string, number | null>();
  urls.forEach((url) => {
    const domain = extractDomainFromUrl(url);
    urlTrustMap.set(url, trustMap.get(domain) || null);
  });

  return urlTrustMap;
}

/**
 * Extract domain from URL
 */
function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return extractRootDomain(urlObj.hostname);
  } catch (error) {
    // If URL parsing fails, try to extract domain pattern
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
    return match ? extractRootDomain(match[1]) : url;
  }
}

/**
 * Extract root domain (remove www and subdomains for common cases)
 */
function extractRootDomain(hostname: string): string {
  // Remove www prefix
  let domain = hostname.replace(/^www\./i, '');

  // For common patterns like subdomain.domain.com, try to get domain.com
  // This is a simple heuristic - keeps last two parts for .com, .org, etc.
  const parts = domain.split('.');
  if (parts.length > 2) {
    // Check if last part is a common TLD
    const tld = parts[parts.length - 1];
    const commonTlds = ['com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'ai'];

    if (commonTlds.includes(tld)) {
      // Return last two parts (domain.tld)
      return parts.slice(-2).join('.');
    }
  }

  return domain;
}

/**
 * Add a new domain with trust score
 */
export async function addTrustedDomain(
  domain: string,
  trustScore: number,
  category: string,
  reason: string
): Promise<void> {
  await updateTrustScore(domain, trustScore, reason, category);
}

/**
 * Remove a domain from trust scores
 */
export async function removeTrustedDomain(domain: string): Promise<void> {
  const rootDomain = extractRootDomain(domain);
  await query('DELETE FROM source_trust_scores WHERE domain = $1', [rootDomain]);
}
