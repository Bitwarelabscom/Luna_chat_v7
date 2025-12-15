import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as tradingService from './trading.service.js';
import * as botExecutorService from './bot-executor.service.js';
import { getAllBotTemplates, getBotTemplate, getRecommendedSettings, type BotType } from './bot-templates.js';
import logger from '../utils/logger.js';

// Helper to get userId from authenticated request
function getUserId(req: Request): string {
  return req.user!.userId;
}

const router = Router();

// All routes require authentication
router.use(authenticate as RequestHandler);

// ============================================
// CONNECTION & SETTINGS
// ============================================

// Connect Binance account
const connectSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  apiSecret: z.string().min(1, 'API secret is required'),
});

router.post('/connect', async (req: Request, res: Response) => {
  try {
    const body = connectSchema.parse(req.body);
    const result = await tradingService.connectBinance(getUserId(req), body.apiKey, body.apiSecret);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to connect Binance', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to connect Binance account' });
  }
});

// Disconnect Binance account
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    await tradingService.disconnectBinance(getUserId(req));
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to disconnect Binance', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to disconnect Binance account' });
  }
});

// Get trading settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const settings = await tradingService.getSettings(getUserId(req));
    res.json(settings);
  } catch (error) {
    logger.error('Failed to get trading settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get trading settings' });
  }
});

// Update trading settings
const updateSettingsSchema = z.object({
  maxPositionPct: z.number().min(1).max(100).optional(),
  dailyLossLimitPct: z.number().min(1).max(50).optional(),
  requireStopLoss: z.boolean().optional(),
  defaultStopLossPct: z.number().min(0.1).max(50).optional(),
  allowedSymbols: z.array(z.string()).optional(),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).optional(),
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const body = updateSettingsSchema.parse(req.body);
    const settings = await tradingService.updateSettings(getUserId(req), body);
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to update trading settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update trading settings' });
  }
});

// ============================================
// PORTFOLIO & PRICES
// ============================================

// Get portfolio
router.get('/portfolio', async (req: Request, res: Response) => {
  try {
    const portfolio = await tradingService.getPortfolio(getUserId(req));
    if (!portfolio) {
      res.status(400).json({ error: 'Binance not connected' });
      return;
    }
    res.json(portfolio);
  } catch (error) {
    logger.error('Failed to get portfolio', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

// Get prices
router.get('/prices', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.query;
    const symbolList = symbols ? (symbols as string).split(',') : undefined;
    const prices = await tradingService.getPrices(getUserId(req), symbolList);
    res.json(prices);
  } catch (error) {
    logger.error('Failed to get prices', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get prices' });
  }
});

// Get klines (candlestick data)
router.get('/klines/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  try {
    const { interval, limit } = req.query;
    logger.info('Klines request', { symbol, interval, limit });
    const klines = await tradingService.getKlines(
      symbol,
      (interval as string) || '1h',
      limit ? parseInt(limit as string, 10) : 100
    );
    res.json(klines);
  } catch (error) {
    logger.error('Failed to get klines', { symbol, error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get klines' });
  }
});

// ============================================
// TRADING
// ============================================

// Get recent trades
router.get('/trades', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const trades = await tradingService.getRecentTrades(
      getUserId(req),
      limit ? parseInt(limit as string, 10) : 20
    );
    res.json(trades);
  } catch (error) {
    logger.error('Failed to get trades', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get trades' });
  }
});

// Place order
const orderSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  quantity: z.number().positive().optional(),
  quoteAmount: z.number().positive().optional(),
  price: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  notes: z.string().optional(),
}).refine(
  (data) => data.quantity !== undefined || data.quoteAmount !== undefined,
  { message: 'Either quantity or quoteAmount is required' }
).refine(
  (data) => data.type !== 'limit' || data.price !== undefined,
  { message: 'Price is required for limit orders' }
);

