import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import * as chatService from '../chat/chat.service.js';
import * as sessionService from '../chat/session.service.js';

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
  };
}

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
    logger.error('Failed to send Telegram message', {
      chatId,
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
     WHERE user_id = $1 AND title = 'Telegram Chat'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length > 0) {
    return result.rows[0].id;
  }

  // Create new Telegram session
  const session = await sessionService.createSession({
    userId,
    title: 'Telegram Chat',
    mode: 'companion',
  });

  logger.info('Created Telegram chat session', { userId, sessionId: session.id });

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
      'Luna Telegram Commands:\n\n/start - Get started\n/status - Check connection status\n/unlink - Disconnect from Luna\n/help - Show this help\n\nOr just send me a message to chat!'
    );
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
};
