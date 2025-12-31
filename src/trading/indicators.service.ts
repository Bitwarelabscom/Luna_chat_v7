/**
 * Technical Indicators Service
 * Provides MACD, Bollinger Bands, EMA Crossovers, and Volume Analysis
 */

import { pool } from '../db/index.js';

// ============================================================================
// Types
// ============================================================================

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  crossover: 'bullish_cross' | 'bearish_cross' | null;
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
  squeeze: boolean;
}

export interface EMACrossResult {
  ema9: number;
  ema21: number;
  ema50: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  crossover: 'golden_cross' | 'death_cross' | null;
  distance9_21: number;
}

export interface VolumeResult {
  currentVolume: number;
  avgVolume: number;
  volumeRatio: number;
  volumeSpike: boolean;
  volumeTrend: 'increasing' | 'decreasing' | 'stable';
  priceVolumeConfirm: boolean;
}

export interface IndicatorWeights {
  rsi: number;
  macd: number;
  bollinger: number;
  ema: number;
  volume: number;
  priceAction: number;
}

export interface IndicatorSettingsUpdate {
  preset?: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  enableRsi?: boolean;
  enableMacd?: boolean;
  enableBollinger?: boolean;
  enableEma?: boolean;
  enableVolume?: boolean;
  enablePriceAction?: boolean;
  weights?: Partial<IndicatorWeights>;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  bollingerPeriod?: number;
  bollingerStddev?: number;
  emaShort?: number;
  emaMedium?: number;
  emaLong?: number;
  volumeAvgPeriod?: number;
  volumeSpikeThreshold?: number;
  minConfidence?: number;
}

export interface IndicatorSettings {
  userId: string;
  preset: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  enableRsi: boolean;
  enableMacd: boolean;
  enableBollinger: boolean;
  enableEma: boolean;
  enableVolume: boolean;
  enablePriceAction: boolean;
  weights: IndicatorWeights;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStddev: number;
  emaShort: number;
  emaMedium: number;
  emaLong: number;
  volumeAvgPeriod: number;
  volumeSpikeThreshold: number;
  minConfidence: number;
}

export interface FullIndicatorAnalysis {
  rsi: { value1m: number; value5m: number; value15m: number };
  macd: MACDResult;
  bollinger: BollingerResult;
  ema: EMACrossResult;
  volume: VolumeResult;
}

export interface ConfidenceBreakdown {
  rsi: number;
  macd: number;
  bollinger: number;
  ema: number;
  volume: number;
  priceAction: number;
  total: number;
}

// ============================================================================
// Presets
// ============================================================================

export const INDICATOR_PRESETS: Record<string, { weights: IndicatorWeights; minConfidence: number }> = {
  conservative: {
    weights: { rsi: 0.35, macd: 0.25, bollinger: 0.15, ema: 0.10, volume: 0.10, priceAction: 0.05 },
    minConfidence: 0.75,
  },
  balanced: {
    weights: { rsi: 0.25, macd: 0.20, bollinger: 0.20, ema: 0.15, volume: 0.10, priceAction: 0.10 },
    minConfidence: 0.60,
  },
  aggressive: {
    weights: { rsi: 0.20, macd: 0.15, bollinger: 0.25, ema: 0.15, volume: 0.15, priceAction: 0.10 },
    minConfidence: 0.45,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] || 0;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(values: number[], period: number): number {
  if (values.length < period) return calculateSMA(values, values.length);

  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(values.slice(0, period), period);

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate EMA series (returns array of EMA values)
 */
function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const multiplier = 2 / (period + 1);
  const emas: number[] = [];

  // First EMA is the SMA
  let ema = calculateSMA(values.slice(0, period), period);
  emas.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    emas.push(ema);
  }

  return emas;
}

/**
 * Calculate Standard Deviation
 */
