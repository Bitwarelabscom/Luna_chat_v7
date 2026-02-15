/**
 * Bot Executor Service
 *
 * Handles execution of trading bots and conditional orders:
 * - Price-triggered orders ("if BTC drops below 90k, buy")
 * - Trailing stop with dollar amounts
 * - Grid/DCA/RSI strategies
 *
 * Integrates with the job runner for periodic execution
 */

import { pool } from '../db/index.js';
import redis from '../db/redis.js';
import { CryptoComClient } from './crypto-com.client.js';
import { getExchangeClient } from './exchange.factory.js';
import { toCryptoComSymbol } from './symbol-utils.js';
import * as tradingService from './trading.service.js';
import * as tradeNotification from './trade-notification.service.js';
import * as redisTradingService from './redis-trading.service.js';
import logger from '../utils/logger.js';

// ============================================
// Utilities
// ============================================

/**
 * Format price for display - handles both large and tiny prices (meme coins)
 */
function formatPrice(price: number): string {
  if (price === 0) return '0';
  if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toFixed(4);
  return price.toPrecision(4);
}

// ============================================
// Types
// ============================================

export interface ConditionalOrder {
  id: string;
  userId: string;
  symbol: string;
  condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
  triggerPrice: number;
  action: {
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    amountType: 'quantity' | 'percentage' | 'quote';
    amount: number; // Either quantity, % of portfolio/asset, or quote amount
    limitPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingStopPct?: number;
    trailingStopDollar?: number; // Trailing stop by dollar amount
  };
  status: 'active' | 'triggered' | 'cancelled' | 'expired';
  expiresAt?: Date;
  createdAt: Date;
}

export interface GridBotConfig {
  // Note: symbol is stored in the database row (bot.symbol), not in config JSON
  upperPrice: number;
  lowerPrice: number;
  gridCount: number;
  totalInvestment: number;
  mode: 'arithmetic' | 'geometric';
  stopLoss?: number;
  takeProfit?: number;
  // Trailing grid options
  trailing?: boolean; // If true, grid follows price upward
  gridSpacingPct?: number; // Grid spacing as percentage (e.g., 1 = 1%)
}

export interface DCABotConfig {
  symbol: string;
  amountPerPurchase: number;
  intervalHours: number;
  totalPurchases: number;
  purchasesMade: number;
  lastPurchaseAt?: Date;
}

export interface RSIBotConfig {
  symbol: string;
  interval: string;
  oversoldThreshold: number;
  overboughtThreshold: number;
  amountPerTrade: number;
  cooldownMinutes: number;
  lastTradeAt?: Date;
  trailingStopPct?: number;
}

export interface MACrossBotConfig {
  symbol: string;
  interval: string;
  fastPeriod: number;
  slowPeriod: number;
  maType: 'sma' | 'ema';
  amountPerTrade: number;
  cooldownMinutes: number;
  lastTradeAt?: Date;
  lastCrossDirection?: 'up' | 'down';
  trailingStopPct?: number;
}

export interface MACDBotConfig {
  symbol: string;
  interval: string;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  amountPerTrade: number;
  cooldownMinutes: number;
  lastTradeAt?: Date;
  lastSignalDirection?: 'bullish' | 'bearish';
  trailingStopPct?: number;
}

export interface BreakoutBotConfig {
  symbol: string;
  interval: string;
  lookbackPeriod: number;
  breakoutThreshold: number;
  volumeMultiplier: number;
  amountPerTrade: number;
  cooldownMinutes: number;
  lastTradeAt?: Date;
  trailingStopPct?: number;
}

export interface MeanReversionBotConfig {
  symbol: string;
  interval: string;
  maPeriod: number;
  deviationThreshold: number;
  amountPerTrade: number;
  cooldownMinutes: number;
  lastTradeAt?: Date;
  trailingStopPct?: number;
}

export interface MomentumBotConfig {
  symbol: string;
  interval: string;
  rsiPeriod: number;
  momentumThreshold: number;
  volumeConfirmation: boolean;
  amountPerTrade: number;
  cooldownMinutes: number;
  lastTradeAt?: Date;
  lastDirection?: 'long' | 'short';
  trailingStopPct?: number;
}

// ============================================
// Exchange Client Management - Crypto.com only
// ============================================

import type { IExchangeClient } from './exchange.interface.js';

interface CachedClient {
  client: IExchangeClient;
  expiresAt: number;
}

const clientCache = new Map<string, CachedClient>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get Crypto.com exchange client for user (cached)
 */
async function getClient(userId: string): Promise<IExchangeClient | null> {
  const cached = clientCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  // Use exchange factory to get the Crypto.com client
  const client = await getExchangeClient(userId);
  if (!client) {
    return null;
  }

  clientCache.set(userId, {
    client,
    expiresAt: Date.now() + CLIENT_CACHE_TTL,
  });

  return client;
}

// ============================================
// Conditional Orders
// ============================================

/**
 * Create a conditional order (price-triggered trade)
 */
