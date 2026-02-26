/**
 * Source Trust Manager
 * Manages trust scores for domains used in autonomous research
 */

import { query } from '../db/postgres.js';

const COMMON_MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'co.kr',
  'com.br',
  'com.mx',
  'co.nz',
  'co.in',
  'com.cn',
]);

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
  const normalized = normalizeDomain(domain);
  const candidates = getDomainCandidates(normalized);

  const rows = await query<any>(
    'SELECT domain, trust_score FROM source_trust_scores WHERE domain = ANY($1)',
    [candidates]
  );

  if (rows.length === 0) {
    return null; // Unknown domain
  }

  const trustByDomain = new Map<string, number>();
  rows.forEach((row) => trustByDomain.set(row.domain, parseFloat(row.trust_score)));

  for (const candidate of candidates) {
    const match = trustByDomain.get(candidate);
    if (match !== undefined) return match;
  }

  return null;
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

  const normalizedDomain = normalizeDomain(domain);

  if (category) {
    await query(
      `INSERT INTO source_trust_scores (domain, trust_score, category, update_reason, last_updated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (domain) DO UPDATE
       SET trust_score = $2, category = $3, update_reason = $4, last_updated = NOW()`,
      [normalizedDomain, trustScore, category, updateReason]
    );
  } else {
    await query(
      `INSERT INTO source_trust_scores (domain, trust_score, update_reason, last_updated)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (domain) DO UPDATE
       SET trust_score = $2, update_reason = $3, last_updated = NOW()`,
      [normalizedDomain, trustScore, updateReason]
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
  const candidatesByUrl = new Map<string, string[]>();
  const uniqueCandidates = new Set<string>();

  for (const url of urls) {
    const domain = extractDomainFromUrl(url);
    const candidates = getDomainCandidates(domain);
    candidatesByUrl.set(url, candidates);
    candidates.forEach((candidate) => uniqueCandidates.add(candidate));
  }

  if (uniqueCandidates.size === 0) {
    return new Map();
  }

  const rows = await query<any>(
    `SELECT domain, trust_score FROM source_trust_scores WHERE domain = ANY($1)`,
    [[...uniqueCandidates]]
  );

  const trustMap = new Map<string, number>();
  rows.forEach((row) => {
    trustMap.set(row.domain, parseFloat(row.trust_score));
  });

  // Map URLs to their trust scores
  const urlTrustMap = new Map<string, number | null>();
  urls.forEach((url) => {
    const candidates = candidatesByUrl.get(url) || [];
    const matchedScore = candidates
      .map((candidate) => trustMap.get(candidate))
      .find((score): score is number => score !== undefined);
    urlTrustMap.set(url, matchedScore ?? null);
  });

  return urlTrustMap;
}

/**
 * Extract domain from URL
 */
function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return normalizeDomain(urlObj.hostname);
  } catch (error) {
    // If URL parsing fails, try to extract domain pattern
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
    return match ? normalizeDomain(match[1]) : normalizeDomain(url);
  }
}

/**
 * Normalize a hostname or domain for storage and matching.
 */
function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return trimmed.replace(/^www\./i, '').split('/')[0].split(':')[0];
  }
}

/**
 * Return domain candidates in priority order: exact host first, then registrable root.
 */
function getDomainCandidates(hostname: string): string[] {
  const exact = normalizeDomain(hostname);
  const root = extractRootDomain(exact);
  return root === exact ? [exact] : [exact, root];
}

/**
 * Extract registrable/root domain, handling common multi-part public suffixes.
 */
function extractRootDomain(hostname: string): string {
  const normalized = normalizeDomain(hostname);
  const parts = normalized.split('.');
  if (parts.length <= 2) return normalized;

  const lastTwo = parts.slice(-2).join('.');
  if (COMMON_MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  return lastTwo;
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
  const normalizedDomain = normalizeDomain(domain);
  await query('DELETE FROM source_trust_scores WHERE domain = $1', [normalizedDomain]);
}

/**
 * Get all auto-discovered domains for review
 */
export async function getAutoDiscoveredDomains(): Promise<Array<{
  id: number;
  domain: string;
  trustScore: number;
  category: string;
  discoveredAt: Date;
  discoveryContext: string | null;
}>> {
  const rows = await query<any>(
    `SELECT id, domain, trust_score, category, discovered_at, discovery_context
     FROM source_trust_scores
     WHERE auto_discovered = true
     ORDER BY discovered_at DESC`
  );

  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    trustScore: parseFloat(row.trust_score),
    category: row.category,
    discoveredAt: row.discovered_at,
    discoveryContext: row.discovery_context,
  }));
}

/**
 * Confirm an auto-discovered domain, optionally adjusting its trust score.
 * Removes the auto_discovered flag so it behaves like a manually curated entry.
 */
export async function confirmDomain(
  domain: string,
  adjustedScore?: number
): Promise<void> {
  const normalizedDomain = normalizeDomain(domain);

  if (adjustedScore !== undefined) {
    if (adjustedScore < 0 || adjustedScore > 1) {
      throw new Error('Trust score must be between 0 and 1');
    }
    await query(
      `UPDATE source_trust_scores
       SET auto_discovered = false, trust_score = $1, update_reason = 'Manually confirmed', last_updated = NOW()
       WHERE domain = $2`,
      [adjustedScore, normalizedDomain]
    );
  } else {
    await query(
      `UPDATE source_trust_scores
       SET auto_discovered = false, update_reason = 'Manually confirmed', last_updated = NOW()
       WHERE domain = $1`,
      [normalizedDomain]
    );
  }
}