function calculateStdDev(values: number[], period: number): number {
  if (values.length < period) return 0;

  const slice = values.slice(-period);
  const mean = slice.reduce((sum, v) => sum + v, 0) / period;
  const squaredDiffs = slice.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / period;

  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate RSI
 */
export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth the average for remaining periods
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============================================================================
// Indicator Calculations
// ============================================================================

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  if (closes.length < slowPeriod + signalPeriod) {
    return {
      macd: 0,
      signal: 0,
      histogram: 0,
      trend: 'neutral',
      crossover: null,
    };
  }

  // Calculate fast and slow EMAs
  const fastEMAs = calculateEMASeries(closes, fastPeriod);
  const slowEMAs = calculateEMASeries(closes, slowPeriod);

  // MACD line = Fast EMA - Slow EMA
  // Align the arrays (slow EMA starts later)
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];

  for (let i = 0; i < slowEMAs.length; i++) {
    macdLine.push(fastEMAs[i + offset] - slowEMAs[i]);
  }

  // Signal line = 9-period EMA of MACD line
  const signalLine = calculateEMASeries(macdLine, signalPeriod);

  // Current values
  const macd = macdLine[macdLine.length - 1] || 0;
  const signal = signalLine[signalLine.length - 1] || 0;
  const histogram = macd - signal;

  // Previous values for crossover detection
  const prevMacd = macdLine[macdLine.length - 2] || macd;
  const prevSignal = signalLine[signalLine.length - 2] || signal;

  // Detect crossover
  let crossover: 'bullish_cross' | 'bearish_cross' | null = null;
  if (prevMacd <= prevSignal && macd > signal) {
    crossover = 'bullish_cross';
  } else if (prevMacd >= prevSignal && macd < signal) {
    crossover = 'bearish_cross';
  }

  // Determine trend
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (histogram > 0 && macd > 0) {
    trend = 'bullish';
  } else if (histogram < 0 && macd < 0) {
    trend = 'bearish';
  }

  return { macd, signal, histogram, trend, crossover };
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollinger(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerResult {
  if (closes.length < period) {
    const price = closes[closes.length - 1] || 0;
    return {
      upper: price,
      middle: price,
      lower: price,
      bandwidth: 0,
      percentB: 0.5,
      squeeze: false,
    };
  }

  const middle = calculateSMA(closes, period);
  const stdDev = calculateStdDev(closes, period);
  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;

  const currentPrice = closes[closes.length - 1];
  const bandwidth = middle > 0 ? (upper - lower) / middle : 0;
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

  // Squeeze detection - bandwidth below 10% of recent average
  const recentBandwidths: number[] = [];
  for (let i = Math.max(0, closes.length - 20); i < closes.length - 1; i++) {
    const slice = closes.slice(Math.max(0, i - period + 1), i + 1);
    if (slice.length >= period) {
      const m = calculateSMA(slice, period);
      const s = calculateStdDev(slice, period);
      const bw = m > 0 ? (2 * stdDevMultiplier * s) / m : 0;
      recentBandwidths.push(bw);
    }
  }

  const avgBandwidth = recentBandwidths.length > 0
    ? recentBandwidths.reduce((a, b) => a + b, 0) / recentBandwidths.length
    : bandwidth;

  const squeeze = bandwidth < avgBandwidth * 0.5;

  return { upper, middle, lower, bandwidth, percentB, squeeze };
}

/**
 * Calculate EMA Crossovers
 */
export function calculateEMACross(
  closes: number[],
  shortPeriod: number = 9,
  mediumPeriod: number = 21,
  longPeriod: number = 50
): EMACrossResult {
  const ema9 = calculateEMA(closes, shortPeriod);
  const ema21 = calculateEMA(closes, mediumPeriod);
  const ema50 = calculateEMA(closes, longPeriod);

  // Calculate previous EMAs for crossover detection
  const prevCloses = closes.slice(0, -1);
  const prevEma9 = prevCloses.length > 0 ? calculateEMA(prevCloses, shortPeriod) : ema9;
  const prevEma21 = prevCloses.length > 0 ? calculateEMA(prevCloses, mediumPeriod) : ema21;

  // Detect crossover
  let crossover: 'golden_cross' | 'death_cross' | null = null;
  if (prevEma9 <= prevEma21 && ema9 > ema21) {
    crossover = 'golden_cross';
  } else if (prevEma9 >= prevEma21 && ema9 < ema21) {
    crossover = 'death_cross';
  }

  // Determine trend based on EMA alignment
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (ema9 > ema21 && ema21 > ema50) {
    trend = 'bullish';
  } else if (ema9 < ema21 && ema21 < ema50) {
    trend = 'bearish';
  }

  // Calculate distance between short and medium EMAs
  const distance9_21 = ema21 > 0 ? ((ema9 - ema21) / ema21) * 100 : 0;

  return { ema9, ema21, ema50, trend, crossover, distance9_21 };
}

/**
 * Analyze Volume
 */
export function analyzeVolume(
  volumes: number[],
  closes: number[],
  avgPeriod: number = 20,
  spikeThreshold: number = 2.0
): VolumeResult {
  if (volumes.length < 2) {
    return {
      currentVolume: volumes[0] || 0,
      avgVolume: volumes[0] || 0,
      volumeRatio: 1,
      volumeSpike: false,
      volumeTrend: 'stable',
      priceVolumeConfirm: false,
    };
  }

  const currentVolume = volumes[volumes.length - 1];
  const avgVolume = calculateSMA(volumes.slice(0, -1), Math.min(avgPeriod, volumes.length - 1));
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
  const volumeSpike = volumeRatio >= spikeThreshold;

  // Volume trend - compare recent average to older average
  const recentAvg = calculateSMA(volumes.slice(-5), 5);
  const olderAvg = calculateSMA(volumes.slice(-10, -5), 5);

  let volumeTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentAvg > olderAvg * 1.2) {
    volumeTrend = 'increasing';
  } else if (recentAvg < olderAvg * 0.8) {
    volumeTrend = 'decreasing';
  }

  // Price-volume confirmation
  // High volume on price increase = bullish confirmation
  // High volume on price decrease after drop = potential reversal (bullish for our purposes)
  const priceChange = closes.length >= 2
    ? closes[closes.length - 1] - closes[closes.length - 2]
    : 0;

  const priceVolumeConfirm = volumeSpike && (
    priceChange > 0 || // High volume on price increase
    (priceChange < 0 && volumeTrend === 'increasing') // High volume at potential bottom
  );

  return {
    currentVolume,
    avgVolume,
    volumeRatio,
    volumeSpike,
    volumeTrend,
    priceVolumeConfirm,
  };
}

// ============================================================================
// Weighted Confidence Scoring
// ============================================================================

/**
 * Calculate weighted confidence score from all indicators
 */
