import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import * as chatService from '../chat/chat.service.js';
import * as sessionService from '../chat/session.service.js';
import * as contextCompression from '../chat/context-compression.service.js';

// ============================================
// Telegram Idle Timer System
// ============================================

const telegramIdleTimers: Map<string, NodeJS.Timeout> = new Map();
const TELEGRAM_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const TELEGRAM_TOKEN_LIMIT = 100000; // Force summarize at 100k tokens

/**
 * Reset the idle timer for a Telegram user
 * Timer triggers summarization after 5 minutes of inactivity
 */
function resetTelegramIdleTimer(userId: string, sessionId: string): void {
  // Clear existing timer
  const existingTimer = telegramIdleTimers.get(userId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new timer
  const timer = setTimeout(async () => {
    await summarizeTelegramSession(userId, sessionId);
    telegramIdleTimers.delete(userId);
  }, TELEGRAM_IDLE_TIMEOUT);

  telegramIdleTimers.set(userId, timer);
  logger.debug('Reset Telegram idle timer', { userId, timeoutMs: TELEGRAM_IDLE_TIMEOUT });
}

/**
 * Summarize a Telegram session using Ollama
 * Uses the existing context compression system
 */
async function summarizeTelegramSession(userId: string, sessionId: string): Promise<void> {
  try {
    logger.info('Starting Telegram session summarization', { userId, sessionId });

    // Update rolling summary in context compression
    await contextCompression.updateRollingSummary(sessionId, userId);

    logger.info('Telegram session summarization complete', { userId, sessionId });
  } catch (error) {
    logger.error('Failed to summarize Telegram session', {
      error: (error as Error).message,
      userId,
      sessionId,
    });
  }
}

/**
 * Check if session exceeds token limit and force summarization if needed
 */
async function checkTokenLimitAndSummarize(userId: string, sessionId: string): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_tokens FROM messages WHERE session_id = $1`,
      [sessionId]
    );
    const totalTokens = parseInt(result.rows[0]?.total_tokens || '0', 10);

    if (totalTokens >= TELEGRAM_TOKEN_LIMIT) {
      logger.warn('Telegram session exceeds token limit, forcing summarization', {
        userId, sessionId, totalTokens, limit: TELEGRAM_TOKEN_LIMIT
      });
      await summarizeTelegramSession(userId, sessionId);
    }
  } catch (error) {
    logger.error('Failed to check token limit', { error: (error as Error).message });
  }
}

/**
 * Clear all Telegram idle timers (for graceful shutdown)
 */
export function clearAllTelegramTimers(): void {
  for (const [userId, timer] of telegramIdleTimers) {
    clearTimeout(timer);
    logger.debug('Cleared Telegram idle timer', { userId });
  }
  telegramIdleTimers.clear();
}

// ============================================
// Types
// ============================================

export interface TelegramConnection {
  id: string;
  userId: string;
  chatId: number;
  username: string | null;
  firstName: string | null;
  isActive: boolean;
  linkedAt: Date;
  lastMessageAt: Date | null;
}

export interface TelegramLinkCode {
  id: string;
  userId: string;
  code: string;
  expiresAt: Date;
  usedAt: Date | null;
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

// Quick action categories for inline keyboard
const QUICK_ACTIONS = {
  main: [
    { text: 'Tasks', callback: 'cat:tasks' },
    { text: 'Calendar', callback: 'cat:calendar' },
    { text: 'Search', callback: 'cat:search' },
    { text: 'Fun', callback: 'cat:fun' },
  ],
  tasks: [
    { text: 'Show pending', callback: 'act:tasks:pending' },
    { text: 'Create task', callback: 'act:tasks:create' },
    { text: 'Back', callback: 'cat:main' },
  ],
  calendar: [
    { text: 'Today', callback: 'act:calendar:today' },
    { text: 'This week', callback: 'act:calendar:week' },
    { text: 'Back', callback: 'cat:main' },
  ],
  search: [
    { text: 'Web search', callback: 'act:search:web' },
    { text: 'Weather', callback: 'act:search:weather' },
    { text: 'Back', callback: 'cat:main' },
  ],
  fun: [
    { text: 'Tell a joke', callback: 'act:fun:joke' },
    { text: 'Random fact', callback: 'act:fun:fact' },
    { text: 'Back', callback: 'cat:main' },
  ],
};

// ============================================
// Configuration
// ============================================

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function isTelegramConfigured(): boolean {
  return !!getBotToken();
}

// ============================================
// Telegram API
// ============================================

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

async function telegramRequest(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const token = getBotToken();
  if (!token) {
    throw new Error('Telegram bot token not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const result = await response.json() as TelegramApiResponse;

  if (!result.ok) {
    logger.error('Telegram API error', { method, error: result.description });
    throw new Error(result.description || 'Telegram API error');
  }

  return result.result;
}

/**
 * Send a message to a Telegram chat
 * If parseMode is set and fails, automatically retries without formatting
 */
export async function sendTelegramMessage(
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
      logger.warn('Telegram markdown parsing failed, retrying as plain text', {
        chatId,
        parseMode: options.parseMode,
      });

      try {
        await telegramRequest('sendMessage', {
          chat_id: chatId,
          text,
          disable_notification: options?.disableNotification,
        });
        return true;
      } catch (retryError) {
        logger.error('Failed to send Telegram message (retry)', {
          chatId,
          error: (retryError as Error).message,
        });
        return false;
      }
    }

    logger.error('Failed to send Telegram message', {
      chatId,
      error: errorMessage,
    });
    return false;
  }
}

/**
 * Send message with inline keyboard buttons
 */
async function sendMessageWithButtons(
  chatId: number,
  text: string,
  buttons: Array<{ text: string; callback: string }>,
  columns: number = 2
): Promise<boolean> {
  try {
    // Build inline keyboard rows
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += columns) {
      const row = buttons.slice(i, i + columns).map(b => ({
        text: b.text,
        callback_data: b.callback,
      }));
      rows.push(row);
    }

    await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: rows,
      },
    });
    return true;
  } catch (error) {
    logger.error('Failed to send Telegram message with buttons', {
      chatId,
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Edit message with inline keyboard (for updating buttons)
 */
async function editMessageButtons(
  chatId: number,
  messageId: number,
  text: string,
  buttons: Array<{ text: string; callback: string }>,
  columns: number = 2
): Promise<boolean> {
  try {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += columns) {
      const row = buttons.slice(i, i + columns).map(b => ({
        text: b.text,
        callback_data: b.callback,
      }));
      rows.push(row);
    }

    await telegramRequest('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: {
        inline_keyboard: rows,
      },
    });
    return true;
  } catch (error) {
    logger.error('Failed to edit Telegram message buttons', {
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
    logger.error('Failed to answer callback query', {
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Get bot info
 */
export async function getBotInfo(): Promise<{ username: string; firstName: string } | null> {
  if (!isTelegramConfigured()) return null;

  try {
    const result = await telegramRequest('getMe') as { username: string; first_name: string };
    return {
      username: result.username,
      firstName: result.first_name,
    };
  } catch (error) {
    logger.error('Failed to get bot info', { error: (error as Error).message });
    return null;
  }
}

// ============================================
// Link Code Management
// ============================================

/**
 * Generate a link code for connecting Telegram
 */
export async function generateLinkCode(userId: string): Promise<string> {
  // Delete any existing codes for this user
  await pool.query(
    `DELETE FROM telegram_link_codes WHERE user_id = $1`,
    [userId]
  );

  // Generate a random 8-character code
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();

  // Expires in 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO telegram_link_codes (user_id, code, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, code, expiresAt]
  );

  logger.info('Generated Telegram link code', { userId, code });

  return code;
}

/**
 * Validate and use a link code
 * Returns the user ID if valid
 */
export async function validateLinkCode(code: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT user_id FROM telegram_link_codes
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
    `UPDATE telegram_link_codes SET used_at = NOW() WHERE code = $1`,
    [code.toUpperCase()]
  );

  return result.rows[0].user_id;
}

// ============================================
// Connection Management
// ============================================

/**
 * Link a Telegram chat to a user
 */
export async function linkTelegram(
  userId: string,
  chatId: number,
  username?: string,
  firstName?: string
): Promise<TelegramConnection> {
  const result = await pool.query(
    `INSERT INTO telegram_connections (user_id, chat_id, username, first_name)
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

  // Enable Telegram notifications by default
  await pool.query(
    `UPDATE notification_preferences SET enable_telegram = true WHERE user_id = $1`,
    [userId]
  );

  logger.info('Telegram linked', { userId, chatId, username });

  return mapConnectionRow(result.rows[0]);
}

