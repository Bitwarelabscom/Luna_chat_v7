/**
 * Research Coordinator Service
 * Orchestrates autonomous research using SearXNG and Web Fetch
 */

import { query } from '../db/postgres.js';
import * as sourceTrust from './source-trust.service.js';
import * as searxngClient from '../search/searxng.client.js';
import * as webfetchService from '../search/webfetch.service.js';
import Groq from 'groq-sdk';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { SearchResult } from '../types/index.js';

const groq = config.groq?.apiKey ? new Groq({ apiKey: config.groq.apiKey }) : null;

const TRUST_THRESHOLD = 0.8; // Only use sources with trust >= 0.8

export interface ResearchSource {
  url: string;
  title: string;
  trustScore: number | null;
  summary?: string;
  keyFacts?: string[];
}

export interface ResearchFindings {
  sources: ResearchSource[];
  keyFacts: string[];
  summary: string;
  confidence: number; // 0-1
}

/**
 * Conduct research for a knowledge gap
 */
export async function conductResearch(
  userId: string,
  gapId: number,
  topic: string,
  searchQueries: string[]
): Promise<{ sessionId: number; findings: ResearchFindings }> {
  try {
    // Create research session
    const rows = await query<{id: number}>(
      `INSERT INTO autonomous_research_sessions (
         knowledge_gap_id,
         user_id,
         topic,
         search_queries
       ) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [gapId, userId, topic, searchQueries]
    );

    const sessionId = rows[0].id;

    logger.info('Starting autonomous research', {
      userId,
      gapId,
      topic,
      sessionId,
      queries: searchQueries.length,
    });

    // Perform searches and collect results
    const allResults: SearchResult[] = [];

    for (const queryText of searchQueries) {
      try {
        const searchResults = await searxngClient.search(queryText, {
          engines: ['google', 'duckduckgo', 'bing'],
          categories: ['general', 'science', 'news'],
          language: 'en',
          maxResults: 20,
        });

        allResults.push(...searchResults);
      } catch (error) {
        logger.error('Search query failed', { error, queryText });
      }
    }

    logger.info('Search results collected', {
      sessionId,
      totalResults: allResults.length,
    });

    // Filter by trust threshold
    const trustedResults = await filterTrustedSources(allResults);

    logger.info('Filtered by trust threshold', {
      sessionId,
      trustedResults: trustedResults.length,
      trustThreshold: TRUST_THRESHOLD,
    });

    // Fetch and summarize top sources
    const sources = await fetchAndSummarizeSources(
      userId,
      trustedResults.slice(0, 10) // Limit to top 10 trusted sources
    );

    // Update research session with source counts
    await query(
      `UPDATE autonomous_research_sessions
       SET sources_found = $1, trusted_sources_count = $2
       WHERE id = $3`,
      [allResults.length, trustedResults.length, sessionId]
    );

    // Generate overall summary using Ollama
    const findings = await synthesizeFindings(topic, sources);

    // Store findings
    await query(
      `UPDATE autonomous_research_sessions
       SET findings = $1, completed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ sources, ...findings }), sessionId]
    );

    logger.info('Research completed', {
      sessionId,
      sourcesProcessed: sources.length,
      confidence: findings.confidence,
    });

    return {
      sessionId,
      findings: {
        sources,
        ...findings,
      },
    };
  } catch (error) {
    logger.error('Error conducting research', { error, userId, gapId, topic });
    throw error;
  }
}

/**
 * Filter search results by trust score
 */
async function filterTrustedSources(results: SearchResult[]): Promise<SearchResult[]> {
  const urls = results.map((r) => r.url);
  const trustScores = await sourceTrust.getBulkTrustScores(urls);

  const trusted = results.filter((result) => {
    const score = trustScores.get(result.url);
    return score !== null && score !== undefined && score >= TRUST_THRESHOLD;
  });

  return trusted;
}

/**
 * Fetch and summarize web pages
 */
