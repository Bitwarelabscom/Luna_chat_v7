import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser, ParsedMail, Source } from 'mailparser';
import { config } from '../config/index.js';
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface EmailMessage {
  id?: string;
  uid?: number;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: string;
  date?: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  read?: boolean;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  blockedRecipients?: string[];
}

// ============================================
// Email Validation
// ============================================

// RFC 5322 compliant email regex (simplified but robust)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email address format
 */
export function isValidEmailFormat(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }
  return EMAIL_REGEX.test(email.trim());
}

// ============================================
// SMTP Transport (Sending)
// ============================================

let smtpTransport: nodemailer.Transporter | null = null;

function getSmtpTransport(): nodemailer.Transporter {
  if (!smtpTransport) {
    // In production, enforce TLS certificate validation
    const isProduction = process.env.NODE_ENV === 'production';
    const transportConfig = {
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: false, // Explicit: never use implicit TLS (port 465 style)
      requireTLS: true, // Use STARTTLS after greeting
      auth: config.email.smtp.password ? {
        user: config.email.smtp.user,
        pass: config.email.smtp.password,
      } : undefined,
      tls: {
        rejectUnauthorized: isProduction, // Enforce in production, allow self-signed in dev
        minVersion: 'TLSv1.2' as const,
      },
      logger: !isProduction, // Only log in non-production
      debug: !isProduction,
    };
    logger.info('Creating SMTP transport', {
      host: transportConfig.host,
      port: transportConfig.port,
      secure: transportConfig.secure,
      requireTLS: transportConfig.requireTLS,
      rejectUnauthorized: transportConfig.tls.rejectUnauthorized,
    });
    smtpTransport = nodemailer.createTransport(transportConfig);
  }
  return smtpTransport;
}

// ============================================
// Recipient Validation
// ============================================

/**
 * Get list of approved recipients
 */
export function getApprovedRecipients(): string[] {
  return config.email.approvedRecipients;
}

/**
 * Check if an email address is approved for sending
 */
export function isRecipientApproved(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  const approved = config.email.approvedRecipients;

  // If no approved list is configured, block all
  if (approved.length === 0) {
    logger.warn('No approved recipients configured - blocking all sends');
    return false;
  }

  return approved.some(approvedEmail => {
    const normalized = approvedEmail.toLowerCase().trim();
    // Support wildcards like *@domain.com
    if (normalized.startsWith('*@')) {
      const domain = normalized.slice(2);
      return normalizedEmail.endsWith(`@${domain}`);
    }
    return normalizedEmail === normalized;
  });
}

/**
 * Filter recipients to only approved ones
 */
export function filterApprovedRecipients(recipients: string[]): {
  approved: string[];
  blocked: string[];
} {
  const approved: string[] = [];
  const blocked: string[] = [];

  for (const recipient of recipients) {
    if (isRecipientApproved(recipient)) {
      approved.push(recipient);
    } else {
      blocked.push(recipient);
    }
  }

  return { approved, blocked };
}

// ============================================
// Send Email
// ============================================

/**
 * Send an email (only to approved recipients)
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!config.email.enabled) {
    return { success: false, error: 'Email is disabled' };
  }

  // Validate email format for all recipients
  const invalidEmails = message.to.filter(email => !isValidEmailFormat(email));
  if (invalidEmails.length > 0) {
    logger.warn('Invalid email format detected', { invalidEmails });
    return {
      success: false,
      error: `Invalid email format: ${invalidEmails.join(', ')}`,
      blockedRecipients: invalidEmails,
    };
  }

  // Filter recipients
  const { approved, blocked } = filterApprovedRecipients(message.to);

  if (approved.length === 0) {
    logger.warn('All recipients blocked', {
      attempted: message.to,
      blocked,
    });
    return {
      success: false,
      error: 'All recipients are not in the approved list',
      blockedRecipients: blocked,
    };
  }

  if (blocked.length > 0) {
    logger.warn('Some recipients blocked', {
      approved,
      blocked,
    });
  }

  try {
    const transport = getSmtpTransport();

    const result = await transport.sendMail({
      from: config.email.from,
      to: approved.join(', '),
      cc: message.cc?.filter(cc => isRecipientApproved(cc)),
      subject: message.subject,
      text: message.body,
      html: message.html,
      inReplyTo: message.inReplyTo,
    });

    logger.info('Email sent', {
      messageId: result.messageId,
      to: approved,
      subject: message.subject,
    });

    // Log to database
    await logEmailEvent('sent', {
      messageId: result.messageId,
      to: approved,
      subject: message.subject,
      blockedRecipients: blocked.length > 0 ? blocked : undefined,
    });

    return {
      success: true,
      messageId: result.messageId,
      blockedRecipients: blocked.length > 0 ? blocked : undefined,
    };
  } catch (error) {
    logger.error('Failed to send email', {
      error: (error as Error).message,
      to: approved,
    });
    return {
      success: false,
      error: (error as Error).message,
      blockedRecipients: blocked,
    };
  }
}

// ============================================
// IMAP (Receiving)
// ============================================

/**
 * Fetch recent emails from inbox with timeout
 */
