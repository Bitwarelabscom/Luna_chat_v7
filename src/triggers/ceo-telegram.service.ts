/**
 * CEO Telegram Service
 *
 * Separate Telegram bot for CEO Luna - handles:
 * - Department agent chat via /economy, /marketing, /development, /research
 * - Meeting orchestration via /meeting
 * - Proposal management via /proposals, /approve, /reject
 * - Proposal notifications with inline Approve/Reject buttons
 */

import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import * as staffChatService from '../ceo/staff-chat.service.js';
import * as ceoProposalsService from '../ceo/ceo-proposals.service.js';
import * as chatService from '../chat/chat.service.js';
import * as sessionService from '../chat/session.service.js';
import { addMessage } from '../chat/session.service.js';
import { DEPARTMENT_MAP } from '../persona/luna.persona.js';
import * as modelConfigService from '../llm/model-config.service.js';
import { PROVIDERS } from '../llm/types.js';
import type { ProviderId } from '../llm/types.js';

// ============================================
// Types
// ============================================

export interface CeoTelegramConnection {
  id: string;
  userId: string;
  chatId: number;
  username: string | null;
  firstName: string | null;
  isActive: boolean;
  linkedAt: Date;
  lastMessageAt: Date | null;
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
  return process.env.CEO_TELEGRAM_BOT_TOKEN || null;
}

export function isConfigured(): boolean {
  return !!getBotToken();
}

// Webhook secret token - Telegram sends this in X-Telegram-Bot-Api-Secret-Token header
const WEBHOOK_SECRET = process.env.CEO_TELEGRAM_WEBHOOK_SECRET || '';

export function getWebhookSecret(): string {
  return WEBHOOK_SECRET;
}

// Allowlist of authorized Telegram user IDs (empty = allow all linked users)
const ALLOWED_TELEGRAM_IDS: Set<number> = new Set(
  (process.env.CEO_TELEGRAM_ALLOWED_IDS || '')
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id))
);

function isUserAllowed(telegramUserId: number): boolean {
  if (ALLOWED_TELEGRAM_IDS.size === 0) return true;
  return ALLOWED_TELEGRAM_IDS.has(telegramUserId);
}

// Pending state for model selection flow
const pendingModelSelections: Map<number, { provider: ProviderId; models: Array<{ id: string; name: string }>; timestamp: number }> = new Map();
const pendingMeetingInput: Set<number> = new Set(); // chatIds waiting for meeting topic text

const PENDING_TTL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [chatId, state] of pendingModelSelections) {
    if (now - state.timestamp > PENDING_TTL) pendingModelSelections.delete(chatId);
  }
}, 60 * 1000);

// ============================================
// Telegram API
// ============================================

function getCeoPersistentKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: '/proposals' }, { text: '/meeting' }, { text: '/model' }],
      [{ text: '/economy' }, { text: '/marketing' }, { text: '/development' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function telegramRequest(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const token = getBotToken();
  if (!token) {
    throw new Error('CEO Telegram bot token not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const result = await response.json() as TelegramApiResponse;

  if (!result.ok) {
    logger.error('CEO Telegram API error', { method, error: result.description });
    throw new Error(result.description || 'Telegram API error');
  }

  return result.result;
}

export async function sendMessage(
  chatId: number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableNotification?: boolean;
    replyMarkup?: Record<string, unknown>;
  }
): Promise<boolean> {
  try {
    await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode,
      disable_notification: options?.disableNotification,
      reply_markup: options?.replyMarkup,
    });
    return true;
  } catch (error) {
    const errorMessage = (error as Error).message;

    // If parsing failed and we were using parseMode, retry without it
    if (options?.parseMode && errorMessage.includes("can't parse entities")) {
      logger.warn('CEO Telegram markdown parsing failed, retrying as plain text', { chatId });
      try {
        await telegramRequest('sendMessage', {
          chat_id: chatId,
          text,
          disable_notification: options?.disableNotification,
          reply_markup: options?.replyMarkup,
        });
        return true;
      } catch (retryError) {
        logger.error('Failed to send CEO Telegram message (retry)', {
          chatId,
          error: (retryError as Error).message,
        });
        return false;
      }
    }

    logger.error('Failed to send CEO Telegram message', { chatId, error: errorMessage });
    return false;
  }
}

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
    logger.error('Failed to send CEO Telegram message with buttons', {
      chatId,
      error: (error as Error).message,
    });
    return { success: false };
  }
}

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
    logger.error('Failed to edit CEO Telegram message', {
      chatId,
      messageId,
      error: (error as Error).message,
    });
    return false;
  }
}

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
    logger.error('Failed to answer CEO callback query', { error: (error as Error).message });
    return false;
  }
}