/**
 * Unlink Telegram from a user
 */
export async function unlinkTelegram(userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM telegram_connections WHERE user_id = $1 RETURNING id`,
    [userId]
  );

  // Disable Telegram notifications
  await pool.query(
    `UPDATE notification_preferences SET enable_telegram = false WHERE user_id = $1`,
    [userId]
  );

  if ((result.rowCount ?? 0) > 0) {
    logger.info('Telegram unlinked', { userId });
    return true;
  }

  return false;
}

/**
 * Get user's Telegram connection
 */
export async function getTelegramConnection(userId: string): Promise<TelegramConnection | null> {
  const result = await pool.query(
    `SELECT * FROM telegram_connections WHERE user_id = $1`,
    [userId]
  );

  return result.rows.length > 0 ? mapConnectionRow(result.rows[0]) : null;
}

/**
 * Get connection by chat ID
 */
export async function getConnectionByChatId(chatId: number): Promise<TelegramConnection | null> {
  const result = await pool.query(
    `SELECT * FROM telegram_connections WHERE chat_id = $1`,
    [chatId]
  );

  return result.rows.length > 0 ? mapConnectionRow(result.rows[0]) : null;
}

/**
 * Update last message time
 */
export async function updateLastMessageTime(userId: string): Promise<void> {
  await pool.query(
    `UPDATE telegram_connections SET last_message_at = NOW() WHERE user_id = $1`,
    [userId]
  );
}

// ============================================
// Telegram Chat Session
// ============================================

/**
 * Get or create a Telegram chat session for a user
 */
async function getOrCreateTelegramSession(userId: string): Promise<string> {
  // Check for existing Telegram session
  const result = await pool.query(
    `SELECT id FROM sessions
     WHERE user_id = $1 AND title = 'Telegram'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length > 0) {
    return result.rows[0].id;
  }

  // Create new Telegram session
  const session = await sessionService.createSession({
    userId,
    title: 'Telegram',
    mode: 'companion',
  });

  logger.info('Created Telegram session', { userId, sessionId: session.id });

  return session.id;
}

