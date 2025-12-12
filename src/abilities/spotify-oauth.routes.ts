/**
 * Public Spotify OAuth Routes
 *
 * These routes handle OAuth callbacks and don't require authentication
 * because they're accessed via browser redirect from Spotify.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config/index.js';
import * as spotifyOAuth from './spotify-oauth.js';
import logger from '../utils/logger.js';

const router = Router();

// Frontend URL for redirects (frontend is served at /luna-chat/ path)
const FRONTEND_URL = process.env.FRONTEND_URL || `${config.oauth.callbackBaseUrl}/luna-chat`;

// Spotify OAuth callback (handles redirect from Spotify) - NO AUTH REQUIRED
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.warn(`Spotify auth denied: ${error}`);
      // Redirect to frontend with error
      res.redirect(`${FRONTEND_URL}/chat?spotify_error=${error}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    const { userId, profile } = await spotifyOAuth.handleSpotifyCallback(
      code as string,
      state as string
    );

    logger.info(`Spotify connected for user ${userId}: ${profile.displayName} (${profile.id})`);

    // Redirect to frontend chat with success (popup will close)
    res.redirect(`${FRONTEND_URL}/chat?spotify_connected=true`);
  } catch (error) {
    logger.error('Spotify OAuth callback failed', { error: (error as Error).message });
    res.redirect(`${FRONTEND_URL}/chat?spotify_error=auth_failed`);
  }
});

export default router;
