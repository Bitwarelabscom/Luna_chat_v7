/**
 * Triple Signal Strategy (Aggressive Tier)
 *
 * Entry: ALL THREE signals must align:
 * - Volume Spike: Current volume > 2x average volume
 * - RSI Extreme: RSI < 25 (deeply oversold) or > 75 with positive momentum
 * - Breakout: Price breaks above 20-period high (or below for shorts)
 *
 * Best for: Quick trades on meme coins, catching momentum moves
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

export class TripleSignalStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'triple_signal',
    name: 'Triple Signal',
    description: 'Aggressive strategy requiring volume spike + RSI extreme + breakout',
    suitableRegimes: ['trending', 'mixed'],
    requiredIndicators: ['rsi', 'volume_ratio', 'atr'],
  };

  // Strategy parameters
  private readonly VOLUME_SPIKE_THRESHOLD = 2.0;  // 2x average volume
  private readonly RSI_OVERSOLD = 25;
  private readonly RSI_OVERBOUGHT = 75;
  private readonly BREAKOUT_THRESHOLD = 1.005;    // 0.5% above high
  private readonly SL_ATR_MULTIPLIER = 1.5;       // Tighter stop for aggressive trades

  hasRequiredData(indicators: Indicators): boolean {
    return (
      indicators.rsi !== undefined &&
      indicators.volume_ratio !== undefined &&
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
        reasons: ['Insufficient indicator data for triple signal strategy'],
      };
    }

    const rsi = indicators.rsi!;
    const volumeRatio = indicators.volume_ratio!;
    const atr = indicators.atr || currentPrice * 0.03; // 3% fallback for volatile meme coins

    // For breakout detection, use Bollinger upper band as resistance proxy
    // If not available, estimate from current price + ATR
    const resistanceLevel = indicators.bollinger_upper ?? (currentPrice + atr * 1.5);

    // For momentum check, use RSI direction (comparing to middle)
    const hasPositiveMomentum = rsi > 50;

    const reasons: string[] = [];
    let confidence = 0;

    // Signal 1: Volume Spike (> 2x average)
    const volumeSignal = volumeRatio >= this.VOLUME_SPIKE_THRESHOLD;
    if (volumeSignal) {
      reasons.push(`Volume spike (${volumeRatio.toFixed(1)}x average)`);
      confidence += 0.3;

      // Extra confidence for massive volume
      if (volumeRatio >= 3.0) {
        reasons.push('Massive volume surge');
        confidence += 0.1;
      }
    }

    // Signal 2: RSI Extreme
    // Oversold bounce (< 25) OR overbought momentum (> 75 with positive momentum)
    const rsiOversold = rsi < this.RSI_OVERSOLD;
    const rsiOverboughtMomentum = rsi > this.RSI_OVERBOUGHT && hasPositiveMomentum;
    const rsiSignal = rsiOversold || rsiOverboughtMomentum;

    if (rsiOversold) {
      reasons.push(`Deeply oversold (RSI ${rsi.toFixed(1)})`);
      confidence += 0.3;

      // Extra confidence for extreme oversold
      if (rsi < 20) {
        reasons.push('Extreme oversold');
        confidence += 0.05;
      }
    } else if (rsiOverboughtMomentum) {
      reasons.push(`Overbought momentum (RSI ${rsi.toFixed(1)})`);
      confidence += 0.25;
    }

    // Signal 3: Price Breakout (above resistance level)
    const breakoutThreshold = resistanceLevel * this.BREAKOUT_THRESHOLD;
    const breakoutSignal = currentPrice > breakoutThreshold;

    if (breakoutSignal) {
      const breakoutPct = ((currentPrice - resistanceLevel) / resistanceLevel) * 100;
      reasons.push(`Breakout above resistance (+${breakoutPct.toFixed(2)}%)`);
      confidence += 0.3;

      // Extra confidence for strong breakout
      if (breakoutPct > 2) {
        reasons.push('Strong breakout');
        confidence += 0.1;
      }
    }

    // ALL THREE signals must be true for a trade
    const shouldTrade = volumeSignal && rsiSignal && breakoutSignal;

    if (!shouldTrade) {
      if (!volumeSignal) {
        reasons.push(`Volume insufficient (${volumeRatio.toFixed(1)}x, need ${this.VOLUME_SPIKE_THRESHOLD}x)`);
      }
      if (!rsiSignal) {
        reasons.push(`RSI not extreme (${rsi.toFixed(1)}, need <25 or >75)`);
      }
      if (!breakoutSignal) {
        const distanceToBreakout = ((breakoutThreshold - currentPrice) / currentPrice) * 100;
        reasons.push(`No breakout (${distanceToBreakout.toFixed(2)}% below threshold)`);
      }
    }

    // Regime bonus
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
        volumeRatio,
        resistanceLevel,
        breakoutThreshold,
        atr,
        volumeSignalOk: volumeSignal,
        rsiSignalOk: rsiSignal,
        rsiOversold,
        rsiOverboughtMomentum,
        breakoutSignalOk: breakoutSignal,
      },
    };
  }
}

export const tripleSignalStrategy = new TripleSignalStrategy();