async function fetchRecentEmailsInternal(limit: number): Promise<EmailMessage[]> {
  const isProduction = process.env.NODE_ENV === 'production';
  const imapConfig: Imap.Config = {
    user: config.email.imap.user,
    password: config.email.imap.password || '',
    host: config.email.imap.host,
    port: config.email.imap.port,
    tls: config.email.imap.secure,
    tlsOptions: { rejectUnauthorized: isProduction },
    connTimeout: 10000,
    authTimeout: 10000,
  };

  const imap = new Imap(imapConfig);
  const emails: EmailMessage[] = [];

  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        logger.info('IMAP fetch complete', { emailCount: emails.length });
        try { imap.end(); } catch (_e) { /* ignore */ }
        resolve(emails);
      }
    };

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, _box) => {
        if (err) {
          if (!resolved) { resolved = true; reject(err); }
          try { imap.end(); } catch (_e) { /* ignore */ }
          return;
        }

        imap.search(['ALL'], (err, results) => {
          if (err) {
            if (!resolved) { resolved = true; reject(err); }
            try { imap.end(); } catch (_e) { /* ignore */ }
            return;
          }

          if (results.length === 0) {
            done();
            return;
          }

          const toFetch = results.slice(-limit);
          let pending = toFetch.length;
          const fetch = imap.fetch(toFetch, { bodies: '', struct: true });

          fetch.on('message', (msg) => {
            let attrs: { uid?: number; flags?: string[] } = {};

            msg.on('attributes', (a) => {
              attrs = a;
            });

            msg.on('body', (stream) => {
              simpleParser(stream as unknown as Source, (err, parsed) => {
                if (!err) {
                  emails.push({
                    ...parsedMailToEmailMessage(parsed),
                    uid: attrs.uid,
                    read: attrs.flags?.includes('\\Seen') || false,
                  });
                }
                pending--;
                if (pending === 0) {
                  done();
                }
              });
            });
          });

          fetch.once('error', (err) => {
            logger.error('Fetch error', { error: err.message });
            done();
          });

          fetch.once('end', () => {
            // If no bodies received, done
            if (pending === 0) {
              done();
            }
          });
        });
      });
    });

    imap.once('error', (err: Error) => {
      logger.error('IMAP error', { error: err.message });
      if (!resolved) { resolved = true; reject(err); }
    });

    imap.connect();
  });
}

export async function fetchRecentEmails(limit: number = 10): Promise<EmailMessage[]> {
  if (!config.email.enabled) {
    return [];
  }

  // Race between fetch and timeout
  const timeoutPromise = new Promise<EmailMessage[]>((resolve) => {
    setTimeout(() => {
      logger.warn('IMAP fetch timeout after 15 seconds');
      resolve([]);
    }, 15000);
  });

  try {
    return await Promise.race([
      fetchRecentEmailsInternal(limit),
      timeoutPromise
    ]);
  } catch (error) {
    logger.error('fetchRecentEmails failed', { error: (error as Error).message });
    return [];
  }
}

/**
 * Fetch unread emails with timeout
 */