export function calculateWeightedConfidence(
  analysis: FullIndicatorAnalysis,
  priceDropPct: number,
  nearSupport: boolean,
  weights: IndicatorWeights,
  enabled: { rsi: boolean; macd: boolean; bollinger: boolean; ema: boolean; volume: boolean; priceAction: boolean }
): ConfidenceBreakdown {
  const breakdown: ConfidenceBreakdown = {
    rsi: 0,
    macd: 0,
    bollinger: 0,
    ema: 0,
    volume: 0,
    priceAction: 0,
    total: 0,
  };

  // Calculate active weight total for normalization
  let activeWeightTotal = 0;
  if (enabled.rsi) activeWeightTotal += weights.rsi;
  if (enabled.macd) activeWeightTotal += weights.macd;
  if (enabled.bollinger) activeWeightTotal += weights.bollinger;
  if (enabled.ema) activeWeightTotal += weights.ema;
  if (enabled.volume) activeWeightTotal += weights.volume;
  if (enabled.priceAction) activeWeightTotal += weights.priceAction;

  if (activeWeightTotal === 0) activeWeightTotal = 1;

  // Normalize weights
  const normalizedWeights = {
    rsi: enabled.rsi ? weights.rsi / activeWeightTotal : 0,
    macd: enabled.macd ? weights.macd / activeWeightTotal : 0,
    bollinger: enabled.bollinger ? weights.bollinger / activeWeightTotal : 0,
    ema: enabled.ema ? weights.ema / activeWeightTotal : 0,
    volume: enabled.volume ? weights.volume / activeWeightTotal : 0,
    priceAction: enabled.priceAction ? weights.priceAction / activeWeightTotal : 0,
  };

  // RSI component (0-1 scale)
  if (enabled.rsi) {
    const rsi5m = analysis.rsi.value5m;
    if (rsi5m <= 30) {
      // Scale: RSI 30 = 0.5, RSI 20 = 1.0
      breakdown.rsi = normalizedWeights.rsi * Math.min(1, (30 - rsi5m) / 20 + 0.5);
    } else if (rsi5m <= 40) {
      breakdown.rsi = normalizedWeights.rsi * 0.3;
    }
  }

  // MACD component
  if (enabled.macd) {
    if (analysis.macd.crossover === 'bullish_cross') {
      breakdown.macd = normalizedWeights.macd * 1.0;
    } else if (analysis.macd.histogram > 0 && analysis.macd.trend === 'bullish') {
      breakdown.macd = normalizedWeights.macd * 0.7;
    } else if (analysis.macd.histogram > 0) {
      breakdown.macd = normalizedWeights.macd * 0.4;
    }
  }

  // Bollinger component
  if (enabled.bollinger) {
    if (analysis.bollinger.percentB < 0) {
      // Below lower band - strong oversold
      breakdown.bollinger = normalizedWeights.bollinger * 1.0;
    } else if (analysis.bollinger.percentB < 0.1) {
      breakdown.bollinger = normalizedWeights.bollinger * 0.8;
    } else if (analysis.bollinger.percentB < 0.2) {
      breakdown.bollinger = normalizedWeights.bollinger * 0.6;
    } else if (analysis.bollinger.squeeze) {
      // Squeeze with low percentB = potential breakout
      breakdown.bollinger = normalizedWeights.bollinger * 0.4;
    }
  }

  // EMA component
  if (enabled.ema) {
    if (analysis.ema.crossover === 'golden_cross') {
      breakdown.ema = normalizedWeights.ema * 1.0;
    } else if (analysis.ema.trend === 'bullish') {
      breakdown.ema = normalizedWeights.ema * 0.6;
    } else if (analysis.ema.distance9_21 > -1 && analysis.ema.distance9_21 < 0) {
      // Near crossover
      breakdown.ema = normalizedWeights.ema * 0.3;
    }
  }

  // Volume component
  if (enabled.volume) {
    if (analysis.volume.volumeSpike && analysis.volume.priceVolumeConfirm) {
      breakdown.volume = normalizedWeights.volume * 1.0;
    } else if (analysis.volume.volumeSpike) {
      breakdown.volume = normalizedWeights.volume * 0.6;
    } else if (analysis.volume.volumeRatio > 1.5) {
      breakdown.volume = normalizedWeights.volume * 0.4;
    }
  }

  // Price action component
  if (enabled.priceAction) {
    if (priceDropPct >= 5) {
      breakdown.priceAction = normalizedWeights.priceAction * 1.0;
    } else if (priceDropPct >= 3) {
      breakdown.priceAction = normalizedWeights.priceAction * 0.7;
    } else if (nearSupport) {
      breakdown.priceAction = normalizedWeights.priceAction * 0.5;
    } else if (priceDropPct >= 2) {
      breakdown.priceAction = normalizedWeights.priceAction * 0.3;
    }
  }

  // Calculate total
  breakdown.total = breakdown.rsi + breakdown.macd + breakdown.bollinger +
    breakdown.ema + breakdown.volume + breakdown.priceAction;

  return breakdown;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Get indicator settings for a user
 */
export async function getIndicatorSettings(userId: string): Promise<IndicatorSettings | null> {
  const result = await pool.query(
    `SELECT * FROM indicator_settings WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Create default settings
    return createDefaultIndicatorSettings(userId);
  }

  const row = result.rows[0];
  return mapRowToSettings(row);
}

/**
 * Create default indicator settings
 */
async function createDefaultIndicatorSettings(userId: string): Promise<IndicatorSettings> {
  const result = await pool.query(
    `INSERT INTO indicator_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = $1
     RETURNING *`,
    [userId]
  );

  return mapRowToSettings(result.rows[0]);
}

/**
 * Update indicator settings
 */
export async function updateIndicatorSettings(
  userId: string,
  updates: IndicatorSettingsUpdate
): Promise<IndicatorSettings> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.preset !== undefined) {
    setClauses.push(`preset = $${paramIndex++}`);
    values.push(updates.preset);
  }

  if (updates.enableRsi !== undefined) {
    setClauses.push(`enable_rsi = $${paramIndex++}`);
    values.push(updates.enableRsi);
  }

  if (updates.enableMacd !== undefined) {
    setClauses.push(`enable_macd = $${paramIndex++}`);
    values.push(updates.enableMacd);
  }

  if (updates.enableBollinger !== undefined) {
    setClauses.push(`enable_bollinger = $${paramIndex++}`);
    values.push(updates.enableBollinger);
  }

  if (updates.enableEma !== undefined) {
    setClauses.push(`enable_ema = $${paramIndex++}`);
    values.push(updates.enableEma);
  }

  if (updates.enableVolume !== undefined) {
    setClauses.push(`enable_volume = $${paramIndex++}`);
    values.push(updates.enableVolume);
  }

  if (updates.enablePriceAction !== undefined) {
    setClauses.push(`enable_price_action = $${paramIndex++}`);
    values.push(updates.enablePriceAction);
  }

  if (updates.weights) {
    if (updates.weights.rsi !== undefined) {
      setClauses.push(`weight_rsi = $${paramIndex++}`);
      values.push(updates.weights.rsi);
    }
    if (updates.weights.macd !== undefined) {
      setClauses.push(`weight_macd = $${paramIndex++}`);
      values.push(updates.weights.macd);
    }
    if (updates.weights.bollinger !== undefined) {
      setClauses.push(`weight_bollinger = $${paramIndex++}`);
      values.push(updates.weights.bollinger);
    }
    if (updates.weights.ema !== undefined) {
      setClauses.push(`weight_ema = $${paramIndex++}`);
      values.push(updates.weights.ema);
    }
    if (updates.weights.volume !== undefined) {
      setClauses.push(`weight_volume = $${paramIndex++}`);
      values.push(updates.weights.volume);
    }
    if (updates.weights.priceAction !== undefined) {
      setClauses.push(`weight_price_action = $${paramIndex++}`);
      values.push(updates.weights.priceAction);
    }
  }

  if (updates.minConfidence !== undefined) {
    setClauses.push(`min_confidence = $${paramIndex++}`);
    values.push(updates.minConfidence);
  }

  if (updates.macdFast !== undefined) {
    setClauses.push(`macd_fast = $${paramIndex++}`);
    values.push(updates.macdFast);
  }

  if (updates.macdSlow !== undefined) {
    setClauses.push(`macd_slow = $${paramIndex++}`);
    values.push(updates.macdSlow);
  }

  if (updates.macdSignal !== undefined) {
    setClauses.push(`macd_signal = $${paramIndex++}`);
    values.push(updates.macdSignal);
  }

  if (updates.bollingerPeriod !== undefined) {
    setClauses.push(`bollinger_period = $${paramIndex++}`);
    values.push(updates.bollingerPeriod);
  }

  if (updates.bollingerStddev !== undefined) {
    setClauses.push(`bollinger_stddev = $${paramIndex++}`);
    values.push(updates.bollingerStddev);
  }

  if (updates.emaShort !== undefined) {
    setClauses.push(`ema_short = $${paramIndex++}`);
    values.push(updates.emaShort);
  }

  if (updates.emaMedium !== undefined) {
    setClauses.push(`ema_medium = $${paramIndex++}`);
    values.push(updates.emaMedium);
  }

  if (updates.emaLong !== undefined) {
    setClauses.push(`ema_long = $${paramIndex++}`);
    values.push(updates.emaLong);
  }

  if (updates.volumeAvgPeriod !== undefined) {
    setClauses.push(`volume_avg_period = $${paramIndex++}`);
    values.push(updates.volumeAvgPeriod);
  }

  if (updates.volumeSpikeThreshold !== undefined) {
    setClauses.push(`volume_spike_threshold = $${paramIndex++}`);
    values.push(updates.volumeSpikeThreshold);
  }

  if (setClauses.length === 0) {
    const existing = await getIndicatorSettings(userId);
    if (!existing) throw new Error('Failed to get indicator settings');
    return existing;
  }

  values.push(userId);
  const result = await pool.query(
    `UPDATE indicator_settings
     SET ${setClauses.join(', ')}
     WHERE user_id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    // Settings don't exist yet, create them
    const created = await createDefaultIndicatorSettings(userId);
    if (Object.keys(updates).length > 0) {
      return updateIndicatorSettings(userId, updates);
    }
    return created;
  }

  return mapRowToSettings(result.rows[0]);
}

/**
 * Apply preset to indicator settings
 */
export async function applyIndicatorPreset(
  userId: string,
  preset: 'conservative' | 'balanced' | 'aggressive'
): Promise<IndicatorSettings> {
  const presetConfig = INDICATOR_PRESETS[preset];
  if (!presetConfig) {
    throw new Error(`Invalid preset: ${preset}`);
  }

  return updateIndicatorSettings(userId, {
    preset,
    weights: presetConfig.weights,
    minConfidence: presetConfig.minConfidence,
  });
}

/**
 * Map database row to IndicatorSettings
 */
function mapRowToSettings(row: Record<string, unknown>): IndicatorSettings {
  return {
    userId: row.user_id as string,
    preset: row.preset as 'conservative' | 'balanced' | 'aggressive' | 'custom',
    enableRsi: row.enable_rsi as boolean,
    enableMacd: row.enable_macd as boolean,
    enableBollinger: row.enable_bollinger as boolean,
    enableEma: row.enable_ema as boolean,
    enableVolume: row.enable_volume as boolean,
    enablePriceAction: row.enable_price_action as boolean,
    weights: {
      rsi: parseFloat(row.weight_rsi as string) || 0.25,
      macd: parseFloat(row.weight_macd as string) || 0.20,
      bollinger: parseFloat(row.weight_bollinger as string) || 0.20,
      ema: parseFloat(row.weight_ema as string) || 0.15,
      volume: parseFloat(row.weight_volume as string) || 0.10,
      priceAction: parseFloat(row.weight_price_action as string) || 0.10,
    },
    macdFast: row.macd_fast as number,
    macdSlow: row.macd_slow as number,
    macdSignal: row.macd_signal as number,
    bollingerPeriod: row.bollinger_period as number,
    bollingerStddev: parseFloat(row.bollinger_stddev as string) || 2.0,
    emaShort: row.ema_short as number,
    emaMedium: row.ema_medium as number,
    emaLong: row.ema_long as number,
    volumeAvgPeriod: row.volume_avg_period as number,
    volumeSpikeThreshold: parseFloat(row.volume_spike_threshold as string) || 2.0,
    minConfidence: parseFloat(row.min_confidence as string) || 0.60,
  };
}

// ============================================================================
// ADVANCED SIGNAL FEATURES - V2
// ============================================================================

// Types for advanced features
export interface ATRResult {
  atr: number;
  atrPct: number;  // ATR as % of current price
  volatilityLevel: 'low' | 'normal' | 'high';
}

export interface DynamicStopsResult {
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  atrUsed: number;
}

export interface VWAPAnalysis {
  vwap: number;
  vwapDeviation: number;  // % above/below VWAP
  priceReclaimingVWAP: boolean;  // Crossing above VWAP
  buyingPowerConfirmed: boolean;  // Volume + reclaim
}

export interface MTFAnalysis {
  trend1h: 'bullish' | 'bearish' | 'neutral';
  priceAbove21EMA1h: boolean;
  emaAlignment1h: boolean;  // EMA9 > EMA21 > EMA50
  confluence5m1h: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  confluenceScore: number;  // 0-1
}

export interface BTCCorrelationResult {
  btcChange30m: number;  // BTC % change over lookback period
  btcDumping: boolean;   // BTC dropped > threshold
  altcoinSignalsPaused: boolean;
  reason?: string;
}

export interface LiquiditySweepResult {
  detected: boolean;
  sweepCandle?: {
    low: number;
    close: number;
    lowerWickRatio: number;  // Lower wick / body size
    volumeSpike: boolean;
  };
  supportLevel?: number;
  rsiBullishDivergence: boolean;  // Price lower low, RSI higher low
  confidence: number;
}

export interface AdvancedSignalSettings {
  userId: string;
  featurePreset: 'basic' | 'intermediate' | 'pro';
  // MTF Confluence
  enableMtfConfluence: boolean;
  mtfHigherTimeframe: string;
  // VWAP Entry
  enableVwapEntry: boolean;
  vwapAnchorType: string;
  // ATR Stops
  enableAtrStops: boolean;
  atrPeriod: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;
  // BTC Filter
  enableBtcFilter: boolean;
  btcDumpThreshold: number;
  btcLookbackMinutes: number;
  // Liquidity Sweep
  enableLiquiditySweep: boolean;
  sweepWickRatio: number;
  sweepVolumeMultiplier: number;
}

// Feature presets
export const FEATURE_PRESETS = {
  basic: {
    enableMtfConfluence: false,
    enableVwapEntry: false,
    enableAtrStops: false,
    enableBtcFilter: false,
    enableLiquiditySweep: false,
  },
  intermediate: {
    enableMtfConfluence: true,
    enableVwapEntry: true,
    enableAtrStops: true,
    enableBtcFilter: false,
    enableLiquiditySweep: false,
  },
  pro: {
    enableMtfConfluence: true,
    enableVwapEntry: true,
    enableAtrStops: true,
    enableBtcFilter: true,
    enableLiquiditySweep: true,
  },
};

// BTC correlation cache (avoid repeated API calls)
let btcCorrelationCache: { result: BTCCorrelationResult; timestamp: number } | null = null;
const BTC_CACHE_TTL_MS = 30000; // 30 seconds

// ============================================================================
// ATR Calculation
// ============================================================================

/**
 * Calculate Average True Range (ATR)
 * True Range = max(H-L, |H-PrevClose|, |L-PrevClose|)
 */
export function calculateATR(
  klines: Array<{ high: number; low: number; close: number }>,
  period: number = 14
): ATRResult {
  if (klines.length < period + 1) {
    return { atr: 0, atrPct: 0, volatilityLevel: 'normal' };
  }

  // Calculate True Range for each candle
  const trueRanges: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Calculate ATR as EMA of True Ranges
  const atr = calculateEMA(trueRanges, period);
  const currentPrice = klines[klines.length - 1].close;
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  // Determine volatility level
  let volatilityLevel: 'low' | 'normal' | 'high' = 'normal';
  if (atrPct < 1) {
    volatilityLevel = 'low';
  } else if (atrPct > 3) {
    volatilityLevel = 'high';
  }

  return { atr, atrPct, volatilityLevel };
}

/**
 * Calculate Average Directional Index (ADX)
 * ADX measures trend strength (not direction)
 * - ADX > 25: Strong trend
 * - ADX 20-25: Mixed/transitioning
 * - ADX < 20: Ranging/sideways market
 *
 * +DI and -DI measure directional movement
 * - +DI > -DI: Bullish trend
 * - -DI > +DI: Bearish trend
 */
export function calculateADX(
  klines: Array<{ high: number; low: number; close: number }>,
  period: number = 14
): { adx: number; plusDI: number; minusDI: number } {
  if (klines.length < period * 2 + 1) {
    return { adx: 25, plusDI: 50, minusDI: 50 }; // Default to mixed/neutral
  }

  // Calculate True Range, +DM, and -DM for each candle
  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevHigh = klines[i - 1].high;
    const prevLow = klines[i - 1].low;
    const prevClose = klines[i - 1].close;

    // True Range
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);

    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  // Smooth the values using Wilder's smoothing (similar to EMA)
  function wilderSmooth(values: number[], smoothPeriod: number): number[] {
    if (values.length < smoothPeriod) return [];

    // First value is sum of first period values
    let smoothed = values.slice(0, smoothPeriod).reduce((a, b) => a + b, 0);
    const result: number[] = [smoothed];

    // Subsequent values use Wilder's smoothing
    for (let i = smoothPeriod; i < values.length; i++) {
      smoothed = smoothed - smoothed / smoothPeriod + values[i];
      result.push(smoothed);
    }

    return result;
  }

  const smoothedTR = wilderSmooth(trueRanges, period);
  const smoothedPlusDM = wilderSmooth(plusDMs, period);
  const smoothedMinusDM = wilderSmooth(minusDMs, period);

  if (smoothedTR.length === 0) {
    return { adx: 25, plusDI: 50, minusDI: 50 };
  }

  // Calculate +DI and -DI
  const plusDIs: number[] = [];
  const minusDIs: number[] = [];
  const dxs: number[] = [];

  for (let i = 0; i < smoothedTR.length; i++) {
    const atr = smoothedTR[i];
    if (atr === 0) {
      plusDIs.push(0);
      minusDIs.push(0);
      dxs.push(0);
      continue;
    }

    const plusDI = (smoothedPlusDM[i] / atr) * 100;
    const minusDI = (smoothedMinusDM[i] / atr) * 100;
    plusDIs.push(plusDI);
    minusDIs.push(minusDI);

    // DX = |+DI - -DI| / (+DI + -DI) * 100
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxs.push(dx);
  }

  // Smooth DX to get ADX
  if (dxs.length < period) {
    return { adx: 25, plusDI: 50, minusDI: 50 };
  }

  // First ADX is average of first period DX values
  let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Smooth subsequent ADX values
  for (let i = period; i < dxs.length; i++) {
    adx = (adx * (period - 1) + dxs[i]) / period;
  }

  return {
    adx,
    plusDI: plusDIs[plusDIs.length - 1] || 50,
    minusDI: minusDIs[minusDIs.length - 1] || 50,
  };
}

