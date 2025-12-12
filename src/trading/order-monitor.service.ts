/**
 * Trading Order Monitor Service
 *
 * Background job that monitors:
 * - Take Profit / Stop Loss levels
 * - Trailing Stop Loss
 * - Open order fill status
 *
 * Runs without LLM calls - pure programmatic logic
 */

import { pool } from '../db/index.js';
import { BinanceClient, type Ticker24hr } from './binance.client.js';
import { decryptToken } from '../utils/encryption.js';
import * as deliveryService from '../triggers/delivery.service.js';
import logger from '../utils/logger.js';

// Cache for Binance clients
const clientCache = new Map<string, { client: BinanceClient; expiresAt: number }>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get Binance client for a user
 */
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

/**
 * Get current prices for all symbols we need to monitor
 */
async function getCurrentPrices(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) return new Map();

  // Use public endpoint
  const client = new BinanceClient({ apiKey: '', apiSecret: '' });
  const tickers = (await client.getTicker24hr()) as Ticker24hr[];

  const priceMap = new Map<string, number>();
  const symbolSet = new Set(symbols);

  for (const ticker of tickers) {
    if (symbolSet.has(ticker.symbol)) {
      priceMap.set(ticker.symbol, parseFloat(ticker.lastPrice));
    }
  }

  return priceMap;
}

/**
 * Check and execute TP/SL orders
 */
export async function checkTakeProfitStopLoss(): Promise<{ triggered: number; errors: number }> {
  let triggered = 0;
  let errors = 0;

  try {
    // Get active trades with TP/SL set
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      side: string;
      quantity: string;
      filled_price: string;
      stop_loss_price: string | null;
      take_profit_price: string | null;
    }>(`
      SELECT id, user_id, symbol, side, quantity, filled_price, stop_loss_price, take_profit_price
      FROM trades
      WHERE status = 'filled'
        AND (stop_loss_price IS NOT NULL OR take_profit_price IS NOT NULL)
        AND closed_at IS NULL
    `);

    if (result.rows.length === 0) return { triggered, errors };

    // Get unique symbols
    const symbols = [...new Set(result.rows.map(r => r.symbol))];
    const prices = await getCurrentPrices(symbols);

    for (const trade of result.rows) {
      const currentPrice = prices.get(trade.symbol);
      if (!currentPrice) continue;

      const stopLoss = trade.stop_loss_price ? parseFloat(trade.stop_loss_price) : null;
      const takeProfit = trade.take_profit_price ? parseFloat(trade.take_profit_price) : null;
      const isBuy = trade.side === 'buy';

      let shouldClose = false;
      let reason = '';

      // For buy positions: SL triggers when price drops, TP triggers when price rises
      // For sell positions: SL triggers when price rises, TP triggers when price drops
      if (isBuy) {
        if (stopLoss && currentPrice <= stopLoss) {
          shouldClose = true;
          reason = 'stop_loss';
        } else if (takeProfit && currentPrice >= takeProfit) {
          shouldClose = true;
          reason = 'take_profit';
        }
      } else {
        if (stopLoss && currentPrice >= stopLoss) {
          shouldClose = true;
          reason = 'stop_loss';
        } else if (takeProfit && currentPrice <= takeProfit) {
          shouldClose = true;
          reason = 'take_profit';
        }
      }

      if (shouldClose) {
        try {
          await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, parseFloat(trade.quantity), reason);
          triggered++;
          logger.info('TP/SL triggered', {
            tradeId: trade.id,
            symbol: trade.symbol,
            reason,
            currentPrice,
            stopLoss,
            takeProfit,
          });
        } catch (err) {
          errors++;
          logger.error('Failed to execute TP/SL close', {
            tradeId: trade.id,
            error: (err as Error).message,
          });
        }
      }
    }
  } catch (error) {
    logger.error('TP/SL check failed', { error: (error as Error).message });
    errors++;
  }

  return { triggered, errors };
}

/**
 * Update trailing stop loss prices
 */
