import { pool } from '../db/index.js';
import { generateEmbedding } from '../memory/embedding.service.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { encryptToken, isEncryptionAvailable } from '../utils/encryption.js';
import * as localEmail from '../integrations/local-email.service.js';
import * as gatekeeper from '../email/email-gatekeeper.service.js';
import type { SanitizedEmail } from '../email/email-gatekeeper.service.js';

export interface EmailConnection {
  id: string;
  provider: 'gmail' | 'outlook' | 'imap';
  emailAddress: string;
  isActive: boolean;
  lastSyncAt?: Date;
  createdAt: Date;
}

export interface Email {
  id: string;
  externalId: string;
  threadId?: string;
  subject?: string;
  fromAddress: string;
  toAddresses: string[];
  snippet?: string;
  bodyPreview?: string;
  receivedAt: Date;
  isRead: boolean;
  isImportant: boolean;
  labels: string[];
  similarity?: number;
}

/**
 * Store OAuth connection with encrypted tokens
 */
export async function storeEmailConnection(
  userId: string,
  provider: 'gmail' | 'outlook' | 'imap',
  tokens: {
    emailAddress: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }
): Promise<EmailConnection> {
  try {
    // SECURITY: Encrypt OAuth tokens before storing in database
    let accessTokenToStore = tokens.accessToken;
    let refreshTokenToStore = tokens.refreshToken;

    if (isEncryptionAvailable()) {
      accessTokenToStore = encryptToken(tokens.accessToken);
      refreshTokenToStore = encryptToken(tokens.refreshToken);
      logger.debug('OAuth tokens encrypted for storage', { userId, provider });
    } else {
      logger.warn('Encryption key not configured - storing OAuth tokens unencrypted', { userId, provider });
    }

    const result = await pool.query(
      `INSERT INTO email_connections (user_id, provider, email_address, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         email_address = EXCLUDED.email_address,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         is_active = true,
         updated_at = NOW()
       RETURNING id, provider, email_address, is_active, last_sync_at, created_at`,
      [userId, provider, tokens.emailAddress, accessTokenToStore, refreshTokenToStore, tokens.expiresAt]
    );

    logger.info('Stored email connection', { userId, provider });
    return mapRowToConnection(result.rows[0]);
  } catch (error) {
    logger.error('Failed to store email connection', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Get email connections
 */
export async function getEmailConnections(userId: string): Promise<EmailConnection[]> {
  try {
    const result = await pool.query(
      `SELECT id, provider, email_address, is_active, last_sync_at, created_at
       FROM email_connections
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    return result.rows.map(mapRowToConnection);
  } catch (error) {
    logger.error('Failed to get email connections', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Get recent emails
 */
export async function getRecentEmails(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean; important?: boolean } = {}
): Promise<Email[]> {
  const { limit = 20, unreadOnly = false, important = false } = options;

  try {
    let query = `
      SELECT ec.id, ec.external_id, ec.thread_id, ec.subject, ec.from_address, ec.to_addresses,
             ec.snippet, ec.body_preview, ec.received_at, ec.is_read, ec.is_important, ec.labels
       FROM email_cache ec
       JOIN email_connections econ ON econ.id = ec.connection_id
       WHERE econ.user_id = $1 AND econ.is_active = true
    `;
    const params: (string | number | boolean)[] = [userId];

    if (unreadOnly) {
      query += ` AND ec.is_read = false`;
    }

    if (important) {
      query += ` AND ec.is_important = true`;
    }

    query += ` ORDER BY ec.received_at DESC LIMIT $2`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows.map(mapRowToEmail);
  } catch (error) {
    logger.error('Failed to get recent emails', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Search emails by semantic similarity
 */
export async function searchEmails(
  userId: string,
  query: string,
  limit: number = 5
): Promise<Email[]> {
  try {
    const { embedding } = await generateEmbedding(query);
    const vectorString = `[${embedding.join(',')}]`;

    const result = await pool.query(
      `SELECT ec.id, ec.external_id, ec.thread_id, ec.subject, ec.from_address, ec.to_addresses,
              ec.snippet, ec.body_preview, ec.received_at, ec.is_read, ec.is_important, ec.labels,
              1 - (ec.embedding <=> $1::vector) as similarity
       FROM email_cache ec
       JOIN email_connections econ ON econ.id = ec.connection_id
       WHERE econ.user_id = $2 AND econ.is_active = true
         AND ec.embedding IS NOT NULL
         AND 1 - (ec.embedding <=> $1::vector) > 0.5
       ORDER BY ec.embedding <=> $1::vector
       LIMIT $3`,
      [vectorString, userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      ...mapRowToEmail(row),
      similarity: parseFloat(row.similarity as string),
    }));
  } catch (error) {
    logger.error('Failed to search emails', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Sync emails from provider (placeholder)
 */
export async function syncEmails(
  userId: string,
  connectionId: string
): Promise<number> {
  try {
    const connResult = await pool.query(
      `SELECT provider, access_token, refresh_token, token_expires_at
       FROM email_connections
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );

    if (connResult.rows.length === 0) {
      throw new Error('Email connection not found');
    }

    // TODO: Implement actual API calls
    await pool.query(
      `UPDATE email_connections SET last_sync_at = NOW() WHERE id = $1`,
      [connectionId]
    );

    logger.info('Email sync completed', { userId, connectionId });
    return 0;
  } catch (error) {
    logger.error('Failed to sync emails', { error: (error as Error).message, userId });
    throw error;
  }
}

/**
 * Cache emails with embeddings
 */
export async function cacheEmails(
  connectionId: string,
  emails: Array<Omit<Email, 'id' | 'similarity'>>
): Promise<void> {
  try {
    for (const email of emails) {
      // Generate embedding from subject and snippet
      const textToEmbed = `${email.subject || ''}\n${email.snippet || email.bodyPreview || ''}`;
      let vectorString: string | null = null;

      if (textToEmbed.trim().length > 10) {
        const { embedding } = await generateEmbedding(textToEmbed);
        vectorString = `[${embedding.join(',')}]`;
      }

      await pool.query(
        `INSERT INTO email_cache (connection_id, external_id, thread_id, subject, from_address, to_addresses,
                                  snippet, body_preview, received_at, is_read, is_important, labels, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)
         ON CONFLICT (connection_id, external_id) DO UPDATE SET
           subject = EXCLUDED.subject,
           snippet = EXCLUDED.snippet,
           body_preview = EXCLUDED.body_preview,
           is_read = EXCLUDED.is_read,
           is_important = EXCLUDED.is_important,
           labels = EXCLUDED.labels,
           embedding = EXCLUDED.embedding,
           synced_at = NOW()`,
        [connectionId, email.externalId, email.threadId, email.subject, email.fromAddress,
         email.toAddresses, email.snippet, email.bodyPreview, email.receivedAt,
         email.isRead, email.isImportant, email.labels, vectorString]
      );
    }
  } catch (error) {
    logger.error('Failed to cache emails', { error: (error as Error).message, connectionId });
    throw error;
  }
}

/**
 * Disconnect email
 */
export async function disconnectEmail(userId: string, connectionId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE email_connections SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to disconnect email', { error: (error as Error).message, userId });
    return false;
  }
}

/**
 * Get email summary for user
 */
export async function getEmailSummary(userId: string): Promise<{
  unreadCount: number;
  importantCount: number;
  recentSenders: string[];
}> {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE NOT ec.is_read) as unread_count,
         COUNT(*) FILTER (WHERE ec.is_important AND NOT ec.is_read) as important_count
       FROM email_cache ec
       JOIN email_connections econ ON econ.id = ec.connection_id
       WHERE econ.user_id = $1 AND econ.is_active = true
         AND ec.received_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    const sendersResult = await pool.query(
      `SELECT DISTINCT ec.from_address
       FROM email_cache ec
       JOIN email_connections econ ON econ.id = ec.connection_id
       WHERE econ.user_id = $1 AND econ.is_active = true
         AND ec.received_at > NOW() - INTERVAL '24 hours'
       ORDER BY ec.from_address
       LIMIT 5`,
      [userId]
    );

    return {
      unreadCount: parseInt(result.rows[0]?.unread_count || '0', 10),
      importantCount: parseInt(result.rows[0]?.important_count || '0', 10),
      recentSenders: sendersResult.rows.map((r: Record<string, unknown>) => r.from_address as string),
    };
  } catch (error) {
    logger.error('Failed to get email summary', { error: (error as Error).message, userId });
    return { unreadCount: 0, importantCount: 0, recentSenders: [] };
  }
}