async function fetchUnreadEmailsInternal(): Promise<EmailMessage[]> {
  const isProduction = process.env.NODE_ENV === 'production';
  const imapConfig: Imap.Config = {
    user: config.email.imap.user,
    password: config.email.imap.password || '',
    host: config.email.imap.host,
    port: config.email.imap.port,
    tls: config.email.imap.secure,
    tlsOptions: { rejectUnauthorized: isProduction },
    connTimeout: 10000,
    authTimeout: 10000,
  };

  const imap = new Imap(imapConfig);
  const emails: EmailMessage[] = [];

  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        logger.info('IMAP unread fetch complete', { emailCount: emails.length });
        try { imap.end(); } catch (_e) { /* ignore */ }
        resolve(emails);
      }
    };

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, _box) => {
        if (err) {
          if (!resolved) { resolved = true; reject(err); }
          try { imap.end(); } catch (_e) { /* ignore */ }
          return;
        }

        imap.search(['UNSEEN'], (err, results) => {
          if (err) {
            if (!resolved) { resolved = true; reject(err); }
            try { imap.end(); } catch (_e) { /* ignore */ }
            return;
          }

          if (results.length === 0) {
            done();
            return;
          }

          let pending = results.length;
          const fetch = imap.fetch(results, { bodies: '', markSeen: false, struct: true });

          fetch.on('message', (msg) => {
            let attrs: { uid?: number; flags?: string[] } = {};

            msg.on('attributes', (a) => {
              attrs = a;
            });

            msg.on('body', (stream) => {
              simpleParser(stream as unknown as Source, (err, parsed) => {
                if (!err) {
                  emails.push({
                    ...parsedMailToEmailMessage(parsed),
                    uid: attrs.uid,
                    read: false, // These are unread emails
                  });
                }
                pending--;
                if (pending === 0) {
                  done();
                }
              });
            });
          });

          fetch.once('error', (err) => {
            logger.error('Fetch error', { error: err.message });
            done();
          });

          fetch.once('end', () => {
            if (pending === 0) {
              done();
            }
          });
        });
      });
    });

    imap.once('error', (err: Error) => {
      logger.error('IMAP error', { error: err.message });
      if (!resolved) { resolved = true; reject(err); }
    });

    imap.connect();
  });
}

export async function fetchUnreadEmails(): Promise<EmailMessage[]> {
  if (!config.email.enabled) {
    return [];
  }

  const timeoutPromise = new Promise<EmailMessage[]>((resolve) => {
    setTimeout(() => {
      logger.warn('IMAP unread fetch timeout after 15 seconds');
      resolve([]);
    }, 15000);
  });

  try {
    return await Promise.race([
      fetchUnreadEmailsInternal(),
      timeoutPromise
    ]);
  } catch (error) {
    logger.error('fetchUnreadEmails failed', { error: (error as Error).message });
    return [];
  }
}

/**
 * Convert parsed mail to our EmailMessage format
 */
function parsedMailToEmailMessage(parsed: ParsedMail): EmailMessage {
  return {
    messageId: parsed.messageId,
    from: parsed.from?.text || 'unknown',
    to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text) : [parsed.to.text]) : [],
    cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(c => c.text) : [parsed.cc.text]) : undefined,
    subject: parsed.subject || '(no subject)',
    body: parsed.text || '',
    html: parsed.html || undefined,
    date: parsed.date,
    inReplyTo: parsed.inReplyTo,
    attachments: parsed.attachments?.map(att => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType,
      size: att.size,
    })),
  };
}

// ============================================
// Email Health Check
// ============================================

/**
 * Test SMTP connection
 */
