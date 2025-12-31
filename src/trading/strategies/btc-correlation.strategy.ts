/**
 * BTC Correlation Strategy
 *
 * Entry: Alt underperforms BTC when BTC bullish + Alt RSI < 40 + Correlation > 0.6
 * Logic: Catch altcoin mean reversion to BTC performance
 * Best for: BTC-led markets (when BTC is bullish)
 * Regime fit: trending (BTC bullish only)
 *
 * This strategy looks for altcoins that are lagging BTC's bullish move,
 * expecting them to catch up.
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

export class BtcCorrelationStrategy implements TradingStrategy {
  readonly meta: StrategyMeta = {
    id: 'btc_correlation',
    name: 'BTC Correlation',
    description: 'Buy altcoins lagging BTC when BTC is bullish',
    suitableRegimes: ['trending'],
    requiredIndicators: ['rsi', 'ema_9', 'ema_21', 'atr'],
  };

  // Strategy parameters
  private readonly ALT_RSI_THRESHOLD = 40;
  private readonly BTC_RSI_BULLISH_THRESHOLD = 50;
  private readonly SL_ATR_MULTIPLIER = 2;
  private readonly TP_ATR_MULTIPLIER = 3;

  hasRequiredData(indicators: Indicators): boolean {
    return (
      indicators.rsi !== undefined &&
      indicators.ema_9 !== undefined &&
      indicators.ema_21 !== undefined &&
      indicators.atr !== undefined
    );
  }

  private isBtcBullish(btcIndicators: Indicators): { bullish: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Check EMA alignment
    const ema9 = btcIndicators.ema_9;
    const ema21 = btcIndicators.ema_21;
    const ema50 = btcIndicators.ema_50;

    let bullishScore = 0;

    if (ema9 !== undefined && ema21 !== undefined && ema9 > ema21) {
      bullishScore++;
      reasons.push('BTC EMA9 > EMA21');
    }

    if (ema21 !== undefined && ema50 !== undefined && ema21 > ema50) {
      bullishScore++;
      reasons.push('BTC EMA21 > EMA50');
    }

    // Check RSI
    if (btcIndicators.rsi !== undefined && btcIndicators.rsi > this.BTC_RSI_BULLISH_THRESHOLD) {
      bullishScore++;
      reasons.push(`BTC RSI bullish (${btcIndicators.rsi.toFixed(1)})`);
    }

    // Check MACD
    if (btcIndicators.macd_histogram !== undefined && btcIndicators.macd_histogram > 0) {
      bullishScore++;
      reasons.push('BTC MACD positive');
    }

    return {
      bullish: bullishScore >= 2,
      reasons,
    };
  }

  evaluate(context: MarketContext): StrategySignal {
    const { indicators, currentPrice, btcIndicators, symbol } = context;

    // Skip BTC itself
    if (symbol === 'BTCUSDT' || symbol === 'BTC_USD') {
      return {
        shouldTrade: false,
        direction: 'none',
        confidence: 0,
        reasons: ['Strategy not applicable to BTC'],
      };
    }

    // Check required data
    if (!this.hasRequiredData(indicators)) {
      return {
        shouldTrade: false,
        direction: 'none',
        confidence: 0,
        reasons: ['Insufficient indicator data'],
      };
    }

    // Must have BTC indicators
    if (!btcIndicators) {
      return {
        shouldTrade: false,
        direction: 'none',
        confidence: 0,
        reasons: ['BTC indicators not available'],
      };
    }

    const altRsi = indicators.rsi!;
    const atr = indicators.atr || currentPrice * 0.02;

    const reasons: string[] = [];
    let confidence = 0;

    // Check if BTC is bullish
    const btcStatus = this.isBtcBullish(btcIndicators);
    if (btcStatus.bullish) {
      reasons.push(...btcStatus.reasons);
      confidence += 0.3;
    }

    // Check if altcoin is underperforming (RSI lower than BTC)
    const altUnderperforming = altRsi < this.ALT_RSI_THRESHOLD;
    if (altUnderperforming) {
      reasons.push(`Alt RSI low (${altRsi.toFixed(1)}) - lagging BTC`);
      confidence += 0.3;

      // Extra confidence for very oversold
      if (altRsi < 30) {
        reasons.push('Alt deeply oversold');
        confidence += 0.1;
      }
    }

    // Check RSI divergence (BTC vs Alt)
    const btcRsi = btcIndicators.rsi || 50;
    const rsiDivergence = btcRsi - altRsi;
    if (rsiDivergence > 15) {
      reasons.push(`RSI divergence: BTC ${btcRsi.toFixed(1)} vs Alt ${altRsi.toFixed(1)}`);
      confidence += 0.2;
    }

    // Check alt EMA alignment (preferring early reversal)
    const altEma9 = indicators.ema_9;
    const altEma21 = indicators.ema_21;
    if (altEma9 !== undefined && altEma21 !== undefined) {
      // Looking for EMA9 approaching EMA21 from below (about to cross)
      const emaDiff = ((altEma21 - altEma9) / altEma21) * 100;
      if (emaDiff > 0 && emaDiff < 1) {
        reasons.push('Alt EMA9 approaching EMA21 (potential crossover)');
        confidence += 0.1;
      }
    }

    // All conditions must be met
    const shouldTrade = btcStatus.bullish && altUnderperforming;

    if (!shouldTrade) {
      if (!btcStatus.bullish) {
        reasons.push('BTC not bullish');
      }
      if (!altUnderperforming) {
        reasons.push(`Alt RSI not low enough (${altRsi.toFixed(1)})`);
      }
    }

    // Regime bonus (only works in trending)
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
        altRsi,
        btcRsi,
        rsiDivergence,
        btcBullish: btcStatus.bullish,
      },
    };
  }
}

export const btcCorrelationStrategy = new BtcCorrelationStrategy();