/**
 * Calculate dynamic stop-loss and take-profit based on ATR
 */
export function calculateDynamicStops(
  entryPrice: number,
  atr: number,
  slMultiplier: number = 2,
  tpMultiplier: number = 3
): DynamicStopsResult {
  const stopLoss = entryPrice - (atr * slMultiplier);
  const takeProfit = entryPrice + (atr * tpMultiplier);
  const riskRewardRatio = tpMultiplier / slMultiplier;

  return {
    stopLoss,
    takeProfit,
    riskRewardRatio,
    atrUsed: atr,
  };
}

// ============================================================================
// VWAP Calculation (Anchored to 24h Low)
// ============================================================================

/**
 * Calculate Volume Weighted Average Price (VWAP)
 * VWAP = Sum(Typical Price * Volume) / Sum(Volume)
 * Typical Price = (High + Low + Close) / 3
 */
export function calculateVWAP(
  klines: Array<{ high: number; low: number; close: number; volume: number }>,
  anchorIndex?: number  // Index of 24h low candle to anchor from
): VWAPAnalysis {
  if (klines.length < 2) {
    return {
      vwap: klines[0]?.close || 0,
      vwapDeviation: 0,
      priceReclaimingVWAP: false,
      buyingPowerConfirmed: false,
    };
  }

  // Find anchor point (24h low if not provided)
  let startIndex = anchorIndex ?? 0;
  if (anchorIndex === undefined) {
    let minLow = Infinity;
    for (let i = 0; i < klines.length; i++) {
      if (klines[i].low < minLow) {
        minLow = klines[i].low;
        startIndex = i;
      }
    }
  }

  // Calculate VWAP from anchor point
  let cumulativeTPV = 0;  // Typical Price * Volume
  let cumulativeVolume = 0;

  for (let i = startIndex; i < klines.length; i++) {
    const typicalPrice = (klines[i].high + klines[i].low + klines[i].close) / 3;
    cumulativeTPV += typicalPrice * klines[i].volume;
    cumulativeVolume += klines[i].volume;
  }

  const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : klines[klines.length - 1].close;
  const currentPrice = klines[klines.length - 1].close;
  const prevPrice = klines[klines.length - 2].close;

  const vwapDeviation = vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0;

  // Detect VWAP reclaim: previous close < VWAP AND current close > VWAP
  const priceReclaimingVWAP = prevPrice < vwap && currentPrice > vwap;

  // Confirm with volume (current volume > 1.5x average)
  const recentVolumes = klines.slice(-20).map(k => k.volume);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const currentVolume = klines[klines.length - 1].volume;
  const buyingPowerConfirmed = priceReclaimingVWAP && currentVolume > avgVolume * 1.5;

  return {
    vwap,
    vwapDeviation,
    priceReclaimingVWAP,
    buyingPowerConfirmed,
  };
}

