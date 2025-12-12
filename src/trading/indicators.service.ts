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
