import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as councilService from './council.service.js';
import * as goalsService from './goals.service.js';
import * as newsfetcherService from './newsfetcher.service.js';
import * as insightsService from './insights.service.js';
import * as questionsService from './questions.service.js';
import * as sessionWorkspaceService from './session-workspace.service.js';
import * as researchService from './research.service.js';
import * as friendService from './friend.service.js';
import * as webfetchService from '../search/webfetch.service.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as workspaceService from '../abilities/workspace.service.js';
import * as documentsService from '../abilities/documents.service.js';
import * as searxngClient from '../search/searxng.client.js';

// ============================================
// Types
// ============================================

export interface AutonomousConfig {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  sessionIntervalMinutes: number;
  maxDailySessions: number;
  rssCheckIntervalMinutes: number;
  idleTimeoutMinutes: number;
  learningEnabled: boolean;
  rssEnabled: boolean;
  insightsEnabled: boolean;
  voiceEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutonomousSession {
  id: string;
  userId: string;
  status: 'active' | 'completed' | 'paused' | 'stopped' | 'error';
  currentPhase: SessionPhase | null;
  startedAt: Date;
  endedAt: Date | null;
  sessionType: string;
  sessionMode: 'standard' | 'expert_discussion' | 'research';
  taskDescription: string | null;
  taskPlan: string | null;
  summary: string | null;
  insightsGenerated: string[];
  loopCount: number;
  toolUseCount: number;
  createdAt: Date;
}

export interface AutonomousStatus {
  status: 'active' | 'inactive';
  currentSession: AutonomousSession | null;
  config: AutonomousConfig | null;
  todaySessionCount: number;
}

type SessionPhase = 'planning' | 'polaris' | 'aurora' | 'vega' | 'sol' | 'act';

// Constants
const MAX_TOOL_USES = 100;
const MAX_LOOPS = 50; // Increased to support larger tasks
const MAX_REPEATED_ACTIONS = 3; // Circuit breaker: force sleep after N identical action types

// Track recent action types for spinning detection
const sessionActionHistory = new Map<string, string[]>();

function getActionType(decision: string): string {
  const lower = decision.toLowerCase();
  if (lower.includes('ask') && lower.includes('user')) return 'ask_user';
  if (lower.includes('search')) return 'search';
  if (lower.includes('create') && lower.includes('task')) return 'create_task';
  if (lower.includes('fetch')) return 'fetch';
  if (lower.includes('note') || lower.includes('record')) return 'note';
  if (lower.includes('sleep') || lower.includes('pause')) return 'sleep';
  return 'other';
}

function isSpinning(sessionId: string, decision: string): boolean {
  const history = sessionActionHistory.get(sessionId) || [];
  const currentType = getActionType(decision);

  // Add current to history
  history.push(currentType);

  // Keep only last MAX_REPEATED_ACTIONS + 1
  if (history.length > MAX_REPEATED_ACTIONS + 1) {
    history.shift();
  }
  sessionActionHistory.set(sessionId, history);

  // Check if last N actions are all the same type (and not sleep/other)
  if (history.length >= MAX_REPEATED_ACTIONS && currentType !== 'sleep' && currentType !== 'other') {
    const lastN = history.slice(-MAX_REPEATED_ACTIONS);
    return lastN.every(t => t === currentType);
  }

  return false;
}

function clearActionHistory(sessionId: string): void {
  sessionActionHistory.delete(sessionId);
}

// Active session tracking (in-memory for SSE)
const activeSessions = new Map<string, {
  session: AutonomousSession;
  subscribers: Set<(data: unknown) => void>;
  toolUseCount: number;
}>();

// Cleanup orphaned sessions on startup (sessions marked active in DB but not in memory)
async function cleanupOrphanedSessions(): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE autonomous_sessions
       SET status = 'stopped'
       WHERE status = 'active'
       RETURNING id`
    );
    if (result.rowCount && result.rowCount > 0) {
      logger.info('Cleaned up orphaned autonomous sessions on startup', {
        count: result.rowCount,
        sessionIds: result.rows.map(r => r.id),
      });
    }
  } catch (error) {
    logger.error('Failed to cleanup orphaned sessions', { error });
  }
}

// Run cleanup on module load
cleanupOrphanedSessions();

// Tool use tracking helper
function incrementToolUse(sessionId: string): number {
  const tracked = activeSessions.get(sessionId);
  if (tracked) {
    tracked.toolUseCount++;
    // Broadcast tool count update
    broadcastToSession(sessionId, {
      type: 'tool_count_update',
      toolUseCount: tracked.toolUseCount,
      maxToolUses: MAX_TOOL_USES,
    });
    return tracked.toolUseCount;
  }
  return 0;
}

function getToolUseCount(sessionId: string): number {
  return activeSessions.get(sessionId)?.toolUseCount ?? 0;
}

function canUseTool(sessionId: string): boolean {
  return getToolUseCount(sessionId) < MAX_TOOL_USES;
}

// ============================================
// Configuration
// ============================================

export async function getConfig(userId: string): Promise<AutonomousConfig | null> {
  const result = await pool.query(
    `SELECT * FROM autonomous_config WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapConfigRow(result.rows[0]);
}

