/**
 * BTC Influence Service
 *
 * Provides BTC-based filtering and position sizing for altcoin trades.
 *
 * Features:
 * 1. Trend Filter - Skip alt longs when BTC is bearish
 * 2. Momentum Boost - Adjust position size based on BTC momentum
 * 3. Correlation Skip - Skip highly correlated alts when BTC is weak
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as redisTradingService from './redis-trading.service.js';
import { detectMarketRegime, MarketRegimeData } from './regime-detector.service.js';

/**
 * BTC influence settings from user configuration
 */
export interface BtcInfluenceSettings {
  btcTrendFilter: boolean;
  btcMomentumBoost: boolean;
  btcCorrelationSkip: boolean;
}

/**
 * Result of BTC influence calculation
 */
export interface BtcInfluenceResult {
  shouldTrade: boolean;
  positionMultiplier: number; // 0.7 to 1.3
  skipReason?: string;
  adjustments: string[];
}

/**
 * BTC correlation data for a symbol
 */
export interface CorrelationData {
  symbol: string;
  correlation30d: number;
  updatedAt: Date;
}

/**
 * Get cached BTC correlation for a symbol
 */
export async function getBtcCorrelation(symbol: string): Promise<number | null> {
  try {
    const result = await pool.query(
      `SELECT correlation_30d FROM btc_correlation_cache
       WHERE symbol = $1
       AND updated_at > NOW() - INTERVAL '24 hours'`,
      [symbol]
    );

    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].correlation_30d);
    }

    return null;
  } catch (error) {
    logger.error('Failed to get BTC correlation', { symbol, error });
    return null;
  }
}

/**
 * Update BTC correlation cache for a symbol
 * In production, this would calculate actual price correlation
 * For now, we estimate based on asset type
 */
export async function updateBtcCorrelation(symbol: string): Promise<number> {
  // Default correlations based on asset type (estimated)
  // In a full implementation, this would calculate actual 30-day price correlation
  let estimatedCorrelation = 0.6; // Default moderate correlation

  // ETH has high correlation with BTC
  if (symbol.includes('ETH')) {
    estimatedCorrelation = 0.85;
  }
  // Major alts tend to have high correlation
  else if (['SOL', 'XRP', 'ADA', 'DOT', 'AVAX', 'LINK', 'MATIC'].some(c => symbol.includes(c))) {
    estimatedCorrelation = 0.75;
  }
  // Meme coins can have lower correlation
  else if (['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK'].some(c => symbol.includes(c))) {
    estimatedCorrelation = 0.5;
  }

  try {
    await pool.query(
      `INSERT INTO btc_correlation_cache (symbol, correlation_30d, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (symbol) DO UPDATE SET
         correlation_30d = EXCLUDED.correlation_30d,
         updated_at = NOW()`,
      [symbol, estimatedCorrelation]
    );
  } catch (error) {
    logger.error('Failed to update BTC correlation', { symbol, error });
  }

  return estimatedCorrelation;
}

/**
 * Calculate BTC influence on an altcoin trade
 */
export async function calculateBtcInfluence(
  symbol: string,
  settings: BtcInfluenceSettings
): Promise<BtcInfluenceResult> {
  // Skip for BTC itself
  if (symbol === 'BTCUSDT' || symbol === 'BTC_USD') {
    return {
      shouldTrade: true,
      positionMultiplier: 1,
      adjustments: ['BTC - no influence applied'],
    };
  }

  const adjustments: string[] = [];
  let shouldTrade = true;
  let positionMultiplier = 1;
  let skipReason: string | undefined;

  // Get market regime data
  const regimeData: MarketRegimeData = await detectMarketRegime();

  // 1. Trend Filter
  if (settings.btcTrendFilter) {
    if (regimeData.btcTrend === 'bearish') {
      shouldTrade = false;
      skipReason = 'BTC trend bearish - skipping alt long';
      adjustments.push('Trend filter: BLOCKED (BTC bearish)');
    } else if (regimeData.btcTrend === 'bullish') {
      adjustments.push('Trend filter: PASSED (BTC bullish)');
    } else {
      adjustments.push('Trend filter: PASSED (BTC neutral)');
    }
  }

  // 2. Momentum Boost (position sizing)
  if (settings.btcMomentumBoost && shouldTrade) {
    const momentum = regimeData.btcMomentum;

    if (momentum > 0.5) {
      // Strong bullish momentum - increase position
      positionMultiplier = 1.3;
      adjustments.push(`Momentum boost: +30% (BTC momentum: ${momentum.toFixed(2)})`);
    } else if (momentum < -0.3) {
      // Bearish momentum - reduce position
      positionMultiplier = 0.7;
      adjustments.push(`Momentum reduction: -30% (BTC momentum: ${momentum.toFixed(2)})`);
    } else {
      adjustments.push(`Momentum: neutral (${momentum.toFixed(2)})`);
    }
  }

  // 3. Correlation Skip
  if (settings.btcCorrelationSkip && shouldTrade) {
    let correlation = await getBtcCorrelation(symbol);

    if (correlation === null) {
      correlation = await updateBtcCorrelation(symbol);
    }

    // Skip highly correlated alts when BTC is weak
    if (correlation > 0.7 && regimeData.btcTrend !== 'bullish') {
      // High correlation + weak BTC = skip
      if (regimeData.btcMomentum < -0.2) {
        shouldTrade = false;
        skipReason = `High BTC correlation (${correlation.toFixed(2)}) + weak BTC momentum`;
        adjustments.push(`Correlation skip: BLOCKED (corr: ${correlation.toFixed(2)}, momentum: ${regimeData.btcMomentum.toFixed(2)})`);
      } else {
        adjustments.push(`Correlation warning: high (${correlation.toFixed(2)}) but BTC not weak`);
      }
    } else if (correlation < 0.4) {
      adjustments.push(`Low correlation: ${correlation.toFixed(2)} (independent of BTC)`);
    } else {
      adjustments.push(`Correlation: ${correlation.toFixed(2)} (moderate)`);
    }
  }

  return {
    shouldTrade,
    positionMultiplier,
    skipReason,
    adjustments,
  };
}

/**
 * Get BTC indicators for strategy use
 */
export async function getBtcIndicators(): Promise<redisTradingService.Indicators | null> {
  return redisTradingService.getIndicators('BTCUSDT', '1h');
}

/**
 * Get BTC current price
 */
export async function getBtcPrice(): Promise<number | null> {
  const priceData = await redisTradingService.getPrice('BTCUSDT');
  return priceData?.price || null;
}

export default {
  calculateBtcInfluence,
  getBtcCorrelation,
  updateBtcCorrelation,
  getBtcIndicators,
  getBtcPrice,
};
