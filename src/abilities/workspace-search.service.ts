import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import { createHash } from 'crypto';

// ============================================
// Result types
// ============================================

export interface KeywordSearchResult {
  filename: string;
  snippet: string;
  rank: number;
}

export interface SemanticSearchResult {
  filename: string;
  snippet: string;
  score: number;
}

export interface HybridSearchResult {
  filename: string;
  snippet: string;
  score: number;
  matchType: 'keyword' | 'semantic' | 'both';
}

// ============================================
// Internal helpers
// ============================================

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ============================================
// 1. indexFileContent
// ============================================

/**
 * Update search_vector and content_hash on workspace_files, and upsert an
 * embedding row into workspace_embeddings. Skips both steps if the
 * SHA-256 hash of content is unchanged.
 */
export async function indexFileContent(
  userId: string,
  filename: string,
  content: string
): Promise<void> {
  const contentHash = sha256(content);

  try {
    // Check whether the content has changed since the last index
    const existing = await pool.query<{ content_hash: string | null }>(
      `SELECT content_hash FROM workspace_files
       WHERE user_id = $1 AND filename = $2`,
      [userId, filename]
    );

    if (existing.rows.length > 0 && existing.rows[0].content_hash === contentHash) {
      logger.debug('workspace-search: content unchanged, skipping index', { userId, filename });
      return;
    }

    // Update search_vector and content_hash on workspace_files
    await pool.query(
      `UPDATE workspace_files
       SET search_vector = to_tsvector('english', $3),
           content_hash  = $4,
           updated_at    = NOW()
       WHERE user_id = $1 AND filename = $2`,
      [userId, filename, content, contentHash]
    );

    // Generate embedding and upsert into workspace_embeddings
    const { embedding } = await generateEmbedding(content);
    const vectorString = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO workspace_embeddings (user_id, filename, embedding, content_hash, updated_at)
       VALUES ($1, $2, $3::vector, $4, NOW())
       ON CONFLICT (user_id, filename) DO UPDATE
         SET embedding     = EXCLUDED.embedding,
             content_hash  = EXCLUDED.content_hash,
             updated_at    = NOW()`,
      [userId, filename, vectorString, contentHash]
    );

    logger.debug('workspace-search: indexed file', { userId, filename });
  } catch (error) {
    logger.error('workspace-search: indexFileContent failed', {
      userId,
      filename,
      error: (error as Error).message,
    });
    throw error;
  }
}

// ============================================
// 2. keywordSearch
// ============================================

/**
 * Full-text search over workspace_files using PostgreSQL tsvector/tsquery.
 * Returns filename, a headline snippet, and the ts_rank score.
 */
export async function keywordSearch(
  userId: string,
  query: string,
  limit = 20
): Promise<KeywordSearchResult[]> {
  try {
    const result = await pool.query<{ filename: string; snippet: string; rank: number }>(
      `SELECT
         filename,
         ts_headline(
           'english',
           COALESCE(
             (SELECT wf2.file_path FROM workspace_files wf2
              WHERE wf2.user_id = wf.user_id AND wf2.filename = wf.filename),
             ''
           ),
           plainto_tsquery('english', $2),
           'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>, HighlightAll=false'
         ) AS snippet,
         ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
       FROM workspace_files wf
       WHERE user_id = $1
         AND search_vector @@ plainto_tsquery('english', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      [userId, query, limit]
    );

    return result.rows.map((row) => ({
      filename: row.filename,
      snippet: row.snippet ?? '',
      rank: Number(row.rank),
    }));
  } catch (error) {
    logger.error('workspace-search: keywordSearch failed', {
      userId,
      query,
      error: (error as Error).message,
    });
    throw error;
  }
}

// ============================================
// 3. semanticSearch
// ============================================

/**
 * Semantic (vector) search over workspace_embeddings using pgvector cosine
 * distance. Joins workspace_files to extract a plain-text snippet from the
 * first ~200 characters of file_path (the stored text content path) or falls
 * back to a content column if present.
 *
 * NOTE: workspace_files.file_path stores the on-disk path, not the content.
 * The snippet is therefore derived from the filename for now; callers that
 * need richer snippets should read file content from disk.
 */
