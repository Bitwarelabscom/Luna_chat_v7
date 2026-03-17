/**
 * Luna AI Unified Trading Strategy Service
 *
 * Core LLM-driven trading analysis for Luna. Assembles market context, runs
 * an LLM analysis pass, executes resulting trade decisions, and manages early
 * trigger detection via Redis.
 */

import { pool } from '../db/index.js';
import redis from '../db/redis.js';
import logger from '../utils/logger.js';
import { createCompletion } from '../llm/router.js';
import {
  getBackgroundFeatureModelConfig,
  type BackgroundLlmFeature,
} from '../settings/background-llm-settings.service.js';
import * as tradingService from './trading.service.js';
import * as redisTradingService from './redis-trading.service.js';
import { getIntelligencePacket } from './crypto-intelligence.service.js';
import * as tradeNotification from './trade-notification.service.js';
import type { ChatMessage } from '../llm/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmTradeDecision {
  action: 'buy' | 'sell' | 'hold';
  symbol: string;
  side: 'buy' | 'sell';
  size_usd: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  confidence: number;
  reason: string;
}

export interface LlmAnalysisResult {
  id: string;
  decisions: LlmTradeDecision[];
  marketSummary: string;
  modelUsed: string;
  tokensUsed: number;
  analyzedAt: Date;
}

export interface EarlyTriggerResult {
  triggered: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Symbols to analyse for technical indicators
// ---------------------------------------------------------------------------

const ANALYSIS_SYMBOLS = [
  'BTC_USD',
  'ETH_USD',
  'SOL_USD',
  'XRP_USD',
  'DOGE_USD',
] as const;

// ---------------------------------------------------------------------------
// buildAnalysisPrompt
// ---------------------------------------------------------------------------

/**
 * Assembles a comprehensive analysis prompt combining intelligence packet data,
 * portfolio state, recent trade history, risk settings, P/L baseline, and live
 * technical indicators.
 */
export async function buildAnalysisPrompt(userId: string): Promise<string> {
  const lines: string[] = [];

  // -- Intelligence packet --------------------------------------------------
  try {
    const intel = await getIntelligencePacket();
    if (intel) {
      lines.push('## Market Intelligence');
      lines.push(typeof intel === 'string' ? intel : JSON.stringify(intel, null, 2));
    }
  } catch (err) {
    logger.warn('buildAnalysisPrompt: failed to fetch intelligence packet', {
      error: (err as Error).message,
    });
  }

  // -- Current portfolio ----------------------------------------------------
  try {
    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      lines.push('\n## Current Portfolio');
      lines.push(`Total value (USDT): ${portfolio.totalValueUsdt.toFixed(2)}`);
      lines.push(`Available (USDT): ${portfolio.availableUsdt.toFixed(2)}`);
      lines.push(`Daily P/L: ${portfolio.dailyPnl?.toFixed(2) ?? 'N/A'} (${portfolio.dailyPnlPct?.toFixed(2) ?? 'N/A'}%)`);
      if (portfolio.holdings.length > 0) {
        lines.push('Holdings:');
        for (const h of portfolio.holdings) {
          lines.push(
            `  ${h.asset}: ${h.amount} @ $${h.price?.toFixed(4) ?? 'N/A'} = $${h.valueUsdt.toFixed(2)} (${h.allocationPct?.toFixed(1) ?? 'N/A'}%)`
          );
        }
      }
    }
  } catch (err) {
    logger.warn('buildAnalysisPrompt: failed to fetch portfolio', {
      userId,
      error: (err as Error).message,
    });
  }

  // -- Recent trades --------------------------------------------------------
  try {
    const tradeResult = await pool.query(
      'SELECT * FROM trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    if (tradeResult.rows.length > 0) {
      lines.push('\n## Recent Trades (last 20)');
      for (const row of tradeResult.rows) {
        lines.push(
          `  ${row.created_at?.toISOString?.() ?? ''} | ${row.symbol} ${row.side?.toUpperCase()} ${row.quantity} @ $${row.price ?? row.filled_price ?? 'market'} | status: ${row.status}`
        );
      }
    }
  } catch (err) {
    logger.warn('buildAnalysisPrompt: failed to fetch recent trades', {
      userId,
      error: (err as Error).message,
    });
  }