export async function getBotInfo(): Promise<{ username: string; firstName: string } | null> {
  if (!isConfigured()) return null;

  try {
    const result = await telegramRequest('getMe') as { username: string; first_name: string };
    return {
      username: result.username,
      firstName: result.first_name,
    };
  } catch (error) {
    logger.error('Failed to get CEO bot info', { error: (error as Error).message });
    return null;
  }
}

// ============================================
// Link Code Management
// ============================================

export async function generateLinkCode(userId: string): Promise<string> {
  await pool.query(
    `DELETE FROM ceo_telegram_link_codes WHERE user_id = $1`,
    [userId]
  );

  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO ceo_telegram_link_codes (user_id, code, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, code, expiresAt]
  );

  logger.info('Generated CEO Telegram link code', { userId, code });
  return code;
}

async function validateLinkCode(code: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT user_id FROM ceo_telegram_link_codes
     WHERE code = $1
       AND expires_at > NOW()
       AND used_at IS NULL`,
    [code.toUpperCase()]
  );

  if (result.rows.length === 0) return null;

  await pool.query(
    `UPDATE ceo_telegram_link_codes SET used_at = NOW() WHERE code = $1`,
    [code.toUpperCase()]
  );

  return result.rows[0].user_id;
}

// ============================================
// Connection Management
// ============================================

export async function linkTelegram(
  userId: string,
  chatId: number,
  username?: string,
  firstName?: string
): Promise<CeoTelegramConnection> {
  const result = await pool.query(
    `INSERT INTO ceo_telegram_connections (user_id, chat_id, username, first_name)
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

  logger.info('CEO Telegram linked', { userId, chatId, username });
  return mapConnectionRow(result.rows[0]);
}

export async function unlinkTelegram(userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM ceo_telegram_connections WHERE user_id = $1 RETURNING id`,
    [userId]
  );

  if ((result.rowCount ?? 0) > 0) {
    logger.info('CEO Telegram unlinked', { userId });
    return true;
  }
  return false;
}

export async function getConnection(userId: string): Promise<CeoTelegramConnection | null> {
  const result = await pool.query(
    `SELECT * FROM ceo_telegram_connections WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0 ? mapConnectionRow(result.rows[0]) : null;
}

export async function getConnectionByChatId(chatId: number): Promise<CeoTelegramConnection | null> {
  const result = await pool.query(
    `SELECT * FROM ceo_telegram_connections WHERE chat_id = $1`,
    [chatId]
  );
  return result.rows.length > 0 ? mapConnectionRow(result.rows[0]) : null;
}

async function updateLastMessageTime(userId: string): Promise<void> {
  await pool.query(
    `UPDATE ceo_telegram_connections SET last_message_at = NOW() WHERE user_id = $1`,
    [userId]
  );
}

// ============================================
// CEO Luna Chat (free-form messages)
// ============================================

