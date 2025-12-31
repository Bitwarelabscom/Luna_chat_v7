/**
 * Trading Telegram Service
 *
 * Separate Telegram bot for Trader Luna - handles:
 * - Trading chat via Telegram
 * - Trade notifications
 * - Order confirmations with Yes/No buttons
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import * as tradingChatService from '../chat/trading-chat.service.js';
import * as tradingService from '../trading/trading.service.js';

// ============================================
// Types
// ============================================

export interface TradingTelegramConnection {
  id: string;
  userId: string;
  chatId: number;
  username: string | null;
  firstName: string | null;
  isActive: boolean;
  linkedAt: Date;
  lastMessageAt: Date | null;
}

export interface PendingOrderConfirmation {
  id: string;
  userId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopPct: number | null;
  messageId: number | null;
  chatId: number | null;
  status: string;
  createdAt: Date;
  expiresAt: Date;
}

interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    photo?: TelegramPhoto[];
    caption?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
    data?: string;
  };
}

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

// ============================================
// Configuration
// ============================================

function getBotToken(): string | null {
  return process.env.TRADING_TELEGRAM_BOT_TOKEN || null;
}

export function isConfigured(): boolean {
  return !!getBotToken();
}

// Allowlist of authorized Telegram user IDs (empty = allow all linked users)
const ALLOWED_TELEGRAM_IDS: Set<number> = new Set(
  (process.env.TRADING_TELEGRAM_ALLOWED_IDS || '')
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id))
);

function isUserAllowed(telegramUserId: number): boolean {
  // If no allowlist configured, allow all linked users
  if (ALLOWED_TELEGRAM_IDS.size === 0) return true;
  return ALLOWED_TELEGRAM_IDS.has(telegramUserId);
}

// ============================================
// Telegram API
// ============================================

async function telegramRequest(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const token = getBotToken();
  if (!token) {
    throw new Error('Trading Telegram bot token not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const result = await response.json() as TelegramApiResponse;

  if (!result.ok) {
    logger.error('Trading Telegram API error', { method, error: result.description });
    throw new Error(result.description || 'Telegram API error');
  }

  return result.result;
}

/**
 * Send a message to a Telegram chat
 */
export async function sendMessage(
  chatId: number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableNotification?: boolean;
  }
): Promise<boolean> {
  try {
    await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode,
      disable_notification: options?.disableNotification,
    });
    return true;
  } catch (error) {
    const errorMessage = (error as Error).message;

    // If parsing failed and we were using parseMode, retry without it
    if (options?.parseMode && errorMessage.includes("can't parse entities")) {
      logger.warn('Trading Telegram markdown parsing failed, retrying as plain text', { chatId });
      try {
        await telegramRequest('sendMessage', {
          chat_id: chatId,
          text,
          disable_notification: options?.disableNotification,
        });
        return true;
      } catch (retryError) {
        logger.error('Failed to send Trading Telegram message (retry)', {
          chatId,
          error: (retryError as Error).message,
        });
        return false;
      }
    }

    logger.error('Failed to send Trading Telegram message', { chatId, error: errorMessage });
    return false;
  }
}

/**
 * Send message with inline keyboard buttons
 */
export async function sendMessageWithButtons(
  chatId: number,
  text: string,
  buttons: Array<{ text: string; callback: string }>,
  columns: number = 2
): Promise<{ success: boolean; messageId?: number }> {
  try {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += columns) {
      const row = buttons.slice(i, i + columns).map(b => ({
        text: b.text,
        callback_data: b.callback,
      }));
      rows.push(row);
    }

    const result = await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: rows,
      },
    }) as { message_id: number };

    return { success: true, messageId: result.message_id };
  } catch (error) {
    logger.error('Failed to send Trading Telegram message with buttons', {
      chatId,
      error: (error as Error).message,
    });
    return { success: false };
  }
}

/**
 * Edit message text and remove buttons
 */
