import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as ceoService from './ceo.service.js';
import * as buildTracker from './build-tracker.service.js';
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// Category keyword auto-mapping for /slash/cost
const CATEGORY_MAP: Record<string, string> = {
  claude: 'AI Cost', anthropic: 'AI Cost', openai: 'AI Cost',
  gemini: 'AI Cost', gpt: 'AI Cost', perplexity: 'AI Cost',
  spotify: 'Music', netflix: 'Media', github: 'Dev Tools',
  vercel: 'Hosting', aws: 'Hosting', digitalocean: 'Hosting',
  hetzner: 'Hosting', figma: 'Design', notion: 'Productivity',
};

function resolveCategory(keyword: string): string {
  return CATEGORY_MAP[keyword.toLowerCase()] ?? keyword;
}

const router = Router();

router.use(authenticate as RequestHandler);

const configSchema = z.object({
  mode: z.enum(['pre_revenue', 'normal']).optional(),
  timezone: z.string().min(1).max(80).optional(),
  noBuildDaysThreshold: z.number().int().min(1).max(30).optional(),
  noExperimentDaysThreshold: z.number().int().min(1).max(30).optional(),
  burnSpikeRatio: z.number().min(1).max(10).optional(),
  burnSpikeAbsoluteUsd: z.number().min(0).max(100000).optional(),
  unexpectedNewVendorUsd: z.number().min(0).max(100000).optional(),
  unexpectedVendorMultiplier: z.number().min(1).max(20).optional(),
  dailyMorningTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dailyEveningTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  weeklyReportWeekday: z.number().int().min(0).max(6).optional(),
  weeklyReportTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  biweeklyAuditWeekday: z.number().int().min(0).max(6).optional(),
  biweeklyAuditTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  competitors: z.array(z.string().min(1).max(80)).max(20).optional(),
  autopostPriority: z.array(z.string().min(1).max(30)).max(10).optional(),
  autopostEnabled: z.boolean().optional(),
});

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendor: z.string().min(1).max(120),
  amountUsd: z.number().min(0),
  category: z.string().min(1).max(40).optional(),
  cadence: z.string().min(1).max(20).optional(),
  notes: z.string().max(1000).optional(),
});

const incomeSchema = expenseSchema;

const buildSchema = z.object({
  projectKey: z.string().min(1).max(120),
  hours: z.number().min(0).max(24),
  item: z.string().max(1000).optional(),
  stage: z.string().max(30).optional(),
  impact: z.string().max(20).optional(),
  occurredAt: z.string().datetime().optional(),
});

const experimentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  channel: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  costUsd: z.number().min(0).optional(),
  leads: z.number().int().min(0).optional(),
  outcome: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

const leadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().min(1).max(60),
  status: z.string().max(20).optional(),
  valueEstimateUsd: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
});

const projectSchema = z.object({
  projectKey: z.string().min(1).max(120),
  stage: z.string().max(30).optional(),
  revenuePotentialUsd: z.number().min(0).optional(),
  estimatedHours: z.number().min(1).optional(),
  strategicLeverage: z.number().min(0.1).optional(),
  winProbability: z.number().min(0).max(1).optional(),
  dependencyRisk: z.number().int().min(0).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  notes: z.string().max(1000).optional(),
});

const autopostDraftSchema = z.object({
  channel: z.enum(['x', 'linkedin', 'telegram', 'blog', 'reddit']),
  content: z.string().min(1).max(6000),
  title: z.string().max(200).optional(),
});

const autopostChannelSchema = z.object({
  isEnabled: z.boolean().optional(),
  postingMode: z.enum(['auto', 'approval']).optional(),
  webhookPath: z.string().max(200).nullable().optional(),
  channelRef: z.string().max(120).nullable().optional(),
});

router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = await ceoService.getOrCreateConfig(req.user!.userId);
    res.json({ config });
  } catch (error) {
    logger.error('Failed to get CEO config', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get config' });
  }
});

