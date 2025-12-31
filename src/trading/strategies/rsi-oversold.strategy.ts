/**
 * RSI Oversold Strategy
 *
 * Entry: RSI < 30 AND Volume >= 1.5x average
 * Best for: Ranging markets, catching oversold bounces
 * Regime fit: ranging, mixed
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

export class RsiOversoldStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'rsi_oversold',
    name: 'RSI Oversold',
    description: 'Buy oversold bounces with volume confirmation',
    suitableRegimes: ['ranging', 'mixed'],
    requiredIndicators: ['rsi', 'volume_ratio', 'atr'],
  };

  // Strategy parameters - relaxed for more signals
  private readonly RSI_THRESHOLD = 35;      // Was 30, now triggers at RSI < 35
  private readonly VOLUME_THRESHOLD = 1.0;  // Was 1.5, now triggers at average volume
  private readonly SL_ATR_MULTIPLIER = 2;
  private readonly TP_ATR_MULTIPLIER = 3;

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
        reasons: ['Insufficient indicator data'],
      };
    }

    const rsi = indicators.rsi!;
    const volumeRatio = indicators.volume_ratio!;
    const atr = indicators.atr || currentPrice * 0.02; // Fallback 2%

    const reasons: string[] = [];
    let confidence = 0;

    // Check RSI oversold
    const rsiOversold = rsi < this.RSI_THRESHOLD;
    if (rsiOversold) {
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
      confidence += 0.4;

      // Extra confidence for deeply oversold
      if (rsi < 25) {
        reasons.push('Deeply oversold');
        confidence += 0.1;
      }
    }

    // Check volume confirmation
    const volumeConfirmed = volumeRatio >= this.VOLUME_THRESHOLD;
    if (volumeConfirmed) {
      reasons.push(`Volume ${volumeRatio.toFixed(1)}x average`);
      confidence += 0.3;

      // Extra confidence for high volume
      if (volumeRatio >= 2.0) {
        reasons.push('High volume spike');
        confidence += 0.1;
      }
    }

    // Check if both conditions are met
    const shouldTrade = rsiOversold && volumeConfirmed;

    if (!shouldTrade) {
      if (!rsiOversold) {
        reasons.push(`RSI not oversold (${rsi.toFixed(1)})`);
      }
      if (!volumeConfirmed) {
        reasons.push(`Volume insufficient (${volumeRatio.toFixed(1)}x)`);
      }
    }

    // Regime bonus
    if (shouldTrade && (context.regime === 'ranging' || context.regime === 'mixed')) {
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
        rsi,
        volumeRatio,
        atr,
      },
    };
  }
}

export const rsiOversoldStrategy = new RsiOversoldStrategy();