/**
 * Format emails for prompt
 */
export function formatEmailsForPrompt(emails: Email[]): string {
  if (emails.length === 0) return '';

  const formatted = emails.slice(0, 5).map(email => {
    const date = new Date(email.receivedAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const unread = email.isRead ? '' : ' [UNREAD]';
    const important = email.isImportant ? ' [!]' : '';

    let entry = `• ${email.subject || '(no subject)'}${unread}${important}`;
    entry += `\n  From: ${email.fromAddress} - ${dateStr}`;
    if (email.snippet) {
      entry += `\n  "${email.snippet.slice(0, 100)}${email.snippet.length > 100 ? '...' : ''}"`;
    }
    return entry;
  }).join('\n\n');

  return `[Recent Emails]\n${formatted}`;
}

function mapRowToConnection(row: Record<string, unknown>): EmailConnection {
  return {
    id: row.id as string,
    provider: row.provider as 'gmail' | 'outlook' | 'imap',
    emailAddress: row.email_address as string,
    isActive: row.is_active as boolean,
    lastSyncAt: row.last_sync_at as Date | undefined,
    createdAt: row.created_at as Date,
  };
}

function mapRowToEmail(row: Record<string, unknown>): Email {
  return {
    id: row.id as string,
    externalId: row.external_id as string,
    threadId: row.thread_id as string | undefined,
    subject: row.subject as string | undefined,
    fromAddress: row.from_address as string,
    toAddresses: (row.to_addresses as string[]) || [],
    snippet: row.snippet as string | undefined,
    bodyPreview: row.body_preview as string | undefined,
    receivedAt: row.received_at as Date,
    isRead: row.is_read as boolean,
    isImportant: row.is_important as boolean,
    labels: (row.labels as string[]) || [],
  };
}

// ============================================
// Luna's Local Email
// ============================================

/**
 * Send an email from Luna's account
 * Only sends to approved recipients
 */
export async function sendLunaEmail(
  to: string[],
  subject: string,
  body: string,
  options?: { cc?: string[]; html?: string; inReplyTo?: string }
): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  blockedRecipients?: string[];
}> {
  return localEmail.sendEmail({
    to,
    subject,
    body,
    cc: options?.cc,
    html: options?.html,
    inReplyTo: options?.inReplyTo,
    from: '', // Uses config default
  });
}