router.put('/config', async (req: Request, res: Response) => {
  try {
    const updates = configSchema.parse(req.body);
    const config = await ceoService.updateConfig(req.user!.userId, updates);
    res.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to update CEO config', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update config' });
  }
});

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const days = Number.parseInt((req.query.days as string) || '30', 10);
    const periodDays = Number.isFinite(days) ? Math.max(7, Math.min(90, days)) : 30;
    const dashboard = await ceoService.getDashboard(req.user!.userId, periodDays);
    res.json({ dashboard });
  } catch (error) {
    logger.error('Failed to get CEO dashboard', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get dashboard' });
  }
});

router.post('/log/expense', async (req: Request, res: Response) => {
  try {
    const payload = expenseSchema.parse(req.body);
    const id = await ceoService.logExpense(req.user!.userId, payload);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log expense', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log expense' });
  }
});

router.post('/log/income', async (req: Request, res: Response) => {
  try {
    const payload = incomeSchema.parse(req.body);
    const id = await ceoService.logIncome(req.user!.userId, payload);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log income', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log income' });
  }
});

router.post('/log/build', async (req: Request, res: Response) => {
  try {
    const payload = buildSchema.parse(req.body);
    const id = await ceoService.logBuild(req.user!.userId, payload);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log build', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log build' });
  }
});

router.post('/log/experiment', async (req: Request, res: Response) => {
  try {
    const payload = experimentSchema.parse(req.body);
    const id = await ceoService.logExperiment(req.user!.userId, payload);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log experiment', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log experiment' });
  }
});

router.post('/log/lead', async (req: Request, res: Response) => {
  try {
    const payload = leadSchema.parse(req.body);
    const id = await ceoService.logLead(req.user!.userId, payload);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log lead', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log lead' });
  }
});

router.post('/log/project', async (req: Request, res: Response) => {
  try {
    const payload = projectSchema.parse(req.body);
    const id = await ceoService.logProjectSnapshot(req.user!.userId, payload);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log project snapshot', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log project snapshot' });
  }
});

router.get('/autopost/queue', async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt((req.query.limit as string) || '20', 10);
    const posts = await ceoService.listAutopostQueue(req.user!.userId, Math.max(1, Math.min(100, limit || 20)));
    res.json({ posts });
  } catch (error) {
    logger.error('Failed to list autopost queue', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list autopost queue' });
  }
});

router.get('/autopost/channels', async (req: Request, res: Response) => {
  try {
    const channels = await ceoService.listAutopostChannels(req.user!.userId);
    res.json({ channels });
  } catch (error) {
    logger.error('Failed to list autopost channels', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list autopost channels' });
  }
});

router.put('/autopost/channels/:channel', async (req: Request, res: Response) => {
  try {
    const channel = req.params.channel.toLowerCase();
    if (!['x', 'linkedin', 'telegram', 'blog', 'reddit'].includes(channel)) {
      res.status(400).json({ error: 'Invalid channel' });
      return;
    }

    const updates = autopostChannelSchema.parse(req.body);
    await ceoService.updateAutopostChannel(req.user!.userId, channel, updates);
    const channels = await ceoService.listAutopostChannels(req.user!.userId);
    res.json({ channels });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to update autopost channel', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update autopost channel' });
  }
});

router.post('/autopost/drafts', async (req: Request, res: Response) => {
  try {
    const payload = autopostDraftSchema.parse(req.body);
    const id = await ceoService.createAutopostDraft(req.user!.userId, payload.channel, payload.content, payload.title);
    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to create autopost draft', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create autopost draft' });
  }
});

router.post('/autopost/:id/approve', async (req: Request, res: Response) => {
  try {
    const approved = await ceoService.approveAutopostItem(req.user!.userId, req.params.id);
    if (!approved) {
      res.status(404).json({ error: 'Autopost item not found or not approvable' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to approve autopost item', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to approve autopost item' });
  }
});

router.post('/autopost/:id/cancel', async (req: Request, res: Response) => {
  try {
    const cancelled = await ceoService.cancelAutopostItem(req.user!.userId, req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: 'Autopost item not found or not cancellable' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to cancel autopost item', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to cancel autopost item' });
  }
});