export async function semanticSearch(
  userId: string,
  query: string,
  limit = 20
): Promise<SemanticSearchResult[]> {
  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    // cosine distance via <=> - lower is more similar, so we convert to score
    const result = await pool.query<{
      filename: string;
      snippet: string;
      score: number;
    }>(
      `SELECT
         we.filename,
         -- Derive a short snippet from the first 200 chars of file_path
         -- (file_path contains the absolute filesystem path; it stands in until
         --  a separate content column is available)
         LEFT(wf.file_path, 200) AS snippet,
         1 - (we.embedding <=> $3::vector) AS score
       FROM workspace_embeddings we
       JOIN workspace_files wf
         ON wf.user_id = we.user_id AND wf.filename = we.filename
       WHERE we.user_id = $1
       ORDER BY we.embedding <=> $3::vector
       LIMIT $2`,
      [userId, limit, vectorString]
    );

    return result.rows.map((row) => ({
      filename: row.filename,
      snippet: row.snippet ?? '',
      score: Number(row.score),
    }));
  } catch (error) {
    logger.error('workspace-search: semanticSearch failed', {
      userId,
      query,
      error: (error as Error).message,
    });
    throw error;
  }
}

// ============================================
// 4. hybridSearch (RRF)
// ============================================

const RRF_K = 60;

/**
 * Hybrid search combining keyword and semantic results via
 * Reciprocal Rank Fusion (RRF).
 *
 * Combined score = 1/(k + rank_keyword) + 1/(k + rank_semantic)
 * where k = 60 (standard RRF constant).
 *
 * Results are deduplicated by filename and sorted by combined score DESC.
 * matchType indicates which search(es) found each file.
 */
export async function hybridSearch(
  userId: string,
  query: string,
  limit = 20
): Promise<HybridSearchResult[]> {
  // Run both searches in parallel - double the individual limits to have enough
  // candidates for fusion before applying the final limit.
  const fetchLimit = limit * 2;

  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(userId, query, fetchLimit).catch((err) => {
      logger.warn('workspace-search: keyword branch failed in hybrid', {
        error: (err as Error).message,
      });
      return [] as KeywordSearchResult[];
    }),
    semanticSearch(userId, query, fetchLimit).catch((err) => {
      logger.warn('workspace-search: semantic branch failed in hybrid', {
        error: (err as Error).message,
      });
      return [] as SemanticSearchResult[];
    }),
  ]);

  // Build rank maps (1-based)
  const keywordRankMap = new Map<string, number>();
  keywordResults.forEach((r, idx) => keywordRankMap.set(r.filename, idx + 1));

  const semanticRankMap = new Map<string, number>();
  semanticResults.forEach((r, idx) => semanticRankMap.set(r.filename, idx + 1));

  // Collect all unique filenames across both result sets
  const allFilenames = new Set<string>([
    ...keywordResults.map((r) => r.filename),
    ...semanticResults.map((r) => r.filename),
  ]);

  // Build a snippet map - prefer keyword snippet (has highlights), fall back to semantic
  const snippetMap = new Map<string, string>();
  semanticResults.forEach((r) => snippetMap.set(r.filename, r.snippet));
  keywordResults.forEach((r) => snippetMap.set(r.filename, r.snippet)); // overwrite with highlighted

  // Compute RRF scores and determine match type
  const fused: HybridSearchResult[] = Array.from(allFilenames).map((filename) => {
    const kRank = keywordRankMap.get(filename);
    const sRank = semanticRankMap.get(filename);

    const kScore = kRank !== undefined ? 1 / (RRF_K + kRank) : 0;
    const sScore = sRank !== undefined ? 1 / (RRF_K + sRank) : 0;
    const combinedScore = kScore + sScore;

    let matchType: HybridSearchResult['matchType'];
    if (kRank !== undefined && sRank !== undefined) {
      matchType = 'both';
    } else if (kRank !== undefined) {
      matchType = 'keyword';
    } else {
      matchType = 'semantic';
    }

    return {
      filename,
      snippet: snippetMap.get(filename) ?? '',
      score: combinedScore,
      matchType,
    };
  });

  // Sort by combined score descending and apply final limit
  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit);
}

// ============================================
// Singleton export
// ============================================

class WorkspaceSearchService {
  indexFileContent = indexFileContent;
  keywordSearch = keywordSearch;
  semanticSearch = semanticSearch;
  hybridSearch = hybridSearch;
}

export const workspaceSearchService = new WorkspaceSearchService();

export default {
  indexFileContent,
  keywordSearch,
  semanticSearch,
  hybridSearch,
};
