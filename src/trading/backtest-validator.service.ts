/**
 * Bot Parameter Backtest Validator
 *
 * Validates bot configurations against historical indicator data
 * to estimate potential signal frequency and effectiveness.
 */

import * as redisTradingService from './redis-trading.service.js';
import { calculateRSI, calculateEMA, calculateSMA } from './indicators.service.js';
import logger from '../utils/logger.js';
import type { Timeframe } from './redis-trading.service.js';

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  suggestions: string[];
  metrics: {
    estimatedSignalsPerDay?: number;
    volatilityRatio?: number;
    parameterScore?: number;
  };
}

/**
 * Validate RSI bot parameters
 */
export async function validateRSIBot(
  symbol: string,
  oversoldThreshold: number,
  overboughtThreshold: number,
  interval: string = '15m'
): Promise<ValidationResult> {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const metrics: ValidationResult['metrics'] = {};

  try {
    // Get historical candles
    const timeframe = interval as Timeframe;
    const candles = await redisTradingService.getCandles(symbol, timeframe, 200);

    if (candles.length < 50) {
      return {
        valid: false,
        warnings: ['Insufficient historical data for validation'],
        suggestions: ['Wait for more data to accumulate'],
        metrics,
      };
    }

    const closes = candles.map(c => c.close);

    // Calculate historical RSI distribution
    const rsiValues: number[] = [];
    for (let i = 14; i < closes.length; i++) {
      const slice = closes.slice(0, i + 1);
      rsiValues.push(calculateRSI(slice, 14));
    }

    // Count how often RSI would trigger
    let oversoldHits = 0;
    let overboughtHits = 0;
    for (const r of rsiValues) {
      if (r <= oversoldThreshold) oversoldHits++;
      if (r >= overboughtThreshold) overboughtHits++;
    }

    const oversoldPct = (oversoldHits / rsiValues.length) * 100;
    const overboughtPct = (overboughtHits / rsiValues.length) * 100;

    // Validate thresholds
    if (oversoldThreshold < 20) {
      warnings.push(`Oversold threshold ${oversoldThreshold} is very low - may rarely trigger`);
      suggestions.push('Consider raising oversold threshold to 25-30');
    }
    if (oversoldThreshold > 40) {
      warnings.push(`Oversold threshold ${oversoldThreshold} is high - may trigger too often`);
      suggestions.push('Consider lowering oversold threshold to 25-35');
    }
    if (overboughtThreshold > 85) {
      warnings.push(`Overbought threshold ${overboughtThreshold} is very high - may rarely trigger`);
      suggestions.push('Consider lowering overbought threshold to 70-75');
    }
    if (overboughtThreshold < 60) {
      warnings.push(`Overbought threshold ${overboughtThreshold} is low - may trigger too often`);
      suggestions.push('Consider raising overbought threshold to 65-75');
    }

    // Calculate estimated signals per day
    const candlesPerDay = {
      '1m': 1440,
      '5m': 288,
      '15m': 96,
      '1h': 24,
      '4h': 6,
      '1d': 1,
    }[timeframe] || 96;

    const signalRate = (oversoldPct + overboughtPct) / 100;
    metrics.estimatedSignalsPerDay = Math.round(signalRate * candlesPerDay * 10) / 10;

    if (metrics.estimatedSignalsPerDay > 10) {
      warnings.push(`High signal frequency (${metrics.estimatedSignalsPerDay}/day) - may overtrade`);
      suggestions.push('Consider widening the RSI thresholds or using longer cooldown');
    }
    if (metrics.estimatedSignalsPerDay < 0.5) {
      warnings.push(`Low signal frequency (${metrics.estimatedSignalsPerDay}/day) - may undertrade`);
      suggestions.push('Consider narrowing the RSI thresholds');
    }

    // Parameter score (0-100)
    let score = 100;
    if (oversoldThreshold < 20 || oversoldThreshold > 40) score -= 20;
    if (overboughtThreshold < 60 || overboughtThreshold > 85) score -= 20;
    if (metrics.estimatedSignalsPerDay > 15 || metrics.estimatedSignalsPerDay < 0.2) score -= 30;
    metrics.parameterScore = Math.max(0, score);

    logger.info('RSI bot validation complete', {
      symbol,
      oversoldThreshold,
      overboughtThreshold,
      oversoldPct: oversoldPct.toFixed(1),
      overboughtPct: overboughtPct.toFixed(1),
      score: metrics.parameterScore,
    });

    return {
      valid: warnings.length === 0,
      warnings,
      suggestions,
      metrics,
    };
  } catch (error) {
    logger.error('RSI bot validation failed', { error: (error as Error).message });
    return {
      valid: false,
      warnings: ['Validation failed: ' + (error as Error).message],
      suggestions: [],
      metrics,
    };
  }
}