export async function createOrUpdateConfig(
  userId: string,
  config: Partial<Omit<AutonomousConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<AutonomousConfig> {
  const result = await pool.query(
    `INSERT INTO autonomous_config (
       user_id, enabled, auto_start, session_interval_minutes, max_daily_sessions, 
       rss_check_interval_minutes, idle_timeout_minutes, 
       learning_enabled, rss_enabled, insights_enabled, voice_enabled
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id) DO UPDATE SET
       enabled = COALESCE($2, autonomous_config.enabled),
       auto_start = COALESCE($3, autonomous_config.auto_start),
       session_interval_minutes = COALESCE($4, autonomous_config.session_interval_minutes),
       max_daily_sessions = COALESCE($5, autonomous_config.max_daily_sessions),
       rss_check_interval_minutes = COALESCE($6, autonomous_config.rss_check_interval_minutes),
       idle_timeout_minutes = COALESCE($7, autonomous_config.idle_timeout_minutes),
       learning_enabled = COALESCE($8, autonomous_config.learning_enabled),
       rss_enabled = COALESCE($9, autonomous_config.rss_enabled),
       insights_enabled = COALESCE($10, autonomous_config.insights_enabled),
       voice_enabled = COALESCE($11, autonomous_config.voice_enabled),
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      config.enabled ?? false,
      config.autoStart ?? false,
      config.sessionIntervalMinutes ?? 60,
      config.maxDailySessions ?? 24,
      config.rssCheckIntervalMinutes ?? 30,
      config.idleTimeoutMinutes ?? 30,
      config.learningEnabled ?? true,
      config.rssEnabled ?? true,
      config.insightsEnabled ?? true,
      config.voiceEnabled ?? true,
    ]
  );

  return mapConfigRow(result.rows[0]);
}

// ============================================
// Status
// ============================================

export async function getStatus(userId: string): Promise<AutonomousStatus> {
  const [config, activeSession, todayCount] = await Promise.all([
    getConfig(userId),
    getActiveSession(userId),
    getTodaySessionCount(userId),
  ]);

  return {
    status: activeSession ? 'active' : 'inactive',
    currentSession: activeSession,
    config,
    todaySessionCount: todayCount,
  };
}

async function getActiveSession(userId: string): Promise<AutonomousSession | null> {
  const result = await pool.query(
    `SELECT * FROM autonomous_sessions
     WHERE user_id = $1 AND status = 'active'
     ORDER BY started_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows.length > 0 ? mapSessionRow(result.rows[0]) : null;
}

async function getTodaySessionCount(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM autonomous_sessions
     WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
    [userId]
  );

  return parseInt(result.rows[0].count, 10);
}

// ============================================
// Session Management
// ============================================

export interface StartSessionOptions {
  taskDescription?: string;
  sessionMode?: 'standard' | 'expert_discussion' | 'research';
}

export async function startSession(
  userId: string,
  options: StartSessionOptions = {}
): Promise<AutonomousSession> {
  const { taskDescription, sessionMode = 'standard' } = options;

  // Check if already active
  const existing = await getActiveSession(userId);
  if (existing) {
    throw new Error('An autonomous session is already active');
  }

  // Check daily limit
  const config = await getConfig(userId);
  const todayCount = await getTodaySessionCount(userId);

  if (config && todayCount >= config.maxDailySessions) {
    throw new Error(`Daily session limit (${config.maxDailySessions}) reached`);
  }

  // Determine session type and initial phase
  const sessionType = taskDescription ? 'task_execution' : 'goal_review';
  const initialPhase = taskDescription ? 'planning' : 'polaris';

  // Create session
  const result = await pool.query(
    `INSERT INTO autonomous_sessions (user_id, status, session_type, session_mode, task_description, current_phase, tool_use_count)
     VALUES ($1, 'active', $2, $3, $4, $5, 0)
     RETURNING *`,
    [userId, sessionType, sessionMode, taskDescription || null, initialPhase]
  );

  const session = mapSessionRow(result.rows[0]);

  // Initialize in-memory tracking
  activeSessions.set(session.id, {
    session,
    subscribers: new Set(),
    toolUseCount: 0,
  });

  logger.info(`Autonomous session started for user ${userId}`, {
    sessionId: session.id,
    sessionMode,
    hasTask: !!taskDescription,
  });

  // Start the council loop (non-blocking)
  runCouncilLoop(session.id, userId, taskDescription).catch(err => {
    logger.error('Council loop error', { sessionId: session.id, error: err.message });
  });

  return session;
}

export async function stopSession(userId: string): Promise<AutonomousSession | null> {
  const session = await getActiveSession(userId);
  if (!session) {
    // Also check for paused sessions
    const pausedResult = await pool.query(
      `SELECT * FROM autonomous_sessions
       WHERE user_id = $1 AND status = 'paused'
       ORDER BY started_at DESC
       LIMIT 1`,
      [userId]
    );

    if (pausedResult.rows.length === 0) {
      return null;
    }

    const pausedSession = mapSessionRow(pausedResult.rows[0]);

    // Stop the paused session
    const result = await pool.query(
      `UPDATE autonomous_sessions
       SET status = 'completed', ended_at = NOW(), current_phase = NULL
       WHERE id = $1
       RETURNING *`,
      [pausedSession.id]
    );

    // Dismiss any pending questions for this session
    await pool.query(
      `UPDATE autonomous_questions
       SET status = 'dismissed'
       WHERE session_id = $1 AND status = 'pending'`,
      [pausedSession.id]
    );

    // Clean up in-memory tracking
    const tracked = activeSessions.get(pausedSession.id);
    if (tracked) {
      tracked.subscribers.forEach(callback => {
        callback({ type: 'session_end', sessionId: pausedSession.id });
      });
      activeSessions.delete(pausedSession.id);
    }

    logger.info(`Autonomous session (paused) stopped for user ${userId}`, { sessionId: pausedSession.id });

    return mapSessionRow(result.rows[0]);
  }

  const result = await pool.query(
    `UPDATE autonomous_sessions
     SET status = 'completed', ended_at = NOW(), current_phase = NULL
     WHERE id = $1
     RETURNING *`,
    [session.id]
  );

  // Dismiss any pending questions for this session
  await pool.query(
    `UPDATE autonomous_questions
     SET status = 'dismissed'
     WHERE session_id = $1 AND status = 'pending'`,
    [session.id]
  );

  // Clean up in-memory tracking
  const tracked = activeSessions.get(session.id);
  if (tracked) {
    // Notify subscribers of completion
    tracked.subscribers.forEach(callback => {
      callback({ type: 'session_end', sessionId: session.id });
    });
    activeSessions.delete(session.id);
  }

  logger.info(`Autonomous session stopped for user ${userId}`, { sessionId: session.id });

  return mapSessionRow(result.rows[0]);
}

export async function pauseSession(userId: string): Promise<AutonomousSession | null> {
  const session = await getActiveSession(userId);
  if (!session) {
    return null;
  }

  const result = await pool.query(
    `UPDATE autonomous_sessions
     SET status = 'paused'
     WHERE id = $1
     RETURNING *`,
    [session.id]
  );

  return mapSessionRow(result.rows[0]);
}

export async function resumeSession(userId: string): Promise<AutonomousSession | null> {
  // First, find the most recent paused session
  const findResult = await pool.query(
    `SELECT id FROM autonomous_sessions
     WHERE user_id = $1 AND status = 'paused'
     ORDER BY started_at DESC
     LIMIT 1`,
    [userId]
  );

  if (findResult.rows.length === 0) {
    return null;
  }

  const sessionId = findResult.rows[0].id;

  // Then update it
  const result = await pool.query(
    `UPDATE autonomous_sessions
     SET status = 'active'
     WHERE id = $1
     RETURNING *`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = mapSessionRow(result.rows[0]);

  // Check if the session is still being tracked (loop still running)
  const tracked = activeSessions.get(session.id);
  if (tracked) {
    // Original loop is still running and polling - it will detect the status change
    // and resume on its own. No need to start a new loop.
    logger.info('Session loop still active, will resume on next poll', { sessionId: session.id });
  } else {
    // Session loop has stopped (e.g., manual pause) - need to restart it
    logger.info('Restarting council loop for resumed session', { sessionId: session.id });
    runCouncilLoop(session.id, userId).catch(err => {
      logger.error('Council loop error on resume', { sessionId: session.id, error: err.message });
    });
  }

  return session;
}

// ============================================
// Session History
// ============================================

export async function getSessions(userId: string, limit = 20, offset = 0): Promise<AutonomousSession[]> {
  const result = await pool.query(
    `SELECT * FROM autonomous_sessions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return result.rows.map(mapSessionRow);
}

export async function getSession(sessionId: string, userId: string): Promise<AutonomousSession | null> {
  const result = await pool.query(
    `SELECT * FROM autonomous_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  return result.rows.length > 0 ? mapSessionRow(result.rows[0]) : null;
}

// ============================================
// SSE Subscription
// ============================================

export function subscribeToSession(sessionId: string, callback: (data: unknown) => void): () => void {
  const tracked = activeSessions.get(sessionId);
  if (!tracked) {
    // Session not active, return no-op unsubscribe
    return () => {};
  }

  tracked.subscribers.add(callback);

  // Return unsubscribe function
  return () => {
    tracked.subscribers.delete(callback);
  };
}

export function isSessionRunning(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

function broadcastToSession(sessionId: string, data: unknown): void {
  const tracked = activeSessions.get(sessionId);
  if (tracked) {
    tracked.subscribers.forEach(callback => callback(data));
  }
}

// ============================================
// Council Loop
// ============================================

async function runCouncilLoop(
  sessionId: string,
  userId: string,
  taskDescription?: string
): Promise<void> {
  let loopCount = 0;
  let pausedForQuestion = false;
  let planCreated = false;

  // If we have a task, run planning phase first
  if (taskDescription) {
    try {
      broadcastToSession(sessionId, {
        type: 'phase_start',
        phase: 'planning',
        loopCount: 0,
        toolUseCount: getToolUseCount(sessionId),
        maxToolUses: MAX_TOOL_USES,
      });

      const plan = await runPlanningPhase(sessionId, userId, taskDescription);
      planCreated = true;

      // Store the plan
      await pool.query(
        `UPDATE autonomous_sessions SET task_plan = $1 WHERE id = $2`,
        [plan, sessionId]
      );

      broadcastToSession(sessionId, {
        type: 'council_message',
        phase: 'planning',
        speaker: 'luna',
        message: plan,
        loopCount: 0,
      });

      broadcastToSession(sessionId, {
        type: 'phase_end',
        phase: 'planning',
        loopCount: 0,
      });

      // Add plan to session notes
      await sessionWorkspaceService.addPlanningNote(
        sessionId,
        userId,
        plan,
        'planning',
        'Task Plan'
      );
    } catch (error) {
      logger.error('Planning phase failed', { sessionId, error });
      broadcastToSession(sessionId, {
        type: 'error',
        message: `Planning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  while (loopCount < MAX_LOOPS) {
    // Check tool use limit
    if (!canUseTool(sessionId)) {
      logger.info('Tool use limit reached', { sessionId, count: getToolUseCount(sessionId) });
      broadcastToSession(sessionId, {
        type: 'tool_limit_reached',
        toolUseCount: getToolUseCount(sessionId),
        maxToolUses: MAX_TOOL_USES,
      });
      await sessionWorkspaceService.addNote(sessionId, userId, {
        noteType: 'observation',
        content: `Tool use limit (${MAX_TOOL_USES}) reached. Session ending.`,
        phase: 'act',
      });
      break;
    }

    // Check if session is still active or paused
    const session = await getSession(sessionId, userId);
    if (!session) {
      break;
    }

    // Check if session was stopped (completed/failed) - exit immediately
    if (session.status === 'completed' || session.status === 'stopped' || session.status === 'error') {
      logger.info('Session was stopped, exiting loop', { sessionId, status: session.status });
      break;
    }

    // Also check if we were removed from active tracking (user pressed stop)
    if (!activeSessions.has(sessionId)) {
      logger.info('Session removed from active tracking, exiting loop', { sessionId });
      break;
    }

    if (session.status === 'paused') {
      // Check if we were paused for a question that has been answered
      const answeredQuestions = await questionsService.getRecentlyAnsweredQuestions(
        sessionId,
        new Date(Date.now() - 30 * 60 * 1000) // Last 30 minutes
      );

      if (answeredQuestions.length > 0 && pausedForQuestion) {
        // Only resume if we were paused for a question (not manually stopped)
        // Resume session with the answer
        await pool.query(
          `UPDATE autonomous_sessions SET status = 'active' WHERE id = $1`,
          [sessionId]
        );

        // Broadcast the answered questions
        for (const q of answeredQuestions) {
          broadcastToSession(sessionId, {
            type: 'question_answered',
            questionId: q.id,
            question: q.question,
            answer: q.userResponse,
          });
        }

        pausedForQuestion = false;
        // Continue to re-fetch session with updated status
        continue;
      } else if (pausedForQuestion) {
        // Still waiting for answer, check again in a bit
        await sleep(5000);
        continue;
      } else {
        // Manually paused or stopped, stop the loop
        logger.info('Session manually paused, exiting loop', { sessionId });
        break;
      }
    }

    if (session.status !== 'active') {
      break;
    }

    loopCount++;

    try {
      // Update loop count in DB
      await pool.query(
        `UPDATE autonomous_sessions SET loop_count = $1, tool_use_count = $2 WHERE id = $3`,
        [loopCount, getToolUseCount(sessionId), sessionId]
      );

      // Add planning note at loop start
      await sessionWorkspaceService.addPlanningNote(
        sessionId,
        userId,
        `Starting loop ${loopCount}${planCreated ? ' (executing plan)' : ''}`,
        'polaris',
        `Loop ${loopCount} Start`
      );

      // Check user availability - if not available, don't pause for questions
      const userAvailable = await questionsService.getUserAvailability(userId);

      // Check for ANY pending questions before running council phases
      const existingPendingQuestions = await questionsService.getPendingQuestions(userId);
      const sessionPendingQuestions = existingPendingQuestions.filter(q => q.sessionId === sessionId);

      if (sessionPendingQuestions.length > 0) {
        if (userAvailable) {
          // User is available - pause and wait for answer
          if (!pausedForQuestion) {
            logger.info('Existing pending questions found, pausing session', {
              sessionId,
              questionCount: sessionPendingQuestions.length,
            });

            await pool.query(
              `UPDATE autonomous_sessions SET status = 'paused', pause_reason = 'waiting_for_answer' WHERE id = $1`,
              [sessionId]
            );

            broadcastToSession(sessionId, {
              type: 'waiting_for_answer',
              questions: sessionPendingQuestions.map(q => ({
                id: q.id,
                question: q.question,
                context: q.context,
                priority: q.priority,
              })),
            });

            pausedForQuestion = true;
          }

          // Sleep before checking again to avoid tight loop
          await sleep(5000);
          continue;
        } else {
          // User is NOT available - dismiss pending questions and continue autonomously
          logger.info('User not available, dismissing pending questions and continuing autonomously', {
            sessionId,
            questionCount: sessionPendingQuestions.length,
          });

          for (const q of sessionPendingQuestions) {
            await questionsService.dismissQuestion(q.id, userId);
          }

          // Add note that we're proceeding without user input
          await sessionWorkspaceService.addNote(sessionId, userId, {
            noteType: 'decision',
            content: `User not available - proceeding autonomously. Dismissed ${sessionPendingQuestions.length} pending question(s). Will use search and web fetch to find needed information.`,
            phase: 'polaris',
          });

          broadcastToSession(sessionId, {
            type: 'autonomous_continue',
            message: 'User not available, continuing autonomously',
            dismissedQuestions: sessionPendingQuestions.length,
          });

          pausedForQuestion = false;
        }
      }

      // Run through the council phases
      await runPhase(sessionId, userId, 'polaris', loopCount);
      await runPhase(sessionId, userId, 'aurora', loopCount);
      await runPhase(sessionId, userId, 'vega', loopCount);
      await runPhase(sessionId, userId, 'sol', loopCount, userAvailable);

      // Check for urgent questions before executing action (only if user is available)
      if (userAvailable) {
        const urgentQuestions = await questionsService.getUnansweredUrgentQuestions(sessionId);

        if (urgentQuestions.length > 0) {
          // Pause and wait for user response
          await pool.query(
            `UPDATE autonomous_sessions SET status = 'paused' WHERE id = $1`,
            [sessionId]
          );

          broadcastToSession(sessionId, {
            type: 'waiting_for_answer',
            questions: urgentQuestions.map(q => ({
              id: q.id,
              question: q.question,
              context: q.context,
              priority: q.priority,
            })),
          });

          pausedForQuestion = true;
          continue;
        }
      }

      // Execute the action (pass userAvailable so ask-user works correctly)
      await runPhase(sessionId, userId, 'act', loopCount, userAvailable);

      // Check if we asked a question - if so, pause and wait for answer
      const pendingQuestions = await questionsService.getPendingQuestions(userId);
      const sessionQuestions = pendingQuestions.filter(q => q.sessionId === sessionId);

      if (sessionQuestions.length > 0) {
        // We asked a question - pause the session and wait for answer
        await pool.query(
          `UPDATE autonomous_sessions SET status = 'paused', pause_reason = 'waiting_for_answer' WHERE id = $1`,
          [sessionId]
        );

        broadcastToSession(sessionId, {
          type: 'waiting_for_answer',
          questions: sessionQuestions.map(q => ({
            id: q.id,
            question: q.question,
            context: q.context,
            priority: q.priority,
          })),
        });

        pausedForQuestion = true;
        logger.info('Session paused waiting for user answer', { sessionId, questionCount: sessionQuestions.length });
        continue; // Go back to top of loop to wait for answer
      }

      // Check if Sol decided to sleep (ONLY if the decision is EXACTLY "sleep")
      const deliberation = await councilService.getLatestDeliberation(sessionId);
      const decisionLower = deliberation?.decision?.toLowerCase().trim() || '';

      // CIRCUIT BREAKER: Detect spinning (same action type repeated N times)
      if (deliberation?.decision && isSpinning(sessionId, deliberation.decision)) {
        logger.warn('Spinning detected - forcing session pause', {
          sessionId,
          loopCount,
          lastDecision: deliberation.decision,
        });

        await sessionWorkspaceService.addNote(sessionId, userId, {
          noteType: 'observation',
          content: `Circuit breaker triggered: Same action type repeated ${MAX_REPEATED_ACTIONS} times. Session pausing to break the cycle.`,
          phase: 'act',
        });

        broadcastToSession(sessionId, {
          type: 'circuit_breaker',
          message: 'Spinning detected - session pausing',
          loopCount,
        });

        await sessionWorkspaceService.addSessionSummary(
          sessionId,
          userId,
          `Session paused after ${loopCount} loops due to spinning detection. Last decision: ${deliberation?.decision}`
        );
        break;
      }

      // End only if any line in the decision is specifically a sleep/pause/complete command
      const decisionLines = decisionLower.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const shouldSleep = decisionLines.some(line =>
        line === 'sleep' || line === 'pause' || line === 'complete' ||
        line.startsWith('sleep:') || line.startsWith('sleep -')
      );

      if (shouldSleep) {
        // Add session summary note
        await sessionWorkspaceService.addSessionSummary(
          sessionId,
          userId,
          `Session completed after ${loopCount} loops, ${getToolUseCount(sessionId)} tool uses. Final decision: ${deliberation?.decision}`
        );
        clearActionHistory(sessionId);
        break;
      }

      // Brief pause between loops
      await sleep(2000);

    } catch (error) {
      logger.error('Council loop phase error', { sessionId, loopCount, error });

      // Add error note
      await sessionWorkspaceService.addNote(sessionId, userId, {
        noteType: 'observation',
        content: `Error in loop ${loopCount}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        phase: 'act',
      });

      // Mark session as error
      await pool.query(
        `UPDATE autonomous_sessions SET status = 'error', ended_at = NOW() WHERE id = $1`,
        [sessionId]
      );

      broadcastToSession(sessionId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });

      break;
    }
  }

  // Complete the session
  const finalSession = await getSession(sessionId, userId);
  if (finalSession?.status === 'active') {
    await pool.query(
      `UPDATE autonomous_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1`,
      [sessionId]
    );

    broadcastToSession(sessionId, { type: 'session_end', sessionId });
  }

  // Clean up
  activeSessions.delete(sessionId);
}

async function runPhase(sessionId: string, userId: string, phase: SessionPhase, loopCount: number, userAvailable?: boolean): Promise<void> {
  // Skip planning phase here - it's handled separately at session start
  if (phase === 'planning') return;

  // Update current phase
  await pool.query(
    `UPDATE autonomous_sessions SET current_phase = $1 WHERE id = $2`,
    [phase, sessionId]
  );

  broadcastToSession(sessionId, {
    type: 'phase_start',
    phase,
    loopCount,
    toolUseCount: getToolUseCount(sessionId),
    maxToolUses: MAX_TOOL_USES,
  });

  if (phase === 'act') {
    // Execute the action decided by Sol
    await executeAction(sessionId, userId, userAvailable);
  } else {
    // Get council member response (counts as a tool use)
    incrementToolUse(sessionId);
    const response = await councilService.getCouncilResponse(sessionId, userId, phase, userAvailable);

    broadcastToSession(sessionId, {
      type: 'council_message',
      phase,
      speaker: phase,
      message: response.message,
      loopCount,
      toolUseCount: getToolUseCount(sessionId),
    });
  }

  broadcastToSession(sessionId, {
    type: 'phase_end',
    phase,
    loopCount,
    toolUseCount: getToolUseCount(sessionId),
  });
}

// ============================================
// Planning Phase
// ============================================

async function runPlanningPhase(
  sessionId: string,
  userId: string,
  taskDescription: string
): Promise<string> {
  const { provider, model } = await councilService.getUserModelConfigForCouncil(userId);

  // Get session context
  const goals = await goalsService.getGoals(userId, { status: 'active', limit: 5 });
  const tasks = await tasksService.getTasks(userId, { status: 'pending', limit: 10 });
  const session = await getSession(sessionId, userId);

  const systemPrompt = `You are Luna, an AI assistant planning how to accomplish a task.

Your job is to:
1. Clarify what the task is asking for
2. Break it down into clear steps
3. Identify what tools or information you'll need
4. Note any questions you might need to ask the user

Available capabilities:
- Search the web for information
- Fetch and read web pages
- Store documents for later reference
- Create and manage tasks
- Ask the user questions
- Take notes and record findings
- Expert discussion mode for complex/philosophical topics

Be specific and actionable. Format your plan clearly.`;

  const userPrompt = `Task: ${taskDescription}

${session?.sessionMode === 'expert_discussion' ? 'Mode: Expert Discussion - This requires thoughtful analysis and multiple perspectives.' : ''}

Context:
- Active goals: ${goals.length > 0 ? goals.map(g => g.title).join(', ') : 'None'}
- Pending tasks: ${tasks.length > 0 ? tasks.map(t => t.title).join(', ') : 'None'}

Create a plan to accomplish this task. Include:
1. Task Understanding - What exactly needs to be done?
2. Steps - What are the concrete steps?
3. Tools Needed - What will you use (search, fetch pages, ask user, etc.)?
4. Potential Questions - What might you need to ask the user?
5. Success Criteria - How will you know when the task is complete?`;

  incrementToolUse(sessionId);

  const result = await councilService.createCompletionWithConfig(provider, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], {
    temperature: 0.7,
    maxTokens: 1500,
    loggingContext: {
      userId,
      sessionId,
      source: 'autonomous',
      nodeName: 'autonomous_task_plan',
    },
  });

  return result.content;
}

async function executeAction(sessionId: string, userId: string, userAvailable?: boolean): Promise<void> {
  // Get the decision from Sol
  const deliberation = await councilService.getLatestDeliberation(sessionId);
  if (!deliberation?.decision) {
    broadcastToSession(sessionId, {
      type: 'action',
      action: 'No action decided',
    });
    return;
  }

  // Split Sol's decision into individual action lines - Sol often outputs multiple actions at once
  const actionLines = deliberation.decision
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'))
    .filter(line => {
      // Exclude pure sleep/pause lines - those are handled by the loop's sleep check
      const lower = line.toLowerCase();
      return lower !== 'sleep' && lower !== 'pause' && lower !== 'complete' &&
             !lower.startsWith('sleep:') && !lower.startsWith('sleep -');
    });

  if (actionLines.length === 0) {
    // Decision was only "sleep" or empty - loop will handle termination
    broadcastToSession(sessionId, { type: 'action', action: 'Session complete' });
    return;
  }

  const actionsTaken: string[] = [];
  for (const actionLine of actionLines) {
    incrementToolUse(sessionId);
    const result = await dispatchSingleAction(sessionId, userId, actionLine, deliberation, userAvailable);
    actionsTaken.push(result);
  }

  const actionTaken = actionsTaken.join('\n');

  // Update deliberation with all actions taken
  await pool.query(
    `UPDATE council_deliberations SET action_taken = $1 WHERE id = $2`,
    [actionTaken, deliberation.id]
  );

  broadcastToSession(sessionId, {
    type: 'action',
    action: actionTaken,
  });
}

async function dispatchSingleAction(
  sessionId: string,
  userId: string,
  action: string,
  deliberation: councilService.CouncilDeliberation,
  userAvailable?: boolean,
): Promise<string> {
  const actionLower = action.toLowerCase();

  // If user is not available and action is to ask user, convert to search instead
  const isAskUserAction = actionLower.startsWith('ask user:') || actionLower.startsWith('ask:') || actionLower.startsWith('question:');
  if (!userAvailable && isAskUserAction) {
    logger.info('User not available, converting ask-user action to search', { sessionId, originalAction: action });

    const questionMatch = action.match(/ask.*?[":]\s*(.+?)(?:["]|$)/i)
      || action.match(/question.*?[":]\s*(.+?)(?:["]|$)/i);
    const searchQuery = questionMatch?.[1]?.trim() || action.replace(/ask|user|question/gi, '').trim();

    await sessionWorkspaceService.addNote(sessionId, userId, {
      noteType: 'decision',
      content: `User not available. Instead of asking "${searchQuery}", searching the web for information.`,
      phase: 'act',
    });

    return await executeSearchAction(sessionId, userId, `search: ${searchQuery}`);
  }

  // Route to handler - use startsWith for reliable matching, most specific patterns first
  if (actionLower.startsWith('note:') || actionLower.startsWith('record:') || actionLower.startsWith('remember:')) {
    return await executeNoteAction(sessionId, userId, action);
  } else if (actionLower.startsWith('ask user:') || actionLower.startsWith('ask:') || actionLower.startsWith('question:')) {
    return await executeAskUserAction(sessionId, userId, action, deliberation);
  } else if (actionLower.startsWith('search:') || actionLower.startsWith('find:') || (actionLower.includes('search') && actionLower.includes('web'))) {
    return await executeSearchAction(sessionId, userId, action);
  } else if (actionLower.startsWith('create task:') || actionLower.startsWith('add task:') || actionLower.startsWith('new task:')) {
    return await executeCreateTaskAction(sessionId, userId, action);
  } else if (actionLower.startsWith('complete task:') || actionLower.startsWith('done:') || actionLower.startsWith('finish task:')) {
    return await executeCompleteTaskAction(sessionId, userId, action);
  } else if (actionLower.startsWith('write file:') || actionLower.startsWith('save file:') || actionLower.startsWith('create file:')) {
    return await executeWriteFileAction(sessionId, userId, action);
  } else if (actionLower.startsWith('read file:') || actionLower.startsWith('read:')) {
    return await executeReadFileAction(sessionId, userId, action);
  } else if (actionLower.startsWith('fetch:') || actionLower.startsWith('fetch web page:') || actionLower.startsWith('fetch url:') || (actionLower.includes('fetch') && actionLower.includes('url'))) {
    return await executeWebFetchAndStoreAction(sessionId, userId, action);
  } else if (actionLower.includes('collect') || (actionLower.includes('research') && actionLower.includes('add'))) {
    return await executeCollectResearchAction(sessionId, userId, action);
  } else if (actionLower.startsWith('goal:')) {
    return await executeGoalAction(userId, action);
  } else if (actionLower.includes('research') || actionLower.includes('rss')) {
    return await executeResearchAction(userId, action, sessionId);
  } else if (actionLower.includes('insight') || actionLower.includes('share')) {
    return await executeInsightAction(userId, action, deliberation);
  } else if (actionLower.includes('discuss') || actionLower.includes('debate') || actionLower.includes('analyze')) {
    return await executeExpertDiscussionAction(sessionId, userId, action, deliberation);
  } else if (actionLower.includes('friend') || actionLower.includes('chat with') || actionLower.includes('talk to nova') || actionLower.includes('talk to sage') || actionLower.includes('talk to spark') || actionLower.includes('talk to echo')) {
    return await executeFriendDiscussionAction(sessionId, userId, action);
  } else if (actionLower.includes('reflect') || actionLower.includes('think about') || actionLower.includes('ponder')) {
    return await executeFriendDiscussionAction(sessionId, userId, 'reflect on user patterns');
  } else {
    await sessionWorkspaceService.addObservation(sessionId, userId, action, 'act');
    return `Decided: ${action}`;
  }
}