/**
 * Process a chat message from Telegram
 */
async function handleChatMessage(
  connection: TelegramConnection,
  text: string
): Promise<void> {
  try {
    // Send typing indicator
    await telegramRequest('sendChatAction', {
      chat_id: connection.chatId,
      action: 'typing',
    });

    // Get or create session
    const sessionId = await getOrCreateTelegramSession(connection.userId);

    // Process message through Luna
    const response = await chatService.processMessage({
      sessionId,
      userId: connection.userId,
      message: text,
      mode: 'companion',
      source: 'telegram',
    });

    // Update last message time
    await updateLastMessageTime(connection.userId);

    // Send response back via Telegram
    // Split long messages (Telegram limit is 4096 chars)
    const maxLength = 4000;
    let content = response.content;

    while (content.length > 0) {
      const chunk = content.slice(0, maxLength);
      content = content.slice(maxLength);

      await sendTelegramMessage(connection.chatId, chunk, {
        parseMode: 'Markdown',
      });
    }

    // Reset idle timer for 5-minute summarization
    resetTelegramIdleTimer(connection.userId, sessionId);

    // Check if we've exceeded token limit (async, don't block response)
    checkTokenLimitAndSummarize(connection.userId, sessionId).catch(() => {});

    logger.info('Telegram chat message processed', {
      userId: connection.userId,
      sessionId,
      inputLength: text.length,
      outputLength: response.content.length,
    });
  } catch (error) {
    logger.error('Failed to process Telegram chat message', {
      userId: connection.userId,
      error: (error as Error).message,
    });

    await sendTelegramMessage(
      connection.chatId,
      'Sorry, I encountered an error processing your message. Please try again.'
    );
  }
}