async function getOrCreateCeoTelegramSession(userId: string): Promise<string> {
  const title = 'CEO Telegram';

  const result = await pool.query(
    `SELECT id FROM sessions
     WHERE user_id = $1 AND title = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, title]
  );

  if (result.rows.length > 0) {
    return result.rows[0].id;
  }

  const session = await sessionService.createSession({ userId, title, mode: 'ceo_luna' });
  logger.info('Created CEO Telegram session', { userId, sessionId: session.id });
  return session.id;
}

async function handleCeoChat(
  connection: CeoTelegramConnection,
  text: string
): Promise<void> {
  try {
    await telegramRequest('sendChatAction', {
      chat_id: connection.chatId,
      action: 'typing',
    });

    const sessionId = await getOrCreateCeoTelegramSession(connection.userId);

    const response = await chatService.processMessage({
      sessionId,
      userId: connection.userId,
      message: text,
      mode: 'ceo_luna',
      source: 'telegram',
    });

    await updateLastMessageTime(connection.userId);

    const maxLength = 4000;
    let content = response.content;

    while (content.length > 0) {
      const chunk = content.slice(0, maxLength);
      content = content.slice(maxLength);
      await sendMessage(connection.chatId, chunk, { parseMode: 'Markdown' });
    }

    logger.info('CEO Telegram chat message processed', {
      userId: connection.userId,
      sessionId,
      inputLength: text.length,
      outputLength: response.content.length,
    });
  } catch (error) {
    logger.error('Failed to process CEO Telegram chat message', {
      userId: connection.userId,
      error: (error as Error).message,
    });
    await sendMessage(connection.chatId, 'Sorry, I encountered an error. Please try again.');
  }
}

// ============================================
// Department Chat Handlers
// ============================================

const VALID_DEPARTMENTS = ['economy', 'marketing', 'development', 'research'] as const;

async function handleDepartmentMessage(
  connection: CeoTelegramConnection,
  department: string,
  message: string
): Promise<void> {
  try {
    await telegramRequest('sendChatAction', {
      chat_id: connection.chatId,
      action: 'typing',
    });

    const session = await staffChatService.getOrCreateStaffSession(connection.userId, department);
    const response = await staffChatService.sendStaffMessage(connection.userId, session.id, message);

    await updateLastMessageTime(connection.userId);

    const dept = DEPARTMENT_MAP.get(department as typeof VALID_DEPARTMENTS[number]);
    const deptName = dept?.name || department;

    // Split long messages
    const maxLength = 4000;
    let content = `[${deptName}]\n${response.content}`;

    while (content.length > 0) {
      const chunk = content.slice(0, maxLength);
      content = content.slice(maxLength);
      await sendMessage(connection.chatId, chunk, { parseMode: 'Markdown' });
    }

    // Inject into CEO Luna chat session so free-form chat has context
    try {
      const ceoSessionId = await getOrCreateCeoTelegramSession(connection.userId);
      await addMessage({
        sessionId: ceoSessionId,
        role: 'user',
        content: `[Staff Chat - ${deptName}] ${message}`,
        source: 'telegram',
      });
      await addMessage({
        sessionId: ceoSessionId,
        role: 'assistant',
        content: `[${deptName} responded via staff chat]\n${response.content}`,
        source: 'telegram',
      });
    } catch {
      // Non-critical - don't fail the response
    }

    logger.info('CEO Telegram dept message processed', {
      userId: connection.userId,
      department,
      inputLength: message.length,
      outputLength: response.content.length,
    });
  } catch (error) {
    logger.error('Failed to process CEO Telegram dept message', {
      userId: connection.userId,
      department,
      error: (error as Error).message,
    });
    await sendMessage(
      connection.chatId,
      `Failed to reach ${department} department. Please try again.`
    );
  }
}

async function handleMeetingMessage(
  connection: CeoTelegramConnection,
  message: string
): Promise<void> {
  try {
    await telegramRequest('sendChatAction', {
      chat_id: connection.chatId,
      action: 'typing',
    });

    const session = await staffChatService.getOrCreateStaffSession(connection.userId, 'meeting');
    const responses = await staffChatService.sendMeetingMessage(connection.userId, session.id, message);

    await updateLastMessageTime(connection.userId);

    for (const msg of responses) {
      const deptLabel = msg.departmentSlug === 'meeting'
        ? 'CEO Luna'
        : DEPARTMENT_MAP.get(msg.departmentSlug as typeof VALID_DEPARTMENTS[number])?.name || msg.departmentSlug;

      const maxLength = 4000;
      let content = `[${deptLabel}]\n${msg.content}`;

      while (content.length > 0) {
        const chunk = content.slice(0, maxLength);
        content = content.slice(maxLength);
        await sendMessage(connection.chatId, chunk, { parseMode: 'Markdown' });
      }
    }

    // Inject meeting transcript into CEO Luna chat session
    try {
      const ceoSessionId = await getOrCreateCeoTelegramSession(connection.userId);
      await addMessage({
        sessionId: ceoSessionId,
        role: 'user',
        content: `[Team Meeting] ${message}`,
        source: 'telegram',
      });
      const transcript = responses.map(msg => {
        const label = msg.departmentSlug === 'meeting'
          ? 'CEO Luna'
          : DEPARTMENT_MAP.get(msg.departmentSlug as typeof VALID_DEPARTMENTS[number])?.name || msg.departmentSlug;
        return `[${label}] ${msg.content}`;
      }).join('\n\n');
      await addMessage({
        sessionId: ceoSessionId,
        role: 'assistant',
        content: `[Meeting transcript]\n${transcript}`,
        source: 'telegram',
      });
    } catch {
      // Non-critical
    }

    logger.info('CEO Telegram meeting message processed', {
      userId: connection.userId,
      responseCount: responses.length,
    });
  } catch (error) {
    logger.error('Failed to process CEO Telegram meeting message', {
      userId: connection.userId,
      error: (error as Error).message,
    });
    await sendMessage(connection.chatId, 'Meeting session failed. Please try again.');
  }
}

// ============================================
// Proposal Handlers
// ============================================

async function handleProposalsCommand(connection: CeoTelegramConnection): Promise<void> {
  try {
    const proposals = await ceoProposalsService.listProposals(connection.userId, { status: 'pending' });

    if (proposals.length === 0) {
      await sendMessage(connection.chatId, 'No pending proposals.');
      return;
    }

    let text = `*Pending Proposals (${proposals.length})*\n\n`;

    for (const p of proposals.slice(0, 15)) {
      const urgencyTag = p.urgency === 'p1' ? '[P1]' : p.urgency === 'p2' ? '[P2]' : '';
      const idShort = p.id.slice(0, 8);
      text += `${urgencyTag} \`${idShort}\` ${p.title}\n`;
    }

    if (proposals.length > 15) {
      text += `\n...and ${proposals.length - 15} more`;
    }

    text += '\n\nUse /approve <id> or /reject <id>';

    await sendMessage(connection.chatId, text, { parseMode: 'Markdown' });
  } catch (error) {
    logger.error('Failed to list proposals via CEO Telegram', {
      userId: connection.userId,
      error: (error as Error).message,
    });
    await sendMessage(connection.chatId, 'Failed to fetch proposals. Please try again.');
  }
}