// ============================================================================
// Multi-Timeframe Confluence
// ============================================================================

/**
 * Calculate Multi-Timeframe Confluence
 * Only signal buy on 5m if 1h trend is bullish
 */
export function calculateMTFConfluence(
  _closes5m: number[],  // Reserved for future 5m-specific analysis
  closes1h: number[],
  rsi5m: number
): MTFAnalysis {
  if (closes1h.length < 50) {
    return {
      trend1h: 'neutral',
      priceAbove21EMA1h: false,
      emaAlignment1h: false,
      confluence5m1h: 'neutral',
      confluenceScore: 0,
    };
  }

  // Calculate EMAs on 1h timeframe
  const ema9_1h = calculateEMA(closes1h, 9);
  const ema21_1h = calculateEMA(closes1h, 21);
  const ema50_1h = calculateEMA(closes1h, 50);
  const currentPrice1h = closes1h[closes1h.length - 1];

  // Check if price is above 21 EMA (bullish bias)
  const priceAbove21EMA1h = currentPrice1h > ema21_1h;

  // Check EMA alignment (bullish: 9 > 21 > 50)
  const emaAlignment1h = ema9_1h > ema21_1h && ema21_1h > ema50_1h;

  // Determine 1h trend
  let trend1h: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (priceAbove21EMA1h && emaAlignment1h) {
    trend1h = 'bullish';
  } else if (!priceAbove21EMA1h && ema9_1h < ema21_1h && ema21_1h < ema50_1h) {
    trend1h = 'bearish';
  } else if (priceAbove21EMA1h) {
    trend1h = 'bullish';  // Price above 21 EMA is still bullish even without perfect alignment
  } else {
    trend1h = 'bearish';
  }

  // Calculate confluence between 5m and 1h
  let confluence5m1h: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish' = 'neutral';
  let confluenceScore = 0;

  if (trend1h === 'bullish' && rsi5m < 30) {
    // Strong signal: 1h bullish + 5m oversold
    confluence5m1h = 'strong_bullish';
    confluenceScore = 1.0;
  } else if (trend1h === 'bullish' && rsi5m < 40) {
    confluence5m1h = 'bullish';
    confluenceScore = 0.7;
  } else if (trend1h === 'bullish') {
    confluence5m1h = 'bullish';
    confluenceScore = 0.4;
  } else if (trend1h === 'bearish' && rsi5m > 70) {
    confluence5m1h = 'strong_bearish';
    confluenceScore = 0;  // No long signal
  } else if (trend1h === 'bearish') {
    confluence5m1h = 'bearish';
    confluenceScore = 0.1;  // Weak signal, going against trend
  }

  return {
    trend1h,
    priceAbove21EMA1h,
    emaAlignment1h,
    confluence5m1h,
    confluenceScore,
  };
}