// ============================================
// Webhook Handler (for incoming messages)
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

  // Handle photo messages
  if (update.message?.photo && update.message.photo.length > 0) {
    await handlePhotoMessage(update.message);
    return;
  }

  // Require text for other message handling
  if (!update.message?.text) return;

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text!.trim(); // Already checked above

  // Check if this is a link code
  if (text.startsWith('/start ')) {
    const code = text.slice(7).trim();
    await handleLinkCommand(chatId, code, message.from);
    return;
  }

  if (text === '/start') {
    await sendTelegramMessage(
      chatId,
      'Hi! I\'m Luna. To link your account, go to Luna Chat Settings > Triggers > Telegram and click "Link Telegram".\n\nOnce linked, you can chat with me directly here!'
    );
    return;
  }

  if (text === '/help') {
    await sendTelegramMessage(
      chatId,
      'Luna Telegram Commands:\n\n/start - Get started\n/list - Quick actions menu\n/status - Check connection status\n/sum - Summarize conversation\n/unlink - Disconnect from Luna\n/help - Show this help\n\nOr just send me a message to chat!\n\nYou can also send images - I will describe them for you!'
    );
    return;
  }

  if (text === '/list') {
    await handleListCommand(chatId);
    return;
  }

  if (text === '/status') {
    await handleStatusCommand(chatId);
    return;
  }

  if (text === '/unlink') {
    await handleUnlinkCommand(chatId);
    return;
  }

  if (text === '/sum') {
    await handleSumCommand(chatId);
    return;
  }

  // For other messages, process as chat if user is linked
  const connection = await getConnectionByChatId(chatId);
  if (connection) {
    // Route to Luna chat
    await handleChatMessage(connection, text);
  } else {
    await sendTelegramMessage(
      chatId,
      'Your Telegram is not linked to a Luna account. Go to Settings > Triggers > Telegram to link it.'
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
    await sendTelegramMessage(
      chatId,
      'Invalid or expired link code. Please generate a new one from Luna Chat Settings.'
    );
    return;
  }

  await linkTelegram(userId, chatId, from.username, from.first_name);

  await sendTelegramMessage(
    chatId,
    `Connected! Hi ${from.first_name}, you can now chat with me directly here.\n\nI'll also send you notifications from Luna.\n\nCommands:\n/status - Check connection\n/unlink - Disconnect\n/help - Show all commands`
  );
}

async function handleStatusCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    await sendTelegramMessage(
      chatId,
      `Connected to Luna Chat\nLinked: ${connection.linkedAt.toLocaleDateString()}\nLast message: ${connection.lastMessageAt?.toLocaleDateString() || 'Never'}`
    );
  } else {
    await sendTelegramMessage(chatId, 'Not connected to any Luna account.');
  }
}

async function handleUnlinkCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    await unlinkTelegram(connection.userId);
    await sendTelegramMessage(chatId, 'Disconnected from Luna. You will no longer receive notifications here.');
  } else {
    await sendTelegramMessage(chatId, 'This chat is not connected to any Luna account.');
  }
}

async function handleSumCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (!connection) {
    await sendTelegramMessage(chatId, 'Not connected to any Luna account.');
    return;
  }

  try {
    await sendTelegramMessage(chatId, 'Starting conversation summarization... This may take a few minutes.');
    const sessionId = await getOrCreateTelegramSession(connection.userId);
    await summarizeTelegramSession(connection.userId, sessionId);
    await sendTelegramMessage(chatId, 'Summarization complete! Old messages have been compressed.');
  } catch (error) {
    logger.error('Failed to handle /sum command', {
      chatId,
      error: (error as Error).message,
    });
    await sendTelegramMessage(chatId, 'Failed to summarize. Please try again later.');
  }
}