router.post('/order', async (req: Request, res: Response) => {
  try {
    const body = orderSchema.parse(req.body);
    const trade = await tradingService.placeOrder(getUserId(req), body);
    res.status(201).json(trade);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to place order';
    logger.error('Failed to place order', { error: errorMessage });
    res.status(400).json({ error: errorMessage });
  }
});

// Cancel order
router.delete('/order/:tradeId', async (req: Request, res: Response) => {
  try {
    await tradingService.cancelOrder(getUserId(req), req.params.tradeId);
    res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to cancel order';
    logger.error('Failed to cancel order', { error: errorMessage });
    res.status(400).json({ error: errorMessage });
  }
});

// Get trading stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const stats = await tradingService.getTradingStats(
      getUserId(req),
      days ? parseInt(days as string, 10) : 30
    );
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get trading stats', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get trading stats' });
  }
});

// ============================================
// BOTS
// ============================================

// Get all bots
router.get('/bots', async (req: Request, res: Response) => {
  try {
    const bots = await tradingService.getBots(getUserId(req));
    res.json(bots);
  } catch (error) {
    logger.error('Failed to get bots', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get bots' });
  }
});

// Create bot
const createBotSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: z.enum(['grid', 'dca', 'rsi', 'ma_crossover', 'macd', 'breakout', 'mean_reversion', 'momentum', 'custom']),
  symbol: z.string().min(1, 'Symbol is required'),
  config: z.record(z.unknown()),
  marketType: z.enum(['spot', 'alpha']).optional().default('spot'),
});

router.post('/bots', async (req: Request, res: Response) => {
  try {
    const body = createBotSchema.parse(req.body);
    const bot = await tradingService.createBot(getUserId(req), body);
    res.status(201).json(bot);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to create bot', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create bot' });
  }
});

// Update bot status
const updateBotStatusSchema = z.object({
  status: z.enum(['running', 'stopped', 'paused']),
});

router.patch('/bots/:botId/status', async (req: Request, res: Response) => {
  try {
    const body = updateBotStatusSchema.parse(req.body);
    await tradingService.updateBotStatus(getUserId(req), req.params.botId, body.status);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to update bot status', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update bot status' });
  }
});

// Delete bot
router.delete('/bots/:botId', async (req: Request, res: Response) => {
  try {
    await tradingService.deleteBot(getUserId(req), req.params.botId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete bot', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete bot' });
  }
});

// ============================================
// BOT TEMPLATES
// ============================================

// Get all bot templates
router.get('/bots/templates', async (_req: Request, res: Response) => {
  try {
    const templates = getAllBotTemplates();
    res.json({
      templates: templates.map(t => ({
        type: t.type,
        name: t.name,
        icon: t.icon,
        shortDescription: t.shortDescription,
        description: t.description,
        howItWorks: t.howItWorks,
        bestFor: t.bestFor,
        risks: t.risks,
        parameters: t.parameters,
        examples: t.examples,
        tips: t.tips,
        warnings: t.warnings,
        recommendedSettings: t.recommendedSettings,
      })),
      count: templates.length,
    });
  } catch (error) {
    logger.error('Failed to get bot templates', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get bot templates' });
  }
});

// Get specific bot template with full details
router.get('/bots/templates/:type', async (req: Request, res: Response) => {
  try {
    const template = getBotTemplate(req.params.type as BotType);
    if (!template) {
      res.status(404).json({ error: 'Bot template not found' });
      return;
    }
    res.json(template);
  } catch (error) {
    logger.error('Failed to get bot template', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get bot template' });
  }
});

// Get recommended settings for a bot type
const recommendedSettingsSchema = z.object({
  type: z.enum(['grid', 'dca', 'rsi', 'ma_crossover', 'macd', 'breakout', 'mean_reversion', 'momentum']),
  riskProfile: z.enum(['conservative', 'moderate', 'aggressive']).optional().default('moderate'),
});

router.post('/bots/recommended', async (req: Request, res: Response) => {
  try {
    const body = recommendedSettingsSchema.parse(req.body);
    const template = getBotTemplate(body.type);
    if (!template) {
      res.status(404).json({ error: 'Bot type not found' });
      return;
    }

    const settings = getRecommendedSettings(body.type, body.riskProfile);
    res.json({
      type: body.type,
      riskProfile: body.riskProfile,
      settings,
      parameters: template.parameters,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to get recommended settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get recommended settings' });
  }
});

// ============================================
// SCALPING
// ============================================

import * as scalpingService from './scalping.service.js';

// Get scalping settings
router.get('/scalping/settings', async (req: Request, res: Response) => {
  try {
    const settings = await scalpingService.getSettings(getUserId(req));
    res.json(settings || {
      enabled: false,
      mode: 'paper',
      maxPositionUsdt: 100,
      symbols: ['BTCUSDC', 'ETHUSDC', 'SOLUSDC'],
    });
  } catch (error) {
    logger.error('Failed to get scalping settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get scalping settings' });
  }
});

// Update scalping settings
const scalpingSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['paper', 'live']).optional(),
  maxPositionUsdt: z.number().positive().optional(),
  maxConcurrentPositions: z.number().min(1).max(10).optional(),
  symbols: z.array(z.string()).optional(),
  minDropPct: z.number().min(0.5).max(20).optional(),
  maxDropPct: z.number().min(1).max(30).optional(),
  rsiOversoldThreshold: z.number().min(10).max(50).optional(),
  volumeSpikeMultiplier: z.number().min(1).max(10).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  takeProfitPct: z.number().min(0.1).max(20).optional(),
  stopLossPct: z.number().min(0.1).max(20).optional(),
  maxHoldMinutes: z.number().min(1).max(1440).optional(),
});

