/**
 * Scalping Service
 *
 * Background job that monitors for scalping opportunities (rebounds).
 * - Paper trading mode (default) for training
 * - Learns from successful and failed trades
 * - Can be switched to live mode by user
 */

import { pool } from '../db/index.js';
import { CryptoComClient } from './crypto-com.client.js';
import type { Ticker24hr } from './exchange.interface.js';
import * as tradingService from './trading.service.js';
import { getCachedPrice } from './trading.websocket.js';
import * as binanceWebSocket from './binance.websocket.js';
import * as redisTradingService from './redis-trading.service.js';
import logger from '../utils/logger.js';

// Price tracking for event-driven detection
const priceTracker = new Map<string, { price: number; timestamp: number }>();
const SIGNIFICANT_DROP_PCT = 1.5; // 1.5% drop triggers check
const PRICE_TRACK_WINDOW_MS = 5 * 60 * 1000; // 5 minute window
let eventDrivenEnabled = false;

// ============================================
// Types
// ============================================

export interface ScalpingSettings {
  userId: string;
  enabled: boolean;
  mode: 'paper' | 'live';
  maxPositionUsdt: number;
  maxConcurrentPositions: number;
  symbols: string[];
  minDropPct: number;
  maxDropPct: number;
  rsiOversoldThreshold: number;
  volumeSpikeMultiplier: number;
  minConfidence: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldMinutes: number;
  minTradesForLearning: number;
}

export interface ScalpingOpportunity {
  id?: string;
  userId: string;
  symbol: string;
  currentPrice: number;
  priceDropPct: number;
  rsiValue?: number;
  volumeRatio?: number;
  nearestSupport?: number;
  distanceToSupportPct?: number;
  confidenceScore: number;
  signalReasons: string[];
}

export interface PaperTrade {
  id: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  quantity: number;
  totalUsdt: number;
  status: 'open' | 'closed' | 'expired';
  exitPrice?: number;
  exitReason?: string;
  pnlUsdt?: number;
  pnlPct?: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  highestPrice: number;
  lowestPrice: number;
  expiresAt: Date;
  createdAt: Date;
}

interface PriceSnapshot {
  symbol: string;
  price: number;
  rsi14?: number;
  volume1m?: number;
  avgVolume1h?: number;
  high24h: number;
  low24h: number;
  change1hPct?: number;
  change24hPct: number;
}

// ============================================
// Settings Management
// ============================================

/**
 * Get scalping settings for a user
 */
export async function getSettings(userId: string): Promise<ScalpingSettings | null> {
  const result = await pool.query(
    `SELECT * FROM scalping_settings WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    userId: row.user_id,
    enabled: row.enabled,
    mode: row.mode,
    maxPositionUsdt: parseFloat(row.max_position_usdt),
    maxConcurrentPositions: row.max_concurrent_positions,
    symbols: row.symbols,
    minDropPct: parseFloat(row.min_drop_pct),
    maxDropPct: parseFloat(row.max_drop_pct),
    rsiOversoldThreshold: row.rsi_oversold_threshold,
    volumeSpikeMultiplier: parseFloat(row.volume_spike_multiplier),
    minConfidence: parseFloat(row.min_confidence),
    takeProfitPct: parseFloat(row.take_profit_pct),
    stopLossPct: parseFloat(row.stop_loss_pct),
    maxHoldMinutes: row.max_hold_minutes,
    minTradesForLearning: row.min_trades_for_learning,
  };
}

/**
 * Create or update scalping settings
 */
export async function updateSettings(
  userId: string,
  settings: Partial<ScalpingSettings>
): Promise<ScalpingSettings> {
  await pool.query(
    `INSERT INTO scalping_settings (
      user_id, enabled, mode, max_position_usdt, max_concurrent_positions,
      symbols, min_drop_pct, max_drop_pct, rsi_oversold_threshold,
      volume_spike_multiplier, min_confidence, take_profit_pct, stop_loss_pct,
      max_hold_minutes, min_trades_for_learning
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (user_id) DO UPDATE SET
      enabled = COALESCE($2, scalping_settings.enabled),
      mode = COALESCE($3, scalping_settings.mode),
      max_position_usdt = COALESCE($4, scalping_settings.max_position_usdt),
      max_concurrent_positions = COALESCE($5, scalping_settings.max_concurrent_positions),
      symbols = COALESCE($6, scalping_settings.symbols),
      min_drop_pct = COALESCE($7, scalping_settings.min_drop_pct),
      max_drop_pct = COALESCE($8, scalping_settings.max_drop_pct),
      rsi_oversold_threshold = COALESCE($9, scalping_settings.rsi_oversold_threshold),
      volume_spike_multiplier = COALESCE($10, scalping_settings.volume_spike_multiplier),
      min_confidence = COALESCE($11, scalping_settings.min_confidence),
      take_profit_pct = COALESCE($12, scalping_settings.take_profit_pct),
      stop_loss_pct = COALESCE($13, scalping_settings.stop_loss_pct),
      max_hold_minutes = COALESCE($14, scalping_settings.max_hold_minutes),
      min_trades_for_learning = COALESCE($15, scalping_settings.min_trades_for_learning),
      updated_at = NOW()
    RETURNING *`,
    [
      userId,
      settings.enabled,
      settings.mode,
      settings.maxPositionUsdt,
      settings.maxConcurrentPositions,
      settings.symbols,
      settings.minDropPct,
      settings.maxDropPct,
      settings.rsiOversoldThreshold,
      settings.volumeSpikeMultiplier,
      settings.minConfidence,
      settings.takeProfitPct,
      settings.stopLossPct,
      settings.maxHoldMinutes,
      settings.minTradesForLearning,
    ]
  );

  return getSettings(userId) as Promise<ScalpingSettings>;
}

/**
 * Enable or disable scalping
 */
export async function setEnabled(userId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE scalping_settings SET enabled = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, enabled]
  );
}

/**
 * Switch between paper and live mode
 */
export async function setMode(userId: string, mode: 'paper' | 'live'): Promise<void> {
  await pool.query(
    `UPDATE scalping_settings SET mode = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, mode]
  );
  logger.info('Scalping mode changed', { userId, mode });
}