async function handleApproveCommand(
  connection: CeoTelegramConnection,
  idPrefix: string
): Promise<void> {
  try {
    const proposalId = await resolveProposalId(connection.userId, idPrefix);
    if (!proposalId) {
      await sendMessage(connection.chatId, `No pending proposal found matching "${idPrefix}".`);
      return;
    }

    const result = await ceoProposalsService.approveProposal(connection.userId, proposalId);
    if (result) {
      await sendMessage(connection.chatId, `Approved: ${result.title}`);
    } else {
      await sendMessage(connection.chatId, 'Proposal not found or already decided.');
    }
  } catch (error) {
    logger.error('Failed to approve proposal via CEO Telegram', {
      error: (error as Error).message,
    });
    await sendMessage(connection.chatId, 'Failed to approve proposal.');
  }
}

async function handleRejectCommand(
  connection: CeoTelegramConnection,
  idPrefix: string
): Promise<void> {
  try {
    const proposalId = await resolveProposalId(connection.userId, idPrefix);
    if (!proposalId) {
      await sendMessage(connection.chatId, `No pending proposal found matching "${idPrefix}".`);
      return;
    }

    const ok = await ceoProposalsService.rejectProposal(connection.userId, proposalId);
    if (ok) {
      await sendMessage(connection.chatId, 'Proposal rejected.');
    } else {
      await sendMessage(connection.chatId, 'Proposal not found or already decided.');
    }
  } catch (error) {
    logger.error('Failed to reject proposal via CEO Telegram', {
      error: (error as Error).message,
    });
    await sendMessage(connection.chatId, 'Failed to reject proposal.');
  }
}

/**
 * Resolve a short ID prefix to a full proposal UUID
 */
async function resolveProposalId(userId: string, prefix: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT id FROM ceo_proposals
     WHERE user_id = $1 AND status = 'pending' AND id::text LIKE $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, `${prefix}%`]
  );
  return result.rows.length > 0 ? (result.rows[0] as Record<string, unknown>).id as string : null;
}