async function executeGoalAction(userId: string, action: string): Promise<string> {
  const lower = action.toLowerCase();

  if (lower.includes('create')) {
    // Parse title: try quoted string first, then text after "create"
    let title = '';
    let description = action;

    const quotedMatch = action.match(/"([^"]+)"/);
    if (quotedMatch) {
      title = quotedMatch[1].trim();
    } else {
      // Strip "goal: create/update" or "goal: create" prefix and use remainder as title
      const afterCreate = action.replace(/^goal\s*:\s*(create\/update|create|update)\s*/i, '').trim();
      // If there's a " - " separator, first part is title, rest is description
      const dashIdx = afterCreate.indexOf(' - ');
      if (dashIdx > 0) {
        title = afterCreate.slice(0, dashIdx).trim();
        description = afterCreate.slice(dashIdx + 3).trim();
      } else {
        title = afterCreate || 'New goal';
        description = action;
      }
    }

    if (!title) {
      return 'Goal action: could not parse title from action';
    }

    const goal = await goalsService.createGoal(userId, {
      goalType: 'self_improvement',
      title,
      description,
      priority: 5,
      createdBy: 'luna',
    });
    return `Created goal: "${goal.title}"`;

  } else if (lower.includes('update') || lower.includes('complete')) {
    // Extract title to find the goal
    const quotedMatch = action.match(/"([^"]+)"/);
    const titleQuery = quotedMatch?.[1]?.trim();

    if (titleQuery) {
      // Find goal by title (case-insensitive)
      const goals = await goalsService.getGoals(userId, { status: 'active' });
      const match = goals.find(g => g.title.toLowerCase().includes(titleQuery.toLowerCase()));
      if (match) {
        const isComplete = lower.includes('complete') || lower.includes('done') || lower.includes('status: completed');
        if (isComplete) {
          await goalsService.updateGoal(match.id, userId, { status: 'completed' });
          return `Completed goal: "${match.title}"`;
        }
        return `Found goal "${match.title}" - no specific update applied`;
      }
      return `Goal not found: "${titleQuery}"`;
    }
    return `Goal update: could not parse title from action`;
  }

  return `Goal action recorded: ${action}`;
}

