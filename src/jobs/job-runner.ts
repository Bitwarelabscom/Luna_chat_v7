import { pool } from '../db/index.js';
import * as preferencesService from '../memory/preferences.service.js';
import * as taskPatterns from '../abilities/task-patterns.service.js';
import * as oauthService from '../integrations/oauth.service.js';
import * as rssService from '../autonomous/rss.service.js';
import * as insightsService from '../autonomous/insights.service.js';
import * as triggerService from '../triggers/trigger.service.js';
import * as deliveryService from '../triggers/delivery.service.js';
import * as sessionLogService from '../chat/session-log.service.js';
import * as orderMonitorService from '../trading/order-monitor.service.js';
import * as botExecutorService from '../trading/bot-executor.service.js';
import * as scalpingService from '../trading/scalping.service.js';
import * as calendarReminderService from '../abilities/calendar-reminder.service.js';
import * as reminderService from '../abilities/reminder.service.js';
import logger from '../utils/logger.js';

// ============================================
// Job Definitions
// ============================================

interface Job {
  name: string;
  intervalMs: number;
  enabled: boolean;
  handler: () => Promise<void>;
  lastRun?: Date;
  running: boolean;
}

const jobs: Job[] = [
  {
    name: 'preferenceAnalyzer',
    intervalMs: 60 * 60 * 1000, // Hourly
    enabled: true,
    running: false,
    handler: analyzePreferences,
  },
  {
    name: 'taskPatternCalculator',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: calculateTaskPatterns,
  },
  {
    name: 'energyPatternUpdater',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: updateEnergyPatterns,
  },
  {
    name: 'tokenRefresher',
    intervalMs: 60 * 60 * 1000, // Hourly
    enabled: true,
    running: false,
    handler: refreshExpiringTokens,
  },
  {
    name: 'stateCleanup',
    intervalMs: 15 * 60 * 1000, // Every 15 minutes
    enabled: true,
    running: false,
    handler: cleanupExpiredStates,
  },
  {
    name: 'eventLogCleanup',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: cleanupOldEventLogs,
  },
  // Autonomous mode jobs
  {
    name: 'rssFeedFetcher',
    intervalMs: 30 * 60 * 1000, // Every 30 minutes
    enabled: true,
    running: false,
    handler: fetchRssFeeds,
  },
  {
    name: 'rssRelevanceAnalyzer',
    intervalMs: 60 * 60 * 1000, // Hourly
    enabled: true,
    running: false,
    handler: analyzeRssRelevance,
  },
  {
    name: 'sessionLearningConsolidator',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    enabled: true,
    running: false,
    handler: consolidateSessionLearnings,
  },
  // Proactive trigger jobs
  {
    name: 'triggerProcessor',
    intervalMs: 60 * 1000, // Every minute
    enabled: true,
    running: false,
    handler: processTriggers,
  },
  {
    name: 'triggerCleanup',
    intervalMs: 60 * 60 * 1000, // Hourly
    enabled: true,
    running: false,
    handler: cleanupOldTriggers,
  },
  // Calendar reminder job
  {
    name: 'calendarReminderProcessor',
    intervalMs: 60 * 1000, // Every minute
    enabled: true,
    running: false,
    handler: processCalendarReminders,
  },
  // Quick reminder job (user-set reminders via chat)
  {
    name: 'quickReminderProcessor',
    intervalMs: 30 * 1000, // Every 30 seconds for faster response
    enabled: true,
    running: false,
    handler: processQuickReminders,
  },
  // Session log jobs
  {
    name: 'sessionLogFinalizer',
    intervalMs: 30 * 60 * 1000, // Every 30 minutes
    enabled: true,
    running: false,
    handler: finalizeIdleSessions,
  },
  // Trading jobs
  {
    name: 'tradingOrderMonitor',
    intervalMs: 30 * 1000, // Every 30 seconds - fast for real-time order monitoring
    enabled: true,
    running: false,
    handler: monitorTradingOrders,
  },
  {
    name: 'tradingBotExecutor',
    intervalMs: 60 * 1000, // Every minute - run bot strategies
    enabled: true,
    running: false,
    handler: executeTradingBots,
  },
  {
    name: 'scalpingBot',
    intervalMs: 30 * 1000, // Every 30 seconds - scan for scalping opportunities
    enabled: true,
    running: false,
    handler: runScalpingBot,
  },
];

