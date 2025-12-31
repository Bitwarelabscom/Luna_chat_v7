/**
 * Trade Notification Service
 *
 * Sends trade events to users via Telegram with quick action buttons.
 * All Telegram-connected users automatically receive notifications.
 */

import { pool } from '../db/index.js';
import * as tradingTelegramService from '../triggers/trading-telegram.service.js';
import logger from '../utils/logger.js';

// Rate limiting for trailing stop updates (max 1 per 5 minutes per trade)
const trailingStopNotifications = new Map<string, number>();
const TRAILING_STOP_COOLDOWN = 5 * 60 * 1000; // 5 minutes

interface TradeInfo {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  price?: number;
  filledPrice?: number;
  total?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
}

/**
 * Get Trading Telegram chat ID for a user
 */
async function getUserTelegramChatId(userId: string): Promise<number | null> {
  try {
    const result = await pool.query(
      `SELECT chat_id FROM trading_telegram_connections
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0]?.chat_id || null;
  } catch (error) {
    logger.error('Failed to get Trading Telegram chat ID', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Format price for display
 */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(2);
  } else {
    return price.toPrecision(4);
  }
}

/**
 * Format quantity for display
 */
function formatQuantity(qty: number): string {
  if (qty >= 1) {
    return qty.toLocaleString(undefined, { maximumFractionDigits: 4 });
  } else {
    return qty.toPrecision(4);
  }
}

/**
 * Build action buttons for open position
 */
function buildPositionButtons(tradeId: string): Array<{ text: string; callback: string }> {
  return [
    { text: 'Close Position', callback: `trade:close:${tradeId}` },
    { text: 'Modify SL', callback: `trade:modsl:${tradeId}` },
  ];
}

/**
 * Send trade notification via Trading Telegram
 */
async function sendTradeNotification(
  userId: string,
  message: string,
  buttons?: Array<{ text: string; callback: string }>
): Promise<boolean> {
  try {
    const chatId = await getUserTelegramChatId(userId);
    if (!chatId) {
      return false; // User not connected to Trading Telegram - silently skip
    }

    if (buttons && buttons.length > 0) {
      const result = await tradingTelegramService.sendMessageWithButtons(chatId, message, buttons);
      return result.success;
    } else {
      return await tradingTelegramService.sendMessage(chatId, message);
    }
  } catch (error) {
    logger.error('Failed to send trade notification', { userId, error: (error as Error).message });
    return false;
  }
}

/**
 * Notify when an order is placed
 */
export async function notifyOrderPlaced(userId: string, trade: TradeInfo): Promise<void> {
  try {
    const emoji = trade.side === 'buy' ? '🟢' : '🔴';
    const typeLabel = trade.price ? 'Limit' : 'Market';

    let message = `${emoji} ${trade.side.toUpperCase()} Order Placed\n\n`;
    message += `Symbol: ${trade.symbol}\n`;
    message += `Type: ${typeLabel}\n`;
    message += `Quantity: ${formatQuantity(trade.quantity)}\n`;

    if (trade.price) {
      message += `Price: $${formatPrice(trade.price)}\n`;
    }
    if (trade.total) {
      message += `Est. Value: ~$${formatPrice(trade.total)}\n`;
    }
    if (trade.stopLossPrice) {
      message += `\nStop Loss: $${formatPrice(trade.stopLossPrice)}`;
    }
    if (trade.takeProfitPrice) {
      message += `\nTake Profit: $${formatPrice(trade.takeProfitPrice)}`;
    }
    if (trade.trailingStopPct) {
      message += `\nTrailing Stop: ${trade.trailingStopPct}%`;
    }

    // Only show close button (can't modify SL until filled)
    const buttons = [{ text: 'Cancel Order', callback: `trade:cancel:${trade.id}` }];
    await sendTradeNotification(userId, message, buttons);
  } catch (error) {
    logger.error('Failed to send order placed notification', { userId, tradeId: trade.id, error: (error as Error).message });
  }
}

/**
 * Notify when an order is filled
 */
export async function notifyOrderFilled(userId: string, trade: TradeInfo): Promise<void> {
  try {
    const emoji = trade.side === 'buy' ? '🟢' : '🔴';

    let message = `${emoji} Order Filled\n\n`;
    message += `${trade.symbol} ${trade.side.toUpperCase()}\n`;
    message += `Qty: ${formatQuantity(trade.quantity)} @ $${formatPrice(trade.filledPrice || trade.price || 0)}\n`;

    if (trade.total) {
      message += `Total: $${formatPrice(trade.total)}\n`;
    }
    if (trade.stopLossPrice) {
      message += `\nSL: $${formatPrice(trade.stopLossPrice)}`;
    }
    if (trade.takeProfitPrice) {
      message += `\nTP: $${formatPrice(trade.takeProfitPrice)}`;
    }
    if (trade.trailingStopPct) {
      message += `\nTrail: ${trade.trailingStopPct}%`;
    }

    await sendTradeNotification(userId, message, buildPositionButtons(trade.id));
  } catch (error) {
    logger.error('Failed to send order filled notification', { userId, tradeId: trade.id, error: (error as Error).message });
  }
}

/**
 * Notify when TP or SL is triggered
 */
export async function notifyTpSlTriggered(
  userId: string,
  tradeId: string,
  symbol: string,
  side: string,
  reason: 'stop_loss' | 'take_profit',
  entryPrice: number,
  closePrice: number,
  quantity: number
): Promise<void> {
  try {
    const isProfit = reason === 'take_profit';
    const emoji = isProfit ? '🎯' : '🛑';
    const label = isProfit ? 'Take Profit Triggered' : 'Stop Loss Triggered';

    const pnl = side === 'buy'
      ? (closePrice - entryPrice) * quantity
      : (entryPrice - closePrice) * quantity;
    const pnlPct = ((closePrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1);

    let message = `${emoji} ${label}\n\n`;
    message += `${symbol} Position Closed\n`;
    message += `Entry: $${formatPrice(entryPrice)}\n`;
    message += `Exit: $${formatPrice(closePrice)}\n`;
    message += `P&L: ${pnl >= 0 ? '+' : ''}$${formatPrice(Math.abs(pnl))} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;

    // No buttons - position is closed
    await sendTradeNotification(userId, message);
  } catch (error) {
    logger.error('Failed to send TP/SL notification', { userId, tradeId, error: (error as Error).message });
  }
}

/**
 * Notify when trailing stop price is updated
 */
export async function notifyTrailingStopUpdate(
  userId: string,
  tradeId: string,
  symbol: string,
  newStopPrice: number,
  highestPrice: number,
  trailingPct: number
): Promise<void> {
  try {
    // Rate limit: max 1 notification per 5 minutes per trade
    const lastNotified = trailingStopNotifications.get(tradeId);
    if (lastNotified && Date.now() - lastNotified < TRAILING_STOP_COOLDOWN) {
      return;
    }
    trailingStopNotifications.set(tradeId, Date.now());

    let message = `📈 Trailing Stop Updated\n\n`;
    message += `${symbol}\n`;
    message += `New High: $${formatPrice(highestPrice)}\n`;
    message += `New Stop: $${formatPrice(newStopPrice)} (${trailingPct}% trail)`;

    await sendTradeNotification(userId, message, buildPositionButtons(tradeId));
  } catch (error) {
    logger.error('Failed to send trailing stop update notification', { userId, tradeId, error: (error as Error).message });
  }
}

/**
 * Notify when trailing stop is triggered
 */
export async function notifyTrailingStopTriggered(
  userId: string,
  tradeId: string,
  symbol: string,
  side: string,
  entryPrice: number,
  closePrice: number,
  quantity: number
): Promise<void> {
  try {
    const pnl = side === 'buy'
      ? (closePrice - entryPrice) * quantity
      : (entryPrice - closePrice) * quantity;
    const pnlPct = ((closePrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1);

    let message = `📉 Trailing Stop Triggered\n\n`;
    message += `${symbol} Position Closed\n`;
    message += `Entry: $${formatPrice(entryPrice)}\n`;
    message += `Exit: $${formatPrice(closePrice)}\n`;
    message += `P&L: ${pnl >= 0 ? '+' : ''}$${formatPrice(Math.abs(pnl))} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;

    // No buttons - position is closed
    await sendTradeNotification(userId, message);
  } catch (error) {
    logger.error('Failed to send trailing stop triggered notification', { userId, tradeId, error: (error as Error).message });
  }
}

/**
 * Notify when order is cancelled or expired
 */
export async function notifyOrderCancelled(
  userId: string,
  tradeId: string,
  symbol: string,
  side: string,
  price: number | null,
  reason: 'cancelled' | 'expired' = 'cancelled'
): Promise<void> {
  try {
    const emoji = '❌';
    const label = reason === 'expired' ? 'Order Expired' : 'Order Cancelled';

    let message = `${emoji} ${label}\n\n`;
    message += `${symbol} ${side.toUpperCase()}`;
    if (price) {
      message += ` @ $${formatPrice(price)}`;
    }

    // No buttons - order is gone
    await sendTradeNotification(userId, message);
  } catch (error) {
    logger.error('Failed to send order cancelled notification', { userId, tradeId, error: (error as Error).message });
  }
}

/**
 * Build SL modification options keyboard
 */
export function buildModifySLButtons(tradeId: string): Array<{ text: string; callback: string }> {
  return [
    { text: 'SL -1%', callback: `trade:sl:${tradeId}:1` },
    { text: 'SL -2%', callback: `trade:sl:${tradeId}:2` },
    { text: 'SL -3%', callback: `trade:sl:${tradeId}:3` },
    { text: 'SL -5%', callback: `trade:sl:${tradeId}:5` },
    { text: 'Cancel', callback: `trade:slcancel:${tradeId}` },
  ];
}

// ============================================
// Enhanced Notifications
// ============================================

// Rate limiting for technical signals (max 1 per indicator per symbol per 15 minutes)
const signalNotifications = new Map<string, number>();
const SIGNAL_COOLDOWN = 15 * 60 * 1000; // 15 minutes

/**
 * Notify when a technical indicator generates a signal
 */
export async function notifyTechnicalSignal(
  userId: string,
  signal: {
    symbol: string;
    indicator: string;  // RSI, MACD, MA Cross, etc.
    signal: 'bullish' | 'bearish';
    value: number;
    message: string;
  }
): Promise<void> {
  try {
    // Rate limit per indicator per symbol
    const key = `${userId}:${signal.symbol}:${signal.indicator}`;
    const lastNotified = signalNotifications.get(key);
    if (lastNotified && Date.now() - lastNotified < SIGNAL_COOLDOWN) {
      return;
    }
    signalNotifications.set(key, Date.now());

    const emoji = signal.signal === 'bullish' ? '📈' : '📉';
    let message = `${emoji} ${signal.indicator} Signal\n\n`;
    message += `Symbol: ${signal.symbol}\n`;
    message += `Signal: ${signal.signal.toUpperCase()}\n`;
    message += `Value: ${signal.value.toFixed(2)}\n`;
    message += `\n${signal.message}`;

    await sendTradeNotification(userId, message);

    logger.info('Sent technical signal notification', {
      userId,
      symbol: signal.symbol,
      indicator: signal.indicator,
      signal: signal.signal,
    });
  } catch (error) {
    logger.error('Failed to send technical signal notification', { userId, signal, error: (error as Error).message });
  }
}

/**
 * Notify when a trading bot's status changes
 */
export async function notifyBotStatusChange(
  userId: string,
  bot: {
    id: string;
    name: string;
    type: string;
    symbol: string;
    status: string;
    reason?: string;
  }
): Promise<void> {
  try {
    let emoji = '🤖';
    if (bot.status === 'running') {
      emoji = '▶️';
    } else if (bot.status === 'stopped') {
      emoji = '⏸️';
    } else if (bot.status === 'error') {
      emoji = '⚠️';
    }

    let message = `${emoji} Bot Status Changed\n\n`;
    message += `Bot: ${bot.name}\n`;
    message += `Type: ${bot.type}\n`;
    message += `Symbol: ${bot.symbol}\n`;
    message += `Status: ${bot.status.toUpperCase()}`;

    if (bot.reason) {
      message += `\nReason: ${bot.reason}`;
    }

    await sendTradeNotification(userId, message);

    logger.info('Sent bot status notification', {
      userId,
      botId: bot.id,
      status: bot.status,
    });
  } catch (error) {
    logger.error('Failed to send bot status notification', { userId, bot, error: (error as Error).message });
  }
}

/**
 * Notify when a price alert is triggered
 */
export async function notifyPriceAlert(
  userId: string,
  alert: {
    id?: string;
    symbol: string;
    condition: string;  // 'above', 'below', 'crosses_up', 'crosses_down'
    targetPrice: number;
    currentPrice: number;
  }
): Promise<void> {
  try {
    const emoji = '🔔';
    let conditionText = '';
    switch (alert.condition) {
      case 'above':
        conditionText = 'Price above';
        break;
      case 'below':
        conditionText = 'Price below';
        break;
      case 'crosses_up':
        conditionText = 'Crossed above';
        break;
      case 'crosses_down':
        conditionText = 'Crossed below';
        break;
      default:
        conditionText = alert.condition;
    }

    let message = `${emoji} Price Alert Triggered\n\n`;
    message += `Symbol: ${alert.symbol}\n`;
    message += `Condition: ${conditionText}\n`;
    message += `Target: $${formatPrice(alert.targetPrice)}\n`;
    message += `Current: $${formatPrice(alert.currentPrice)}`;

    await sendTradeNotification(userId, message);

    logger.info('Sent price alert notification', {
      userId,
      symbol: alert.symbol,
      condition: alert.condition,
    });
  } catch (error) {
    logger.error('Failed to send price alert notification', { userId, alert, error: (error as Error).message });
  }
}

/**
 * Notify when there's a significant portfolio change
 */
export async function notifyPortfolioChange(
  userId: string,
  change: {
    type: 'daily_summary' | 'large_gain' | 'large_loss' | 'position_change';
    description: string;
    pnl?: number;
    pnlPct?: number;
  }
): Promise<void> {
  try {
    let emoji = '📊';
    if (change.pnl !== undefined) {
      emoji = change.pnl >= 0 ? '💰' : '📉';
    }

    let message = `${emoji} Portfolio Update\n\n`;
    message += `${change.type.replace(/_/g, ' ').toUpperCase()}\n`;
    message += `${change.description}`;

    if (change.pnl !== undefined && change.pnlPct !== undefined) {
      const sign = change.pnl >= 0 ? '+' : '';
      message += `\n\nP&L: ${sign}$${formatPrice(Math.abs(change.pnl))} (${sign}${change.pnlPct.toFixed(2)}%)`;
    }

    await sendTradeNotification(userId, message);

    logger.info('Sent portfolio change notification', {
      userId,
      type: change.type,
    });
  } catch (error) {
    logger.error('Failed to send portfolio change notification', { userId, change, error: (error as Error).message });
  }
}

/**
 * Notify when a conditional order fails to execute
 */
export async function notifyConditionalOrderFailed(
  userId: string,
  symbol: string,
  condition: string,
  triggerPrice: number,
  side: string,
  errorMessage: string
): Promise<void> {
  try {
    let message = `⚠️ Conditional Order Failed\n\n`;
    message += `${symbol} ${side.toUpperCase()}\n`;
    message += `Condition: ${condition} $${formatPrice(triggerPrice)}\n`;
    message += `\nReason: ${errorMessage}\n`;
    message += `\nThe order has been cancelled to prevent repeated failures.`;

    await sendTradeNotification(userId, message);

    logger.info('Sent conditional order failed notification', {
      userId,
      symbol,
      condition,
      side,
    });
  } catch (error) {
    logger.error('Failed to send conditional order failed notification', { userId, symbol, error: (error as Error).message });
  }
}
