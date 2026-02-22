import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as factsService from '../memory/facts.service.js';
import * as goalsService from './goals.service.js';
import { redis } from '../db/redis.js';

// ============================================
// Types
// ============================================

export interface AutonomousQuestion {
  id: string;
  sessionId: string | null;
  userId: string;
  question: string;
  context: string | null;
  priority: number;
  status: 'pending' | 'answered' | 'dismissed' | 'expired';
  askedAt: Date;
  answeredAt: Date | null;
  userResponse: string | null;
  expiresAt: Date | null;
  relatedGoalId: string | null;
  createdAt: Date;
}

export interface AskQuestionInput {
  question: string;
  context?: string;
  priority?: number;
  expiresAt?: Date;
  goalId?: string;
}

// Priority thresholds
export const URGENT_PRIORITY_THRESHOLD = 8; // 8+ = urgent, session should pause

// ============================================
// User Availability
// ============================================

export async function getUserAvailability(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT user_available FROM autonomous_config WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0]?.user_available ?? false;
}

export async function setUserAvailability(userId: string, available: boolean): Promise<void> {
  await pool.query(
    `UPDATE autonomous_config SET user_available = $1, updated_at = NOW() WHERE user_id = $2`,
    [available, userId]
  );

  if (available) {
    logger.info('User availability set to available', { userId });
  }
}

// ============================================
// Question Management
// ============================================

export async function askQuestion(
  userId: string,
  sessionId: string | null,
  input: AskQuestionInput
): Promise<AutonomousQuestion> {
  const priority = input.priority ?? 5;
  const expiresAt = input.expiresAt ?? null;

  const result = await pool.query(
    `INSERT INTO autonomous_questions
     (user_id, session_id, question, context, priority, expires_at, related_goal_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, sessionId, input.question, input.context || null, priority, expiresAt, input.goalId || null]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create question');
  }

  const question = mapQuestion(result.rows[0]);

  logger.info('Question asked', {
    questionId: question.id,
    userId,
    sessionId,
    priority,
    isUrgent: priority >= URGENT_PRIORITY_THRESHOLD,
  });

  return question;
}

export async function getPendingQuestions(
  userId: string,
  limit = 10
): Promise<AutonomousQuestion[]> {
  const result = await pool.query(
    `SELECT * FROM autonomous_questions
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY priority DESC, asked_at ASC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(mapQuestion);
}

export async function getQuestion(
  questionId: string,
  userId: string
): Promise<AutonomousQuestion | null> {
  const result = await pool.query(
    `SELECT * FROM autonomous_questions WHERE id = $1 AND user_id = $2`,
    [questionId, userId]
  );

  return result.rows[0] ? mapQuestion(result.rows[0]) : null;
}

export async function answerQuestion(
  questionId: string,
  userId: string,
  response: string
): Promise<AutonomousQuestion | null> {
  const result = await pool.query(
    `UPDATE autonomous_questions
     SET status = 'answered', answered_at = NOW(), user_response = $3
     WHERE id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING *`,
    [questionId, userId, response]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const question = mapQuestion(result.rows[0]);

  logger.info('Question answered', {
    questionId,
    userId,
    sessionId: question.sessionId,
  });

  // Extract facts from the Q&A exchange (async - don't block response)
  const qaMessages = [
    { role: 'assistant', content: question.question },
    { role: 'user', content: response },
  ];
  factsService.processConversationFacts(userId, question.sessionId || '', qaMessages)
    .catch(err => logger.error('Failed to extract facts from Q&A', { err: (err as Error).message }));

  const friendVerificationService = await import('./friend-verification.service.js');
  await friendVerificationService.resolveVerificationForQuestion(questionId, userId, response);

  // Check if this was a goal suggestion confirmation
  if (question.context?.includes('Goal type:')) {
    const responseLower = response.toLowerCase();
    const isAffirmative = responseLower.includes('yes') ||
      responseLower.includes('sure') ||
      responseLower.includes('okay') ||
      responseLower.includes('ok') ||
      responseLower.includes('yeah') ||
      responseLower.includes('go ahead') ||
      responseLower.includes('please do');

    if (isAffirmative) {
      // Create the goal from pending suggestion
      const pendingGoal = await getPendingGoalSuggestion(userId);
      if (pendingGoal) {
        try {
          await goalsService.createGoal(userId, {
            ...pendingGoal,
            createdBy: 'luna',
          });
          logger.info('Goal created from suggestion', { userId, title: pendingGoal.title });
        } catch (err) {
          logger.error('Failed to create goal from suggestion', { err: (err as Error).message });
        }
        await clearPendingGoalSuggestion(userId);
      }
    } else {
      // User declined - just clear the pending suggestion
      await clearPendingGoalSuggestion(userId);
    }
  }

  return question;
}

export async function dismissQuestion(
  questionId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE autonomous_questions
     SET status = 'dismissed'
     WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [questionId, userId]
  );

  const success = result.rowCount === 1;

  if (success) {
    const friendVerificationService = await import('./friend-verification.service.js');
    await friendVerificationService.dismissVerificationForQuestion(questionId, userId);
    logger.info('Question dismissed', { questionId, userId });
  }

  return success;
}

export async function expireOldQuestions(): Promise<number> {
  const result = await pool.query(
    `UPDATE autonomous_questions
     SET status = 'expired'
     WHERE status = 'pending'
     AND expires_at IS NOT NULL
     AND expires_at < NOW()`,
    []
  );

  const count = result.rowCount ?? 0;

  if (count > 0) {
    logger.info('Expired old questions', { count });
  }

  return count;
}

export async function getSessionQuestions(
  sessionId: string
): Promise<AutonomousQuestion[]> {
  const result = await pool.query(
    `SELECT * FROM autonomous_questions
     WHERE session_id = $1
     ORDER BY asked_at ASC`,
    [sessionId]
  );

  return result.rows.map(mapQuestion);
}

export async function getUnansweredUrgentQuestions(
  sessionId: string
): Promise<AutonomousQuestion[]> {
  const result = await pool.query(
    `SELECT * FROM autonomous_questions
     WHERE session_id = $1
     AND status = 'pending'
     AND priority >= $2
     ORDER BY priority DESC, asked_at ASC`,
    [sessionId, URGENT_PRIORITY_THRESHOLD]
  );

  return result.rows.map(mapQuestion);
}

export async function getRecentlyAnsweredQuestions(
  sessionId: string,
  since: Date
): Promise<AutonomousQuestion[]> {
  const result = await pool.query(
    `SELECT * FROM autonomous_questions
     WHERE session_id = $1
     AND status = 'answered'
     AND answered_at > $2
     ORDER BY answered_at ASC`,
    [sessionId, since]
  );

  return result.rows.map(mapQuestion);
}

// ============================================
// Helpers
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuestion(row: any): AutonomousQuestion {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    question: row.question,
    context: row.context,
    priority: row.priority,
    status: row.status,
    askedAt: row.asked_at,
    answeredAt: row.answered_at,
    userResponse: row.user_response,
    expiresAt: row.expires_at,
    relatedGoalId: row.related_goal_id,
    createdAt: row.created_at,
  };
}