export async function updateTrailingStops(): Promise<{ updated: number; triggered: number; errors: number }> {
  let updated = 0;
  let triggered = 0;
  let errors = 0;

  try {
    // Get trades with trailing stop enabled
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      side: string;
      quantity: string;
      filled_price: string;
      trailing_stop_pct: string;
      trailing_stop_price: string | null;
      trailing_stop_highest: string | null;
    }>(`
      SELECT id, user_id, symbol, side, quantity, filled_price,
             trailing_stop_pct, trailing_stop_price, trailing_stop_highest
      FROM trades
      WHERE status = 'filled'
        AND trailing_stop_pct IS NOT NULL
        AND closed_at IS NULL
    `);

    if (result.rows.length === 0) return { updated, triggered, errors };

    const symbols = [...new Set(result.rows.map(r => r.symbol))];
    const prices = await getCurrentPrices(symbols);

    for (const trade of result.rows) {
      const currentPrice = prices.get(trade.symbol);
      if (!currentPrice) continue;

      const trailingPct = parseFloat(trade.trailing_stop_pct);
      let highestPrice = trade.trailing_stop_highest ? parseFloat(trade.trailing_stop_highest) : parseFloat(trade.filled_price);
      let trailingStopPrice = trade.trailing_stop_price ? parseFloat(trade.trailing_stop_price) : null;
      const isBuy = trade.side === 'buy';

      if (isBuy) {
        // For long positions: track highest price, stop triggers below
        if (currentPrice > highestPrice) {
          highestPrice = currentPrice;
          trailingStopPrice = currentPrice * (1 - trailingPct / 100);

          await pool.query(
            `UPDATE trades SET trailing_stop_highest = $1, trailing_stop_price = $2 WHERE id = $3`,
            [highestPrice, trailingStopPrice, trade.id]
          );
          updated++;
        } else if (trailingStopPrice && currentPrice <= trailingStopPrice) {
          // Trailing stop triggered
          try {
            await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, parseFloat(trade.quantity), 'trailing_stop');
            triggered++;
            logger.info('Trailing stop triggered', {
              tradeId: trade.id,
              symbol: trade.symbol,
              currentPrice,
              trailingStopPrice,
              highestPrice,
            });
          } catch (err) {
            errors++;
            logger.error('Failed to execute trailing stop close', {
              tradeId: trade.id,
              error: (err as Error).message,
            });
          }
        }
      } else {
        // For short positions: track lowest price, stop triggers above
        if (currentPrice < highestPrice) {
          highestPrice = currentPrice; // Actually lowest for shorts
          trailingStopPrice = currentPrice * (1 + trailingPct / 100);

          await pool.query(
            `UPDATE trades SET trailing_stop_highest = $1, trailing_stop_price = $2 WHERE id = $3`,
            [highestPrice, trailingStopPrice, trade.id]
          );
          updated++;
        } else if (trailingStopPrice && currentPrice >= trailingStopPrice) {
          try {
            await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, parseFloat(trade.quantity), 'trailing_stop');
            triggered++;
          } catch (err) {
            errors++;
          }
        }
      }
    }
  } catch (error) {
    logger.error('Trailing stop update failed', { error: (error as Error).message });
    errors++;
  }

  return { updated, triggered, errors };
}

/**
 * Check status of pending/open orders on Binance
 */