// ============================================
// RSI Calculation
// ============================================

/**
 * Calculate RSI from klines
 */
function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // Not enough data, return neutral

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ============================================
// Price Snapshot Management
// ============================================

/**
 * Store price snapshot for pattern analysis
 */
async function storePriceSnapshot(snapshot: PriceSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO price_snapshots (
      symbol, price, rsi_14, volume_1m, avg_volume_1h,
      high_24h, low_24h, change_1h_pct, change_24h_pct
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      snapshot.symbol,
      snapshot.price,
      snapshot.rsi14,
      snapshot.volume1m,
      snapshot.avgVolume1h,
      snapshot.high24h,
      snapshot.low24h,
      snapshot.change1hPct,
      snapshot.change24hPct,
    ]
  );
}

/**
 * Get recent price history for a symbol
 */
async function getRecentPrices(symbol: string, minutes: number = 60): Promise<PriceSnapshot[]> {
  const result = await pool.query(
    `SELECT * FROM price_snapshots
     WHERE symbol = $1 AND snapshot_time > NOW() - INTERVAL '${minutes} minutes'
     ORDER BY snapshot_time ASC`,
    [symbol]
  );

  return result.rows.map(row => ({
    symbol: row.symbol,
    price: parseFloat(row.price),
    rsi14: row.rsi_14 ? parseFloat(row.rsi_14) : undefined,
    volume1m: row.volume_1m ? parseFloat(row.volume_1m) : undefined,
    avgVolume1h: row.avg_volume_1h ? parseFloat(row.avg_volume_1h) : undefined,
    high24h: parseFloat(row.high_24h),
    low24h: parseFloat(row.low_24h),
    change1hPct: row.change_1h_pct ? parseFloat(row.change_1h_pct) : undefined,
    change24hPct: parseFloat(row.change_24h_pct),
  }));
}

// ============================================
// Opportunity Detection
// ============================================

/**
 * Detect scalping opportunities based on price action
 */
async function detectOpportunities(
  settings: ScalpingSettings
): Promise<ScalpingOpportunity[]> {
  const opportunities: ScalpingOpportunity[] = [];
  const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });

  for (const symbol of settings.symbols) {
    try {
      // Get current price from cache or API
      let currentPrice: number;
      let change24hPct: number;
      let high24h: number;
      let low24h: number;
      let volume: number;

      const cached = getCachedPrice(symbol);
      if (cached) {
        currentPrice = cached.price;
        change24hPct = cached.change24h;
        high24h = cached.high24h;
        low24h = cached.low24h;
        volume = cached.volume;
      } else {
        const ticker = await publicClient.getTicker24hr(symbol) as Ticker24hr;
        currentPrice = parseFloat(ticker.lastPrice);
        change24hPct = parseFloat(ticker.priceChangePercent);
        high24h = parseFloat(ticker.highPrice);
        low24h = parseFloat(ticker.lowPrice);
        volume = parseFloat(ticker.volume);
      }

      // Get klines for RSI calculation
      const klines = await tradingService.getKlines(symbol, '5m', 20);
      const closes = klines.map(k => parseFloat(k.close));
      const rsi = calculateRSI(closes);

      // Get 1-hour price history to detect drops
      const recentPrices = await getRecentPrices(symbol, 60);
      let recentHigh = currentPrice;
      let priceDropPct = 0;

      if (recentPrices.length > 0) {
        recentHigh = Math.max(...recentPrices.map(p => p.price));
        priceDropPct = ((recentHigh - currentPrice) / recentHigh) * 100;
      }

      // Calculate volume ratio
      let volumeRatio = 1;
      if (recentPrices.length >= 12) {
        const avgVolume = recentPrices.reduce((sum, p) => sum + (p.volume1m || 0), 0) / recentPrices.length;
        volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
      }

      // Store snapshot for pattern analysis
      await storePriceSnapshot({
        symbol,
        price: currentPrice,
        rsi14: rsi,
        volume1m: volume,
        high24h,
        low24h,
        change24hPct,
      });

      // Evaluate opportunity
      const signalReasons: string[] = [];
      let confidenceScore = 0;

      // 1. Price drop within range
      if (priceDropPct >= settings.minDropPct && priceDropPct <= settings.maxDropPct) {
        signalReasons.push(`Price dropped ${priceDropPct.toFixed(2)}% from recent high`);
        confidenceScore += 0.25;

        // More confidence for moderate drops
        if (priceDropPct >= 2 && priceDropPct <= 5) {
          confidenceScore += 0.1;
        }
      }

      // 2. RSI oversold
      if (rsi <= settings.rsiOversoldThreshold) {
        signalReasons.push(`RSI oversold at ${rsi.toFixed(1)}`);
        confidenceScore += 0.25;

        // Very oversold = higher confidence
        if (rsi <= 25) {
          confidenceScore += 0.1;
        }
      }

      // 3. Volume spike
      if (volumeRatio >= settings.volumeSpikeMultiplier) {
        signalReasons.push(`Volume spike ${volumeRatio.toFixed(1)}x average`);
        confidenceScore += 0.2;
      }

      // 4. Near support (24h low)
      const distanceToSupport = ((currentPrice - low24h) / low24h) * 100;
      if (distanceToSupport <= 2) {
        signalReasons.push(`Near 24h support ($${low24h.toFixed(2)})`);
        confidenceScore += 0.15;
      }

      // 5. Apply learned pattern modifiers
      const patternModifier = await getPatternConfidenceModifier(settings.userId, symbol, {
        priceDropPct,
        rsi,
        volumeRatio,
      });
      confidenceScore += patternModifier;

      // Cap confidence at 1.0
      confidenceScore = Math.min(1, Math.max(0, confidenceScore));

      // Only report if we have enough signals and confidence
      if (signalReasons.length >= 2 && confidenceScore >= settings.minConfidence) {
        opportunities.push({
          userId: settings.userId,
          symbol,
          currentPrice,
          priceDropPct,
          rsiValue: rsi,
          volumeRatio,
          nearestSupport: low24h,
          distanceToSupportPct: distanceToSupport,
          confidenceScore,
          signalReasons,
        });
      }
    } catch (err) {
      logger.error('Failed to analyze symbol for scalping', {
        symbol,
        error: (err as Error).message,
      });
    }
  }

  return opportunities;
}

