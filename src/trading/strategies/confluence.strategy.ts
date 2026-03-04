/**
 * Confluence Strategy (Conservative Tier)
 *
 * Entry: ALL THREE indicators must align:
 * - RSI: Between 30-45 (oversold but recovering)
 * - MACD: Bullish crossover (MACD line crosses above signal line)
 * - EMA: Uptrend alignment (price > EMA20 > EMA50)
 *
 * Best for: Conservative trading with high-confidence entries
 * Regime fit: trending, mixed
 */

import { Indicators } from '../redis-trading.service.js';
import {
  TradingStrategy,
  StrategyMeta,
  StrategySignal,
  MarketContext,
  calculateATRStopLoss,
} from './strategy.interface.js';

export class ConfluenceStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'confluence',
    name: 'Multi-Indicator Confluence',
    description: 'Conservative strategy requiring RSI + MACD + EMA alignment',
    suitableRegimes: ['trending', 'mixed'],
    requiredIndicators: ['rsi', 'macd_line', 'ema_20', 'ema_50', 'atr'],
  };

  // Strategy parameters
  private readonly RSI_MIN = 30;
  private readonly RSI_MAX = 45;
  private readonly SL_ATR_MULTIPLIER = 2.5;

  hasRequiredData(indicators: Indicators): boolean {
    return (
      indicators.rsi !== undefined &&
      indicators.macd_line !== undefined &&
      indicators.macd_signal !== undefined &&
      indicators.ema_20 !== undefined &&
      indicators.ema_50 !== undefined &&
      indicators.atr !== undefined
    );
  }

  evaluate(context: MarketContext): StrategySignal {
    const { indicators, currentPrice } = context;

    // Check required data
    if (!this.hasRequiredData(indicators)) {
      return {
        shouldTrade: false,
        direction: 'none',
        confidence: 0,
        reasons: ['Insufficient indicator data for confluence strategy'],
      };
    }

    const rsi = indicators.rsi!;
    const macdLine = indicators.macd_line!;
    const macdSignalLine = indicators.macd_signal!;
    const ema20 = indicators.ema_20!;
    const ema50 = indicators.ema_50!;
    const atr = indicators.atr || currentPrice * 0.02;

    // For crossover detection, check if MACD is above signal and histogram is positive
    const macdHistogram = indicators.macd_histogram ?? (macdLine - macdSignalLine);

    const reasons: string[] = [];
    let confidence = 0;

    // Signal 1: RSI in recovery zone (30-45)
    const rsiSignal = rsi >= this.RSI_MIN && rsi <= this.RSI_MAX;
    if (rsiSignal) {
      reasons.push(`RSI in recovery zone (${rsi.toFixed(1)})`);
      confidence += 0.3;

      // Extra confidence for ideal RSI range (35-40)
      if (rsi >= 35 && rsi <= 40) {
        reasons.push('RSI in ideal range');
        confidence += 0.05;
      }
    }

    // Signal 2: MACD bullish (line above signal, positive histogram indicates crossover)
    const macdBullish = macdLine > macdSignalLine;
    const macdMomentumStrong = macdHistogram > 0 && Math.abs(macdHistogram) > Math.abs(macdLine) * 0.1;
    const macdSignalOk = macdBullish;

    if (macdBullish && macdMomentumStrong) {
      reasons.push('MACD bullish with strong momentum');
      confidence += 0.35;
    } else if (macdBullish) {
      reasons.push('MACD bullish');
      confidence += 0.25;
    }

    // Signal 3: EMA alignment (price > EMA20 > EMA50 = uptrend)
    const emaSignal = currentPrice > ema20 && ema20 > ema50;
    if (emaSignal) {
      reasons.push('EMA trend aligned (price > EMA20 > EMA50)');
      confidence += 0.3;

      // Extra confidence if price is well above EMA20
      const priceAboveEma20Pct = ((currentPrice - ema20) / ema20) * 100;
      if (priceAboveEma20Pct > 1 && priceAboveEma20Pct < 3) {
        reasons.push('Price nicely above EMA20');
        confidence += 0.05;
      }
    }

    // ALL THREE signals must be true for a trade
    const shouldTrade = rsiSignal && macdSignalOk && emaSignal;

    if (!shouldTrade) {
      if (!rsiSignal) {
        reasons.push(`RSI not in range (${rsi.toFixed(1)}, need 30-45)`);
      }
      if (!macdSignalOk) {
        reasons.push('MACD not bullish');
      }
      if (!emaSignal) {
        if (currentPrice <= ema20) {
          reasons.push('Price below EMA20');
        } else if (ema20 <= ema50) {
          reasons.push('EMA20 below EMA50 (downtrend)');
        }
      }
    }

    // Regime bonus for trending markets
    if (shouldTrade && context.regime === 'trending') {
      confidence += 0.1;
      reasons.push('Favorable trending regime');
    }

    return {
      shouldTrade,
      direction: shouldTrade ? 'long' : 'none',
      confidence: Math.min(confidence, 1),
      reasons,
      suggestedStopLoss: shouldTrade
        ? calculateATRStopLoss(currentPrice, atr, this.SL_ATR_MULTIPLIER)
        : undefined,
      // No take profit - trailing stop only
      suggestedTakeProfit: undefined,
      metadata: {
        rsi,
        macdLine,
        macdSignalLine,
        macdHistogram,
        ema20,
        ema50,
        atr,
        rsiSignalOk: rsiSignal,
        macdSignalOk,
        emaSignalOk: emaSignal,
      },
    };
  }
}

export const confluenceStrategy = new ConfluenceStrategy();