router.put('/scalping/settings', async (req: Request, res: Response) => {
  try {
    const body = scalpingSettingsSchema.parse(req.body);
    const settings = await scalpingService.updateSettings(getUserId(req), body);
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to update scalping settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update scalping settings' });
  }
});

// Enable/disable scalping
router.post('/scalping/toggle', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    await scalpingService.setEnabled(getUserId(req), enabled === true);
    res.json({ success: true, enabled });
  } catch (error) {
    logger.error('Failed to toggle scalping', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to toggle scalping' });
  }
});

// Switch scalping mode (paper/live)
router.post('/scalping/mode', async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    if (mode !== 'paper' && mode !== 'live') {
      res.status(400).json({ error: 'Invalid mode - must be "paper" or "live"' });
      return;
    }
    await scalpingService.setMode(getUserId(req), mode);
    res.json({ success: true, mode });
  } catch (error) {
    logger.error('Failed to set scalping mode', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set scalping mode' });
  }
});

// Get scalping stats
router.get('/scalping/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const stats = await scalpingService.getStats(
      getUserId(req),
      days ? parseInt(days as string, 10) : 30
    );
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get scalping stats', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get scalping stats' });
  }
});

// Get open paper positions
router.get('/scalping/positions', async (req: Request, res: Response) => {
  try {
    const positions = await scalpingService.getOpenPositions(getUserId(req));
    res.json(positions);
  } catch (error) {
    logger.error('Failed to get scalping positions', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get scalping positions' });
  }
});

// ============================================
// TRADING CHAT
// ============================================

import * as tradingChat from '../chat/trading-chat.service.js';

// Get or create trading session
router.post('/chat/session', async (req: Request, res: Response) => {
  try {
    const sessionId = await tradingChat.getOrCreateTradingSession(getUserId(req));
    res.json({ sessionId });
  } catch (error) {
    logger.error('Failed to create trading session', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create trading session' });
  }
});

// Get trading chat history
router.get('/chat/session/:sessionId/messages', async (req: Request, res: Response) => {
  try {
    const messages = await tradingChat.getSessionMessages(req.params.sessionId, 50);
    res.json(messages);
  } catch (error) {
    logger.error('Failed to get trading chat messages', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get chat messages' });
  }
});

// Send trading chat message
const sendMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(10000),
});

router.post('/chat/session/:sessionId/send', async (req: Request, res: Response) => {
  try {
    const body = sendMessageSchema.parse(req.body);
    const result = await tradingChat.processMessage({
      sessionId: req.params.sessionId,
      userId: getUserId(req),
      message: body.message,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to process trading chat message', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// ============================================
// RESEARCH MODE
// ============================================

import * as researchService from './research.service.js';

// Get research settings
router.get('/research/settings', async (req: Request, res: Response) => {
  try {
    const settings = await researchService.getResearchSettings(getUserId(req));
    res.json(settings || {
      executionMode: 'manual',
      paperLiveMode: 'paper',
      enableAutoDiscovery: true,
      autoDiscoveryLimit: 20,
      customSymbols: [],
      minConfidence: 0.6,
    });
  } catch (error) {
    logger.error('Failed to get research settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get research settings' });
  }
});

// Update research settings
const researchSettingsSchema = z.object({
  executionMode: z.enum(['auto', 'confirm', 'manual']).optional(),
  paperLiveMode: z.enum(['paper', 'live']).optional(),
  enableAutoDiscovery: z.boolean().optional(),
  autoDiscoveryLimit: z.number().min(5).max(50).optional(),
  customSymbols: z.array(z.string()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

router.put('/research/settings', async (req: Request, res: Response) => {
  try {
    const body = researchSettingsSchema.parse(req.body);
    const settings = await researchService.updateResearchSettings(getUserId(req), body);
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to update research settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update research settings' });
  }
});

// Get research signals
router.get('/research/signals', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const signals = await researchService.getSignals(
      getUserId(req),
      limit ? parseInt(limit as string, 10) : 50
    );
    res.json(signals);
  } catch (error) {
    logger.error('Failed to get research signals', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get research signals' });
  }
});

// Get research metrics
router.get('/research/metrics', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const metrics = await researchService.getResearchMetrics(
      getUserId(req),
      days ? parseInt(days as string, 10) : 30
    );
    // Also get scalping stats for full picture
    const scalpingStats = await scalpingService.getStats(
      getUserId(req),
      days ? parseInt(days as string, 10) : 30
    );
    res.json({ research: metrics, scalping: scalpingStats });
  } catch (error) {
    logger.error('Failed to get research metrics', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get research metrics' });
  }
});

// Get top volume pairs
router.get('/research/top-pairs', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const pairs = await researchService.getTopVolumePairs(
      limit ? parseInt(limit as string, 10) : 20
    );
    res.json({ pairs });
  } catch (error) {
    logger.error('Failed to get top pairs', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get top pairs' });
  }
});

// Execute a signal manually
router.post('/research/execute/:signalId', async (req: Request, res: Response) => {
  try {
    const result = await researchService.executeSignal(getUserId(req), req.params.signalId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute signal', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to execute signal' });
  }
});

// Confirm or skip a pending signal
const confirmSignalSchema = z.object({
  action: z.enum(['execute', 'skip']),
});

router.post('/research/confirm/:signalId', async (req: Request, res: Response) => {
  try {
    const body = confirmSignalSchema.parse(req.body);
    const result = await researchService.handleConfirmation(
      getUserId(req),
      req.params.signalId,
      body.action
    );
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to confirm signal', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to confirm signal' });
  }
});

// ============================================
// INDICATOR SETTINGS
// ============================================

import * as indicatorsService from './indicators.service.js';

// Get indicator settings
router.get('/research/indicators', async (req: Request, res: Response) => {
  try {
    const settings = await indicatorsService.getIndicatorSettings(getUserId(req));
    res.json(settings);
  } catch (error) {
    logger.error('Failed to get indicator settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get indicator settings' });
  }
});

// Update indicator settings
const indicatorSettingsSchema = z.object({
  preset: z.enum(['conservative', 'balanced', 'aggressive', 'custom']).optional(),
  enableRsi: z.boolean().optional(),
  enableMacd: z.boolean().optional(),
  enableBollinger: z.boolean().optional(),
  enableEma: z.boolean().optional(),
  enableVolume: z.boolean().optional(),
  enablePriceAction: z.boolean().optional(),
  weights: z.object({
    rsi: z.number().min(0).max(1).optional(),
    macd: z.number().min(0).max(1).optional(),
    bollinger: z.number().min(0).max(1).optional(),
    ema: z.number().min(0).max(1).optional(),
    volume: z.number().min(0).max(1).optional(),
    priceAction: z.number().min(0).max(1).optional(),
  }).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  macdFast: z.number().min(2).max(50).optional(),
  macdSlow: z.number().min(5).max(100).optional(),
  macdSignal: z.number().min(2).max(50).optional(),
  bollingerPeriod: z.number().min(5).max(100).optional(),
  bollingerStddev: z.number().min(0.5).max(5).optional(),
  emaShort: z.number().min(2).max(50).optional(),
  emaMedium: z.number().min(5).max(100).optional(),
  emaLong: z.number().min(10).max(200).optional(),
  volumeAvgPeriod: z.number().min(5).max(100).optional(),
  volumeSpikeThreshold: z.number().min(1).max(10).optional(),
});

router.put('/research/indicators', async (req: Request, res: Response) => {
  try {
    const body = indicatorSettingsSchema.parse(req.body);
    const settings = await indicatorsService.updateIndicatorSettings(getUserId(req), body);
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to update indicator settings', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update indicator settings' });
  }
});

