/**
 * Research Mode Service
 *
 * Manages scalping signal detection, execution modes, and Luna integration
 * for the Research Mode tab in the Trading Dashboard.
 */

import { pool } from '../db/index.js';
import { BinanceClient, type Ticker24hr } from './binance.client.js';
import * as tradingService from './trading.service.js';
import * as scalpingService from './scalping.service.js';
import * as tradingChat from '../chat/trading-chat.service.js';
import { getCachedPrice, broadcastSignal } from './trading.websocket.js';
import * as indicatorsService from './indicators.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface ResearchSettings {
  userId: string;
  executionMode: 'auto' | 'confirm' | 'manual';
  paperLiveMode: 'paper' | 'live';
  enableAutoDiscovery: boolean;
  autoDiscoveryLimit: number;
  customSymbols: string[];
  minConfidence: number;
  scanIntervalSeconds: number;
}

export interface ResearchSignal {
  id: string;
  userId: string;
  symbol: string;
  price: number;
  rsi1m?: number;
  rsi5m?: number;
  rsi15m?: number;
  priceDropPct?: number;
  volumeRatio?: number;
  confidence: number;
  reasons: string[];
  status: 'pending' | 'executed' | 'skipped' | 'expired' | 'failed';
  executionMode: string;
  paperLiveMode: string;
  tradeId?: string;
  paperTradeId?: string;
  errorMessage?: string;
  createdAt: Date;
  executedAt?: Date;
  expiresAt?: Date;
  // Enhanced indicator data
  indicators?: {
    rsi: { value1m: number; value5m: number; value15m: number };
    macd: { value: number; signal: number; histogram: number; crossover: string | null };
    bollinger: { percentB: number; squeeze: boolean };
    ema: { trend: string; crossover: string | null };
    volume: { ratio: number; spike: boolean };
  };
  confidenceBreakdown?: indicatorsService.ConfidenceBreakdown;
}

export interface MultiTimeframeAnalysis {
  symbol: string;
  rsi1m: number;
  rsi5m: number;
  rsi15m: number;
  trend1m: 'bullish' | 'bearish' | 'neutral';
  momentumDivergence: boolean;
  price: number;
  priceDropPct: number;
  volumeRatio: number;
  confidence: number;
  reasons: string[];
  nearSupport: boolean;
  // Enhanced indicator data
  indicators: indicatorsService.FullIndicatorAnalysis;
  confidenceBreakdown: indicatorsService.ConfidenceBreakdown;
}

// In-memory signal queue for fast access (also persisted to DB)
const signalQueues = new Map<string, ResearchSignal[]>();

// ============================================
// Settings Management
// ============================================

/**
 * Get research settings for a user
 */