  // -- Risk level -----------------------------------------------------------
  try {
    const settingsResult = await pool.query(
      'SELECT risk_level FROM auto_trading_settings WHERE user_id = $1',
      [userId]
    );
    const riskLevel = settingsResult.rows[0]?.risk_level ?? 'medium';
    lines.push(`\n## Risk Settings`);
    lines.push(`Risk level: ${riskLevel}`);
  } catch (err) {
    logger.warn('buildAnalysisPrompt: failed to fetch risk level', {
      userId,
      error: (err as Error).message,
    });
  }

  // -- All-time P/L ---------------------------------------------------------
  try {
    const baselineResult = await pool.query(
      'SELECT * FROM portfolio_baselines WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    if (baselineResult.rows.length > 0) {
      const b = baselineResult.rows[0];
      lines.push(`\n## All-Time P/L`);
      lines.push(`Baseline value: $${b.baseline_value?.toFixed(2) ?? 'N/A'}`);
      lines.push(`Current value: $${b.current_value?.toFixed(2) ?? 'N/A'}`);
      lines.push(
        `All-time P/L: $${b.total_pnl?.toFixed(2) ?? 'N/A'} (${b.total_pnl_pct?.toFixed(2) ?? 'N/A'}%)`
      );
    }
  } catch (err) {
    logger.warn('buildAnalysisPrompt: failed to fetch portfolio baselines', {
      userId,
      error: (err as Error).message,
    });
  }

  // -- Technical indicators per symbol -------------------------------------
  lines.push('\n## Technical Indicators (5m timeframe)');
  for (const symbol of ANALYSIS_SYMBOLS) {
    try {
      const ind = await redisTradingService.getIndicators(symbol, '5m');
      if (ind) {
        lines.push(`\n### ${symbol}`);
        if (ind.rsi !== undefined) lines.push(`  RSI: ${ind.rsi.toFixed(2)}`);
        if (ind.macd_line !== undefined) {
          lines.push(
            `  MACD: line=${ind.macd_line.toFixed(4)} signal=${ind.macd_signal?.toFixed(4) ?? 'N/A'} hist=${ind.macd_histogram?.toFixed(4) ?? 'N/A'}`
          );
        }
        if (ind.bollinger_upper !== undefined) {
          lines.push(
            `  Bollinger: upper=${ind.bollinger_upper.toFixed(2)} mid=${ind.bollinger_middle?.toFixed(2) ?? 'N/A'} lower=${ind.bollinger_lower?.toFixed(2) ?? 'N/A'}`
          );
        }
        if (ind.ema_9 !== undefined) lines.push(`  EMA-9: ${ind.ema_9.toFixed(4)}`);
        if (ind.ema_21 !== undefined) lines.push(`  EMA-21: ${ind.ema_21.toFixed(4)}`);
        if (ind.ema_50 !== undefined) lines.push(`  EMA-50: ${ind.ema_50.toFixed(4)}`);
        if (ind.ema_200 !== undefined) lines.push(`  EMA-200: ${ind.ema_200.toFixed(4)}`);
        if (ind.atr !== undefined) lines.push(`  ATR: ${ind.atr.toFixed(4)}`);
        if (ind.adx !== undefined) {
          lines.push(
            `  ADX: ${ind.adx.toFixed(2)} (+DI=${ind.plus_di?.toFixed(2) ?? 'N/A'} -DI=${ind.minus_di?.toFixed(2) ?? 'N/A'})`
          );
        }
        if (ind.stoch_k !== undefined) {
          lines.push(`  Stoch K/D: ${ind.stoch_k.toFixed(2)} / ${ind.stoch_d?.toFixed(2) ?? 'N/A'}`);
        }
        if (ind.volume_ratio !== undefined) {
          lines.push(`  Volume ratio: ${ind.volume_ratio.toFixed(2)}`);
        }
      } else {
        lines.push(`\n### ${symbol}`);
        lines.push('  No indicator data available.');
      }
    } catch (err) {
      logger.warn('buildAnalysisPrompt: failed to fetch indicators', {
        symbol,
        error: (err as Error).message,
      });
    }
  }

