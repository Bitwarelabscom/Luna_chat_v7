import { pool } from '../db/index.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import * as questionsService from './questions.service.js';
import * as deliveryService from '../triggers/delivery.service.js';
import * as factsService from '../memory/facts.service.js';
import logger from '../utils/logger.js';

interface TopicSuggestion {
  topic: string;
  evidence: string[];
  confidence: number;
  relevance: number;
  patternType?: string;
}

interface ClaimInput {
  claimText: string;
  confidence?: number;
}

export interface TopicCandidate {
  id: string;
  userId: string;
  topicText: string;
  context: string | null;
  evidence: string[];
  evidenceCount: number;
  modelConfidence: number;
  relevanceScore: number;
  thresholdScore: number;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  sourceType: 'session_pattern' | 'discussion' | 'manual';
  importance: number;
  motivation: string | null;
  suggestedFriendId: string | null;
  suggestedFriendName: string | null;
  suggestedFriendEmoji: string | null;
  suggestedFriendColor: string | null;
  createdAt: Date;
}

const TOPIC_THRESHOLD = 0.62;
const MIN_EVIDENCE_COUNT = 2;
const MIN_MODEL_CONFIDENCE = 0.55;

export async function mineTopicCandidatesForUser(userId: string): Promise<number> {
  const context = await gatherTopicMiningContext(userId);
  if (!context.trim()) {
    return 0;
  }

  const suggestions = await proposeTopics(userId, context);
  if (suggestions.length === 0) {
    return 0;
  }

  let inserted = 0;
  for (const suggestion of suggestions) {
    if (!suggestion.topic || suggestion.topic.trim().length < 8) {
      continue;
    }

    const topicText = suggestion.topic.trim();
    const evidence = (suggestion.evidence || []).filter(Boolean).slice(0, 6);
    const evidenceCount = evidence.length;
    const modelConfidence = clamp01(suggestion.confidence);
    const relevanceScore = clamp01(suggestion.relevance || modelConfidence);

    const novelty = await computeTopicNovelty(userId, topicText);
    const thresholdScore = clamp01((modelConfidence * 0.35) + (Math.min(1, evidenceCount / 4) * 0.4) + (novelty * 0.25));
    const status = (thresholdScore >= TOPIC_THRESHOLD && evidenceCount >= MIN_EVIDENCE_COUNT && modelConfidence >= MIN_MODEL_CONFIDENCE)
      ? 'approved'
      : 'rejected';

    const exists = await pool.query(
      `SELECT id FROM friend_topic_candidates
       WHERE user_id = $1 AND lower(topic_text) = lower($2)
         AND created_at > NOW() - INTERVAL '3 days'
       LIMIT 1`,
      [userId, topicText]
    );

    if (exists.rows.length > 0) {
      continue;
    }

    await pool.query(
      `INSERT INTO friend_topic_candidates
       (user_id, source_type, topic_text, context, evidence, evidence_count, model_confidence, relevance_score, threshold_score, status, considered_at)
       VALUES ($1, 'session_pattern', $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NOW())`,
      [
        userId,
        topicText,
        suggestion.patternType ? `Pattern: ${suggestion.patternType}` : null,
        JSON.stringify(evidence),
        evidenceCount,
        modelConfidence,
        relevanceScore,
        thresholdScore,
        status,
      ]
    );

    inserted++;
  }

  if (inserted > 0) {
    logger.info('Mined friend topic candidates', { userId, inserted });
  }

  return inserted;
}

