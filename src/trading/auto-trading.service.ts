/**
 * Auto Trading Service
 *
 * Automated trading based on RSI + Volume signals with risk safeguards.
 * - Entry: RSI < 30 AND Volume >= 1.5x average
 * - Position sizing: Confidence-based 2-5% of portfolio
 * - SL/TP: ATR-based dynamic
 * - Max 3 concurrent positions
 * - Auto-pause on 5% daily loss or 3 consecutive losses
 */

import { pool } from '../db/postgres';
import logger from '../utils/logger';
import * as redisTradingService from './redis-trading.service';
import * as tradingService from './trading.service';
import { calculateATR, calculateDynamicStops } from './indicators.service';
import * as deliveryService from '../triggers/delivery.service';
import {
  StrategyId,
  MarketRegime,
  getStrategy,
  getStrategyMetaList,
  isValidStrategyId,
  getDefaultStrategyId,
  MarketContext,
} from './strategies/index.js';
import { detectMarketRegime, MarketRegimeData } from './regime-detector.service.js';
import { calculateBtcInfluence, BtcInfluenceSettings, getBtcIndicators } from './btc-influence.service.js';
import { selectBestStrategy, getAllStrategyPerformances } from './auto-mode-selector.service.js';
import { getBaseQuote } from './symbol-utils.js';

/**
 * Normalize symbol to internal format (BASE_USD) for consistent cooldown tracking.
 * Converts: BONKUSDT -> BONK_USD, BONK_USDT -> BONK_USD, BTC_USD -> BTC_USD
 */
function normalizeToInternalSymbol(symbol: string): string {
  const { base } = getBaseQuote(symbol);
  return base ? `${base}_USD` : symbol;
}

// Types
export interface AutoTradingSettings {
  enabled: boolean;
  maxPositions: number;
  rsiThreshold: number;
  volumeMultiplier: number;
  minPositionPct: number;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  symbolCooldownMinutes: number;
  // Fixed USD position sizing (overrides percentage if set)
  minPositionUsd: number;
  maxPositionUsd: number;
  // Minimum expected profit % to cover fees
  minProfitPct: number;
  // Multi-strategy settings
  strategy: StrategyId;
  strategyMode: 'manual' | 'auto';
  excludedSymbols: string[];
  excludeTop10: boolean;
  btcTrendFilter: boolean;
  btcMomentumBoost: boolean;
  btcCorrelationSkip: boolean;

  // Dual-mode trading settings
  dualModeEnabled: boolean;
  conservativeCapitalPct: number;   // Default: 70
  aggressiveCapitalPct: number;     // Default: 30

  // Trailing stop settings (no fixed TP in dual mode)
  trailingEnabled: boolean;
  trailActivationPct: number;       // Default: 2.0 (activate at 2% profit)
  trailDistancePct: number;         // Default: 3.0 (trail 3% below high)
  initialStopLossPct: number;       // Default: 5.0 (initial SL before trailing activates)

  // Tier-specific settings
  conservativeSymbols: string[];    // Major coins
  aggressiveSymbols: string[];      // Meme coins
  conservativeMinConfidence: number; // Default: 0.75
  aggressiveMinConfidence: number;   // Default: 0.65
  conservativeCooldownMinutes: number; // Default: 15
  aggressiveCooldownMinutes: number;   // Default: 5

  // Margin trading settings
  marginEnabled: boolean;           // Enable margin mode (Crypto.com only)
  marginLeverage: number;           // Leverage (1-10, default 1)
  shortEnabled: boolean;            // Enable short selling
  shortRsiThreshold: number;        // RSI threshold for shorts (default 70)
  shortVolumeMultiplier: number;    // Volume multiplier for shorts (default 1.5)
}

// Top 10 coins by market cap (excluded by default)
const TOP_10_SYMBOLS = [
  'BTC_USD', 'ETH_USD', 'SOL_USD', 'XRP_USD', 'BNB_USD',
  'ADA_USD', 'DOGE_USD', 'AVAX_USD', 'DOT_USD', 'LINK_USD',
];

export interface AutoTradingState {
  isRunning: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  dailyPnlUsd: number;
  dailyPnlPct: number;
  consecutiveLosses: number;
  activePositions: number;
  tradesCount: number;
  winsCount: number;
  lossesCount: number;
}

export interface AutoSignal {
  symbol: string;
  rsi: number;
  volumeRatio: number;
  confidence: number;
  positionSizeUsd: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  atr: number;
  skipReason?: string;
  // Multi-strategy fields
  strategy: StrategyId;
  strategyReasons: string[];
  regime?: MarketRegime;
  btcInfluenceApplied?: boolean;
  positionMultiplier?: number;
  // Position direction (long for spot buys, short for margin shorts)
  direction: 'long' | 'short';
}

export interface SignalHistoryEntry {
  id: string;
  symbol: string;
  detectedAt: string;
  rsi: number;
  volumeRatio: number;
  confidence: number;
  entryPrice: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  executed: boolean;
  skipReason: string | null;
  backtestStatus: 'pending' | 'win' | 'loss' | 'timeout';
  backtestExitPrice: number | null;
  backtestExitAt: string | null;
  backtestPnlPct: number | null;
  backtestDurationMinutes: number | null;
}

// All 50 symbols to scan (Crypto.com USD pairs - matches indicator cache)
const SCAN_SYMBOLS = [
  // Top coins
  'BTC_USD', 'ETH_USD', 'SOL_USD', 'XRP_USD', 'ADA_USD',
  'DOGE_USD', 'AVAX_USD', 'DOT_USD', 'LINK_USD', 'MATIC_USD',
  // DeFi & L1s
  'NEAR_USD', 'ATOM_USD', 'UNI_USD', 'LTC_USD', 'BCH_USD',
  'APT_USD', 'ARB_USD', 'OP_USD', 'INJ_USD', 'SUI_USD',
  // Exchange tokens and more alts
  'CRO_USD', 'AAVE_USD', 'ALGO_USD', 'APE_USD', 'AXS_USD', 'BONK_USD',
  'CHZ_USD', 'CRV_USD', 'DYDX_USD', 'EGLD_USD', 'EOS_USD',
  'ETC_USD', 'FIL_USD', 'FLOW_USD', 'FTM_USD', 'GALA_USD',
  'GRT_USD', 'IMX_USD', 'LDO_USD', 'MANA_USD', 'MKR_USD',
  'PONKE_USD', 'RUNE_USD', 'SAND_USD', 'SEI_USD', 'SHIB_USD', 'SNX_USD',
  'THETA_USD', 'TIA_USD', 'TRX_USD', 'XLM_USD', 'XTZ_USD',
];

// Default conservative symbols (major coins)
const DEFAULT_CONSERVATIVE_SYMBOLS = [
  'BTC_USD', 'ETH_USD', 'SOL_USD', 'XRP_USD', 'ADA_USD',
  'AVAX_USD', 'DOT_USD', 'LINK_USD', 'ATOM_USD', 'UNI_USD',
];

// Default aggressive symbols (meme coins)
const DEFAULT_AGGRESSIVE_SYMBOLS = [
  'DOGE_USD', 'SHIB_USD', 'BONK_USD', 'PONKE_USD', 'PEPE_USD', 'GALA_USD', 'APE_USD',
];

// Default settings
const DEFAULT_SETTINGS: AutoTradingSettings = {
  enabled: false,
  maxPositions: 5,
  rsiThreshold: 30,
  volumeMultiplier: 1.5,
  minPositionPct: 2,
  maxPositionPct: 5,
  dailyLossLimitPct: 5,
  maxConsecutiveLosses: 3,
  symbolCooldownMinutes: 15,
  // Fixed USD position sizing (overrides percentage when > 0)
  minPositionUsd: 30,
  maxPositionUsd: 70,
  // Minimum expected profit % to cover fees (0.4% entry + 0.4% exit = 0.8%)
  minProfitPct: 2.0,
  // Multi-strategy defaults
  strategy: 'rsi_oversold',
  strategyMode: 'manual',
  excludedSymbols: [],
  excludeTop10: true,
  btcTrendFilter: true,
  btcMomentumBoost: true,
  btcCorrelationSkip: true,

  // Dual-mode defaults
  dualModeEnabled: false,
  conservativeCapitalPct: 70,
  aggressiveCapitalPct: 30,
  trailingEnabled: true,
  trailActivationPct: 2.0,
  trailDistancePct: 3.0,
  initialStopLossPct: 5.0,
  conservativeSymbols: DEFAULT_CONSERVATIVE_SYMBOLS,
  aggressiveSymbols: DEFAULT_AGGRESSIVE_SYMBOLS,
  conservativeMinConfidence: 0.75,
  aggressiveMinConfidence: 0.65,
  conservativeCooldownMinutes: 15,
  aggressiveCooldownMinutes: 5,

  // Margin defaults
  marginEnabled: false,
  marginLeverage: 1,
  shortEnabled: false,
  shortRsiThreshold: 70,
  shortVolumeMultiplier: 1.5,
};

/**
 * Get auto trading settings for a user
 */
