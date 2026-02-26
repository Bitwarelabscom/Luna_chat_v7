/**
 * Session Analyzer Service
 * Analyzes chat sessions for knowledge gaps using configurable background LLM
 */

import { query } from '../db/postgres.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';

export interface KnowledgeGap {
  description: string;
  priority: number; // 0-1
  suggestedQueries: string[];
  category: 'technical' | 'current_events' | 'personal_interest' | 'academic';
  embedding?: number[];
  importanceReasoning?: string;
  mentionCount?: number;
  sessionCount?: number;
  lastMentionedAt?: Date;
}

export interface TopicMetrics {
  mentionCount: number;
  sessionCount: number;
  lastMentionedAt: Date | null;
  recencyDays: number;
}

export interface AnalysisResult {
  gaps: KnowledgeGap[];
  sessionsAnalyzed: number;
  analysisTimestamp: Date;
}

/**
 * Analyze recent chat sessions to identify knowledge gaps
 */
export async function analyzeSessionsForGaps(
  userId: string,
  daysPast: number = 90
): Promise<AnalysisResult> {
  try {
    // Get chat sessions from the last N days
    const sessions = await query<any>(
      `SELECT
         s.id,
         s.title,
         s.created_at,
         s.updated_at,
         COUNT(m.id) as message_count
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
       WHERE s.user_id = $1
         AND s.created_at >= NOW() - INTERVAL '${daysPast} days'
       GROUP BY s.id
       ORDER BY s.updated_at DESC
       LIMIT 100`,
      [userId]
    );

    if (sessions.length === 0) {
      logger.info('No sessions found for analysis', { userId, daysPast });
      return {
        gaps: [],
        sessionsAnalyzed: 0,
        analysisTimestamp: new Date(),
      };
    }

    // Get messages from these sessions
    const sessionIds = sessions.map((row) => row.id);
    const messages = await query<any>(
      `SELECT
         m.id,
         m.session_id,
         m.role,
         m.content,
         m.created_at
       FROM messages m
       WHERE m.session_id = ANY($1)
       ORDER BY m.created_at DESC
       LIMIT 500`,
      [sessionIds]
    );

    // Prepare session summary for analysis
    const sessionSummary = prepareSessionSummary(sessions, messages);

    // Use LLM to analyze sessions and identify raw gaps (without priority)
    const rawGaps = await analyzeWithGroq(sessionSummary, userId);

    // Compute hybrid priority for each gap using real conversation metrics
    const gaps: KnowledgeGap[] = [];
    for (const rawGap of rawGaps) {
      try {
        const metrics = await computeTopicMetrics(userId, rawGap.description);
        const priority = await computeHybridPriority(userId, metrics, rawGap.importanceReasoning || '');
        gaps.push({
          ...rawGap,
          priority,
          mentionCount: metrics.mentionCount,
          sessionCount: metrics.sessionCount,
          lastMentionedAt: metrics.lastMentionedAt || undefined,
        });
      } catch (err) {
        logger.warn('Failed to compute hybrid priority, using fallback', { error: (err as Error).message, gap: rawGap.description });
        gaps.push({ ...rawGap, priority: 0.3 });
      }
    }

    return {
      gaps,
      sessionsAnalyzed: sessions.length,
      analysisTimestamp: new Date(),
    };
  } catch (error) {
    logger.error('Error analyzing sessions for knowledge gaps', { error, userId });
    throw error;
  }
}

/**
 * Prepare session data for LLM analysis
 */
