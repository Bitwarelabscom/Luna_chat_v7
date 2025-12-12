import { Router, Request, Response, NextFunction } from 'express';
import * as emailService from './local-email.service.js';
import { authenticate } from '../auth/auth.middleware.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate as unknown as (req: Request, res: Response, next: NextFunction) => void);

/**
 * POST /api/email/send
 * Send an email (Luna's ability to send emails)
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, cc, subject, body, html, inReplyTo } = req.body;

    if (!to || !Array.isArray(to) || to.length === 0) {
      res.status(400).json({ error: 'Recipients (to) are required' });
      return;
    }

    if (!subject || !body) {
      res.status(400).json({ error: 'Subject and body are required' });
      return;
    }

    const result = await emailService.sendEmail({
      to,
      cc,
      subject,
      body,
      html,
      inReplyTo,
      from: '', // Will use default from config
    });

    if (result.success) {
      res.json({
        message: 'Email sent successfully',
        messageId: result.messageId,
        blockedRecipients: result.blockedRecipients,
      });
    } else {
      res.status(400).json({
        error: result.error,
        blockedRecipients: result.blockedRecipients,
      });
    }
  } catch (error) {
    logger.error('Failed to send email', {
      error: (error as Error).message,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/email/inbox
 * Fetch recent emails from inbox
 */
router.get('/inbox', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const emails = await emailService.fetchRecentEmails(limit);

    res.json({ emails });
  } catch (error) {
    logger.error('Failed to fetch inbox', {
      error: (error as Error).message,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/email/unread
 * Fetch unread emails
 */
router.get('/unread', async (_req: Request, res: Response) => {
  try {
    const emails = await emailService.fetchUnreadEmails();

    res.json({
      count: emails.length,
      emails,
    });
  } catch (error) {
    logger.error('Failed to fetch unread emails', {
      error: (error as Error).message,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/email/status
 * Get email service status
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await emailService.getEmailStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get email status', {
      error: (error as Error).message,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/email/approved-recipients
 * Get list of approved recipients
 */
router.get('/approved-recipients', (_req: Request, res: Response): void => {
  const recipients = emailService.getApprovedRecipients();
  res.json({ approvedRecipients: recipients });
});

/**
 * POST /api/email/validate-recipient
 * Check if a recipient is approved
 */
router.post('/validate-recipient', (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const approved = emailService.isRecipientApproved(email);
  res.json({ email, approved });
});

/**
 * GET /api/email/:uid
 * Get full email content by UID
 */
router.get('/:uid', async (req: Request, res: Response) => {
  try {
    const uid = parseInt(req.params.uid, 10);

    if (isNaN(uid)) {
      res.status(400).json({ error: 'Invalid UID' });
      return;
    }

    const email = await emailService.fetchEmailByUid(uid);

    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    res.json({ email });
  } catch (error) {
    logger.error('Failed to fetch email by UID', {
      error: (error as Error).message,
      uid: req.params.uid,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/email/:uid
 * Delete an email by UID
 */
router.delete('/:uid', async (req: Request, res: Response) => {
  try {
    const uid = parseInt(req.params.uid, 10);

    if (isNaN(uid)) {
      res.status(400).json({ error: 'Invalid UID' });
      return;
    }

    const success = await emailService.deleteEmail(uid);

    if (success) {
      res.json({ message: 'Email deleted successfully', uid });
    } else {
      res.status(500).json({ error: 'Failed to delete email' });
    }
  } catch (error) {
    logger.error('Failed to delete email', {
      error: (error as Error).message,
      uid: req.params.uid,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/email/:uid/read
 * Mark an email as read or unread
 */
router.put('/:uid/read', async (req: Request, res: Response) => {
  try {
    const uid = parseInt(req.params.uid, 10);
    const { isRead } = req.body;

    if (isNaN(uid)) {
      res.status(400).json({ error: 'Invalid UID' });
      return;
    }

    if (typeof isRead !== 'boolean') {
      res.status(400).json({ error: 'isRead must be a boolean' });
      return;
    }

    const success = await emailService.markEmailRead(uid, isRead);

    if (success) {
      res.json({ message: `Email marked as ${isRead ? 'read' : 'unread'}`, uid, isRead });
    } else {
      res.status(500).json({ error: 'Failed to update email read status' });
    }
  } catch (error) {
    logger.error('Failed to mark email as read', {
      error: (error as Error).message,
      uid: req.params.uid,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/email/:uid/reply
 * Reply to an email
 */
router.post('/:uid/reply', async (req: Request, res: Response) => {
  try {
    const uid = parseInt(req.params.uid, 10);
    const { body } = req.body;

    if (isNaN(uid)) {
      res.status(400).json({ error: 'Invalid UID' });
      return;
    }

    if (!body || typeof body !== 'string') {
      res.status(400).json({ error: 'Reply body is required' });
      return;
    }

    const result = await emailService.replyToEmail(uid, body);

    if (result.success) {
      res.json({
        message: 'Reply sent successfully',
        messageId: result.messageId,
      });
    } else {
      res.status(400).json({
        error: result.error,
        blockedRecipients: result.blockedRecipients,
      });
    }
  } catch (error) {
    logger.error('Failed to send reply', {
      error: (error as Error).message,
      uid: req.params.uid,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
