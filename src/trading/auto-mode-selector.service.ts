/**
 * Auto Mode Selector Service
 *
 * Automatically selects the best trading strategy based on:
 * - 70% Market regime fit
 * - 30% Recent win rate (last 20 trades per strategy)
 *
 * Runs every scan cycle (30s) to adapt to changing market conditions.
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { detectMarketRegime, MarketRegimeData } from './regime-detector.service.js';
import {
  StrategyId,
  getStrategy,
  getStrategyIds,
  MarketRegime,
} from './strategies/index.js';

/**
 * Strategy scoring result
 */
export interface StrategyScore {
  strategyId: StrategyId;
  totalScore: number;
  regimeScore: number;
  winRateScore: number;
  winRate: number;
  totalTrades: number;
}

/**
 * Auto mode selection result
 */
export interface AutoModeSelection {
  selectedStrategy: StrategyId;
  regime: MarketRegime;
  totalScore: number;
  regimeScore: number;
  winRateScore: number;
  alternatives: StrategyScore[];
}

/**
 * Strategy performance record
 */
export interface StrategyPerformance {
  strategy: StrategyId;
  wins: number;
  losses: number;
  breakeven: number;
  totalTrades: number;
  winRate: number;
  avgPnlPct: number;
}

// Score weights
const REGIME_WEIGHT = 0.7;
const WINRATE_WEIGHT = 0.3;

/**
 * Get win rate for a strategy from last 20 trades
 */
export async function getStrategyPerformance(
  userId: string,
  strategy: StrategyId,
  limit: number = 20
): Promise<StrategyPerformance> {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE trade_result = 'win') as wins,
         COUNT(*) FILTER (WHERE trade_result = 'loss') as losses,
         COUNT(*) FILTER (WHERE trade_result = 'breakeven') as breakeven,
         COUNT(*) as total,
         AVG(pnl_pct) as avg_pnl
       FROM (
         SELECT trade_result, pnl_pct
         FROM auto_strategy_performance
         WHERE user_id = $1 AND strategy = $2
         ORDER BY created_at DESC
         LIMIT $3
       ) recent`,
      [userId, strategy, limit]
    );

    const row = result.rows[0] || { wins: 0, losses: 0, breakeven: 0, total: 0, avg_pnl: null };
    const wins = parseInt(row.wins || '0');
    const losses = parseInt(row.losses || '0');
    const breakeven = parseInt(row.breakeven || '0');
    const totalTrades = parseInt(row.total || '0');

    return {
      strategy,
      wins,
      losses,
      breakeven,
      totalTrades,
      winRate: totalTrades > 0 ? wins / totalTrades : 0.5, // Default 50% if no history
      avgPnlPct: row.avg_pnl ? parseFloat(row.avg_pnl) : 0,
    };
  } catch (error) {
    logger.error('Failed to get strategy performance', { userId, strategy, error });
    return {
      strategy,
      wins: 0,
      losses: 0,
      breakeven: 0,
      totalTrades: 0,
      winRate: 0.5,
      avgPnlPct: 0,
    };
  }
}

/**
 * Get all strategy performances for a user
 */
export async function getAllStrategyPerformances(
  userId: string
): Promise<Record<StrategyId, StrategyPerformance>> {
  const performances: Partial<Record<StrategyId, StrategyPerformance>> = {};

  for (const strategyId of getStrategyIds()) {
    performances[strategyId] = await getStrategyPerformance(userId, strategyId);
  }

  return performances as Record<StrategyId, StrategyPerformance>;
}

/**
 * Calculate regime fit score for a strategy
 * Considers both regime type AND trend direction
 */
function calculateRegimeFitScore(
  strategyId: StrategyId,
  currentRegime: MarketRegime,
  btcTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral'
): number {
  const strategy = getStrategy(strategyId);
  if (!strategy) return 0.2;

  // Base score: 1.0 if regime matches, 0.2 if not
  let score = strategy.meta.suitableRegimes.includes(currentRegime) ? 1.0 : 0.2;

  // Adjust for trend direction in trending markets
  if (currentRegime === 'trending') {
    if (btcTrend === 'bearish') {
      // In bearish trends, boost rsi_oversold (catches oversold bounces)
      // Reduce strategies that only work for bullish setups
      if (strategyId === 'rsi_oversold') {
        score = 1.0; // Best for catching bounces in bearish trends
      } else if (strategyId === 'trend_following' || strategyId === 'momentum') {
        score = 0.3; // These only work for bullish trends
      }
    } else if (btcTrend === 'bullish') {
      // In bullish trends, trend_following is optimal
      if (strategyId === 'trend_following') {
        score = 1.0;
      }
    }
  }

  return score;
}

/**
 * Score all strategies and select the best one
 */
export async function selectBestStrategy(
  userId: string,
  regimeData?: MarketRegimeData
): Promise<AutoModeSelection> {
  // Get current regime if not provided
  const regime = regimeData || await detectMarketRegime();

  // Score each strategy
  const scores: StrategyScore[] = [];

  for (const strategyId of getStrategyIds()) {
    // Pass btcTrend to regime scoring for trend-aware selection
    const regimeScore = calculateRegimeFitScore(strategyId, regime.regime, regime.btcTrend);
    const performance = await getStrategyPerformance(userId, strategyId);
    const winRateScore = performance.winRate;

    // Combined score: 70% regime + 30% win rate
    const totalScore = (regimeScore * REGIME_WEIGHT) + (winRateScore * WINRATE_WEIGHT);

    scores.push({
      strategyId,
      totalScore,
      regimeScore,
      winRateScore,
      winRate: performance.winRate,
      totalTrades: performance.totalTrades,
    });
  }

  // Sort by total score descending
  scores.sort((a, b) => b.totalScore - a.totalScore);

  const selected = scores[0];
  const alternatives = scores.slice(1);

  // Log selection
  await logAutoModeSelection(userId, selected, regime.regime, alternatives);

  logger.info('Auto mode selected strategy', {
    userId,
    selected: selected.strategyId,
    score: selected.totalScore.toFixed(2),
    regime: regime.regime,
    regimeScore: selected.regimeScore.toFixed(2),
    winRateScore: selected.winRateScore.toFixed(2),
  });

  return {
    selectedStrategy: selected.strategyId,
    regime: regime.regime,
    totalScore: selected.totalScore,
    regimeScore: selected.regimeScore,
    winRateScore: selected.winRateScore,
    alternatives,
  };
}

/**
 * Log auto mode selection to database for analysis
 */
async function logAutoModeSelection(
  userId: string,
  selected: StrategyScore,
  regime: MarketRegime,
  alternatives: StrategyScore[]
): Promise<void> {
  try {
    const altData = Object.fromEntries(
      alternatives.map(a => [a.strategyId, a.totalScore])
    );

    await pool.query(
      `INSERT INTO auto_mode_selections
       (user_id, selected_strategy, regime, total_score, regime_score, winrate_score, alternatives)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        selected.strategyId,
        regime,
        selected.totalScore,
        selected.regimeScore,
        selected.winRateScore,
        JSON.stringify(altData),
      ]
    );
  } catch (error) {
    logger.error('Failed to log auto mode selection', { error });
  }
}