async function executeResearchAction(userId: string, _action: string, sessionId: string): Promise<string> {
  // Trigger newsfetcher ingestion
  await newsfetcherService.triggerIngestion();

  // Create or update research collection for this session
  const collections = await researchService.getCollections(userId, { sessionId, limit: 1 });
  if (collections.length === 0) {
    await researchService.createCollection(userId, {
      title: 'Research Session',
      description: 'Auto-generated research collection',
      sessionId,
    });
  }

  return 'Triggered news ingestion and prepared research collection';
}

async function executeAskUserAction(
  sessionId: string,
  userId: string,
  action: string,
  deliberation: councilService.CouncilDeliberation
): Promise<string> {
  // Extract the question from the action
  // Pattern: "ask user: <question>" - capture everything after the colon
  const questionMatch = action.match(/ask\s+user\s*:\s*(.+)$/i)
    || action.match(/question\s*:\s*(.+)$/i);

  const question = questionMatch?.[1]?.trim() || action;

  // Determine priority (urgent if marked or seems important)
  const isUrgent = action.toLowerCase().includes('urgent') ||
                   action.toLowerCase().includes('important') ||
                   action.toLowerCase().includes('critical');

  const priority = isUrgent ? 9 : 5;

  // Create the question
  const createdQuestion = await questionsService.askQuestion(userId, sessionId, {
    question,
    context: deliberation.summary || undefined,
    priority,
    goalId: undefined,
  });

  // Broadcast the question
  broadcastToSession(sessionId, {
    type: 'question_asked',
    questionId: createdQuestion.id,
    question: createdQuestion.question,
    context: createdQuestion.context,
    priority: createdQuestion.priority,
  });

  // Add note about the question
  await sessionWorkspaceService.addNote(sessionId, userId, {
    noteType: 'question',
    content: `Asked user: ${question}`,
    phase: 'act',
    metadata: { questionId: createdQuestion.id },
  });

  return `Asked user: ${question} (priority: ${priority})`;
}