/**
 * Validate Grid bot parameters
 */
export async function validateGridBot(
  symbol: string,
  upperPrice: number,
  lowerPrice: number,
  gridCount: number
): Promise<ValidationResult> {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const metrics: ValidationResult['metrics'] = {};

  try {
    // Get current price and ATR
    const priceData = await redisTradingService.getPrice(symbol);
    const indicators = await redisTradingService.getIndicators(symbol, '1h');

    if (!priceData) {
      return {
        valid: false,
        warnings: ['Cannot get current price for symbol'],
        suggestions: [],
        metrics,
      };
    }

    const currentPrice = priceData.price;
    const atr = indicators?.atr || 0;

    // Basic validations
    if (currentPrice < lowerPrice || currentPrice > upperPrice) {
      warnings.push(`Current price $${currentPrice.toFixed(2)} is outside grid range`);
      suggestions.push('Adjust grid range to include current price');
    }

    const gridRange = upperPrice - lowerPrice;
    const gridSpacing = gridRange / gridCount;
    const gridSpacingPct = (gridSpacing / currentPrice) * 100;

    // Compare grid spacing to ATR
    if (atr > 0) {
      const atrPct = (atr / currentPrice) * 100;
      metrics.volatilityRatio = gridSpacingPct / atrPct;

      if (metrics.volatilityRatio < 0.5) {
        warnings.push('Grid spacing is much smaller than typical volatility');
        suggestions.push('Consider widening grid spacing or reducing grid count');
      }
      if (metrics.volatilityRatio > 3) {
        warnings.push('Grid spacing is much larger than typical volatility');
        suggestions.push('Consider tightening grid or increasing grid count');
      }
    }

    // Grid count validation
    if (gridCount < 3) {
      warnings.push('Too few grids - limited profit opportunities');
      suggestions.push('Consider using at least 5-10 grids');
    }
    if (gridCount > 50) {
      warnings.push('Too many grids - may result in many small trades with high fees');
      suggestions.push('Consider reducing to 10-30 grids');
    }

    // Grid range validation
    const rangePct = (gridRange / currentPrice) * 100;
    if (rangePct < 5) {
      warnings.push(`Grid range (${rangePct.toFixed(1)}%) is very narrow`);
      suggestions.push('Consider widening the range for more opportunities');
    }
    if (rangePct > 50) {
      warnings.push(`Grid range (${rangePct.toFixed(1)}%) is very wide`);
      suggestions.push('Wide ranges may result in capital being idle');
    }

    // Parameter score
    let score = 100;
    if (currentPrice < lowerPrice || currentPrice > upperPrice) score -= 30;
    if (gridCount < 3 || gridCount > 50) score -= 20;
    if (rangePct < 5 || rangePct > 50) score -= 20;
    if (metrics.volatilityRatio && (metrics.volatilityRatio < 0.5 || metrics.volatilityRatio > 3)) score -= 15;
    metrics.parameterScore = Math.max(0, score);

    logger.info('Grid bot validation complete', {
      symbol,
      currentPrice,
      upperPrice,
      lowerPrice,
      gridCount,
      gridSpacingPct: gridSpacingPct.toFixed(2),
      score: metrics.parameterScore,
    });

    return {
      valid: warnings.length === 0,
      warnings,
      suggestions,
      metrics,
    };
  } catch (error) {
    logger.error('Grid bot validation failed', { error: (error as Error).message });
    return {
      valid: false,
      warnings: ['Validation failed: ' + (error as Error).message],
      suggestions: [],
      metrics,
    };
  }
}

/**
 * Validate MA Crossover bot parameters
 */
