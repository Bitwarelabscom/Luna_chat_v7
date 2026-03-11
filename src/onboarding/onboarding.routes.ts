import { Router, type Request } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as onboardingService from './onboarding.service.js';

const router = Router();
router.use(authenticate);

// GET /api/onboarding/status
router.get('/status', async (req, res) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const state = await onboardingService.getOnboardingState(userId);
    return res.json({ onboarding: state });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

// POST /api/onboarding/start
router.post('/start', async (req, res) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const state = await onboardingService.initOnboarding(userId, req.body?.sessionId);
    return res.json({ onboarding: state });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to start onboarding' });
  }
});

// POST /api/onboarding/skip
router.post('/skip', async (req, res) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const state = await onboardingService.skipSection(userId, req.body?.section);
    return res.json({ onboarding: state });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to skip section' });
  }
});

// POST /api/onboarding/commit
router.post('/commit', async (req, res) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { count } = await onboardingService.commitFacts(userId);
    const state = await onboardingService.getOnboardingState(userId);
    return res.json({ committed: count, onboarding: state });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to commit facts' });
  }
});

// POST /api/onboarding/reset
router.post('/reset', async (req, res) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await onboardingService.resetOnboarding(userId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset onboarding' });
  }
});

// PATCH /api/onboarding/data
router.patch('/data', async (req, res) => {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { section, data } = req.body || {};
  if (!section || typeof section !== 'string') {
    return res.status(400).json({ error: 'section is required' });
  }
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data is required' });
  }

  try {
    await onboardingService.updateCollectedData(userId, section, data as Record<string, string>);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update onboarding data' });
  }
});

export default router;
