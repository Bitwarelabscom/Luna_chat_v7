/**
 * Strategy Registry
 *
 * Manages all available trading strategies and provides factory methods.
 */

import { TradingStrategy, StrategyMeta, MarketRegime } from './strategy.interface.js';
import { rsiOversoldStrategy } from './rsi-oversold.strategy.js';
import { trendFollowingStrategy } from './trend-following.strategy.js';
import { meanReversionStrategy } from './mean-reversion.strategy.js';
import { momentumStrategy } from './momentum.strategy.js';
import { btcCorrelationStrategy } from './btc-correlation.strategy.js';

/**
 * Strategy IDs
 */
export type StrategyId =
  | 'rsi_oversold'
  | 'trend_following'
  | 'mean_reversion'
  | 'momentum'
  | 'btc_correlation';

/**
 * All available strategies
 */
const strategies = new Map<StrategyId, TradingStrategy>();
strategies.set('rsi_oversold', rsiOversoldStrategy);
strategies.set('trend_following', trendFollowingStrategy);
strategies.set('mean_reversion', meanReversionStrategy);
strategies.set('momentum', momentumStrategy);
strategies.set('btc_correlation', btcCorrelationStrategy);

/**
 * Get a strategy by ID
 */
export function getStrategy(id: StrategyId): TradingStrategy | undefined {
  return strategies.get(id);
}

/**
 * Get all registered strategies
 */
export function getAllStrategies(): TradingStrategy[] {
  return Array.from(strategies.values());
}

/**
 * Get all strategy IDs
 */
export function getStrategyIds(): StrategyId[] {
  return Array.from(strategies.keys());
}

/**
 * Get strategy metadata for all strategies
 */
export function getStrategyMetaList(): StrategyMeta[] {
  return getAllStrategies().map(s => s.meta);
}

/**
 * Get strategies suitable for a given market regime
 */
export function getStrategiesForRegime(regime: MarketRegime): TradingStrategy[] {
  return getAllStrategies().filter(s => s.meta.suitableRegimes.includes(regime));
}

/**
 * Get strategy IDs suitable for a given market regime
 */
export function getStrategyIdsForRegime(regime: MarketRegime): StrategyId[] {
  return getStrategiesForRegime(regime).map(s => s.meta.id as StrategyId);
}

/**
 * Check if a strategy ID is valid
 */
export function isValidStrategyId(id: string): id is StrategyId {
  return strategies.has(id as StrategyId);
}

/**
 * Get default strategy
 */
export function getDefaultStrategy(): TradingStrategy {
  return rsiOversoldStrategy;
}

/**
 * Get default strategy ID
 */
export function getDefaultStrategyId(): StrategyId {
  return 'rsi_oversold';
}

export {
  rsiOversoldStrategy,
  trendFollowingStrategy,
  meanReversionStrategy,
  momentumStrategy,
  btcCorrelationStrategy,
};
