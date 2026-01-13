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
import { CryptoComClient } from './crypto-com.client.js';
import { createExchangeClient } from './exchange.factory.js';
import type { IExchangeClient, IMarginExchangeClient, ExchangeType } from './exchange.interface.js';
import { toCryptoComSymbol } from './symbol-utils.js';
import { decryptToken } from '../utils/encryption.js';
import * as deliveryService from '../triggers/delivery.service.js';
import * as tradeNotification from './trade-notification.service.js';
import * as redisTradingService from './redis-trading.service.js';
import * as autoTradingService from './auto-trading.service.js';
import logger from '../utils/logger.js';

// Cache for Crypto.com exchange clients
const clientCache = new Map<string, { client: IExchangeClient; expiresAt: number }>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get Crypto.com exchange client for a user (cached)
 */
async function getClientForUser(userId: string): Promise<IExchangeClient | null> {
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
    const exchange: ExchangeType = 'crypto_com';

    const client = createExchangeClient(exchange, { apiKey, apiSecret });

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
 * Uses Redis cache with fallback to API for missing symbols
 */
async function getCurrentPrices(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) return new Map();

  // Get prices from Redis cache (getPricesBatch handles symbol normalization internally)
  const redisPrices = await redisTradingService.getPricesBatch(symbols);

  // Find missing symbols
  const missingSymbols = symbols.filter(s => !redisPrices.has(s));

  // If all symbols found, return
  if (missingSymbols.length === 0) {
    return redisPrices;
  }

  // Fallback to API for missing symbols
  logger.info('Some prices missing from Redis cache, falling back to API', {
    found: redisPrices.size,
    missing: missingSymbols.length,
    missingSymbols: missingSymbols.slice(0, 5),
  });

  try {
    const cryptoComClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
    const cryptoComResult = await cryptoComClient.getTicker24hr();
    const cryptoComTickers = Array.isArray(cryptoComResult) ? cryptoComResult : [cryptoComResult];

    // Build a lookup set for missing symbols (normalized to match API format)
    const missingSet = new Set(missingSymbols.map(s => toCryptoComSymbol(s)));

    for (const ticker of cryptoComTickers) {
      const normalizedSymbol = toCryptoComSymbol(ticker.symbol);
      if (missingSet.has(normalizedSymbol)) {
        // Find the original symbol that matches this normalized form
        const originalSymbol = missingSymbols.find(s => toCryptoComSymbol(s) === normalizedSymbol);
        if (originalSymbol) {
          redisPrices.set(originalSymbol, parseFloat(ticker.lastPrice));
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to fetch API prices for missing symbols', {
      error: (err as Error).message,
      missingSymbols,
    });
  }

  return redisPrices;
}

/**
 * Check and execute TP/SL orders
 */
/**
 * Execute partial take profit (TP1) - sells portion of position
 */
async function executePartialTakeProfit(
  userId: string,
  tradeId: string,
  symbol: string,
  side: string,
  quantityToSell: number,
  currentPrice: number
): Promise<void> {
  const client = await getClientForUser(userId);

  if (client) {
    // Live trading - execute partial sell
    try {
      const opposingSide = side === 'buy' ? 'SELL' : 'BUY';
      const normalizedSymbol = toCryptoComSymbol(symbol);

      // Format quantity according to symbol's lot size
      let formattedQuantity = quantityToSell.toString();
      try {
        const lotSize = await client.getLotSizeFilter(normalizedSymbol);
        if (lotSize && lotSize.stepSize) {
          const step = parseFloat(lotSize.stepSize);

          if (step >= 1) {
            // For large step sizes (e.g., 10000 for SHIB/BONK), round down to nearest multiple
            const rounded = Math.floor(quantityToSell / step) * step;
            formattedQuantity = rounded.toString();
          } else {
            // For small step sizes, use precision-based formatting
            const precision = Math.max(0, Math.ceil(-Math.log10(step)));
            const multiplier = Math.pow(10, precision);
            const rounded = Math.floor(quantityToSell * multiplier) / multiplier;
            formattedQuantity = rounded.toFixed(precision);
          }
        }
      } catch {
        // Use default formatting
      }

      await client.placeOrder({
        symbol: normalizedSymbol,
        side: opposingSide as 'BUY' | 'SELL',
        type: 'MARKET',
        quantity: formattedQuantity,
      });

      logger.info('Partial TP1 order executed', {
        tradeId,
        symbol,
        quantityToSell,
        price: currentPrice,
      });
    } catch (err) {
      logger.error('Failed to execute partial TP1 order', {
        tradeId,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  // Update trade record with partial sell info
  await pool.query(
    `UPDATE trades
     SET quantity_sold_tp1 = $1, tp1_hit_at = NOW()
     WHERE id = $2`,
    [quantityToSell, tradeId]
  );
}

export async function checkTakeProfitStopLoss(): Promise<{ triggered: number; errors: number; partialTps: number }> {
  let triggered = 0;
  let errors = 0;
  let partialTps = 0;

  try {
    // Get active trades with TP/SL set (including partial TP fields)
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      side: string;
      quantity: string;
      filled_price: string;
      stop_loss_price: string | null;
      take_profit_price: string | null;
      tp1_price: string | null;
      tp2_price: string | null;
      tp1_pct: number | null;
      quantity_sold_tp1: string | null;
      tp1_hit_at: Date | null;
      auto_trade: boolean | null;
    }>(`
      SELECT id, user_id, symbol, side, quantity, filled_price,
             stop_loss_price, take_profit_price,
             tp1_price, tp2_price, tp1_pct, quantity_sold_tp1, tp1_hit_at, auto_trade
      FROM trades
      WHERE status = 'filled'
        AND (stop_loss_price IS NOT NULL OR take_profit_price IS NOT NULL OR tp1_price IS NOT NULL)
        AND closed_at IS NULL
    `);

    if (result.rows.length === 0) return { triggered, errors, partialTps };

    // Get unique symbols
    const symbols = [...new Set(result.rows.map(r => r.symbol))];
    const prices = await getCurrentPrices(symbols);

    for (const trade of result.rows) {
      const currentPrice = prices.get(trade.symbol);
      if (!currentPrice) {
        logger.warn('SL/TP check skipped - no price available', {
          tradeId: trade.id,
          symbol: trade.symbol,
          userId: trade.user_id,
          stopLoss: trade.stop_loss_price,
          takeProfit: trade.take_profit_price,
          autoTrade: trade.auto_trade,
        });
        continue;
      }

      const stopLoss = trade.stop_loss_price ? parseFloat(trade.stop_loss_price) : null;
      const takeProfit = trade.take_profit_price ? parseFloat(trade.take_profit_price) : null;
      const tp1Price = trade.tp1_price ? parseFloat(trade.tp1_price) : null;
      const tp2Price = trade.tp2_price ? parseFloat(trade.tp2_price) : null;
      const tp1Pct = trade.tp1_pct || 50;
      const quantitySoldTp1 = trade.quantity_sold_tp1 ? parseFloat(trade.quantity_sold_tp1) : 0;
      const tp1AlreadyHit = trade.tp1_hit_at !== null;
      const totalQuantity = parseFloat(trade.quantity);
      const remainingQuantity = totalQuantity - quantitySoldTp1;
      const isBuy = trade.side === 'buy';

      // Check stop loss first (applies to full remaining position)
      if (stopLoss) {
        const slTriggered = isBuy ? currentPrice <= stopLoss : currentPrice >= stopLoss;
        if (slTriggered) {
          try {
            await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, remainingQuantity, 'stop_loss');
            triggered++;
            logger.info('Stop loss triggered', {
              tradeId: trade.id,
              symbol: trade.symbol,
              currentPrice,
              stopLoss,
              remainingQuantity,
            });

            tradeNotification.notifyTpSlTriggered(
              trade.user_id,
              trade.id,
              trade.symbol,
              trade.side,
              'stop_loss',
              parseFloat(trade.filled_price),
              currentPrice,
              remainingQuantity
            ).catch((err) => logger.error('Failed to send SL notification', { error: err }));
          } catch (err) {
            errors++;
            logger.error('Failed to execute SL close', { tradeId: trade.id, error: (err as Error).message });
          }
          continue; // Move to next trade
        }
      }

      // Check partial TP1 (if set and not yet hit)
      if (tp1Price && !tp1AlreadyHit) {
        const tp1Triggered = isBuy ? currentPrice >= tp1Price : currentPrice <= tp1Price;
        if (tp1Triggered) {
          try {
            const quantityToSell = totalQuantity * (tp1Pct / 100);
            await executePartialTakeProfit(trade.user_id, trade.id, trade.symbol, trade.side, quantityToSell, currentPrice);
            partialTps++;
            logger.info('Partial TP1 triggered', {
              tradeId: trade.id,
              symbol: trade.symbol,
              currentPrice,
              tp1Price,
              quantityToSell,
              tp1Pct,
            });

            // Send notification for partial TP
            tradeNotification.notifyTpSlTriggered(
              trade.user_id,
              trade.id,
              trade.symbol,
              trade.side,
              'take_profit',
              parseFloat(trade.filled_price),
              currentPrice,
              quantityToSell
            ).catch((err) => logger.error('Failed to send TP1 notification', { error: err }));
          } catch (err) {
            errors++;
            logger.error('Failed to execute partial TP1', { tradeId: trade.id, error: (err as Error).message });
          }
          continue; // Move to next trade (will check TP2 on next iteration)
        }
      }

      // Check TP2 (if TP1 was hit) or regular take_profit_price
      const effectiveTp = tp1AlreadyHit && tp2Price ? tp2Price : (tp1AlreadyHit ? null : takeProfit);
      if (effectiveTp && remainingQuantity > 0) {
        const tpTriggered = isBuy ? currentPrice >= effectiveTp : currentPrice <= effectiveTp;
        if (tpTriggered) {
          try {
            const reason = tp1AlreadyHit ? 'take_profit_tp2' : 'take_profit';
            await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, remainingQuantity, reason);
            triggered++;
            logger.info('Take profit triggered', {
              tradeId: trade.id,
              symbol: trade.symbol,
              currentPrice,
              effectiveTp,
              remainingQuantity,
              isTP2: tp1AlreadyHit,
            });

            tradeNotification.notifyTpSlTriggered(
              trade.user_id,
              trade.id,
              trade.symbol,
              trade.side,
              'take_profit',
              parseFloat(trade.filled_price),
              currentPrice,
              remainingQuantity
            ).catch((err) => logger.error('Failed to send TP notification', { error: err }));
          } catch (err) {
            errors++;
            logger.error('Failed to execute TP close', { tradeId: trade.id, error: (err as Error).message });
          }
        }
      }
    }
  } catch (error) {
    logger.error('TP/SL check failed', { error: (error as Error).message });
    errors++;
  }

  return { triggered, errors, partialTps };
}

/**
 * Update trailing stop loss prices
 * Supports dual-mode: trailing only activates after profit threshold is reached
 */
export async function updateTrailingStops(): Promise<{ updated: number; triggered: number; errors: number }> {
  let updated = 0;
  let triggered = 0;
  let errors = 0;

  try {
    // Get trades with trailing stop enabled (includes tier for dual-mode)
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
      tier: string | null;
    }>(`
      SELECT id, user_id, symbol, side, quantity, filled_price,
             trailing_stop_pct, trailing_stop_price, trailing_stop_highest, tier
      FROM trades
      WHERE status = 'filled'
        AND trailing_stop_pct IS NOT NULL
        AND closed_at IS NULL
    `);

    if (result.rows.length === 0) return { updated, triggered, errors };

    const symbols = [...new Set(result.rows.map(r => r.symbol))];
    const prices = await getCurrentPrices(symbols);

    // Cache user settings for dual-mode
    const userSettingsCache = new Map<string, autoTradingService.AutoTradingSettings>();

    for (const trade of result.rows) {
      const currentPrice = prices.get(trade.symbol);
      if (!currentPrice) continue;

      const trailingPct = parseFloat(trade.trailing_stop_pct);
      const entryPrice = parseFloat(trade.filled_price);
      const isBuy = trade.side === 'buy';

      // Get user settings for dual-mode activation threshold
      let settings = userSettingsCache.get(trade.user_id);
      if (!settings) {
        settings = await autoTradingService.getSettings(trade.user_id);
        userSettingsCache.set(trade.user_id, settings);
      }

      // Check if trailing is activated (highest price is set)
      const trailingActivated = trade.trailing_stop_highest !== null;
      let highestPrice = trade.trailing_stop_highest ? parseFloat(trade.trailing_stop_highest) : entryPrice;
      let trailingStopPrice = trade.trailing_stop_price ? parseFloat(trade.trailing_stop_price) : null;

      // Calculate current profit percentage
      const profitPct = isBuy
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

      // For dual-mode trades, check if we need to activate trailing
      const isDualModeTrade = trade.tier === 'conservative' || trade.tier === 'aggressive';
      const activationThreshold = settings.dualModeEnabled ? settings.trailActivationPct : 0;

      if (isBuy) {
        // For long positions: track highest price, stop triggers below

        // Check if trailing should activate (dual-mode: profit >= activation threshold)
        if (!trailingActivated && isDualModeTrade && settings.dualModeEnabled) {
          if (profitPct >= activationThreshold) {
            // Activate trailing now
            highestPrice = currentPrice;
            trailingStopPrice = currentPrice * (1 - trailingPct / 100);

            await pool.query(
              `UPDATE trades SET trailing_stop_highest = $1, trailing_stop_price = $2 WHERE id = $3`,
              [highestPrice, trailingStopPrice, trade.id]
            );
            updated++;

            logger.info('Trailing stop activated (dual-mode)', {
              tradeId: trade.id,
              symbol: trade.symbol,
              tier: trade.tier,
              profitPct: profitPct.toFixed(2),
              activationThreshold,
              trailingStopPrice,
            });

            tradeNotification.notifyTrailingStopUpdate(
              trade.user_id,
              trade.id,
              trade.symbol,
              trailingStopPrice,
              highestPrice,
              trailingPct
            ).catch((err) => logger.error('Failed to send trailing update notification', { error: err }));
          } else {
            // Not yet activated - check initial stop loss
            const initialSlPct = settings.initialStopLossPct || 5.0;
            if (profitPct <= -initialSlPct) {
              // Initial stop loss triggered before trailing activated
              try {
                await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, parseFloat(trade.quantity), 'stop_loss');
                triggered++;
                logger.info('Initial stop loss triggered (dual-mode)', {
                  tradeId: trade.id,
                  symbol: trade.symbol,
                  tier: trade.tier,
                  profitPct: profitPct.toFixed(2),
                  initialSlPct,
                  currentPrice,
                  entryPrice,
                });
              } catch (err) {
                logger.error('Failed to execute initial SL close', { tradeId: trade.id, error: err });
              }
            }
          }
          // Not yet activated, skip further processing
          continue;
        }

        // Normal trailing logic (or already activated)
        if (currentPrice > highestPrice) {
          highestPrice = currentPrice;
          trailingStopPrice = currentPrice * (1 - trailingPct / 100);

          await pool.query(
            `UPDATE trades SET trailing_stop_highest = $1, trailing_stop_price = $2 WHERE id = $3`,
            [highestPrice, trailingStopPrice, trade.id]
          );
          updated++;

          // Send trailing stop update notification (rate limited)
          tradeNotification.notifyTrailingStopUpdate(
            trade.user_id,
            trade.id,
            trade.symbol,
            trailingStopPrice,
            highestPrice,
            trailingPct
          ).catch((err) => logger.error('Failed to send trailing update notification', { error: err }));
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
              tier: trade.tier,
            });

            // Send trailing stop triggered notification
            tradeNotification.notifyTrailingStopTriggered(
              trade.user_id,
              trade.id,
              trade.symbol,
              trade.side,
              parseFloat(trade.filled_price),
              currentPrice,
              parseFloat(trade.quantity)
            ).catch((err) => logger.error('Failed to send trailing triggered notification', { error: err }));
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

        // Check if trailing should activate (dual-mode)
        if (!trailingActivated && isDualModeTrade && settings.dualModeEnabled) {
          if (profitPct >= activationThreshold) {
            highestPrice = currentPrice; // Actually lowest for shorts
            trailingStopPrice = currentPrice * (1 + trailingPct / 100);

            await pool.query(
              `UPDATE trades SET trailing_stop_highest = $1, trailing_stop_price = $2 WHERE id = $3`,
              [highestPrice, trailingStopPrice, trade.id]
            );
            updated++;

            logger.info('Trailing stop activated (dual-mode short)', {
              tradeId: trade.id,
              symbol: trade.symbol,
              tier: trade.tier,
              profitPct: profitPct.toFixed(2),
              activationThreshold,
            });

            tradeNotification.notifyTrailingStopUpdate(
              trade.user_id,
              trade.id,
              trade.symbol,
              trailingStopPrice,
              highestPrice,
              trailingPct
            ).catch((err) => logger.error('Failed to send trailing update notification', { error: err }));
          } else {
            // Not yet activated - check initial stop loss for shorts
            const initialSlPct = settings.initialStopLossPct || 5.0;
            if (profitPct <= -initialSlPct) {
              try {
                await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, parseFloat(trade.quantity), 'stop_loss');
                triggered++;
                logger.info('Initial stop loss triggered (dual-mode short)', {
                  tradeId: trade.id,
                  symbol: trade.symbol,
                  tier: trade.tier,
                  profitPct: profitPct.toFixed(2),
                  initialSlPct,
                  currentPrice,
                  entryPrice,
                });
              } catch (err) {
                logger.error('Failed to execute initial SL close (short)', { tradeId: trade.id, error: err });
              }
            }
          }
          continue;
        }

        if (currentPrice < highestPrice) {
          highestPrice = currentPrice; // Actually lowest for shorts
          trailingStopPrice = currentPrice * (1 + trailingPct / 100);

          await pool.query(
            `UPDATE trades SET trailing_stop_highest = $1, trailing_stop_price = $2 WHERE id = $3`,
            [highestPrice, trailingStopPrice, trade.id]
          );
          updated++;

          // Send trailing stop update notification (rate limited)
          tradeNotification.notifyTrailingStopUpdate(
            trade.user_id,
            trade.id,
            trade.symbol,
            trailingStopPrice,
            highestPrice,
            trailingPct
          ).catch((err) => logger.error('Failed to send trailing update notification', { error: err }));
        } else if (trailingStopPrice && currentPrice >= trailingStopPrice) {
          try {
            await executeClosePosition(trade.user_id, trade.id, trade.symbol, trade.side, parseFloat(trade.quantity), 'trailing_stop');
            triggered++;

            // Send trailing stop triggered notification
            tradeNotification.notifyTrailingStopTriggered(
              trade.user_id,
              trade.id,
              trade.symbol,
              trade.side,
              parseFloat(trade.filled_price),
              currentPrice,
              parseFloat(trade.quantity)
            ).catch((err) => logger.error('Failed to send trailing triggered notification', { error: err }));
          } catch (err) {
            errors++;
            logger.error('Failed to execute trailing stop close (short)', {
              tradeId: trade.id,
              symbol: trade.symbol,
              side: trade.side,
              error: (err as Error).message,
            });
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
 * Check status of pending/open orders on both Binance and Crypto.com
 */
export async function checkPendingOrders(): Promise<{ filled: number; cancelled: number; errors: number }> {
  let filled = 0;
  let cancelled = 0;
  let errors = 0;

  try {
    // Get pending orders from both exchanges
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      side: string;
      quantity: string;
      price: string | null;
      binance_order_id: string | null;
      exchange_order_id: string | null;
      exchange: string;
      stop_loss_price: string | null;
      take_profit_price: string | null;
    }>(`
      SELECT id, user_id, symbol, side, quantity, price,
             binance_order_id, exchange_order_id,
             COALESCE(exchange, 'binance') as exchange,
             stop_loss_price, take_profit_price
      FROM trades
      WHERE status = 'pending'
        AND (binance_order_id IS NOT NULL OR exchange_order_id IS NOT NULL)
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
      const client = await getClientForUser(userId);
      if (!client) continue;

      for (const order of orders) {
        try {
          const orderId = order.binance_order_id || order.exchange_order_id;
          if (!orderId) continue;

          // Get order status from the appropriate exchange
          const exchangeOrder = await client.getOrder(order.symbol, orderId);

          if (exchangeOrder.status === 'FILLED') {
            // Calculate fill details
            let filledPrice = exchangeOrder.averagePrice || 0;
            let totalValue = exchangeOrder.total || 0;
            let fee = exchangeOrder.fee || 0;
            let feeAsset = exchangeOrder.feeAsset || '';

            // Handle Binance-style fills array
            // Get the executed quantity from the exchange order
            let executedQty = parseFloat(exchangeOrder.executedQty) || 0;

            if (!filledPrice && exchangeOrder.fills && exchangeOrder.fills.length > 0) {
              let totalQty = 0;
              for (const fill of exchangeOrder.fills) {
                totalQty += parseFloat(fill.qty);
                totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
                fee += parseFloat(fill.commission);
                feeAsset = fill.commissionAsset;
              }
              filledPrice = totalQty > 0 ? totalValue / totalQty : parseFloat(exchangeOrder.price || '0');
              executedQty = totalQty;
            }

            // Also update quantity if it was 0 (fixes historical data issue)
            // Ensure executedQty is a valid number
            const safeExecutedQty = Number(executedQty) || 0;
            await pool.query(
              `UPDATE trades SET
                status = 'filled',
                filled_price = $1,
                total = $2,
                fee = $3,
                fee_asset = $4,
                quantity = CASE WHEN quantity = 0 AND $6::numeric > 0 THEN $6::numeric ELSE quantity END,
                filled_at = NOW()
               WHERE id = $5`,
              [filledPrice, totalValue, fee, feeAsset, order.id, safeExecutedQty]
            );

            filled++;
            logger.info('Order filled', {
              tradeId: order.id,
              symbol: order.symbol,
              filledPrice,
              total: totalValue,
              exchange: 'crypto_com',
            });

            // Send Telegram notification for filled order
            tradeNotification.notifyOrderFilled(userId, {
              id: order.id,
              symbol: order.symbol,
              side: order.side,
              quantity: parseFloat(order.quantity),
              filledPrice,
              total: totalValue,
              stopLossPrice: order.stop_loss_price ? parseFloat(order.stop_loss_price) : undefined,
              takeProfitPrice: order.take_profit_price ? parseFloat(order.take_profit_price) : undefined,
            }).catch((err) => logger.error('Failed to send fill notification', { error: err }));
          } else if (exchangeOrder.status === 'CANCELED' || exchangeOrder.status === 'CANCELLED' || exchangeOrder.status === 'EXPIRED') {
            // Check if order had any fills before being cancelled
            // Crypto.com sometimes shows CANCELED but order actually filled
            const execQty = parseFloat(exchangeOrder.executedQty) || 0;
            const hasFills = exchangeOrder.fills && exchangeOrder.fills.length > 0;

            if (execQty > 0 || hasFills) {
              // Order partially or fully filled before cancel - treat as filled
              let filledPrice = 0;
              let totalValue = 0;
              let fee = 0;
              let feeAsset = '';

              if (hasFills) {
                let totalQty = 0;
                for (const fill of exchangeOrder.fills!) {
                  totalQty += parseFloat(fill.qty);
                  totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
                  fee += parseFloat(fill.commission);
                  feeAsset = fill.commissionAsset;
                }
                filledPrice = totalQty > 0 ? totalValue / totalQty : 0;
              }

              // If no fill data, try to get current price
              if (!filledPrice) {
                try {
                  const sym = toCryptoComSymbol(order.symbol);
                  const tickerResult = await client.getTicker24hr(sym);
                  const ticker = Array.isArray(tickerResult)
                    ? tickerResult.find((t: { symbol: string }) => t.symbol === sym)
                    : tickerResult;
                  if (ticker && ticker.lastPrice) {
                    filledPrice = parseFloat(String(ticker.lastPrice));
                    totalValue = filledPrice * execQty;
                  }
                } catch { /* ignore */ }
              }

              await pool.query(
                `UPDATE trades SET
                  status = 'filled',
                  filled_price = $1,
                  quantity = $2,
                  total = $3,
                  fee = $4,
                  fee_asset = $5,
                  filled_at = NOW()
                 WHERE id = $6`,
                [filledPrice, execQty, totalValue, fee, feeAsset || null, order.id]
              );
              filled++;
              logger.info('Order filled (was marked cancelled but had fills)', {
                tradeId: order.id,
                symbol: order.symbol,
                executedQty: execQty,
                filledPrice,
                exchange: 'crypto_com',
              });

              tradeNotification.notifyOrderFilled(userId, {
                id: order.id,
                symbol: order.symbol,
                side: order.side,
                quantity: execQty,
                filledPrice,
                total: totalValue,
                stopLossPrice: order.stop_loss_price ? parseFloat(order.stop_loss_price) : undefined,
                takeProfitPrice: order.take_profit_price ? parseFloat(order.take_profit_price) : undefined,
              }).catch((err) => logger.error('Failed to send fill notification', { error: err }));
            } else {
              // Truly cancelled with no fills
              await pool.query(
                `UPDATE trades SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
                [order.id]
              );
              cancelled++;
              logger.info('Order cancelled/expired', {
                tradeId: order.id,
                status: exchangeOrder.status,
                exchange: 'crypto_com',
              });

              // Send Telegram notification for cancelled order
              const reason = exchangeOrder.status === 'EXPIRED' ? 'expired' : 'cancelled';
              tradeNotification.notifyOrderCancelled(
                userId,
                order.id,
                order.symbol,
                order.side,
                order.price ? parseFloat(order.price) : null,
                reason
              ).catch((err) => logger.error('Failed to send cancel notification', { error: err }));
            }
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
 * Exported for use by Telegram trade callbacks
 * Supports both Binance and Crypto.com exchanges, including margin positions
 */
export async function executeClosePosition(
  userId: string,
  tradeId: string,
  symbol: string,
  side: string,
  quantity: number,
  reason: string
): Promise<void> {
  const client = await getClientForUser(userId);
  if (!client) {
    throw new Error('Crypto.com client not available');
  }

  // Check if this is a margin position
  const tradeInfo = await pool.query(
    `SELECT margin_mode, leverage FROM trades WHERE id = $1`,
    [tradeId]
  );
  const isMarginTrade = tradeInfo.rows[0]?.margin_mode === 'MARGIN';

  // Close position with opposite order
  const closeSide = side === 'buy' || side === 'long' ? 'SELL' : 'BUY';

  // Normalize symbol to Crypto.com format
  const normalizedSymbol = toCryptoComSymbol(symbol);
  const exchange: ExchangeType = 'crypto_com';

  // Get actual balance from exchange to prevent INSUFFICIENT_BALANCE errors
  let actualQuantity = quantity;
  try {
    const { getPortfolio } = await import('./trading.service.js');
    const portfolio = await getPortfolio(userId);
    if (portfolio && portfolio.holdings) {
      // Extract base asset from symbol (e.g., CHZ from CHZ_USD)
      const baseAsset = normalizedSymbol.replace(/_USD$|USD$|_USDT$|USDT$/, '');
      const holding = portfolio.holdings.find(h => h.asset === baseAsset);
    if (holding && holding.amount) {
      // Use the minimum of database quantity and actual balance
      if (holding.amount < quantity) {
        logger.warn('Adjusting sell quantity to match actual balance', {
          tradeId,
          symbol,
          requestedQty: quantity,
          actualBalance: holding.amount,
        });
        actualQuantity = holding.amount;
      }
    }
    }
  } catch (balanceErr) {
    logger.warn('Could not verify balance, using database quantity', {
      tradeId,
      error: (balanceErr as Error).message,
    });
  }

  // Format quantity according to symbol's lot size
  let formattedQuantity: string;
  try {
    const lotSize = await client.getLotSizeFilter(normalizedSymbol);
    if (lotSize && lotSize.stepSize) {
      const step = parseFloat(lotSize.stepSize);

      if (step >= 1) {
        // For large step sizes (e.g., 10000 for SHIB/BONK), round down to nearest multiple
        const rounded = Math.floor(actualQuantity / step) * step;
        formattedQuantity = rounded.toString();
      } else {
        // For small step sizes, use precision-based formatting
        const precision = Math.max(0, Math.ceil(-Math.log10(step)));
        const multiplier = Math.pow(10, precision);
        const rounded = Math.floor(actualQuantity * multiplier) / multiplier;
        formattedQuantity = rounded.toFixed(precision);
      }
    } else {
      // Default: 2 decimal places for most coins, round down
      const factor = 100;
      formattedQuantity = (Math.floor(actualQuantity * factor) / factor).toFixed(2);
    }
  } catch {
    // Fallback to 2 decimal places, round down
    const factor = 100;
    formattedQuantity = (Math.floor(actualQuantity * factor) / factor).toFixed(2);
  }

  let order;
  if (isMarginTrade && client.supportsMargin) {
    // Close margin position
    const marginClient = client as IMarginExchangeClient;
    const positionSide = side === 'buy' || side === 'long' ? 'long' : 'short';
    order = await marginClient.closeMarginPosition(normalizedSymbol, positionSide);
  } else {
    // Close spot position
    order = await client.placeOrder({
      symbol: normalizedSymbol,
      side: closeSide as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity: formattedQuantity,
    });
  }

  // Calculate fill details
  let filledPrice = order.averagePrice || 0;
  let total = order.total || 0;
  let fee = order.fee || 0;
  let feeAsset = order.feeAsset || '';

  // If no averagePrice, calculate from fills (Binance style)
  if (!filledPrice && order.fills && order.fills.length > 0) {
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

  // CRITICAL: If still no fill price, fetch current market price as fallback
  // This prevents incorrect P&L calculations (e.g., -$33 instead of -$0.52)
  if (!filledPrice || filledPrice === 0) {
    try {
      const tickerResult = await client.getTicker24hr(normalizedSymbol);
      const ticker = Array.isArray(tickerResult)
        ? tickerResult.find((t: { symbol: string }) => t.symbol === normalizedSymbol)
        : tickerResult;
      if (ticker && ticker.lastPrice) {
        filledPrice = parseFloat(String(ticker.lastPrice));
        console.log(`[OrderMonitor] Using current market price ${filledPrice} for ${normalizedSymbol} (no fill price from exchange)`);
      }
    } catch (tickerErr) {
      console.error('[OrderMonitor] Failed to get market price fallback:', tickerErr);
    }
  }

  // Final fallback: if STILL no price, get entry price from original trade (at least avoid 0)
  if (!filledPrice || filledPrice === 0) {
    const originalTrade = await pool.query('SELECT filled_price FROM trades WHERE id = $1', [tradeId]);
    if (originalTrade.rows[0]?.filled_price) {
      filledPrice = parseFloat(originalTrade.rows[0].filled_price);
      console.warn(`[OrderMonitor] WARNING: Using entry price ${filledPrice} as exit price for ${normalizedSymbol} - P&L will be ~0`);
    }
  }

  // Update original trade as closed
  await pool.query(
    `UPDATE trades SET
      closed_at = NOW(),
      close_price = $1,
      close_reason = $2,
      close_order_id = $3
     WHERE id = $4`,
    [filledPrice, reason, order.orderId, tradeId]
  );

  // Also update margin_positions table if applicable
  if (isMarginTrade) {
    await pool.query(
      `UPDATE margin_positions SET
        status = 'closed',
        closed_at = NOW(),
        close_price = $1,
        realized_pnl = (CASE
          WHEN side = 'long' THEN ($1 - entry_price) * quantity
          WHEN side = 'short' THEN (entry_price - $1) * quantity
          ELSE 0
        END)
       WHERE trade_id = $2 AND status = 'open'`,
      [filledPrice, tradeId]
    );
  }

  // Create close trade record - use exchange_order_id for Crypto.com
  // Mark with closed_at so it's not shown as an open position
  // Use original quantity if executedQty is 0 (Crypto.com may not return it immediately)
  const closeQuantity = parseFloat(order.executedQty) || quantity;
  const orderIdColumn = 'exchange_order_id';
  await pool.query(
    `INSERT INTO trades (
      user_id, symbol, side, order_type, quantity, filled_price, total,
      fee, fee_asset, status, ${orderIdColumn}, exchange, margin_mode, notes, filled_at, closed_at
    ) VALUES ($1, $2, $3, 'market', $4, $5, $6, $7, $8, 'filled', $9, $10, $11, $12, NOW(), NOW())`,
    [
      userId,
      normalizedSymbol,
      closeSide.toLowerCase(),
      closeQuantity,
      filledPrice,
      total || (filledPrice * closeQuantity),
      fee,
      feeAsset,
      order.orderId,
      exchange,
      isMarginTrade ? 'MARGIN' : 'SPOT',
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
    `${symbol}: Closed at $${filledPrice.toFixed(2)}${isMarginTrade ? ' (Margin)' : ''}`,
    reason === 'stop_loss' ? 'trading.stop_loss_triggered' :
    reason === 'take_profit' ? 'trading.take_profit_hit' : 'trading.position_closed',
    reason === 'stop_loss' ? 10 : 8, // Stop loss is critical
    { tradeId, symbol, reason, exchange, isMargin: isMarginTrade }
  );

  // Log the action
  await pool.query(
    `INSERT INTO bot_logs (bot_id, action, details)
     VALUES (NULL, $1, $2)`,
    [
      `order_monitor_${reason}`,
      JSON.stringify({
        tradeId,
        symbol: normalizedSymbol,
        side: closeSide,
        quantity,
        filledPrice,
        total,
        reason,
        exchange,
        isMargin: isMarginTrade,
      }),
    ]
  );

  // Handle auto trade close for state tracking
  const autoTradeCheck = await pool.query(
    `SELECT auto_trade, filled_price FROM trades WHERE id = $1`,
    [tradeId]
  );
  if (autoTradeCheck.rows[0]?.auto_trade) {
    const entryPrice = parseFloat(autoTradeCheck.rows[0].filled_price) || 0;
    const pnlUsd = (side === 'buy' || side === 'long')
      ? (filledPrice - entryPrice) * quantity
      : (entryPrice - filledPrice) * quantity;
    const outcome = pnlUsd >= 0 ? 'win' : 'loss';

    try {
      await autoTradingService.handleTradeClose(userId, tradeId, outcome, pnlUsd, symbol);
    } catch (err) {
      logger.error('Failed to update auto trading state', {
        tradeId,
        symbol,
        outcome,
        pnlUsd: pnlUsd.toFixed(2),
        error: (err as Error).message,
      });
      // Don't rethrow - trade close succeeded, just state update failed
    }
  }
}

/**
 * Poll for TradeCore trades that need notifications
 * TradeCore inserts trades with notification_sent = false
 * Luna polls and sends Telegram notifications, then marks as sent
 */
export async function pollTradeCoreNotifications(): Promise<{ notified: number; errors: number }> {
  let notified = 0;
  let errors = 0;

  try {
    // Get trades inserted by TradeCore that need notifications
    const result = await pool.query<{
      id: string;
      user_id: string;
      bot_id: string | null;
      symbol: string;
      side: string;
      order_type: string;
      quantity: string;
      filled_price: string | null;
      total: string | null;
      fee: string | null;
      status: string;
      tradecore_order_id: string;
      stop_loss_price: string | null;
      take_profit_price: string | null;
      trailing_stop_pct: string | null;
      notes: string | null;
    }>(`
      SELECT id, user_id, bot_id, symbol, side, order_type, quantity,
             filled_price, total, fee, status, tradecore_order_id,
             stop_loss_price, take_profit_price, trailing_stop_pct, notes
      FROM trades
      WHERE notification_sent = false
        AND tradecore_order_id IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 50
    `);

    if (result.rows.length === 0) {
      return { notified, errors };
    }

    logger.info('Processing TradeCore trade notifications', { count: result.rows.length });

    for (const trade of result.rows) {
      try {
        // Determine notification type based on trade status
        if (trade.status === 'filled') {
          await tradeNotification.notifyOrderFilled(trade.user_id, {
            id: trade.id,
            symbol: trade.symbol,
            side: trade.side,
            quantity: parseFloat(trade.quantity),
            filledPrice: trade.filled_price ? parseFloat(trade.filled_price) : undefined,
            total: trade.total ? parseFloat(trade.total) : undefined,
            stopLossPrice: trade.stop_loss_price ? parseFloat(trade.stop_loss_price) : undefined,
            takeProfitPrice: trade.take_profit_price ? parseFloat(trade.take_profit_price) : undefined,
            trailingStopPct: trade.trailing_stop_pct ? parseFloat(trade.trailing_stop_pct) : undefined,
          });
        } else if (trade.status === 'pending' || trade.status === 'new') {
          await tradeNotification.notifyOrderPlaced(trade.user_id, {
            id: trade.id,
            symbol: trade.symbol,
            side: trade.side,
            quantity: parseFloat(trade.quantity),
            price: trade.filled_price ? parseFloat(trade.filled_price) : undefined,
            total: trade.total ? parseFloat(trade.total) : undefined,
            stopLossPrice: trade.stop_loss_price ? parseFloat(trade.stop_loss_price) : undefined,
            takeProfitPrice: trade.take_profit_price ? parseFloat(trade.take_profit_price) : undefined,
            trailingStopPct: trade.trailing_stop_pct ? parseFloat(trade.trailing_stop_pct) : undefined,
          });
        } else if (trade.status === 'cancelled' || trade.status === 'expired') {
          await tradeNotification.notifyOrderCancelled(
            trade.user_id,
            trade.id,
            trade.symbol,
            trade.side,
            trade.filled_price ? parseFloat(trade.filled_price) : null,
            trade.status as 'cancelled' | 'expired'
          );
        }

        // Mark notification as sent
        await pool.query(
          `UPDATE trades SET notification_sent = true WHERE id = $1`,
          [trade.id]
        );

        notified++;

        logger.debug('TradeCore notification sent', {
          tradeId: trade.id,
          userId: trade.user_id,
          symbol: trade.symbol,
          status: trade.status,
        });
      } catch (err) {
        errors++;
        logger.error('Failed to send TradeCore notification', {
          tradeId: trade.id,
          error: (err as Error).message,
        });

        // Mark as sent anyway to avoid infinite retry loops
        // Could add a retry counter in the future
        await pool.query(
          `UPDATE trades SET notification_sent = true WHERE id = $1`,
          [trade.id]
        );
      }
    }
  } catch (error) {
    logger.error('TradeCore notification polling failed', { error: (error as Error).message });
    errors++;
  }

  return { notified, errors };
}

/**
 * Update unrealized P&L for open margin positions
 * Only runs for Crypto.com margin positions
 */
export async function updateMarginPositionsPnL(): Promise<{ updated: number; liquidationWarnings: number; errors: number }> {
  let updated = 0;
  let liquidationWarnings = 0;
  let errors = 0;

  try {
    // Get open margin positions
    const result = await pool.query<{
      id: string;
      user_id: string;
      symbol: string;
      side: string;
      entry_price: string;
      quantity: string;
      leverage: number;
      liquidation_price: string | null;
    }>(`
      SELECT id, user_id, symbol, side, entry_price, quantity, leverage, liquidation_price
      FROM margin_positions
      WHERE status = 'open'
    `);

    if (result.rows.length === 0) return { updated, liquidationWarnings, errors };

    // Get current prices for all symbols
    const symbols = [...new Set(result.rows.map(r => r.symbol))];
    const prices = await getCurrentPrices(symbols);

    for (const position of result.rows) {
      try {
        const currentPrice = prices.get(position.symbol);
        if (!currentPrice) continue;

        const entryPrice = parseFloat(position.entry_price);
        const quantity = parseFloat(position.quantity);

        // Calculate unrealized P&L
        let unrealizedPnl: number;
        if (position.side === 'long') {
          unrealizedPnl = (currentPrice - entryPrice) * quantity;
        } else {
          unrealizedPnl = (entryPrice - currentPrice) * quantity;
        }

        // Update position
        await pool.query(
          `UPDATE margin_positions SET unrealized_pnl = $1, updated_at = NOW() WHERE id = $2`,
          [unrealizedPnl, position.id]
        );
        updated++;

        // Check liquidation proximity (warn at 10% from liquidation)
        if (position.liquidation_price) {
          const liquidationPrice = parseFloat(position.liquidation_price);
          const distanceToLiquidation = position.side === 'long'
            ? (currentPrice - liquidationPrice) / currentPrice
            : (liquidationPrice - currentPrice) / currentPrice;

          if (distanceToLiquidation < 0.1) {
            liquidationWarnings++;
            logger.warn('Position near liquidation', {
              positionId: position.id,
              userId: position.user_id,
              symbol: position.symbol,
              currentPrice,
              liquidationPrice,
              distancePercent: (distanceToLiquidation * 100).toFixed(2),
            });

            // Send warning notification
            await deliveryService.sendTradingNotification(
              position.user_id,
              'Liquidation Warning',
              `${position.symbol} ${position.side.toUpperCase()} position is ${(distanceToLiquidation * 100).toFixed(1)}% from liquidation!`,
              'trading.liquidation_warning',
              10, // Critical priority
              { positionId: position.id, symbol: position.symbol }
            );
          }
        }
      } catch (err) {
        errors++;
        logger.error('Failed to update margin position P&L', {
          positionId: position.id,
          error: (err as Error).message,
        });
      }
    }
  } catch (error) {
    logger.error('Margin position P&L update failed', { error: (error as Error).message });
    errors++;
  }

  return { updated, liquidationWarnings, errors };
}

/**
 * Main job handler - runs all order monitoring checks
 */
export async function runOrderMonitorJob(): Promise<void> {
  const startTime = Date.now();

  logger.debug('Order monitor job starting');

  // Run all checks in parallel for efficiency
  const [tpslResult, trailingResult, pendingResult, tradecoreResult, marginResult] = await Promise.all([
    checkTakeProfitStopLoss(),
    updateTrailingStops(),
    checkPendingOrders(),
    pollTradeCoreNotifications(),
    updateMarginPositionsPnL(),
  ]);

  const duration = Date.now() - startTime;

  // Only log if there was activity
  if (
    tpslResult.triggered > 0 ||
    trailingResult.triggered > 0 ||
    trailingResult.updated > 0 ||
    pendingResult.filled > 0 ||
    pendingResult.cancelled > 0 ||
    tradecoreResult.notified > 0 ||
    marginResult.updated > 0 ||
    marginResult.liquidationWarnings > 0
  ) {
    logger.info('Order monitor job completed', {
      duration,
      tpsl: tpslResult,
      trailing: trailingResult,
      pending: pendingResult,
      tradecore: tradecoreResult,
      margin: marginResult,
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
  pollTradeCoreNotifications,
  updateMarginPositionsPnL,
};