/**
 * Check Luna's inbox for new messages
 */
export async function checkLunaInbox(limit: number = 10): Promise<localEmail.EmailMessage[]> {
  return localEmail.fetchRecentEmails(limit);
}

/**
 * Get unread emails in Luna's inbox
 */
export async function getLunaUnreadEmails(): Promise<localEmail.EmailMessage[]> {
  return localEmail.fetchUnreadEmails();
}

/**
 * Check if a recipient is approved for Luna to email
 */
export function canLunaEmailRecipient(email: string): boolean {
  return localEmail.isRecipientApproved(email);
}

/**
 * Get Luna's email status
 */
export async function getLunaEmailStatus(): Promise<{
  enabled: boolean;
  smtp: { configured: boolean; connected: boolean };
  imap: { configured: boolean; connected: boolean };
  approvedRecipients: string[];
}> {
  return localEmail.getEmailStatus();
}

/**
 * Format Luna's inbox for prompt
 */
export function formatLunaInboxForPrompt(emails: localEmail.EmailMessage[]): string {
  if (emails.length === 0) return '';

  const formatted = emails.slice(0, 5).map(email => {
    const date = email.date ? new Date(email.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'unknown';
    let entry = `- ${email.subject}`;
    if (email.uid) {
      entry += ` (UID: ${email.uid})`;
    }
    entry += `\n  From: ${email.from} - ${date}`;
    if (email.read !== undefined) {
      entry += ` - ${email.read ? 'Read' : 'Unread'}`;
    }
    if (email.body) {
      const preview = email.body.slice(0, 150).replace(/\n/g, ' ');
      entry += `\n  "${preview}${email.body.length > 150 ? '...' : ''}"`;
    }
    return entry;
  }).join('\n\n');

  return `[Luna's Inbox - ${config.email.imap.user}]\n${formatted}`;
}

/**
 * Fetch a single email by UID
 */
export async function fetchEmailByUid(uid: number): Promise<localEmail.EmailMessage | null> {
  return localEmail.fetchEmailByUid(uid);
}

/**
 * Delete an email by UID
 */
export async function deleteEmail(uid: number): Promise<boolean> {
  return localEmail.deleteEmail(uid);
}

/**
 * Mark an email as read or unread
 */
export async function markEmailRead(uid: number, isRead: boolean): Promise<boolean> {
  return localEmail.markEmailRead(uid, isRead);
}

/**
 * Reply to an email
 */
export async function replyToEmail(
  originalUid: number,
  replyBody: string
): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  blockedRecipients?: string[];
}> {
  return localEmail.replyToEmail(originalUid, replyBody);
}

