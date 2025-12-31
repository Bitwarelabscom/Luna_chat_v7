/**
 * Strategy Interface
 *
 * Defines the contract for all trading strategies in the auto trading system.
 * Each strategy implements specific entry/exit logic for different market conditions.
 */

import { Indicators } from '../redis-trading.service.js';

/**
 * Market regime types based on ADX
 * - trending: ADX > 25 (strong directional movement)
 * - ranging: ADX < 20 (sideways/consolidation)
 * - mixed: ADX 20-25 (transitioning)
 */
export type MarketRegime = 'trending' | 'ranging' | 'mixed';

/**
 * Strategy signal result
 */
export interface StrategySignal {
  /** Whether a trade signal was generated */
  shouldTrade: boolean;
  /** Signal direction */
  direction: 'long' | 'short' | 'none';
  /** Confidence score 0-1 */
  confidence: number;
  /** Reasons for the signal */
  reasons: string[];
  /** Suggested stop loss price */
  suggestedStopLoss?: number;
  /** Suggested take profit price */
  suggestedTakeProfit?: number;
  /** Additional metadata */
  metadata?: Record<string, number | string | boolean>;
}

/**
 * Strategy metadata
 */
export interface StrategyMeta {
  /** Unique strategy identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Market regimes this strategy works best in */
  suitableRegimes: MarketRegime[];
  /** Minimum required indicators */
  requiredIndicators: (keyof Indicators)[];
}

/**
 * Market context passed to strategy evaluate
 */
export interface MarketContext {
  /** Symbol being evaluated */
  symbol: string;
  /** Current price */
  currentPrice: number;
  /** Technical indicators */
  indicators: Indicators;
  /** Current market regime */
  regime: MarketRegime;
  /** BTC indicators (for correlation strategies) */
  btcIndicators?: Indicators;
  /** BTC current price */
  btcPrice?: number;
}

/**
 * Strategy interface - all strategies must implement this
 */
export interface TradingStrategy {
  /** Strategy metadata */
  readonly meta: StrategyMeta;

  /**
   * Evaluate whether to enter a trade
   * @param context Market context with price and indicators
   * @returns Strategy signal with trade decision
   */
  evaluate(context: MarketContext): StrategySignal;

  /**
   * Check if strategy has minimum required data
   * @param indicators Available indicators
   * @returns true if all required indicators are present
   */
  hasRequiredData(indicators: Indicators): boolean;
}

/**
 * Calculate stop loss based on entry and ATR
 */
export function calculateATRStopLoss(
  entryPrice: number,
  atr: number,
  multiplier: number = 2
): number {
  return entryPrice - atr * multiplier;
}

/**
 * Calculate take profit based on entry and ATR
 */
export function calculateATRTakeProfit(
  entryPrice: number,
  atr: number,
  multiplier: number = 3
): number {
  return entryPrice + atr * multiplier;
}

/**
 * Detect market regime from ADX value
 */
export function detectRegimeFromADX(adx: number): MarketRegime {
  if (adx > 25) return 'trending';
  if (adx < 20) return 'ranging';
  return 'mixed';
}