function prepareSessionSummary(sessions: any[], messages: any[]): string {
  const summary: string[] = [];

  summary.push('CHAT SESSION ANALYSIS');
  summary.push(`Total Sessions: ${sessions.length}`);
  summary.push(`Total Messages: ${messages.length}`);
  summary.push('');
  summary.push('SESSION TOPICS:');

  // Group sessions with their recent messages
  const sessionMap = new Map<string, any>();
  sessions.forEach((session) => {
    sessionMap.set(session.id, {
      ...session,
      messages: [],
    });
  });

  messages.forEach((msg) => {
    const session = sessionMap.get(msg.session_id);
    if (session) {
      session.messages.push(msg);
    }
  });

  // Summarize each session
  let sessionCount = 0;
  sessionMap.forEach((session) => {
    if (sessionCount >= 20) return; // Limit to 20 sessions for token efficiency

    const userMessages = session.messages.filter((m: any) => m.role === 'user');

    if (userMessages.length > 0) {
      summary.push('');
      summary.push(`Session: ${session.title || 'Untitled'}`);
      summary.push(`Date: ${session.created_at}`);
      summary.push(`Messages: ${session.message_count}`);

      // Sample user questions (first 3)
      summary.push('User Questions:');
      userMessages.slice(0, 3).forEach((msg: any) => {
        const preview = msg.content.substring(0, 200);
        summary.push(`- ${preview}${msg.content.length > 200 ? '...' : ''}`);
      });

      sessionCount++;
    }
  });

  return summary.join('\n');
}

/**
 * Use configured background model to analyze sessions and identify knowledge gaps
 */
async function analyzeWithGroq(sessionSummary: string, userId: string): Promise<KnowledgeGap[]> {
  try {
    const systemPrompt = `You are an AI session analyzer identifying knowledge gaps in user conversations.

Analyze the following 90 days of chat sessions and identify knowledge gaps.

Focus on:
1. Topics the user asked about that are outside the AI's training data
2. Recent events or news mentioned that require current information
3. Technical subjects where the user needed more detail
4. Patterns in questions that suggest deeper learning needs

For each knowledge gap, provide:
- description (concise, specific)
- suggestedQueries (2-3 search queries to research this topic)
- category (technical, current_events, personal_interest, academic)
- importanceReasoning (1-2 sentences explaining why this topic matters to the user)

Do NOT include a priority score - that will be computed separately from conversation metrics.

Output ONLY valid JSON array of knowledge gaps. No markdown, no explanations, just the JSON array.

Example output:
[
  {
    "description": "Recent developments in quantum computing algorithms",
    "suggestedQueries": ["quantum computing 2026 breakthroughs", "latest quantum algorithms", "quantum advantage applications"],
    "category": "technical",
    "importanceReasoning": "User asked about quantum computing in multiple sessions over the past month, indicating sustained interest in the field."
  }
]`;

    const completion = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'session_gap_analysis',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sessionSummary },
      ],
      temperature: 0.3,
      maxTokens: 5000,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'session_gap_analysis',
      },
    });

    const responseText = completion.content.trim() || '[]';

    // Parse JSON response
    let gaps: KnowledgeGap[];
    try {
      // Remove markdown code blocks if present
      const jsonText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      gaps = JSON.parse(jsonText);
    } catch (parseError) {
      logger.error('Failed to parse session analysis response as JSON', {
        parseError,
        responseText,
      });
      gaps = [];
    }

    // Validate and filter gaps (priority is no longer from LLM - set to 0 placeholder)
    const validGaps = gaps.filter((gap) => {
      return (
        gap.description &&
        Array.isArray(gap.suggestedQueries) &&
        gap.suggestedQueries.length > 0 &&
        ['technical', 'current_events', 'personal_interest', 'academic'].includes(gap.category)
      );
    }).map((gap) => ({
      ...gap,
      priority: 0, // Will be overwritten by hybrid scoring
    }));

    logger.info('Knowledge gaps identified (pre-scoring)', {
      userId,
      totalGaps: validGaps.length,
    });

    return validGaps;
  } catch (error) {
    logger.error('Error analyzing session gaps', { error });
    throw error;
  }
}

/**
 * Store identified knowledge gaps in database
 */