export async function validateMACrossBot(
  symbol: string,
  fastPeriod: number,
  slowPeriod: number,
  maType: 'sma' | 'ema' = 'ema',
  interval: string = '1h'
): Promise<ValidationResult> {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const metrics: ValidationResult['metrics'] = {};

  try {
    // Get historical candles
    const timeframe = interval as Timeframe;
    const candles = await redisTradingService.getCandles(symbol, timeframe, 200);

    if (candles.length < slowPeriod + 20) {
      return {
        valid: false,
        warnings: ['Insufficient historical data for validation'],
        suggestions: [`Need at least ${slowPeriod + 20} candles for ${slowPeriod}-period MA`],
        metrics,
      };
    }

    const closes = candles.map(c => c.close);

    // Validate period relationships
    if (fastPeriod >= slowPeriod) {
      warnings.push('Fast period must be less than slow period');
      suggestions.push('Swap fast and slow periods');
      return { valid: false, warnings, suggestions, metrics };
    }

    const periodRatio = slowPeriod / fastPeriod;
    if (periodRatio < 2) {
      warnings.push('Fast and slow periods are too close together');
      suggestions.push('Consider using a ratio of at least 2:1 (e.g., 9/21 or 20/50)');
    }
    if (periodRatio > 10) {
      warnings.push('Fast and slow periods are very far apart');
      suggestions.push('May result in very delayed signals');
    }

    // Count crossovers in historical data
    const calculateMA = maType === 'ema' ? calculateEMA : calculateSMA;
    let crossovers = 0;
    let prevFast = 0;
    let prevSlow = 0;

    for (let i = slowPeriod; i < closes.length; i++) {
      const slice = closes.slice(0, i + 1);
      const fastMA = calculateMA(slice, fastPeriod);
      const slowMA = calculateMA(slice, slowPeriod);

      if (i > slowPeriod) {
        const wasAbove = prevFast > prevSlow;
        const isAbove = fastMA > slowMA;
        if (wasAbove !== isAbove) crossovers++;
      }

      prevFast = fastMA;
      prevSlow = slowMA;
    }

    // Estimate crossovers per day
    const periodsChecked = closes.length - slowPeriod;
    const crossoverRate = crossovers / periodsChecked;
    const candlesPerDay = {
      '1m': 1440,
      '5m': 288,
      '15m': 96,
      '1h': 24,
      '4h': 6,
      '1d': 1,
    }[timeframe] || 24;

    metrics.estimatedSignalsPerDay = Math.round(crossoverRate * candlesPerDay * 100) / 100;

    if (metrics.estimatedSignalsPerDay > 5) {
      warnings.push(`High crossover frequency (${metrics.estimatedSignalsPerDay}/day)`);
      suggestions.push('Consider using longer periods for fewer signals');
    }
    if (metrics.estimatedSignalsPerDay < 0.1) {
      warnings.push(`Very low crossover frequency (${metrics.estimatedSignalsPerDay}/day)`);
      suggestions.push('Consider using shorter periods for more signals');
    }

    // Parameter score
    let score = 100;
    if (periodRatio < 2 || periodRatio > 10) score -= 25;
    if (metrics.estimatedSignalsPerDay > 5 || metrics.estimatedSignalsPerDay < 0.1) score -= 25;
    metrics.parameterScore = Math.max(0, score);

    logger.info('MA Cross bot validation complete', {
      symbol,
      fastPeriod,
      slowPeriod,
      maType,
      crossovers,
      estimatedSignalsPerDay: metrics.estimatedSignalsPerDay,
      score: metrics.parameterScore,
    });

    return {
      valid: warnings.length === 0,
      warnings,
      suggestions,
      metrics,
    };
  } catch (error) {
    logger.error('MA Cross bot validation failed', { error: (error as Error).message });
    return {
      valid: false,
      warnings: ['Validation failed: ' + (error as Error).message],
      suggestions: [],
      metrics,
    };
  }
}

/**
 * Validate any bot configuration
 */
export async function validateBotConfig(
  botType: string,
  symbol: string,
  config: Record<string, unknown>
): Promise<ValidationResult> {
  switch (botType) {
    case 'rsi':
      return validateRSIBot(
        symbol,
        config.oversoldThreshold as number || 30,
        config.overboughtThreshold as number || 70,
        config.interval as string || '15m'
      );

    case 'grid':
      return validateGridBot(
        symbol,
        config.upperPrice as number,
        config.lowerPrice as number,
        config.gridCount as number
      );

    case 'ma_crossover':
      return validateMACrossBot(
        symbol,
        config.fastPeriod as number || 9,
        config.slowPeriod as number || 21,
        config.maType as 'sma' | 'ema' || 'ema',
        config.interval as string || '1h'
      );

    default:
      return {
        valid: true,
        warnings: [`No specific validation for bot type: ${botType}`],
        suggestions: [],
        metrics: {},
      };
  }
}

export default {
  validateRSIBot,
  validateGridBot,
  validateMACrossBot,
  validateBotConfig,
};