async function handleListCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (!connection) {
    await sendTelegramMessage(chatId, 'Not connected to any Luna account.');
    return;
  }

  await sendMessageWithButtons(
    chatId,
    'What would you like to do?',
    QUICK_ACTIONS.main
  );
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

  // Handle category navigation
  if (data.startsWith('cat:')) {
    const category = data.slice(4) as keyof typeof QUICK_ACTIONS;
    const buttons = QUICK_ACTIONS[category];

    if (buttons && messageId) {
      const titles: Record<string, string> = {
        main: 'What would you like to do?',
        tasks: 'Task options:',
        calendar: 'Calendar options:',
        search: 'Search options:',
        fun: 'Fun options:',
      };

      await editMessageButtons(
        chatId,
        messageId,
        titles[category] || 'Choose an option:',
        buttons
      );
    }
    await answerCallbackQuery(callback.id);
    return;
  }

  // Handle trade actions
  if (data.startsWith('trade:')) {
    await handleTradeCallback(callback.id, chatId, messageId, connection.userId, data);
    return;
  }

  // Handle actions - route through chat
  if (data.startsWith('act:')) {
    const actionMessages: Record<string, string> = {
      'act:tasks:pending': 'Show my pending tasks',
      'act:tasks:create': 'I want to create a new task',
      'act:calendar:today': 'What do I have on my calendar today?',
      'act:calendar:week': 'What is on my calendar this week?',
      'act:search:web': 'Let me help you search. What would you like to know?',
      'act:search:weather': 'What is the weather like?',
      'act:fun:joke': 'Tell me a joke',
      'act:fun:fact': 'Tell me an interesting random fact',
    };

    const message = actionMessages[data];
    if (message) {
      await answerCallbackQuery(callback.id, 'Processing...');
      await handleChatMessage(connection, message);
    } else {
      await answerCallbackQuery(callback.id);
    }
    return;
  }

  await answerCallbackQuery(callback.id);
}