router.get('/radar/signals', async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt((req.query.limit as string) || '20', 10);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
    const result = await pool.query(
      `SELECT id, signal_type AS "signalType", title, summary, source_url AS "sourceUrl",
              confidence, actionable, created_at AS "createdAt"
       FROM ceo_market_signals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user!.userId, safeLimit]
    );
    res.json({ signals: result.rows });
  } catch (error) {
    logger.error('Failed to get radar signals', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get radar signals' });
  }
});

router.post('/run/daily', async (req: Request, res: Response) => {
  try {
    const result = await ceoService.runDailyCheckForUser(req.user!.userId, 'manual');
    res.json({ result });
  } catch (error) {
    logger.error('Failed to run daily CEO check', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to run daily check' });
  }
});

router.post('/run/weekly', async (req: Request, res: Response) => {
  try {
    const result = await ceoService.runWeeklyBriefForUser(req.user!.userId);
    res.json({ result });
  } catch (error) {
    logger.error('Failed to run weekly CEO brief', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to run weekly brief' });
  }
});

router.post('/run/biweekly', async (req: Request, res: Response) => {
  try {
    const result = await ceoService.runBiweeklyAuditForUser(req.user!.userId);
    res.json({ result });
  } catch (error) {
    logger.error('Failed to run biweekly CEO audit', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to run biweekly audit' });
  }
});

router.post('/run/autopost', async (req: Request, res: Response) => {
  try {
    const result = await ceoService.processAutopostQueue(20, req.user!.userId);
    res.json({ result });
  } catch (error) {
    logger.error('Failed to run autopost worker', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to run autopost worker' });
  }
});

router.post('/run/cycle', async (_req: Request, res: Response) => {
  try {
    const result = await ceoService.runMonitoringCycle();
    res.json({ result });
  } catch (error) {
    logger.error('Failed to run monitoring cycle', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to run monitoring cycle' });
  }
});

// ============================================================
// Build Tracker Routes
// ============================================================

const startBuildSchema = z.object({
  taskName: z.string().min(1).max(200),
});

const buildNoteSchema = z.object({
  note: z.string().min(1).max(2000),
});

// POST /api/ceo/builds/start
router.post('/builds/start', async (req: Request, res: Response) => {
  try {
    const { taskName } = startBuildSchema.parse(req.body);
    const build = await buildTracker.startBuild(req.user!.userId, taskName);
    const systemLog = `[SYSTEM LOG: Build #${build.buildNum} started - "${build.taskName}"]`;
    res.status(201).json({ success: true, systemLog, data: build });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to start build', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to start build' });
  }
});