// Get available presets
router.get('/research/indicators/presets', async (_req: Request, res: Response) => {
  try {
    res.json(indicatorsService.INDICATOR_PRESETS);
  } catch (error) {
    logger.error('Failed to get indicator presets', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get indicator presets' });
  }
});

// Apply a preset
const applyPresetSchema = z.object({
  preset: z.enum(['conservative', 'balanced', 'aggressive']),
});

router.post('/research/indicators/preset', async (req: Request, res: Response) => {
  try {
    const body = applyPresetSchema.parse(req.body);
    const settings = await indicatorsService.applyIndicatorPreset(getUserId(req), body.preset);
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to apply indicator preset', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to apply indicator preset' });
  }
});

// ============================================
// CONDITIONAL ORDERS (Trade Rules)
// ============================================

// Get conditional orders
router.get('/rules', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const validStatuses = ['active', 'triggered', 'cancelled', 'expired'] as const;
    type StatusType = typeof validStatuses[number];
    const statusFilter = status && status !== 'all' && validStatuses.includes(status as StatusType)
      ? (status as StatusType)
      : undefined;
    const orders = await botExecutorService.getConditionalOrders(getUserId(req), statusFilter);
    res.json(orders);
  } catch (error) {
    logger.error('Failed to get conditional orders', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get conditional orders' });
  }
});

