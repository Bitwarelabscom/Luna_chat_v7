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
import { BinanceClient, type Ticker24hr } from './binance.client.js';
import { decryptToken } from '../utils/encryption.js';
import * as tradingService from './trading.service.js';
import logger from '../utils/logger.js';

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
  symbol: string;
  upperPrice: number;
  lowerPrice: number;
  gridCount: number;
  totalInvestment: number;
  mode: 'arithmetic' | 'geometric';
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
}

// ============================================
// Binance Client Management
// ============================================

const clientCache = new Map<string, { client: BinanceClient; expiresAt: number }>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000;

async function getBinanceClient(userId: string): Promise<BinanceClient | null> {
  const cached = clientCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const result = await pool.query(
    `SELECT api_key_encrypted, api_secret_encrypted
     FROM user_trading_keys
     WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  try {
    const apiKey = decryptToken(result.rows[0].api_key_encrypted);
    const apiSecret = decryptToken(result.rows[0].api_secret_encrypted);
    const client = new BinanceClient({ apiKey, apiSecret });

    clientCache.set(userId, {
      client,
      expiresAt: Date.now() + CLIENT_CACHE_TTL,
    });

    return client;
  } catch {
    return null;
  }
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
 */
export async function cancelConditionalOrder(userId: string, orderId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE conditional_orders
     SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'active'
     RETURNING id`,
    [orderId, userId]
  );

  if (result.rows.length > 0) {
    logger.info('Conditional order cancelled', { userId, orderId });
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

    // Get unique symbols
    const symbols = [...new Set(result.rows.map(r => r.symbol))];

    // Fetch current prices
    const publicClient = new BinanceClient({ apiKey: '', apiSecret: '' });
    const tickers = (await publicClient.getTicker24hr()) as Ticker24hr[];
    const priceMap = new Map<string, number>();
    for (const t of tickers) {
      if (symbols.includes(t.symbol)) {
        priceMap.set(t.symbol, parseFloat(t.lastPrice));
      }
    }

    for (const order of result.rows) {
      const currentPrice = priceMap.get(order.symbol);
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
          logger.error('Failed to execute conditional order', {
            orderId: order.id,
            error: (err as Error).message,
          });
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
  const client = await getBinanceClient(userId);
  if (!client) {
    throw new Error('Binance client not available');
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

  // Place the order
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
    notes: `Conditional order ${orderId} triggered at $${currentPrice}`,
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

  const client = await getBinanceClient(userId);
  if (!client) return { trades };

  // Get current price
  const ticker = await client.getTickerPrice(config.symbol) as { price: string };
  const currentPrice = parseFloat(ticker.price);

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

  // Execute grid logic
  const amountPerGrid = config.totalInvestment / config.gridCount;

  if (currentLevel !== state.lastLevel && currentLevel >= 0) {
    if (currentLevel < state.lastLevel) {
      // Price dropped - buy at this level
      try {
        await tradingService.placeOrder(userId, {
          symbol: config.symbol,
          side: 'buy',
          type: 'market',
          quoteAmount: amountPerGrid,
          notes: `Grid bot ${botId} buy at level ${currentLevel}`,
        });
        trades++;

        await pool.query(
          `UPDATE trading_bots SET total_trades = total_trades + 1 WHERE id = $1`,
          [botId]
        );

        logger.info('Grid bot buy executed', { botId, level: currentLevel, price: currentPrice });
      } catch (err) {
        logger.error('Grid bot buy failed', { botId, error: (err as Error).message });
      }
    } else if (currentLevel > state.lastLevel && state.lastLevel >= 0) {
      // Price rose - sell at this level
      try {
        // Get holdings to sell
        const portfolio = await tradingService.getPortfolio(userId);
        if (portfolio) {
          const asset = config.symbol.replace(/USD[TC]$/, '');
          const holding = portfolio.holdings.find(h => h.asset === asset);
          if (holding && holding.amount > 0) {
            const sellQty = Math.min(holding.amount, amountPerGrid / currentPrice);
            await tradingService.placeOrder(userId, {
              symbol: config.symbol,
              side: 'sell',
              type: 'market',
              quantity: sellQty,
              notes: `Grid bot ${botId} sell at level ${currentLevel}`,
            });
            trades++;

            await pool.query(
              `UPDATE trading_bots SET total_trades = total_trades + 1 WHERE id = $1`,
              [botId]
            );

            logger.info('Grid bot sell executed', { botId, level: currentLevel, price: currentPrice });
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
}> {
  const results = {
    conditional: { executed: 0, errors: 0 },
    grid: { trades: 0 },
    dca: { purchases: 0 },
    rsi: { trades: 0 },
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
  runAllBots,
};