  // -- Instructions ---------------------------------------------------------
  lines.push(`
## Instructions

You are Luna's AI trading analyst. Based on all data above, produce a conservative, risk-aware
trading plan. You MUST return valid JSON only -- no markdown, no explanation outside the JSON.

Rules:
- Only suggest trades you have high confidence in (>= 0.65).
- Always include stop_loss_pct (minimum 1.5, maximum 5.0) and take_profit_pct (minimum 2.0).
- Prefer "hold" when signals are mixed or unclear.
- Keep individual position sizes reasonable relative to available capital.
- Provide a clear, concise reason for each decision.

Return format:
{
  "decisions": [
    {
      "action": "buy" | "sell" | "hold",
      "symbol": "BTC_USD",
      "side": "buy" | "sell",
      "size_usd": 100,
      "stop_loss_pct": 2.0,
      "take_profit_pct": 4.0,
      "confidence": 0.75,
      "reason": "RSI oversold with bullish MACD cross"
    }
  ],
  "market_summary": "Brief overall market assessment."
}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// runLlmAnalysis
// ---------------------------------------------------------------------------

/**
 * Runs a full LLM analysis cycle: builds prompt, calls LLM, stores result,
 * executes decisions, and sends Telegram notification.
 */
export async function runLlmAnalysis(
  userId: string,
  triggerReason: string
): Promise<LlmAnalysisResult | null> {
  try {
    logger.info('runLlmAnalysis: starting', { userId, triggerReason });

    // Get LLM config - 'trading_analysis' is a valid feature once registered
    const config = await getBackgroundFeatureModelConfig(
      userId,
      'trading_analysis' as BackgroundLlmFeature
    );

    // Build the prompt
    const promptText = await buildAnalysisPrompt(userId);

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a conservative, risk-focused cryptocurrency trading analyst. ' +
          'You return only valid JSON as instructed. You never suggest overleveraged or ' +
          'speculative trades. Capital preservation is your top priority.',
      },
      {
        role: 'user',
        content: promptText,
      },
    ];

    // Call LLM
    const completion = await createCompletion(
      config.primary.provider,
      config.primary.model,
      messages,
      { temperature: 0.3 }
    );

    const rawContent = completion.content ?? '';
    const tokensUsed = completion.tokensUsed ?? 0;

    // Parse JSON from response (handle optional code fences)
    let parsed: { decisions?: unknown[]; market_summary?: string } = {};
    try {
      // Strip markdown code blocks if present
      let jsonText = rawContent.trim();
      const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonText = fenceMatch[1].trim();
      }
      parsed = JSON.parse(jsonText) as typeof parsed;
    } catch (_parseErr) {
      logger.error('runLlmAnalysis: failed to parse LLM response as JSON', {
        userId,
        rawContent: rawContent.slice(0, 500),
      });
      return null;
    }

    const decisions: LlmTradeDecision[] = Array.isArray(parsed.decisions)
      ? (parsed.decisions as LlmTradeDecision[])
      : [];
    const marketSummary = typeof parsed.market_summary === 'string'
      ? parsed.market_summary
      : '';

    // Store analysis in DB
    const insertResult = await pool.query(
      `INSERT INTO trading_llm_analyses
         (user_id, trigger_reason, decisions, market_summary, model_used, tokens_used, analyzed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, analyzed_at`,
      [
        userId,
        triggerReason,
        JSON.stringify(decisions),
        marketSummary,
        `${config.primary.provider}/${config.primary.model}`,
        tokensUsed,
      ]
    );

    const row = insertResult.rows[0];
    const result: LlmAnalysisResult = {
      id: row.id as string,
      decisions,
      marketSummary,
      modelUsed: `${config.primary.provider}/${config.primary.model}`,
      tokensUsed,
      analyzedAt: row.analyzed_at as Date,
    };

    // Store timestamp for early trigger comparison
    await storeAnalysisTimestamp(userId);

    // Execute trade decisions
    await executeLlmDecisions(userId, result.id, decisions);

    // Send Telegram notification (fire-and-forget)
    tradeNotification
      .notifyLlmAnalysis(userId, result.marketSummary, result.decisions)
      .catch((err: Error) =>
        logger.warn('runLlmAnalysis: Telegram notification failed', { userId, error: err.message })
      );

    logger.info('runLlmAnalysis: complete', {
      userId,
      analysisId: result.id,
      decisionsCount: decisions.length,
      tokensUsed,
    });

    return result;
  } catch (err) {
    logger.error('runLlmAnalysis: unhandled error', {
      userId,
      triggerReason,
      error: (err as Error).message,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// executeLlmDecisions
// ---------------------------------------------------------------------------

/**
 * Executes buy/sell decisions returned by the LLM. Each trade is wrapped in
 * its own try-catch so a single failure does not block the rest.
 */
export async function executeLlmDecisions(
  userId: string,
  analysisId: string,
  decisions: LlmTradeDecision[]
): Promise<string[]> {
  const executedIds: string[] = [];

  for (const decision of decisions) {
    if (decision.action !== 'buy' && decision.action !== 'sell') {
      continue; // Skip hold decisions
    }

    try {
      // Get current price
      const priceData = await redisTradingService.getPrice(decision.symbol);
      if (!priceData || !priceData.price) {
        logger.warn('executeLlmDecisions: no price data for symbol, skipping', {
          symbol: decision.symbol,
          analysisId,
        });
        continue;
      }

      const currentPrice = priceData.price;
      const quantity = decision.size_usd / currentPrice;

      // Place the order
      const trade = await tradingService.placeOrder(userId, {
        symbol: decision.symbol,
        side: decision.side,
        type: 'market',
        quantity,
      });

      // Annotate trade with strategy metadata
      await pool.query(
        `UPDATE trades
         SET strategy_reason = $1,
             confidence_score = $2,
             analysis_id = $3
         WHERE id = $4`,
        [decision.reason, decision.confidence, analysisId, trade.id]
      );

      executedIds.push(trade.id);

      logger.info('executeLlmDecisions: trade executed', {
        userId,
        tradeId: trade.id,
        symbol: decision.symbol,
        side: decision.side,
        quantity,
        sizeUsd: decision.size_usd,
        confidence: decision.confidence,
      });
    } catch (err) {
      logger.error('executeLlmDecisions: failed to execute decision', {
        userId,
        symbol: decision.symbol,
        action: decision.action,
        error: (err as Error).message,
      });
    }
  }

  // Update analysis record with executed trade IDs
  try {
    await pool.query(
      'UPDATE trading_llm_analyses SET executed_trade_ids = $1 WHERE id = $2',
      [JSON.stringify(executedIds), analysisId]
    );
  } catch (err) {
    logger.error('executeLlmDecisions: failed to update executed_trade_ids', {
      analysisId,
      error: (err as Error).message,
    });
  }

  return executedIds;
}

// ---------------------------------------------------------------------------
// checkEarlyTriggers
// ---------------------------------------------------------------------------

/**
 * Checks whether any early-trigger condition has been met since the last
 * analysis. Returns the first trigger found, or triggered=false if none.
 */
export async function checkEarlyTriggers(userId: string): Promise<EarlyTriggerResult> {
  // BTC price change check
  try {
    const currentBtcData = await redisTradingService.getPrice('BTC_USD');
    if (currentBtcData) {
      const storedPriceStr = await redis.get(`trading:btc_price_at_analysis:${userId}`);
      if (storedPriceStr) {
        const storedPrice = parseFloat(storedPriceStr);
        if (storedPrice > 0) {
          const changePct = Math.abs((currentBtcData.price - storedPrice) / storedPrice) * 100;
          if (changePct > 3) {
            return {
              triggered: true,
              reason: `BTC price moved ${changePct.toFixed(1)}% since last analysis`,
            };
          }
        }
      }
    }
  } catch (err) {
    logger.warn('checkEarlyTriggers: BTC price check failed', {
      userId,
      error: (err as Error).message,
    });
  }

  // Breaking news check
  try {
    const breakingNews = await redis.get('trading:intel:breaking_news');
    if (breakingNews) {
      return {
        triggered: true,
        reason: `Breaking news detected: ${breakingNews.slice(0, 120)}`,
      };
    }
  } catch (err) {
    logger.warn('checkEarlyTriggers: breaking news check failed', {
      userId,
      error: (err as Error).message,
    });
  }

  // Open positions significant price movement check
  try {
    const positionsResult = await pool.query(
      `SELECT id, symbol, side, filled_price
       FROM trades
       WHERE user_id = $1
         AND status = 'filled'
         AND closed_at IS NULL`,
      [userId]
    );

    for (const pos of positionsResult.rows) {
      try {
        const priceData = await redisTradingService.getPrice(pos.symbol as string);
        if (!priceData || !pos.filled_price) continue;

        const entryPrice = parseFloat(pos.filled_price);
        if (entryPrice <= 0) continue;

        const changePct =
          Math.abs((priceData.price - entryPrice) / entryPrice) * 100;

        if (changePct > 5) {
          const direction = priceData.price > entryPrice ? 'up' : 'down';
          return {
            triggered: true,
            reason: `${pos.symbol as string} position moved ${changePct.toFixed(1)}% ${direction} from entry`,
          };
        }
      } catch (_posErr) {
        // Skip individual position errors silently
      }
    }
  } catch (err) {
    logger.warn('checkEarlyTriggers: open position check failed', {
      userId,
      error: (err as Error).message,
    });
  }

  return { triggered: false, reason: '' };
}

// ---------------------------------------------------------------------------
// getLastAnalysis
// ---------------------------------------------------------------------------

/**
 * Returns the most recent LLM analysis for the given user, or null if none
 * exists yet.
 */
export async function getLastAnalysis(userId: string): Promise<LlmAnalysisResult | null> {
  try {
    const result = await pool.query(
      `SELECT id, decisions, market_summary, model_used, tokens_used, analyzed_at
       FROM trading_llm_analyses
       WHERE user_id = $1
       ORDER BY analyzed_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const decisions: LlmTradeDecision[] = typeof row.decisions === 'string'
      ? (JSON.parse(row.decisions) as LlmTradeDecision[])
      : (row.decisions as LlmTradeDecision[]) ?? [];

    return {
      id: row.id as string,
      decisions,
      marketSummary: row.market_summary as string,
      modelUsed: row.model_used as string,
      tokensUsed: row.tokens_used as number,
      analyzedAt: row.analyzed_at as Date,
    };
  } catch (err) {
    logger.error('getLastAnalysis: query failed', {
      userId,
      error: (err as Error).message,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// storeAnalysisTimestamp
// ---------------------------------------------------------------------------

/**
 * Records the current timestamp and BTC price in Redis so that
 * checkEarlyTriggers() can compare against them on the next cycle.
 */
export async function storeAnalysisTimestamp(userId: string): Promise<void> {
  try {
    const ttl = 86400; // 24 hours

    await redis.setex(`trading:last_analysis:${userId}`, ttl, Date.now().toString());

    const btcData = await redisTradingService.getPrice('BTC_USD');
    if (btcData) {
      await redis.setex(
        `trading:btc_price_at_analysis:${userId}`,
        ttl,
        btcData.price.toString()
      );
    }
  } catch (err) {
    logger.error('storeAnalysisTimestamp: failed', {
      userId,
      error: (err as Error).message,
    });
  }
}