// Create conditional order
const createRuleSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  condition: z.enum(['above', 'below', 'crosses_up', 'crosses_down']),
  triggerPrice: z.number().positive('Trigger price must be positive'),
  action: z.object({
    side: z.enum(['buy', 'sell']),
    type: z.enum(['market', 'limit']).default('market'),
    amountType: z.enum(['quantity', 'percentage', 'quote']),
    amount: z.number().positive('Amount must be positive'),
    limitPrice: z.number().positive().optional(),
    stopLoss: z.number().positive().optional(),
    takeProfit: z.number().positive().optional(),
    trailingStopPct: z.number().min(0.1).max(50).optional(),
    trailingStopDollar: z.number().positive().optional(),
  }),
  expiresInHours: z.number().positive().optional(),
});

router.post('/rules', async (req: Request, res: Response) => {
  try {
    const body = createRuleSchema.parse(req.body);
    const order = await botExecutorService.createConditionalOrder(getUserId(req), body);
    res.status(201).json(order);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors[0].message });
      return;
    }
    logger.error('Failed to create conditional order', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create conditional order' });
  }
});

// Cancel conditional order
router.delete('/rules/:id', async (req: Request, res: Response) => {
  try {
    const success = await botExecutorService.cancelConditionalOrder(getUserId(req), req.params.id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Order not found or already cancelled' });
    }
  } catch (error) {
    logger.error('Failed to cancel conditional order', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to cancel conditional order' });
  }
});

// ============================================
// BINANCE ALPHA (Early Stage Tokens)
// ============================================

import { alphaClient } from './binance-alpha.client.js';

// Get Alpha token list
router.get('/alpha/tokens', async (_req: Request, res: Response) => {
  try {
    const tokens = await alphaClient.getTokenList();
    res.json({ tokens, count: tokens.length });
  } catch (error) {
    logger.error('Failed to get Alpha tokens', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Alpha token list' });
  }
});

// Search Alpha tokens
router.get('/alpha/tokens/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }
    const tokens = await alphaClient.searchTokens(q);
    res.json({ tokens, count: tokens.length });
  } catch (error) {
    logger.error('Failed to search Alpha tokens', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search Alpha tokens' });
  }
});

// Get Alpha token price
router.get('/alpha/price/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const price = await alphaClient.getPrice(symbol);
    if (!price) {
      res.status(404).json({ error: `Price not found for ${symbol}` });
      return;
    }
    res.json(price);
  } catch (error) {
    logger.error('Failed to get Alpha price', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Alpha price' });
  }
});

