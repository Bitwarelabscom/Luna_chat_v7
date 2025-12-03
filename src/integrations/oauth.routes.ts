import { Router, Request, Response, NextFunction } from 'express';
import * as oauthService from './oauth.service.js';
import { authenticate } from '../auth/auth.middleware.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate as unknown as (req: Request, res: Response, next: NextFunction) => void);

/**
 * GET /api/integrations/oauth/:provider/auth
 * Start OAuth flow for a provider
 */
router.get('/:provider/auth', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { user: { userId: string } }).user.userId;
    const provider = req.params.provider as 'google' | 'microsoft';

    if (!['google', 'microsoft'].includes(provider)) {
      res.status(400).json({ error: 'Invalid provider' });
      return;
    }

    const scopes = (req.query.scopes as string)?.split(',') || ['calendar', 'email'];
    const { url, stateToken } = await oauthService.generateAuthUrl(userId, provider, scopes);

    // Return URL for frontend to redirect
    res.json({ authUrl: url, stateToken });
  } catch (error) {
    logger.error('Failed to generate auth URL', {
      error: (error as Error).message
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/integrations/oauth/:provider/callback
 * Handle OAuth callback from provider
 */
router.get('/:provider/callback', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as 'google' | 'microsoft';
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      logger.warn('OAuth denied', { provider, error: oauthError });
      // Redirect to frontend with error
      res.redirect(`/settings/integrations?error=${encodeURIComponent(oauthError as string)}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state' });
      return;
    }

    const result = await oauthService.handleCallback(
      provider,
      code as string,
      state as string
    );

    logger.info('OAuth completed', {
      userId: result.userId,
      provider,
      email: result.email
    });

    // Redirect to success page
    res.redirect('/settings/integrations?success=true');
  } catch (error) {
    logger.error('OAuth callback failed', {
      error: (error as Error).message,
      provider: req.params.provider
    });
    res.redirect(`/settings/integrations?error=${encodeURIComponent((error as Error).message)}`);
  }
});

/**
 * DELETE /api/integrations/oauth/:provider
 * Revoke access and disconnect provider
 */
router.delete('/:provider', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { user: { userId: string } }).user.userId;
    const provider = req.params.provider as 'google' | 'microsoft';

    if (!['google', 'microsoft'].includes(provider)) {
      res.status(400).json({ error: 'Invalid provider' });
      return;
    }

    await oauthService.revokeAccess(userId, provider);
    res.json({ message: `${provider} disconnected successfully` });
  } catch (error) {
    logger.error('Failed to revoke access', {
      error: (error as Error).message
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/integrations/status
 * Get integration status for current user
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { user: { userId: string } }).user.userId;
    const status = await oauthService.getIntegrationStatus(userId);
    res.json({ integrations: status });
  } catch (error) {
    logger.error('Failed to get integration status', {
      error: (error as Error).message
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