export async function storeKnowledgeGaps(
  userId: string,
  gaps: KnowledgeGap[]
): Promise<void> {
  const { generateEmbedding } = await import('../memory/embedding.service.js');

  for (const gap of gaps) {
    try {
      // 1. Generate embedding for semantic similarity check
      const { embedding } = await generateEmbedding(gap.description);
      // Format as string "[0.1, 0.2, ...]" for pgvector
      const vectorString = JSON.stringify(embedding);

      // 2. Check for similar existing gaps (similarity > 0.9)
      const similarGaps = await query<any>(
        `SELECT id, gap_description, status, 1 - (embedding <=> $1) as similarity
         FROM knowledge_gaps
         WHERE user_id = $2 
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> $1) > 0.9
         ORDER BY similarity DESC
         LIMIT 1`,
        [vectorString, userId]
      );

      if (similarGaps.length > 0) {
        logger.info('Skipping duplicate knowledge gap (semantic match)', {
          userId,
          newGap: gap.description,
          existingGap: similarGaps[0].gap_description,
          similarity: similarGaps[0].similarity,
          status: similarGaps[0].status
        });
        continue;
      }

      // 3. Store new unique gap with metrics
      await query(
        `INSERT INTO knowledge_gaps (
           user_id,
           gap_description,
           priority,
           suggested_queries,
           category,
           status,
           embedding,
           mention_count,
           session_count,
           last_mentioned_at
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)`,
        [
          userId,
          gap.description,
          gap.priority,
          gap.suggestedQueries,
          gap.category,
          vectorString,
          gap.mentionCount || 0,
          gap.sessionCount || 0,
          gap.lastMentionedAt || null,
        ]
      );
    } catch (err) {
      logger.error('Failed to store knowledge gap', { error: (err as Error).message, gap: gap.description });
    }
  }

  logger.info('Knowledge gaps stored', { userId, count: gaps.length });
}

/**
 * Get pending knowledge gaps for a user (sorted by priority)
 */
