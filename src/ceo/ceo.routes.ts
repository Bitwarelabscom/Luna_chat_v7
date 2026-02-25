import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as ceoService from './ceo.service.js';
import * as buildTracker from './build-tracker.service.js';
import * as albumPipeline from './album-pipeline.service.js';
import { GENRE_PRESETS } from '../abilities/genre-presets.js';
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

const buildHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
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

// GET /api/ceo/builds/history
router.get('/builds/history', async (req: Request, res: Response) => {
  try {
    const { limit } = buildHistoryQuerySchema.parse(req.query);
    const builds = await buildTracker.listBuildHistory(req.user!.userId, limit ?? 60);
    res.json({ builds });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to list build history', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list build history' });
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
    const systemLog = `[SYSTEM LOG: Expense ${amount.toFixed(2)} logged - ${category} (${categoryOrKeyword}${note ? ': ' + note : ''})]`;
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
    const systemLog = `[SYSTEM LOG: Income +${amount.toFixed(2)} logged - ${source}${note ? ': ' + note : ''}]`;
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

// POST /api/ceo/slash/pay
const slashPaySchema = z.object({
  amount: z.number().min(0),
  keyword: z.string().min(1).max(80),
  note: z.string().max(500).default(''),
});

router.post('/slash/pay', async (req: Request, res: Response) => {
  try {
    const { amount, keyword, note } = slashPaySchema.parse(req.body);
    const id = await ceoService.logOwnerPay(req.user!.userId, {
      vendor: keyword,
      amountUsd: amount,
      notes: note || undefined,
    });
    const systemLog = `[SYSTEM LOG: Owner payment ${amount.toFixed(2)} logged - ${keyword}${note ? ': ' + note : ''}]`;
    res.status(201).json({ success: true, systemLog, data: { id, keyword, amount } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to log slash pay', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to log owner payment' });
  }
});

// ============================================================
// Album Production Pipeline Routes
// ============================================================

const createProductionSchema = z.object({
  artistName: z.string().min(1).max(200),
  genre: z.string().min(1).max(100),
  productionNotes: z.string().max(2000).optional(),
  albumCount: z.number().int().min(1).max(10).optional(),
  planningModel: z.string().max(100).optional(),
  lyricsModel: z.string().max(100).optional(),
});

// POST /api/ceo/albums - Create production + trigger planning
router.post('/albums', async (req: Request, res: Response) => {
  try {
    const params = createProductionSchema.parse(req.body);
    const productionId = await albumPipeline.createProduction(req.user!.userId, params);

    // Trigger planning in background
    albumPipeline.planAlbums(productionId).catch(err => {
      logger.error('Background album planning failed', { productionId, error: (err as Error).message });
    });

    res.status(201).json({ id: productionId, status: 'planning' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to create album production', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create production' });
  }
});

// GET /api/ceo/albums - List productions
router.get('/albums', async (req: Request, res: Response) => {
  try {
    const productions = await albumPipeline.listProductions(req.user!.userId);
    res.json({ productions });
  } catch (error) {
    logger.error('Failed to list album productions', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list productions' });
  }
});

// GET /api/ceo/albums/genres - Get available genre presets
router.get('/albums/genres', async (_req: Request, res: Response) => {
  res.json({ genres: GENRE_PRESETS.map(g => ({ id: g.id, name: g.name, description: g.description, defaultSongCount: g.defaultSongCount })) });
});

// GET /api/ceo/albums/:id - Production detail
router.get('/albums/:id', async (req: Request, res: Response) => {
  try {
    const detail = await albumPipeline.getProductionDetail(req.user!.userId, req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Production not found' });
      return;
    }
    res.json({ production: detail });
  } catch (error) {
    logger.error('Failed to get album production detail', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get production detail' });
  }
});

// GET /api/ceo/albums/:id/progress - Lightweight progress
router.get('/albums/:id/progress', async (req: Request, res: Response) => {
  try {
    const progress = await albumPipeline.getProductionProgress(req.user!.userId, req.params.id);
    if (!progress) {
      res.status(404).json({ error: 'Production not found' });
      return;
    }
    res.json({ progress });
  } catch (error) {
    logger.error('Failed to get album progress', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// POST /api/ceo/albums/:id/approve - Approve plan, start execution
router.post('/albums/:id/approve', async (req: Request, res: Response) => {
  try {
    const approved = await albumPipeline.approveProduction(req.user!.userId, req.params.id);
    if (!approved) {
      res.status(400).json({ error: 'Production not found or not in planned state' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to approve album production', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to approve production' });
  }
});

// POST /api/ceo/albums/:id/run - Re-trigger full pipeline for an in_progress production
router.post('/albums/:id/run', async (req: Request, res: Response) => {
  try {
    const check = await pool.query(
      `SELECT id FROM album_productions WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`,
      [req.params.id, req.user!.userId],
    );
    if (check.rows.length === 0) {
      res.status(400).json({ error: 'Production not found or not in_progress' });
      return;
    }
    // Kick off full pipeline in background
    albumPipeline.triggerFullPipeline(req.params.id);
    res.json({ success: true, message: 'Pipeline triggered' });
  } catch (error) {
    logger.error('Failed to trigger pipeline', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to trigger pipeline' });
  }
});

// POST /api/ceo/albums/:id/cancel - Cancel production
router.post('/albums/:id/cancel', async (req: Request, res: Response) => {
  try {
    const cancelled = await albumPipeline.cancelProduction(req.user!.userId, req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: 'Production not found or not cancellable' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to cancel album production', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to cancel production' });
  }
});

// ============================================================
// Artist Management Routes
// ============================================================

// GET /api/ceo/artists - List artist files
router.get('/artists', async (req: Request, res: Response) => {
  try {
    const artists = await albumPipeline.listArtists(req.user!.userId);
    res.json({ artists });
  } catch (error) {
    logger.error('Failed to list artists', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list artists' });
  }
});

// GET /api/ceo/artists/:name - Read artist file
router.get('/artists/:name', async (req: Request, res: Response) => {
  try {
    const content = await albumPipeline.readArtist(req.user!.userId, req.params.name);
    if (content === null) {
      res.status(404).json({ error: 'Artist not found' });
      return;
    }
    res.json({ name: req.params.name, content });
  } catch (error) {
    logger.error('Failed to read artist', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to read artist' });
  }
});

const artistSchema = z.object({
  content: z.string().min(1).max(10000),
});

// PUT /api/ceo/artists/:name - Create/update artist file
router.put('/artists/:name', async (req: Request, res: Response) => {
  try {
    const { content } = artistSchema.parse(req.body);
    await albumPipeline.writeArtist(req.user!.userId, req.params.name, content);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to write artist', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to write artist' });
  }
});

export default router;