async function handlePhotoMessage(
  message: NonNullable<TelegramUpdate['message']>
): Promise<void> {
  const chatId = message.chat.id;

  const connection = await getConnectionByChatId(chatId);
  if (!connection) {
    await sendTelegramMessage(
      chatId,
      'Your Telegram is not linked to a Luna account. Go to Settings > Triggers > Telegram to link it.'
    );
    return;
  }

  try {
    // Send typing indicator
    await telegramRequest('sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    });

    // Get the largest photo (last in array)
    const photo = message.photo![message.photo!.length - 1];

    // Get file path from Telegram
    const fileInfo = await telegramRequest('getFile', {
      file_id: photo.file_id,
    }) as { file_path: string };

    // Download the image
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const imageUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;

    // Get caption if any
    const caption = message.caption || '';

    // Build message for Luna
    const userMessage = caption
      ? `[User sent an image with caption: "${caption}"]\n\nImage URL: ${imageUrl}\n\nPlease describe what you see in this image and respond to the caption.`
      : `[User sent an image]\n\nImage URL: ${imageUrl}\n\nPlease describe what you see in this image.`;

    // Get or create session
    const sessionId = await getOrCreateTelegramSession(connection.userId);

    // Process through Luna (vision-capable model will handle the URL)
    const response = await chatService.processMessage({
      sessionId,
      userId: connection.userId,
      message: userMessage,
      mode: 'companion',
      source: 'telegram',
    });

    // Update last message time
    await updateLastMessageTime(connection.userId);

    // Send response
    const maxLength = 4000;
    let content = response.content;
    while (content.length > 0) {
      const chunk = content.slice(0, maxLength);
      content = content.slice(maxLength);
      await sendTelegramMessage(chatId, chunk, { parseMode: 'Markdown' });
    }

    resetTelegramIdleTimer(connection.userId, sessionId);

    logger.info('Telegram photo message processed', {
      userId: connection.userId,
      sessionId,
      hasCaption: !!caption,
    });
  } catch (error) {
    logger.error('Failed to process Telegram photo', {
      userId: connection.userId,
      error: (error as Error).message,
    });
    await sendTelegramMessage(
      chatId,
      'Sorry, I had trouble processing that image. Please try again.'
    );
  }
}

// ============================================
// Helpers
// ============================================

function mapConnectionRow(row: Record<string, unknown>): TelegramConnection {
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

// ============================================
// Trade Notification Support
// ============================================

/**
 * Send trade message with inline buttons (exported for trade-notification.service)
 */
export async function sendTradeMessageWithButtons(
  chatId: number,
  text: string,
  buttons: Array<{ text: string; callback: string }>
): Promise<boolean> {
  return sendMessageWithButtons(chatId, text, buttons, 2);
}

/**
 * Handle trade callback actions
 */
async function handleTradeCallback(
  callbackId: string,
  chatId: number,
  messageId: number | undefined,
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
      await sendTelegramMessage(chatId, `Position ${trade.symbol} closed at market.`);
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
        { text: 'Cancel', callback: `trade:slcancel:${tradeId}` },
      ];

      if (messageId) {
        await editMessageButtons(chatId, messageId, `Set Stop Loss for ${symbol}:`, slButtons, 3);
      }
      await answerCallbackQuery(callbackId);
    } else if (action === 'sl') {
      // Set stop loss at percentage
      const pct = parseFloat(parts[3]);
      if (isNaN(pct)) {
        await answerCallbackQuery(callbackId, 'Invalid percentage');
        return;
      }

      // Get current price and update SL
      const result = await pool.query(
        `SELECT symbol, side FROM trades WHERE id = $1 AND user_id = $2 AND closed_at IS NULL`,
        [tradeId, userId]
      );

      if (result.rows.length === 0) {
        await answerCallbackQuery(callbackId, 'Position not found');
        return;
      }

      const trade = result.rows[0];

      // Get current price from Binance
      const { BinanceClient } = await import('../trading/binance.client.js');
      const client = new BinanceClient({ apiKey: '', apiSecret: '' });
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
      await sendTelegramMessage(chatId, `Stop loss updated to $${newSL.toFixed(2)} (-${pct}% from current)`);
    } else if (action === 'slcancel') {
      // Cancel SL modification
      await answerCallbackQuery(callbackId, 'Cancelled');
      if (messageId) {
        await editMessageButtons(chatId, messageId, 'Modification cancelled.', [], 1);
      }
    } else if (action === 'cancel') {
      // Cancel pending order
      const tradingService = await import('../trading/trading.service.js');
      await tradingService.cancelOrder(userId, tradeId);
      await answerCallbackQuery(callbackId, 'Order cancelled');
      await sendTelegramMessage(chatId, 'Order cancelled.');
    }
  } catch (error) {
    logger.error('Trade callback error', { action, tradeId, error: (error as Error).message });
    await answerCallbackQuery(callbackId, 'Failed. Try via app.');
  }
}

/**
 * Check if Telegram is configured
 */
export function isConfigured(): boolean {
  return isTelegramConfigured();
}

/**
 * Get setup instructions
 */
export function getSetupInstructions(): string {
  return `To set up Telegram notifications:

1. Create a Telegram bot:
   - Message @BotFather on Telegram
   - Send /newbot and follow instructions
   - Copy the bot token

2. Add the token to your Luna environment:
   TELEGRAM_BOT_TOKEN=your_bot_token

3. (Optional) Set up webhook for instant responses:
   POST to /api/triggers/telegram/webhook

4. Link your account:
   - Go to Settings > Triggers > Telegram
   - Click "Link Telegram"
   - Send the code to your bot`;
}

export default {
  sendTelegramMessage,
  sendTradeMessageWithButtons,
  getBotInfo,
  generateLinkCode,
  validateLinkCode,
  linkTelegram,
  unlinkTelegram,
  getTelegramConnection,
  getConnectionByChatId,
  updateLastMessageTime,
  processUpdate,
  isConfigured,
  getSetupInstructions,
  clearAllTelegramTimers,
};