// ============================================
// Proposal Notification (called externally)
// ============================================

export async function sendProposalToCeoTelegram(
  userId: string,
  proposal: { id: string; title: string; description: string | null; urgency: string }
): Promise<number | null> {
  const connection = await getConnection(userId);
  if (!connection?.isActive || !connection.chatId) return null;

  const urgencyLabel = proposal.urgency === 'p1' ? 'P1 - URGENT' : proposal.urgency === 'p2' ? 'P2 - Important' : 'Normal';
  const text = `[CEO Luna - ${urgencyLabel}]\n\n${proposal.title}\n\n${proposal.description || ''}`.trim();

  const buttons = [
    { text: 'Approve', callback: `ceo:approve:${proposal.id}` },
    { text: 'Reject', callback: `ceo:reject:${proposal.id}` },
  ];

  const result = await sendMessageWithButtons(connection.chatId, text, buttons, 2);
  return result.messageId || null;
}

// ============================================
// Callback Query Handler
// ============================================

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

  // Handle CEO proposal buttons: ceo:approve:<id> or ceo:reject:<id>
  if (data.startsWith('ceo:')) {
    const parts = data.split(':');
    const action = parts[1];
    const proposalId = parts[2];

    if (!proposalId) {
      await answerCallbackQuery(callback.id, 'Invalid proposal');
      return;
    }

    try {
      if (action === 'approve') {
        const result = await ceoProposalsService.approveProposal(connection.userId, proposalId);
        if (result) {
          await answerCallbackQuery(callback.id, 'Approved!');
          if (messageId) {
            await editMessageText(chatId, messageId, `[APPROVED] ${result.title}`);
          }
        } else {
          await answerCallbackQuery(callback.id, 'Already decided');
        }
      } else if (action === 'reject') {
        const ok = await ceoProposalsService.rejectProposal(connection.userId, proposalId);
        if (ok) {
          await answerCallbackQuery(callback.id, 'Rejected');
          if (messageId) {
            await editMessageText(chatId, messageId, `[REJECTED] ${data.split(':').slice(3).join(':') || 'Proposal rejected'}`);
          }
        } else {
          await answerCallbackQuery(callback.id, 'Already decided');
        }
      }
    } catch (error) {
      logger.error('CEO Telegram proposal callback error', { action, proposalId, error: (error as Error).message });
      await answerCallbackQuery(callback.id, 'Failed. Try via app.');
    }
    return;
  }

  // Department suggestion callbacks
  if (data.startsWith('cdept:')) {
    const parts = data.split(':');
    const dept = parts[1];
    const index = parseInt(parts[2], 10);
    const suggestions = DEPARTMENT_SUGGESTIONS[dept as keyof typeof DEPARTMENT_SUGGESTIONS];

    if (suggestions && index >= 0 && index < suggestions.length) {
      const suggestion = suggestions[index];
      await answerCallbackQuery(callback.id, 'Processing...');
      await handleDepartmentMessage(connection, dept, suggestion.message);
    } else {
      await answerCallbackQuery(callback.id, 'Invalid selection');
    }
    return;
  }

  // Meeting suggestion callbacks
  if (data.startsWith('cmtg:')) {
    const topic = data.slice(5);
    if (topic === 'custom') {
      pendingMeetingInput.add(chatId);
      await answerCallbackQuery(callback.id);
      await sendMessage(chatId, 'Type your meeting topic:');
    } else {
      const topicMessages: Record<string, string> = {
        weekly: 'Run our weekly planning meeting - review progress, blockers, and set priorities for the week',
        project: 'Run a project review meeting - status updates on all active projects',
        strategy: 'Run a strategy discussion - long term vision, market position, and key decisions',
      };
      const msg = topicMessages[topic] || topic;
      await answerCallbackQuery(callback.id, 'Starting meeting...');
      await handleMeetingMessage(connection, msg);
    }
    return;
  }

  // CEO model provider selection
  if (data.startsWith('cmdl:p:')) {
    const providerId = data.slice(7) as ProviderId;
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      await answerCallbackQuery(callback.id, 'Provider not found');
      return;
    }

    const chatModels = provider.models.filter(m => m.capabilities.includes('chat'));
    pendingModelSelections.set(chatId, {
      provider: providerId,
      models: chatModels.map(m => ({ id: m.id, name: m.name })),
      timestamp: Date.now(),
    });

    const buttons = chatModels.map((m, i) => ({
      text: m.name,
      callback: `cmdl:m:${i}`,
    }));

    await sendMessageWithButtons(chatId, `Select a ${provider.name} model:`, buttons, 1);
    await answerCallbackQuery(callback.id);
    return;
  }

  // CEO model selection
  if (data.startsWith('cmdl:m:')) {
    const index = parseInt(data.slice(7), 10);
    const pending = pendingModelSelections.get(chatId);
    if (!pending || index < 0 || index >= pending.models.length) {
      await answerCallbackQuery(callback.id, 'Selection expired');
      return;
    }

    const model = pending.models[index];
    try {
      await modelConfigService.setUserModelConfig(connection.userId, 'ceo_luna', pending.provider, model.id);
      pendingModelSelections.delete(chatId);
      await answerCallbackQuery(callback.id, `Switched to ${model.name}`);
      await sendMessage(chatId, `CEO Luna model switched to ${model.name} (${pending.provider})`);
    } catch {
      await answerCallbackQuery(callback.id, 'Failed to switch model');
    }
    return;
  }

  // CEO quick model presets
  if (data.startsWith('cqm:')) {
    const presetMap: Array<{ provider: ProviderId; model: string; name: string }> = [
      { provider: 'xai', model: 'grok-4-1-fast', name: 'Grok 4.1 Fast' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { provider: 'groq', model: 'llama-3.3-70b-versatile', name: 'Llama 70B (Groq)' },
      { provider: 'google', model: 'gemini-2.0-flash', name: 'Gemini Flash' },
      { provider: 'xai', model: 'grok-4', name: 'Grok 4' },
    ];

    const index = parseInt(data.slice(4), 10);
    const preset = presetMap[index];
    if (!preset) {
      await answerCallbackQuery(callback.id, 'Invalid preset');
      return;
    }

    try {
      await modelConfigService.setUserModelConfig(connection.userId, 'ceo_luna', preset.provider, preset.model);
      await answerCallbackQuery(callback.id, `Switched to ${preset.name}`);
      await sendMessage(chatId, `CEO Luna model switched to ${preset.name}`);
    } catch {
      await answerCallbackQuery(callback.id, 'Failed to switch model');
    }
    return;
  }

  await answerCallbackQuery(callback.id);
}

