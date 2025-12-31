/**
 * Regime Detector Service
 *
 * Detects the current market regime (trending, ranging, mixed)
 * based on BTC's ADX value. Updates market_regime table for caching.
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as redisTradingService from './redis-trading.service.js';
import { MarketRegime, detectRegimeFromADX } from './strategies/index.js';

/**
 * Market regime data with additional context
 */
export interface MarketRegimeData {
  regime: MarketRegime;
  adx: number;
  btcTrend: 'bullish' | 'bearish' | 'neutral';
  btcMomentum: number; // -1 to 1 scale
  updatedAt: Date;
}

/**
 * Get BTC indicators from Redis
 */
async function getBtcIndicators() {
  // Try 1h timeframe first, fall back to 4h
  const indicators = await redisTradingService.getIndicators('BTCUSDT', '1h');
  if (indicators && indicators.adx !== undefined) {
    return indicators;
  }
  return redisTradingService.getIndicators('BTCUSDT', '4h');
}

/**
 * Calculate BTC trend from EMA alignment
 */
function calculateBtcTrend(indicators: redisTradingService.Indicators): 'bullish' | 'bearish' | 'neutral' {
  const ema9 = indicators.ema_9;
  const ema21 = indicators.ema_21;
  const ema50 = indicators.ema_50;

  if (ema9 === undefined || ema21 === undefined || ema50 === undefined) {
    return 'neutral';
  }

  // Bullish: EMA9 > EMA21 > EMA50
  if (ema9 > ema21 && ema21 > ema50) {
    return 'bullish';
  }

  // Bearish: EMA9 < EMA21 < EMA50
  if (ema9 < ema21 && ema21 < ema50) {
    return 'bearish';
  }

  return 'neutral';
}

/**
 * Calculate BTC momentum score (-1 to 1)
 * Combines RSI position, MACD direction, and price position
 */
function calculateBtcMomentum(indicators: redisTradingService.Indicators): number {
  let score = 0;
  let factors = 0;

  // RSI contribution (0-100 mapped to -1 to 1)
  if (indicators.rsi !== undefined) {
    score += (indicators.rsi - 50) / 50; // 0=-1, 50=0, 100=1
    factors++;
  }

  // MACD histogram contribution
  if (indicators.macd_histogram !== undefined) {
    // Normalize based on typical histogram values
    const normalizedMacd = Math.max(-1, Math.min(1, indicators.macd_histogram * 100));
    score += normalizedMacd;
    factors++;
  }

  // Stochastic contribution
  if (indicators.stoch_k !== undefined) {
    score += (indicators.stoch_k - 50) / 50;
    factors++;
  }

  return factors > 0 ? score / factors : 0;
}

/**
 * Detect current market regime
 */
export async function detectMarketRegime(): Promise<MarketRegimeData> {
  const btcIndicators = await getBtcIndicators();

  if (!btcIndicators || btcIndicators.adx === undefined) {
    logger.warn('BTC indicators not available for regime detection');
    return {
      regime: 'mixed',
      adx: 22,
      btcTrend: 'neutral',
      btcMomentum: 0,
      updatedAt: new Date(),
    };
  }

  const adx = btcIndicators.adx;
  const regime = detectRegimeFromADX(adx);
  const btcTrend = calculateBtcTrend(btcIndicators);
  const btcMomentum = calculateBtcMomentum(btcIndicators);

  const data: MarketRegimeData = {
    regime,
    adx,
    btcTrend,
    btcMomentum,
    updatedAt: new Date(),
  };

  // Update database cache
  try {
    await pool.query(
      `INSERT INTO market_regime (symbol, regime, adx, btc_trend, btc_momentum, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (symbol) DO UPDATE SET
         regime = EXCLUDED.regime,
         adx = EXCLUDED.adx,
         btc_trend = EXCLUDED.btc_trend,
         btc_momentum = EXCLUDED.btc_momentum,
         updated_at = NOW()`,
      ['BTCUSDT', regime, adx, btcTrend, btcMomentum]
    );
  } catch (error) {
    logger.error('Failed to update market regime cache', { error });
  }

  logger.debug('Market regime detected', {
    regime,
    adx: adx.toFixed(1),
    btcTrend,
    btcMomentum: btcMomentum.toFixed(2),
  });

  return data;
}

/**
 * Get cached market regime from database
 */
export async function getCachedRegime(): Promise<MarketRegimeData | null> {
  try {
    const result = await pool.query(
      `SELECT regime, adx, btc_trend, btc_momentum, updated_at
       FROM market_regime
       WHERE symbol = 'BTCUSDT'`
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      regime: row.regime as MarketRegime,
      adx: parseFloat(row.adx),
      btcTrend: row.btc_trend,
      btcMomentum: parseFloat(row.btc_momentum),
      updatedAt: new Date(row.updated_at),
    };
  } catch (error) {
    logger.error('Failed to get cached regime', { error });
    return null;
  }
}

/**
 * Get regime history for analysis
 */
export async function getRegimeHistory(
  limit: number = 100
): Promise<Array<{ regime: MarketRegime; adx: number; timestamp: Date }>> {
  try {
    const result = await pool.query(
      `SELECT regime, adx, created_at as timestamp
       FROM auto_mode_selections
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      regime: row.regime as MarketRegime,
      adx: parseFloat(row.adx || 22),
      timestamp: new Date(row.timestamp),
    }));
  } catch {
    return [];
  }
}

export default {
  detectMarketRegime,
  getCachedRegime,
  getRegimeHistory,
};