export async function getPendingGaps(
  userId: string,
  limit: number = 10
): Promise<any[]> {
  const rows = await query<any>(
    `SELECT id, gap_description, priority, suggested_queries, category, identified_at, status, embedding::text,
            retry_count, best_query, mention_count, session_count
     FROM knowledge_gaps
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY priority DESC, identified_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => {
    // Robust parsing of pgvector string format "[0.1, 0.2, ...]" or "{0.1, 0.2, ...}"
    let embedding: number[] | undefined;
    if (row.embedding) {
      const cleanString = row.embedding.replace(/[\[\]{}]/g, '');
      embedding = cleanString.split(',').map((val: string) => parseFloat(val.trim()));
    }

    return {
      id: row.id,
      gapDescription: row.gap_description,
      priority: parseFloat(row.priority),
      suggestedQueries: row.suggested_queries,
      category: row.category,
      identifiedAt: row.identified_at,
      status: row.status,
      embedding,
      retryCount: row.retry_count || 0,
      bestQuery: row.best_query,
      mentionCount: row.mention_count || 0,
      sessionCount: row.session_count || 0,
    };
  });
}

/**
 * Update knowledge gap status
 */
export async function updateGapStatus(
  gapId: number,
  status: 'pending' | 'researching' | 'verified' | 'embedded' | 'rejected' | 'failed' | 'retry_pending' | 'expired',
  failureReason?: string
): Promise<void> {
  if (failureReason) {
    await query(
      `UPDATE knowledge_gaps
       SET status = $1, failure_reason = $2, completed_at = NOW()
       WHERE id = $3`,
      [status, failureReason, gapId]
    );
  } else {
    const completedAt = ['verified', 'embedded', 'rejected', 'failed', 'expired'].includes(status)
      ? 'NOW()'
      : 'NULL';

    await query(
      `UPDATE knowledge_gaps
       SET status = $1, completed_at = ${completedAt}
       WHERE id = $2`,
      [status, gapId]
    );
  }
}

/**
 * Compute topic metrics from actual conversation data.
 * Extracts keywords from the gap description, then queries messages for mention counts.
 */
export async function computeTopicMetrics(
  userId: string,
  gapDescription: string
): Promise<TopicMetrics> {
  try {
    // Use LLM to extract 2-3 core keywords
    const keywordCompletion = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'session_gap_analysis',
      messages: [
        {
          role: 'system',
          content: 'Extract 2-3 core search keywords from the following topic description. Output JSON only: {"keywords": ["keyword1", "keyword2"]}',
        },
        { role: 'user', content: gapDescription },
      ],
      temperature: 0.1,
      maxTokens: 200,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'keyword_extraction',
      },
    });

    const responseText = keywordCompletion.content.trim() || '{}';
    const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    const keywords: string[] = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k: unknown) => typeof k === 'string' && k.length > 0).slice(0, 3)
      : [];

    if (keywords.length === 0) {
      return { mentionCount: 0, sessionCount: 0, lastMentionedAt: null, recencyDays: 999 };
    }

    // Query messages for each keyword and union the results
    let totalMentionCount = 0;
    let totalSessionCount = 0;
    let lastMentionedAt: Date | null = null;

    for (const keyword of keywords) {
      const rows = await query<any>(
        `SELECT COUNT(*) as mention_count,
                COUNT(DISTINCT m.session_id) as session_count,
                MAX(m.created_at) as last_mentioned_at
         FROM messages m JOIN sessions s ON m.session_id = s.id
         WHERE s.user_id = $1 AND m.role = 'user'
           AND m.created_at >= NOW() - INTERVAL '90 days'
           AND m.content ILIKE '%' || $2 || '%'`,
        [userId, keyword]
      );

      if (rows.length > 0) {
        const mc = parseInt(rows[0].mention_count) || 0;
        const sc = parseInt(rows[0].session_count) || 0;
        const lma = rows[0].last_mentioned_at ? new Date(rows[0].last_mentioned_at) : null;

        totalMentionCount = Math.max(totalMentionCount, mc);
        totalSessionCount = Math.max(totalSessionCount, sc);
        if (lma && (!lastMentionedAt || lma > lastMentionedAt)) {
          lastMentionedAt = lma;
        }
      }
    }

    const recencyDays = lastMentionedAt
      ? Math.floor((Date.now() - lastMentionedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    return { mentionCount: totalMentionCount, sessionCount: totalSessionCount, lastMentionedAt, recencyDays };
  } catch (error) {
    logger.error('Error computing topic metrics', { error, userId, gapDescription });
    return { mentionCount: 0, sessionCount: 0, lastMentionedAt: null, recencyDays: 999 };
  }
}

/**
 * Compute hybrid priority using hard conversation metrics + LLM reasoning.
 * Returns a score between 0 and 1.
 */
export async function computeHybridPriority(
  userId: string,
  metrics: TopicMetrics,
  importanceReasoning: string
): Promise<number> {
  try {
    const systemPrompt = `You are a priority scoring assistant. Given conversation metrics and an importance assessment, assign a priority score between 0.0 and 1.0.

Score rules:
- 0 mentions or 1 mention in 1 session -> 0.2-0.4 (casual one-off)
- 2-5 mentions across 2-3 sessions -> 0.5-0.7 (moderate interest)
- 5+ mentions across 3+ sessions -> 0.7-0.95 (recurring topic)
- Recency boosts: last 7 days +0.1, last 30 days +0.05
- Cap at 1.0

Output valid JSON only: {"priority": 0.XX}`;

    const userMessage = `Topic metrics:
- Mentioned in ${metrics.mentionCount} messages across ${metrics.sessionCount} sessions
- Last discussed ${metrics.recencyDays} days ago
- LLM assessment: "${importanceReasoning}"

Assign a priority score.`;

    const completion = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'session_gap_analysis',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      maxTokens: 100,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'hybrid_priority_scoring',
      },
    });

    const responseText = completion.content.trim() || '{}';
    const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    const priority = typeof parsed.priority === 'number' ? Math.max(0, Math.min(1, parsed.priority)) : 0.3;

    logger.debug('Hybrid priority computed', {
      userId,
      mentionCount: metrics.mentionCount,
      sessionCount: metrics.sessionCount,
      recencyDays: metrics.recencyDays,
      priority,
    });

    return priority;
  } catch (error) {
    logger.error('Error computing hybrid priority', { error, userId });
    // Fallback: simple formula without LLM
    let score = 0.3;
    if (metrics.mentionCount >= 5 && metrics.sessionCount >= 3) score = 0.8;
    else if (metrics.mentionCount >= 2 && metrics.sessionCount >= 2) score = 0.6;
    if (metrics.recencyDays <= 7) score = Math.min(1, score + 0.1);
    else if (metrics.recencyDays <= 30) score = Math.min(1, score + 0.05);
    return score;
  }
}
