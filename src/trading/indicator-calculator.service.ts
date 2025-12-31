/**
 * Indicator Calculator Service
 *
 * Background job that pre-calculates technical indicators for all
 * symbols and timeframes, storing results in Redis for fast access.
 *
 * Runs every minute and calculates:
 * - RSI (14 period)
 * - MACD (12, 26, 9)
 * - Bollinger Bands (20 period, 2 std dev)
 * - EMAs (9, 21, 50, 200)
 * - ATR (14 period)
 * - Stochastic (14, 3, 3)
 * - Volume metrics
 */

import logger from '../utils/logger.js';
import * as redisTradingService from './redis-trading.service.js';
import * as binanceWebSocket from './binance.websocket.js';
import {
  calculateRSI,
  calculateMACD,
  calculateBollinger,
  calculateEMA,
  calculateATR,
  calculateADX,
  calculateSMA,
} from './indicators.service.js';
import { TOP_50_PAIRS, TIMEFRAMES, Timeframe, Indicators, OHLCV } from './redis-trading.service.js';

// Concurrency limit for parallel calculations
const CALCULATION_CONCURRENCY = 10;

// Track calculation state
let isRunning = false;
let lastRunTime = 0;
let calculationStats = {
  totalCalculations: 0,
  successfulCalculations: 0,
  failedCalculations: 0,
  averageDurationMs: 0,
};

/**
 * Calculate Stochastic Oscillator
 * %K = 100 * (Close - Lowest Low) / (Highest High - Lowest Low)
 * %D = 3-period SMA of %K
 */
function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: number; d: number } {
  if (closes.length < kPeriod) {
    return { k: 50, d: 50 };
  }

  const kValues: number[] = [];

  for (let i = kPeriod - 1; i < closes.length; i++) {
    const periodHighs = highs.slice(i - kPeriod + 1, i + 1);
    const periodLows = lows.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...periodHighs);
    const lowestLow = Math.min(...periodLows);

    const k = highestHigh !== lowestLow
      ? 100 * (closes[i] - lowestLow) / (highestHigh - lowestLow)
      : 50;

    kValues.push(k);
  }

  // Current %K
  const k = kValues[kValues.length - 1] || 50;

  // %D is SMA of %K
  const d = kValues.length >= dPeriod
    ? calculateSMA(kValues.slice(-dPeriod), dPeriod)
    : k;

  return { k, d };
}

/**
 * Calculate indicators for a single symbol and timeframe
 */