export async function getResearchSettings(userId: string): Promise<ResearchSettings | null> {
  const result = await pool.query(
    `SELECT * FROM research_settings WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Create default settings if none exist
    return createDefaultSettings(userId);
  }

  const row = result.rows[0];
  return {
    userId: row.user_id,
    executionMode: row.execution_mode,
    paperLiveMode: row.paper_live_mode,
    enableAutoDiscovery: row.enable_auto_discovery,
    autoDiscoveryLimit: row.auto_discovery_limit,
    customSymbols: row.custom_symbols || [],
    minConfidence: parseFloat(row.min_confidence),
    scanIntervalSeconds: row.scan_interval_seconds,
  };
}

/**
 * Create default research settings
 */
async function createDefaultSettings(userId: string): Promise<ResearchSettings> {
  await pool.query(
    `INSERT INTO research_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  return {
    userId,
    executionMode: 'manual',
    paperLiveMode: 'paper',
    enableAutoDiscovery: true,
    autoDiscoveryLimit: 20,
    customSymbols: [],
    minConfidence: 0.6,
    scanIntervalSeconds: 30,
  };
}

/**
 * Update research settings
 */
export async function updateResearchSettings(
  userId: string,
  settings: Partial<ResearchSettings>
): Promise<ResearchSettings> {
  await pool.query(
    `INSERT INTO research_settings (
      user_id, execution_mode, paper_live_mode, enable_auto_discovery,
      auto_discovery_limit, custom_symbols, min_confidence, scan_interval_seconds
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id) DO UPDATE SET
      execution_mode = COALESCE($2, research_settings.execution_mode),
      paper_live_mode = COALESCE($3, research_settings.paper_live_mode),
      enable_auto_discovery = COALESCE($4, research_settings.enable_auto_discovery),
      auto_discovery_limit = COALESCE($5, research_settings.auto_discovery_limit),
      custom_symbols = COALESCE($6, research_settings.custom_symbols),
      min_confidence = COALESCE($7, research_settings.min_confidence),
      scan_interval_seconds = COALESCE($8, research_settings.scan_interval_seconds),
      updated_at = NOW()`,
    [
      userId,
      settings.executionMode,
      settings.paperLiveMode,
      settings.enableAutoDiscovery,
      settings.autoDiscoveryLimit,
      settings.customSymbols,
      settings.minConfidence,
      settings.scanIntervalSeconds,
    ]
  );

  return getResearchSettings(userId) as Promise<ResearchSettings>;
}

// ============================================
// Top Volume Pairs Discovery
// ============================================

/**
 * Get top USDC trading pairs by 24h volume
 */
export async function getTopVolumePairs(limit: number = 20): Promise<string[]> {
  try {
    const publicClient = new BinanceClient({ apiKey: '', apiSecret: '' });
    const allTickers = await publicClient.getTicker24hr() as Ticker24hr[];

    // Filter to USDC pairs only, sort by quote volume
    const usdcPairs = allTickers
      .filter(t => t.symbol.endsWith('USDC'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(t => t.symbol);

    return usdcPairs;
  } catch (error) {
    logger.error('Failed to get top volume pairs', { error: (error as Error).message });
    // Return default pairs as fallback
    return ['BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'BNBUSDC', 'XRPUSDC'];
  }
}

/**
 * Get active symbols for scanning (auto-discovered + custom)
 */
export async function getActiveSymbols(userId: string): Promise<string[]> {
  const settings = await getResearchSettings(userId);
  if (!settings) return [];

  let symbols: string[] = [...(settings.customSymbols || [])];

  if (settings.enableAutoDiscovery) {
    const topPairs = await getTopVolumePairs(settings.autoDiscoveryLimit);
    // Merge, avoiding duplicates
    for (const pair of topPairs) {
      if (!symbols.includes(pair)) {
        symbols.push(pair);
      }
    }
  }

  return symbols;
}

// ============================================
// Multi-Timeframe Analysis
// ============================================

/**
 * Calculate RSI from close prices
 */
function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

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

/**
 * Calculate multi-timeframe RSI (1m and 5m)
 */
export async function calculateMultiTimeframeRSI(symbol: string): Promise<{
  rsi1m: number;
  rsi5m: number;
  trend1m: 'bullish' | 'bearish' | 'neutral';
  momentumDivergence: boolean;
}> {
  try {
    const [klines5m, klines1m] = await Promise.all([
      tradingService.getKlines(symbol, '5m', 20),
      tradingService.getKlines(symbol, '1m', 20),
    ]);

    const closes5m = klines5m.map(k => parseFloat(k.close));
    const closes1m = klines1m.map(k => parseFloat(k.close));

    const rsi5m = calculateRSI(closes5m);
    const rsi1m = calculateRSI(closes1m);

    // Determine 1m trend
    const trend1m = rsi1m > 55 ? 'bullish' : rsi1m < 45 ? 'bearish' : 'neutral';

    // Detect momentum divergence (1m rising while 5m oversold)
    const momentumDivergence = rsi5m < 30 && rsi1m > rsi5m + 5;

    return { rsi1m, rsi5m, trend1m, momentumDivergence };
  } catch (error) {
    logger.error('Failed to calculate multi-timeframe RSI', { symbol, error: (error as Error).message });
    return { rsi1m: 50, rsi5m: 50, trend1m: 'neutral', momentumDivergence: false };
  }
}

/**
 * Analyze a symbol with multi-timeframe data and all indicators
 */
export async function analyzeSymbol(
  symbol: string,
  minConfidence: number = 0.5,
  userId?: string
): Promise<MultiTimeframeAnalysis | null> {
  try {
    // Get indicator settings if userId provided
    let indicatorSettings: indicatorsService.IndicatorSettings | null = null;
    if (userId) {
      indicatorSettings = await indicatorsService.getIndicatorSettings(userId);
    }

    // Use settings or defaults
    const weights = indicatorSettings?.weights || indicatorsService.INDICATOR_PRESETS.balanced.weights;
    const enabled = {
      rsi: indicatorSettings?.enableRsi ?? true,
      macd: indicatorSettings?.enableMacd ?? true,
      bollinger: indicatorSettings?.enableBollinger ?? true,
      ema: indicatorSettings?.enableEma ?? true,
      volume: indicatorSettings?.enableVolume ?? true,
      priceAction: indicatorSettings?.enablePriceAction ?? true,
    };

    // Get current price and 24h data
    const cached = getCachedPrice(symbol);
    let price: number;
    let high24h: number;
    let low24h: number;

    if (cached) {
      price = cached.price;
      high24h = cached.high24h;
      low24h = cached.low24h;
    } else {
      const publicClient = new BinanceClient({ apiKey: '', apiSecret: '' });
      const ticker = await publicClient.getTicker24hr(symbol) as Ticker24hr;
      price = parseFloat(ticker.lastPrice);
      high24h = parseFloat(ticker.highPrice);
      low24h = parseFloat(ticker.lowPrice);
    }

    // Get klines for all timeframes (1m, 5m, 15m)
    const [klines1m, klines5m, klines15m] = await Promise.all([
      tradingService.getKlines(symbol, '1m', 60),
      tradingService.getKlines(symbol, '5m', 60),
      tradingService.getKlines(symbol, '15m', 60),
    ]);

    // Extract closes and volumes
    const closes1m = klines1m.map(k => parseFloat(k.close));
    const closes5m = klines5m.map(k => parseFloat(k.close));
    const closes15m = klines15m.map(k => parseFloat(k.close));
    const volumes5m = klines5m.map(k => parseFloat(k.volume));

    // Calculate RSI for all timeframes
    const rsi1m = indicatorsService.calculateRSI(closes1m);
    const rsi5m = indicatorsService.calculateRSI(closes5m);
    const rsi15m = indicatorsService.calculateRSI(closes15m);

    // Determine 1m trend
    const trend1m = rsi1m > 55 ? 'bullish' : rsi1m < 45 ? 'bearish' : 'neutral';

    // Detect momentum divergence (1m rising while 5m oversold)
    const momentumDivergence = rsi5m < 30 && rsi1m > rsi5m + 5;

    // Calculate all indicators on 5m timeframe (primary)
    const macdParams = indicatorSettings
      ? { fast: indicatorSettings.macdFast, slow: indicatorSettings.macdSlow, signal: indicatorSettings.macdSignal }
      : { fast: 12, slow: 26, signal: 9 };

    const bollingerParams = indicatorSettings
      ? { period: indicatorSettings.bollingerPeriod, stdDev: indicatorSettings.bollingerStddev }
      : { period: 20, stdDev: 2 };

    const emaParams = indicatorSettings
      ? { short: indicatorSettings.emaShort, medium: indicatorSettings.emaMedium, long: indicatorSettings.emaLong }
      : { short: 9, medium: 21, long: 50 };

    const volumeParams = indicatorSettings
      ? { avgPeriod: indicatorSettings.volumeAvgPeriod, spikeThreshold: indicatorSettings.volumeSpikeThreshold }
      : { avgPeriod: 20, spikeThreshold: 2.0 };

    const macd = indicatorsService.calculateMACD(closes5m, macdParams.fast, macdParams.slow, macdParams.signal);
    const bollinger = indicatorsService.calculateBollinger(closes5m, bollingerParams.period, bollingerParams.stdDev);
    const ema = indicatorsService.calculateEMACross(closes5m, emaParams.short, emaParams.medium, emaParams.long);
    const volume = indicatorsService.analyzeVolume(volumes5m, closes5m, volumeParams.avgPeriod, volumeParams.spikeThreshold);

    // Build indicator analysis
    const indicators: indicatorsService.FullIndicatorAnalysis = {
      rsi: { value1m: rsi1m, value5m: rsi5m, value15m: rsi15m },
      macd,
      bollinger,
      ema,
      volume,
    };

    // Calculate price metrics
    const priceDropPct = ((high24h - price) / high24h) * 100;
    const distanceToSupport = ((price - low24h) / low24h) * 100;
    const nearSupport = distanceToSupport <= 2;
    const volumeRatio = volume.volumeRatio;

    // Calculate weighted confidence
    const confidenceBreakdown = indicatorsService.calculateWeightedConfidence(
      indicators,
      priceDropPct,
      nearSupport,
      weights,
      enabled
    );

    // Build reasons list from active signals
    const reasons: string[] = [];

    if (enabled.rsi && rsi5m <= 30) {
      reasons.push(`5m RSI oversold (${rsi5m.toFixed(1)})`);
    }
    if (enabled.rsi && rsi1m <= 30) {
      reasons.push(`1m RSI oversold (${rsi1m.toFixed(1)})`);
    }
    if (enabled.rsi && momentumDivergence) {
      reasons.push('Momentum divergence detected');
    }
    if (enabled.macd && macd.crossover === 'bullish_cross') {
      reasons.push('MACD bullish crossover');
    } else if (enabled.macd && macd.histogram > 0 && macd.trend === 'bullish') {
      reasons.push('MACD bullish momentum');
    }
    if (enabled.bollinger && bollinger.percentB < 0) {
      reasons.push('Below Bollinger lower band');
    } else if (enabled.bollinger && bollinger.percentB < 0.2) {
      reasons.push('Near Bollinger lower band');
    }
    if (enabled.bollinger && bollinger.squeeze) {
      reasons.push('Bollinger squeeze (low volatility)');
    }
    if (enabled.ema && ema.crossover === 'golden_cross') {
      reasons.push('EMA golden cross');
    } else if (enabled.ema && ema.trend === 'bullish') {
      reasons.push('Bullish EMA alignment');
    }
    if (enabled.volume && volume.volumeSpike) {
      reasons.push(`Volume spike (${volume.volumeRatio.toFixed(1)}x avg)`);
    }
    if (enabled.priceAction && priceDropPct >= 3) {
      reasons.push(`Price dropped ${priceDropPct.toFixed(1)}% from 24h high`);
    }
    if (enabled.priceAction && nearSupport) {
      reasons.push(`Near 24h support ($${low24h.toFixed(2)})`);
    }

    // Only return if we have enough signals and confidence
    if (reasons.length < 2 || confidenceBreakdown.total < minConfidence) {
      return null;
    }

    return {
      symbol,
      rsi1m,
      rsi5m,
      rsi15m,
      trend1m,
      momentumDivergence,
      price,
      priceDropPct,
      volumeRatio,
      confidence: confidenceBreakdown.total,
      reasons,
      nearSupport,
      indicators,
      confidenceBreakdown,
    };
  } catch (error) {
    logger.error('Failed to analyze symbol', { symbol, error: (error as Error).message });
    return null;
  }
}

// ============================================
// Signal Management
// ============================================

/**
 * Create and store a new signal
 */
export async function createSignal(
  userId: string,
  analysis: MultiTimeframeAnalysis,
  settings: ResearchSettings
): Promise<ResearchSignal> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minute expiry

  // Prepare indicator breakdown for storage
  const indicatorBreakdown = analysis.confidenceBreakdown ? {
    rsi: analysis.confidenceBreakdown.rsi,
    macd: analysis.confidenceBreakdown.macd,
    bollinger: analysis.confidenceBreakdown.bollinger,
    ema: analysis.confidenceBreakdown.ema,
    volume: analysis.confidenceBreakdown.volume,
    priceAction: analysis.confidenceBreakdown.priceAction,
  } : null;

  const result = await pool.query(
    `INSERT INTO research_signals (
      user_id, symbol, price, rsi_1m, rsi_5m, rsi_15m, price_drop_pct,
      volume_ratio, confidence, reasons, status, execution_mode,
      paper_live_mode, expires_at,
      macd_value, macd_signal_value, macd_histogram, macd_crossover,
      bollinger_percent_b, bollinger_squeeze, ema_trend, ema_crossover,
      volume_spike, volume_ratio_value, indicator_breakdown
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
    RETURNING *`,
    [
      userId,
      analysis.symbol,
      analysis.price,
      analysis.rsi1m,
      analysis.rsi5m,
      analysis.rsi15m,
      analysis.priceDropPct,
      analysis.volumeRatio,
      analysis.confidence,
      JSON.stringify(analysis.reasons),
      settings.executionMode,
      settings.paperLiveMode,
      expiresAt,
      analysis.indicators?.macd.macd,
      analysis.indicators?.macd.signal,
      analysis.indicators?.macd.histogram,
      analysis.indicators?.macd.crossover,
      analysis.indicators?.bollinger.percentB,
      analysis.indicators?.bollinger.squeeze,
      analysis.indicators?.ema.trend,
      analysis.indicators?.ema.crossover,
      analysis.indicators?.volume.volumeSpike,
      analysis.indicators?.volume.volumeRatio,
      indicatorBreakdown ? JSON.stringify(indicatorBreakdown) : null,
    ]
  );

  const row = result.rows[0];
  const signal: ResearchSignal = mapRowToSignal(row);

  // Add indicator data to signal
  if (analysis.indicators) {
    signal.indicators = {
      rsi: analysis.indicators.rsi,
      macd: {
        value: analysis.indicators.macd.macd,
        signal: analysis.indicators.macd.signal,
        histogram: analysis.indicators.macd.histogram,
        crossover: analysis.indicators.macd.crossover,
      },
      bollinger: {
        percentB: analysis.indicators.bollinger.percentB,
        squeeze: analysis.indicators.bollinger.squeeze,
      },
      ema: {
        trend: analysis.indicators.ema.trend,
        crossover: analysis.indicators.ema.crossover,
      },
      volume: {
        ratio: analysis.indicators.volume.volumeRatio,
        spike: analysis.indicators.volume.volumeSpike,
      },
    };
    signal.confidenceBreakdown = analysis.confidenceBreakdown;
  }

  // Add to in-memory queue
  const queue = signalQueues.get(userId) || [];
  queue.unshift(signal);
  if (queue.length > 100) queue.pop();
  signalQueues.set(userId, queue);

  // Broadcast via WebSocket
  broadcastSignal(userId, signal);

  logger.info('Research signal created', {
    userId,
    symbol: analysis.symbol,
    confidence: analysis.confidence,
    reasons: analysis.reasons,
    mode: settings.executionMode,
  });

  return signal;
}

/**
 * Map database row to ResearchSignal
 */
function mapRowToSignal(row: Record<string, unknown>): ResearchSignal {
  const signal: ResearchSignal = {
    id: row.id as string,
    userId: row.user_id as string,
    symbol: row.symbol as string,
    price: parseFloat(row.price as string),
    rsi1m: row.rsi_1m ? parseFloat(row.rsi_1m as string) : undefined,
    rsi5m: row.rsi_5m ? parseFloat(row.rsi_5m as string) : undefined,
    rsi15m: row.rsi_15m ? parseFloat(row.rsi_15m as string) : undefined,
    priceDropPct: row.price_drop_pct ? parseFloat(row.price_drop_pct as string) : undefined,
    volumeRatio: row.volume_ratio ? parseFloat(row.volume_ratio as string) : undefined,
    confidence: parseFloat(row.confidence as string),
    reasons: row.reasons as string[],
    status: row.status as ResearchSignal['status'],
    executionMode: row.execution_mode as string,
    paperLiveMode: row.paper_live_mode as string,
    tradeId: row.trade_id as string | undefined,
    paperTradeId: row.paper_trade_id as string | undefined,
    errorMessage: row.error_message as string | undefined,
    createdAt: row.created_at as Date,
    executedAt: row.executed_at as Date | undefined,
    expiresAt: row.expires_at as Date | undefined,
  };

  // Add indicator data if available
  if (row.macd_value !== null && row.macd_value !== undefined) {
    signal.indicators = {
      rsi: {
        value1m: signal.rsi1m || 50,
        value5m: signal.rsi5m || 50,
        value15m: signal.rsi15m || 50,
      },
      macd: {
        value: parseFloat(row.macd_value as string),
        signal: parseFloat(row.macd_signal_value as string),
        histogram: parseFloat(row.macd_histogram as string),
        crossover: row.macd_crossover as string | null,
      },
      bollinger: {
        percentB: parseFloat(row.bollinger_percent_b as string),
        squeeze: row.bollinger_squeeze as boolean,
      },
      ema: {
        trend: row.ema_trend as string,
        crossover: row.ema_crossover as string | null,
      },
      volume: {
        ratio: row.volume_ratio_value ? parseFloat(row.volume_ratio_value as string) : 1,
        spike: row.volume_spike as boolean,
      },
    };
  }

  if (row.indicator_breakdown) {
    signal.confidenceBreakdown = row.indicator_breakdown as indicatorsService.ConfidenceBreakdown;
  }

  return signal;
}

/**
 * Get recent signals for a user
 */
export async function getSignals(userId: string, limit: number = 50): Promise<ResearchSignal[]> {
  const result = await pool.query(
    `SELECT * FROM research_signals
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(mapRowToSignal);
}

/**
 * Update signal status
 */
async function updateSignalStatus(
  signalId: string,
  status: 'executed' | 'skipped' | 'expired' | 'failed',
  updates?: { tradeId?: string; paperTradeId?: string; errorMessage?: string }
): Promise<void> {
  await pool.query(
    `UPDATE research_signals SET
      status = $2,
      trade_id = COALESCE($3, trade_id),
      paper_trade_id = COALESCE($4, paper_trade_id),
      error_message = COALESCE($5, error_message),
      executed_at = CASE WHEN $2 = 'executed' THEN NOW() ELSE executed_at END
    WHERE id = $1`,
    [signalId, status, updates?.tradeId, updates?.paperTradeId, updates?.errorMessage]
  );
}

// ============================================
// Execution via Luna
// ============================================

/**
 * Execute a signal via Luna's trading chat
 */
export async function executeSignalViaLuna(
  userId: string,
  signal: ResearchSignal,
  settings: ResearchSettings
): Promise<{ success: boolean; result?: string; tradeId?: string }> {
  try {
    // Get or create trading session
    const sessionId = await tradingChat.getOrCreateTradingSession(userId);

    // Construct trade command for Luna
    const reasonsStr = signal.reasons.join(', ');
    let message: string;

    if (settings.paperLiveMode === 'paper') {
      message = `Execute paper trade: BUY ${signal.symbol} with $100 USDC. ` +
        `Signal confidence: ${(signal.confidence * 100).toFixed(0)}%. ` +
        `Reasons: ${reasonsStr}. This is an automated research mode signal.`;
    } else {
      message = `Place market order: BUY ${signal.symbol} with $100 USDC. ` +
        `Confidence: ${(signal.confidence * 100).toFixed(0)}%. ` +
        `Reasons: ${reasonsStr}. Auto-execute research signal.`;
    }

    // Call Luna's trading chat to execute
    const result = await tradingChat.processMessage({
      sessionId,
      userId,
      message,
    });

    // Update signal status
    await updateSignalStatus(signal.id, 'executed');

    logger.info('Signal executed via Luna', {
      userId,
      signalId: signal.id,
      symbol: signal.symbol,
      mode: settings.paperLiveMode,
    });

    return { success: true, result: result.content };
  } catch (error) {
    const errorMessage = (error as Error).message;
    await updateSignalStatus(signal.id, 'failed', { errorMessage });

    logger.error('Failed to execute signal via Luna', {
      userId,
      signalId: signal.id,
      error: errorMessage,
    });

    return { success: false, result: errorMessage };
  }
}

/**
 * Execute a signal directly (for paper trades without Luna)
 */
export async function executeSignalDirect(
  userId: string,
  signal: ResearchSignal,
  settings: ResearchSettings
): Promise<{ success: boolean; tradeId?: string }> {
  try {
    // Get scalping settings for position sizing
    const scalpingSettings = await scalpingService.getSettings(userId);
    const positionSize = scalpingSettings?.maxPositionUsdt || 100;

    if (settings.paperLiveMode === 'paper') {
      // Execute paper trade
      const opportunity: scalpingService.ScalpingOpportunity = {
        userId,
        symbol: signal.symbol,
        currentPrice: signal.price,
        priceDropPct: signal.priceDropPct || 0,
        rsiValue: signal.rsi5m,
        volumeRatio: signal.volumeRatio,
        confidenceScore: signal.confidence,
        signalReasons: signal.reasons,
      };

      const paperTrade = await scalpingService.executePaperTrade(
        opportunity,
        scalpingSettings || {
          userId,
          enabled: true,
          mode: 'paper',
          maxPositionUsdt: positionSize,
          maxConcurrentPositions: 3,
          symbols: [signal.symbol],
          minDropPct: 1.5,
          maxDropPct: 10,
          rsiOversoldThreshold: 30,
          volumeSpikeMultiplier: 2,
          minConfidence: 0.5,
          takeProfitPct: 1,
          stopLossPct: 0.5,
          maxHoldMinutes: 30,
          minTradesForLearning: 10,
        }
      );

      await updateSignalStatus(signal.id, 'executed', { paperTradeId: paperTrade.id });
      return { success: true, tradeId: paperTrade.id };
    } else {
      // Execute live trade via trading service
      const trade = await tradingService.placeOrder(userId, {
        symbol: signal.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: positionSize,
        notes: `Research signal: ${signal.reasons.join(', ')}`,
      });

      await updateSignalStatus(signal.id, 'executed', { tradeId: trade.id });
      return { success: true, tradeId: trade.id };
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    await updateSignalStatus(signal.id, 'failed', { errorMessage });
    return { success: false };
  }
}

/**
 * Handle user confirmation on a signal (approve/skip)
 */
export async function handleConfirmation(
  userId: string,
  signalId: string,
  action: 'execute' | 'skip'
): Promise<{ success: boolean; result?: string }> {
  // Get the signal
  const result = await pool.query(
    `SELECT * FROM research_signals WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [signalId, userId]
  );

  if (result.rows.length === 0) {
    return { success: false, result: 'Signal not found or already processed' };
  }

  const row = result.rows[0];
  const signal: ResearchSignal = {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    price: parseFloat(row.price),
    rsi1m: row.rsi_1m ? parseFloat(row.rsi_1m) : undefined,
    rsi5m: row.rsi_5m ? parseFloat(row.rsi_5m) : undefined,
    priceDropPct: row.price_drop_pct ? parseFloat(row.price_drop_pct) : undefined,
    volumeRatio: row.volume_ratio ? parseFloat(row.volume_ratio) : undefined,
    confidence: parseFloat(row.confidence),
    reasons: row.reasons,
    status: row.status,
    executionMode: row.execution_mode,
    paperLiveMode: row.paper_live_mode,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };

  if (action === 'skip') {
    await updateSignalStatus(signalId, 'skipped');
    return { success: true, result: 'Signal skipped' };
  }

  // Execute the signal
  const settings = await getResearchSettings(userId);
  if (!settings) {
    return { success: false, result: 'Settings not found' };
  }

  return executeSignalDirect(userId, signal, settings);
}

/**
 * Manual execution of a signal by user
 */
export async function executeSignal(
  userId: string,
  signalId: string
): Promise<{ success: boolean; result?: string }> {
  return handleConfirmation(userId, signalId, 'execute');
}

// ============================================
// Expiration Management
// ============================================

/**
 * Expire old pending signals
 */
export async function expireOldSignals(): Promise<number> {
  const result = await pool.query(
    `UPDATE research_signals
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at < NOW()
     RETURNING id`
  );

  return result.rowCount || 0;
}

// ============================================
// Research Job Runner
// ============================================

/**
 * Main research job - scans for opportunities and handles execution
 */
export async function runResearchJob(): Promise<{
  usersProcessed: number;
  symbolsScanned: number;
  signalsCreated: number;
  autoExecuted: number;
  expired: number;
}> {
  const results = {
    usersProcessed: 0,
    symbolsScanned: 0,
    signalsCreated: 0,
    autoExecuted: 0,
    expired: 0,
  };

  try {
    // Get all users with research settings
    const usersResult = await pool.query(
      `SELECT user_id FROM research_settings`
    );

    for (const userRow of usersResult.rows) {
      const userId = userRow.user_id;
      const settings = await getResearchSettings(userId);
      if (!settings) continue;

      results.usersProcessed++;

      // Get symbols to scan
      const symbols = await getActiveSymbols(userId);
      results.symbolsScanned += symbols.length;

      // Analyze each symbol
      for (const symbol of symbols) {
        const analysis = await analyzeSymbol(symbol, settings.minConfidence, userId);
        if (!analysis) continue;

        // Create signal
        const signal = await createSignal(userId, analysis, settings);
        results.signalsCreated++;

        // Auto-execute if in auto mode
        if (settings.executionMode === 'auto') {
          const execResult = await executeSignalDirect(userId, signal, settings);
          if (execResult.success) {
            results.autoExecuted++;
          }
        }
      }
    }

    // Expire old signals
    results.expired = await expireOldSignals();

  } catch (error) {
    logger.error('Research job failed', { error: (error as Error).message });
  }

  if (results.signalsCreated > 0) {
    logger.info('Research job completed', results);
  }

  return results;
}

/**
 * Get research metrics/stats
 */
export async function getResearchMetrics(userId: string, days: number = 30): Promise<{
  totalSignals: number;
  executed: number;
  skipped: number;
  expired: number;
  successRate: number;
  avgConfidence: number;
}> {
  const result = await pool.query(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'executed') as executed,
      COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
      COUNT(*) FILTER (WHERE status = 'expired') as expired,
      AVG(confidence) as avg_confidence
    FROM research_signals
    WHERE user_id = $1 AND created_at > NOW() - INTERVAL '${days} days'`,
    [userId]
  );

  const row = result.rows[0];
  const total = parseInt(row.total) || 0;
  const executed = parseInt(row.executed) || 0;

  return {
    totalSignals: total,
    executed,
    skipped: parseInt(row.skipped) || 0,
    expired: parseInt(row.expired) || 0,
    successRate: total > 0 ? executed / total : 0,
    avgConfidence: parseFloat(row.avg_confidence) || 0,
  };
}

// Re-export indicator service functions
export {
  getIndicatorSettings,
  updateIndicatorSettings,
  applyIndicatorPreset,
  INDICATOR_PRESETS,
} from './indicators.service.js';

export default {
  getResearchSettings,
  updateResearchSettings,
  getTopVolumePairs,
  getActiveSymbols,
  calculateMultiTimeframeRSI,
  analyzeSymbol,
  createSignal,
  getSignals,
  executeSignalViaLuna,
  executeSignalDirect,
  handleConfirmation,
  executeSignal,
  expireOldSignals,
  runResearchJob,
  getResearchMetrics,
};