// ============================================
// Gated Email Functions (Mail-Luna Gatekeeper)
// ============================================

/**
 * Get unread emails, gated through the security gatekeeper.
 * When gatekeeper is disabled, wraps emails with minimal untrusted framing.
 */
export async function getLunaUnreadEmailsGated(): Promise<{
  emails: SanitizedEmail[];
  quarantinedCount: number;
}> {
  const raw = await localEmail.fetchUnreadEmails();

  if (!config.email.gatekeeper?.enabled) {
    // Bypass: wrap minimally
    return {
      emails: raw.map(e => bypassSanitize(e)),
      quarantinedCount: 0,
    };
  }

  const { passed, quarantinedCount } = await gatekeeper.sanitizeEmailBatch(raw);
  return { emails: passed, quarantinedCount };
}

/**
 * Check inbox (recent emails), gated through the security gatekeeper.
 */
export async function checkLunaInboxGated(limit: number = 10): Promise<{
  emails: SanitizedEmail[];
  quarantinedCount: number;
}> {
  const raw = await localEmail.fetchRecentEmails(limit);

  if (!config.email.gatekeeper?.enabled) {
    return {
      emails: raw.map(e => bypassSanitize(e)),
      quarantinedCount: 0,
    };
  }

  const { passed, quarantinedCount } = await gatekeeper.sanitizeEmailBatch(raw);
  return { emails: passed, quarantinedCount };
}

/**
 * Fetch single email by UID, gated through the security gatekeeper.
 * Returns null if quarantined or not found.
 */
export async function fetchEmailByUidGated(uid: number): Promise<SanitizedEmail | null> {
  const raw = await localEmail.fetchEmailByUid(uid);
  if (!raw) return null;

  if (!config.email.gatekeeper?.enabled) {
    return bypassSanitize(raw);
  }

  return gatekeeper.sanitizeEmail(raw);
}

/**
 * Format gated inbox for LLM prompt
 */
export function formatGatedInboxForPrompt(
  emails: SanitizedEmail[],
  quarantinedCount: number
): string {
  return gatekeeper.formatSanitizedInboxForPrompt(emails, quarantinedCount);
}

/**
 * Format single gated email for LLM prompt
 */
export function formatGatedEmailForPrompt(email: SanitizedEmail): string {
  return gatekeeper.formatSanitizedEmailForPrompt(email);
}

/**
 * Bypass sanitization - minimal wrapping when gatekeeper is disabled
 */
function bypassSanitize(email: localEmail.EmailMessage): SanitizedEmail {
  return {
    uid: email.uid,
    from: email.from,
    subject: email.subject,
    date: email.date,
    read: email.read,
    classification: {
      category: 'unknown',
      senderTrust: 'unknown',
      containsActionRequest: false,
      riskScore: 0,
      safeToForward: true,
      flags: [],
      processingTimeMs: 0,
    },
    content: email.body || '',
    attachmentSummary: email.attachments?.map(a => `${a.filename} (${a.contentType})`).join(', ') || '',
  };
}

export { SanitizedEmail };

export default {
  storeEmailConnection,
  getEmailConnections,
  getRecentEmails,
  searchEmails,
  syncEmails,
  cacheEmails,
  disconnectEmail,
  getEmailSummary,
  formatEmailsForPrompt,
  // Luna's local email
  sendLunaEmail,
  checkLunaInbox,
  getLunaUnreadEmails,
  canLunaEmailRecipient,
  getLunaEmailStatus,
  formatLunaInboxForPrompt,
  fetchEmailByUid,
  deleteEmail,
  markEmailRead,
  replyToEmail,
  // Gated functions
  getLunaUnreadEmailsGated,
  checkLunaInboxGated,
  fetchEmailByUidGated,
  formatGatedInboxForPrompt,
  formatGatedEmailForPrompt,
};