// ============================================================================
// BTC Correlation Check
// ============================================================================

/**
 * Check BTC correlation - pause altcoin longs if BTC is dumping
 * This function requires external klines fetch, so it takes klines as parameter
 */
export function checkBTCCorrelationFromKlines(
  btcKlines1m: Array<{ close: number }>,
  threshold: number = 1.5,
  lookbackMinutes: number = 30
): BTCCorrelationResult {
  if (btcKlines1m.length < lookbackMinutes) {
    return {
      btcChange30m: 0,
      btcDumping: false,
      altcoinSignalsPaused: false,
    };
  }

  const currentPrice = btcKlines1m[btcKlines1m.length - 1].close;
  const lookbackPrice = btcKlines1m[btcKlines1m.length - lookbackMinutes].close;

  const btcChange30m = lookbackPrice > 0
    ? ((currentPrice - lookbackPrice) / lookbackPrice) * 100
    : 0;

  const btcDumping = btcChange30m < -threshold;
  const altcoinSignalsPaused = btcDumping;

  return {
    btcChange30m,
    btcDumping,
    altcoinSignalsPaused,
    reason: btcDumping
      ? `BTC dropped ${btcChange30m.toFixed(2)}% in ${lookbackMinutes}m - altcoin longs paused`
      : undefined,
  };
}