async function executeNoteAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Extract the note content
  const noteMatch = action.match(/(?:note|record|remember)[^:]*:\s*(.+)/i);
  const noteContent = noteMatch?.[1]?.trim() || action;

  // Determine note type based on content
  let noteType: sessionWorkspaceService.NoteType = 'observation';
  if (action.toLowerCase().includes('decision') || action.toLowerCase().includes('decided')) {
    noteType = 'decision';
  } else if (action.toLowerCase().includes('finding') || action.toLowerCase().includes('found')) {
    noteType = 'finding';
  } else if (action.toLowerCase().includes('plan') || action.toLowerCase().includes('planning')) {
    noteType = 'planning';
  }

  // Add the note
  const note = await sessionWorkspaceService.addNote(sessionId, userId, {
    noteType,
    content: noteContent,
    phase: 'act',
  });

  broadcastToSession(sessionId, {
    type: 'note_added',
    noteId: note.id,
    noteType: note.noteType,
    content: note.content,
  });

  return `Noted (${noteType}): ${noteContent.substring(0, 100)}${noteContent.length > 100 ? '...' : ''}`;
}

async function executeCollectResearchAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Get or create research collection for this session
  let collections = await researchService.getCollections(userId, { sessionId, limit: 1 });
  let collection: researchService.ResearchCollection;

  if (collections.length === 0) {
    collection = await researchService.createCollection(userId, {
      title: 'Research Collection',
      description: `Auto-generated from autonomous session`,
      sessionId,
    });
  } else {
    collection = collections[0];
  }

  // Check if there's a URL to fetch
  const urlMatch = action.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    try {
      const page = await webfetchService.fetchPage(url);

      await researchService.addResearchItem(collection.id, userId, {
        sourceType: 'web_page',
        sourceUrl: url,
        title: page.title || undefined,
        content: page.content.substring(0, 10000),
        summary: page.content.substring(0, 500),
        relevanceScore: 0.7,
      });

      return `Added web page to research collection: ${page.title || url}`;
    } catch (error) {
      return `Failed to add to research: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // Extract any findings from the action
  const findingMatch = action.match(/(?:collect|add|research)[^:]*:\s*(.+)/i);
  if (findingMatch) {
    await researchService.addResearchItem(collection.id, userId, {
      sourceType: 'user_input',
      content: findingMatch[1],
      summary: findingMatch[1].substring(0, 200),
      relevanceScore: 0.5,
    });
    return `Added finding to research collection`;
  }

  return `Research collection ready: ${collection.title}`;
}

async function executeInsightAction(
  userId: string,
  action: string,
  deliberation: councilService.CouncilDeliberation
): Promise<string> {
  // Create a proactive insight
  await insightsService.createInsight(userId, {
    sourceType: 'council_deliberation',
    sourceId: deliberation.id,
    insightTitle: 'Council Discussion Insight',
    insightContent: deliberation.summary || action,
    priority: 5,
  });

  return 'Created insight for user';
}

async function executeCreateTaskAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Extract task details from action
  const taskMatch = action.match(/(?:create|add|new)\s+task[^:]*:\s*(.+)/i);
  const taskText = taskMatch?.[1]?.trim() || action.replace(/create|add|new|task/gi, '').trim();

  // Parse the task
  const parsed = tasksService.parseTaskFromText(taskText);
  // NOTE: Don't set sourceSessionId - that's for chat sessions, not autonomous sessions

  // Create the task
  const task = await tasksService.createTask(userId, {
    title: parsed.title || taskText,
    description: parsed.description,
    dueAt: parsed.dueAt,
    remindAt: parsed.remindAt,
    priority: parsed.priority || 'medium',
    // sourceSessionId omitted - autonomous sessions aren't chat sessions
  });

  // Add note about the task creation
  await sessionWorkspaceService.addDecision(
    sessionId,
    userId,
    `Created task: ${task.title}${task.dueAt ? ` (due: ${task.dueAt.toISOString().split('T')[0]})` : ''}`,
    'act'
  );

  broadcastToSession(sessionId, {
    type: 'task_created',
    taskId: task.id,
    title: task.title,
    priority: task.priority,
  });

  return `Created task: ${task.title}`;
}

async function executeCompleteTaskAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Get user's pending tasks
  const tasks = await tasksService.getTasks(userId, { status: 'pending', limit: 20 });

  if (tasks.length === 0) {
    return 'No pending tasks to complete';
  }

  // Try to find a matching task by title
  const titleMatch = action.match(/(?:complete|done|finish)\s+task[^:]*:\s*(.+)/i);
  const searchTitle = titleMatch?.[1]?.trim().toLowerCase() || '';

  let taskToComplete: tasksService.Task | undefined;

  if (searchTitle) {
    taskToComplete = tasks.find(t =>
      t.title.toLowerCase().includes(searchTitle) ||
      searchTitle.includes(t.title.toLowerCase())
    );
  }

  if (!taskToComplete) {
    // Just complete the first/highest priority task if no match
    taskToComplete = tasks[0];
  }

  // Complete the task
  const completed = await tasksService.updateTaskStatus(userId, taskToComplete.id, 'completed');

  if (completed) {
    await sessionWorkspaceService.addDecision(
      sessionId,
      userId,
      `Completed task: ${completed.title}`,
      'act'
    );

    broadcastToSession(sessionId, {
      type: 'task_completed',
      taskId: completed.id,
      title: completed.title,
    });

    return `Completed task: ${completed.title}`;
  }

  return 'Failed to complete task';
}

async function executeWriteFileAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Extract filename and content
  const fileMatch = action.match(/(?:write|save|create)\s+file[^:]*:\s*([^\n]+)/i);
  if (!fileMatch) {
    return 'Could not parse file action - use format: "write file: filename.ext"';
  }

  const filename = fileMatch[1].trim();

  // Look for content after the filename
  const contentMatch = action.match(/content[:\s]+(.+)/is);
  const content = contentMatch?.[1]?.trim() || '';

  if (!content) {
    return `No content provided for file ${filename}`;
  }

  try {
    const file = await workspaceService.writeFile(userId, filename, content);

    await sessionWorkspaceService.addDecision(
      sessionId,
      userId,
      `Wrote file: ${filename} (${file.size} bytes)`,
      'act'
    );

    broadcastToSession(sessionId, {
      type: 'file_written',
      filename,
      size: file.size,
    });

    return `Wrote file: ${filename} (${file.size} bytes)`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return `Failed to write file: ${errorMessage}`;
  }
}

async function executeReadFileAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Extract filename
  const fileMatch = action.match(/(?:read)\s+file[^:]*:\s*([^\n]+)/i);
  if (!fileMatch) {
    return 'Could not parse file action - use format: "read file: filename.ext"';
  }

  const filename = fileMatch[1].trim();

  try {
    const content = await workspaceService.readFile(userId, filename);

    // Add the content as a finding
    await sessionWorkspaceService.addFinding(
      sessionId,
      userId,
      `Read file: ${filename}\n\nContent:\n${content.substring(0, 2000)}${content.length > 2000 ? '...[truncated]' : ''}`,
      'act',
      { filename, contentLength: content.length }
    );

    broadcastToSession(sessionId, {
      type: 'file_read',
      filename,
      contentLength: content.length,
    });

    return `Read file: ${filename} (${content.length} characters)`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return `Failed to read file: ${errorMessage}`;
  }
}

// ============================================
// Search Action
// ============================================

async function executeSearchAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Extract search query from the action
  const queryMatch = action.match(/search[^:]*:\s*["']?([^"'\n]+)["']?/i)
    || action.match(/find[^:]*:\s*["']?([^"'\n]+)["']?/i)
    || action.match(/search\s+(?:for\s+)?["']?([^"'\n]+)["']?/i);

  let query = queryMatch?.[1]?.trim() || action.replace(/search|find|web|internet|for/gi, '').trim();

  // Clean up malformed queries (numbered lists, bullet points, etc.)
  // If query starts with "1)" or "1." or "-", extract just the first meaningful phrase
  if (/^[\d\-\*\)\.]+\s/.test(query)) {
    // Remove the numbering/bullet and take first sentence or phrase
    query = query.replace(/^[\d\-\*\)\.]+\s*/, '').split(/[,;]|\s{2,}/)[0].trim();
  }

  // If query is too long (probably a full paragraph), take first phrase
  if (query.length > 100) {
    query = query.substring(0, 100).split(/[,;.]/).slice(0, 2).join(' ').trim();
  }

  if (!query || query.length < 3) {
    await sessionWorkspaceService.addObservation(sessionId, userId, `Could not extract search query from: ${action}`, 'act');
    return 'Could not determine search query';
  }

  try {
    broadcastToSession(sessionId, {
      type: 'search_start',
      query,
    });

    const results = await searxngClient.search(query, { maxResults: 5 });

    if (results.length === 0) {
      await sessionWorkspaceService.addObservation(sessionId, userId, `No search results found for: ${query}`, 'act');
      return `Search for "${query}" returned no results`;
    }

    // Format results for session notes
    const formattedResults = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet || ''}`
    ).join('\n\n');

    await sessionWorkspaceService.addFinding(
      sessionId,
      userId,
      `Search results for "${query}":\n\n${formattedResults}`,
      'act',
      { query, resultCount: results.length }
    );

    broadcastToSession(sessionId, {
      type: 'search_complete',
      query,
      resultCount: results.length,
      results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    });

    return `Found ${results.length} results for "${query}"`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await sessionWorkspaceService.addObservation(sessionId, userId, `Search failed for "${query}": ${errorMessage}`, 'act');
    return `Search failed: ${errorMessage}`;
  }
}

