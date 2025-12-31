/**
 * Trend Following Strategy
 *
 * Entry: EMA20 > EMA50 (bullish) AND ADX > 25 AND price > EMA20
 * Exit: EMA20 < EMA50 or ADX < 20
 * Best for: Strong trending markets
 * Regime fit: trending
 */

import { Indicators } from '../redis-trading.service.js';
import {
  TradingStrategy,
  StrategyMeta,
  StrategySignal,
  MarketContext,
  calculateATRStopLoss,
  calculateATRTakeProfit,
} from './strategy.interface.js';

export class TrendFollowingStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'trend_following',
    name: 'Trend Following',
    description: 'Follow EMA trends with ADX confirmation',
    suitableRegimes: ['trending'],
    requiredIndicators: ['ema_20', 'ema_50', 'adx', 'atr'],
  };

  // Strategy parameters
  private readonly ADX_THRESHOLD = 25;
  private readonly SL_ATR_MULTIPLIER = 2.5;
  private readonly TP_ATR_MULTIPLIER = 4;

  hasRequiredData(indicators: Indicators): boolean {
    return (
      indicators.ema_20 !== undefined &&
      indicators.ema_50 !== undefined &&
      indicators.adx !== undefined &&
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
        reasons: ['Insufficient indicator data'],
      };
    }

    const ema20 = indicators.ema_20!;
    const ema50 = indicators.ema_50!;
    const adx = indicators.adx!;
    const plusDI = indicators.plus_di || 50;
    const minusDI = indicators.minus_di || 50;
    const atr = indicators.atr || currentPrice * 0.02;

    const reasons: string[] = [];
    let confidence = 0;

    // Check EMA alignment (bullish trend)
    const emaBullish = ema20 > ema50;
    if (emaBullish) {
      reasons.push('EMA20 above EMA50 (bullish)');
      confidence += 0.3;
    }

    // Check ADX for trend strength
    const strongTrend = adx > this.ADX_THRESHOLD;
    if (strongTrend) {
      reasons.push(`Strong trend (ADX: ${adx.toFixed(1)})`);
      confidence += 0.3;

      // Extra confidence for very strong trend
      if (adx > 35) {
        reasons.push('Very strong trend');
        confidence += 0.1;
      }
    }

    // Check price above EMA20 (not overextended)
    const priceAboveEma = currentPrice > ema20;
    if (priceAboveEma && emaBullish) {
      reasons.push('Price above EMA20');
      confidence += 0.2;
    }

    // Check directional indicators (+DI > -DI for bullish)
    const bullishDI = plusDI > minusDI;
    if (bullishDI) {
      reasons.push(`Bullish DI (+DI: ${plusDI.toFixed(1)} > -DI: ${minusDI.toFixed(1)})`);
      confidence += 0.1;
    }

    // All conditions must be met
    const shouldTrade = emaBullish && strongTrend && priceAboveEma && bullishDI;

    if (!shouldTrade) {
      if (!emaBullish) reasons.push('EMA alignment bearish');
      if (!strongTrend) reasons.push(`Weak trend (ADX: ${adx.toFixed(1)})`);
      if (!priceAboveEma) reasons.push('Price below EMA20');
      if (!bullishDI) reasons.push('Bearish directional movement');
    }

    // Regime bonus
    if (shouldTrade && context.regime === 'trending') {
      confidence += 0.1;
      reasons.push('Favorable regime: trending');
    }

    return {
      shouldTrade,
      direction: shouldTrade ? 'long' : 'none',
      confidence: Math.min(confidence, 1),
      reasons,
      suggestedStopLoss: shouldTrade
        ? calculateATRStopLoss(currentPrice, atr, this.SL_ATR_MULTIPLIER)
        : undefined,
      suggestedTakeProfit: shouldTrade
        ? calculateATRTakeProfit(currentPrice, atr, this.TP_ATR_MULTIPLIER)
        : undefined,
      metadata: {
        ema20,
        ema50,
        adx,
        plusDI,
        minusDI,
      },
    };
  }
}

export const trendFollowingStrategy = new TrendFollowingStrategy();