/**
 * Get cached BTC correlation result (for performance)
 */
export function getCachedBTCCorrelation(): BTCCorrelationResult | null {
  if (btcCorrelationCache && Date.now() - btcCorrelationCache.timestamp < BTC_CACHE_TTL_MS) {
    return btcCorrelationCache.result;
  }
  return null;
}

/**
 * Set BTC correlation cache
 */
export function setCachedBTCCorrelation(result: BTCCorrelationResult): void {
  btcCorrelationCache = { result, timestamp: Date.now() };
}

// ============================================================================
// RSI Series (for divergence detection)
// ============================================================================

/**
 * Calculate RSI for each candle (not just the latest)
 * Used to detect divergence patterns
 */
export function calculateRSISeries(
  closes: number[],
  period: number = 14
): number[] {
  if (closes.length < period + 1) return [];

  const rsiValues: number[] = [];

  // Calculate initial average gain/loss
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }

  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  if (avgLoss === 0) {
    rsiValues.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + rs));
  }

  // Calculate RSI for remaining periods using smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsiValues.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsiValues.push(100 - 100 / (1 + rs));
    }
  }

  return rsiValues;
}

/**
 * Detect RSI bullish divergence
 * Price makes lower low, RSI makes higher low
 */
export function detectRSIDivergence(
  closes: number[],
  rsiValues: number[],
  lookback: number = 10
): { bullishDivergence: boolean; bearishDivergence: boolean } {
  if (closes.length < lookback || rsiValues.length < lookback) {
    return { bullishDivergence: false, bearishDivergence: false };
  }

  const recentCloses = closes.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  // Find local lows in price and RSI
  let priceMin = recentCloses[0];
  let rsiMin = recentRSI[0];
  let rsiMinIdx = 0;

  for (let i = 1; i < lookback - 1; i++) {
    if (recentCloses[i] < priceMin) {
      priceMin = recentCloses[i];
    }
    if (recentRSI[i] < rsiMin) {
      rsiMin = recentRSI[i];
      rsiMinIdx = i;
    }
  }

  // Check current values
  const currentPrice = recentCloses[lookback - 1];
  const currentRSI = recentRSI[lookback - 1];

  // Bullish divergence: price lower low, RSI higher low
  const priceLowerLow = currentPrice < priceMin;
  const rsiHigherLow = currentRSI > rsiMin && rsiMinIdx < lookback - 2;
  const bullishDivergence = priceLowerLow && rsiHigherLow;

  // Bearish divergence: price higher high, RSI lower high (not used for longs)
  const bearishDivergence = false;

  return { bullishDivergence, bearishDivergence };
}

// ============================================================================
// Liquidity Sweep Detection
// ============================================================================

/**
 * Detect liquidity sweep pattern
 * Conditions:
 * 1. Low breaches support level
 * 2. Close recovers above support
 * 3. Lower wick >= 1.5x candle body size
 * 4. Volume spike (> 2x avg)
 * 5. RSI bullish divergence
 */
export function detectLiquiditySweep(
  klines: Array<{ open: number; high: number; low: number; close: number; volume: number }>,
  supportLevel: number,
  avgVolume: number,
  rsiValues: number[],
  wickRatio: number = 1.5,
  volumeMultiplier: number = 2.0
): LiquiditySweepResult {
  if (klines.length < 3 || rsiValues.length < 3) {
    return {
      detected: false,
      rsiBullishDivergence: false,
      confidence: 0,
    };
  }

  const lastCandle = klines[klines.length - 1];

  // Calculate candle components
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
  const lowerWickRatio = body > 0 ? lowerWick / body : 0;

  // Check conditions
  const lowBreachesSupport = lastCandle.low < supportLevel;
  const closeAboveSupport = lastCandle.close > supportLevel;
  const wickConditionMet = lowerWickRatio >= wickRatio;
  const volumeSpike = lastCandle.volume > avgVolume * volumeMultiplier;

  // Check RSI divergence
  const closes = klines.map(k => k.close);
  const { bullishDivergence: rsiBullishDivergence } = detectRSIDivergence(closes, rsiValues, 10);

  // Calculate confidence
  let confidence = 0;
  let conditionsMet = 0;

  if (lowBreachesSupport && closeAboveSupport) {
    conditionsMet++;
    confidence += 0.3;
  }
  if (wickConditionMet) {
    conditionsMet++;
    confidence += 0.2;
  }
  if (volumeSpike) {
    conditionsMet++;
    confidence += 0.25;
  }
  if (rsiBullishDivergence) {
    conditionsMet++;
    confidence += 0.25;
  }

  // Sweep is detected if at least 3 conditions are met
  const detected = conditionsMet >= 3;

  return {
    detected,
    sweepCandle: detected ? {
      low: lastCandle.low,
      close: lastCandle.close,
      lowerWickRatio,
      volumeSpike,
    } : undefined,
    supportLevel: detected ? supportLevel : undefined,
    rsiBullishDivergence,
    confidence,
  };
}

// ============================================================================
// Advanced Settings Database Operations
// ============================================================================

/**
 * Get advanced signal settings for a user
 */