// ============================================
// Suggestion Data
// ============================================

const DEPARTMENT_SUGGESTIONS = {
  economy: [
    { text: 'Revenue report', message: 'Give me a revenue report for this period' },
    { text: 'Cost analysis', message: 'Analyze our current costs and spending' },
    { text: 'Budget status', message: 'What is our current budget status?' },
  ],
  marketing: [
    { text: 'Social stats', message: 'Show me our social media statistics' },
    { text: 'Content ideas', message: 'Generate some content ideas for this week' },
    { text: 'Audience growth', message: 'How is our audience growth trending?' },
  ],
  development: [
    { text: 'Sprint status', message: 'What is the current sprint status?' },
    { text: 'Bug report', message: 'Give me a summary of open bugs' },
    { text: 'Tech debt', message: 'What are our top tech debt items?' },
  ],
  research: [
    { text: 'Latest findings', message: 'What are the latest research findings?' },
    { text: 'Trend analysis', message: 'Analyze current market and tech trends' },
    { text: 'Competitors', message: 'Give me a competitor analysis update' },
  ],
} as const;

const MEETING_SUGGESTIONS = [
  { text: 'Weekly planning', topic: 'weekly' },
  { text: 'Project review', topic: 'project' },
  { text: 'Strategy discussion', topic: 'strategy' },
  { text: 'Custom topic', topic: 'custom' },
];

// ============================================
// Model Command Handlers
// ============================================

async function handleCeoModelCommand(chatId: number): Promise<void> {
  const enabledProviders = PROVIDERS.filter(p => p.enabled);
  const buttons = enabledProviders.map(p => ({
    text: p.name,
    callback: `cmdl:p:${p.id}`,
  }));
  await sendMessageWithButtons(chatId, 'Select a provider:', buttons, 2);
}