/**
 * Record a trade result for strategy performance tracking
 */
export async function recordTradeResult(
  userId: string,
  strategy: StrategyId,
  result: 'win' | 'loss' | 'breakeven',
  pnlPct: number,
  symbol: string,
  regime: MarketRegime
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auto_strategy_performance
       (user_id, strategy, trade_result, pnl_pct, symbol, regime)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, strategy, result, pnlPct, symbol, regime]
    );

    logger.debug('Recorded trade result for strategy', {
      userId,
      strategy,
      result,
      pnlPct,
      symbol,
    });
  } catch (error) {
    logger.error('Failed to record trade result', { userId, strategy, error });
  }
}

/**
 * Get auto mode selection history for a user
 */
export async function getAutoModeHistory(
  userId: string,
  limit: number = 50
): Promise<Array<{
  strategy: StrategyId;
  regime: MarketRegime;
  score: number;
  timestamp: Date;
}>> {
  try {
    const result = await pool.query(
      `SELECT selected_strategy, regime, total_score, created_at
       FROM auto_mode_selections
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => ({
      strategy: row.selected_strategy as StrategyId,
      regime: row.regime as MarketRegime,
      score: parseFloat(row.total_score),
      timestamp: new Date(row.created_at),
    }));
  } catch {
    return [];
  }
}

export default {
  selectBestStrategy,
  getStrategyPerformance,
  getAllStrategyPerformances,
  recordTradeResult,
  getAutoModeHistory,
};