async function editMessageText(
  chatId: number,
  messageId: number,
  text: string
): Promise<boolean> {
  try {
    await telegramRequest('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] },
    });
    return true;
  } catch (error) {
    logger.error('Failed to edit Trading Telegram message', {
      chatId,
      messageId,
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Answer callback query (acknowledge button press)
 */
async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  try {
    await telegramRequest('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
    return true;
  } catch (error) {
    logger.error('Failed to answer callback query', { error: (error as Error).message });
    return false;
  }
}

/**
 * Get bot info
 */
export async function getBotInfo(): Promise<{ username: string; firstName: string } | null> {
  if (!isConfigured()) return null;

  try {
    const result = await telegramRequest('getMe') as { username: string; first_name: string };
    return {
      username: result.username,
      firstName: result.first_name,
    };
  } catch (error) {
    logger.error('Failed to get Trading bot info', { error: (error as Error).message });
    return null;
  }
}

// ============================================
// Link Code Management
// ============================================

/**
 * Generate a link code for connecting Trading Telegram
 */
export async function generateLinkCode(userId: string): Promise<string> {
  // Delete any existing codes for this user
  await pool.query(
    `DELETE FROM trading_telegram_link_codes WHERE user_id = $1`,
    [userId]
  );

  // Generate a random 8-character code
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();

  // Expires in 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO trading_telegram_link_codes (user_id, code, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, code, expiresAt]
  );

  logger.info('Generated Trading Telegram link code', { userId, code });

  return code;
}

/**
 * Validate and use a link code
 */
async function validateLinkCode(code: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT user_id FROM trading_telegram_link_codes
     WHERE code = $1
       AND expires_at > NOW()
       AND used_at IS NULL`,
    [code.toUpperCase()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  // Mark as used
  await pool.query(
    `UPDATE trading_telegram_link_codes SET used_at = NOW() WHERE code = $1`,
    [code.toUpperCase()]
  );

  return result.rows[0].user_id;
}

// ============================================
// Connection Management
// ============================================

/**
 * Link a Telegram chat to a user for trading
 */
export async function linkTelegram(
  userId: string,
  chatId: number,
  username?: string,
  firstName?: string
): Promise<TradingTelegramConnection> {
  const result = await pool.query(
    `INSERT INTO trading_telegram_connections (user_id, chat_id, username, first_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       chat_id = EXCLUDED.chat_id,
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       is_active = true,
       linked_at = NOW()
     RETURNING *`,
    [userId, chatId, username || null, firstName || null]
  );

  logger.info('Trading Telegram linked', { userId, chatId, username });

  return mapConnectionRow(result.rows[0]);
}

/**
 * Unlink Trading Telegram from a user
 */
export async function unlinkTelegram(userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM trading_telegram_connections WHERE user_id = $1 RETURNING id`,
    [userId]
  );

  if ((result.rowCount ?? 0) > 0) {
    logger.info('Trading Telegram unlinked', { userId });
    return true;
  }

  return false;
}

/**
 * Get user's Trading Telegram connection
 */
export async function getConnection(userId: string): Promise<TradingTelegramConnection | null> {
  const result = await pool.query(
    `SELECT * FROM trading_telegram_connections WHERE user_id = $1`,
    [userId]
  );

  return result.rows.length > 0 ? mapConnectionRow(result.rows[0]) : null;
}

/**
 * Get connection by chat ID
 */
export async function getConnectionByChatId(chatId: number): Promise<TradingTelegramConnection | null> {
  const result = await pool.query(
    `SELECT * FROM trading_telegram_connections WHERE chat_id = $1`,
    [chatId]
  );

  return result.rows.length > 0 ? mapConnectionRow(result.rows[0]) : null;
}

/**
 * Update last message time
 */
async function updateLastMessageTime(userId: string): Promise<void> {
  await pool.query(
    `UPDATE trading_telegram_connections SET last_message_at = NOW() WHERE user_id = $1`,
    [userId]
  );
}

// ============================================
// Order Confirmation Flow
// ============================================

/**
 * Create a pending order confirmation
 */
export async function createPendingOrder(
  userId: string,
  order: {
    symbol: string;
    side: string;
    orderType: string;
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingStopPct?: number;
  }
): Promise<PendingOrderConfirmation | null> {
  const connection = await getConnection(userId);
  if (!connection) {
    logger.warn('Cannot create pending order - no Trading Telegram connection', { userId });
    return null;
  }

  // Create pending order in database
  const result = await pool.query(
    `INSERT INTO pending_order_confirmations
     (user_id, symbol, side, order_type, quantity, price, stop_loss, take_profit, trailing_stop_pct, chat_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      userId,
      order.symbol,
      order.side,
      order.orderType,
      order.quantity,
      order.price || null,
      order.stopLoss || null,
      order.takeProfit || null,
      order.trailingStopPct || null,
      connection.chatId,
    ]
  );

  const pendingOrder = mapPendingOrderRow(result.rows[0]);

  // Send confirmation message to Telegram
  const emoji = order.side.toUpperCase() === 'BUY' ? '🟢' : '🔴';
  let message = `${emoji} *Order Confirmation Required*\n\n`;
  message += `*${order.side.toUpperCase()}* ${order.quantity} ${order.symbol}\n`;
  message += `Type: ${order.orderType}\n`;

  if (order.price) {
    message += `Price: $${order.price.toLocaleString()}\n`;
  } else {
    message += `Price: Market\n`;
  }

  if (order.stopLoss) {
    message += `Stop Loss: $${order.stopLoss.toLocaleString()}\n`;
  }
  if (order.takeProfit) {
    message += `Take Profit: $${order.takeProfit.toLocaleString()}\n`;
  }
  if (order.trailingStopPct) {
    message += `Trailing Stop: ${order.trailingStopPct}%\n`;
  }

  message += `\n_Expires in 5 minutes_`;

  const buttons = [
    { text: 'Yes, Execute', callback: `order:confirm:${pendingOrder.id}` },
    { text: 'No, Cancel', callback: `order:cancel:${pendingOrder.id}` },
  ];

  const sendResult = await sendMessageWithButtons(connection.chatId, message, buttons, 2);

  if (sendResult.success && sendResult.messageId) {
    // Update pending order with message ID
    await pool.query(
      `UPDATE pending_order_confirmations SET message_id = $1 WHERE id = $2`,
      [sendResult.messageId, pendingOrder.id]
    );
    pendingOrder.messageId = sendResult.messageId;
  }

  logger.info('Created pending order confirmation', {
    userId,
    orderId: pendingOrder.id,
    symbol: order.symbol,
    side: order.side,
  });

  return pendingOrder;
}

/**
 * Get pending order by ID
 */
async function getPendingOrder(orderId: string): Promise<PendingOrderConfirmation | null> {
  const result = await pool.query(
    `SELECT * FROM pending_order_confirmations WHERE id = $1`,
    [orderId]
  );

  return result.rows.length > 0 ? mapPendingOrderRow(result.rows[0]) : null;
}

/**
 * Confirm and execute a pending order
 */
async function confirmOrder(orderId: string, userId: string): Promise<{ success: boolean; message: string }> {
  const order = await getPendingOrder(orderId);

  if (!order) {
    return { success: false, message: 'Order not found' };
  }

  if (order.userId !== userId) {
    return { success: false, message: 'Unauthorized' };
  }

  if (order.status !== 'pending') {
    return { success: false, message: `Order already ${order.status}` };
  }

  if (new Date() > order.expiresAt) {
    await pool.query(
      `UPDATE pending_order_confirmations SET status = 'expired' WHERE id = $1`,
      [orderId]
    );
    return { success: false, message: 'Order expired' };
  }

  try {
    // Execute the order
    const result = await tradingService.placeOrder(userId, {
      symbol: order.symbol,
      side: order.side.toLowerCase() as 'buy' | 'sell',
      type: order.orderType.toLowerCase() as 'market' | 'limit',
      quantity: order.quantity,
      price: order.price || undefined,
    });

    if (result) {
      await pool.query(
        `UPDATE pending_order_confirmations SET status = 'confirmed' WHERE id = $1`,
        [orderId]
      );

      logger.info('Order confirmed and executed', { orderId, userId, binanceOrderId: result.binanceOrderId });

      return {
        success: true,
        message: `Order executed! ${order.side.toUpperCase()} ${order.quantity} ${order.symbol}`,
      };
    } else {
      await pool.query(
        `UPDATE pending_order_confirmations SET status = 'failed' WHERE id = $1`,
        [orderId]
      );
      return { success: false, message: 'Failed to execute order on Binance' };
    }
  } catch (error) {
    await pool.query(
      `UPDATE pending_order_confirmations SET status = 'failed' WHERE id = $1`,
      [orderId]
    );
    logger.error('Failed to execute confirmed order', { orderId, error: (error as Error).message });
    return { success: false, message: `Error: ${(error as Error).message}` };
  }
}

/**
 * Cancel a pending order
 */
async function cancelOrder(orderId: string, userId: string): Promise<{ success: boolean; message: string }> {
  const order = await getPendingOrder(orderId);

  if (!order) {
    return { success: false, message: 'Order not found' };
  }

  if (order.userId !== userId) {
    return { success: false, message: 'Unauthorized' };
  }

  if (order.status !== 'pending') {
    return { success: false, message: `Order already ${order.status}` };
  }

  await pool.query(
    `UPDATE pending_order_confirmations SET status = 'cancelled' WHERE id = $1`,
    [orderId]
  );

  logger.info('Order cancelled', { orderId, userId });

  return { success: true, message: 'Order cancelled' };
}

// ============================================
// Trading Chat Session
// ============================================

/**
 * Process a chat message from Trading Telegram
 */
async function handleChatMessage(
  connection: TradingTelegramConnection,
  text: string,
  telegramUserId: number
): Promise<void> {
  // Security check - only allow users on the allowlist
  if (!isUserAllowed(telegramUserId)) {
    logger.warn('Unauthorized Trading Telegram access attempt', {
      telegramUserId,
      chatId: connection.chatId,
    });
    await sendMessage(connection.chatId, 'You are not authorized to use this bot.');
    return;
  }

  try {
    // Send typing indicator
    await telegramRequest('sendChatAction', {
      chat_id: connection.chatId,
      action: 'typing',
    });

    // Get or create trading session
    const sessionId = await tradingChatService.getOrCreateTradingSession(connection.userId);

    // Process message through Trading Luna (with source=telegram for order confirmations)
    const response = await tradingChatService.processMessage({
      sessionId,
      userId: connection.userId,
      message: text,
      source: 'telegram',
    });

    // Update last message time
    await updateLastMessageTime(connection.userId);

    // Send response back via Telegram (split long messages)
    const maxLength = 4000;
    let content = response.content;

    while (content.length > 0) {
      const chunk = content.slice(0, maxLength);
      content = content.slice(maxLength);

      await sendMessage(connection.chatId, chunk, { parseMode: 'Markdown' });
    }

    logger.info('Trading Telegram chat message processed', {
      userId: connection.userId,
      sessionId,
      inputLength: text.length,
      outputLength: response.content.length,
    });
  } catch (error) {
    logger.error('Failed to process Trading Telegram chat message', {
      userId: connection.userId,
      error: (error as Error).message,
    });

    await sendMessage(
      connection.chatId,
      'Sorry, I encountered an error processing your message. Please try again.'
    );
  }
}

// ============================================
// Webhook Handler
// ============================================

/**
 * Process incoming Telegram update (webhook)
 */
export async function processUpdate(update: TelegramUpdate): Promise<void> {
  // Handle callback queries (button presses)
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  // Require text for message handling
  if (!update.message?.text) return;

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text!.trim();

  // Check if this is a link code
  if (text.startsWith('/start ')) {
    const code = text.slice(7).trim();
    await handleLinkCommand(chatId, code, message.from);
    return;
  }

  if (text === '/start') {
    await sendMessage(
      chatId,
      'Hi! I\'m Trader Luna. To link your account, go to Luna Chat > Trading > Settings and click "Link Trading Telegram".\n\nOnce linked, you can chat with me about trading, receive notifications, and confirm orders here!'
    );
    return;
  }

  if (text === '/help') {
    await sendMessage(
      chatId,
      'Trader Luna Telegram Commands:\n\n/start - Get started\n/status - Check connection status\n/portfolio - View portfolio\n/unlink - Disconnect from Trader Luna\n/help - Show this help\n\nOr just send me a message to chat about trading!'
    );
    return;
  }

  if (text === '/status') {
    await handleStatusCommand(chatId);
    return;
  }

  if (text === '/portfolio') {
    await handlePortfolioCommand(chatId);
    return;
  }

  if (text === '/unlink') {
    await handleUnlinkCommand(chatId);
    return;
  }

  // For other messages, process as trading chat if user is linked
  const connection = await getConnectionByChatId(chatId);
  if (connection) {
    await handleChatMessage(connection, text, message.from.id);
  } else {
    await sendMessage(
      chatId,
      'Your Telegram is not linked to a Luna trading account. Go to Trading Settings to link it.'
    );
  }
}

async function handleLinkCommand(
  chatId: number,
  code: string,
  from: { id: number; first_name: string; username?: string }
): Promise<void> {
  const userId = await validateLinkCode(code);

  if (!userId) {
    await sendMessage(
      chatId,
      'Invalid or expired link code. Please generate a new one from Luna Trading Settings.'
    );
    return;
  }

  await linkTelegram(userId, chatId, from.username, from.first_name);

  await sendMessage(
    chatId,
    `Connected! Hi ${from.first_name}, you can now:\n\n- Chat with me about trading\n- Receive trade notifications\n- Confirm orders with buttons\n\nCommands:\n/portfolio - View your holdings\n/status - Check connection\n/unlink - Disconnect`
  );
}

async function handleStatusCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    await sendMessage(
      chatId,
      `Connected to Trader Luna\nLinked: ${connection.linkedAt.toLocaleDateString()}\nLast message: ${connection.lastMessageAt?.toLocaleDateString() || 'Never'}`
    );
  } else {
    await sendMessage(chatId, 'Not connected to any Luna trading account.');
  }
}

async function handlePortfolioCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (!connection) {
    await sendMessage(chatId, 'Not connected to any Luna trading account.');
    return;
  }

  try {
    const portfolio = await tradingService.getPortfolio(connection.userId);

    if (portfolio) {
      let message = `*Portfolio Summary*\n\n`;
      message += `Total Value: $${portfolio.totalValueUsdt.toLocaleString()}\n`;
      message += `Available: $${portfolio.availableUsdt.toLocaleString()}\n`;
      message += `24h P&L: ${portfolio.dailyPnl >= 0 ? '+' : ''}$${portfolio.dailyPnl.toFixed(2)} (${portfolio.dailyPnlPct.toFixed(2)}%)\n\n`;

      message += `*Holdings:*\n`;
      for (const holding of portfolio.holdings.slice(0, 10)) {
        message += `${holding.asset}: ${holding.amount.toFixed(4)} ($${holding.valueUsdt.toFixed(2)})\n`;
      }

      await sendMessage(chatId, message, { parseMode: 'Markdown' });
    } else {
      await sendMessage(chatId, 'Unable to fetch portfolio. Please ensure Binance is connected in the app.');
    }
  } catch (error) {
    logger.error('Failed to fetch portfolio for Telegram', { userId: connection.userId, error: (error as Error).message });
    await sendMessage(chatId, 'Error fetching portfolio. Please try again.');
  }
}

async function handleUnlinkCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    await unlinkTelegram(connection.userId);
    await sendMessage(chatId, 'Disconnected from Trader Luna. You will no longer receive trading notifications here.');
  } else {
    await sendMessage(chatId, 'This chat is not connected to any Luna trading account.');
  }
}

async function handleCallbackQuery(callback: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  const data = callback.data;

  if (!chatId || !data) {
    await answerCallbackQuery(callback.id);
    return;
  }

  const connection = await getConnectionByChatId(chatId);
  if (!connection) {
    await answerCallbackQuery(callback.id, 'Not connected');
    return;
  }

  // Handle order confirmation
  if (data.startsWith('order:')) {
    const parts = data.split(':');
    const action = parts[1];
    const orderId = parts[2];

    if (!orderId) {
      await answerCallbackQuery(callback.id, 'Invalid order ID');
      return;
    }

    if (action === 'confirm') {
      const result = await confirmOrder(orderId, connection.userId);
      await answerCallbackQuery(callback.id, result.message);

      if (messageId) {
        const emoji = result.success ? '' : '';
        await editMessageText(chatId, messageId, `${emoji} ${result.message}`);
      }
    } else if (action === 'cancel') {
      const result = await cancelOrder(orderId, connection.userId);
      await answerCallbackQuery(callback.id, result.message);

      if (messageId) {
        await editMessageText(chatId, messageId, `Order cancelled.`);
      }
    }
    return;
  }

  // Handle trade actions (from trade notifications)
  if (data.startsWith('trade:')) {
    await handleTradeCallback(callback.id, chatId, messageId, connection.userId, data);
    return;
  }

  await answerCallbackQuery(callback.id);
}

/**
 * Handle trade callback actions (from trade-notification.service)
 */
async function handleTradeCallback(
  callbackId: string,
  chatId: number,
  _messageId: number | undefined,
  userId: string,
  data: string
): Promise<void> {
  const parts = data.split(':');
  const action = parts[1];
  const tradeId = parts[2];

  if (!tradeId) {
    await answerCallbackQuery(callbackId, 'Invalid trade ID');
    return;
  }

  try {
    if (action === 'close') {
      // Close position at market
      const result = await pool.query(
        `SELECT symbol, side, quantity FROM trades
         WHERE id = $1 AND user_id = $2 AND closed_at IS NULL AND status = 'filled'`,
        [tradeId, userId]
      );

      if (result.rows.length === 0) {
        await answerCallbackQuery(callbackId, 'Position already closed');
        return;
      }

      const trade = result.rows[0];

      // Import and execute close position
      const orderMonitor = await import('../trading/order-monitor.service.js');
      await orderMonitor.executeClosePosition(
        userId,
        tradeId,
        trade.symbol,
        trade.side,
        parseFloat(trade.quantity),
        'manual_telegram'
      );

      await answerCallbackQuery(callbackId, 'Position closed!');
      await sendMessage(chatId, `Position ${trade.symbol} closed at market.`);
    } else if (action === 'modsl') {
      // Show SL modification options
      const result = await pool.query(
        `SELECT symbol FROM trades WHERE id = $1 AND user_id = $2 AND closed_at IS NULL`,
        [tradeId, userId]
      );

      if (result.rows.length === 0) {
        await answerCallbackQuery(callbackId, 'Position not found');
        return;
      }

      const symbol = result.rows[0].symbol;
      const slButtons = [
        { text: 'SL -1%', callback: `trade:sl:${tradeId}:1` },
        { text: 'SL -2%', callback: `trade:sl:${tradeId}:2` },
        { text: 'SL -3%', callback: `trade:sl:${tradeId}:3` },
        { text: 'SL -5%', callback: `trade:sl:${tradeId}:5` },
      ];

      await sendMessageWithButtons(chatId, `Set Stop Loss for ${symbol}:`, slButtons, 2);
      await answerCallbackQuery(callbackId);
    } else if (action === 'sl') {
      // Set stop loss at percentage
      const pct = parseFloat(parts[3]);
      if (isNaN(pct)) {
        await answerCallbackQuery(callbackId, 'Invalid percentage');
        return;
      }

      const result = await pool.query(
        `SELECT symbol, side FROM trades WHERE id = $1 AND user_id = $2 AND closed_at IS NULL`,
        [tradeId, userId]
      );

      if (result.rows.length === 0) {
        await answerCallbackQuery(callbackId, 'Position not found');
        return;
      }

      const trade = result.rows[0];

      // Get current price from Crypto.com
      const { CryptoComClient } = await import('../trading/crypto-com.client.js');
      const client = new CryptoComClient({ apiKey: '', apiSecret: '' });
      const ticker = await client.getTickerPrice(trade.symbol) as { symbol: string; price: string };
      const currentPrice = parseFloat(ticker.price);

      // Calculate new SL based on side
      const newSL = trade.side === 'buy'
        ? currentPrice * (1 - pct / 100)
        : currentPrice * (1 + pct / 100);

      // Update database
      await pool.query(
        `UPDATE trades SET stop_loss_price = $1 WHERE id = $2`,
        [newSL, tradeId]
      );

      await answerCallbackQuery(callbackId, `SL set to $${newSL.toFixed(2)}`);
      await sendMessage(chatId, `Stop loss updated to $${newSL.toFixed(2)} (-${pct}% from current)`);
    } else if (action === 'cancel') {
      // Cancel pending order
      await tradingService.cancelOrder(userId, tradeId);
      await answerCallbackQuery(callbackId, 'Order cancelled');
      await sendMessage(chatId, 'Order cancelled.');
    }
  } catch (error) {
    logger.error('Trade callback error', { action, tradeId, error: (error as Error).message });
    await answerCallbackQuery(callbackId, 'Failed. Try via app.');
  }
}

// ============================================
// Helpers
// ============================================

function mapConnectionRow(row: Record<string, unknown>): TradingTelegramConnection {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    chatId: Number(row.chat_id),
    username: row.username as string | null,
    firstName: row.first_name as string | null,
    isActive: row.is_active as boolean,
    linkedAt: row.linked_at as Date,
    lastMessageAt: row.last_message_at as Date | null,
  };
}

function mapPendingOrderRow(row: Record<string, unknown>): PendingOrderConfirmation {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    symbol: row.symbol as string,
    side: row.side as string,
    orderType: row.order_type as string,
    quantity: parseFloat(row.quantity as string),
    price: row.price ? parseFloat(row.price as string) : null,
    stopLoss: row.stop_loss ? parseFloat(row.stop_loss as string) : null,
    takeProfit: row.take_profit ? parseFloat(row.take_profit as string) : null,
    trailingStopPct: row.trailing_stop_pct ? parseFloat(row.trailing_stop_pct as string) : null,
    messageId: row.message_id ? Number(row.message_id) : null,
    chatId: row.chat_id ? Number(row.chat_id) : null,
    status: row.status as string,
    createdAt: row.created_at as Date,
    expiresAt: row.expires_at as Date,
  };
}

/**
 * Get setup instructions
 */
export function getSetupInstructions(): string {
  return `To set up Trading Telegram:

1. The bot token should be configured in TRADING_TELEGRAM_BOT_TOKEN

2. Set up webhook:
   POST to /api/triggers/trading-telegram/webhook

3. Link your account:
   - Go to Trading > Settings
   - Click "Link Trading Telegram"
   - Send the code to the trading bot`;
}

export default {
  sendMessage,
  sendMessageWithButtons,
  getBotInfo,
  generateLinkCode,
  linkTelegram,
  unlinkTelegram,
  getConnection,
  getConnectionByChatId,
  createPendingOrder,
  processUpdate,
  isConfigured,
  getSetupInstructions,
};
