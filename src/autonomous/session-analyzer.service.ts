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

    // Use Groq to analyze sessions
    const gaps = await analyzeWithGroq(sessionSummary, userId);

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
- priority (0-1, based on frequency and user interest)
- suggestedQueries (2-3 search queries to research this topic)
- category (technical, current_events, personal_interest, academic)

Output ONLY valid JSON array of knowledge gaps. No markdown, no explanations, just the JSON array.

Example output:
[
  {
    "description": "Recent developments in quantum computing algorithms",
    "priority": 0.85,
    "suggestedQueries": ["quantum computing 2026 breakthroughs", "latest quantum algorithms", "quantum advantage applications"],
    "category": "technical"
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

    // Validate and filter gaps
    const validGaps = gaps.filter((gap) => {
      return (
        gap.description &&
        typeof gap.priority === 'number' &&
        gap.priority >= 0 &&
        gap.priority <= 1 &&
        Array.isArray(gap.suggestedQueries) &&
        gap.suggestedQueries.length > 0 &&
        ['technical', 'current_events', 'personal_interest', 'academic'].includes(gap.category)
      );
    });

    logger.info('Knowledge gaps identified', {
      userId,
      totalGaps: validGaps.length,
      highPriorityGaps: validGaps.filter((g) => g.priority >= 0.7).length,
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

      // 3. Store new unique gap
      await query(
        `INSERT INTO knowledge_gaps (
           user_id,
           gap_description,
           priority,
           suggested_queries,
           category,
           status,
           embedding
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
        [
          userId,
          gap.description,
          gap.priority,
          gap.suggestedQueries,
          gap.category,
          vectorString
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
    `SELECT id, gap_description, priority, suggested_queries, category, identified_at, status, embedding::text
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
    };
  });
}

/**
 * Update knowledge gap status
 */
export async function updateGapStatus(
  gapId: number,
  status: 'pending' | 'researching' | 'verified' | 'embedded' | 'rejected' | 'failed',
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
    const completedAt = ['verified', 'embedded', 'rejected', 'failed'].includes(status)
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
