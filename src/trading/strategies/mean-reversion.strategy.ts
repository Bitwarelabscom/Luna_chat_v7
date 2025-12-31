/**
 * Mean Reversion Strategy
 *
 * Entry: Price < Lower Bollinger Band AND ADX < 20 (confirming range)
 * Exit: Price returns to middle band
 * Best for: Sideways/consolidation markets
 * Regime fit: ranging
 */

import { Indicators } from '../redis-trading.service.js';
import {
  TradingStrategy,
  StrategyMeta,
  StrategySignal,
  MarketContext,
  calculateATRStopLoss,
} from './strategy.interface.js';

export class MeanReversionStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Buy at Bollinger lower band in ranging markets',
    suitableRegimes: ['ranging'],
    requiredIndicators: ['bollinger_lower', 'bollinger_middle', 'adx', 'atr'],
  };

  // Strategy parameters
  private readonly ADX_THRESHOLD = 20; // Must be below this (ranging market)
  private readonly SL_ATR_MULTIPLIER = 2;

  hasRequiredData(indicators: Indicators): boolean {
    return (
      indicators.bollinger_lower !== undefined &&
      indicators.bollinger_middle !== undefined &&
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

    const lowerBand = indicators.bollinger_lower!;
    const middleBand = indicators.bollinger_middle!;
    const adx = indicators.adx!;
    const atr = indicators.atr || currentPrice * 0.02;

    const reasons: string[] = [];
    let confidence = 0;

    // Check if price is at or below lower Bollinger Band
    const atLowerBand = currentPrice <= lowerBand;
    const nearLowerBand = currentPrice <= lowerBand * 1.005; // Within 0.5%

    if (atLowerBand) {
      reasons.push(`Price at lower BB (${currentPrice.toFixed(2)} <= ${lowerBand.toFixed(2)})`);
      confidence += 0.4;
    } else if (nearLowerBand) {
      reasons.push(`Price near lower BB`);
      confidence += 0.25;
    }

    // Check ADX confirms ranging market
    const isRanging = adx < this.ADX_THRESHOLD;
    if (isRanging) {
      reasons.push(`Ranging market (ADX: ${adx.toFixed(1)})`);
      confidence += 0.3;

      // Extra confidence for very low ADX
      if (adx < 15) {
        reasons.push('Strong range-bound behavior');
        confidence += 0.1;
      }
    }

    // Check RSI for oversold confirmation (optional bonus)
    if (indicators.rsi !== undefined && indicators.rsi < 35) {
      reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`);
      confidence += 0.1;
    }

    // All conditions must be met
    const shouldTrade = (atLowerBand || nearLowerBand) && isRanging;

    if (!shouldTrade) {
      if (!atLowerBand && !nearLowerBand) {
        const percentToLower = ((currentPrice - lowerBand) / lowerBand * 100).toFixed(1);
        reasons.push(`Price ${percentToLower}% above lower BB`);
      }
      if (!isRanging) {
        reasons.push(`Market trending (ADX: ${adx.toFixed(1)})`);
      }
    }

    // Regime bonus
    if (shouldTrade && context.regime === 'ranging') {
      confidence += 0.1;
      reasons.push('Favorable regime: ranging');
    }

    // Take profit target is the middle band
    const takeProfit = middleBand;

    return {
      shouldTrade,
      direction: shouldTrade ? 'long' : 'none',
      confidence: Math.min(confidence, 1),
      reasons,
      suggestedStopLoss: shouldTrade
        ? calculateATRStopLoss(currentPrice, atr, this.SL_ATR_MULTIPLIER)
        : undefined,
      suggestedTakeProfit: shouldTrade ? takeProfit : undefined,
      metadata: {
        lowerBand,
        middleBand,
        adx,
        priceToLowerBandPct: ((currentPrice - lowerBand) / lowerBand * 100),
      },
    };
  }
}

export const meanReversionStrategy = new MeanReversionStrategy();