// Get Alpha klines
router.get('/alpha/klines/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  try {
    const { interval, limit, startTime, endTime } = req.query;
    const klines = await alphaClient.getKlines(
      symbol,
      (interval as string) || '1h',
      limit ? parseInt(limit as string, 10) : 100,
      startTime ? parseInt(startTime as string, 10) : undefined,
      endTime ? parseInt(endTime as string, 10) : undefined
    );
    res.json(klines);
  } catch (error) {
    logger.error('Failed to get Alpha klines', { symbol, error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Alpha klines' });
  }
});

// Get Alpha 24hr ticker
router.get('/alpha/ticker/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const ticker = await alphaClient.getTicker24hr(symbol);
    res.json(ticker);
  } catch (error) {
    logger.error('Failed to get Alpha ticker', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Alpha ticker' });
  }
});

// Get Alpha recent trades
router.get('/alpha/trades/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  try {
    const { limit } = req.query;
    const trades = await alphaClient.getTrades(
      symbol,
      limit ? parseInt(limit as string, 10) : 50
    );
    res.json(trades);
  } catch (error) {
    logger.error('Failed to get Alpha trades', { symbol, error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Alpha trades' });
  }
});

// Get top Alpha tokens by volume
router.get('/alpha/top', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const tokens = await alphaClient.getTopTokensByVolume(
      limit ? parseInt(limit as string, 10) : 20
    );
    res.json({ tokens, count: tokens.length });
  } catch (error) {
    logger.error('Failed to get top Alpha tokens', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get top Alpha tokens' });
  }
});

// Get hot Alpha tokens (trending)
router.get('/alpha/hot', async (_req: Request, res: Response) => {
  try {
    const tokens = await alphaClient.getHotTokens();
    res.json({ tokens, count: tokens.length });
  } catch (error) {
    logger.error('Failed to get hot Alpha tokens', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get hot Alpha tokens' });
  }
});

// Get prices for multiple Alpha tokens
router.get('/alpha/prices', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.query;
    if (!symbols || typeof symbols !== 'string') {
      res.status(400).json({ error: 'symbols query parameter required (comma-separated)' });
      return;
    }
    const symbolList = symbols.split(',').map(s => s.trim());
    const prices = await alphaClient.getTokenPrices(symbolList);
    res.json({ prices, count: prices.length });
  } catch (error) {
    logger.error('Failed to get Alpha prices', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get Alpha prices' });
  }
});

// Get combined portfolio (Spot + Alpha)
router.get('/portfolio/combined', async (req: Request, res: Response) => {
  try {
    const combined = await tradingService.getCombinedPortfolio(getUserId(req));
    res.json(combined);
  } catch (error) {
    logger.error('Failed to get combined portfolio', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get combined portfolio' });
  }
});

export default router;