async function calculateIndicatorsForSymbol(
  symbol: string,
  timeframe: Timeframe
): Promise<Indicators | null> {
  try {
    // Get candles from Redis
    const candles = await redisTradingService.getCandles(symbol, timeframe, 200);

    if (candles.length < 30) {
      // Not enough data for meaningful indicators
      return null;
    }

    // Extract price arrays
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // Calculate RSI
    const rsi = calculateRSI(closes, 14);

    // Calculate MACD
    const macd = calculateMACD(closes, 12, 26, 9);

    // Calculate Bollinger Bands
    const bollinger = calculateBollinger(closes, 20, 2);

    // Calculate EMAs
    const ema_9 = calculateEMA(closes, 9);
    const ema_20 = calculateEMA(closes, 20);
    const ema_21 = calculateEMA(closes, 21);
    const ema_50 = calculateEMA(closes, 50);
    const ema_200 = closes.length >= 200 ? calculateEMA(closes, 200) : undefined;

    // Prepare klines for ATR and ADX
    const klinesForATR = candles.map(c => ({
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Calculate ATR
    const atrResult = calculateATR(klinesForATR, 14);

    // Calculate ADX (trend strength)
    const adxResult = calculateADX(klinesForATR, 14);

    // Calculate Stochastic
    const stoch = calculateStochastic(highs, lows, closes, 14, 3);

    // Calculate Volume metrics
    const volumeSMA = calculateSMA(volumes.slice(0, -1), 20);
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = volumeSMA > 0 ? currentVolume / volumeSMA : 1;

    // Build indicators object
    const indicators: Indicators = {
      symbol,
      timeframe,
      timestamp: Date.now(),
      // RSI
      rsi,
      // MACD
      macd_line: macd.macd,
      macd_signal: macd.signal,
      macd_histogram: macd.histogram,
      // Bollinger
      bollinger_upper: bollinger.upper,
      bollinger_middle: bollinger.middle,
      bollinger_lower: bollinger.lower,
      // EMAs
      ema_9,
      ema_20,
      ema_21,
      ema_50,
      ema_200,
      // ATR
      atr: atrResult.atr,
      // ADX
      adx: adxResult.adx,
      plus_di: adxResult.plusDI,
      minus_di: adxResult.minusDI,
      // Stochastic
      stoch_k: stoch.k,
      stoch_d: stoch.d,
      // Volume
      volume_sma: volumeSMA,
      volume_ratio: volumeRatio,
    };

    return indicators;
  } catch (error) {
    logger.error('Failed to calculate indicators', {
      symbol,
      timeframe,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Process a batch of symbol/timeframe pairs in parallel
 */
async function processBatch(
  pairs: Array<{ symbol: string; timeframe: Timeframe }>
): Promise<{ calculated: number; failed: number }> {
  let calculated = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    pairs.map(async ({ symbol, timeframe }) => {
      const indicators = await calculateIndicatorsForSymbol(symbol, timeframe);
      if (indicators) {
        await redisTradingService.setIndicators(indicators);
        return true;
      }
      return false;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      calculated++;
    } else {
      failed++;
    }
  }

  return { calculated, failed };
}

/**
 * Run indicator calculations for all symbols and timeframes
 * Uses parallel processing with batching for better performance
 */
export async function runIndicatorCalculations(): Promise<{
  calculated: number;
  failed: number;
  duration: number;
}> {
  if (isRunning) {
    logger.warn('Indicator calculation already running, skipping');
    return { calculated: 0, failed: 0, duration: 0 };
  }

  isRunning = true;
  const startTime = Date.now();
  let calculated = 0;
  let failed = 0;

  try {
    logger.info('Starting indicator calculations', {
      symbols: TOP_50_PAIRS.length,
      timeframes: TIMEFRAMES.length,
    });

    // Build list of all symbol/timeframe pairs
    const allPairs: Array<{ symbol: string; timeframe: Timeframe }> = [];
    for (const symbol of TOP_50_PAIRS) {
      for (const timeframe of TIMEFRAMES) {
        allPairs.push({ symbol, timeframe });
      }
    }

    // Process in batches of CALCULATION_CONCURRENCY
    for (let i = 0; i < allPairs.length; i += CALCULATION_CONCURRENCY) {
      const batch = allPairs.slice(i, i + CALCULATION_CONCURRENCY);
      const result = await processBatch(batch);
      calculated += result.calculated;
      failed += result.failed;
    }

    const duration = Date.now() - startTime;
    lastRunTime = Date.now();

    // Update stats
    calculationStats.totalCalculations++;
    calculationStats.successfulCalculations += calculated;
    calculationStats.failedCalculations += failed;
    calculationStats.averageDurationMs =
      (calculationStats.averageDurationMs * (calculationStats.totalCalculations - 1) + duration) /
      calculationStats.totalCalculations;

    logger.info('Indicator calculations complete', {
      calculated,
      failed,
      duration: `${duration}ms`,
    });

    return { calculated, failed, duration };
  } catch (error) {
    logger.error('Indicator calculation job failed', {
      error: (error as Error).message,
    });
    return { calculated, failed, duration: Date.now() - startTime };
  } finally {
    isRunning = false;
  }
}

/**
 * Run indicator calculations for a subset of symbols (for faster updates)
 */
export async function runQuickIndicatorCalculations(
  symbols: string[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  timeframes: Timeframe[] = ['1m', '5m']
): Promise<void> {
  const startTime = Date.now();

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const indicators = await calculateIndicatorsForSymbol(symbol, timeframe);
      if (indicators) {
        await redisTradingService.setIndicators(indicators);
      }
    }
  }

  logger.debug('Quick indicator calculations complete', {
    symbols: symbols.length,
    timeframes: timeframes.length,
    duration: `${Date.now() - startTime}ms`,
  });
}

/**
 * Get calculation statistics
 */
export function getCalculationStats(): {
  lastRunTime: number;
  isRunning: boolean;
  totalCalculations: number;
  successfulCalculations: number;
  failedCalculations: number;
  averageDurationMs: number;
} {
  return {
    lastRunTime,
    isRunning,
    ...calculationStats,
  };
}

/**
 * Get indicators for a symbol across all timeframes (from Redis)
 */
export async function getIndicatorsForSymbol(symbol: string): Promise<Record<Timeframe, Indicators | null>> {
  const result: Record<string, Indicators | null> = {};

  for (const timeframe of TIMEFRAMES) {
    result[timeframe] = await redisTradingService.getIndicators(symbol, timeframe);
  }

  return result as Record<Timeframe, Indicators | null>;
}

/**
 * Get BTC market bias for correlation filtering
 * Returns the overall BTC trend direction
 */
async function getBtcMarketBias(): Promise<{
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number;
}> {
  try {
    const btcIndicators = await redisTradingService.getIndicators('BTCUSDT', '1h');

    if (!btcIndicators) {
      return { trend: 'neutral', strength: 0 };
    }

    let bullishScore = 0;
    let bearishScore = 0;

    // EMA alignment for trend
    if (btcIndicators.ema_9 && btcIndicators.ema_21 && btcIndicators.ema_50) {
      if (btcIndicators.ema_9 > btcIndicators.ema_21 && btcIndicators.ema_21 > btcIndicators.ema_50) {
        bullishScore += 2;
      } else if (btcIndicators.ema_9 < btcIndicators.ema_21 && btcIndicators.ema_21 < btcIndicators.ema_50) {
        bearishScore += 2;
      }
    }

    // RSI momentum
    if (btcIndicators.rsi !== undefined) {
      if (btcIndicators.rsi > 55) bullishScore += 1;
      else if (btcIndicators.rsi < 45) bearishScore += 1;
    }

    // MACD direction
    if (btcIndicators.macd_histogram !== undefined) {
      if (btcIndicators.macd_histogram > 0) bullishScore += 1;
      else if (btcIndicators.macd_histogram < 0) bearishScore += 1;
    }

    const totalScore = bullishScore + bearishScore;
    const strength = totalScore > 0 ? Math.abs(bullishScore - bearishScore) / totalScore : 0;

    if (bullishScore > bearishScore && bullishScore >= 2) {
      return { trend: 'bullish', strength };
    } else if (bearishScore > bullishScore && bearishScore >= 2) {
      return { trend: 'bearish', strength };
    }

    return { trend: 'neutral', strength: 0 };
  } catch {
    return { trend: 'neutral', strength: 0 };
  }
}

/**
 * Multi-timeframe confirmation
 * Checks higher timeframes to confirm signal direction
 */
async function getMultiTimeframeConfirmation(
  symbol: string,
  baseTimeframe: Timeframe,
  direction: 'buy' | 'sell'
): Promise<{ confirmed: boolean; weight: number; reasons: string[] }> {
  const reasons: string[] = [];
  let confirmations = 0;
  let contradictions = 0;

  // Map to higher timeframes
  const timeframeHierarchy: Record<Timeframe, Timeframe[]> = {
    '1m': ['5m', '15m'],
    '5m': ['15m', '1h'],
    '15m': ['1h', '4h'],
    '1h': ['4h', '1d'],
    '4h': ['1d'],
    '1d': [],
  };

  const higherTimeframes = timeframeHierarchy[baseTimeframe] || [];

  for (const tf of higherTimeframes) {
    const htfIndicators = await redisTradingService.getIndicators(symbol, tf);
    if (!htfIndicators) continue;

    // Check EMA alignment
    if (htfIndicators.ema_9 && htfIndicators.ema_21 && htfIndicators.ema_50) {
      const bullishEma = htfIndicators.ema_9 > htfIndicators.ema_21 && htfIndicators.ema_21 > htfIndicators.ema_50;
      const bearishEma = htfIndicators.ema_9 < htfIndicators.ema_21 && htfIndicators.ema_21 < htfIndicators.ema_50;

      if (direction === 'buy' && bullishEma) {
        confirmations++;
        reasons.push(`${tf} EMA bullish`);
      } else if (direction === 'sell' && bearishEma) {
        confirmations++;
        reasons.push(`${tf} EMA bearish`);
      } else if (direction === 'buy' && bearishEma) {
        contradictions++;
      } else if (direction === 'sell' && bullishEma) {
        contradictions++;
      }
    }

    // Check RSI trend
    if (htfIndicators.rsi !== undefined) {
      if (direction === 'buy' && htfIndicators.rsi < 50) {
        confirmations++;
        reasons.push(`${tf} RSI ${htfIndicators.rsi.toFixed(0)} (room to grow)`);
      } else if (direction === 'sell' && htfIndicators.rsi > 50) {
        confirmations++;
        reasons.push(`${tf} RSI ${htfIndicators.rsi.toFixed(0)} (room to fall)`);
      }
    }
  }

  const totalChecks = confirmations + contradictions;
  const weight = totalChecks > 0 ? confirmations / totalChecks : 0.5;

  return {
    confirmed: confirmations > contradictions,
    weight,
    reasons,
  };
}

/**
 * Get signals based on indicator analysis
 * Enhanced with BTC correlation and multi-timeframe confirmation
 */
export async function analyzeSignals(
  symbol: string,
  timeframe: Timeframe = '5m'
): Promise<{
  signal: 'buy' | 'sell' | 'neutral';
  strength: 'strong' | 'medium' | 'weak';
  reasons: string[];
  confidence: number;
  btcBias?: 'bullish' | 'bearish' | 'neutral';
  multiTfConfirmed?: boolean;
}> {
  const indicators = await redisTradingService.getIndicators(symbol, timeframe);

  if (!indicators) {
    return {
      signal: 'neutral',
      strength: 'weak',
      reasons: ['Insufficient data'],
      confidence: 0,
    };
  }

  const reasons: string[] = [];
  let buyScore = 0;
  let sellScore = 0;

  // RSI analysis
  if (indicators.rsi !== undefined) {
    if (indicators.rsi < 30) {
      reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`);
      buyScore += 2;
    } else if (indicators.rsi < 40) {
      reasons.push(`RSI approaching oversold (${indicators.rsi.toFixed(1)})`);
      buyScore += 1;
    } else if (indicators.rsi > 70) {
      reasons.push(`RSI overbought (${indicators.rsi.toFixed(1)})`);
      sellScore += 2;
    } else if (indicators.rsi > 60) {
      reasons.push(`RSI approaching overbought (${indicators.rsi.toFixed(1)})`);
      sellScore += 1;
    }
  }

  // MACD analysis
  if (indicators.macd_histogram !== undefined) {
    if (indicators.macd_histogram > 0 && indicators.macd_line !== undefined && indicators.macd_line > 0) {
      reasons.push('MACD bullish');
      buyScore += 1;
    } else if (indicators.macd_histogram < 0 && indicators.macd_line !== undefined && indicators.macd_line < 0) {
      reasons.push('MACD bearish');
      sellScore += 1;
    }
  }

  // Bollinger analysis
  if (indicators.bollinger_lower !== undefined && indicators.bollinger_upper !== undefined) {
    const price = await redisTradingService.getPrice(symbol);
    if (price) {
      const percentB = (price.price - indicators.bollinger_lower) /
        (indicators.bollinger_upper - indicators.bollinger_lower);

      if (percentB < 0.05) {
        reasons.push('Price at lower Bollinger Band');
        buyScore += 2;
      } else if (percentB < 0.2) {
        reasons.push('Price near lower Bollinger Band');
        buyScore += 1;
      } else if (percentB > 0.95) {
        reasons.push('Price at upper Bollinger Band');
        sellScore += 2;
      } else if (percentB > 0.8) {
        reasons.push('Price near upper Bollinger Band');
        sellScore += 1;
      }
    }
  }

  // EMA alignment
  if (indicators.ema_9 !== undefined && indicators.ema_21 !== undefined && indicators.ema_50 !== undefined) {
    if (indicators.ema_9 > indicators.ema_21 && indicators.ema_21 > indicators.ema_50) {
      reasons.push('Bullish EMA alignment');
      buyScore += 1;
    } else if (indicators.ema_9 < indicators.ema_21 && indicators.ema_21 < indicators.ema_50) {
      reasons.push('Bearish EMA alignment');
      sellScore += 1;
    }
  }

  // Stochastic analysis
  if (indicators.stoch_k !== undefined && indicators.stoch_d !== undefined) {
    if (indicators.stoch_k < 20 && indicators.stoch_d < 20) {
      reasons.push('Stochastic oversold');
      buyScore += 1;
    } else if (indicators.stoch_k > 80 && indicators.stoch_d > 80) {
      reasons.push('Stochastic overbought');
      sellScore += 1;
    }
  }

  // Volume analysis
  if (indicators.volume_ratio !== undefined && indicators.volume_ratio > 1.5) {
    reasons.push(`High volume (${indicators.volume_ratio.toFixed(1)}x avg)`);
    // Volume amplifies the current trend
    if (buyScore > sellScore) buyScore += 1;
    if (sellScore > buyScore) sellScore += 1;
  }

  // Determine preliminary signal
  let signal: 'buy' | 'sell' | 'neutral' = 'neutral';
  let strength: 'strong' | 'medium' | 'weak' = 'weak';

  if (buyScore > sellScore && buyScore >= 3) {
    signal = 'buy';
    strength = buyScore >= 5 ? 'strong' : buyScore >= 4 ? 'medium' : 'weak';
  } else if (sellScore > buyScore && sellScore >= 3) {
    signal = 'sell';
    strength = sellScore >= 5 ? 'strong' : sellScore >= 4 ? 'medium' : 'weak';
  }

  // If no signal, return early
  if (signal === 'neutral') {
    return {
      signal,
      strength,
      reasons,
      confidence: 0,
    };
  }

  // Get BTC market bias for altcoins (not for BTC itself)
  let btcBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (symbol !== 'BTCUSDT') {
    const btcMarket = await getBtcMarketBias();
    btcBias = btcMarket.trend;

    // Apply BTC correlation penalty/boost
    if (btcBias !== 'neutral') {
      if ((signal === 'buy' && btcBias === 'bullish') || (signal === 'sell' && btcBias === 'bearish')) {
        buyScore += signal === 'buy' ? 1 : 0;
        sellScore += signal === 'sell' ? 1 : 0;
        reasons.push(`BTC ${btcBias} (aligned)`);
      } else if ((signal === 'buy' && btcBias === 'bearish') || (signal === 'sell' && btcBias === 'bullish')) {
        // Penalize signals that go against BTC trend
        if (signal === 'buy') buyScore -= 1;
        if (signal === 'sell') sellScore -= 1;
        reasons.push(`BTC ${btcBias} (counter-trend risk)`);
      }
    }
  }

  // Get multi-timeframe confirmation
  const mtfConfirmation = await getMultiTimeframeConfirmation(symbol, timeframe, signal);
  const multiTfConfirmed = mtfConfirmation.confirmed;

  if (multiTfConfirmed) {
    // Boost score for confirmation
    if (signal === 'buy') buyScore += 1;
    if (signal === 'sell') sellScore += 1;
    reasons.push(...mtfConfirmation.reasons.slice(0, 2)); // Add top 2 HTF reasons
  }

  // Recalculate signal and strength after adjustments
  if (buyScore > sellScore && buyScore >= 3) {
    signal = 'buy';
    strength = buyScore >= 6 ? 'strong' : buyScore >= 4 ? 'medium' : 'weak';
  } else if (sellScore > buyScore && sellScore >= 3) {
    signal = 'sell';
    strength = sellScore >= 6 ? 'strong' : sellScore >= 4 ? 'medium' : 'weak';
  } else {
    signal = 'neutral';
    strength = 'weak';
  }

  // Calculate weighted confidence
  const totalScore = buyScore + sellScore;
  let confidence = totalScore > 0 ? Math.abs(buyScore - sellScore) / totalScore : 0;

  // Apply multi-TF weight to confidence
  confidence = confidence * (0.7 + 0.3 * mtfConfirmation.weight);

  return {
    signal,
    strength,
    reasons,
    confidence: Math.min(confidence, 1),
    btcBias,
    multiTfConfirmed,
  };
}

// Track pending candle close calculations to avoid duplicates
const pendingCalculations = new Set<string>();

/**
 * Handle candle close event - trigger indicator calculation for the symbol/timeframe
 * This provides real-time indicator updates instead of waiting for the periodic job
 */
async function handleCandleClose(
  symbol: string,
  timeframe: Timeframe,
  _candle: OHLCV,
  isFinal: boolean
): Promise<void> {
  // Only process when candle is closed (final)
  if (!isFinal) return;

  // Skip if not in our tracked pairs
  if (!TOP_50_PAIRS.includes(symbol)) return;

  // Avoid duplicate calculations for same symbol/timeframe
  const key = `${symbol}:${timeframe}`;
  if (pendingCalculations.has(key)) return;

  pendingCalculations.add(key);

  try {
    const indicators = await calculateIndicatorsForSymbol(symbol, timeframe);
    if (indicators) {
      await redisTradingService.setIndicators(indicators);
      logger.debug('Calculated indicators on candle close', { symbol, timeframe });
    }
  } catch (error) {
    logger.error('Failed to calculate indicators on candle close', {
      symbol,
      timeframe,
      error: (error as Error).message,
    });
  } finally {
    pendingCalculations.delete(key);
  }
}

// Flag to track if event-driven calculations are enabled
let eventDrivenEnabled = false;

/**
 * Initialize event-driven indicator calculations
 * Registers a callback to calculate indicators when candles close
 */
export function initEventDrivenCalculations(): void {
  if (eventDrivenEnabled) {
    logger.warn('Event-driven indicator calculations already initialized');
    return;
  }

  binanceWebSocket.onKlineUpdate(handleCandleClose);
  eventDrivenEnabled = true;
  logger.info('Event-driven indicator calculations enabled');
}

export default {
  runIndicatorCalculations,
  runQuickIndicatorCalculations,
  getCalculationStats,
  getIndicatorsForSymbol,
  analyzeSignals,
  initEventDrivenCalculations,
};