// ============================================
// Web Fetch and Store as Document
// ============================================

async function executeWebFetchAndStoreAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Extract URL from the action
  const urlMatch = action.match(/https?:\/\/[^\s"'<>]+/i);
  if (!urlMatch) {
    await sessionWorkspaceService.addObservation(sessionId, userId, `Could not find URL in action: ${action}`, 'act');
    return 'No URL found in action';
  }

  const url = urlMatch[0];

  try {
    broadcastToSession(sessionId, {
      type: 'web_fetch_start',
      url,
    });

    const page = await webfetchService.fetchPage(url);

    // Store as a document for processing
    const docContent = `# ${page.title || 'Fetched Page'}\n\nSource: ${url}\nFetched: ${new Date().toISOString()}\n\n${page.content}`;

    try {
      const doc = await documentsService.uploadDocument(userId, {
        buffer: Buffer.from(docContent, 'utf-8'),
        originalname: `fetched_${new Date().getTime()}.md`,
        mimetype: 'text/markdown',
      });

      await sessionWorkspaceService.addFinding(
        sessionId,
        userId,
        `Fetched and stored: ${page.title || 'Untitled'}\nURL: ${url}\nDocument ID: ${doc.id}\nWord count: ${page.wordCount}`,
        'act',
        { url, title: page.title, wordCount: page.wordCount, documentId: doc.id }
      );

      broadcastToSession(sessionId, {
        type: 'document_created',
        documentId: doc.id,
        url,
        title: page.title,
      });

      return `Fetched and stored: ${page.title || url} (${page.wordCount} words) as document ${doc.id}`;
    } catch (docError) {
      // If document storage fails, still record the finding
      await sessionWorkspaceService.addFinding(
        sessionId,
        userId,
        `Fetched page: ${page.title || 'Untitled'}\nURL: ${url}\nWord count: ${page.wordCount}\n\nContent preview: ${page.content.substring(0, 1000)}...`,
        'act',
        { url, title: page.title, wordCount: page.wordCount }
      );

      broadcastToSession(sessionId, {
        type: 'web_fetched',
        url,
        title: page.title,
        wordCount: page.wordCount,
      });

      return `Fetched web page: ${page.title || url} (${page.wordCount} words) - document storage failed`;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await sessionWorkspaceService.addObservation(sessionId, userId, `Failed to fetch ${url}: ${errorMessage}`, 'act');
    return `Failed to fetch ${url}: ${errorMessage}`;
  }
}

// ============================================
// Expert Discussion Action
// ============================================

async function executeExpertDiscussionAction(
  sessionId: string,
  userId: string,
  action: string,
  _deliberation: councilService.CouncilDeliberation
): Promise<string> {
  // Extract the topic to discuss
  const topicMatch = action.match(/(?:discuss|debate|analyze)[^:]*:\s*(.+)/i);
  const topic = topicMatch?.[1]?.trim() || action;

  const { provider, model } = await councilService.getUserModelConfigForCouncil(userId);

  // Run a multi-perspective expert discussion
  const perspectives = [
    { name: 'Philosopher', focus: 'ethical implications, fundamental principles, and deeper meaning' },
    { name: 'Pragmatist', focus: 'practical applications, real-world impact, and actionable insights' },
    { name: 'Critic', focus: 'potential flaws, counterarguments, and alternative viewpoints' },
    { name: 'Synthesizer', focus: 'combining perspectives into a coherent conclusion' },
  ];

  const discussionParts: string[] = [`Topic: ${topic}\n`];

  for (const perspective of perspectives) {
    incrementToolUse(sessionId);

    const prompt = `You are an expert ${perspective.name} analyzing this topic. Focus on ${perspective.focus}.

Topic: ${topic}

Previous discussion:
${discussionParts.join('\n')}

Provide your perspective in 2-3 concise paragraphs. Be specific and insightful.`;

    try {
      const result = await councilService.createCompletionWithConfig(provider, model, [
        { role: 'system', content: `You are ${perspective.name}, providing expert analysis.` },
        { role: 'user', content: prompt },
      ], {
        temperature: 0.8,
        maxTokens: 500,
        loggingContext: {
          userId,
          sessionId,
          source: 'autonomous',
          nodeName: `expert_${perspective.name.toLowerCase()}`,
        },
      });

      discussionParts.push(`\n**${perspective.name}:**\n${result.content}`);

      broadcastToSession(sessionId, {
        type: 'council_message',
        phase: 'act',
        speaker: perspective.name.toLowerCase(),
        message: result.content,
      });
    } catch (error) {
      logger.error(`Expert discussion failed for ${perspective.name}`, { error });
    }
  }

  // Store the full discussion
  const fullDiscussion = discussionParts.join('\n');
  await sessionWorkspaceService.addFinding(
    sessionId,
    userId,
    `Expert Discussion:\n${fullDiscussion}`,
    'act',
    { topic, perspectives: perspectives.map(p => p.name) }
  );

  return `Completed expert discussion on: ${topic.substring(0, 50)}...`;
}

// ============================================
// Friend Discussion Action
// ============================================

async function executeFriendDiscussionAction(
  sessionId: string,
  userId: string,
  action: string
): Promise<string> {
  // Try to select a topic based on user facts
  const topicData = await friendService.selectDiscussionTopic(userId);

  if (!topicData) {
    await sessionWorkspaceService.addObservation(
      sessionId,
      userId,
      'No patterns or facts available to discuss with friend yet.',
      'act'
    );
    return 'No patterns or facts available to discuss yet - need more conversations with user first.';
  }

  // Determine which friend to talk to (if specified in action)
  let friendId: string | undefined;
  const actionLower = action.toLowerCase();

  if (actionLower.includes('nova')) {
    const friends = await friendService.getFriends(userId);
    friendId = friends.find(f => f.name.toLowerCase() === 'nova')?.id;
  } else if (actionLower.includes('sage')) {
    const friends = await friendService.getFriends(userId);
    friendId = friends.find(f => f.name.toLowerCase() === 'sage')?.id;
  } else if (actionLower.includes('spark')) {
    const friends = await friendService.getFriends(userId);
    friendId = friends.find(f => f.name.toLowerCase() === 'spark')?.id;
  } else if (actionLower.includes('echo')) {
    const friends = await friendService.getFriends(userId);
    friendId = friends.find(f => f.name.toLowerCase() === 'echo')?.id;
  }
  // Otherwise, a random friend will be selected

  try {
    broadcastToSession(sessionId, {
      type: 'friend_discussion_start',
      topic: topicData.topic,
      triggerType: topicData.triggerType,
    });

    const conversation = await friendService.startFriendDiscussion(
      sessionId,
      userId,
      topicData.topic,
      topicData.context,
      topicData.triggerType,
      5, // 5 rounds of discussion
      friendId,
      topicData.topicCandidateId
    );

    // Broadcast each message
    for (const msg of conversation.messages) {
      broadcastToSession(sessionId, {
        type: 'friend_message',
        speaker: msg.speaker,
        message: msg.message,
      });
    }

    broadcastToSession(sessionId, {
      type: 'friend_discussion_end',
      summary: conversation.summary,
      factsExtracted: conversation.factsExtracted,
    });

    return `Friend discussion completed: "${topicData.topic.substring(0, 50)}..." - Extracted ${conversation.factsExtracted.length} insights`;
  } catch (error) {
    logger.error('Friend discussion failed', { sessionId, error });
    return `Friend discussion failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// ============================================
// Helpers
// ============================================

function mapConfigRow(row: Record<string, unknown>): AutonomousConfig {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    enabled: row.enabled as boolean,
    autoStart: row.auto_start as boolean,
    sessionIntervalMinutes: row.session_interval_minutes as number,
    maxDailySessions: row.max_daily_sessions as number,
    rssCheckIntervalMinutes: row.rss_check_interval_minutes as number,
    idleTimeoutMinutes: row.idle_timeout_minutes as number,
    learningEnabled: row.learning_enabled as boolean ?? true,
    rssEnabled: row.rss_enabled as boolean ?? true,
    insightsEnabled: row.insights_enabled as boolean ?? true,
    voiceEnabled: row.voice_enabled as boolean ?? true,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapSessionRow(row: Record<string, unknown>): AutonomousSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    status: row.status as AutonomousSession['status'],
    currentPhase: row.current_phase as AutonomousSession['currentPhase'],
    startedAt: new Date(row.started_at as string),
    endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    sessionType: row.session_type as string,
    sessionMode: (row.session_mode as AutonomousSession['sessionMode']) || 'standard',
    taskDescription: row.task_description as string | null,
    taskPlan: row.task_plan as string | null,
    summary: row.summary as string | null,
    insightsGenerated: (row.insights_generated as string[]) || [],
    loopCount: row.loop_count as number,
    toolUseCount: (row.tool_use_count as number) || 0,
    createdAt: new Date(row.created_at as string),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