// ============================================
// Job Handlers
// ============================================

/**
 * Analyze recent conversations for preference learning
 */
async function analyzePreferences(): Promise<void> {
  try {
    // Get users with recent conversations
    const result = await pool.query(`
      SELECT DISTINCT s.user_id, s.id as session_id
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE m.created_at > NOW() - INTERVAL '1 hour'
        AND m.role = 'user'
      LIMIT 50
    `);

    for (const row of result.rows) {
      try {
        // Get recent messages for this session
        const messages = await pool.query(`
          SELECT role, content
          FROM messages
          WHERE session_id = $1
          ORDER BY created_at DESC
          LIMIT 10
        `, [row.session_id]);

        if (messages.rows.length >= 2) {
          await preferencesService.learnFromConversation(
            row.user_id,
            row.session_id,
            messages.rows.reverse() // Chronological order
          );
        }
      } catch (err) {
        logger.error('Failed to analyze preferences for user', {
          error: (err as Error).message,
          userId: row.user_id
        });
      }
    }

    logger.debug('Preference analysis job completed', { usersProcessed: result.rows.length });
  } catch (error) {
    logger.error('Preference analysis job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Recalculate task-mood correlations for all users
 */
async function calculateTaskPatterns(): Promise<void> {
  try {
    // Get users with task history
    const result = await pool.query(`
      SELECT DISTINCT user_id
      FROM task_history
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    for (const row of result.rows) {
      try {
        await taskPatterns.calculateTaskMoodCorrelations(row.user_id);
      } catch (err) {
        logger.error('Failed to calculate task patterns for user', {
          error: (err as Error).message,
          userId: row.user_id
        });
      }
    }

    logger.debug('Task pattern calculation completed', { usersProcessed: result.rows.length });
  } catch (error) {
    logger.error('Task pattern calculation job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Update energy patterns from mood data
 */
async function updateEnergyPatterns(): Promise<void> {
  try {
    // This is handled incrementally in mood-awareness.service.ts
    // This job is for batch updates if needed
    const result = await pool.query(`
      SELECT DISTINCT user_id
      FROM mood_entries
      WHERE detected_at > NOW() - INTERVAL '7 days'
        AND energy_level IS NOT NULL
    `);

    logger.debug('Energy pattern update completed', { usersChecked: result.rows.length });
  } catch (error) {
    logger.error('Energy pattern update job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Refresh OAuth tokens that are about to expire
 */
async function refreshExpiringTokens(): Promise<void> {
  try {
    // Calendar connections
    const calendarResult = await pool.query(`
      SELECT id FROM calendar_connections
      WHERE is_active = true
        AND token_expires_at < NOW() + INTERVAL '30 minutes'
        AND refresh_token_encrypted IS NOT NULL
    `);

    for (const row of calendarResult.rows) {
      try {
        await oauthService.refreshAccessToken(row.id, 'calendar');
      } catch (err) {
        logger.warn('Failed to refresh calendar token', {
          connectionId: row.id,
          error: (err as Error).message
        });
      }
    }

    // Email connections
    const emailResult = await pool.query(`
      SELECT id FROM email_connections
      WHERE is_active = true
        AND token_expires_at < NOW() + INTERVAL '30 minutes'
        AND refresh_token_encrypted IS NOT NULL
    `);

    for (const row of emailResult.rows) {
      try {
        await oauthService.refreshAccessToken(row.id, 'email');
      } catch (err) {
        logger.warn('Failed to refresh email token', {
          connectionId: row.id,
          error: (err as Error).message
        });
      }
    }

    logger.debug('Token refresh job completed', {
      calendarTokens: calendarResult.rows.length,
      emailTokens: emailResult.rows.length
    });
  } catch (error) {
    logger.error('Token refresh job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Clean up expired OAuth states
 */
async function cleanupExpiredStates(): Promise<void> {
  try {
    const result = await pool.query(`
      DELETE FROM oauth_states
      WHERE expires_at < NOW()
    `);

    if ((result.rowCount ?? 0) > 0) {
      logger.debug('Cleaned up expired OAuth states', { count: result.rowCount });
    }
  } catch (error) {
    logger.error('State cleanup job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Clean up old integration event logs (keep 30 days)
 */
async function cleanupOldEventLogs(): Promise<void> {
  try {
    const result = await pool.query(`
      DELETE FROM integration_events
      WHERE created_at < NOW() - INTERVAL '30 days'
    `);

    if ((result.rowCount ?? 0) > 0) {
      logger.debug('Cleaned up old integration events', { count: result.rowCount });
    }
  } catch (error) {
    logger.error('Event log cleanup job failed', {
      error: (error as Error).message
    });
  }
}

// ============================================
// Autonomous Mode Job Handlers
// ============================================

/**
 * Fetch RSS feeds for all users with autonomous mode enabled
 */
async function fetchRssFeeds(): Promise<void> {
  try {
    // Get users with autonomous mode enabled and RSS feeds configured
    const result = await pool.query(`
      SELECT DISTINCT rf.user_id
      FROM rss_feeds rf
      JOIN autonomous_config ac ON rf.user_id = ac.user_id
      WHERE rf.is_active = true
        AND ac.enabled = true
    `);

    for (const row of result.rows) {
      try {
        // Fetch all feeds for this user
        const articlesCount = await rssService.fetchAllFeeds(row.user_id);
        logger.debug('Fetched RSS feeds for user', {
          userId: row.user_id,
          newArticles: articlesCount
        });
      } catch (err) {
        logger.error('Failed to fetch feeds for user', {
          error: (err as Error).message,
          userId: row.user_id
        });
      }
    }

    logger.debug('RSS feed fetch job completed', { usersProcessed: result.rows.length });
  } catch (error) {
    logger.error('RSS feed fetch job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Analyze relevance of recent RSS articles
 */
async function analyzeRssRelevance(): Promise<void> {
  try {
    // Get unanalyzed articles from the last 24 hours
    const result = await pool.query(`
      SELECT ra.id, ra.feed_id, rf.user_id
      FROM rss_articles ra
      JOIN rss_feeds rf ON ra.feed_id = rf.id
      WHERE ra.relevance_score IS NULL
        AND ra.fetched_at > NOW() - INTERVAL '24 hours'
      LIMIT 50
    `);

    for (const row of result.rows) {
      try {
        await rssService.analyzeArticleRelevance(row.user_id, row.id);
      } catch (err) {
        logger.warn('Failed to analyze article relevance', {
          articleId: row.id,
          error: (err as Error).message
        });
      }
    }

    logger.debug('RSS relevance analysis job completed', { articlesProcessed: result.rows.length });
  } catch (error) {
    logger.error('RSS relevance analysis job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Consolidate session learnings from autonomous sessions
 */
async function consolidateSessionLearnings(): Promise<void> {
  try {
    // Get users with recent autonomous sessions
    const result = await pool.query(`
      SELECT DISTINCT user_id
      FROM autonomous_sessions
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND status = 'completed'
    `);

    for (const row of result.rows) {
      try {
        await insightsService.consolidateLearnings(row.user_id);
      } catch (err) {
        logger.error('Failed to consolidate learnings for user', {
          error: (err as Error).message,
          userId: row.user_id
        });
      }
    }

    logger.debug('Session learning consolidation completed', { usersProcessed: result.rows.length });
  } catch (error) {
    logger.error('Session learning consolidation job failed', {
      error: (error as Error).message
    });
  }
}

// ============================================
// Proactive Trigger Job Handlers
// ============================================

/**
 * Process all trigger types and deliver pending triggers
 */
async function processTriggers(): Promise<void> {
  try {
    // 1. Check time-based triggers (cron schedules)
    const timeBasedCount = await triggerService.processTimeBasedTriggers();

    // 2. Check pattern-based triggers
    const patternCount = await triggerService.processPatternTriggers();

    // 3. Check insight-based triggers
    const insightCount = await triggerService.processInsightTriggers();

    // 4. Process pending trigger queue (deliver messages)
    const deliveredCount = await deliveryService.processTriggerQueue();

    const totalEnqueued = timeBasedCount + patternCount + insightCount;

    if (totalEnqueued > 0 || deliveredCount > 0) {
      logger.info('Trigger processor job completed', {
        enqueued: {
          timeBased: timeBasedCount,
          pattern: patternCount,
          insight: insightCount,
          total: totalEnqueued,
        },
        delivered: deliveredCount,
      });
    } else {
      logger.debug('Trigger processor job completed - no triggers to process');
    }
  } catch (error) {
    logger.error('Trigger processor job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Clean up old delivered/failed triggers
 */
async function cleanupOldTriggers(): Promise<void> {
  try {
    const result = await pool.query(`SELECT cleanup_old_pending_triggers() as deleted_count`);
    const deletedCount = result.rows[0]?.deleted_count || 0;

    if (deletedCount > 0) {
      logger.info('Cleaned up old triggers', { count: deletedCount });
    }
  } catch (error) {
    logger.error('Trigger cleanup job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Calendar Reminder Job Handler
// ============================================

/**
 * Process calendar event reminders and send Telegram notifications
 */
async function processCalendarReminders(): Promise<void> {
  try {
    const enqueued = await calendarReminderService.processCalendarReminders();
    if (enqueued > 0) {
      logger.info('Calendar reminders processed', { enqueued });
    }

    // Also cleanup old reminder records periodically (piggyback on this job)
    await calendarReminderService.cleanupOldReminderRecords();
  } catch (error) {
    logger.error('Calendar reminder processor job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Process quick reminders (user-set via chat) and send Telegram notifications
 */
async function processQuickReminders(): Promise<void> {
  try {
    const delivered = await reminderService.processQuickReminders();
    if (delivered > 0) {
      logger.info('Quick reminders processed', { delivered });
    }

    // Cleanup old delivered reminders periodically
    await reminderService.cleanupOldReminders();
  } catch (error) {
    logger.error('Quick reminder processor job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Session Log Job Handlers
// ============================================

/**
 * Finalize session logs for idle sessions (30+ minutes inactive)
 * Generates summary, mood, and energy analysis
 */
async function finalizeIdleSessions(): Promise<void> {
  try {
    // Get sessions idle for 30+ minutes with unfinalized logs
    const idleLogs = await sessionLogService.getIdleUnfinalizedLogs(0.5);

    if (idleLogs.length === 0) {
      logger.debug('No idle sessions to finalize');
      return;
    }

    let finalized = 0;
    for (const { sessionId } of idleLogs) {
      try {
        // Get session messages for analysis
        const messagesResult = await pool.query(
          `SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
          [sessionId]
        );

        if (messagesResult.rows.length < 2) {
          // Not enough messages to analyze, just mark as ended
          await sessionLogService.finalizeSessionLog(sessionId, 'Brief session', 'neutral', 'medium', []);
          finalized++;
          continue;
        }

        // Analyze session for summary, mood, and energy
        const analysis = await sessionLogService.analyzeSession(messagesResult.rows);

        await sessionLogService.finalizeSessionLog(
          sessionId,
          analysis.summary,
          analysis.mood,
          analysis.energy,
          analysis.topics
        );

        finalized++;
      } catch (err) {
        logger.warn('Failed to finalize session log', {
          sessionId,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Session log finalizer completed', {
      found: idleLogs.length,
      finalized,
    });
  } catch (error) {
    logger.error('Session log finalizer job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Trading Job Handlers
// ============================================

/**
 * Monitor trading orders - TP/SL, trailing stops, pending order fills
 * Runs frequently (every 30s) without LLM calls
 */
async function monitorTradingOrders(): Promise<void> {
  try {
    await orderMonitorService.runOrderMonitorJob();
  } catch (error) {
    logger.error('Trading order monitor job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Execute trading bots - Grid, DCA, RSI, conditional orders
 * Runs every minute
 */
async function executeTradingBots(): Promise<void> {
  try {
    const results = await botExecutorService.runAllBots();

    // Only log if there was activity
    const totalActivity =
      results.conditional.executed +
      results.grid.trades +
      results.dca.purchases +
      results.rsi.trades;

    if (totalActivity > 0) {
      logger.info('Trading bot executor completed', { results });
    } else {
      logger.debug('Trading bot executor completed - no activity');
    }
  } catch (error) {
    logger.error('Trading bot executor job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Scalping Bot Job Handlers
// ============================================

/**
 * Run scalping bot - scans for rebound opportunities and executes paper/live trades
 * Runs every 30 seconds
 */
async function runScalpingBot(): Promise<void> {
  try {
    const results = await scalpingService.runScalpingJob();

    // Only log if there was activity
    const totalActivity =
      results.opportunitiesFound +
      results.paperTrades +
      results.liveTrades +
      results.paperTradesClosed;

    if (totalActivity > 0) {
      logger.info('Scalping bot completed', { results });
    } else {
      logger.debug('Scalping bot completed - no activity');
    }
  } catch (error) {
    logger.error('Scalping bot job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Job Runner
// ============================================

let intervals: NodeJS.Timeout[] = [];

/**
 * Run a job with error handling
 */
async function runJob(job: Job): Promise<void> {
  if (job.running) {
    logger.warn(`Job ${job.name} is already running, skipping`);
    return;
  }

  job.running = true;
  const startTime = Date.now();

  try {
    await job.handler();
    job.lastRun = new Date();
    logger.debug(`Job ${job.name} completed`, {
      durationMs: Date.now() - startTime
    });
  } catch (error) {
    logger.error(`Job ${job.name} failed`, {
      error: (error as Error).message,
      durationMs: Date.now() - startTime
    });
  } finally {
    job.running = false;
  }
}

/**
 * Start all background jobs
 */
export function startJobs(): void {
  logger.info('Starting background jobs');

  for (const job of jobs) {
    if (!job.enabled) {
      logger.info(`Job ${job.name} is disabled, skipping`);
      continue;
    }

    // Run immediately on startup (with delay to not block startup)
    setTimeout(() => runJob(job), 5000);

    // Schedule recurring runs
    const interval = setInterval(() => runJob(job), job.intervalMs);
    intervals.push(interval);

    logger.info(`Scheduled job ${job.name}`, {
      intervalMs: job.intervalMs,
      intervalHuman: formatInterval(job.intervalMs)
    });
  }
}

/**
 * Stop all background jobs
 */
export function stopJobs(): void {
  logger.info('Stopping background jobs');

  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals = [];
}

/**
 * Get job status
 */
export function getJobStatus(): Array<{
  name: string;
  enabled: boolean;
  running: boolean;
  lastRun?: Date;
  intervalMs: number;
}> {
  return jobs.map(job => ({
    name: job.name,
    enabled: job.enabled,
    running: job.running,
    lastRun: job.lastRun,
    intervalMs: job.intervalMs,
  }));
}

/**
 * Manually trigger a job
 */
export async function triggerJob(jobName: string): Promise<boolean> {
  const job = jobs.find(j => j.name === jobName);
  if (!job) return false;

  await runJob(job);
  return true;
}

/**
 * Format interval for logging
 */
function formatInterval(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  if (ms < 86400000) return `${ms / 3600000}h`;
  return `${ms / 86400000}d`;
}

export default {
  startJobs,
  stopJobs,
  getJobStatus,
  triggerJob,
};