/**
 * Get confidence modifier from learned patterns
 */
async function getPatternConfidenceModifier(
  userId: string,
  symbol: string,
  conditions: { priceDropPct: number; rsi: number; volumeRatio: number }
): Promise<number> {
  // Generate pattern key based on conditions
  const dropRange = conditions.priceDropPct < 2 ? 'low' : conditions.priceDropPct < 5 ? 'med' : 'high';
  const rsiRange = conditions.rsi < 25 ? 'very_oversold' : conditions.rsi < 30 ? 'oversold' : 'neutral';
  const volRange = conditions.volumeRatio < 1.5 ? 'normal' : conditions.volumeRatio < 3 ? 'elevated' : 'spike';

  const patternKey = `${symbol}_${dropRange}_${rsiRange}_${volRange}`;

  const result = await pool.query(
    `SELECT confidence_modifier FROM scalping_patterns
     WHERE user_id = $1 AND pattern_key = $2`,
    [userId, patternKey]
  );

  if (result.rows.length > 0) {
    return parseFloat(result.rows[0].confidence_modifier);
  }

  return 0;
}

// ============================================
// Paper Trading
// ============================================

/**
 * Execute a paper trade
 */
export async function executePaperTrade(
  opportunity: ScalpingOpportunity,
  settings: ScalpingSettings
): Promise<PaperTrade> {
  const quantity = settings.maxPositionUsdt / opportunity.currentPrice;
  const takeProfitPrice = opportunity.currentPrice * (1 + settings.takeProfitPct / 100);
  const stopLossPrice = opportunity.currentPrice * (1 - settings.stopLossPct / 100);
  const expiresAt = new Date(Date.now() + settings.maxHoldMinutes * 60 * 1000);

  // Store the opportunity
  const oppResult = await pool.query(
    `INSERT INTO scalping_opportunities (
      user_id, symbol, current_price, price_drop_pct, rsi_value,
      volume_ratio, nearest_support, distance_to_support_pct,
      confidence_score, signal_reasons, action_taken
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'paper_trade')
    RETURNING id`,
    [
      opportunity.userId,
      opportunity.symbol,
      opportunity.currentPrice,
      opportunity.priceDropPct,
      opportunity.rsiValue,
      opportunity.volumeRatio,
      opportunity.nearestSupport,
      opportunity.distanceToSupportPct,
      opportunity.confidenceScore,
      JSON.stringify(opportunity.signalReasons),
    ]
  );

  const opportunityId = oppResult.rows[0].id;

  // Create paper trade
  const result = await pool.query(
    `INSERT INTO paper_trades (
      user_id, opportunity_id, symbol, side, entry_price, quantity,
      total_usdt, status, take_profit_price, stop_loss_price,
      highest_price, lowest_price, expires_at
    ) VALUES ($1, $2, $3, 'buy', $4, $5, $6, 'open', $7, $8, $4, $4, $9)
    RETURNING *`,
    [
      opportunity.userId,
      opportunityId,
      opportunity.symbol,
      opportunity.currentPrice,
      quantity,
      settings.maxPositionUsdt,
      takeProfitPrice,
      stopLossPrice,
      expiresAt,
    ]
  );

  // Update opportunity with trade ID
  await pool.query(
    `UPDATE scalping_opportunities SET trade_id = $1 WHERE id = $2`,
    [result.rows[0].id, opportunityId]
  );

  logger.info('Paper trade opened', {
    userId: opportunity.userId,
    symbol: opportunity.symbol,
    entryPrice: opportunity.currentPrice,
    confidence: opportunity.confidenceScore,
    reasons: opportunity.signalReasons,
  });

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    side: row.side,
    entryPrice: parseFloat(row.entry_price),
    quantity: parseFloat(row.quantity),
    totalUsdt: parseFloat(row.total_usdt),
    status: row.status,
    takeProfitPrice: parseFloat(row.take_profit_price),
    stopLossPrice: parseFloat(row.stop_loss_price),
    highestPrice: parseFloat(row.highest_price),
    lowestPrice: parseFloat(row.lowest_price),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Monitor and close paper trades
 */
async function monitorPaperTrades(): Promise<{ closed: number }> {
  let closed = 0;

  // Get all open paper trades
  const result = await pool.query(
    `SELECT * FROM paper_trades WHERE status = 'open'`
  );

  for (const trade of result.rows) {
    const cached = getCachedPrice(trade.symbol);
    if (!cached) continue;

    const currentPrice = cached.price;
    const entryPrice = parseFloat(trade.entry_price);
    const takeProfitPrice = parseFloat(trade.take_profit_price);
    const stopLossPrice = parseFloat(trade.stop_loss_price);
    const highestPrice = parseFloat(trade.highest_price);
    const lowestPrice = parseFloat(trade.lowest_price);
    const expiresAt = new Date(trade.expires_at);

    // Update highest/lowest prices
    const newHighest = Math.max(highestPrice, currentPrice);
    const newLowest = Math.min(lowestPrice, currentPrice);
    await pool.query(
      `UPDATE paper_trades SET highest_price = $1, lowest_price = $2 WHERE id = $3`,
      [newHighest, newLowest, trade.id]
    );

    let exitReason: string | null = null;
    let exitPrice = currentPrice;

    // Check exit conditions
    if (currentPrice >= takeProfitPrice) {
      exitReason = 'take_profit';
    } else if (currentPrice <= stopLossPrice) {
      exitReason = 'stop_loss';
    } else if (new Date() >= expiresAt) {
      exitReason = 'timeout';
    }

    if (exitReason) {
      const quantity = parseFloat(trade.quantity);
      const pnlUsdt = (exitPrice - entryPrice) * quantity;
      const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

      await pool.query(
        `UPDATE paper_trades SET
          status = 'closed', exit_price = $1, exit_reason = $2,
          pnl_usdt = $3, pnl_pct = $4, closed_at = NOW()
        WHERE id = $5`,
        [exitPrice, exitReason, pnlUsdt, pnlPct, trade.id]
      );

      // Update opportunity outcome
      await pool.query(
        `UPDATE scalping_opportunities SET
          outcome = $1, outcome_pct = $2, outcome_at = NOW()
        WHERE trade_id = $3`,
        [
          pnlUsdt > 0 ? 'profit' : (exitReason === 'timeout' ? 'timeout' : 'loss'),
          pnlPct,
          trade.id,
        ]
      );

      // Update learning patterns
      await updatePatternLearning(
        trade.user_id,
        trade.symbol,
        trade.opportunity_id,
        pnlUsdt > 0 ? 'success' : (exitReason === 'timeout' ? 'timeout' : 'failure'),
        pnlPct
      );

      // Update daily stats
      await updateDailyStats(trade.user_id, 'paper', {
        pnlUsdt,
        isWin: pnlUsdt > 0,
        isTimeout: exitReason === 'timeout',
        holdSeconds: Math.floor((Date.now() - new Date(trade.created_at).getTime()) / 1000),
      });

      logger.info('Paper trade closed', {
        tradeId: trade.id,
        symbol: trade.symbol,
        exitReason,
        pnlUsdt: pnlUsdt.toFixed(2),
        pnlPct: pnlPct.toFixed(2),
      });

      closed++;
    }
  }

  return { closed };
}

// ============================================
// Live Trading
// ============================================

/**
 * Execute a live trade
 */
export async function executeLiveTrade(
  opportunity: ScalpingOpportunity,
  settings: ScalpingSettings
): Promise<string | null> {
  try {
    // Store opportunity
    const oppResult = await pool.query(
      `INSERT INTO scalping_opportunities (
        user_id, symbol, current_price, price_drop_pct, rsi_value,
        volume_ratio, nearest_support, distance_to_support_pct,
        confidence_score, signal_reasons, action_taken
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'live_trade')
      RETURNING id`,
      [
        opportunity.userId,
        opportunity.symbol,
        opportunity.currentPrice,
        opportunity.priceDropPct,
        opportunity.rsiValue,
        opportunity.volumeRatio,
        opportunity.nearestSupport,
        opportunity.distanceToSupportPct,
        opportunity.confidenceScore,
        JSON.stringify(opportunity.signalReasons),
      ]
    );

    const opportunityId = oppResult.rows[0].id;

    // Place live order through trading service
    const result = await tradingService.placeOrder(opportunity.userId, {
      symbol: opportunity.symbol,
      side: 'buy',
      type: 'market',
      quoteAmount: settings.maxPositionUsdt,
      stopLoss: opportunity.currentPrice * (1 - settings.stopLossPct / 100),
      takeProfit: opportunity.currentPrice * (1 + settings.takeProfitPct / 100),
      notes: `Scalping: ${opportunity.signalReasons.join(', ')}`,
    });

    // Update opportunity with trade ID
    await pool.query(
      `UPDATE scalping_opportunities SET trade_id = $1 WHERE id = $2`,
      [result.id, opportunityId]
    );

    logger.info('Live scalping trade executed', {
      userId: opportunity.userId,
      symbol: opportunity.symbol,
      orderId: result.id,
    });

    return result.id;
  } catch (err) {
    logger.error('Failed to execute live scalping trade', {
      userId: opportunity.userId,
      symbol: opportunity.symbol,
      error: (err as Error).message,
    });
    return null;
  }
}

// ============================================
// Learning System
// ============================================

/**
 * Update pattern learning based on trade outcome
 */
async function updatePatternLearning(
  userId: string,
  symbol: string,
  opportunityId: string,
  outcome: 'success' | 'failure' | 'timeout',
  pnlPct: number
): Promise<void> {
  // Get opportunity details
  const oppResult = await pool.query(
    `SELECT * FROM scalping_opportunities WHERE id = $1`,
    [opportunityId]
  );

  if (oppResult.rows.length === 0) return;

  const opp = oppResult.rows[0];

  // Generate pattern key
  const dropRange = opp.price_drop_pct < 2 ? 'low' : opp.price_drop_pct < 5 ? 'med' : 'high';
  const rsiRange = opp.rsi_value < 25 ? 'very_oversold' : opp.rsi_value < 30 ? 'oversold' : 'neutral';
  const volRatio = opp.volume_ratio || 1;
  const volRange = volRatio < 1.5 ? 'normal' : volRatio < 3 ? 'elevated' : 'spike';

  const patternKey = `${symbol}_${dropRange}_${rsiRange}_${volRange}`;

  // Upsert pattern
  await pool.query(
    `INSERT INTO scalping_patterns (
      user_id, pattern_key, symbol, conditions,
      total_occurrences, successful_trades, failed_trades, timeout_trades,
      avg_profit_pct, avg_loss_pct, win_rate, confidence_modifier,
      last_occurrence_at
    ) VALUES (
      $1, $2, $3, $4,
      1,
      CASE WHEN $5 = 'success' THEN 1 ELSE 0 END,
      CASE WHEN $5 = 'failure' THEN 1 ELSE 0 END,
      CASE WHEN $5 = 'timeout' THEN 1 ELSE 0 END,
      CASE WHEN $5 = 'success' THEN $6 ELSE 0 END,
      CASE WHEN $5 = 'failure' THEN ABS($6) ELSE 0 END,
      CASE WHEN $5 = 'success' THEN 1 ELSE 0 END,
      0,
      NOW()
    )
    ON CONFLICT (user_id, pattern_key) DO UPDATE SET
      total_occurrences = scalping_patterns.total_occurrences + 1,
      successful_trades = scalping_patterns.successful_trades + CASE WHEN $5 = 'success' THEN 1 ELSE 0 END,
      failed_trades = scalping_patterns.failed_trades + CASE WHEN $5 = 'failure' THEN 1 ELSE 0 END,
      timeout_trades = scalping_patterns.timeout_trades + CASE WHEN $5 = 'timeout' THEN 1 ELSE 0 END,
      avg_profit_pct = CASE
        WHEN $5 = 'success' THEN
          (scalping_patterns.avg_profit_pct * scalping_patterns.successful_trades + $6) /
          (scalping_patterns.successful_trades + 1)
        ELSE scalping_patterns.avg_profit_pct
      END,
      avg_loss_pct = CASE
        WHEN $5 = 'failure' THEN
          (scalping_patterns.avg_loss_pct * scalping_patterns.failed_trades + ABS($6)) /
          (scalping_patterns.failed_trades + 1)
        ELSE scalping_patterns.avg_loss_pct
      END,
      win_rate = (scalping_patterns.successful_trades + CASE WHEN $5 = 'success' THEN 1 ELSE 0 END)::DECIMAL /
        (scalping_patterns.total_occurrences + 1),
      last_occurrence_at = NOW(),
      updated_at = NOW()`,
    [
      userId,
      patternKey,
      symbol,
      JSON.stringify({ dropRange, rsiRange, volRange }),
      outcome,
      pnlPct,
    ]
  );

  // Recalculate confidence modifier based on win rate
  await pool.query(
    `UPDATE scalping_patterns SET
      confidence_modifier = CASE
        WHEN total_occurrences >= 10 THEN (win_rate - 0.5) * 0.3  -- Scale win rate to -0.15 to +0.15
        ELSE 0  -- Not enough data yet
      END
    WHERE user_id = $1 AND pattern_key = $2`,
    [userId, patternKey]
  );
}

/**
 * Update daily statistics
 */
async function updateDailyStats(
  userId: string,
  mode: 'paper' | 'live',
  trade: { pnlUsdt: number; isWin: boolean; isTimeout: boolean; holdSeconds: number }
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await pool.query(
    `INSERT INTO scalping_daily_stats (
      user_id, date, mode, total_trades, winning_trades, losing_trades,
      timeout_trades, total_pnl_usdt, avg_trade_pnl_usdt,
      best_trade_pnl_usdt, worst_trade_pnl_usdt, avg_hold_seconds
    ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $7, $8, $9, $10)
    ON CONFLICT (user_id, date, mode) DO UPDATE SET
      total_trades = scalping_daily_stats.total_trades + 1,
      winning_trades = scalping_daily_stats.winning_trades + $4,
      losing_trades = scalping_daily_stats.losing_trades + $5,
      timeout_trades = scalping_daily_stats.timeout_trades + $6,
      total_pnl_usdt = scalping_daily_stats.total_pnl_usdt + $7,
      avg_trade_pnl_usdt = (scalping_daily_stats.total_pnl_usdt + $7) /
        (scalping_daily_stats.total_trades + 1),
      best_trade_pnl_usdt = GREATEST(scalping_daily_stats.best_trade_pnl_usdt, $7),
      worst_trade_pnl_usdt = LEAST(scalping_daily_stats.worst_trade_pnl_usdt, $7),
      avg_hold_seconds = (scalping_daily_stats.avg_hold_seconds * scalping_daily_stats.total_trades + $10) /
        (scalping_daily_stats.total_trades + 1)`,
    [
      userId,
      today,
      mode,
      trade.isWin ? 1 : 0,
      !trade.isWin && !trade.isTimeout ? 1 : 0,
      trade.isTimeout ? 1 : 0,
      trade.pnlUsdt,
      trade.pnlUsdt > 0 ? trade.pnlUsdt : 0,
      trade.pnlUsdt < 0 ? trade.pnlUsdt : 0,
      trade.holdSeconds,
    ]
  );
}

// ============================================
// Statistics and Reporting
// ============================================

/**
 * Get scalping performance stats
 */
export async function getStats(
  userId: string,
  days: number = 30
): Promise<{
  paper: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
  live: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
  patterns: { key: string; winRate: number; trades: number; modifier: number }[];
}> {
  const stats = {
    paper: { trades: 0, winRate: 0, totalPnl: 0, avgPnl: 0 },
    live: { trades: 0, winRate: 0, totalPnl: 0, avgPnl: 0 },
    patterns: [] as { key: string; winRate: number; trades: number; modifier: number }[],
  };

  // Get aggregated daily stats
  const dailyResult = await pool.query(
    `SELECT mode,
      SUM(total_trades) as trades,
      SUM(winning_trades) as wins,
      SUM(total_pnl_usdt) as pnl
    FROM scalping_daily_stats
    WHERE user_id = $1 AND date > NOW() - INTERVAL '${days} days'
    GROUP BY mode`,
    [userId]
  );

  for (const row of dailyResult.rows) {
    const mode = row.mode as 'paper' | 'live';
    const trades = parseInt(row.trades);
    const wins = parseInt(row.wins);
    const pnl = parseFloat(row.pnl);

    stats[mode] = {
      trades,
      winRate: trades > 0 ? wins / trades : 0,
      totalPnl: pnl,
      avgPnl: trades > 0 ? pnl / trades : 0,
    };
  }

  // Get top patterns
  const patternsResult = await pool.query(
    `SELECT pattern_key, win_rate, total_occurrences, confidence_modifier
     FROM scalping_patterns
     WHERE user_id = $1 AND total_occurrences >= 5
     ORDER BY total_occurrences DESC
     LIMIT 10`,
    [userId]
  );

  stats.patterns = patternsResult.rows.map(row => ({
    key: row.pattern_key,
    winRate: parseFloat(row.win_rate),
    trades: row.total_occurrences,
    modifier: parseFloat(row.confidence_modifier),
  }));

  return stats;
}

/**
 * Get open positions (paper trades)
 */
export async function getOpenPositions(userId: string): Promise<PaperTrade[]> {
  const result = await pool.query(
    `SELECT * FROM paper_trades WHERE user_id = $1 AND status = 'open' ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    side: row.side,
    entryPrice: parseFloat(row.entry_price),
    quantity: parseFloat(row.quantity),
    totalUsdt: parseFloat(row.total_usdt),
    status: row.status,
    exitPrice: row.exit_price ? parseFloat(row.exit_price) : undefined,
    exitReason: row.exit_reason,
    pnlUsdt: row.pnl_usdt ? parseFloat(row.pnl_usdt) : undefined,
    pnlPct: row.pnl_pct ? parseFloat(row.pnl_pct) : undefined,
    takeProfitPrice: parseFloat(row.take_profit_price),
    stopLossPrice: parseFloat(row.stop_loss_price),
    highestPrice: parseFloat(row.highest_price),
    lowestPrice: parseFloat(row.lowest_price),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

// ============================================
// Main Job Runner
// ============================================

/**
 * Main scalping job - called by job runner every 30 seconds
 */
export async function runScalpingJob(): Promise<{
  usersProcessed: number;
  opportunitiesFound: number;
  paperTrades: number;
  liveTrades: number;
  paperTradesClosed: number;
}> {
  const results = {
    usersProcessed: 0,
    opportunitiesFound: 0,
    paperTrades: 0,
    liveTrades: 0,
    paperTradesClosed: 0,
  };

  try {
    // Get all users with scalping enabled
    const usersResult = await pool.query(
      `SELECT * FROM scalping_settings WHERE enabled = true`
    );

    for (const row of usersResult.rows) {
      const settings = {
        userId: row.user_id,
        enabled: row.enabled,
        mode: row.mode as 'paper' | 'live',
        maxPositionUsdt: parseFloat(row.max_position_usdt),
        maxConcurrentPositions: row.max_concurrent_positions,
        symbols: row.symbols,
        minDropPct: parseFloat(row.min_drop_pct),
        maxDropPct: parseFloat(row.max_drop_pct),
        rsiOversoldThreshold: row.rsi_oversold_threshold,
        volumeSpikeMultiplier: parseFloat(row.volume_spike_multiplier),
        minConfidence: parseFloat(row.min_confidence),
        takeProfitPct: parseFloat(row.take_profit_pct),
        stopLossPct: parseFloat(row.stop_loss_pct),
        maxHoldMinutes: row.max_hold_minutes,
        minTradesForLearning: row.min_trades_for_learning,
      };

      results.usersProcessed++;

      // Check concurrent positions
      const openPositions = await getOpenPositions(settings.userId);
      if (openPositions.length >= settings.maxConcurrentPositions) {
        continue;
      }

      // Detect opportunities
      const opportunities = await detectOpportunities(settings);
      results.opportunitiesFound += opportunities.length;

      // Execute trades for each opportunity
      for (const opp of opportunities) {
        // Skip if we already have a position in this symbol
        if (openPositions.some(p => p.symbol === opp.symbol)) {
          continue;
        }

        if (settings.mode === 'paper') {
          await executePaperTrade(opp, settings);
          results.paperTrades++;
        } else {
          const orderId = await executeLiveTrade(opp, settings);
          if (orderId) results.liveTrades++;
        }

        // Update daily stats for opportunity count
        const today = new Date().toISOString().split('T')[0];
        await pool.query(
          `INSERT INTO scalping_daily_stats (user_id, date, mode, opportunities_detected, opportunities_traded)
           VALUES ($1, $2, $3, 1, 1)
           ON CONFLICT (user_id, date, mode) DO UPDATE SET
             opportunities_detected = scalping_daily_stats.opportunities_detected + 1,
             opportunities_traded = scalping_daily_stats.opportunities_traded + 1`,
          [settings.userId, today, settings.mode]
        );
      }
    }

    // Monitor and close paper trades
    const closed = await monitorPaperTrades();
    results.paperTradesClosed = closed.closed;

    // Cleanup old price snapshots
    await pool.query(`SELECT cleanup_old_price_snapshots()`);

  } catch (error) {
    logger.error('Scalping job failed', { error: (error as Error).message });
  }

  if (results.opportunitiesFound > 0 || results.paperTradesClosed > 0) {
    logger.info('Scalping job completed', results);
  }

  return results;
}

// ============================================
// Event-Driven Scalping Detection
// ============================================

/**
 * Check for significant price drop that warrants immediate opportunity check
 */
function checkForSignificantDrop(
  symbol: string,
  currentPrice: number
): { isDrop: boolean; dropPct: number } {
  const now = Date.now();
  const tracked = priceTracker.get(symbol);

  // Update tracker with current price if it's higher than what we have
  // (we track highs to detect drops from)
  if (!tracked || currentPrice > tracked.price || now - tracked.timestamp > PRICE_TRACK_WINDOW_MS) {
    priceTracker.set(symbol, { price: currentPrice, timestamp: now });
    return { isDrop: false, dropPct: 0 };
  }

  // Check if we've dropped significantly from the tracked high
  const dropPct = ((tracked.price - currentPrice) / tracked.price) * 100;

  if (dropPct >= SIGNIFICANT_DROP_PCT) {
    // Reset tracker after detecting a drop
    priceTracker.set(symbol, { price: currentPrice, timestamp: now });
    return { isDrop: true, dropPct };
  }

  return { isDrop: false, dropPct };
}

/**
 * Handle price update - check for significant drops that might be scalping opportunities
 */
async function handlePriceUpdate(
  updates: redisTradingService.PriceData[]
): Promise<void> {
  for (const update of updates) {
    const { isDrop, dropPct } = checkForSignificantDrop(update.symbol, update.price);

    if (isDrop) {
      logger.info('Significant price drop detected', {
        symbol: update.symbol,
        dropPct: dropPct.toFixed(2),
        price: update.price,
      });

      // Find users with scalping enabled for this symbol and trigger check
      try {
        const result = await pool.query<{ user_id: string }>(
          `SELECT user_id FROM scalping_settings
           WHERE enabled = true
           AND $1 = ANY(symbols)`,
          [update.symbol]
        );

        for (const row of result.rows) {
          // Queue a quick scalping check for this user/symbol
          // Run async to not block price processing
          triggerQuickCheck(row.user_id, update.symbol).catch(err => {
            logger.error('Failed to trigger quick scalping check', {
              userId: row.user_id,
              symbol: update.symbol,
              error: (err as Error).message,
            });
          });
        }
      } catch (err) {
        logger.error('Failed to find users for scalping trigger', {
          symbol: update.symbol,
          error: (err as Error).message,
        });
      }
    }
  }
}

// Track in-progress quick checks to avoid duplicates
const pendingQuickChecks = new Set<string>();

/**
 * Trigger a quick scalping check for a specific user and symbol
 */
async function triggerQuickCheck(userId: string, symbol: string): Promise<void> {
  const key = `${userId}:${symbol}`;
  if (pendingQuickChecks.has(key)) return;

  pendingQuickChecks.add(key);

  try {
    const settings = await getSettings(userId);
    if (!settings?.enabled) return;

    // Get open positions to check if we already have one
    // getOpenPositions works for both paper and live modes
    const openPositions = await getOpenPositions(userId);

    if (openPositions.some(p => p.symbol === symbol)) {
      return; // Already have a position
    }

    // Quick opportunity detection for single symbol
    const opportunity = await detectSingleOpportunity(settings, symbol);

    if (opportunity && opportunity.confidenceScore >= settings.minConfidence) {
      logger.info('Quick scalping opportunity detected', {
        userId,
        symbol,
        confidence: opportunity.confidenceScore.toFixed(2),
      });

      if (settings.mode === 'paper') {
        await executePaperTrade(opportunity, settings);
      } else {
        await executeLiveTrade(opportunity, settings);
      }
    }
  } finally {
    pendingQuickChecks.delete(key);
  }
}

/**
 * Detect opportunity for a single symbol (for quick checks)
 */
async function detectSingleOpportunity(
  settings: ScalpingSettings,
  symbol: string
): Promise<ScalpingOpportunity | null> {
  const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });

  try {
    // Get current price from cache or API
    let currentPrice: number;
    let low24h: number;
    let volume: number;

    const cached = getCachedPrice(symbol);
    if (cached) {
      currentPrice = cached.price;
      low24h = cached.low24h;
      volume = cached.volume;
    } else {
      const ticker = await publicClient.getTicker24hr(symbol) as Ticker24hr;
      currentPrice = parseFloat(ticker.lastPrice);
      low24h = parseFloat(ticker.lowPrice);
      volume = parseFloat(ticker.volume);
    }

    // Get klines for RSI calculation
    const klines = await tradingService.getKlines(symbol, '5m', 20);
    const closes = klines.map(k => parseFloat(k.close));
    const rsi = calculateRSI(closes);

    // Get recent prices for drop detection
    const recentPrices = await getRecentPrices(symbol, 60);
    let recentHigh = currentPrice;
    let priceDropPct = 0;

    if (recentPrices.length > 0) {
      recentHigh = Math.max(...recentPrices.map(p => p.price));
      priceDropPct = ((recentHigh - currentPrice) / recentHigh) * 100;
    }

    // Calculate volume ratio
    let volumeRatio = 1;
    if (recentPrices.length >= 12) {
      const avgVolume = recentPrices.reduce((sum, p) => sum + (p.volume1m || 0), 0) / recentPrices.length;
      volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
    }

    // Evaluate opportunity
    const signalReasons: string[] = [];
    let confidenceScore = 0;

    // Price drop
    if (priceDropPct >= settings.minDropPct && priceDropPct <= settings.maxDropPct) {
      signalReasons.push(`Price dropped ${priceDropPct.toFixed(2)}% from recent high`);
      confidenceScore += 0.25;
      if (priceDropPct >= 2 && priceDropPct <= 5) confidenceScore += 0.1;
    }

    // RSI oversold
    if (rsi <= settings.rsiOversoldThreshold) {
      signalReasons.push(`RSI oversold at ${rsi.toFixed(1)}`);
      confidenceScore += 0.25;
      if (rsi <= 25) confidenceScore += 0.1;
    }

    // Volume spike
    if (volumeRatio >= settings.volumeSpikeMultiplier) {
      signalReasons.push(`Volume spike ${volumeRatio.toFixed(1)}x average`);
      confidenceScore += 0.2;
    }

    // Near support
    const distanceToSupport = ((currentPrice - low24h) / low24h) * 100;
    if (distanceToSupport <= 2) {
      signalReasons.push(`Near 24h support ($${low24h.toFixed(2)})`);
      confidenceScore += 0.15;
    }

    // Pattern modifier
    const patternModifier = await getPatternConfidenceModifier(settings.userId, symbol, {
      priceDropPct,
      rsi,
      volumeRatio,
    });
    confidenceScore += patternModifier;
    confidenceScore = Math.min(1, Math.max(0, confidenceScore));

    if (signalReasons.length >= 2) {
      return {
        userId: settings.userId,
        symbol,
        currentPrice,
        priceDropPct,
        rsiValue: rsi,
        volumeRatio,
        distanceToSupportPct: distanceToSupport,
        confidenceScore,
        signalReasons,
      };
    }

    return null;
  } catch (error) {
    logger.error('Failed to detect single opportunity', {
      symbol,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Initialize event-driven scalping detection
 * Registers a callback to detect opportunities when prices drop significantly
 */
export function initEventDrivenScalping(): void {
  if (eventDrivenEnabled) {
    logger.warn('Event-driven scalping already initialized');
    return;
  }

  binanceWebSocket.onPriceUpdate(handlePriceUpdate);
  eventDrivenEnabled = true;
  logger.info('Event-driven scalping detection enabled');
}

export default {
  getSettings,
  updateSettings,
  setEnabled,
  setMode,
  getStats,
  getOpenPositions,
  runScalpingJob,
  initEventDrivenScalping,
};