async function handleCeoQuickModelCommand(chatId: number): Promise<void> {
  const presets = [
    { text: 'Grok 4.1 Fast', callback: 'cqm:0' },
    { text: 'Claude Sonnet 4', callback: 'cqm:1' },
    { text: 'Llama 70B (Groq)', callback: 'cqm:2' },
    { text: 'Gemini Flash', callback: 'cqm:3' },
    { text: 'Grok 4', callback: 'cqm:4' },
  ];
  await sendMessageWithButtons(chatId, 'Quick model presets for CEO Luna:', presets, 2);
}

// ============================================
// Webhook Handler
// ============================================

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  // Security: check Telegram user ID allowlist on all interactions
  const telegramUserId = update.message?.from?.id || update.callback_query?.from?.id;
  if (telegramUserId && !isUserAllowed(telegramUserId)) {
    logger.warn('Unauthorized CEO Telegram access attempt', { telegramUserId });
    const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(chatId, 'You are not authorized to use this bot.');
    }
    return;
  }

  // Handle callback queries (button presses)
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  if (!update.message?.text) return;

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text!.trim();

  // /start <code> - link account
  if (text.startsWith('/start ')) {
    const code = text.slice(7).trim();
    await handleLinkCommand(chatId, code, message.from);
    return;
  }

  if (text === '/start') {
    await sendMessage(
      chatId,
      'Hi! I\'m CEO Luna\'s command bot. To link your account, go to Luna Chat > CEO > Settings and click "Link CEO Telegram".\n\nOnce linked, you can chat with departments, manage proposals, and run meetings here!'
    );
    return;
  }

  if (text === '/model') {
    // Check connection first
    const conn = await getConnectionByChatId(chatId);
    if (!conn) {
      await sendMessage(chatId, 'Not connected. Link your account first.');
      return;
    }
    await handleCeoModelCommand(chatId);
    return;
  }

  if (text === '/quick') {
    const conn = await getConnectionByChatId(chatId);
    if (!conn) {
      await sendMessage(chatId, 'Not connected. Link your account first.');
      return;
    }
    await handleCeoQuickModelCommand(chatId);
    return;
  }

  if (text === '/help') {
    await sendMessage(
      chatId,
      'CEO Luna Telegram Commands:\n\n'
      + 'Department Chat:\n'
      + '/economy - Talk to Finance Luna\n'
      + '/marketing - Talk to Market Luna\n'
      + '/development - Talk to Dev Luna\n'
      + '/research - Talk to Research Luna\n'
      + '/meeting - Start a team meeting\n\n'
      + 'Proposals:\n'
      + '/proposals - List pending proposals\n'
      + '/approve <id> - Approve a proposal\n'
      + '/reject <id> - Reject a proposal\n\n'
      + 'Model:\n'
      + '/model - Switch AI model\n'
      + '/quick - Quick model presets\n\n'
      + 'Other:\n'
      + '/status - Check connection status\n'
      + '/unlink - Disconnect from CEO Luna\n'
      + '/help - Show this help',
      { replyMarkup: getCeoPersistentKeyboard() }
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

  // Check connection for all other commands
  const connection = await getConnectionByChatId(chatId);
  if (!connection) {
    await sendMessage(chatId, 'Your Telegram is not linked to a CEO Luna account. Go to CEO Settings to link it.');
    return;
  }

  // Check for pending meeting topic input
  if (pendingMeetingInput.has(chatId)) {
    pendingMeetingInput.delete(chatId);
    await handleMeetingMessage(connection, text);
    return;
  }

  // Department commands
  for (const dept of VALID_DEPARTMENTS) {
    if (text.startsWith(`/${dept} `)) {
      const msg = text.slice(dept.length + 2).trim();
      if (!msg) {
        await sendMessage(chatId, `Usage: /${dept} <your message>`);
        return;
      }
      await handleDepartmentMessage(connection, dept, msg);
      return;
    }
    if (text === `/${dept}`) {
      const suggestions = DEPARTMENT_SUGGESTIONS[dept as keyof typeof DEPARTMENT_SUGGESTIONS];
      if (suggestions) {
        const buttons = suggestions.map((s, i) => ({
          text: s.text,
          callback: `cdept:${dept}:${i}`,
        }));
        const deptObj = DEPARTMENT_MAP.get(dept as typeof VALID_DEPARTMENTS[number]);
        const deptName = deptObj?.name || dept;
        await sendMessageWithButtons(chatId, `${deptName} - what would you like to know?`, buttons, 1);
      } else {
        await sendMessage(chatId, `Usage: /${dept} <your message>`);
      }
      return;
    }
  }

  // Meeting command
  if (text.startsWith('/meeting ')) {
    const msg = text.slice(9).trim();
    if (!msg) {
      await sendMessage(chatId, 'Usage: /meeting <topic or question>');
      return;
    }
    await handleMeetingMessage(connection, msg);
    return;
  }
  if (text === '/meeting') {
    const buttons = MEETING_SUGGESTIONS.map(s => ({
      text: s.text,
      callback: `cmtg:${s.topic}`,
    }));
    await sendMessageWithButtons(chatId, 'Start a meeting - choose a topic:', buttons, 2);
    return;
  }

  // Proposals command
  if (text === '/proposals') {
    await handleProposalsCommand(connection);
    return;
  }

  // Approve command
  if (text.startsWith('/approve ')) {
    const idPrefix = text.slice(9).trim();
    if (!idPrefix) {
      await sendMessage(chatId, 'Usage: /approve <proposal-id-prefix>');
      return;
    }
    await handleApproveCommand(connection, idPrefix);
    return;
  }

  // Reject command
  if (text.startsWith('/reject ')) {
    const idPrefix = text.slice(8).trim();
    if (!idPrefix) {
      await sendMessage(chatId, 'Usage: /reject <proposal-id-prefix>');
      return;
    }
    await handleRejectCommand(connection, idPrefix);
    return;
  }

  // Free-form message - route to CEO Luna chat
  await handleCeoChat(connection, text);
}

// ============================================
// Link / Status / Unlink handlers
// ============================================

async function handleLinkCommand(
  chatId: number,
  code: string,
  from: { id: number; first_name: string; username?: string }
): Promise<void> {
  const userId = await validateLinkCode(code);

  if (!userId) {
    await sendMessage(chatId, 'Invalid or expired link code. Please generate a new one from CEO Luna Settings.');
    return;
  }

  await linkTelegram(userId, chatId, from.username, from.first_name);

  await sendMessage(
    chatId,
    `Connected! Hi ${from.first_name}, you can now:\n\n`
    + '- Chat with department agents (/economy, /marketing, /development, /research)\n'
    + '- Run team meetings (/meeting)\n'
    + '- Manage proposals (/proposals, /approve, /reject)\n'
    + '- Switch AI models (/model, /quick)\n'
    + '- Receive proposal notifications with inline buttons\n\n'
    + 'Type /help for the full command list.',
    { replyMarkup: getCeoPersistentKeyboard() }
  );
}

async function handleStatusCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    await sendMessage(
      chatId,
      `Connected to CEO Luna\nLinked: ${connection.linkedAt.toLocaleDateString()}\nLast message: ${connection.lastMessageAt?.toLocaleDateString() || 'Never'}`
    );
  } else {
    await sendMessage(chatId, 'Not connected to any CEO Luna account.');
  }
}

async function handleUnlinkCommand(chatId: number): Promise<void> {
  const connection = await getConnectionByChatId(chatId);

  if (connection) {
    await unlinkTelegram(connection.userId);
    await sendMessage(chatId, 'Disconnected from CEO Luna. You will no longer receive proposal notifications here.');
  } else {
    await sendMessage(chatId, 'This chat is not connected to any CEO Luna account.');
  }
}

// ============================================
// Helpers
// ============================================

function mapConnectionRow(row: Record<string, unknown>): CeoTelegramConnection {
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

export function getSetupInstructions(): string {
  return `To set up CEO Telegram:

1. The bot token should be configured in CEO_TELEGRAM_BOT_TOKEN

2. Set up webhook:
   POST to /api/triggers/ceo-telegram/webhook

3. Link your account:
   - Go to CEO Luna > Settings
   - Click "Link CEO Telegram"
   - Send the code to the CEO bot`;
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
  sendProposalToCeoTelegram,
  processUpdate,
  isConfigured,
  getSetupInstructions,
};