export async function checkPendingOrders(): Promise<{ filled: number; cancelled: number; errors: number }> {
  let filled = 0;
  let cancelled = 0;
  let errors = 0;

  try {
    // Get pending orders
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      binance_order_id: string;
    }>(`
      SELECT id, user_id, symbol, binance_order_id
      FROM trades
      WHERE status = 'pending'
        AND binance_order_id IS NOT NULL
    `);

    if (result.rows.length === 0) return { filled, cancelled, errors };

    // Group by user
    const ordersByUser = new Map<string, typeof result.rows>();
    for (const order of result.rows) {
      if (!ordersByUser.has(order.user_id)) {
        ordersByUser.set(order.user_id, []);
      }
      ordersByUser.get(order.user_id)!.push(order);
    }

    for (const [userId, orders] of ordersByUser) {
      const client = await getBinanceClient(userId);
      if (!client) continue;

      for (const order of orders) {
        try {
          // Check order status on Binance
          const binanceOrder = await client.getOrder(order.symbol, parseInt(order.binance_order_id));

          if (binanceOrder.status === 'FILLED') {
            // Calculate fill details
            let totalQty = 0;
            let totalValue = 0;
            let fee = 0;
            let feeAsset = '';

            if (binanceOrder.fills) {
              for (const fill of binanceOrder.fills) {
                totalQty += parseFloat(fill.qty);
                totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
                fee += parseFloat(fill.commission);
                feeAsset = fill.commissionAsset;
              }
            }

            const filledPrice = totalQty > 0 ? totalValue / totalQty : parseFloat(binanceOrder.price);

            await pool.query(
              `UPDATE trades SET
                status = 'filled',
                filled_price = $1,
                total = $2,
                fee = $3,
                fee_asset = $4,
                filled_at = NOW()
               WHERE id = $5`,
              [filledPrice, totalValue, fee, feeAsset, order.id]
            );

            filled++;
            logger.info('Order filled', {
              tradeId: order.id,
              symbol: order.symbol,
              filledPrice,
              total: totalValue,
            });
          } else if (binanceOrder.status === 'CANCELED' || binanceOrder.status === 'EXPIRED') {
            await pool.query(
              `UPDATE trades SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
              [order.id]
            );
            cancelled++;
            logger.info('Order cancelled/expired', {
              tradeId: order.id,
              status: binanceOrder.status,
            });
          }
        } catch (err) {
          errors++;
          logger.error('Failed to check order status', {
            tradeId: order.id,
            error: (err as Error).message,
          });
        }
      }
    }
  } catch (error) {
    logger.error('Pending order check failed', { error: (error as Error).message });
    errors++;
  }

  return { filled, cancelled, errors };
}

/**
 * Execute a position close (market sell for buys, market buy for sells)
 */
async function executeClosePosition(
  userId: string,
  tradeId: string,
  symbol: string,
  side: string,
  quantity: number,
  reason: string
): Promise<void> {
  const client = await getBinanceClient(userId);
  if (!client) {
    throw new Error('Binance client not available');
  }

  // Close position with opposite order
  const closeSide = side === 'buy' ? 'SELL' : 'BUY';

  const order = await client.placeOrder({
    symbol,
    side: closeSide,
    type: 'MARKET',
    quantity: quantity.toString(),
  });

  // Calculate fill details
  let filledPrice = 0;
  let total = 0;
  let fee = 0;
  let feeAsset = '';

  if (order.fills && order.fills.length > 0) {
    let totalQty = 0;
    let totalValue = 0;
    for (const fill of order.fills) {
      totalQty += parseFloat(fill.qty);
      totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
      fee += parseFloat(fill.commission);
      feeAsset = fill.commissionAsset;
    }
    filledPrice = totalValue / totalQty;
    total = totalValue;
  }

  // Update original trade as closed
  await pool.query(
    `UPDATE trades SET
      closed_at = NOW(),
      close_price = $1,
      close_reason = $2,
      close_order_id = $3
     WHERE id = $4`,
    [filledPrice, reason, order.orderId.toString(), tradeId]
  );

  // Create close trade record
  await pool.query(
    `INSERT INTO trades (
      user_id, symbol, side, order_type, quantity, filled_price, total,
      fee, fee_asset, status, binance_order_id, notes, filled_at
    ) VALUES ($1, $2, $3, 'market', $4, $5, $6, $7, $8, 'filled', $9, $10, NOW())`,
    [
      userId,
      symbol,
      closeSide.toLowerCase(),
      parseFloat(order.executedQty),
      filledPrice,
      total,
      fee,
      feeAsset,
      order.orderId.toString(),
      `Auto-close: ${reason} for trade ${tradeId}`,
    ]
  );

  // Send real-time notification
  const reasonLabel = reason === 'stop_loss' ? 'Stop Loss' :
                      reason === 'take_profit' ? 'Take Profit' :
                      reason === 'trailing_stop' ? 'Trailing Stop' : reason;

  await deliveryService.sendTradingNotification(
    userId,
    `${reasonLabel} Triggered`,
    `${symbol}: Closed at $${filledPrice.toFixed(2)}`,
    reason === 'stop_loss' ? 'trading.stop_loss_triggered' :
    reason === 'take_profit' ? 'trading.take_profit_hit' : 'trading.position_closed',
    reason === 'stop_loss' ? 10 : 8, // Stop loss is critical
    { tradeId, symbol, reason }
  );

  // Log the action
  await pool.query(
    `INSERT INTO bot_logs (bot_id, action, details)
     VALUES (NULL, $1, $2)`,
    [
      `order_monitor_${reason}`,
      JSON.stringify({
        tradeId,
        symbol,
        side: closeSide,
        quantity,
        filledPrice,
        total,
        reason,
      }),
    ]
  );
}

/**
 * Main job handler - runs all order monitoring checks
 */
export async function runOrderMonitorJob(): Promise<void> {
  const startTime = Date.now();

  logger.debug('Order monitor job starting');

  // Run all checks in parallel for efficiency
  const [tpslResult, trailingResult, pendingResult] = await Promise.all([
    checkTakeProfitStopLoss(),
    updateTrailingStops(),
    checkPendingOrders(),
  ]);

  const duration = Date.now() - startTime;

  // Only log if there was activity
  if (
    tpslResult.triggered > 0 ||
    trailingResult.triggered > 0 ||
    trailingResult.updated > 0 ||
    pendingResult.filled > 0 ||
    pendingResult.cancelled > 0
  ) {
    logger.info('Order monitor job completed', {
      duration,
      tpsl: tpslResult,
      trailing: trailingResult,
      pending: pendingResult,
    });
  } else {
    logger.debug('Order monitor job completed - no activity', { duration });
  }
}

export default {
  runOrderMonitorJob,
  checkTakeProfitStopLoss,
  updateTrailingStops,
  checkPendingOrders,
};
