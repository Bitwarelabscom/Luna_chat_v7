/**
 * RSI Overbought Short Strategy
 *
 * Entry: RSI > 70 AND Volume >= 1.5x average (short position)
 * Best for: Ranging markets, catching overbought reversals
 * Regime fit: ranging, mixed
 *
 * This strategy opens SHORT positions when price is overbought,
 * expecting a reversal/pullback.
 */

import { Indicators } from '../redis-trading.service.js';
import {
  TradingStrategy,
  StrategyMeta,
  StrategySignal,
  MarketContext,
} from './strategy.interface.js';

export class RsiOverboughtShortStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'rsi_overbought_short',
    name: 'RSI Overbought Short',
    description: 'Short overbought reversals with volume confirmation',
    suitableRegimes: ['ranging', 'mixed'],
    requiredIndicators: ['rsi', 'volume_ratio', 'atr'],
  };

  // Strategy parameters
  private readonly RSI_THRESHOLD = 70;        // Overbought threshold
  private readonly RSI_EXTREME = 80;          // Extremely overbought
  private readonly VOLUME_THRESHOLD = 1.5;    // Volume confirmation
  private readonly SL_ATR_MULTIPLIER = 2;     // Stop loss above entry
  private readonly TP_ATR_MULTIPLIER = 3;     // Take profit below entry

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

    // Check RSI overbought
    const rsiOverbought = rsi > this.RSI_THRESHOLD;
    if (rsiOverbought) {
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
      confidence += 0.4;

      // Extra confidence for extremely overbought
      if (rsi > this.RSI_EXTREME) {
        reasons.push('Extremely overbought');
        confidence += 0.15;
      }
    }

    // Check volume confirmation
    const volumeConfirmed = volumeRatio >= this.VOLUME_THRESHOLD;
    if (volumeConfirmed) {
      reasons.push(`Volume ${volumeRatio.toFixed(1)}x average`);
      confidence += 0.3;

      // Extra confidence for high volume
      if (volumeRatio >= 2.5) {
        reasons.push('High volume spike');
        confidence += 0.1;
      }
    }

    // Check if both conditions are met
    const shouldTrade = rsiOverbought && volumeConfirmed;

    if (!shouldTrade) {
      if (!rsiOverbought) {
        reasons.push(`RSI not overbought (${rsi.toFixed(1)})`);
      }
      if (!volumeConfirmed) {
        reasons.push(`Volume insufficient (${volumeRatio.toFixed(1)}x)`);
      }
    }

    // Regime bonus - shorts work better in ranging markets
    if (shouldTrade && context.regime === 'ranging') {
      confidence += 0.1;
      reasons.push('Favorable regime: ranging');
    }

    // For shorts: SL is ABOVE entry (price going up = loss)
    // TP is BELOW entry (price going down = profit)
    const suggestedStopLoss = shouldTrade
      ? currentPrice + (atr * this.SL_ATR_MULTIPLIER)  // SL above for short
      : undefined;
    const suggestedTakeProfit = shouldTrade
      ? currentPrice - (atr * this.TP_ATR_MULTIPLIER)  // TP below for short
      : undefined;

    return {
      shouldTrade,
      direction: shouldTrade ? 'short' : 'none',
      confidence: Math.min(confidence, 1),
      reasons,
      suggestedStopLoss,
      suggestedTakeProfit,
      metadata: {
        rsi,
        volumeRatio,
        atr,
      },
    };
  }
}

export const rsiOverboughtShortStrategy = new RsiOverboughtShortStrategy();