async function fetchAndSummarizeSources(
  userId: string,
  results: SearchResult[]
): Promise<ResearchSource[]> {
  const sources: ResearchSource[] = [];

  for (const result of results) {
    try {
      const trustScore = await sourceTrust.getTrustScore(result.url);

      // Fetch page content
      const page = await webfetchService.fetchPage(result.url, { forceRefresh: false });

      // Summarize using Ollama (local, no cost)
      const summaryResult = await webfetchService.fetchAndSummarize(
        result.url,
        userId,
        'Extract key facts and main concepts from this content. Be concise but informative. Focus on verifiable facts.'
      );

      sources.push({
        url: result.url,
        title: result.title || page.title || 'Untitled',
        trustScore,
        summary: summaryResult.summary,
        keyFacts: extractKeyFacts(summaryResult.summary),
      });
    } catch (error) {
      logger.warn('Failed to fetch/summarize source', {
        error,
        url: result.url,
      });
    }
  }

  return sources;
}

/**
 * Extract key facts from summary text
 */
function extractKeyFacts(summary: string): string[] {
  // Simple extraction - split by newlines and filter bullet points/numbered lists
  const lines = summary.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

  const facts = lines
    .filter((line) => {
      // Match bullet points, numbered lists, or sentences with key phrases
      return (
        line.match(/^[-*•]\s+/) ||
        line.match(/^\d+\.\s+/) ||
        line.includes('fact:') ||
        line.includes('key point:')
      );
    })
    .map((line) => {
      // Clean up bullet points and numbering
      return line
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/fact:/i, '')
        .replace(/key point:/i, '')
        .trim();
    });

  return facts;
}

/**
 * Synthesize findings from multiple sources
 */
async function synthesizeFindings(
  topic: string,
  sources: ResearchSource[]
): Promise<{ keyFacts: string[]; summary: string; confidence: number }> {
  if (sources.length === 0) {
    return {
      keyFacts: [],
      summary: 'No trusted sources found for this topic.',
      confidence: 0,
    };
  }

  if (!groq) {
    logger.warn('Groq API not configured, using fallback synthesis');
    const allFacts = sources.flatMap((s) => s.keyFacts || []);
    return {
      keyFacts: allFacts.slice(0, 10),
      summary: `Research on ${topic} from ${sources.length} trusted sources.`,
      confidence: 0.5,
    };
  }

  try {
    // Prepare sources text
    const sourcesText = sources
      .map((source, index) => {
        return `Source ${index + 1} (${source.title}, trust: ${source.trustScore}):\n${source.summary}\n`;
      })
      .join('\n');

    // Use Groq for synthesis (free tier)
    const systemPrompt = `You are a research synthesizer. Analyze the following research sources and create a concise summary.

Focus on:
1. Key facts that appear across multiple sources (more reliable)
2. Main concepts and themes
3. Confidence level based on source agreement and trust scores

Output valid JSON only:
{
  "keyFacts": ["fact 1", "fact 2", ...],
  "summary": "2-3 sentence summary",
  "confidence": 0.85
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Topic: ${topic}\n\nSources:\n${sourcesText}\n\nSynthesize these findings.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0]?.message?.content?.trim() || '{}';

    // Parse JSON response
    const jsonText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(jsonText);

    return {
      keyFacts: result.keyFacts || [],
      summary: result.summary || 'Unable to synthesize findings.',
      confidence: result.confidence || 0.5,
    };
  } catch (error) {
    logger.error('Error synthesizing findings', { error, topic });

    // Fallback: simple concatenation
    const allFacts = sources.flatMap((s) => s.keyFacts || []);
    return {
      keyFacts: allFacts.slice(0, 10),
      summary: `Research on ${topic} from ${sources.length} trusted sources.`,
      confidence: 0.5,
    };
  }
}

/**
 * Get research session details
 */
export async function getResearchSession(sessionId: number, userId: string): Promise<any | null> {
  const rows = await query<any>(
    `SELECT * FROM autonomous_research_sessions
     WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    knowledgeGapId: row.knowledge_gap_id,
    userId: row.user_id,
    topic: row.topic,
    searchQueries: row.search_queries,
    sourcesFound: row.sources_found,
    trustedSourcesCount: row.trusted_sources_count,
    findings: row.findings,
    verificationResult: row.verification_result,
    friendDiscussionId: row.friend_discussion_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