export async function getAdvancedSignalSettings(userId: string): Promise<AdvancedSignalSettings> {
  const result = await pool.query(
    `SELECT
      feature_preset,
      enable_mtf_confluence,
      mtf_higher_timeframe,
      enable_vwap_entry,
      vwap_anchor_type,
      enable_atr_stops,
      atr_period,
      atr_sl_multiplier,
      atr_tp_multiplier,
      enable_btc_filter,
      btc_dump_threshold,
      btc_lookback_minutes,
      enable_liquidity_sweep,
      sweep_wick_ratio,
      sweep_volume_multiplier
    FROM indicator_settings WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Create default settings and return defaults
    await pool.query(
      `INSERT INTO indicator_settings (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    return {
      userId,
      featurePreset: 'basic',
      enableMtfConfluence: false,
      mtfHigherTimeframe: '1h',
      enableVwapEntry: false,
      vwapAnchorType: '24h_low',
      enableAtrStops: false,
      atrPeriod: 14,
      atrSlMultiplier: 2.0,
      atrTpMultiplier: 3.0,
      enableBtcFilter: false,
      btcDumpThreshold: 1.5,
      btcLookbackMinutes: 30,
      enableLiquiditySweep: false,
      sweepWickRatio: 1.5,
      sweepVolumeMultiplier: 2.0,
    };
  }

  const row = result.rows[0];
  return {
    userId,
    featurePreset: (row.feature_preset as 'basic' | 'intermediate' | 'pro') || 'basic',
    enableMtfConfluence: row.enable_mtf_confluence ?? false,
    mtfHigherTimeframe: row.mtf_higher_timeframe || '1h',
    enableVwapEntry: row.enable_vwap_entry ?? false,
    vwapAnchorType: row.vwap_anchor_type || '24h_low',
    enableAtrStops: row.enable_atr_stops ?? false,
    atrPeriod: row.atr_period ?? 14,
    atrSlMultiplier: parseFloat(row.atr_sl_multiplier) || 2.0,
    atrTpMultiplier: parseFloat(row.atr_tp_multiplier) || 3.0,
    enableBtcFilter: row.enable_btc_filter ?? false,
    btcDumpThreshold: parseFloat(row.btc_dump_threshold) || 1.5,
    btcLookbackMinutes: row.btc_lookback_minutes ?? 30,
    enableLiquiditySweep: row.enable_liquidity_sweep ?? false,
    sweepWickRatio: parseFloat(row.sweep_wick_ratio) || 1.5,
    sweepVolumeMultiplier: parseFloat(row.sweep_volume_multiplier) || 2.0,
  };
}

/**
 * Update advanced signal settings
 */
export async function updateAdvancedSignalSettings(
  userId: string,
  updates: Partial<AdvancedSignalSettings>
): Promise<AdvancedSignalSettings> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.featurePreset !== undefined) {
    setClauses.push(`feature_preset = $${paramIndex++}`);
    values.push(updates.featurePreset);
  }
  if (updates.enableMtfConfluence !== undefined) {
    setClauses.push(`enable_mtf_confluence = $${paramIndex++}`);
    values.push(updates.enableMtfConfluence);
  }
  if (updates.mtfHigherTimeframe !== undefined) {
    setClauses.push(`mtf_higher_timeframe = $${paramIndex++}`);
    values.push(updates.mtfHigherTimeframe);
  }
  if (updates.enableVwapEntry !== undefined) {
    setClauses.push(`enable_vwap_entry = $${paramIndex++}`);
    values.push(updates.enableVwapEntry);
  }
  if (updates.vwapAnchorType !== undefined) {
    setClauses.push(`vwap_anchor_type = $${paramIndex++}`);
    values.push(updates.vwapAnchorType);
  }
  if (updates.enableAtrStops !== undefined) {
    setClauses.push(`enable_atr_stops = $${paramIndex++}`);
    values.push(updates.enableAtrStops);
  }
  if (updates.atrPeriod !== undefined) {
    setClauses.push(`atr_period = $${paramIndex++}`);
    values.push(updates.atrPeriod);
  }
  if (updates.atrSlMultiplier !== undefined) {
    setClauses.push(`atr_sl_multiplier = $${paramIndex++}`);
    values.push(updates.atrSlMultiplier);
  }
  if (updates.atrTpMultiplier !== undefined) {
    setClauses.push(`atr_tp_multiplier = $${paramIndex++}`);
    values.push(updates.atrTpMultiplier);
  }
  if (updates.enableBtcFilter !== undefined) {
    setClauses.push(`enable_btc_filter = $${paramIndex++}`);
    values.push(updates.enableBtcFilter);
  }
  if (updates.btcDumpThreshold !== undefined) {
    setClauses.push(`btc_dump_threshold = $${paramIndex++}`);
    values.push(updates.btcDumpThreshold);
  }
  if (updates.btcLookbackMinutes !== undefined) {
    setClauses.push(`btc_lookback_minutes = $${paramIndex++}`);
    values.push(updates.btcLookbackMinutes);
  }
  if (updates.enableLiquiditySweep !== undefined) {
    setClauses.push(`enable_liquidity_sweep = $${paramIndex++}`);
    values.push(updates.enableLiquiditySweep);
  }
  if (updates.sweepWickRatio !== undefined) {
    setClauses.push(`sweep_wick_ratio = $${paramIndex++}`);
    values.push(updates.sweepWickRatio);
  }
  if (updates.sweepVolumeMultiplier !== undefined) {
    setClauses.push(`sweep_volume_multiplier = $${paramIndex++}`);
    values.push(updates.sweepVolumeMultiplier);
  }

  if (setClauses.length === 0) {
    return getAdvancedSignalSettings(userId);
  }

  values.push(userId);
  await pool.query(
    `UPDATE indicator_settings
     SET ${setClauses.join(', ')}
     WHERE user_id = $${paramIndex}`,
    values
  );

  return getAdvancedSignalSettings(userId);
}

/**
 * Apply feature preset to advanced settings
 */
export async function applyFeaturePreset(
  userId: string,
  preset: 'basic' | 'intermediate' | 'pro'
): Promise<AdvancedSignalSettings> {
  const presetConfig = FEATURE_PRESETS[preset];

  return updateAdvancedSignalSettings(userId, {
    featurePreset: preset,
    enableMtfConfluence: presetConfig.enableMtfConfluence,
    enableVwapEntry: presetConfig.enableVwapEntry,
    enableAtrStops: presetConfig.enableAtrStops,
    enableBtcFilter: presetConfig.enableBtcFilter,
    enableLiquiditySweep: presetConfig.enableLiquiditySweep,
  });
}
