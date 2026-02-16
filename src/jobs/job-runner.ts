import { pool } from '../db/index.js';
import cron from 'node-cron';
import * as preferencesService from '../memory/preferences.service.js';
import * as taskPatterns from '../abilities/task-patterns.service.js';
import * as oauthService from '../integrations/oauth.service.js';
import * as newsfetcherService from '../autonomous/newsfetcher.service.js';
import * as insightsService from '../autonomous/insights.service.js';
import * as triggerService from '../triggers/trigger.service.js';
import * as deliveryService from '../triggers/delivery.service.js';
import * as sessionLogService from '../chat/session-log.service.js';
import * as orderMonitorService from '../trading/order-monitor.service.js';
import * as botExecutorService from '../trading/bot-executor.service.js';
import * as scalpingService from '../trading/scalping.service.js';
import * as researchService from '../trading/research.service.js';
import * as indicatorCalculatorService from '../trading/indicator-calculator.service.js';
import * as autoTradingService from '../trading/auto-trading.service.js';
import * as calendarReminderService from '../abilities/calendar-reminder.service.js';
import * as reminderService from '../abilities/reminder.service.js';
import * as hintInjection from '../layered-agent/services/hint-injection.service.js';
import * as selfCorrection from '../layered-agent/services/self-correction.service.js';
import * as sessionActivityService from '../chat/session-activity.service.js';
import * as intentService from '../intents/intent.service.js';
import * as contextSummaryService from '../context/context-summary.service.js';
import * as intentSummaryGenerator from '../context/intent-summary-generator.service.js';
import * as graphSyncService from '../graph/graph-sync.service.js';
import * as neo4jService from '../graph/neo4j.service.js';
import { activityHelpers } from '../activity/activity.service.js';
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
    name: 'newsfetcherIngestion',
    intervalMs: 30 * 60 * 1000, // Every 30 minutes
    enabled: true,
    running: false,
    handler: triggerNewsfetcherIngestion,
  },
  {
    name: 'newsEnrichment',
    intervalMs: 60 * 60 * 1000, // Hourly
    enabled: true,
    running: false,
    handler: enrichNewsArticles,
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
  // MemoryCore session consolidation job
  {
    name: 'memorycoreSessionConsolidator',
    intervalMs: 60 * 1000, // Every minute - check for 5-min inactive sessions
    enabled: true,
    running: false,
    handler: consolidateInactiveSessions,
  },
  // Autonomous Learning (Knowledge Evolution)
  {
    name: 'autonomousLearningOrchestrator',
    intervalMs: 24 * 60 * 60 * 1000, // Daily - analyze sessions and research knowledge gaps
    enabled: true,
    running: false,
    handler: runAutonomousLearning,
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
  {
    name: 'researchSignalScanner',
    intervalMs: 30 * 1000, // Every 30 seconds - scan for research signals
    enabled: true,
    running: false,
    handler: runResearchSignalScanner,
  },
  {
    name: 'indicatorCalculator',
    intervalMs: 60 * 1000, // Every minute - pre-calculate indicators for all symbols
    enabled: true,
    running: false,
    handler: calculateIndicators,
  },
  {
    name: 'autoTrading',
    intervalMs: 30 * 1000, // Every 30 seconds - scan for auto trading signals
    enabled: true,
    running: false,
    handler: runAutoTrading,
  },
  {
    name: 'portfolioReconciliation',
    intervalMs: 30 * 1000, // Every 30 seconds - reconcile portfolio vs trades
    enabled: true,
    running: false,
    handler: runPortfolioReconciliation,
  },
  {
    name: 'backtestSignals',
    intervalMs: 60 * 1000, // Every minute - backtest pending signals
    enabled: true,
    running: false,
    handler: backtestSignals,
  },
  // Layered agent hint/correction jobs
  {
    name: 'hintWeightDecay',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: decayHintWeights,
  },
  {
    name: 'critiqueDataCleanup',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: cleanupCritiqueData,
  },
  // Intent persistence jobs
  {
    name: 'intentDecay',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: decayStaleIntents,
  },
  {
    name: 'intentCachePrune',
    intervalMs: 15 * 60 * 1000, // Every 15 minutes
    enabled: true,
    running: false,
    handler: pruneIntentCache,
  },
  // Context summary jobs
  {
    name: 'contextSummaryGenerator',
    intervalMs: 30 * 60 * 1000, // Every 30 minutes (with sessionLogFinalizer)
    enabled: true,
    running: false,
    handler: generateContextSummaries,
  },
  {
    name: 'searchIndexMaintenance',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    enabled: true,
    running: false,
    handler: maintainSearchIndex,
  },
  {
    name: 'intentSummaryRefresh',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: refreshIntentSummaries,
  },
  // Neo4j graph sync jobs
  {
    name: 'neo4jGraphSync',
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
    enabled: true,
    running: false,
    handler: syncNeo4jGraph,
  },
  {
    name: 'neo4jCleanup',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    enabled: true,
    running: false,
    handler: cleanupNeo4jOrphans,
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
 * Trigger newsfetcher ingestion (replaces old RSS feed fetching)
 */
async function triggerNewsfetcherIngestion(): Promise<void> {
  try {
    const result = await newsfetcherService.triggerIngestion();
    if (result.ingested > 0) {
      logger.info('Newsfetcher ingestion completed', { ingested: result.ingested });
    } else {
      logger.debug('Newsfetcher ingestion completed - no new articles');
    }
  } catch (error) {
    logger.error('Newsfetcher ingestion job failed', {
      error: (error as Error).message
    });
  }
}

/**
 * Enrich news articles with AI signal filtering (replaces old RSS relevance analysis)
 */
async function enrichNewsArticles(): Promise<void> {
  try {
    // Get users with autonomous mode enabled
    const result = await pool.query(`
      SELECT DISTINCT user_id
      FROM autonomous_config
      WHERE enabled = true
    `);

    for (const row of result.rows) {
      try {
        const enrichedCount = await newsfetcherService.batchEnrichArticles(row.user_id, 25);
        if (enrichedCount > 0) {
          logger.debug('Enriched news articles for user', {
            userId: row.user_id,
            enrichedCount,
          });
          activityHelpers.logBackgroundJob(row.user_id, 'News Enrichment', 'completed', {
            enrichedCount,
          }).catch(() => {}); // Non-blocking
        }
      } catch (err) {
        logger.error('Failed to enrich articles for user', {
          error: (err as Error).message,
          userId: row.user_id
        });
      }
    }

    logger.debug('News enrichment job completed', { usersProcessed: result.rows.length });
  } catch (error) {
    logger.error('News enrichment job failed', {
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
      // Note: Activity logging for triggers happens per-user in delivery service
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
// MemoryCore Session Consolidation Handler
// ============================================

/**
 * Consolidate inactive chat sessions to MemoryCore
 * Sessions inactive for 5+ minutes are consolidated (Working Memory → Episodic)
 */
async function consolidateInactiveSessions(): Promise<void> {
  try {
    const consolidated = await sessionActivityService.processInactiveSessions();

    if (consolidated > 0) {
      logger.info('MemoryCore session consolidation completed', { consolidated });
    } else {
      logger.debug('MemoryCore session consolidation - no inactive sessions');
    }
  } catch (error) {
    logger.error('MemoryCore session consolidation job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Autonomous Learning Orchestrator Job
 * Runs daily to:
 * 1. Analyze last 90 days of chat sessions for knowledge gaps
 * 2. Research high-priority gaps using SearXNG + trusted sources
 * 3. Verify findings with LLM fact-checking
 * 4. Friends discuss findings for insights
 * 5. Embed verified knowledge into MemoryCore
 */
async function runAutonomousLearning(): Promise<void> {
  try {
    const { runAutonomousLearningForAllUsers } = await import('../autonomous/autonomous-learning.orchestrator.js');

    logger.info('Starting autonomous learning job');
    const summary = await runAutonomousLearningForAllUsers();

    logger.info('Autonomous learning job completed', summary);
  } catch (error) {
    logger.error('Autonomous learning job failed', {
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
// Research Signal Scanner Job Handler
// ============================================

/**
 * Run research signal scanner - scans for trading opportunities using multi-indicator analysis
 * Runs every 30 seconds
 */
async function runResearchSignalScanner(): Promise<void> {
  try {
    const results = await researchService.runResearchJob();

    // Only log if there was activity
    const totalActivity =
      results.signalsCreated +
      results.autoExecuted +
      results.expired;

    if (totalActivity > 0) {
      logger.info('Research signal scanner completed', { results });
    } else {
      logger.debug('Research signal scanner completed - no signals');
    }
  } catch (error) {
    logger.error('Research signal scanner job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Indicator Calculator Job Handler
// ============================================

/**
 * Pre-calculate technical indicators for all symbols and timeframes
 * Stores results in Redis for fast access by trading terminal
 */
async function calculateIndicators(): Promise<void> {
  try {
    const results = await indicatorCalculatorService.runIndicatorCalculations();

    if (results.calculated > 0) {
      logger.info('Indicator calculator completed', {
        calculated: results.calculated,
        failed: results.failed,
        durationMs: results.duration,
      });
    } else {
      logger.debug('Indicator calculator completed - no data to calculate');
    }
  } catch (error) {
    logger.error('Indicator calculator job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Auto Trading Job Handler
// ============================================

/**
 * Run auto trading - scans for RSI + Volume signals and executes trades
 * Runs every 30 seconds for users with auto trading enabled
 */
async function runAutoTrading(): Promise<void> {
  try {
    await autoTradingService.runAutoTradingJob();
  } catch (error) {
    logger.error('Auto trading job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Portfolio reconciliation - detects orphan positions and manual sells
 * Creates trailing SL for orphan positions > $20
 */
async function runPortfolioReconciliation(): Promise<void> {
  try {
    // Get all users with auto trading enabled
    const { pool } = await import('../db/postgres.js');
    const users = await pool.query(
      'SELECT DISTINCT user_id FROM auto_trading_settings WHERE enabled = true'
    );

    for (const user of users.rows) {
      try {
        const result = await autoTradingService.reconcilePortfolio(user.user_id);
        if (result.reconciled > 0 || result.missingFromPortfolio.length > 0) {
          logger.info('Portfolio reconciliation completed', {
            userId: user.user_id,
            orphansFound: result.orphanPositions.length,
            reconciled: result.reconciled,
            manualSells: result.missingFromPortfolio.length,
          });
        }
      } catch (err) {
        logger.warn('Reconciliation failed for user', {
          userId: user.user_id,
          error: (err as Error).message,
        });
      }
    }
  } catch (error) {
    logger.error('Portfolio reconciliation job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Backtest pending auto trading signals
 * Checks if historical prices hit SL or TP
 */
async function backtestSignals(): Promise<void> {
  try {
    await autoTradingService.backtestPendingSignals();
  } catch (error) {
    logger.error('Backtest signals job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Layered Agent Hint/Correction Job Handlers
// ============================================

/**
 * Decay user hint weights over time
 * Hints that haven't been triggered recently will gradually lose influence
 */
async function decayHintWeights(): Promise<void> {
  try {
    const updated = await hintInjection.decayUserHintWeights(7); // 7 day decay period
    if (updated > 0) {
      logger.info('Hint weight decay completed', { updated });
    }
  } catch (error) {
    logger.error('Hint weight decay job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Clean up old critique data (processed corrections, old queue logs)
 */
async function cleanupCritiqueData(): Promise<void> {
  try {
    const correctionsDeleted = await selfCorrection.cleanupOldCorrections(7);

    // Also cleanup queue logs directly
    const queueLogResult = await pool.query(
      `DELETE FROM critique_queue_log WHERE created_at < NOW() - INTERVAL '7 days'`
    );
    const queueLogsDeleted = queueLogResult.rowCount || 0;

    if (correctionsDeleted > 0 || queueLogsDeleted > 0) {
      logger.info('Critique data cleanup completed', {
        correctionsDeleted,
        queueLogsDeleted,
      });
    }
  } catch (error) {
    logger.error('Critique data cleanup job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Intent Persistence Job Handlers
// ============================================

/**
 * Decay stale intents that haven't been touched in 7 days
 */
async function decayStaleIntents(): Promise<void> {
  try {
    const count = await intentService.decayStaleIntents(7);
    if (count > 0) {
      logger.info('Intent decay job completed', { decayed: count });
    } else {
      logger.debug('Intent decay job completed - no stale intents');
    }
  } catch (error) {
    logger.error('Intent decay job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Prune expired intent cache entries
 */
async function pruneIntentCache(): Promise<void> {
  try {
    const count = await intentService.pruneIntentCache();
    if (count > 0) {
      logger.debug('Intent cache prune completed', { pruned: count });
    }
  } catch (error) {
    logger.error('Intent cache prune job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Context Summary Job Handlers
// ============================================

/**
 * Generate context summaries for recently finalized sessions
 * Works alongside sessionLogFinalizer to create rich summaries
 */
async function generateContextSummaries(): Promise<void> {
  try {
    // Find sessions that have been finalized but don't have context summaries
    const result = await pool.query(`
      SELECT sl.session_id, sl.user_id, sl.summary, sl.topics, sl.mood, sl.energy,
             sl.started_at, sl.ended_at, sl.message_count, sl.tools_used
      FROM session_logs sl
      LEFT JOIN context_summary_metadata csm
        ON csm.user_id = sl.user_id
        AND csm.summary_type = 'session'
        AND csm.reference_id = sl.session_id
      WHERE sl.ended_at IS NOT NULL
        AND sl.ended_at > NOW() - INTERVAL '6 hours'
        AND csm.id IS NULL
      ORDER BY sl.ended_at DESC
      LIMIT 10
    `);

    if (result.rows.length === 0) {
      logger.debug('No sessions need context summaries');
      return;
    }

    let generated = 0;

    for (const row of result.rows) {
      try {
        // Get messages for this session
        const messagesResult = await pool.query(
          `SELECT role, content FROM messages
           WHERE session_id = $1
           ORDER BY created_at ASC`,
          [row.session_id]
        );

        if (messagesResult.rows.length < 2) continue;

        // Get active intents for this session
        const intentsResult = await pool.query(
          `SELECT DISTINCT intent_id FROM intent_touches
           WHERE session_id = $1`,
          [row.session_id]
        );
        const intentIds = intentsResult.rows.map(r => r.intent_id);

        // Generate detailed summary
        await sessionLogService.generateDetailedSessionSummary(
          row.session_id,
          row.user_id,
          messagesResult.rows,
          intentIds,
          [], // Resolved intents - would need additional query
          row.tools_used || [],
          new Date(row.started_at),
          new Date(row.ended_at)
        );

        generated++;
      } catch (err) {
        logger.warn('Failed to generate context summary for session', {
          sessionId: row.session_id,
          error: (err as Error).message,
        });
      }
    }

    if (generated > 0) {
      logger.info('Context summary generation completed', { generated });
    }
  } catch (error) {
    logger.error('Context summary generation job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Maintain search index - clean up and rebuild if needed
 */
async function maintainSearchIndex(): Promise<void> {
  try {
    // Clean up expired summaries
    const cleaned = await contextSummaryService.cleanupExpiredSummaries();

    // Get users with recent activity
    const result = await pool.query(`
      SELECT DISTINCT user_id FROM session_logs
      WHERE ended_at > NOW() - INTERVAL '7 days'
      LIMIT 50
    `);

    let rebuilt = 0;

    for (const row of result.rows) {
      try {
        // Check if index seems healthy (has some entries)
        const searchResults = await contextSummaryService.searchContext(
          row.user_id,
          'test'
        );

        // If no results found, might need rebuild
        const recentSessions = await contextSummaryService.getRecentSessionIds(
          row.user_id,
          5
        );

        if (recentSessions.length > 0 && searchResults.length === 0) {
          // Rebuild this user's index
          await contextSummaryService.rebuildSearchIndex(row.user_id);
          rebuilt++;
        }
      } catch (err) {
        logger.warn('Search index check failed for user', {
          userId: row.user_id,
          error: (err as Error).message,
        });
      }
    }

    if (cleaned > 0 || rebuilt > 0) {
      logger.info('Search index maintenance completed', {
        expired: cleaned,
        rebuilt,
      });
    }
  } catch (error) {
    logger.error('Search index maintenance job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Refresh intent summaries for active intents
 * Ensures intent context stays up-to-date
 */
async function refreshIntentSummaries(): Promise<void> {
  try {
    // Get users with active intents
    const result = await pool.query(`
      SELECT DISTINCT user_id FROM user_intents
      WHERE status IN ('active', 'suspended')
        AND last_touched_at > NOW() - INTERVAL '7 days'
      LIMIT 20
    `);

    let refreshed = 0;

    for (const row of result.rows) {
      try {
        const count = await intentSummaryGenerator.refreshUserIntentSummaries(
          row.user_id
        );
        refreshed += count;
      } catch (err) {
        logger.warn('Intent summary refresh failed for user', {
          userId: row.user_id,
          error: (err as Error).message,
        });
      }
    }

    if (refreshed > 0) {
      logger.info('Intent summary refresh completed', { refreshed });
    }
  } catch (error) {
    logger.error('Intent summary refresh job failed', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Neo4j Graph Sync Job Handlers
// ============================================

/**
 * Sync recent PostgreSQL data to Neo4j graph database
 * Runs every 6 hours for users with recent activity
 */
async function syncNeo4jGraph(): Promise<void> {
  try {
    const result = await graphSyncService.reconcileRecentUsers(6);

    if (result.usersProcessed > 0) {
      logger.info('Neo4j graph sync completed', {
        usersProcessed: result.usersProcessed,
        totalSynced: result.totalSynced,
        totalFailed: result.totalFailed,
        durationMs: result.duration,
      });
    } else {
      logger.debug('Neo4j graph sync completed - no users to sync');
    }
  } catch (error) {
    logger.error('Neo4j graph sync job failed', {
      error: (error as Error).message,
    });
  }
}

/**
 * Clean up orphaned nodes in Neo4j (nodes deleted in PostgreSQL)
 * Runs daily
 */
async function cleanupNeo4jOrphans(): Promise<void> {
  try {
    const result = await graphSyncService.cleanupOrphanedNodes();

    if (result.deleted > 0) {
      logger.info('Neo4j orphan cleanup completed', { deleted: result.deleted });
    } else {
      logger.debug('Neo4j orphan cleanup completed - no orphans found');
    }
  } catch (error) {
    logger.error('Neo4j orphan cleanup job failed', {
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

  // Initialize Neo4j service (schema, connectivity check)
  neo4jService.initialize().catch(err => {
    logger.warn('Neo4j initialization failed, graph features disabled', {
      error: (err as Error).message,
    });
  });

  // Initialize event-driven indicator calculations (on candle close)
  indicatorCalculatorService.initEventDrivenCalculations();

  // Initialize event-driven scalping detection (on significant price drops)
  scalpingService.initEventDrivenScalping();

  for (const job of jobs) {
    if (!job.enabled) {
      logger.info(`Job ${job.name} is disabled, skipping`);
      continue;
    }

    if (job.name === 'autonomousLearningOrchestrator') {
      // Schedule at 00:08 every day
      cron.schedule('8 0 * * *', () => runJob(job));
      logger.info(`Scheduled job ${job.name} via cron`, { schedule: '00:08 daily' });
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
export async function stopJobs(): Promise<void> {
  logger.info('Stopping background jobs');

  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals = [];

  // Close Neo4j connections
  await neo4jService.close();
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