export async function createConditionalOrder(
  userId: string,
  params: {
    symbol: string;
    condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
    triggerPrice: number;
    action: ConditionalOrder['action'];
    expiresInHours?: number;
  }
): Promise<ConditionalOrder> {
  const expiresAt = params.expiresInHours
    ? new Date(Date.now() + params.expiresInHours * 60 * 60 * 1000)
    : null;

  const result = await pool.query(
    `INSERT INTO conditional_orders (
      id, user_id, symbol, condition, trigger_price, action,
      status, expires_at, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active', $6, NOW())
    RETURNING *`,
    [
      userId,
      params.symbol,
      params.condition,
      params.triggerPrice,
      JSON.stringify(params.action),
      expiresAt,
    ]
  );

  const row = result.rows[0];
  logger.info('Conditional order created', {
    userId,
    symbol: params.symbol,
    condition: params.condition,
    triggerPrice: params.triggerPrice,
  });

  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    condition: row.condition,
    triggerPrice: parseFloat(row.trigger_price),
    action: row.action,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Get conditional orders for a user
 */
export async function getConditionalOrders(
  userId: string,
  status?: 'active' | 'triggered' | 'cancelled' | 'expired'
): Promise<ConditionalOrder[]> {
  let query = `
    SELECT * FROM conditional_orders
    WHERE user_id = $1
  `;
  const params: (string | undefined)[] = [userId];

  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    condition: row.condition,
    triggerPrice: parseFloat(row.trigger_price),
    action: row.action,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * Cancel a conditional order
 * Supports both full UUID and prefix matching (e.g., first 8 chars)
 */
export async function cancelConditionalOrder(userId: string, orderId: string): Promise<boolean> {
  // First try exact match (full UUID)
  let result = await pool.query(
    `UPDATE conditional_orders
     SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'active'
     RETURNING id`,
    [orderId, userId]
  );

  // If no exact match and orderId looks like a prefix (not a full UUID), try prefix match
  if (result.rows.length === 0 && orderId.length < 36) {
    result = await pool.query(
      `UPDATE conditional_orders
       SET status = 'cancelled'
       WHERE id::text LIKE $1 AND user_id = $2 AND status = 'active'
       RETURNING id`,
      [orderId + '%', userId]
    );
  }

  if (result.rows.length > 0) {
    logger.info('Conditional order cancelled', { userId, orderId, matchedId: result.rows[0].id });
    return true;
  }

  return false;
}

/**
 * Check and execute conditional orders
 */
export async function checkConditionalOrders(): Promise<{ executed: number; errors: number }> {
  let executed = 0;
  let errors = 0;

  try {
    // Get active conditional orders
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      condition: string;
      trigger_price: string;
      action: ConditionalOrder['action'];
      last_price: string | null;
    }>(`
      SELECT id, user_id, symbol, condition, trigger_price, action, last_price
      FROM conditional_orders
      WHERE status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
    `);

    if (result.rows.length === 0) return { executed, errors };

    // Get unique symbols and normalize to Crypto.com format
    const symbols = [...new Set(result.rows.map(r => toCryptoComSymbol(r.symbol)))];

    // Fetch current prices from Redis cache (single batch operation)
    let priceMap = await redisTradingService.getPricesBatch(symbols);

    // Fallback to API if Redis cache is empty
    if (priceMap.size === 0) {
      logger.warn('Redis price cache empty for conditional orders, falling back to API');
      try {
        const cryptoClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
        const cryptoTickers = await cryptoClient.getTicker24hr();
        const tickerArray = Array.isArray(cryptoTickers) ? cryptoTickers : [cryptoTickers];
        for (const t of tickerArray) {
          const cryptoSymbol = toCryptoComSymbol(t.symbol);
          if (symbols.includes(cryptoSymbol)) {
            priceMap.set(cryptoSymbol, parseFloat(t.lastPrice));
          }
        }
      } catch (err) {
        logger.warn('Failed to fetch Crypto.com prices for conditional orders', { error: (err as Error).message });
      }
    }

    for (const order of result.rows) {
      const normalizedSymbol = toCryptoComSymbol(order.symbol);
      const currentPrice = priceMap.get(normalizedSymbol);
      if (!currentPrice) continue;

      const triggerPrice = parseFloat(order.trigger_price);
      const lastPrice = order.last_price ? parseFloat(order.last_price) : null;
      let shouldTrigger = false;

      switch (order.condition) {
        case 'below':
          shouldTrigger = currentPrice <= triggerPrice;
          break;
        case 'above':
          shouldTrigger = currentPrice >= triggerPrice;
          break;
        case 'crosses_down':
          // Price crossed down through trigger price
          shouldTrigger = lastPrice !== null && lastPrice > triggerPrice && currentPrice <= triggerPrice;
          break;
        case 'crosses_up':
          // Price crossed up through trigger price
          shouldTrigger = lastPrice !== null && lastPrice < triggerPrice && currentPrice >= triggerPrice;
          break;
      }

      // Update last price for cross detection
      await pool.query(
        `UPDATE conditional_orders SET last_price = $1 WHERE id = $2`,
        [currentPrice, order.id]
      );

      if (shouldTrigger) {
        try {
          await executeConditionalOrder(order.user_id, order.id, order.symbol, order.action, currentPrice);
          executed++;
        } catch (err) {
          errors++;
          const errorMessage = (err as Error).message;
          logger.error('Failed to execute conditional order', {
            orderId: order.id,
            error: errorMessage,
          });
          // Mark order as failed so it doesn't keep retrying
          await pool.query(
            `UPDATE conditional_orders SET status = 'failed', notes = $2, triggered_at = NOW() WHERE id = $1`,
            [order.id, `Failed: ${errorMessage}`]
          );
          // Notify user about the failure
          tradeNotification.notifyConditionalOrderFailed(
            order.user_id,
            order.symbol,
            order.condition,
            parseFloat(order.trigger_price),
            order.action.side,
            errorMessage
          );
        }
      }
    }

    // Clean up expired orders
    await pool.query(
      `UPDATE conditional_orders SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()`
    );
  } catch (error) {
    logger.error('Conditional order check failed', { error: (error as Error).message });
    errors++;
  }

  return { executed, errors };
}

/**
 * Execute a triggered conditional order
 */
async function executeConditionalOrder(
  userId: string,
  orderId: string,
  symbol: string,
  action: ConditionalOrder['action'],
  currentPrice: number
): Promise<void> {
  // Check if user is in paper mode - if so, no exchange client needed
  const settings = await tradingService.getSettings(userId);
  const isPaperMode = settings.paperMode;

  if (!isPaperMode) {
    const client = await getClient(userId);
    if (!client) {
      throw new Error('Crypto.com client not available');
    }
  }

  // Calculate quantity based on amount type
  let quantity: number | undefined;
  let quoteAmount: number | undefined;

  if (action.amountType === 'quantity') {
    quantity = action.amount;
  } else if (action.amountType === 'quote') {
    quoteAmount = action.amount;
  } else if (action.amountType === 'percentage') {
    // Get portfolio to calculate percentage
    const portfolio = await tradingService.getPortfolio(userId);
    if (!portfolio) {
      throw new Error('Failed to get portfolio');
    }

    if (action.side === 'buy') {
      // % of available quote currency
      quoteAmount = (portfolio.availableUsdt * action.amount) / 100;
    } else {
      // % of held asset
      const asset = symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (!holding) {
        throw new Error(`No ${asset} holdings found`);
      }
      quantity = (holding.amount * action.amount) / 100;
    }
  }

  // Calculate trailing stop price if dollar amount specified
  let trailingStopPct = action.trailingStopPct;
  if (action.trailingStopDollar && currentPrice > 0) {
    // Convert dollar amount to percentage
    trailingStopPct = (action.trailingStopDollar / currentPrice) * 100;
  }

  // Place the order (tradingService.placeOrder handles paper vs live mode)
  const modeLabel = isPaperMode ? '[PAPER] ' : '';
  await tradingService.placeOrder(userId, {
    symbol,
    side: action.side,
    type: action.type,
    quantity,
    quoteAmount,
    price: action.limitPrice,
    stopLoss: action.stopLoss,
    takeProfit: action.takeProfit,
    trailingStopPct,
    notes: `${modeLabel}Conditional order ${orderId} triggered at $${currentPrice}`,
  });

  // Mark order as triggered
  await pool.query(
    `UPDATE conditional_orders SET status = 'triggered', triggered_at = NOW() WHERE id = $1`,
    [orderId]
  );

  logger.info('Conditional order executed', {
    orderId,
    symbol,
    side: action.side,
    currentPrice,
  });
}

// ============================================
// Grid Bot Execution
// ============================================

/**
 * Execute grid bot logic
 */
export async function executeGridBot(botId: string): Promise<{ trades: number }> {
  let trades = 0;

  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'grid' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { trades };

  const bot = botResult.rows[0];
  const config = bot.config as GridBotConfig;
  const userId = bot.user_id;

  // Get symbol from bot row (not config - symbol is stored as a column)
  const botSymbol = bot.symbol as string;

  // Get current price from Redis cache first, then public API fallback.
  const symbol = toCryptoComSymbol(botSymbol);
  let currentPrice = 0;

  const cachedPrice = await redisTradingService.getPrice(symbol);
  if (cachedPrice) {
    currentPrice = cachedPrice.price;
  } else {
    try {
      const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
      const ticker = await publicClient.getTickerPrice(symbol) as { price: string };
      currentPrice = parseFloat(ticker.price);
    } catch (err) {
      logger.warn('Grid bot skipped - unable to fetch price', {
        botId,
        symbol,
        error: (err as Error).message,
      });
      return { trades };
    }
  }

  logger.info('Grid bot price check', { botId, symbol, currentPrice, botSymbol });

  // Trailing grid: if price moves above upper bound, shift grid up
  if (config.trailing && config.gridSpacingPct && currentPrice > config.upperPrice) {
    const spacingMultiplier = config.gridSpacingPct / 100;
    const newUpperPrice = currentPrice;
    const newLowerPrice = currentPrice * (1 - spacingMultiplier * config.gridCount);

    // Update stop loss to trail (keep same distance below grid)
    const oldStopLossDistance = config.lowerPrice - (config.stopLoss || 0);
    const newStopLoss = config.stopLoss ? newLowerPrice - oldStopLossDistance : undefined;

    logger.info('Trailing grid shifted up', {
      botId,
      oldUpper: config.upperPrice,
      oldLower: config.lowerPrice,
      newUpper: newUpperPrice,
      newLower: newLowerPrice,
      newStopLoss,
    });

    // Update config in database
    const newConfig = {
      ...config,
      upperPrice: newUpperPrice,
      lowerPrice: newLowerPrice,
      stopLoss: newStopLoss,
    };
    await pool.query(
      `UPDATE trading_bots SET config = $1 WHERE id = $2`,
      [JSON.stringify(newConfig), botId]
    );

    // Update local config for this execution
    config.upperPrice = newUpperPrice;
    config.lowerPrice = newLowerPrice;
    if (newStopLoss) config.stopLoss = newStopLoss;

    // Clear positions when grid shifts (they're no longer at valid levels)
    const stateKey = `grid:${botId}:state`;
    await redis.set(stateKey, JSON.stringify({ lastLevel: -1, positions: [] }));
  }

  // Check stop loss / take profit
  if (config.stopLoss && currentPrice <= config.stopLoss) {
    logger.warn('Grid bot hit stop loss', { botId, currentPrice, stopLoss: config.stopLoss });
    await tradingService.updateBotStatus(userId, botId, 'stopped', 'Stop loss triggered');
    await tradeNotification.notifyBotStatusChange(userId, {
      id: botId,
      name: bot.name,
      type: 'grid',
      symbol: botSymbol,
      status: 'stopped',
      reason: `Stop loss triggered at $${formatPrice(currentPrice)} (SL: $${formatPrice(config.stopLoss)})`,
    });
    return { trades };
  }

  if (config.takeProfit && currentPrice >= config.takeProfit) {
    logger.info('Grid bot hit take profit', { botId, currentPrice, takeProfit: config.takeProfit });
    await tradingService.updateBotStatus(userId, botId, 'stopped', 'Take profit triggered');
    await tradeNotification.notifyBotStatusChange(userId, {
      id: botId,
      name: bot.name,
      type: 'grid',
      symbol: botSymbol,
      status: 'stopped',
      reason: `Take profit triggered at $${formatPrice(currentPrice)} (TP: $${formatPrice(config.takeProfit)})`,
    });
    return { trades };
  }

  // Calculate grid levels
  const gridStep = config.mode === 'arithmetic'
    ? (config.upperPrice - config.lowerPrice) / config.gridCount
    : Math.pow(config.upperPrice / config.lowerPrice, 1 / config.gridCount) - 1;

  const levels: number[] = [];
  for (let i = 0; i <= config.gridCount; i++) {
    if (config.mode === 'arithmetic') {
      levels.push(config.lowerPrice + gridStep * i);
    } else {
      levels.push(config.lowerPrice * Math.pow(1 + gridStep, i));
    }
  }

  // Get grid state from Redis
  const stateKey = `grid:${botId}:state`;
  const stateStr = await redis.get(stateKey);
  const state = stateStr ? JSON.parse(stateStr) : { lastLevel: -1, positions: [] };

  // Find which level we're at
  let currentLevel = -1;
  for (let i = 0; i < levels.length; i++) {
    if (currentPrice >= levels[i] && (i === levels.length - 1 || currentPrice < levels[i + 1])) {
      currentLevel = i;
      break;
    }
  }

  logger.info('Grid bot level check', {
    botId,
    currentLevel,
    lastLevel: state.lastLevel,
    currentPrice,
    levelChanged: currentLevel !== state.lastLevel,
  });

  // Execute grid logic
  const amountPerGrid = config.totalInvestment / config.gridCount;

  // Initialize grid: on first run, buy at all levels below current price
  if (state.lastLevel === -1 && currentLevel >= 0 && currentLevel < config.gridCount) {
    logger.info('Grid bot initializing - buying at levels below current price', {
      botId,
      currentLevel,
      levelsToBuy: currentLevel,
    });

    const symbolInfo = await tradingService.getSymbolInfo(botSymbol);
    const stepSize = symbolInfo?.stepSize ? parseFloat(symbolInfo.stepSize) : 1;
    const stopLossPrice = config.stopLoss || config.lowerPrice * 0.95;

    // Buy at each level below current price
    for (let level = currentLevel - 1; level >= 0; level--) {
      const levelPrice = levels[level];
      const rawBuyQty = amountPerGrid / levelPrice;
      const buyQty = stepSize >= 1
        ? Math.floor(rawBuyQty / stepSize) * stepSize
        : Math.floor(rawBuyQty * (1 / stepSize)) / (1 / stepSize);

      if (buyQty <= 0) continue;

      try {
        await tradingService.placeOrder(userId, {
          symbol: botSymbol,
          side: 'buy',
          type: 'market',
          quantity: buyQty,
          stopLoss: stopLossPrice,
          notes: `Grid bot ${botId} init buy at level ${level}`,
        });
        trades++;

        // Record position for this level
        if (!state.positions) state.positions = [];
        state.positions.push({
          level,
          quantity: buyQty,
          price: levelPrice,
        });

        logger.info('Grid bot init buy executed', { botId, level, price: levelPrice, quantity: buyQty });

        // Small delay between orders to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        logger.error('Grid bot init buy failed', { botId, level, error: (err as Error).message });
      }
    }

    await pool.query(
      `UPDATE trading_bots SET total_trades = total_trades + $1 WHERE id = $2`,
      [trades, botId]
    );

    // Save state and return - initialization complete
    state.lastLevel = currentLevel;
    await redis.set(stateKey, JSON.stringify(state));
    return { trades };
  }

  if (currentLevel !== state.lastLevel && currentLevel >= 0) {
    if (currentLevel < state.lastLevel) {
      // Price dropped - buy at this level
      try {
        // Use grid stop loss or default to lower grid bound
        const stopLossPrice = config.stopLoss || config.lowerPrice * 0.95;

        // Calculate buy quantity from USD amount and current price
        // For tokens like BONK with large step sizes (10000), use quantity instead of notional
        const rawBuyQty = amountPerGrid / currentPrice;

        // Get step size to round quantity (default to 1 if not available)
        const symbolInfo = await tradingService.getSymbolInfo(botSymbol);
        const stepSize = symbolInfo?.stepSize ? parseFloat(symbolInfo.stepSize) : 1;

        // Round down to nearest step size
        const buyQty = stepSize >= 1
          ? Math.floor(rawBuyQty / stepSize) * stepSize
          : Math.floor(rawBuyQty * (1 / stepSize)) / (1 / stepSize);

        logger.info('Grid bot buy calculation', {
          botId,
          amountPerGrid,
          currentPrice,
          rawBuyQty,
          stepSize,
          buyQty,
        });

        if (buyQty <= 0) {
          logger.warn('Grid bot buy quantity too small', { botId, buyQty, stepSize });
        } else {
          await tradingService.placeOrder(userId, {
            symbol: botSymbol,
            side: 'buy',
            type: 'market',
            quantity: buyQty,
            stopLoss: stopLossPrice,
            takeProfit: config.takeProfit,
            notes: `Grid bot ${botId} buy at level ${currentLevel}`,
          });
          trades++;

          await pool.query(
            `UPDATE trading_bots SET total_trades = total_trades + 1 WHERE id = $1`,
            [botId]
          );

          // Record position for profitable sell tracking
          if (!state.positions) state.positions = [];
          state.positions.push({
            level: currentLevel,
            quantity: buyQty,
            price: currentPrice,
          });

          logger.info('Grid bot buy executed', { botId, level: currentLevel, price: currentPrice, positionsCount: state.positions.length });
        }
      } catch (err) {
        logger.error('Grid bot buy failed', { botId, error: (err as Error).message });
      }
    } else if (currentLevel > state.lastLevel && state.lastLevel >= 0) {
      // Price rose - sell positions that were bought at LOWER levels (profitable sells only)
      try {
        // Find positions bought at lower levels than current
        const profitablePositions = (state.positions || []).filter(
          (pos: { level: number; quantity: number; price: number }) => pos.level < currentLevel
        );

        if (profitablePositions.length === 0) {
          logger.info('Grid bot sell skipped - no profitable positions', {
            botId,
            currentLevel,
            positions: state.positions?.length || 0,
          });
        } else {
          // Sell the oldest profitable position (FIFO)
          const positionToSell = profitablePositions[0];

          // Get step size to format quantity
          const symbolInfo = await tradingService.getSymbolInfo(botSymbol);
          const stepSize = symbolInfo?.stepSize ? parseFloat(symbolInfo.stepSize) : 1;

          // Round quantity to step size
          const sellQty = stepSize >= 1
            ? Math.floor(positionToSell.quantity / stepSize) * stepSize
            : Math.floor(positionToSell.quantity * (1 / stepSize)) / (1 / stepSize);

          if (sellQty <= 0) {
            logger.warn('Grid bot sell quantity too small', { botId, sellQty, stepSize });
          } else {
            await tradingService.placeOrder(userId, {
              symbol: botSymbol,
              side: 'sell',
              type: 'market',
              quantity: sellQty,
              notes: `Grid bot ${botId} sell at level ${currentLevel} (bought at level ${positionToSell.level})`,
            });
            trades++;

            // Remove the sold position from state
            state.positions = state.positions.filter(
              (pos: { level: number }) => pos !== positionToSell
            );

            await pool.query(
              `UPDATE trading_bots SET total_trades = total_trades + 1 WHERE id = $1`,
              [botId]
            );

            logger.info('Grid bot sell executed', {
              botId,
              sellLevel: currentLevel,
              buyLevel: positionToSell.level,
              buyPrice: positionToSell.price,
              sellPrice: currentPrice,
              profit: ((currentPrice - positionToSell.price) / positionToSell.price * 100).toFixed(2) + '%',
            });
          }
        }
      } catch (err) {
        logger.error('Grid bot sell failed', { botId, error: (err as Error).message });
      }
    }
  }

  // Save state
  state.lastLevel = currentLevel;
  await redis.set(stateKey, JSON.stringify(state));

  return { trades };
}

// ============================================
// DCA Bot Execution
// ============================================

/**
 * Execute DCA bot logic
 */
export async function executeDCABot(botId: string): Promise<{ purchased: boolean }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'dca' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { purchased: false };

  const bot = botResult.rows[0];
  const config = bot.config as DCABotConfig;
  const userId = bot.user_id;

  // Check if it's time to purchase
  const lastPurchase = config.lastPurchaseAt ? new Date(config.lastPurchaseAt) : null;
  const intervalMs = config.intervalHours * 60 * 60 * 1000;

  if (lastPurchase && Date.now() - lastPurchase.getTime() < intervalMs) {
    return { purchased: false };
  }

  // Check if we've completed all purchases
  if (config.purchasesMade >= config.totalPurchases) {
    await pool.query(
      `UPDATE trading_bots SET status = 'stopped', stopped_at = NOW() WHERE id = $1`,
      [botId]
    );
    return { purchased: false };
  }

  try {
    await tradingService.placeOrder(userId, {
      symbol: config.symbol,
      side: 'buy',
      type: 'market',
      quoteAmount: config.amountPerPurchase,
      notes: `DCA bot ${botId} purchase ${config.purchasesMade + 1}/${config.totalPurchases}`,
    });

    // Update bot config
    const newConfig = {
      ...config,
      purchasesMade: config.purchasesMade + 1,
      lastPurchaseAt: new Date().toISOString(),
    };

    await pool.query(
      `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
      [JSON.stringify(newConfig), botId]
    );

    logger.info('DCA purchase executed', {
      botId,
      symbol: config.symbol,
      purchase: config.purchasesMade + 1,
    });

    return { purchased: true };
  } catch (err) {
    logger.error('DCA purchase failed', { botId, error: (err as Error).message });
    return { purchased: false };
  }
}

// ============================================
// RSI Bot Execution
// ============================================

/**
 * Execute RSI bot logic
 */
export async function executeRSIBot(botId: string): Promise<{ traded: boolean; signal?: string }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'rsi' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { traded: false };

  const bot = botResult.rows[0];
  const config = bot.config as RSIBotConfig;
  const userId = bot.user_id;

  // Check cooldown
  if (config.lastTradeAt) {
    const lastTrade = new Date(config.lastTradeAt);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTrade.getTime() < cooldownMs) {
      return { traded: false };
    }
  }

  // Get klines for RSI calculation
  const klines = await tradingService.getKlines(config.symbol, config.interval, 15);
  if (klines.length < 14) return { traded: false };

  // Calculate RSI - parse string prices to numbers
  const closes = klines.map(k => parseFloat(k.close));
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  let signal: string | undefined;
  let traded = false;

  if (rsi <= config.oversoldThreshold) {
    // Oversold - BUY signal
    signal = 'buy';

    // Send technical signal notification
    tradeNotification.notifyTechnicalSignal(userId, {
      symbol: config.symbol,
      indicator: 'RSI',
      signal: 'bullish',
      value: rsi,
      message: `Oversold condition detected (RSI ${rsi.toFixed(1)} < ${config.oversoldThreshold})`,
    }).catch(err => logger.error('Failed to send RSI signal notification', { error: (err as Error).message }));

    try {
      await tradingService.placeOrder(userId, {
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: config.amountPerTrade,
        notes: `RSI bot ${botId} buy signal - RSI: ${rsi.toFixed(2)}`,
      });
      traded = true;

      const newConfig = { ...config, lastTradeAt: new Date().toISOString() };
      await pool.query(
        `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
        [JSON.stringify(newConfig), botId]
      );

      logger.info('RSI bot buy executed', { botId, rsi: rsi.toFixed(2) });
    } catch (err) {
      logger.error('RSI bot buy failed', { botId, error: (err as Error).message });
    }
  } else if (rsi >= config.overboughtThreshold) {
    // Overbought - SELL signal
    signal = 'sell';

    // Send technical signal notification
    tradeNotification.notifyTechnicalSignal(userId, {
      symbol: config.symbol,
      indicator: 'RSI',
      signal: 'bearish',
      value: rsi,
      message: `Overbought condition detected (RSI ${rsi.toFixed(1)} > ${config.overboughtThreshold})`,
    }).catch(err => logger.error('Failed to send RSI signal notification', { error: (err as Error).message }));

    // Get holdings to sell
    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const asset = config.symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (holding && holding.amount > 0) {
        const sellValue = Math.min(holding.valueUsdt, config.amountPerTrade);
        const sellQty = sellValue / holding.price;

        try {
          await tradingService.placeOrder(userId, {
            symbol: config.symbol,
            side: 'sell',
            type: 'market',
            quantity: sellQty,
            notes: `RSI bot ${botId} sell signal - RSI: ${rsi.toFixed(2)}`,
          });
          traded = true;

          const newConfig = { ...config, lastTradeAt: new Date().toISOString() };
          await pool.query(
            `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
            [JSON.stringify(newConfig), botId]
          );

          logger.info('RSI bot sell executed', { botId, rsi: rsi.toFixed(2) });
        } catch (err) {
          logger.error('RSI bot sell failed', { botId, error: (err as Error).message });
        }
      }
    }
  }

  return { traded, signal };
}

// ============================================
// MA Crossover Bot Execution
// ============================================

/**
 * Calculate EMA
 */
function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period && i < prices.length; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // Calculate rest of EMAs
  for (let i = period; i < prices.length; i++) {
    ema.push((prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
  }

  return ema;
}

/**
 * Calculate SMA
 */
function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - j];
    }
    sma.push(sum / period);
  }
  return sma;
}

/**
 * Execute MA Crossover bot logic
 */
export async function executeMACrossBot(botId: string): Promise<{ traded: boolean; signal?: string }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'ma_crossover' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { traded: false };

  const bot = botResult.rows[0];
  const config = bot.config as MACrossBotConfig;
  const userId = bot.user_id;

  // Check cooldown
  if (config.lastTradeAt) {
    const lastTrade = new Date(config.lastTradeAt);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTrade.getTime() < cooldownMs) {
      return { traded: false };
    }
  }

  // Get enough klines for MA calculation
  const klines = await tradingService.getKlines(config.symbol, config.interval, config.slowPeriod + 5);
  if (klines.length < config.slowPeriod) return { traded: false };

  const closes = klines.map(k => parseFloat(k.close));

  // Calculate MAs
  const fastMA = config.maType === 'ema'
    ? calculateEMA(closes, config.fastPeriod)
    : calculateSMA(closes, config.fastPeriod);
  const slowMA = config.maType === 'ema'
    ? calculateEMA(closes, config.slowPeriod)
    : calculateSMA(closes, config.slowPeriod);

  if (fastMA.length < 2 || slowMA.length < 2) return { traded: false };

  // Check for crossover
  const currentFast = fastMA[fastMA.length - 1];
  const prevFast = fastMA[fastMA.length - 2];
  const currentSlow = slowMA[slowMA.length - 1];
  const prevSlow = slowMA[slowMA.length - 2];

  let signal: string | undefined;
  let traded = false;
  let crossDirection: 'up' | 'down' | undefined;

  // Golden cross: fast crosses above slow
  if (prevFast <= prevSlow && currentFast > currentSlow) {
    crossDirection = 'up';
    if (config.lastCrossDirection !== 'up') {
      signal = 'buy';
    }
  }
  // Death cross: fast crosses below slow
  else if (prevFast >= prevSlow && currentFast < currentSlow) {
    crossDirection = 'down';
    if (config.lastCrossDirection !== 'down') {
      signal = 'sell';
    }
  }

  if (signal === 'buy') {
    // Send technical signal notification
    tradeNotification.notifyTechnicalSignal(userId, {
      symbol: config.symbol,
      indicator: 'MA Cross',
      signal: 'bullish',
      value: currentFast,
      message: `Golden Cross: ${config.fastPeriod} ${config.maType.toUpperCase()} (${currentFast.toFixed(2)}) crossed above ${config.slowPeriod} ${config.maType.toUpperCase()} (${currentSlow.toFixed(2)})`,
    }).catch(err => logger.error('Failed to send MA Cross signal notification', { error: (err as Error).message }));

    try {
      await tradingService.placeOrder(userId, {
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: config.amountPerTrade,
        trailingStopPct: config.trailingStopPct,
        notes: `MA Cross bot ${botId} golden cross - Fast: ${currentFast.toFixed(2)}, Slow: ${currentSlow.toFixed(2)}`,
      });
      traded = true;

      const newConfig = { ...config, lastTradeAt: new Date().toISOString(), lastCrossDirection: crossDirection };
      await pool.query(
        `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
        [JSON.stringify(newConfig), botId]
      );

      logger.info('MA Cross bot buy executed', { botId, fastMA: currentFast, slowMA: currentSlow });
    } catch (err) {
      logger.error('MA Cross bot buy failed', { botId, error: (err as Error).message });
    }
  } else if (signal === 'sell') {
    // Send technical signal notification
    tradeNotification.notifyTechnicalSignal(userId, {
      symbol: config.symbol,
      indicator: 'MA Cross',
      signal: 'bearish',
      value: currentFast,
      message: `Death Cross: ${config.fastPeriod} ${config.maType.toUpperCase()} (${currentFast.toFixed(2)}) crossed below ${config.slowPeriod} ${config.maType.toUpperCase()} (${currentSlow.toFixed(2)})`,
    }).catch(err => logger.error('Failed to send MA Cross signal notification', { error: (err as Error).message }));

    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const asset = config.symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (holding && holding.amount > 0) {
        const sellValue = Math.min(holding.valueUsdt, config.amountPerTrade);
        const sellQty = sellValue / holding.price;

        try {
          await tradingService.placeOrder(userId, {
            symbol: config.symbol,
            side: 'sell',
            type: 'market',
            quantity: sellQty,
            notes: `MA Cross bot ${botId} death cross - Fast: ${currentFast.toFixed(2)}, Slow: ${currentSlow.toFixed(2)}`,
          });
          traded = true;

          const newConfig = { ...config, lastTradeAt: new Date().toISOString(), lastCrossDirection: crossDirection };
          await pool.query(
            `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
            [JSON.stringify(newConfig), botId]
          );

          logger.info('MA Cross bot sell executed', { botId, fastMA: currentFast, slowMA: currentSlow });
        } catch (err) {
          logger.error('MA Cross bot sell failed', { botId, error: (err as Error).message });
        }
      }
    }
  } else if (crossDirection) {
    // Update last cross direction even if we didn't trade
    const newConfig = { ...config, lastCrossDirection: crossDirection };
    await pool.query(
      `UPDATE trading_bots SET config = $1 WHERE id = $2`,
      [JSON.stringify(newConfig), botId]
    );
  }

  return { traded, signal };
}

// ============================================
// MACD Bot Execution
// ============================================

/**
 * Execute MACD bot logic
 */
export async function executeMACDBot(botId: string): Promise<{ traded: boolean; signal?: string }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'macd' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { traded: false };

  const bot = botResult.rows[0];
  const config = bot.config as MACDBotConfig;
  const userId = bot.user_id;

  // Check cooldown
  if (config.lastTradeAt) {
    const lastTrade = new Date(config.lastTradeAt);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTrade.getTime() < cooldownMs) {
      return { traded: false };
    }
  }

  // Get enough klines for MACD calculation
  const klines = await tradingService.getKlines(config.symbol, config.interval, config.slowPeriod + config.signalPeriod + 10);
  if (klines.length < config.slowPeriod + config.signalPeriod) return { traded: false };

  const closes = klines.map(k => parseFloat(k.close));

  // Calculate MACD
  const fastEMA = calculateEMA(closes, config.fastPeriod);
  const slowEMA = calculateEMA(closes, config.slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdLine: number[] = [];
  const startIdx = Math.max(config.fastPeriod, config.slowPeriod) - Math.min(config.fastPeriod, config.slowPeriod);
  for (let i = 0; i < Math.min(fastEMA.length, slowEMA.length - startIdx); i++) {
    macdLine.push(fastEMA[i] - slowEMA[i + startIdx]);
  }

  if (macdLine.length < config.signalPeriod + 2) return { traded: false };

  // Signal line = EMA of MACD line
  const signalLine = calculateEMA(macdLine, config.signalPeriod);

  if (signalLine.length < 2) return { traded: false };

  // Check for crossover
  const currentMACD = macdLine[macdLine.length - 1];
  const prevMACD = macdLine[macdLine.length - 2];
  const currentSignal = signalLine[signalLine.length - 1];
  const prevSignal = signalLine[signalLine.length - 2];

  let signal: string | undefined;
  let traded = false;
  let signalDirection: 'bullish' | 'bearish' | undefined;

  // Bullish: MACD crosses above signal line
  if (prevMACD <= prevSignal && currentMACD > currentSignal) {
    signalDirection = 'bullish';
    if (config.lastSignalDirection !== 'bullish') {
      signal = 'buy';
    }
  }
  // Bearish: MACD crosses below signal line
  else if (prevMACD >= prevSignal && currentMACD < currentSignal) {
    signalDirection = 'bearish';
    if (config.lastSignalDirection !== 'bearish') {
      signal = 'sell';
    }
  }

  if (signal === 'buy') {
    // Send technical signal notification
    tradeNotification.notifyTechnicalSignal(userId, {
      symbol: config.symbol,
      indicator: 'MACD',
      signal: 'bullish',
      value: currentMACD,
      message: `Bullish Crossover: MACD (${currentMACD.toFixed(4)}) crossed above Signal (${currentSignal.toFixed(4)})`,
    }).catch(err => logger.error('Failed to send MACD signal notification', { error: (err as Error).message }));

    try {
      await tradingService.placeOrder(userId, {
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: config.amountPerTrade,
        trailingStopPct: config.trailingStopPct,
        notes: `MACD bot ${botId} bullish crossover - MACD: ${currentMACD.toFixed(4)}, Signal: ${currentSignal.toFixed(4)}`,
      });
      traded = true;

      const newConfig = { ...config, lastTradeAt: new Date().toISOString(), lastSignalDirection: signalDirection };
      await pool.query(
        `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
        [JSON.stringify(newConfig), botId]
      );

      logger.info('MACD bot buy executed', { botId, macd: currentMACD, signal: currentSignal });
    } catch (err) {
      logger.error('MACD bot buy failed', { botId, error: (err as Error).message });
    }
  } else if (signal === 'sell') {
    // Send technical signal notification
    tradeNotification.notifyTechnicalSignal(userId, {
      symbol: config.symbol,
      indicator: 'MACD',
      signal: 'bearish',
      value: currentMACD,
      message: `Bearish Crossover: MACD (${currentMACD.toFixed(4)}) crossed below Signal (${currentSignal.toFixed(4)})`,
    }).catch(err => logger.error('Failed to send MACD signal notification', { error: (err as Error).message }));

    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const asset = config.symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (holding && holding.amount > 0) {
        const sellValue = Math.min(holding.valueUsdt, config.amountPerTrade);
        const sellQty = sellValue / holding.price;

        try {
          await tradingService.placeOrder(userId, {
            symbol: config.symbol,
            side: 'sell',
            type: 'market',
            quantity: sellQty,
            notes: `MACD bot ${botId} bearish crossover - MACD: ${currentMACD.toFixed(4)}, Signal: ${currentSignal.toFixed(4)}`,
          });
          traded = true;

          const newConfig = { ...config, lastTradeAt: new Date().toISOString(), lastSignalDirection: signalDirection };
          await pool.query(
            `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
            [JSON.stringify(newConfig), botId]
          );

          logger.info('MACD bot sell executed', { botId, macd: currentMACD, signal: currentSignal });
        } catch (err) {
          logger.error('MACD bot sell failed', { botId, error: (err as Error).message });
        }
      }
    }
  } else if (signalDirection) {
    const newConfig = { ...config, lastSignalDirection: signalDirection };
    await pool.query(
      `UPDATE trading_bots SET config = $1 WHERE id = $2`,
      [JSON.stringify(newConfig), botId]
    );
  }

  return { traded, signal };
}

// ============================================
// Breakout Bot Execution
// ============================================

/**
 * Execute Breakout bot logic
 */
export async function executeBreakoutBot(botId: string): Promise<{ traded: boolean; signal?: string }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'breakout' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { traded: false };

  const bot = botResult.rows[0];
  const config = bot.config as BreakoutBotConfig;
  const userId = bot.user_id;

  // Check cooldown
  if (config.lastTradeAt) {
    const lastTrade = new Date(config.lastTradeAt);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTrade.getTime() < cooldownMs) {
      return { traded: false };
    }
  }

  // Get klines for range calculation
  const klines = await tradingService.getKlines(config.symbol, config.interval, config.lookbackPeriod + 1);
  if (klines.length < config.lookbackPeriod) return { traded: false };

  // Calculate range from lookback period (excluding current candle)
  const lookbackKlines = klines.slice(0, -1);
  const highs = lookbackKlines.map(k => parseFloat(k.high));
  const lows = lookbackKlines.map(k => parseFloat(k.low));
  const volumes = lookbackKlines.map(k => parseFloat(k.volume));

  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  // Current candle
  const currentKline = klines[klines.length - 1];
  const currentClose = parseFloat(currentKline.close);
  const currentVolume = parseFloat(currentKline.volume);

  // Check for breakout
  const breakoutUpThreshold = rangeHigh * (1 + config.breakoutThreshold / 100);
  const breakoutDownThreshold = rangeLow * (1 - config.breakoutThreshold / 100);
  const volumeConfirmed = currentVolume >= avgVolume * config.volumeMultiplier;

  let signal: string | undefined;
  let traded = false;

  // Bullish breakout
  if (currentClose > breakoutUpThreshold && volumeConfirmed) {
    signal = 'buy';
    try {
      await tradingService.placeOrder(userId, {
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: config.amountPerTrade,
        trailingStopPct: config.trailingStopPct,
        notes: `Breakout bot ${botId} bullish breakout above ${rangeHigh.toFixed(2)} - Volume: ${(currentVolume / avgVolume).toFixed(1)}x avg`,
      });
      traded = true;

      const newConfig = { ...config, lastTradeAt: new Date().toISOString() };
      await pool.query(
        `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
        [JSON.stringify(newConfig), botId]
      );

      logger.info('Breakout bot buy executed', { botId, price: currentClose, rangeHigh });
    } catch (err) {
      logger.error('Breakout bot buy failed', { botId, error: (err as Error).message });
    }
  }
  // Bearish breakout
  else if (currentClose < breakoutDownThreshold && volumeConfirmed) {
    signal = 'sell';
    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const asset = config.symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (holding && holding.amount > 0) {
        const sellValue = Math.min(holding.valueUsdt, config.amountPerTrade);
        const sellQty = sellValue / holding.price;

        try {
          await tradingService.placeOrder(userId, {
            symbol: config.symbol,
            side: 'sell',
            type: 'market',
            quantity: sellQty,
            notes: `Breakout bot ${botId} bearish breakout below ${rangeLow.toFixed(2)} - Volume: ${(currentVolume / avgVolume).toFixed(1)}x avg`,
          });
          traded = true;

          const newConfig = { ...config, lastTradeAt: new Date().toISOString() };
          await pool.query(
            `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
            [JSON.stringify(newConfig), botId]
          );

          logger.info('Breakout bot sell executed', { botId, price: currentClose, rangeLow });
        } catch (err) {
          logger.error('Breakout bot sell failed', { botId, error: (err as Error).message });
        }
      }
    }
  }

  return { traded, signal };
}

// ============================================
// Mean Reversion Bot Execution
// ============================================

/**
 * Execute Mean Reversion bot logic
 */
export async function executeMeanReversionBot(botId: string): Promise<{ traded: boolean; signal?: string }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'mean_reversion' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { traded: false };

  const bot = botResult.rows[0];
  const config = bot.config as MeanReversionBotConfig;
  const userId = bot.user_id;

  // Check cooldown
  if (config.lastTradeAt) {
    const lastTrade = new Date(config.lastTradeAt);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTrade.getTime() < cooldownMs) {
      return { traded: false };
    }
  }

  // Get klines for MA calculation
  const klines = await tradingService.getKlines(config.symbol, config.interval, config.maPeriod + 5);
  if (klines.length < config.maPeriod) return { traded: false };

  const closes = klines.map(k => parseFloat(k.close));
  const currentPrice = closes[closes.length - 1];

  // Calculate MA (mean)
  const ma = calculateSMA(closes, config.maPeriod);
  if (ma.length === 0) return { traded: false };

  const currentMA = ma[ma.length - 1];
  const deviation = ((currentPrice - currentMA) / currentMA) * 100;

  let signal: string | undefined;
  let traded = false;

  // Price significantly below MA - buy signal
  if (deviation <= -config.deviationThreshold) {
    signal = 'buy';
    try {
      await tradingService.placeOrder(userId, {
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: config.amountPerTrade,
        trailingStopPct: config.trailingStopPct,
        notes: `Mean Reversion bot ${botId} buy - Price ${deviation.toFixed(2)}% below MA(${config.maPeriod})`,
      });
      traded = true;

      const newConfig = { ...config, lastTradeAt: new Date().toISOString() };
      await pool.query(
        `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
        [JSON.stringify(newConfig), botId]
      );

      logger.info('Mean Reversion bot buy executed', { botId, deviation: deviation.toFixed(2), ma: currentMA });
    } catch (err) {
      logger.error('Mean Reversion bot buy failed', { botId, error: (err as Error).message });
    }
  }
  // Price significantly above MA - sell signal
  else if (deviation >= config.deviationThreshold) {
    signal = 'sell';
    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const asset = config.symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (holding && holding.amount > 0) {
        const sellValue = Math.min(holding.valueUsdt, config.amountPerTrade);
        const sellQty = sellValue / holding.price;

        try {
          await tradingService.placeOrder(userId, {
            symbol: config.symbol,
            side: 'sell',
            type: 'market',
            quantity: sellQty,
            notes: `Mean Reversion bot ${botId} sell - Price ${deviation.toFixed(2)}% above MA(${config.maPeriod})`,
          });
          traded = true;

          const newConfig = { ...config, lastTradeAt: new Date().toISOString() };
          await pool.query(
            `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
            [JSON.stringify(newConfig), botId]
          );

          logger.info('Mean Reversion bot sell executed', { botId, deviation: deviation.toFixed(2), ma: currentMA });
        } catch (err) {
          logger.error('Mean Reversion bot sell failed', { botId, error: (err as Error).message });
        }
      }
    }
  }

  return { traded, signal };
}

// ============================================
// Momentum Bot Execution
// ============================================

/**
 * Calculate RSI
 */
function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Execute Momentum bot logic
 */
export async function executeMomentumBot(botId: string): Promise<{ traded: boolean; signal?: string }> {
  const botResult = await pool.query(
    `SELECT * FROM trading_bots WHERE id = $1 AND type = 'momentum' AND status = 'running'`,
    [botId]
  );

  if (botResult.rows.length === 0) return { traded: false };

  const bot = botResult.rows[0];
  const config = bot.config as MomentumBotConfig;
  const userId = bot.user_id;

  // Check cooldown
  if (config.lastTradeAt) {
    const lastTrade = new Date(config.lastTradeAt);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastTrade.getTime() < cooldownMs) {
      return { traded: false };
    }
  }

  // Get klines
  const klines = await tradingService.getKlines(config.symbol, config.interval, config.rsiPeriod + 10);
  if (klines.length < config.rsiPeriod + 2) return { traded: false };

  const closes = klines.map(k => parseFloat(k.close));
  const volumes = klines.map(k => parseFloat(k.volume));

  // Calculate RSI
  const currentRSI = calculateRSI(closes, config.rsiPeriod);
  const prevRSI = calculateRSI(closes.slice(0, -1), config.rsiPeriod);

  // Volume confirmation
  const currentVolume = volumes[volumes.length - 1];
  const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
  const volumeOK = !config.volumeConfirmation || currentVolume > avgVolume;

  let signal: string | undefined;
  let traded = false;
  let direction: 'long' | 'short' | undefined;

  // Bullish momentum: RSI above threshold and rising
  if (currentRSI >= config.momentumThreshold && currentRSI > prevRSI && volumeOK) {
    direction = 'long';
    if (config.lastDirection !== 'long') {
      signal = 'buy';
    }
  }
  // Bearish momentum: RSI below inverse threshold and falling
  else if (currentRSI <= (100 - config.momentumThreshold) && currentRSI < prevRSI && volumeOK) {
    direction = 'short';
    if (config.lastDirection !== 'short') {
      signal = 'sell';
    }
  }

  if (signal === 'buy') {
    try {
      await tradingService.placeOrder(userId, {
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        quoteAmount: config.amountPerTrade,
        trailingStopPct: config.trailingStopPct,
        notes: `Momentum bot ${botId} bullish momentum - RSI: ${currentRSI.toFixed(2)}`,
      });
      traded = true;

      const newConfig = { ...config, lastTradeAt: new Date().toISOString(), lastDirection: direction };
      await pool.query(
        `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
        [JSON.stringify(newConfig), botId]
      );

      logger.info('Momentum bot buy executed', { botId, rsi: currentRSI.toFixed(2) });
    } catch (err) {
      logger.error('Momentum bot buy failed', { botId, error: (err as Error).message });
    }
  } else if (signal === 'sell') {
    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const asset = config.symbol.replace(/USD[TC]$/, '');
      const holding = portfolio.holdings.find(h => h.asset === asset);
      if (holding && holding.amount > 0) {
        const sellValue = Math.min(holding.valueUsdt, config.amountPerTrade);
        const sellQty = sellValue / holding.price;

        try {
          await tradingService.placeOrder(userId, {
            symbol: config.symbol,
            side: 'sell',
            type: 'market',
            quantity: sellQty,
            notes: `Momentum bot ${botId} bearish momentum - RSI: ${currentRSI.toFixed(2)}`,
          });
          traded = true;

          const newConfig = { ...config, lastTradeAt: new Date().toISOString(), lastDirection: direction };
          await pool.query(
            `UPDATE trading_bots SET config = $1, total_trades = total_trades + 1 WHERE id = $2`,
            [JSON.stringify(newConfig), botId]
          );

          logger.info('Momentum bot sell executed', { botId, rsi: currentRSI.toFixed(2) });
        } catch (err) {
          logger.error('Momentum bot sell failed', { botId, error: (err as Error).message });
        }
      }
    }
  } else if (direction) {
    const newConfig = { ...config, lastDirection: direction };
    await pool.query(
      `UPDATE trading_bots SET config = $1 WHERE id = $2`,
      [JSON.stringify(newConfig), botId]
    );
  }

  return { traded, signal };
}

// ============================================
// Main Bot Runner
// ============================================

/**
 * Run all active bots (called by job runner)
 */
export async function runAllBots(): Promise<{
  conditional: { executed: number; errors: number };
  grid: { trades: number };
  dca: { purchases: number };
  rsi: { trades: number };
  ma_crossover: { trades: number };
  macd: { trades: number };
  breakout: { trades: number };
  mean_reversion: { trades: number };
  momentum: { trades: number };
}> {
  const results = {
    conditional: { executed: 0, errors: 0 },
    grid: { trades: 0 },
    dca: { purchases: 0 },
    rsi: { trades: 0 },
    ma_crossover: { trades: 0 },
    macd: { trades: 0 },
    breakout: { trades: 0 },
    mean_reversion: { trades: 0 },
    momentum: { trades: 0 },
  };

  // Run conditional orders
  results.conditional = await checkConditionalOrders();

  // Get all running bots
  const botsResult = await pool.query(
    `SELECT id, type FROM trading_bots WHERE status = 'running'`
  );

  for (const bot of botsResult.rows) {
    try {
      switch (bot.type) {
        case 'grid': {
          const r = await executeGridBot(bot.id);
          results.grid.trades += r.trades;
          break;
        }
        case 'dca': {
          const r = await executeDCABot(bot.id);
          if (r.purchased) results.dca.purchases++;
          break;
        }
        case 'rsi': {
          const r = await executeRSIBot(bot.id);
          if (r.traded) results.rsi.trades++;
          break;
        }
        case 'ma_crossover': {
          const r = await executeMACrossBot(bot.id);
          if (r.traded) results.ma_crossover.trades++;
          break;
        }
        case 'macd': {
          const r = await executeMACDBot(bot.id);
          if (r.traded) results.macd.trades++;
          break;
        }
        case 'breakout': {
          const r = await executeBreakoutBot(bot.id);
          if (r.traded) results.breakout.trades++;
          break;
        }
        case 'mean_reversion': {
          const r = await executeMeanReversionBot(bot.id);
          if (r.traded) results.mean_reversion.trades++;
          break;
        }
        case 'momentum': {
          const r = await executeMomentumBot(bot.id);
          if (r.traded) results.momentum.trades++;
          break;
        }
      }
    } catch (err) {
      logger.error('Bot execution failed', { botId: bot.id, type: bot.type, error: (err as Error).message });
    }
  }

  return results;
}

export default {
  createConditionalOrder,
  getConditionalOrders,
  cancelConditionalOrder,
  checkConditionalOrders,
  executeGridBot,
  executeDCABot,
  executeRSIBot,
  executeMACrossBot,
  executeMACDBot,
  executeBreakoutBot,
  executeMeanReversionBot,
  executeMomentumBot,
  runAllBots,
};
