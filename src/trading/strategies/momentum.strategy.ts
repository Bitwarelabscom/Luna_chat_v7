/**
 * Momentum Strategy
 *
 * Entry: Stochastic %K crosses above %D (both < 30) AND MACD histogram positive
 * Exit: Stochastic overbought (>80) or MACD reversal
 * Best for: Strong momentum moves
 * Regime fit: trending, mixed
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

export class MomentumStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'momentum',
    name: 'Momentum',
    description: 'Catch momentum shifts with Stochastic and MACD',
    suitableRegimes: ['trending', 'mixed'],
    requiredIndicators: ['stoch_k', 'stoch_d', 'macd_histogram', 'atr'],
  };

  // Strategy parameters
  private readonly STOCH_OVERSOLD = 30;
  private readonly SL_ATR_MULTIPLIER = 2;
  private readonly TP_ATR_MULTIPLIER = 3.5;

  hasRequiredData(indicators: Indicators): boolean {
    return (
      indicators.stoch_k !== undefined &&
      indicators.stoch_d !== undefined &&
      indicators.macd_histogram !== undefined &&
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

    const stochK = indicators.stoch_k!;
    const stochD = indicators.stoch_d!;
    const macdHistogram = indicators.macd_histogram!;
    const atr = indicators.atr || currentPrice * 0.02;

    const reasons: string[] = [];
    let confidence = 0;

    // Check Stochastic conditions
    // %K crossing above %D while both are in oversold territory
    const stochOversold = stochK < this.STOCH_OVERSOLD && stochD < this.STOCH_OVERSOLD;
    const stochBullishCross = stochK > stochD;

    if (stochOversold) {
      reasons.push(`Stochastic oversold (%K: ${stochK.toFixed(1)}, %D: ${stochD.toFixed(1)})`);
      confidence += 0.25;
    }

    if (stochBullishCross) {
      reasons.push('%K crossed above %D');
      confidence += 0.25;
    }

    // Check MACD histogram positive (momentum turning bullish)
    const macdPositive = macdHistogram > 0;
    if (macdPositive) {
      reasons.push(`MACD histogram positive (${macdHistogram.toFixed(4)})`);
      confidence += 0.3;

      // Extra confidence for strong MACD
      if (macdHistogram > 0.001) {
        reasons.push('Strong MACD momentum');
        confidence += 0.1;
      }
    }

    // Check MACD line trend (optional bonus)
    if (indicators.macd_line !== undefined && indicators.macd_signal !== undefined) {
      if (indicators.macd_line > indicators.macd_signal) {
        reasons.push('MACD line above signal');
        confidence += 0.1;
      }
    }

    // All primary conditions must be met
    const shouldTrade = stochOversold && stochBullishCross && macdPositive;

    if (!shouldTrade) {
      if (!stochOversold) {
        reasons.push(`Stochastic not oversold (%K: ${stochK.toFixed(1)})`);
      }
      if (!stochBullishCross) {
        reasons.push('%K below %D');
      }
      if (!macdPositive) {
        reasons.push(`MACD histogram negative (${macdHistogram.toFixed(4)})`);
      }
    }

    // Regime bonus
    if (shouldTrade && (context.regime === 'trending' || context.regime === 'mixed')) {
      confidence += 0.1;
      reasons.push(`Favorable regime: ${context.regime}`);
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
        stochK,
        stochD,
        macdHistogram,
      },
    };
  }
}

export const momentumStrategy = new MomentumStrategy();