export function isUrgentQuestion(question: AutonomousQuestion): boolean {
  return question.priority >= URGENT_PRIORITY_THRESHOLD;
}

export function formatQuestionForContext(question: AutonomousQuestion): string {
  let text = `Q: ${question.question}`;
  if (question.context) {
    text += `\nContext: ${question.context}`;
  }
  if (question.status === 'answered' && question.userResponse) {
    text += `\nUser's answer: ${question.userResponse}`;
  }
  return text;
}

export function formatQuestionsForContext(questions: AutonomousQuestion[]): string {
  if (questions.length === 0) {
    return '';
  }

  const pending = questions.filter(q => q.status === 'pending');
  const answered = questions.filter(q => q.status === 'answered');

  let text = '';

  if (answered.length > 0) {
    text += '## Recently Answered Questions\n\n';
    for (const q of answered) {
      text += formatQuestionForContext(q) + '\n\n';
    }
  }

  if (pending.length > 0) {
    text += '## Pending Questions (awaiting user response)\n\n';
    for (const q of pending) {
      text += `- [Priority ${q.priority}] ${q.question}\n`;
    }
  }

  return text;
}

// ============================================
// Pending Goal Suggestions (Redis-backed)
// ============================================

export interface PendingGoalSuggestion {
  title: string;
  description?: string;
  goalType: 'user_focused' | 'self_improvement' | 'relationship' | 'research';
}

const PENDING_GOAL_PREFIX = 'pending_goal:';
const PENDING_GOAL_TTL = 3600; // 1 hour TTL

export async function storePendingGoalSuggestion(
  userId: string,
  goal: PendingGoalSuggestion
): Promise<void> {
  const key = `${PENDING_GOAL_PREFIX}${userId}`;
  await redis.setex(key, PENDING_GOAL_TTL, JSON.stringify(goal));
  logger.info('Stored pending goal suggestion', { userId, title: goal.title });
}

export async function getPendingGoalSuggestion(
  userId: string
): Promise<PendingGoalSuggestion | null> {
  const key = `${PENDING_GOAL_PREFIX}${userId}`;
  const data = await redis.get(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as PendingGoalSuggestion;
  } catch {
    return null;
  }
}

export async function clearPendingGoalSuggestion(userId: string): Promise<void> {
  const key = `${PENDING_GOAL_PREFIX}${userId}`;
  await redis.del(key);
}