export async function testSmtpConnection(): Promise<boolean> {
  if (!config.email.enabled) {
    return false;
  }

  try {
    const transport = getSmtpTransport();
    await transport.verify();
    return true;
  } catch (error) {
    logger.error('SMTP connection test failed', {
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Test IMAP connection
 */
export async function testImapConnection(): Promise<boolean> {
  if (!config.email.enabled) {
    return false;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  return new Promise((resolve) => {
    const imapConfig: Imap.Config = {
      user: config.email.imap.user,
      password: config.email.imap.password || '',
      host: config.email.imap.host,
      port: config.email.imap.port,
      tls: config.email.imap.secure,
      tlsOptions: { rejectUnauthorized: isProduction },
    };

    const imap = new Imap(imapConfig);

    imap.once('ready', () => {
      imap.end();
      resolve(true);
    });

    imap.once('error', (err: Error) => {
      logger.error('IMAP connection test failed', { error: err.message });
      resolve(false);
    });

    imap.connect();
  });
}

// ============================================
// Email Logging
// ============================================

async function logEmailEvent(
  eventType: 'sent' | 'received' | 'failed',
  details: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO integration_events (provider, event_type, event_data)
      VALUES ('local_email', $1, $2)
    `, [eventType, JSON.stringify(details)]);
  } catch (error) {
    logger.error('Failed to log email event', {
      error: (error as Error).message,
    });
  }
}

// ============================================
// Email Status
// ============================================

export async function getEmailStatus(): Promise<{
  enabled: boolean;
  smtp: { configured: boolean; connected: boolean };
  imap: { configured: boolean; connected: boolean };
  approvedRecipients: string[];
}> {
  const smtpConnected = await testSmtpConnection();
  const imapConnected = await testImapConnection();

  return {
    enabled: config.email.enabled,
    smtp: {
      configured: !!config.email.smtp.host,
      connected: smtpConnected,
    },
    imap: {
      configured: !!config.email.imap.host,
      connected: imapConnected,
    },
    approvedRecipients: config.email.approvedRecipients,
  };
}

// ============================================
// Fetch Email by UID
// ============================================

/**
 * Fetch a single email by its UID
 */
export async function fetchEmailByUid(uid: number): Promise<EmailMessage | null> {
  if (!config.email.enabled) {
    return null;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const imapConfig: Imap.Config = {
    user: config.email.imap.user,
    password: config.email.imap.password || '',
    host: config.email.imap.host,
    port: config.email.imap.port,
    tls: config.email.imap.secure,
    tlsOptions: { rejectUnauthorized: isProduction },
    connTimeout: 10000,
    authTimeout: 10000,
  };

  const imap = new Imap(imapConfig);

  return new Promise((resolve, reject) => {
    let resolved = false;
    let email: EmailMessage | null = null;

    const done = () => {
      if (!resolved) {
        resolved = true;
        try { imap.end(); } catch (_e) { /* ignore */ }
        resolve(email);
      }
    };

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, _box) => {
        if (err) {
          if (!resolved) { resolved = true; reject(err); }
          try { imap.end(); } catch (_e) { /* ignore */ }
          return;
        }

        const fetch = imap.fetch([uid], {
          bodies: '',
          struct: true,
          markSeen: false,
        });

        fetch.on('message', (msg) => {
          let attrs: { uid?: number; flags?: string[] } = {};

          msg.on('attributes', (a) => {
            attrs = a;
          });

          msg.on('body', (stream) => {
            simpleParser(stream as unknown as Source, (err, parsed) => {
              if (!err) {
                email = {
                  ...parsedMailToEmailMessage(parsed),
                  uid: attrs.uid,
                  read: attrs.flags?.includes('\\Seen') || false,
                };
              }
              done();
            });
          });
        });

        fetch.once('error', (err) => {
          logger.error('Fetch by UID error', { error: err.message, uid });
          done();
        });

        fetch.once('end', () => {
          setTimeout(done, 100);
        });
      });
    });

    imap.once('error', (err: Error) => {
      logger.error('IMAP error', { error: err.message });
      if (!resolved) { resolved = true; reject(err); }
    });

    imap.connect();
  });
}

// ============================================
// Delete Email by UID
// ============================================

/**
 * Delete an email by its UID
 */
export async function deleteEmail(uid: number): Promise<boolean> {
  if (!config.email.enabled) {
    return false;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const imapConfig: Imap.Config = {
    user: config.email.imap.user,
    password: config.email.imap.password || '',
    host: config.email.imap.host,
    port: config.email.imap.port,
    tls: config.email.imap.secure,
    tlsOptions: { rejectUnauthorized: isProduction },
    connTimeout: 10000,
    authTimeout: 10000,
  };

  const imap = new Imap(imapConfig);

  return new Promise((resolve, reject) => {
    let resolved = false;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, _box) => {
        if (err) {
          if (!resolved) { resolved = true; reject(err); }
          try { imap.end(); } catch (_e) { /* ignore */ }
          return;
        }

        // Add \Deleted flag
        imap.addFlags(uid, ['\\Deleted'], (err) => {
          if (err) {
            logger.error('Failed to mark email as deleted', { error: err.message, uid });
            if (!resolved) { resolved = true; resolve(false); }
            try { imap.end(); } catch (_e) { /* ignore */ }
            return;
          }

          // Expunge to permanently delete
          imap.expunge((err) => {
            if (err) {
              logger.error('Failed to expunge email', { error: err.message, uid });
            }
            if (!resolved) {
              resolved = true;
              logger.info('Email deleted', { uid });
              resolve(!err);
            }
            try { imap.end(); } catch (_e) { /* ignore */ }
          });
        });
      });
    });

    imap.once('error', (err: Error) => {
      logger.error('IMAP error during delete', { error: err.message, uid });
      if (!resolved) { resolved = true; resolve(false); }
    });

    imap.connect();
  });
}

// ============================================
// Mark Email as Read/Unread
// ============================================

/**
 * Mark an email as read or unread by its UID
 */
export async function markEmailRead(uid: number, isRead: boolean): Promise<boolean> {
  if (!config.email.enabled) {
    return false;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const imapConfig: Imap.Config = {
    user: config.email.imap.user,
    password: config.email.imap.password || '',
    host: config.email.imap.host,
    port: config.email.imap.port,
    tls: config.email.imap.secure,
    tlsOptions: { rejectUnauthorized: isProduction },
    connTimeout: 10000,
    authTimeout: 10000,
  };

  const imap = new Imap(imapConfig);

  return new Promise((resolve, reject) => {
    let resolved = false;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, _box) => {
        if (err) {
          if (!resolved) { resolved = true; reject(err); }
          try { imap.end(); } catch (_e) { /* ignore */ }
          return;
        }

        const flagOperation = isRead ? imap.addFlags.bind(imap) : imap.delFlags.bind(imap);

        flagOperation(uid, ['\\Seen'], (err: Error | null) => {
          if (err) {
            logger.error('Failed to update read status', { error: err.message, uid, isRead });
            if (!resolved) { resolved = true; resolve(false); }
          } else {
            logger.info('Email read status updated', { uid, isRead });
            if (!resolved) { resolved = true; resolve(true); }
          }
          try { imap.end(); } catch (_e) { /* ignore */ }
        });
      });
    });

    imap.once('error', (err: Error) => {
      logger.error('IMAP error during mark read', { error: err.message, uid });
      if (!resolved) { resolved = true; resolve(false); }
    });

    imap.connect();
  });
}

// ============================================
// Reply to Email
// ============================================

/**
 * Reply to an email with proper threading headers
 */
export async function replyToEmail(
  originalUid: number,
  replyBody: string
): Promise<SendResult> {
  if (!config.email.enabled) {
    return { success: false, error: 'Email is disabled' };
  }

  // First fetch the original email to get headers for threading
  const original = await fetchEmailByUid(originalUid);

  if (!original) {
    return { success: false, error: 'Original email not found' };
  }

  // Parse the sender's email address for reply
  const fromMatch = original.from.match(/<([^>]+)>/);
  const replyTo = fromMatch ? fromMatch[1] : original.from;

  // Build references header for proper threading
  const references: string[] = [];
  if (original.references) {
    references.push(...original.references);
  }
  if (original.inReplyTo) {
    references.push(original.inReplyTo);
  }
  if (original.messageId && !references.includes(original.messageId)) {
    references.push(original.messageId);
  }

  // Create reply subject
  const replySubject = original.subject.startsWith('Re:')
    ? original.subject
    : `Re: ${original.subject}`;

  try {
    const transport = getSmtpTransport();

    // Check if recipient is approved
    if (!isRecipientApproved(replyTo)) {
      logger.warn('Reply recipient not approved', { replyTo });
      return {
        success: false,
        error: `Recipient ${replyTo} is not in the approved list`,
        blockedRecipients: [replyTo],
      };
    }

    const result = await transport.sendMail({
      from: config.email.from,
      to: replyTo,
      subject: replySubject,
      text: replyBody,
      inReplyTo: original.messageId,
      references: references.length > 0 ? references.join(' ') : undefined,
    });

    logger.info('Reply sent', {
      messageId: result.messageId,
      to: replyTo,
      inReplyTo: original.messageId,
    });

    await logEmailEvent('sent', {
      messageId: result.messageId,
      to: [replyTo],
      subject: replySubject,
      isReply: true,
      originalUid,
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    logger.error('Failed to send reply', {
      error: (error as Error).message,
      originalUid,
    });
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

export default {
  sendEmail,
  fetchRecentEmails,
  fetchUnreadEmails,
  fetchEmailByUid,
  deleteEmail,
  markEmailRead,
  replyToEmail,
  getApprovedRecipients,
  isRecipientApproved,
  isValidEmailFormat,
  filterApprovedRecipients,
  testSmtpConnection,
  testImapConnection,
  getEmailStatus,
};
