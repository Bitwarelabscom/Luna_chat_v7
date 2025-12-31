/**
 * Trading Strategies Module
 *
 * Exports all trading strategies and related utilities.
 */

// Interface and types
export {
  TradingStrategy,
  StrategyMeta,
  StrategySignal,
  MarketContext,
  MarketRegime,
  calculateATRStopLoss,
  calculateATRTakeProfit,
  detectRegimeFromADX,
} from './strategy.interface.js';

// Strategy implementations
export { RsiOversoldStrategy, rsiOversoldStrategy } from './rsi-oversold.strategy.js';
export { TrendFollowingStrategy, trendFollowingStrategy } from './trend-following.strategy.js';
export { MeanReversionStrategy, meanReversionStrategy } from './mean-reversion.strategy.js';
export { MomentumStrategy, momentumStrategy } from './momentum.strategy.js';
export { BtcCorrelationStrategy, btcCorrelationStrategy } from './btc-correlation.strategy.js';

// Registry
export {
  StrategyId,
  getStrategy,
  getAllStrategies,
  getStrategyIds,
  getStrategyMetaList,
  getStrategiesForRegime,
  getStrategyIdsForRegime,
  isValidStrategyId,
  getDefaultStrategy,
  getDefaultStrategyId,
} from './strategy-registry.js';