// GET /api/ceo/builds
router.get('/builds', async (req: Request, res: Response) => {
  try {
    const builds = await buildTracker.listBuilds(req.user!.userId);
    res.json({ builds });
  } catch (error) {
    logger.error('Failed to list builds', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list builds' });
  }
});

// POST /api/ceo/builds/:num/pause
router.post('/builds/:num/pause', async (req: Request, res: Response) => {
  try {
    const buildNum = parseInt(req.params.num, 10);
    if (!Number.isFinite(buildNum) || buildNum < 1) {
      res.status(400).json({ error: 'Invalid build number' });
      return;
    }
    const build = await buildTracker.pauseBuild(req.user!.userId, buildNum);
    if (!build) {
      res.status(404).json({ error: 'Active build not found' });
      return;
    }
    const elapsed = buildTracker.formatElapsed(buildTracker.getCurrentElapsed(build));
    const systemLog = `[SYSTEM LOG: Build #${build.buildNum} paused (${elapsed} elapsed)]`;
    res.json({ success: true, systemLog, data: build });
  } catch (error) {
    logger.error('Failed to pause build', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to pause build' });
  }
});

// POST /api/ceo/builds/:num/continue
router.post('/builds/:num/continue', async (req: Request, res: Response) => {
  try {
    const buildNum = parseInt(req.params.num, 10);
    if (!Number.isFinite(buildNum) || buildNum < 1) {
      res.status(400).json({ error: 'Invalid build number' });
      return;
    }
    const build = await buildTracker.continueBuild(req.user!.userId, buildNum);
    if (!build) {
      res.status(404).json({ error: 'Paused build not found' });
      return;
    }
    const systemLog = `[SYSTEM LOG: Build #${build.buildNum} resumed - "${build.taskName}"]`;
    res.json({ success: true, systemLog, data: build });
  } catch (error) {
    logger.error('Failed to continue build', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to continue build' });
  }
});

// POST /api/ceo/builds/:num/done
router.post('/builds/:num/done', async (req: Request, res: Response) => {
  try {
    const buildNum = parseInt(req.params.num, 10);
    if (!Number.isFinite(buildNum) || buildNum < 1) {
      res.status(400).json({ error: 'Invalid build number' });
      return;
    }
    const build = await buildTracker.doneBuild(req.user!.userId, buildNum);
    if (!build) {
      res.status(404).json({ error: 'Active/paused build not found' });
      return;
    }
    const elapsed = buildTracker.formatElapsed(build.elapsedSeconds);
    const systemLog = `[SYSTEM LOG: Build #${build.buildNum} completed (${elapsed} total) - "${build.taskName}"]`;
    res.json({ success: true, systemLog, data: build });
  } catch (error) {
    logger.error('Failed to complete build', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to complete build' });
  }
});

// POST /api/ceo/builds/:num/note
router.post('/builds/:num/note', async (req: Request, res: Response) => {
  try {
    const buildNum = parseInt(req.params.num, 10);
    if (!Number.isFinite(buildNum) || buildNum < 1) {
      res.status(400).json({ error: 'Invalid build number' });
      return;
    }
    const { note } = buildNoteSchema.parse(req.body);
    const build = await buildTracker.getBuild(req.user!.userId, buildNum);
    if (!build) {
      res.status(404).json({ error: 'Build not found' });
      return;
    }
    await buildTracker.addNote(build.id, req.user!.userId, note, 'manual');
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to add build note', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ============================================================
// Slash Command Economy Routes
// ============================================================

const slashCostSchema = z.object({
  amount: z.number().min(0),
  categoryOrKeyword: z.string().min(1).max(80),
  note: z.string().max(500).default(''),
});

const slashIncomeSchema = z.object({
  amount: z.number().min(0),
  source: z.string().min(1).max(80),
  note: z.string().max(500).default(''),
});

// POST /api/ceo/slash/cost
router.post('/slash/cost', async (req: Request, res: Response) => {
  try {
    const { amount, categoryOrKeyword, note } = slashCostSchema.parse(req.body);
    const category = resolveCategory(categoryOrKeyword);
    const id = await ceoService.logExpense(req.user!.userId, {
      vendor: categoryOrKeyword,
      amountUsd: amount,
      category,
      notes: note || undefined,
    });
    const systemLog = `[SYSTEM LOG: Expense $${amount.toFixed(2)} logged - ${category} (${categoryOrKeyword}${note ? ': ' + note : ''})]`;
    res.status(201).json({ success: true, systemLog, data: { id, category, amount } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log slash cost', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log expense' });
  }
});

// POST /api/ceo/slash/income
router.post('/slash/income', async (req: Request, res: Response) => {
  try {
    const { amount, source, note } = slashIncomeSchema.parse(req.body);
    const id = await ceoService.logIncome(req.user!.userId, {
      vendor: source,
      amountUsd: amount,
      notes: note || undefined,
    });
    const systemLog = `[SYSTEM LOG: Income +$${amount.toFixed(2)} logged - ${source}${note ? ': ' + note : ''}]`;
    res.status(201).json({ success: true, systemLog, data: { id, source, amount } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log slash income', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log income' });
  }
});

export default router;