export async function getApprovedTopicCandidate(userId: string): Promise<TopicCandidate | null> {
  const result = await pool.query(
    `SELECT * FROM friend_topic_candidates
     WHERE user_id = $1
       AND status = 'approved'
     ORDER BY threshold_score DESC, created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapTopicCandidate(result.rows[0]);
}

export async function markTopicCandidateConsumed(candidateId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE friend_topic_candidates
     SET status = 'consumed', considered_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [candidateId, userId]
  );
}

export async function createClaimsAndQuestionsForDiscussion(params: {
  userId: string;
  sessionId: string | null;
  conversationId: string;
  topic: string;
  claims: ClaimInput[];
  topicCandidateId?: string | null;
}): Promise<number> {
  const { userId, sessionId, conversationId, topic, claims, topicCandidateId } = params;

  let created = 0;

  for (const claim of claims) {
    const claimText = claim.claimText.trim();
    if (!claimText || claimText.length < 12) {
      continue;
    }

    const claimResult = await pool.query(
      `INSERT INTO friend_claims
       (user_id, conversation_id, session_id, topic_candidate_id, claim_text, confidence, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_verification')
       RETURNING id`,
      [
        userId,
        conversationId,
        sessionId,
        topicCandidateId || null,
        claimText,
        clamp01(claim.confidence ?? 0.7),
      ]
    );

    const claimId = claimResult.rows[0]?.id as string | undefined;
    if (!claimId) {
      continue;
    }

    const questionText = `Luna's friend proposed this claim: \"${claimText}\". Is this accurate for you?`;

    const question = await questionsService.askQuestion(userId, sessionId, {
      question: questionText,
      context: `Friend verification\nTopic: ${topic}\nClaim ID: ${claimId}`,
      priority: 8,
    });

    await pool.query(
      `INSERT INTO friend_claim_verifications
       (user_id, claim_id, question_id, question_text, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [userId, claimId, question.id, questionText]
    );

    await pool.query(
      `UPDATE friend_claims
       SET status = 'question_asked'
       WHERE id = $1`,
      [claimId]
    );

    await deliveryService.sendAutonomousNotification(
      userId,
      'Luna needs verification',
      'A friend claim needs your confirmation before memory is updated.',
      'autonomous.friend_claim_question',
      8,
      {
        questionId: question.id,
        claimId,
        conversationId,
      }
    );

    created++;
  }

  if (created > 0) {
    logger.info('Created friend claim verification questions', {
      userId,
      conversationId,
      created,
    });
  }

  return created;
}

export async function resolveVerificationForQuestion(
  questionId: string,
  userId: string,
  userResponse: string
): Promise<void> {
  const result = await pool.query(
    `SELECT v.id as verification_id, v.claim_id, c.claim_text, c.confidence
     FROM friend_claim_verifications v
     JOIN friend_claims c ON c.id = v.claim_id
     WHERE v.question_id = $1
       AND v.user_id = $2
       AND v.status = 'pending'
     LIMIT 1`,
    [questionId, userId]
  );

  if (result.rows.length === 0) {
    return;
  }

  const row = result.rows[0] as {
    verification_id: string;
    claim_id: string;
    claim_text: string;
    confidence: number;
  };

  const classification = classifyResponse(userResponse);

  await pool.query(
    `UPDATE friend_claim_verifications
     SET status = 'answered', answer_text = $3, answer_confidence = $4, resolution = $5, resolved_at = NOW()
     WHERE question_id = $1 AND user_id = $2`,
    [questionId, userId, userResponse, classification.confidence, classification.resolution]
  );

  const nextStatus = classification.resolution === 'confirmed'
    ? 'verified'
    : classification.resolution === 'denied'
      ? 'rejected'
      : 'unclear';

  await pool.query(
    `UPDATE friend_claims
     SET status = $3, verification_resolution = $4, verified_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [row.claim_id, userId, nextStatus, classification.resolution]
  );

  if (classification.resolution === 'confirmed') {
    await factsService.storeFact(userId, {
      category: 'context',
      factKey: 'friend_verified_claim',
      factValue: row.claim_text,
      confidence: Math.max(0.75, Number(row.confidence) || 0.75),
    });
  }

  logger.info('Resolved friend claim verification', {
    userId,
    questionId,
    claimId: row.claim_id,
    resolution: classification.resolution,
  });
}

export async function dismissVerificationForQuestion(questionId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE friend_claim_verifications
     SET status = 'dismissed', resolution = 'unclear', resolved_at = NOW()
     WHERE question_id = $1 AND user_id = $2 AND status = 'pending'`,
    [questionId, userId]
  );

  await pool.query(
    `UPDATE friend_claims c
     SET status = 'dismissed', verification_resolution = 'unclear', verified_at = NOW()
     FROM friend_claim_verifications v
     WHERE v.claim_id = c.id
       AND v.question_id = $1
       AND v.user_id = $2`,
    [questionId, userId]
  );
}

export async function listRecentTopicCandidates(userId: string, limit = 20): Promise<TopicCandidate[]> {
  const result = await pool.query(
    `SELECT ftc.*,
            fp.name AS suggested_friend_name,
            fp.avatar_emoji AS suggested_friend_emoji,
            fp.color AS suggested_friend_color
     FROM friend_topic_candidates ftc
     LEFT JOIN friend_personalities fp ON fp.id = ftc.suggested_friend_id
     WHERE ftc.user_id = $1
     ORDER BY ftc.importance DESC, ftc.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(mapTopicCandidate);
}

export async function addManualTopicCandidate(
  userId: string,
  topicText: string,
  motivation: string | null,
  importance: number,
  suggestedFriendId: string | null
): Promise<TopicCandidate> {
  const result = await pool.query(
    `INSERT INTO friend_topic_candidates
       (user_id, source_type, topic_text, motivation, importance, suggested_friend_id,
        model_confidence, relevance_score, threshold_score, status)
     VALUES ($1, 'manual', $2, $3, $4, $5, 1.0, 1.0, 0.60, 'approved')
     RETURNING *`,
    [userId, topicText, motivation, importance, suggestedFriendId]
  );

  const row = result.rows[0] as Record<string, unknown>;
  // Fetch friend details if needed
  if (row.suggested_friend_id) {
    const friendResult = await pool.query(
      `SELECT name, avatar_emoji, color FROM friend_personalities WHERE id = $1`,
      [row.suggested_friend_id]
    );
    if (friendResult.rows.length > 0) {
      const fr = friendResult.rows[0] as Record<string, unknown>;
      row.suggested_friend_name = fr.name;
      row.suggested_friend_emoji = fr.avatar_emoji;
      row.suggested_friend_color = fr.color;
    }
  }

  return mapTopicCandidate(row);
}

export async function updateTopicCandidate(
  id: string,
  userId: string,
  updates: {
    importance?: number;
    motivation?: string | null;
    suggestedFriendId?: string | null;
    status?: 'pending' | 'approved' | 'rejected' | 'consumed';
  }
): Promise<TopicCandidate | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.importance !== undefined) {
    setClauses.push(`importance = $${idx++}`);
    values.push(updates.importance);
  }
  if ('motivation' in updates) {
    setClauses.push(`motivation = $${idx++}`);
    values.push(updates.motivation);
  }
  if ('suggestedFriendId' in updates) {
    setClauses.push(`suggested_friend_id = $${idx++}`);
    values.push(updates.suggestedFriendId);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(updates.status);
  }

  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = NOW()`);
  values.push(id, userId);

  const result = await pool.query(
    `UPDATE friend_topic_candidates
     SET ${setClauses.join(', ')}
     WHERE id = $${idx++} AND user_id = $${idx}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  if (row.suggested_friend_id) {
    const friendResult = await pool.query(
      `SELECT name, avatar_emoji, color FROM friend_personalities WHERE id = $1`,
      [row.suggested_friend_id]
    );
    if (friendResult.rows.length > 0) {
      const fr = friendResult.rows[0] as Record<string, unknown>;
      row.suggested_friend_name = fr.name;
      row.suggested_friend_emoji = fr.avatar_emoji;
      row.suggested_friend_color = fr.color;
    }
  }

  return mapTopicCandidate(row);
}