export async function getSettings(userId: string): Promise<AutoTradingSettings> {
  const result = await pool.query(
    `SELECT * FROM auto_trading_settings WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return DEFAULT_SETTINGS;
  }

  const row = result.rows[0];
  return {
    enabled: row.enabled,
    maxPositions: row.max_positions,
    rsiThreshold: parseFloat(row.rsi_threshold),
    volumeMultiplier: parseFloat(row.volume_multiplier),
    minPositionPct: parseFloat(row.min_position_pct),
    maxPositionPct: parseFloat(row.max_position_pct),
    dailyLossLimitPct: parseFloat(row.daily_loss_limit_pct),
    maxConsecutiveLosses: row.max_consecutive_losses,
    symbolCooldownMinutes: row.symbol_cooldown_minutes,
    // Fixed USD position sizing
    minPositionUsd: row.min_position_usd ? parseFloat(row.min_position_usd) : DEFAULT_SETTINGS.minPositionUsd,
    maxPositionUsd: row.max_position_usd ? parseFloat(row.max_position_usd) : DEFAULT_SETTINGS.maxPositionUsd,
    minProfitPct: row.min_profit_pct ? parseFloat(row.min_profit_pct) : DEFAULT_SETTINGS.minProfitPct,
    // Multi-strategy fields
    strategy: (row.strategy || 'rsi_oversold') as StrategyId,
    strategyMode: (row.strategy_mode || 'manual') as 'manual' | 'auto',
    excludedSymbols: row.excluded_symbols || [],
    excludeTop10: row.exclude_top_10 ?? true,
    btcTrendFilter: row.btc_trend_filter ?? true,
    btcMomentumBoost: row.btc_momentum_boost ?? true,
    btcCorrelationSkip: row.btc_correlation_skip ?? true,
    // Dual-mode fields
    dualModeEnabled: row.dual_mode_enabled ?? DEFAULT_SETTINGS.dualModeEnabled,
    conservativeCapitalPct: row.conservative_capital_pct ? parseFloat(row.conservative_capital_pct) : DEFAULT_SETTINGS.conservativeCapitalPct,
    aggressiveCapitalPct: row.aggressive_capital_pct ? parseFloat(row.aggressive_capital_pct) : DEFAULT_SETTINGS.aggressiveCapitalPct,
    trailingEnabled: row.trailing_enabled ?? DEFAULT_SETTINGS.trailingEnabled,
    trailActivationPct: row.trail_activation_pct ? parseFloat(row.trail_activation_pct) : DEFAULT_SETTINGS.trailActivationPct,
    trailDistancePct: row.trail_distance_pct ? parseFloat(row.trail_distance_pct) : DEFAULT_SETTINGS.trailDistancePct,
    initialStopLossPct: row.initial_stop_loss_pct ? parseFloat(row.initial_stop_loss_pct) : DEFAULT_SETTINGS.initialStopLossPct,
    conservativeSymbols: row.conservative_symbols || DEFAULT_SETTINGS.conservativeSymbols,
    aggressiveSymbols: row.aggressive_symbols || DEFAULT_SETTINGS.aggressiveSymbols,
    conservativeMinConfidence: row.conservative_min_confidence ? parseFloat(row.conservative_min_confidence) : DEFAULT_SETTINGS.conservativeMinConfidence,
    aggressiveMinConfidence: row.aggressive_min_confidence ? parseFloat(row.aggressive_min_confidence) : DEFAULT_SETTINGS.aggressiveMinConfidence,
    conservativeCooldownMinutes: row.conservative_cooldown_minutes ?? DEFAULT_SETTINGS.conservativeCooldownMinutes,
    aggressiveCooldownMinutes: row.aggressive_cooldown_minutes ?? DEFAULT_SETTINGS.aggressiveCooldownMinutes,
    // Margin trading fields
    marginEnabled: row.margin_enabled ?? DEFAULT_SETTINGS.marginEnabled,
    marginLeverage: row.margin_leverage ?? DEFAULT_SETTINGS.marginLeverage,
    shortEnabled: row.short_enabled ?? DEFAULT_SETTINGS.shortEnabled,
    shortRsiThreshold: row.short_rsi_threshold ? parseFloat(row.short_rsi_threshold) : DEFAULT_SETTINGS.shortRsiThreshold,
    shortVolumeMultiplier: row.short_volume_multiplier ? parseFloat(row.short_volume_multiplier) : DEFAULT_SETTINGS.shortVolumeMultiplier,
  };
}

/**
 * Update auto trading settings for a user
 */
export async function updateSettings(
  userId: string,
  updates: Partial<AutoTradingSettings>
): Promise<AutoTradingSettings> {
  logger.info('Updating auto trading settings', {
    userId,
    updates,
    btcTrendFilter: updates.btcTrendFilter,
    btcMomentumBoost: updates.btcMomentumBoost,
    btcCorrelationSkip: updates.btcCorrelationSkip,
  });

  // Validate strategy if provided
  if (updates.strategy && !isValidStrategyId(updates.strategy)) {
    updates.strategy = getDefaultStrategyId();
  }

  // Upsert settings with multi-strategy and margin fields
  await pool.query(
    `INSERT INTO auto_trading_settings (
      user_id, enabled, max_positions, rsi_threshold, volume_multiplier,
      min_position_pct, max_position_pct, daily_loss_limit_pct,
      max_consecutive_losses, symbol_cooldown_minutes,
      min_position_usd, max_position_usd, min_profit_pct,
      strategy, strategy_mode, excluded_symbols, exclude_top_10,
      btc_trend_filter, btc_momentum_boost, btc_correlation_skip,
      margin_enabled, margin_leverage, short_enabled, short_rsi_threshold, short_volume_multiplier,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      enabled = COALESCE($2, auto_trading_settings.enabled),
      max_positions = COALESCE($3, auto_trading_settings.max_positions),
      rsi_threshold = COALESCE($4, auto_trading_settings.rsi_threshold),
      volume_multiplier = COALESCE($5, auto_trading_settings.volume_multiplier),
      min_position_pct = COALESCE($6, auto_trading_settings.min_position_pct),
      max_position_pct = COALESCE($7, auto_trading_settings.max_position_pct),
      daily_loss_limit_pct = COALESCE($8, auto_trading_settings.daily_loss_limit_pct),
      max_consecutive_losses = COALESCE($9, auto_trading_settings.max_consecutive_losses),
      symbol_cooldown_minutes = COALESCE($10, auto_trading_settings.symbol_cooldown_minutes),
      min_position_usd = COALESCE($11, auto_trading_settings.min_position_usd),
      max_position_usd = COALESCE($12, auto_trading_settings.max_position_usd),
      min_profit_pct = COALESCE($13, auto_trading_settings.min_profit_pct),
      strategy = COALESCE($14, auto_trading_settings.strategy),
      strategy_mode = COALESCE($15, auto_trading_settings.strategy_mode),
      excluded_symbols = COALESCE($16, auto_trading_settings.excluded_symbols),
      exclude_top_10 = COALESCE($17, auto_trading_settings.exclude_top_10),
      btc_trend_filter = COALESCE($18, auto_trading_settings.btc_trend_filter),
      btc_momentum_boost = COALESCE($19, auto_trading_settings.btc_momentum_boost),
      btc_correlation_skip = COALESCE($20, auto_trading_settings.btc_correlation_skip),
      margin_enabled = COALESCE($21, auto_trading_settings.margin_enabled),
      margin_leverage = COALESCE($22, auto_trading_settings.margin_leverage),
      short_enabled = COALESCE($23, auto_trading_settings.short_enabled),
      short_rsi_threshold = COALESCE($24, auto_trading_settings.short_rsi_threshold),
      short_volume_multiplier = COALESCE($25, auto_trading_settings.short_volume_multiplier),
      updated_at = NOW()`,
    [
      userId,
      updates.enabled !== undefined ? updates.enabled : null,
      updates.maxPositions !== undefined ? updates.maxPositions : null,
      updates.rsiThreshold !== undefined ? updates.rsiThreshold : null,
      updates.volumeMultiplier !== undefined ? updates.volumeMultiplier : null,
      updates.minPositionPct !== undefined ? updates.minPositionPct : null,
      updates.maxPositionPct !== undefined ? updates.maxPositionPct : null,
      updates.dailyLossLimitPct !== undefined ? updates.dailyLossLimitPct : null,
      updates.maxConsecutiveLosses !== undefined ? updates.maxConsecutiveLosses : null,
      updates.symbolCooldownMinutes !== undefined ? updates.symbolCooldownMinutes : null,
      updates.minPositionUsd !== undefined ? updates.minPositionUsd : null,
      updates.maxPositionUsd !== undefined ? updates.maxPositionUsd : null,
      updates.minProfitPct !== undefined ? updates.minProfitPct : null,
      updates.strategy !== undefined ? updates.strategy : null,
      updates.strategyMode !== undefined ? updates.strategyMode : null,
      updates.excludedSymbols !== undefined ? updates.excludedSymbols : null,
      updates.excludeTop10 !== undefined ? updates.excludeTop10 : null,
      updates.btcTrendFilter !== undefined ? updates.btcTrendFilter : null,
      updates.btcMomentumBoost !== undefined ? updates.btcMomentumBoost : null,
      updates.btcCorrelationSkip !== undefined ? updates.btcCorrelationSkip : null,
      updates.marginEnabled !== undefined ? updates.marginEnabled : null,
      updates.marginLeverage !== undefined ? updates.marginLeverage : null,
      updates.shortEnabled !== undefined ? updates.shortEnabled : null,
      updates.shortRsiThreshold !== undefined ? updates.shortRsiThreshold : null,
      updates.shortVolumeMultiplier !== undefined ? updates.shortVolumeMultiplier : null,
    ]
  );

  return getSettings(userId);
}

/**
 * Get current auto trading state for today
 */
export async function getState(userId: string): Promise<AutoTradingState> {
  const settings = await getSettings(userId);

  // Get today's state
  const stateResult = await pool.query(
    `SELECT * FROM auto_trading_state
     WHERE user_id = $1 AND date = CURRENT_DATE`,
    [userId]
  );

  // Get active auto trade positions with details for unrealized P&L calculation
  const activeTradesResult = await pool.query<{
    id: string;
    symbol: string;
    side: string;
    quantity: string;
    filled_price: string;
    total: string;
  }>(
    `SELECT id, symbol, side, quantity, filled_price, total FROM trades
     WHERE user_id = $1 AND auto_trade = true
     AND status = 'filled' AND closed_at IS NULL
     AND quantity > 0`,
    [userId]
  );

  const activeTrades = activeTradesResult.rows;
  const activePositions = activeTrades.length;

  // Calculate unrealized P&L from open positions
  let unrealizedPnlUsd = 0;
  let totalInvested = 0;

  if (activeTrades.length > 0) {
    // Get current prices for all symbols
    const { CryptoComClient } = await import('./crypto-com.client.js');
    const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
    try {
      const tickers = await publicClient.getTicker24hr();
      const tickerArray = Array.isArray(tickers) ? tickers : [tickers];
      const priceMap = new Map<string, number>();
      for (const t of tickerArray) {
        priceMap.set(t.symbol, parseFloat(t.lastPrice));
      }

      for (const trade of activeTrades) {
        const entryPrice = parseFloat(trade.filled_price) || 0;
        const quantity = parseFloat(trade.quantity) || 0;
        const invested = parseFloat(trade.total) || entryPrice * quantity;
        totalInvested += invested;

        // Get current price (try both formats)
        const { toBinanceSymbol } = await import('./symbol-utils.js');
        const normalizedSymbol = toBinanceSymbol(trade.symbol);
        const currentPrice = priceMap.get(normalizedSymbol) || priceMap.get(trade.symbol) || entryPrice;

        // Calculate unrealized P&L
        if (trade.side === 'buy') {
          unrealizedPnlUsd += (currentPrice - entryPrice) * quantity;
        } else {
          unrealizedPnlUsd += (entryPrice - currentPrice) * quantity;
        }
      }
    } catch (err) {
      logger.warn('Failed to calculate unrealized P&L', { error: (err as Error).message });
    }
  }

  const state = stateResult.rows[0];

  // Calculate total P&L (realized + unrealized)
  const realizedPnlUsd = state ? parseFloat(state.daily_pnl_usd) || 0 : 0;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;
  const totalPnlPct = totalInvested > 0 ? (unrealizedPnlUsd / totalInvested) * 100 : (state ? parseFloat(state.daily_pnl_pct) || 0 : 0);

  if (!state) {
    return {
      isRunning: settings.enabled,
      isPaused: false,
      pauseReason: null,
      dailyPnlUsd: totalPnlUsd,
      dailyPnlPct: totalPnlPct,
      consecutiveLosses: 0,
      activePositions,
      tradesCount: activePositions, // Count open positions as trades
      winsCount: 0,
      lossesCount: 0,
    };
  }

  return {
    isRunning: settings.enabled && !state.is_paused,
    isPaused: state.is_paused,
    pauseReason: state.pause_reason,
    dailyPnlUsd: totalPnlUsd,
    dailyPnlPct: totalPnlPct,
    consecutiveLosses: state.consecutive_losses,
    activePositions,
    tradesCount: state.trades_count,
    winsCount: state.wins_count,
    lossesCount: state.losses_count,
  };
}

/**
 * Start auto trading for a user
 */
export async function startAutoTrading(userId: string): Promise<void> {
  await updateSettings(userId, { enabled: true });

  // Reset pause state for today
  await pool.query(
    `INSERT INTO auto_trading_state (user_id, date, is_paused, pause_reason)
     VALUES ($1, CURRENT_DATE, false, NULL)
     ON CONFLICT (user_id, date) DO UPDATE SET
       is_paused = false,
       pause_reason = NULL,
       updated_at = NOW()`,
    [userId]
  );

  logger.info('Auto trading started', { userId });
}

/**
 * Stop auto trading for a user
 */
export async function stopAutoTrading(userId: string): Promise<void> {
  await updateSettings(userId, { enabled: false });
  logger.info('Auto trading stopped', { userId });
}

/**
 * Check if symbol is in cooldown
 */
async function isSymbolInCooldown(userId: string, symbol: string): Promise<boolean> {
  // Normalize symbol to internal format (BASE_USD) for consistent matching
  const normalizedSymbol = normalizeToInternalSymbol(symbol);
  const result = await pool.query(
    `SELECT cooldown_until FROM auto_trading_cooldowns
     WHERE user_id = $1 AND symbol = $2 AND cooldown_until > NOW()`,
    [userId, normalizedSymbol]
  );
  return result.rows.length > 0;
}

/**
 * Add symbol to cooldown
 */
async function addSymbolCooldown(
  userId: string,
  symbol: string,
  minutes: number
): Promise<void> {
  // Normalize symbol to internal format (BASE_USD) for consistent matching with SCAN_SYMBOLS
  const normalizedSymbol = normalizeToInternalSymbol(symbol);
  await pool.query(
    `INSERT INTO auto_trading_cooldowns (user_id, symbol, cooldown_until)
     VALUES ($1, $2, NOW() + interval '1 minute' * $3)
     ON CONFLICT (user_id, symbol) DO UPDATE SET
       cooldown_until = NOW() + interval '1 minute' * $3`,
    [userId, normalizedSymbol, minutes]
  );
}

/**
 * Calculate position size based on confidence
 */
function calculatePositionSize(
  confidence: number,
  portfolioValue: number,
  minPct: number,
  maxPct: number,
  minUsd: number = 0,
  maxUsd: number = 0
): number {
  // Linear scale based on confidence (0.5 to 1.0)
  const normalizedConfidence = Math.max(0, (confidence - 0.5) / 0.5); // 0 to 1

  // If fixed USD amounts are set (> 0), use them instead of percentage
  if (minUsd > 0 && maxUsd > 0) {
    return minUsd + (normalizedConfidence * (maxUsd - minUsd));
  }

  // Fallback to percentage-based sizing
  const pct = minPct + (normalizedConfidence * (maxPct - minPct));
  return (portfolioValue * pct) / 100;
}

/**
 * Log a detected signal to the database for backtesting
 */
async function logSignal(
  userId: string,
  signal: AutoSignal,
  executed: boolean,
  tradeId?: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO auto_trading_signals (
      user_id, symbol, rsi, volume_ratio, confidence, entry_price,
      suggested_stop_loss, suggested_take_profit, atr_value,
      executed, trade_id, skip_reason, backtest_status, strategy, regime
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14)
    RETURNING id`,
    [
      userId,
      signal.symbol,
      signal.rsi,
      signal.volumeRatio,
      signal.confidence,
      signal.currentPrice,
      signal.stopLoss,
      signal.takeProfit,
      signal.atr,
      executed,
      tradeId || null,
      signal.skipReason || null,
      signal.strategy,
      signal.regime || null,
    ]
  );
  return result.rows[0].id;
}

/**
 * Check if a symbol should be excluded from trading
 */
function isSymbolExcluded(
  symbol: string,
  settings: AutoTradingSettings
): { excluded: boolean; reason?: string } {
  // Check top 10 exclusion (but BTC is allowed as reference for BTC strategies)
  if (settings.excludeTop10 && TOP_10_SYMBOLS.includes(symbol)) {
    return { excluded: true, reason: 'top_10_excluded' };
  }

  // Check custom exclusion list
  if (settings.excludedSymbols.includes(symbol)) {
    return { excluded: true, reason: 'user_excluded' };
  }

  return { excluded: false };
}

/**
 * Scan all symbols for valid signals using the selected strategy
 * Returns ALL signals that match criteria, with skip reason if applicable
 */
async function scanForSignals(
  userId: string,
  settings: AutoTradingSettings,
  regimeData: MarketRegimeData,
  activeStrategy: StrategyId
): Promise<AutoSignal[]> {
  const signals: AutoSignal[] = [];
  const strategy = getStrategy(activeStrategy);

  if (!strategy) {
    logger.error('Invalid strategy', { strategy: activeStrategy });
    return [];
  }

  // Get BTC indicators for correlation strategies and BTC influence
  const btcIndicators = await getBtcIndicators();
  const btcPriceData = await redisTradingService.getPrice('BTCUSDT');

  // BTC influence settings
  const btcSettings: BtcInfluenceSettings = {
    btcTrendFilter: settings.btcTrendFilter,
    btcMomentumBoost: settings.btcMomentumBoost,
    btcCorrelationSkip: settings.btcCorrelationSkip,
  };

  for (const symbol of SCAN_SYMBOLS) {
    // Check exclusion
    const exclusion = isSymbolExcluded(symbol, settings);
    if (exclusion.excluded) {
      continue; // Skip excluded symbols silently
    }

    // Get 5m indicators from Redis
    const indicators = await redisTradingService.getIndicators(symbol, '5m');
    if (!indicators) {
      continue;
    }

    // Check if strategy has required data
    if (!strategy.hasRequiredData(indicators)) {
      continue;
    }

    // Get current price
    const priceData = await redisTradingService.getPrice(symbol);
    if (!priceData) {
      continue;
    }
    const currentPrice = priceData.price;

    // Build market context for strategy
    const context: MarketContext = {
      symbol,
      currentPrice,
      indicators,
      regime: regimeData.regime,
      btcIndicators: btcIndicators || undefined,
      btcPrice: btcPriceData?.price,
    };

    // Evaluate strategy
    const strategyResult = strategy.evaluate(context);

    // Get ATR for position sizing (needed for both traded and logged signals)
    let atr = indicators.atr || 0;
    if (!atr) {
      try {
        const klines = await tradingService.getKlines(symbol, '5m', 20);
        if (klines && klines.length >= 15) {
          const numericKlines = klines.map(k => ({
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
          }));
          const atrResult = calculateATR(numericKlines, 14);
          atr = atrResult.atr;
        }
      } catch {
        atr = currentPrice * 0.02;
      }
    }

    // Determine skip reason
    let skipReason: string | undefined;
    let positionMultiplier = 1;

    // Check if strategy triggered
    if (!strategyResult.shouldTrade) {
      // Only log for backtest if there's something interesting (RSI < 40 or high volume)
      const hasInterestingCondition = (indicators.rsi !== undefined && indicators.rsi < 40) ||
        (indicators.volume_ratio !== undefined && indicators.volume_ratio >= 2.0);
      if (!hasInterestingCondition) {
        continue; // Skip boring symbols entirely
      }
      skipReason = 'strategy_not_triggered';
    }

    // Apply BTC influence for altcoins (only if strategy triggered)
    if (!skipReason && symbol !== 'BTC_USD' && symbol !== 'BTCUSDT') {
      const btcInfluence = await calculateBtcInfluence(symbol, btcSettings);
      if (!btcInfluence.shouldTrade) {
        skipReason = btcInfluence.skipReason || 'btc_influence';
      }
      positionMultiplier = btcInfluence.positionMultiplier;
    }

    // Check for cooldown (only if strategy triggered)
    if (!skipReason) {
      const inCooldown = await isSymbolInCooldown(userId, symbol);
      if (inCooldown) {
        skipReason = 'cooldown';
      }
    }

    // Check if already holding $10+ worth of this symbol
    if (!skipReason) {
      const existingPosition = await pool.query(
        `SELECT quantity, filled_price FROM trades
         WHERE user_id = $1 AND symbol = $2
           AND status = 'filled' AND closed_at IS NULL AND quantity > 0`,
        [userId, symbol]
      );
      if (existingPosition.rows.length > 0) {
        const totalValue = existingPosition.rows.reduce((sum, row) => {
          const qty = parseFloat(row.quantity) || 0;
          const price = currentPrice || parseFloat(row.filled_price) || 0;
          return sum + (qty * price);
        }, 0);
        if (totalValue >= 10) {
          skipReason = 'already_holding';
        }
      }
    }

    // Use strategy's suggested stops or calculate from ATR
    const stopLoss = strategyResult.suggestedStopLoss ||
      calculateDynamicStops(currentPrice, atr, 2, 3).stopLoss;
    const takeProfit = strategyResult.suggestedTakeProfit ||
      calculateDynamicStops(currentPrice, atr, 2, 3).takeProfit;

    signals.push({
      symbol,
      rsi: indicators.rsi || 50,
      volumeRatio: indicators.volume_ratio || 1,
      skipReason,
      confidence: strategyResult.confidence,
      positionSizeUsd: 0, // Will be calculated with portfolio value
      stopLoss,
      takeProfit,
      currentPrice,
      atr,
      // Multi-strategy fields
      strategy: activeStrategy,
      strategyReasons: strategyResult.reasons,
      regime: regimeData.regime,
      btcInfluenceApplied: symbol !== 'BTC_USD' && symbol !== 'BTCUSDT',
      positionMultiplier,
      // Direction from strategy
      direction: strategyResult.direction === 'short' ? 'short' : 'long',
    });
  }

  // Sort by confidence (highest first)
  return signals.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Scan all symbols for SHORT signals using the overbought strategy
 * Only called when margin mode and shorts are enabled
 */
async function scanForShortSignals(
  userId: string,
  settings: AutoTradingSettings,
  regimeData: MarketRegimeData
): Promise<AutoSignal[]> {
  const signals: AutoSignal[] = [];
  const strategy = getStrategy('rsi_overbought_short');

  if (!strategy) {
    logger.error('Short strategy not found');
    return [];
  }

  // Get BTC indicators
  const btcIndicators = await getBtcIndicators();
  const btcPriceData = await redisTradingService.getPrice('BTCUSDT');

  for (const symbol of SCAN_SYMBOLS) {
    // Check exclusion
    const exclusion = isSymbolExcluded(symbol, settings);
    if (exclusion.excluded) {
      continue;
    }

    // Get 5m indicators from Redis
    const indicators = await redisTradingService.getIndicators(symbol, '5m');
    if (!indicators) {
      continue;
    }

    // Check if strategy has required data
    if (!strategy.hasRequiredData(indicators)) {
      continue;
    }

    // Get current price
    const priceData = await redisTradingService.getPrice(symbol);
    if (!priceData) {
      continue;
    }
    const currentPrice = priceData.price;

    // Build market context for strategy
    const context: MarketContext = {
      symbol,
      currentPrice,
      indicators,
      regime: regimeData.regime,
      btcIndicators: btcIndicators || undefined,
      btcPrice: btcPriceData?.price,
    };

    // Evaluate short strategy
    const strategyResult = strategy.evaluate(context);

    // Get ATR for position sizing
    let atr = indicators.atr || 0;
    if (!atr) {
      atr = currentPrice * 0.02;
    }

    // Determine skip reason
    let skipReason: string | undefined;

    // Check if strategy triggered
    if (!strategyResult.shouldTrade || strategyResult.direction !== 'short') {
      // Only log for backtest if RSI is high
      const hasInterestingCondition = (indicators.rsi !== undefined && indicators.rsi > 65);
      if (!hasInterestingCondition) {
        continue;
      }
      skipReason = 'strategy_not_triggered';
    }

    // Check for cooldown
    if (!skipReason) {
      const inCooldown = await isSymbolInCooldown(userId, symbol);
      if (inCooldown) {
        skipReason = 'cooldown';
      }
    }

    // Check if already have a short position on this symbol
    if (!skipReason) {
      const existingPosition = await pool.query(
        `SELECT id FROM trades
         WHERE user_id = $1 AND symbol = $2 AND position_side = 'short'
           AND status = 'filled' AND closed_at IS NULL`,
        [userId, symbol]
      );
      if (existingPosition.rows.length > 0) {
        skipReason = 'already_short';
      }
    }

    // For shorts: SL is above entry, TP is below entry
    const stopLoss = strategyResult.suggestedStopLoss ||
      currentPrice + (atr * 2);  // SL above for short
    const takeProfit = strategyResult.suggestedTakeProfit ||
      currentPrice - (atr * 3);  // TP below for short

    signals.push({
      symbol,
      rsi: indicators.rsi || 50,
      volumeRatio: indicators.volume_ratio || 1,
      skipReason,
      confidence: strategyResult.confidence,
      positionSizeUsd: 0,
      stopLoss,
      takeProfit,
      currentPrice,
      atr,
      strategy: 'rsi_overbought_short',
      strategyReasons: strategyResult.reasons,
      regime: regimeData.regime,
      btcInfluenceApplied: false,
      positionMultiplier: 1,
      direction: 'short',
    });
  }

  // Sort by confidence (highest first)
  return signals.sort((a, b) => b.confidence - a.confidence);
}

// Extended signal type for dual-mode
export interface DualModeSignal extends AutoSignal {
  tier: 'conservative' | 'aggressive';
}

/**
 * Scan for signals in dual-mode (conservative + aggressive tiers)
 */
async function scanForDualModeSignals(
  userId: string,
  settings: AutoTradingSettings,
  regimeData: MarketRegimeData
): Promise<{ conservative: DualModeSignal[]; aggressive: DualModeSignal[] }> {
  const conservativeSignals: DualModeSignal[] = [];
  const aggressiveSignals: DualModeSignal[] = [];

  // Get BTC indicators for all strategies
  const btcIndicators = await getBtcIndicators();
  const btcPriceData = await redisTradingService.getPrice('BTCUSDT');

  // Get strategies
  const confluenceStrategy = getStrategy('confluence');
  const tripleSignalStrategy = getStrategy('triple_signal');

  if (!confluenceStrategy || !tripleSignalStrategy) {
    logger.error('Dual-mode strategies not found');
    return { conservative: [], aggressive: [] };
  }

  // BTC influence settings
  const btcSettings: BtcInfluenceSettings = {
    btcTrendFilter: settings.btcTrendFilter,
    btcMomentumBoost: settings.btcMomentumBoost,
    btcCorrelationSkip: settings.btcCorrelationSkip,
  };

  // Scan conservative tier (major coins with confluence strategy)
  for (const symbol of settings.conservativeSymbols) {
    const signal = await evaluateSymbolForDualMode(
      userId,
      symbol,
      'conservative',
      confluenceStrategy,
      settings,
      regimeData,
      btcIndicators,
      btcPriceData?.price,
      btcSettings,
      settings.conservativeCooldownMinutes,
      settings.conservativeMinConfidence
    );
    if (signal) {
      conservativeSignals.push(signal);
    }
  }

  // Scan aggressive tier (meme coins with triple-signal strategy)
  for (const symbol of settings.aggressiveSymbols) {
    const signal = await evaluateSymbolForDualMode(
      userId,
      symbol,
      'aggressive',
      tripleSignalStrategy,
      settings,
      regimeData,
      btcIndicators,
      btcPriceData?.price,
      btcSettings,
      settings.aggressiveCooldownMinutes,
      settings.aggressiveMinConfidence
    );
    if (signal) {
      aggressiveSignals.push(signal);
    }
  }

  // Sort by confidence
  conservativeSignals.sort((a, b) => b.confidence - a.confidence);
  aggressiveSignals.sort((a, b) => b.confidence - a.confidence);

  logger.info('Dual-mode scan complete', {
    conservativeSignals: conservativeSignals.length,
    aggressiveSignals: aggressiveSignals.length,
    conservativeReady: conservativeSignals.filter(s => !s.skipReason).length,
    aggressiveReady: aggressiveSignals.filter(s => !s.skipReason).length,
  });

  return { conservative: conservativeSignals, aggressive: aggressiveSignals };
}

/**
 * Evaluate a single symbol for dual-mode trading
 */
async function evaluateSymbolForDualMode(
  userId: string,
  symbol: string,
  tier: 'conservative' | 'aggressive',
  strategy: ReturnType<typeof getStrategy>,
  _settings: AutoTradingSettings,
  regimeData: MarketRegimeData,
  btcIndicators: Awaited<ReturnType<typeof getBtcIndicators>>,
  btcPrice: number | undefined,
  btcSettings: BtcInfluenceSettings,
  cooldownMinutes: number,
  minConfidence: number
): Promise<DualModeSignal | null> {
  if (!strategy) return null;

  // Get indicators
  const indicators = await redisTradingService.getIndicators(symbol, '5m');
  if (!indicators) return null;

  // Check if strategy has required data
  if (!strategy.hasRequiredData(indicators)) return null;

  // Get current price
  const priceData = await redisTradingService.getPrice(symbol);
  if (!priceData) return null;
  const currentPrice = priceData.price;

  // Build market context
  const context: MarketContext = {
    symbol,
    currentPrice,
    indicators,
    regime: regimeData.regime,
    btcIndicators: btcIndicators || undefined,
    btcPrice,
  };

  // Evaluate strategy
  const strategyResult = strategy.evaluate(context);

  // Get ATR
  let atr = indicators.atr || 0;
  if (!atr) {
    try {
      const klines = await tradingService.getKlines(symbol, '5m', 20);
      if (klines && klines.length >= 15) {
        const numericKlines = klines.map(k => ({
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
        }));
        const atrResult = calculateATR(numericKlines, 14);
        atr = atrResult.atr;
      }
    } catch {
      atr = currentPrice * 0.02;
    }
  }

  // Determine skip reason
  let skipReason: string | undefined;
  let positionMultiplier = 1;

  // Check if strategy triggered with sufficient confidence
  if (!strategyResult.shouldTrade) {
    skipReason = 'strategy_not_triggered';
  } else if (strategyResult.confidence < minConfidence) {
    skipReason = `confidence_below_threshold_${minConfidence}`;
  }

  // Apply BTC influence
  if (!skipReason && symbol !== 'BTC_USD' && symbol !== 'BTCUSDT') {
    const btcInfluence = await calculateBtcInfluence(symbol, btcSettings);
    if (!btcInfluence.shouldTrade) {
      skipReason = btcInfluence.skipReason || 'btc_influence';
    }
    positionMultiplier = btcInfluence.positionMultiplier;
  }

  // Check cooldown (use tier-specific cooldown)
  if (!skipReason) {
    const inCooldown = await isSymbolInCooldownWithMinutes(userId, symbol, cooldownMinutes);
    if (inCooldown) {
      skipReason = 'cooldown';
    }
  }

  // Check if already holding
  if (!skipReason) {
    const existingPosition = await pool.query(
      `SELECT quantity, filled_price FROM trades
       WHERE user_id = $1 AND symbol = $2
         AND status = 'filled' AND closed_at IS NULL AND quantity > 0`,
      [userId, symbol]
    );
    if (existingPosition.rows.length > 0) {
      const totalValue = existingPosition.rows.reduce((sum, row) => {
        const qty = parseFloat(row.quantity) || 0;
        const price = currentPrice || parseFloat(row.filled_price) || 0;
        return sum + (qty * price);
      }, 0);
      if (totalValue >= 10) {
        skipReason = 'already_holding';
      }
    }
  }

  // Use strategy's suggested stops (no TP for dual-mode - trailing only)
  const stopLoss = strategyResult.suggestedStopLoss ||
    calculateDynamicStops(currentPrice, atr, 2, 3).stopLoss;

  return {
    symbol,
    tier,
    rsi: indicators.rsi || 50,
    volumeRatio: indicators.volume_ratio || 1,
    skipReason,
    confidence: strategyResult.confidence,
    positionSizeUsd: 0, // Calculated later
    stopLoss,
    takeProfit: 0, // No fixed TP in dual-mode
    currentPrice,
    atr,
    strategy: tier === 'conservative' ? 'confluence' : 'triple_signal',
    strategyReasons: strategyResult.reasons,
    regime: regimeData.regime,
    btcInfluenceApplied: symbol !== 'BTC_USD' && symbol !== 'BTCUSDT',
    positionMultiplier,
    direction: 'long', // Dual-mode is always long (spot buys)
  };
}

/**
 * Check if symbol is in cooldown with custom minutes
 * First checks the cooldowns table, then falls back to trades table
 */
async function isSymbolInCooldownWithMinutes(userId: string, symbol: string, cooldownMinutes: number): Promise<boolean> {
  // First check the cooldowns table (normalized format)
  const normalizedSymbol = normalizeToInternalSymbol(symbol);
  const cooldownResult = await pool.query(
    `SELECT cooldown_until FROM auto_trading_cooldowns
     WHERE user_id = $1 AND symbol = $2 AND cooldown_until > NOW()`,
    [userId, normalizedSymbol]
  );
  if (cooldownResult.rows.length > 0) return true;

  // Fall back to trades table - check multiple symbol formats
  const { base } = getBaseQuote(symbol);
  const symbolVariants = base ? [
    `${base}_USD`,      // BTC_USD
    `${base}_USDT`,     // BTC_USDT
    `${base}USDT`,      // BTCUSDT
    `${base}USD`,       // BTCUSD
  ] : [symbol];

  const result = await pool.query(
    `SELECT MAX(closed_at) as last_closed
     FROM trades
     WHERE user_id = $1 AND symbol = ANY($2) AND closed_at IS NOT NULL`,
    [userId, symbolVariants]
  );

  if (!result.rows[0]?.last_closed) return false;

  const lastClosed = new Date(result.rows[0].last_closed);
  const cooldownEnd = new Date(lastClosed.getTime() + cooldownMinutes * 60 * 1000);

  return new Date() < cooldownEnd;
}

/**
 * Calculate position size for dual-mode (respects tier capital allocation)
 */
function calculateDualModePositionSize(
  confidence: number,
  portfolioValue: number,
  tier: 'conservative' | 'aggressive',
  settings: AutoTradingSettings
): number {
  // Get capital allocation for this tier
  const tierCapitalPct = tier === 'conservative'
    ? settings.conservativeCapitalPct
    : settings.aggressiveCapitalPct;
  const tierCapital = portfolioValue * (tierCapitalPct / 100);

  // Use fixed USD sizing within tier's allocation
  const minUsd = settings.minPositionUsd;
  // Max is either the configured max or 25% of tier capital, whichever is smaller
  const maxUsd = Math.min(settings.maxPositionUsd, tierCapital * 0.25);

  // Scale by confidence (0.5 to 1.0 range)
  const normalizedConfidence = Math.max(0, Math.min(1, (confidence - 0.5) / 0.5));
  const size = minUsd + (normalizedConfidence * (maxUsd - minUsd));

  return Math.max(size, 5); // Minimum $5
}

/**
 * Execute a dual-mode trade with trailing stop settings
 */
async function executeDualModeTrade(
  userId: string,
  signal: DualModeSignal,
  settings: AutoTradingSettings
): Promise<{ id: string } | null> {
  logger.info('Executing dual-mode trade', {
    userId,
    symbol: signal.symbol,
    tier: signal.tier,
    confidence: signal.confidence.toFixed(2),
    strategy: signal.strategy,
  });

  try {
    // Place the order (no take profit for dual-mode - trailing only)
    const trade = await tradingService.placeOrder(userId, {
      symbol: signal.symbol,
      side: 'buy',
      type: 'market',
      quoteAmount: signal.positionSizeUsd,
      stopLoss: signal.stopLoss,
      // No fixed TP - trailing stop will handle exit
      trailingStopPct: settings.trailDistancePct,
      notes: `Dual-mode ${signal.tier}: ${signal.strategy}, Conf ${(signal.confidence * 100).toFixed(0)}%`,
    });

    // Mark as auto trade and set tier
    await pool.query(
      `UPDATE trades SET auto_trade = true, tier = $2 WHERE id = $1`,
      [trade.id, signal.tier]
    );

    // Record cooldown using tier-specific duration
    const cooldownMinutes = signal.tier === 'aggressive'
      ? settings.aggressiveCooldownMinutes
      : settings.conservativeCooldownMinutes;
    await addSymbolCooldown(userId, signal.symbol, cooldownMinutes);

    // Send notification
    deliveryService.sendTradingNotification(
      userId,
      `Dual-Mode ${signal.tier.toUpperCase()}`,
      `Bought $${signal.positionSizeUsd.toFixed(0)} ${signal.symbol.replace('_USD', '')} at $${signal.currentPrice.toFixed(signal.currentPrice < 1 ? 6 : 2)}\nConf: ${(signal.confidence * 100).toFixed(0)}% | Trail: ${settings.trailDistancePct}%\nSL: $${signal.stopLoss.toFixed(signal.stopLoss < 1 ? 6 : 2)}`,
      'trading.auto_trade_opened',
      5,
      { tradeId: trade.id, symbol: signal.symbol, tier: signal.tier }
    ).catch((err) => logger.error('Failed to send dual-mode trade notification', { error: err }));

    return trade;
  } catch (error) {
    logger.error('Failed to execute dual-mode trade', {
      userId,
      symbol: signal.symbol,
      tier: signal.tier,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Process dual-mode trading for a user
 * Handles both conservative and aggressive tiers independently
 */
async function processDualModeTrading(
  userId: string,
  settings: AutoTradingSettings,
  _state: AutoTradingState,
  portfolio: Awaited<ReturnType<typeof tradingService.getPortfolio>>,
  regimeData: MarketRegimeData,
  availableUsd: number,
  isPaused: boolean
): Promise<void> {
  logger.info('Processing dual-mode trading', {
    userId,
    conservativeSymbols: settings.conservativeSymbols.length,
    aggressiveSymbols: settings.aggressiveSymbols.length,
    trailActivation: settings.trailActivationPct,
    trailDistance: settings.trailDistancePct,
  });

  // Scan both tiers
  const { conservative, aggressive } = await scanForDualModeSignals(userId, settings, regimeData);

  // Get portfolio value for position sizing
  const portfolioValue = portfolio?.totalValueUsdt || 0;

  // Count current positions per tier
  const positionsResult = await pool.query(
    `SELECT tier, COUNT(*) as count FROM trades
     WHERE user_id = $1 AND status = 'filled' AND closed_at IS NULL AND tier IS NOT NULL
     GROUP BY tier`,
    [userId]
  );
  const conservativePositions = positionsResult.rows.find(r => r.tier === 'conservative')?.count || 0;
  const aggressivePositions = positionsResult.rows.find(r => r.tier === 'aggressive')?.count || 0;

  // Max 2 positions per tier
  const maxPerTier = 2;
  const conservativeSlots = Math.max(0, maxPerTier - conservativePositions);
  const aggressiveSlots = Math.max(0, maxPerTier - aggressivePositions);

  let remainingCash = availableUsd;
  let executedCount = 0;

  // Process conservative tier first
  for (const signal of conservative) {
    if (executedCount >= conservativeSlots) break;
    if (signal.skipReason) continue;
    if (isPaused) {
      signal.skipReason = 'paused';
      continue;
    }

    // Calculate position size
    signal.positionSizeUsd = calculateDualModePositionSize(
      signal.confidence,
      portfolioValue,
      'conservative',
      settings
    ) * (signal.positionMultiplier || 1);

    // Check if we can afford
    if (remainingCash < signal.positionSizeUsd * 0.9) {
      signal.skipReason = 'insufficient_balance';
      continue;
    }

    // Execute
    const trade = await executeDualModeTrade(userId, signal, settings);
    if (trade) {
      await logSignal(userId, signal, true, trade.id);
      executedCount++;
      remainingCash -= signal.positionSizeUsd;
    }
  }

  // Process aggressive tier
  executedCount = 0;
  for (const signal of aggressive) {
    if (executedCount >= aggressiveSlots) break;
    if (signal.skipReason) continue;
    if (isPaused) {
      signal.skipReason = 'paused';
      continue;
    }

    // Calculate position size
    signal.positionSizeUsd = calculateDualModePositionSize(
      signal.confidence,
      portfolioValue,
      'aggressive',
      settings
    ) * (signal.positionMultiplier || 1);

    // Check if we can afford
    if (remainingCash < signal.positionSizeUsd * 0.9) {
      signal.skipReason = 'insufficient_balance';
      continue;
    }

    // Execute
    const trade = await executeDualModeTrade(userId, signal, settings);
    if (trade) {
      await logSignal(userId, signal, true, trade.id);
      executedCount++;
      remainingCash -= signal.positionSizeUsd;
    }
  }

  logger.info('Dual-mode trading complete', {
    userId,
    conservativeSignals: conservative.length,
    aggressiveSignals: aggressive.length,
    conservativeReady: conservative.filter(s => !s.skipReason).length,
    aggressiveReady: aggressive.filter(s => !s.skipReason).length,
    remainingCash: remainingCash.toFixed(2),
  });
}

/**
 * Execute an auto trade (long position - spot buy)
 */
async function executeAutoTrade(
  userId: string,
  signal: AutoSignal
): Promise<{ id: string } | null> {
  logger.info('Executing auto trade', {
    userId,
    symbol: signal.symbol,
    direction: signal.direction,
    confidence: signal.confidence.toFixed(2),
    rsi: signal.rsi.toFixed(1),
    volumeRatio: signal.volumeRatio.toFixed(2),
  });

  try {
    // Place the order
    const trade = await tradingService.placeOrder(userId, {
      symbol: signal.symbol,
      side: 'buy',
      type: 'market',
      quoteAmount: signal.positionSizeUsd,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      notes: `Auto trade: RSI ${signal.rsi.toFixed(1)}, Vol ${signal.volumeRatio.toFixed(1)}x, Conf ${(signal.confidence * 100).toFixed(0)}%`,
    });

    // Mark as auto trade with position side
    // Paper trades go to paper_trades table, real trades go to trades table
    const tradingSettings = await tradingService.getSettings(userId);
    if (tradingSettings.paperMode) {
      await pool.query(
        `UPDATE paper_trades SET source = 'auto' WHERE id = $1`,
        [trade.id]
      );
    } else {
      await pool.query(
        `UPDATE trades SET auto_trade = true, position_side = 'long' WHERE id = $1`,
        [trade.id]
      );
    }

    // Update state
    await pool.query(
      `INSERT INTO auto_trading_state (user_id, date, trades_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET
         trades_count = auto_trading_state.trades_count + 1,
         updated_at = NOW()`,
      [userId]
    );

    // Send notification
    await deliveryService.sendTradingNotification(
      userId,
      `Auto Trade: ${signal.symbol}`,
      `Bought $${signal.positionSizeUsd.toFixed(0)} at $${signal.currentPrice.toFixed(2)}\nRSI: ${signal.rsi.toFixed(1)} | Vol: ${signal.volumeRatio.toFixed(1)}x\nSL: $${signal.stopLoss.toFixed(2)} | TP: $${signal.takeProfit.toFixed(2)}`,
      'trading.auto_trade_opened',
      5,
      { tradeId: trade.id, symbol: signal.symbol }
    );

    // Add cooldown immediately after successful trade to prevent duplicate buys
    const settings = await getSettings(userId);
    await addSymbolCooldown(userId, signal.symbol, settings?.symbolCooldownMinutes || 15);

    logger.info('Auto trade executed successfully', {
      userId,
      tradeId: trade.id,
      symbol: signal.symbol,
      amount: signal.positionSizeUsd,
    });

    return { id: trade.id };
  } catch (error) {
    // Add short cooldown on failure to prevent rapid retries
    await addSymbolCooldown(userId, signal.symbol, 5); // 5 minute cooldown on failure

    logger.error('Failed to execute auto trade', {
      userId,
      symbol: signal.symbol,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Execute a margin SHORT trade
 * Opens a short position at 1x leverage using margin
 */
async function executeMarginShort(
  userId: string,
  signal: AutoSignal,
  settings: AutoTradingSettings
): Promise<{ id: string } | null> {
  logger.info('Executing margin short', {
    userId,
    symbol: signal.symbol,
    confidence: signal.confidence.toFixed(2),
    rsi: signal.rsi.toFixed(1),
    leverage: settings.marginLeverage,
  });

  try {
    // Place margin short order via trading service
    const trade = await tradingService.placeMarginOrder(userId, {
      symbol: signal.symbol,
      side: 'short',
      type: 'market',
      quoteAmount: signal.positionSizeUsd,
      leverage: settings.marginLeverage,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
    });

    // Mark as auto trade with position side
    await pool.query(
      `UPDATE trades SET auto_trade = true, position_side = 'short' WHERE id = $1`,
      [trade.id]
    );

    // Update state
    await pool.query(
      `INSERT INTO auto_trading_state (user_id, date, trades_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET
         trades_count = auto_trading_state.trades_count + 1,
         updated_at = NOW()`,
      [userId]
    );

    // Send notification
    const priceDecimals = signal.currentPrice < 1 ? 6 : 2;
    await deliveryService.sendTradingNotification(
      userId,
      `Auto SHORT: ${signal.symbol}`,
      `Shorted $${signal.positionSizeUsd.toFixed(0)} at $${signal.currentPrice.toFixed(priceDecimals)}\nRSI: ${signal.rsi.toFixed(1)} (overbought)\nSL: $${signal.stopLoss.toFixed(priceDecimals)} | TP: $${signal.takeProfit.toFixed(priceDecimals)}`,
      'trading.auto_trade_opened',
      5,
      { tradeId: trade.id, symbol: signal.symbol, direction: 'short' }
    );

    // Add cooldown
    await addSymbolCooldown(userId, signal.symbol, settings.symbolCooldownMinutes || 15);

    logger.info('Margin short executed successfully', {
      userId,
      tradeId: trade.id,
      symbol: signal.symbol,
      amount: signal.positionSizeUsd,
      leverage: settings.marginLeverage,
    });

    return { id: trade.id };
  } catch (error) {
    // Add short cooldown on failure
    await addSymbolCooldown(userId, signal.symbol, 5);

    logger.error('Failed to execute margin short', {
      userId,
      symbol: signal.symbol,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Handle trade close (called by order-monitor when SL/TP hits)
 */
export async function handleTradeClose(
  userId: string,
  tradeId: string,
  outcome: 'win' | 'loss',
  pnlUsd: number,
  symbol: string
): Promise<void> {
  const settings = await getSettings(userId);

  // Get portfolio value for P&L percentage
  const portfolio = await tradingService.getPortfolio(userId);
  const portfolioValue = portfolio?.totalValueUsdt || 1000;
  const pnlPct = (pnlUsd / portfolioValue) * 100;

  // Update state - increment trades_count on CLOSE (not open) for accurate win rate
  if (outcome === 'win') {
    await pool.query(
      `INSERT INTO auto_trading_state (user_id, date, wins_count, trades_count, daily_pnl_usd, daily_pnl_pct, consecutive_losses)
       VALUES ($1, CURRENT_DATE, 1, 1, $2, $3, 0)
       ON CONFLICT (user_id, date) DO UPDATE SET
         wins_count = auto_trading_state.wins_count + 1,
         trades_count = auto_trading_state.trades_count + 1,
         daily_pnl_usd = auto_trading_state.daily_pnl_usd + $2,
         daily_pnl_pct = auto_trading_state.daily_pnl_pct + $3,
         consecutive_losses = 0,
         updated_at = NOW()`,
      [userId, pnlUsd, pnlPct]
    );
  } else {
    // Loss
    const stateResult = await pool.query(
      `INSERT INTO auto_trading_state (user_id, date, losses_count, trades_count, daily_pnl_usd, daily_pnl_pct, consecutive_losses)
       VALUES ($1, CURRENT_DATE, 1, 1, $2, $3, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET
         losses_count = auto_trading_state.losses_count + 1,
         trades_count = auto_trading_state.trades_count + 1,
         daily_pnl_usd = auto_trading_state.daily_pnl_usd + $2,
         daily_pnl_pct = auto_trading_state.daily_pnl_pct + $3,
         consecutive_losses = auto_trading_state.consecutive_losses + 1,
         updated_at = NOW()
       RETURNING consecutive_losses, daily_pnl_pct`,
      [userId, pnlUsd, pnlPct]
    );

    const newState = stateResult.rows[0];
    const consecutiveLosses = newState?.consecutive_losses || 1;
    const dailyPnlPctTotal = parseFloat(newState?.daily_pnl_pct) || pnlPct;

    // Check if we need to pause
    let pauseReason: string | null = null;
    if (consecutiveLosses >= settings.maxConsecutiveLosses) {
      pauseReason = `${consecutiveLosses} consecutive losses`;
    } else if (dailyPnlPctTotal <= -settings.dailyLossLimitPct) {
      pauseReason = `Daily loss limit hit (${dailyPnlPctTotal.toFixed(1)}%)`;
    }

    if (pauseReason) {
      await pool.query(
        `UPDATE auto_trading_state SET is_paused = true, pause_reason = $2, updated_at = NOW()
         WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId, pauseReason]
      );

      // Notify user
      await deliveryService.sendTradingNotification(
        userId,
        'Auto Trading Paused',
        pauseReason,
        'trading.auto_trade_paused',
        8,
        { reason: pauseReason }
      );

      logger.warn('Auto trading paused', { userId, pauseReason });
    }
  }

  // Add symbol to cooldown
  await addSymbolCooldown(userId, symbol, settings.symbolCooldownMinutes);

  logger.info('Auto trade closed', {
    userId,
    tradeId,
    symbol,
    outcome,
    pnlUsd: pnlUsd.toFixed(2),
  });
}

/**
 * Get today's auto trade history
 */
export async function getHistory(userId: string): Promise<any[]> {
  const result = await pool.query(
    `SELECT t.*,
      CASE
        WHEN t.close_reason = 'take_profit' THEN 'win'
        WHEN t.close_reason = 'stop_loss' THEN 'loss'
        ELSE 'pending'
      END as outcome
     FROM trades t
     WHERE t.user_id = $1
       AND t.auto_trade = true
       AND t.created_at >= CURRENT_DATE
     ORDER BY t.created_at DESC
     LIMIT 50`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    quantity: parseFloat(row.quantity),
    entryPrice: parseFloat(row.filled_price) || parseFloat(row.price),
    closePrice: row.close_price ? parseFloat(row.close_price) : null,
    stopLoss: row.stop_loss_price ? parseFloat(row.stop_loss_price) : null,
    takeProfit: row.take_profit_price ? parseFloat(row.take_profit_price) : null,
    status: row.status,
    outcome: row.outcome,
    closeReason: row.close_reason,
    notes: row.notes,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  }));
}

/**
 * Main auto trading job - runs every 30 seconds
 */
export async function runAutoTradingJob(): Promise<void> {
  // Get all users with auto trading enabled
  const usersResult = await pool.query(
    `SELECT user_id FROM auto_trading_settings WHERE enabled = true`
  );

  logger.debug('Auto trading job running', { usersCount: usersResult.rows.length });

  for (const row of usersResult.rows) {
    const userId = row.user_id;

    try {
      await processUserAutoTrading(userId);
    } catch (error) {
      logger.error('Error in auto trading job for user', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Process auto trading for a single user
 */
async function processUserAutoTrading(userId: string): Promise<void> {
  const settings = await getSettings(userId);
  const state = await getState(userId);

  // Check if paused - still scan signals for backtesting
  const isPaused = state.isPaused;

  // Get portfolio value
  const portfolio = await tradingService.getPortfolio(userId);
  if (!portfolio || portfolio.totalValueUsdt < 10) {
    logger.debug('Auto trading skipped - insufficient portfolio', {
      userId,
      hasPortfolio: !!portfolio,
      totalValue: portfolio?.totalValueUsdt || 0,
    });
    return;
  }

  // Calculate available USD and its percentage of portfolio
  const usdHolding = portfolio.holdings.find(h => h.asset === 'USD' || h.asset === 'USDT' || h.asset === 'USDC');
  const availableUsd = usdHolding?.valueUsdt || 0;
  const usdPercentage = (availableUsd / portfolio.totalValueUsdt) * 100;
  const hasSignificantCash = usdPercentage >= 30;

  // Determine if at max positions - but override if we have significant cash (manual sell detected)
  const atMaxPositions = state.activePositions >= settings.maxPositions && !hasSignificantCash;

  // Log if cash detected from manual activity
  if (hasSignificantCash && state.activePositions >= settings.maxPositions) {
    logger.info('Significant cash detected - likely manual sell', {
      userId,
      availableUsd: availableUsd.toFixed(2),
      usdPercentage: usdPercentage.toFixed(1),
      activePositions: state.activePositions,
    });
  }

  logger.info('Processing auto trading', {
    userId,
    strategy: settings.strategy,
    strategyMode: settings.strategyMode,
    isPaused,
    atMaxPositions,
    portfolioValue: portfolio.totalValueUsdt,
  });

  // Detect current market regime
  const regimeData = await detectMarketRegime();

  // DUAL-MODE: Use separate logic for dual-mode trading
  if (settings.dualModeEnabled) {
    await processDualModeTrading(userId, settings, state, portfolio, regimeData, availableUsd, isPaused);
    return;
  }

  // Select strategy based on mode
  let activeStrategy: StrategyId;
  if (settings.strategyMode === 'auto') {
    // Auto mode: select best strategy based on regime + win rate
    const selection = await selectBestStrategy(userId, regimeData);
    activeStrategy = selection.selectedStrategy;
    logger.debug('Auto mode selected strategy', {
      userId,
      strategy: activeStrategy,
      regime: regimeData.regime,
      score: selection.totalScore.toFixed(2),
    });
  } else {
    // Manual mode: use configured strategy
    activeStrategy = settings.strategy;
  }

  // Scan for signals using the active strategy
  const signals = await scanForSignals(userId, settings, regimeData, activeStrategy);

  // Get top 5 candidates for the active strategy
  const topSymbols = await getTopCandidates(activeStrategy);
  const topCandidates = topSymbols.slice(0, 3).map(s => {
    const base = s.symbol.replace('_USD', '');
    if (activeStrategy === 'rsi_oversold') {
      return `${base}: RSI=${s.rsi.toFixed(1)}, Vol=${s.volumeRatio.toFixed(1)}x${s.meetsConditions ? ' [READY]' : ''}`;
    } else if (activeStrategy === 'trend_following') {
      const emaOk = (s.ema20 || 0) > (s.ema50 || 0);
      const diOk = (s.plusDi || 0) > (s.minusDi || 0);
      return `${base}: ADX=${(s.adx || 0).toFixed(0)}, EMA=${emaOk ? 'OK' : 'X'}, DI=${diOk ? '+' : '-'}${s.meetsConditions ? ' [READY]' : ''}`;
    }
    return `${base}: RSI=${s.rsi.toFixed(1)}${s.meetsConditions ? ' [READY]' : ''}`;
  });

  logger.info('Auto trading scan complete', {
    userId,
    strategy: activeStrategy,
    regime: regimeData.regime,
    signalsFound: signals.length,
    topCandidates: topCandidates.length > 0 ? topCandidates.join('; ') : 'no data',
  });

  if (signals.length === 0) {
    return;
  }

  // Log ALL detected signals for backtesting
  let executedCount = 0;
  let remainingCash = availableUsd;

  // Calculate available slots - if we have significant cash, allow at least 1 slot
  let availableSlots = settings.maxPositions - state.activePositions;
  if (availableSlots <= 0 && hasSignificantCash) {
    availableSlots = 1; // Allow 1 trade when manual sell detected
  }

  for (const signal of signals) {
    // Calculate position size for all signals
    // Apply position multiplier from BTC influence
    const baseSize = calculatePositionSize(
      signal.confidence,
      portfolio.totalValueUsdt,
      settings.minPositionPct,
      settings.maxPositionPct,
      settings.minPositionUsd,
      settings.maxPositionUsd
    );
    signal.positionSizeUsd = baseSize * (signal.positionMultiplier || 1);

    // Ensure we have enough cash for this trade
    const canAfford = remainingCash >= signal.positionSizeUsd * 0.9; // 90% to account for fees

    // Check minimum profit threshold (to cover fees)
    const expectedProfitPct = ((signal.takeProfit - signal.currentPrice) / signal.currentPrice) * 100;
    const meetsMinProfit = expectedProfitPct >= settings.minProfitPct;

    // Determine skip reason if any
    if (!signal.skipReason) {
      if (isPaused) {
        signal.skipReason = 'paused';
      } else if (!meetsMinProfit) {
        signal.skipReason = 'profit_below_fee_threshold';
      } else if (executedCount >= availableSlots) {
        signal.skipReason = 'max_positions';
      } else if (!canAfford) {
        signal.skipReason = 'insufficient_balance';
      } else if (signal.positionSizeUsd < 5) {
        signal.skipReason = 'insufficient_size';
      }
    }

    // Should we execute this signal?
    const shouldExecute = !signal.skipReason && executedCount < availableSlots;

    if (shouldExecute) {
      // Execute the trade and get trade ID
      const trade = await executeAutoTrade(userId, signal);

      // Log executed signal
      if (trade) {
        await logSignal(userId, signal, true, trade.id);
        executedCount++;
        state.activePositions++;
        remainingCash -= signal.positionSizeUsd; // Track spent cash
      }
    } else {
      // Log skipped signal for backtesting
      await logSignal(userId, signal, false);
    }
  }

  // MARGIN SHORTS: Scan for short signals if margin mode is enabled
  if (settings.marginEnabled && settings.shortEnabled) {
    logger.info('Scanning for margin short signals', {
      userId,
      marginLeverage: settings.marginLeverage,
      shortRsiThreshold: settings.shortRsiThreshold,
    });

    const shortSignals = await scanForShortSignals(userId, settings, regimeData);

    logger.info('Short signal scan complete', {
      userId,
      shortSignalsFound: shortSignals.length,
      shortSignalsReady: shortSignals.filter(s => !s.skipReason).length,
    });

    // Process short signals (separate from long positions)
    let shortExecutedCount = 0;
    const maxShortPositions = Math.max(1, Math.floor(settings.maxPositions / 2)); // Allow half as many shorts

    for (const signal of shortSignals) {
      // Calculate position size for short
      signal.positionSizeUsd = calculatePositionSize(
        signal.confidence,
        portfolio.totalValueUsdt,
        settings.minPositionPct,
        settings.maxPositionPct,
        settings.minPositionUsd,
        settings.maxPositionUsd
      );

      // Check if we can afford margin for this position
      const canAffordMargin = availableUsd >= signal.positionSizeUsd * 0.5; // Margin requires less capital

      // For shorts: expected profit is when price goes DOWN
      const expectedProfitPct = ((signal.currentPrice - signal.takeProfit) / signal.currentPrice) * 100;
      const meetsMinProfit = expectedProfitPct >= settings.minProfitPct;

      // Determine skip reason
      if (!signal.skipReason) {
        if (isPaused) {
          signal.skipReason = 'paused';
        } else if (!meetsMinProfit) {
          signal.skipReason = 'profit_below_fee_threshold';
        } else if (shortExecutedCount >= maxShortPositions) {
          signal.skipReason = 'max_short_positions';
        } else if (!canAffordMargin) {
          signal.skipReason = 'insufficient_margin';
        } else if (signal.positionSizeUsd < 10) {
          signal.skipReason = 'insufficient_size';
        }
      }

      const shouldExecuteShort = !signal.skipReason && shortExecutedCount < maxShortPositions;

      if (shouldExecuteShort) {
        const trade = await executeMarginShort(userId, signal, settings);

        if (trade) {
          await logSignal(userId, signal, true, trade.id);
          shortExecutedCount++;
        }
      } else {
        await logSignal(userId, signal, false);
      }
    }

    logger.info('Margin short processing complete', {
      userId,
      shortSignalsProcessed: shortSignals.length,
      shortPositionsOpened: shortExecutedCount,
    });
  }
}

/**
 * Get signal history with backtest results
 */
export async function getSignalHistory(
  userId: string,
  limit: number = 100
): Promise<SignalHistoryEntry[]> {
  const result = await pool.query(
    `SELECT * FROM auto_trading_signals
     WHERE user_id = $1
     ORDER BY detected_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    detectedAt: row.detected_at,
    rsi: parseFloat(row.rsi),
    volumeRatio: parseFloat(row.volume_ratio),
    confidence: parseFloat(row.confidence),
    entryPrice: parseFloat(row.entry_price),
    suggestedStopLoss: row.suggested_stop_loss ? parseFloat(row.suggested_stop_loss) : 0,
    suggestedTakeProfit: row.suggested_take_profit ? parseFloat(row.suggested_take_profit) : 0,
    executed: row.executed,
    skipReason: row.skip_reason,
    backtestStatus: row.backtest_status,
    backtestExitPrice: row.backtest_exit_price ? parseFloat(row.backtest_exit_price) : null,
    backtestExitAt: row.backtest_exit_at,
    backtestPnlPct: row.backtest_pnl_pct ? parseFloat(row.backtest_pnl_pct) : null,
    backtestDurationMinutes: row.backtest_duration_minutes,
  }));
}

/**
 * Backtest pending signals - check if price hit SL or TP
 * Run this as a background job every minute
 */
export async function backtestPendingSignals(): Promise<void> {
  // Get pending signals older than 5 minutes (give time for price movement)
  const result = await pool.query(
    `SELECT * FROM auto_trading_signals
     WHERE backtest_status = 'pending'
       AND detected_at < NOW() - INTERVAL '5 minutes'
       AND detected_at > NOW() - INTERVAL '24 hours'
     ORDER BY detected_at ASC
     LIMIT 50`
  );

  for (const signal of result.rows) {
    try {
      await backtestSingleSignal(signal);
    } catch (error) {
      logger.error('Error backtesting signal', {
        signalId: signal.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Mark signals older than 24 hours as timeout
  await pool.query(
    `UPDATE auto_trading_signals
     SET backtest_status = 'timeout',
         backtest_duration_minutes = 1440
     WHERE backtest_status = 'pending'
       AND detected_at < NOW() - INTERVAL '24 hours'`
  );
}

/**
 * Backtest a single signal using historical price data
 */
async function backtestSingleSignal(signal: any): Promise<void> {
  const entryPrice = parseFloat(signal.entry_price);
  const stopLoss = parseFloat(signal.suggested_stop_loss);
  const takeProfit = parseFloat(signal.suggested_take_profit);
  const detectedAt = new Date(signal.detected_at);

  // Get price history since signal detection
  try {
    // Use 1m candles for accurate backtest
    const klines = await tradingService.getKlines(signal.symbol, '1m', 500);
    if (!klines || klines.length === 0) {
      return; // No data, try again later
    }

    // Find candles after signal detection
    const relevantKlines = klines.filter(k => {
      const klineTime = new Date(k.openTime);
      return klineTime >= detectedAt;
    });

    if (relevantKlines.length === 0) {
      return; // No new candles yet
    }

    // Check each candle for SL or TP hit
    for (const kline of relevantKlines) {
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const klineTime = new Date(kline.openTime);
      const durationMinutes = Math.round((klineTime.getTime() - detectedAt.getTime()) / 60000);

      // For buy signals: TP is above entry, SL is below entry
      // Check if stop loss was hit first (low touched SL)
      if (low <= stopLoss) {
        const pnlPct = ((stopLoss - entryPrice) / entryPrice) * 100;
        await pool.query(
          `UPDATE auto_trading_signals
           SET backtest_status = 'loss',
               backtest_exit_price = $1,
               backtest_exit_at = $2,
               backtest_pnl_pct = $3,
               backtest_duration_minutes = $4
           WHERE id = $5`,
          [stopLoss, klineTime, pnlPct, durationMinutes, signal.id]
        );
        return;
      }

      // Check if take profit was hit (high touched TP)
      if (high >= takeProfit) {
        const pnlPct = ((takeProfit - entryPrice) / entryPrice) * 100;
        await pool.query(
          `UPDATE auto_trading_signals
           SET backtest_status = 'win',
               backtest_exit_price = $1,
               backtest_exit_at = $2,
               backtest_pnl_pct = $3,
               backtest_duration_minutes = $4
           WHERE id = $5`,
          [takeProfit, klineTime, pnlPct, durationMinutes, signal.id]
        );
        return;
      }
    }
    // Neither SL nor TP hit yet - remain pending
  } catch (error) {
    logger.error('Error fetching klines for backtest', {
      signalId: signal.id,
      symbol: signal.symbol,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get top signal candidates for a given strategy
 * Returns top 5 sorted by strategy-relevant metric
 */
export async function getTopCandidates(strategy: StrategyId = 'rsi_oversold'): Promise<{
  symbol: string;
  rsi: number;
  volumeRatio: number;
  price: number;
  score: number;
  meetsConditions: boolean;
  ema9?: number;
  ema21?: number;
  ema20?: number;
  ema50?: number;
  adx?: number;
  plusDi?: number;
  minusDi?: number;
}[]> {
  const candidates: {
    symbol: string;
    rsi: number;
    volumeRatio: number;
    price: number;
    score: number;
    ema9?: number;
    ema21?: number;
    ema20?: number;
    ema50?: number;
    adx?: number;
    plusDi?: number;
    minusDi?: number;
  }[] = [];

  for (const symbol of SCAN_SYMBOLS) {
    const indicators = await redisTradingService.getIndicators(symbol, '5m');
    if (!indicators || !indicators.rsi || !indicators.volume_ratio) {
      continue;
    }

    const priceData = await redisTradingService.getPrice(symbol);
    const price = priceData?.price || 0;

    // Calculate score based on strategy
    let score = 0;
    switch (strategy) {
      case 'rsi_oversold':
        // Lower RSI = higher score (primary), volume as tie-breaker
        score = (50 - indicators.rsi) * 10 + Math.min(indicators.volume_ratio, 3);
        break;
      case 'trend_following':
        // Higher ADX + EMA20>EMA50 alignment + bullish DI = higher score
        score = (indicators.adx || 0) +
          (indicators.ema_20 && indicators.ema_50 && indicators.ema_20 > indicators.ema_50 ? 20 : 0) +
          ((indicators.plus_di || 0) > (indicators.minus_di || 0) ? 10 : 0);
        break;
      case 'momentum':
        // MACD histogram strength
        score = Math.abs(indicators.macd_histogram || 0) * 1000;
        break;
      default:
        score = 50 - indicators.rsi; // Default to RSI-based
    }

    candidates.push({
      symbol,
      rsi: indicators.rsi,
      volumeRatio: indicators.volume_ratio,
      price,
      score,
      ema9: indicators.ema_9,
      ema21: indicators.ema_21,
      ema20: indicators.ema_20,
      ema50: indicators.ema_50,
      adx: indicators.adx,
      plusDi: indicators.plus_di,
      minusDi: indicators.minus_di,
    });
  }

  // Sort by score (highest first) and take top 5
  candidates.sort((a, b) => b.score - a.score);
  const top5 = candidates.slice(0, 5);

  // Add condition check based on strategy
  return top5.map(c => {
    let meetsConditions = false;
    switch (strategy) {
      case 'rsi_oversold':
        meetsConditions = c.rsi < 35 && c.volumeRatio >= 1.0;
        break;
      case 'trend_following':
        // All 4 conditions: EMA20>EMA50, ADX>25, Price>EMA20, +DI>-DI
        meetsConditions = (c.adx || 0) > 25 &&
          (c.ema20 || 0) > (c.ema50 || 0) &&
          c.price > (c.ema20 || 0) &&
          (c.plusDi || 0) > (c.minusDi || 0);
        break;
      case 'momentum':
        meetsConditions = c.rsi > 50 && c.volumeRatio >= 1.5;
        break;
      default:
        meetsConditions = c.rsi < 35;
    }
    return { ...c, meetsConditions };
  });
}

/**
 * Get available strategies with metadata
 */
export function getAvailableStrategies() {
  return getStrategyMetaList();
}

/**
 * Get current market regime
 */
export async function getMarketRegime() {
  return detectMarketRegime();
}

/**
 * Get strategy performance for a user
 */
export async function getStrategyPerformance(userId: string) {
  return getAllStrategyPerformances(userId);
}

// Re-export types and strategy-related functions
export { StrategyId, MarketRegime };
export { recordTradeResult } from './auto-mode-selector.service.js';

// ============================================================================
// PORTFOLIO RECONCILIATION
// ============================================================================

export interface OrphanPosition {
  symbol: string;
  asset: string;
  amount: number;
  valueUsd: number;
  currentPrice: number;
  hasActiveTrade: boolean;
  trailingStopAdded: boolean;
}

export interface ReconciliationResult {
  orphanPositions: OrphanPosition[];
  missingFromPortfolio: string[];
  reconciled: number;
  lastReconcileAt: string;
}

/**
 * Reconcile portfolio holdings with active trades
 * Detects orphan positions (holdings > $20 without active trade) and auto-creates trailing SL
 */
export async function reconcilePortfolio(userId: string): Promise<ReconciliationResult> {
  const portfolio = await tradingService.getPortfolio(userId);

  // If no portfolio data, return empty result
  if (!portfolio || !portfolio.holdings) {
    return {
      orphanPositions: [],
      missingFromPortfolio: [],
      reconciled: 0,
      lastReconcileAt: new Date().toISOString(),
    };
  }

  // Get active trades from database
  const tradesResult = await pool.query(
    `SELECT symbol, quantity, filled_price FROM trades
     WHERE user_id = $1 AND status = 'filled' AND closed_at IS NULL AND quantity > 0`,
    [userId]
  );

  // Normalize trade symbols to base asset for comparison
  // Trades use format like BONK_USD, portfolio uses BONKUSDT
  const tradeBaseAssets = new Set(
    tradesResult.rows.map((t) => getBaseQuote(t.symbol).base.toUpperCase())
  );
  const orphans: OrphanPosition[] = [];
  const settings = await getSettings(userId);
  const trailingPct = settings.initialStopLossPct || 5.0;

  // Find orphan positions (in portfolio but no active trade)
  for (const holding of portfolio.holdings) {
    // Skip USD/USDT/USDC - these are quote currencies
    if (['USD', 'USDT', 'USDC'].includes(holding.asset)) continue;

    // Normalize holding symbol to base asset for comparison
    const holdingBase = (getBaseQuote(holding.symbol).base || holding.asset).toUpperCase();

    if (holding.valueUsdt > 20 && !tradeBaseAssets.has(holdingBase)) {
      orphans.push({
        symbol: holding.symbol,
        asset: holding.asset,
        amount: holding.amount,
        valueUsd: holding.valueUsdt,
        currentPrice: holding.price,
        hasActiveTrade: false,
        trailingStopAdded: false,
      });
    }
  }

  // Auto-create trades with trailing SL for orphans
  let reconciled = 0;
  for (const orphan of orphans) {
    try {
      await createOrphanTrade(userId, orphan, trailingPct);
      orphan.trailingStopAdded = true;
      reconciled++;
      logger.info('Created orphan trade with trailing SL', {
        userId,
        symbol: orphan.symbol,
        amount: orphan.amount,
        valueUsd: orphan.valueUsd.toFixed(2),
        trailingPct,
      });
    } catch (err) {
      logger.error('Failed to create orphan trade', {
        userId,
        symbol: orphan.symbol,
        error: (err as Error).message,
      });
    }
  }

  // Find trades missing from portfolio (manual sells)
  // Normalize portfolio symbols to base asset for comparison
  const portfolioBaseAssets = new Set(
    portfolio.holdings.map((h) => (getBaseQuote(h.symbol).base || h.asset).toUpperCase())
  );
  const missingFromPortfolio: string[] = [];

  for (const trade of tradesResult.rows) {
    const tradeBase = getBaseQuote(trade.symbol).base.toUpperCase();
    if (!portfolioBaseAssets.has(tradeBase)) {
      missingFromPortfolio.push(trade.symbol);
      // Mark trade as closed (manual sell)
      await pool.query(
        `UPDATE trades SET status = 'cancelled', close_reason = 'manual_sell', closed_at = NOW()
         WHERE user_id = $1 AND symbol = $2 AND status = 'filled' AND closed_at IS NULL`,
        [userId, trade.symbol]
      );
      logger.info('Detected manual sell - closed trade', { userId, symbol: trade.symbol, tradeBase });
    }
  }

  return {
    orphanPositions: orphans,
    missingFromPortfolio,
    reconciled,
    lastReconcileAt: new Date().toISOString(),
  };
}

/**
 * Create a synthetic trade record for an orphan position with trailing SL
 */
async function createOrphanTrade(
  userId: string,
  orphan: OrphanPosition,
  trailingStopPct: number
): Promise<void> {
  const tradeId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO trades (
      id, user_id, symbol, side, order_type, quantity, filled_price,
      total, status, trailing_stop_pct, notes, auto_trade, filled_at, exchange
    ) VALUES ($1, $2, $3, 'buy', 'market', $4, $5, $6, 'filled', $7, $8, true, NOW(), 'crypto_com')`,
    [
      tradeId,
      userId,
      orphan.symbol,
      orphan.amount,
      orphan.currentPrice,
      orphan.valueUsd,
      trailingStopPct,
      `Auto-created for orphan position (no active trade found). Trailing SL: ${trailingStopPct}%`,
    ]
  );
}

export default {
  getSettings,
  updateSettings,
  getState,
  startAutoTrading,
  stopAutoTrading,
  handleTradeClose,
  getHistory,
  getSignalHistory,
  getTopCandidates,
  backtestPendingSignals,
  runAutoTradingJob,
  getAvailableStrategies,
  getMarketRegime,
  getStrategyPerformance,
  reconcilePortfolio,
};