export async function deleteTopicCandidate(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM friend_topic_candidates WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function gatherTopicMiningContext(userId: string): Promise<string> {
  const [messagesResult, logsResult, patternResult] = await Promise.all([
    pool.query(
      `SELECT m.role, m.content, m.created_at
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE s.user_id = $1
         AND m.created_at > NOW() - INTERVAL '14 days'
       ORDER BY m.created_at DESC
       LIMIT 220`,
      [userId]
    ),
    pool.query(
      `SELECT summary, topics, mood, energy, started_at
       FROM session_logs
       WHERE user_id = $1
         AND ended_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 25`,
      [userId]
    ),
    pool.query(
      `SELECT pattern_type, confidence, data, created_at
       FROM pattern_detections
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 40`,
      [userId]
    ).catch(() => ({ rows: [] })),
  ]);

  const recentMessages = messagesResult.rows
    .reverse()
    .map((row: { role: string; content: string }) => `${row.role.toUpperCase()}: ${String(row.content || '').slice(0, 600)}`)
    .join('\n');

  const sessionSummaries = logsResult.rows
    .map((row: { summary?: string; topics?: string[]; mood?: string; energy?: string; started_at: Date }) => {
      const topics = Array.isArray(row.topics) ? row.topics.join(', ') : '';
      return [
        `Date: ${new Date(row.started_at).toISOString()}`,
        row.summary ? `Summary: ${row.summary}` : '',
        topics ? `Topics: ${topics}` : '',
        row.mood ? `Mood: ${row.mood}` : '',
        row.energy ? `Energy: ${row.energy}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const patterns = patternResult.rows
    .map((row: { pattern_type: string; confidence: number; data: unknown }) => {
      const dataText = typeof row.data === 'object' ? JSON.stringify(row.data).slice(0, 400) : String(row.data || '');
      return `Pattern: ${row.pattern_type}, confidence=${Number(row.confidence || 0).toFixed(2)}, data=${dataText}`;
    })
    .join('\n');

  return [
    '[RECENT MESSAGES]',
    recentMessages,
    '\n[SESSION SUMMARIES]',
    sessionSummaries,
    '\n[PATTERN DETECTIONS]',
    patterns,
  ].join('\n');
}

async function proposeTopics(userId: string, context: string): Promise<TopicSuggestion[]> {
  const prompt = `Analyze this user context and extract 3-6 high-signal discussion topics for Luna's friends.

Rules:
- Topics must be grounded in repeated evidence or clear recent pattern shifts.
- Avoid generic/weak topics.
- Include concise evidence snippets.
- Confidence and relevance must be 0..1.

Return JSON only:
{
  "topics": [
    {
      "topic": "short topic statement",
      "evidence": ["evidence 1", "evidence 2"],
      "confidence": 0.78,
      "relevance": 0.81,
      "patternType": "latest_discussion|behavior_pattern|interest_shift"
    }
  ]
}

Context:
${context}`;

  try {
    const response = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'friend_fact_extraction',
      messages: [
        { role: 'system', content: 'You extract only evidence-backed topics and output strict JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 5000,
      loggingContext: {
        userId,
        source: 'friend-topic-miner',
        nodeName: 'topic_mining',
      },
    });

    const payload = safeParseJson(response.content);
    const topics = Array.isArray(payload?.topics) ? payload.topics : [];

    return topics.map((t) => ({
      topic: String(t.topic || ''),
      evidence: Array.isArray(t.evidence) ? t.evidence.map((e) => String(e)) : [],
      confidence: Number(t.confidence || 0),
      relevance: Number(t.relevance || 0),
      patternType: t.patternType ? String(t.patternType) : undefined,
    }));
  } catch (error) {
    logger.warn('Friend topic mining failed, no topics generated', {
      userId,
      error: (error as Error).message,
    });
    return [];
  }
}

async function computeTopicNovelty(userId: string, topicText: string): Promise<number> {
  const result = await pool.query(
    `SELECT topic
     FROM friend_conversations
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '21 days'
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId]
  );

  const previousTopics = result.rows.map((r: { topic: string }) => r.topic.toLowerCase());
  const normalized = topicText.toLowerCase();

  if (previousTopics.some(t => t === normalized)) {
    return 0.2;
  }

  const words = normalized.split(/\s+/).filter(w => w.length > 4);
  const overlaps = previousTopics.map((topic) => {
    const matches = words.filter(w => topic.includes(w)).length;
    return words.length === 0 ? 0 : (matches / words.length);
  });

  const maxOverlap = overlaps.length > 0 ? Math.max(...overlaps) : 0;
  return clamp01(1 - maxOverlap);
}

function classifyResponse(text: string): {
  resolution: 'confirmed' | 'denied' | 'unclear';
  confidence: number;
} {
  const normalized = text.toLowerCase();

  const positive = ['yes', 'correct', 'true', 'accurate', 'right', 'exactly', 'absolutely', 'yep'];
  const negative = ['no', 'wrong', 'false', 'incorrect', 'not really', 'nope'];

  const hasPositive = positive.some(token => normalized.includes(token));
  const hasNegative = negative.some(token => normalized.includes(token));

  if (hasPositive && !hasNegative) {
    return { resolution: 'confirmed', confidence: 0.85 };
  }

  if (hasNegative && !hasPositive) {
    return { resolution: 'denied', confidence: 0.85 };
  }

  return { resolution: 'unclear', confidence: 0.5 };
}

function mapTopicCandidate(row: Record<string, unknown>): TopicCandidate {
  const evidence = Array.isArray(row.evidence) ? row.evidence as string[] : [];

  return {
    id: row.id as string,
    userId: row.user_id as string,
    topicText: row.topic_text as string,
    context: (row.context as string) || null,
    evidence,
    evidenceCount: Number(row.evidence_count || evidence.length || 0),
    modelConfidence: Number(row.model_confidence || 0),
    relevanceScore: Number(row.relevance_score || 0),
    thresholdScore: Number(row.threshold_score || 0),
    status: row.status as TopicCandidate['status'],
    sourceType: (row.source_type as TopicCandidate['sourceType']) || 'session_pattern',
    importance: Number(row.importance || 3),
    motivation: (row.motivation as string) || null,
    suggestedFriendId: (row.suggested_friend_id as string) || null,
    suggestedFriendName: (row.suggested_friend_name as string) || null,
    suggestedFriendEmoji: (row.suggested_friend_emoji as string) || null,
    suggestedFriendColor: (row.suggested_friend_color as string) || null,
    createdAt: new Date(row.created_at as string),
  };
}

function safeParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }

    try {
      return JSON.parse(objectMatch[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
