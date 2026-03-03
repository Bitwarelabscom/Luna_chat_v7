/**
 * Agent Settings Routes
 *
 * Mounted at /api/settings/agents in index.ts
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as agentSettings from './agent-settings.service.js';
import logger from '../utils/logger.js';

const router = Router();
router.use(authenticate);

// ============================================
// Zod Schemas
// ============================================

const categoryEnum = z.enum(['chat_mode', 'specialist', 'friend', 'council', 'department', 'utility']);

const toolSetEnum = z.enum([
  'companion', 'assistant', 'dj_luna', 'ceo_luna', 'trading',
  'voice', 'workspace', 'code_execution', 'search', 'none',
]);

const providerStrategySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user_config'), taskType: z.string().min(1) }),
  z.object({ type: z.literal('fixed'), provider: z.string().min(1), model: z.string().min(1) }),
  z.object({ type: z.literal('inherit') }),
]);

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  category: categoryEnum,
  basePromptId: z.string().nullable().optional(),
  promptTemplate: z.string().min(1).max(50000),
  promptComposable: z.boolean().optional(),
  providerStrategy: providerStrategySchema,
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  toolSets: z.array(toolSetEnum).optional(),
  additionalTools: z.array(z.string()).optional(),
  canBeSummoned: z.boolean().optional(),
  canSummon: z.array(z.string()).optional(),
  avatarEmoji: z.string().max(4).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  personality: z.string().max(500).nullable().optional(),
  maxResponseTokens: z.number().int().positive().nullable().optional(),
  cacheTierEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateAgentSchema = createAgentSchema.partial();

// ============================================
// Routes
// ============================================

// GET / - List all agents for user
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const agents = await agentSettings.getUserAgents(req.user!.userId);
    res.json({ agents });
  } catch (err) {
    logger.error('Failed to list agents', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// GET /tool-options - Available tool sets + individual tools
router.get('/tool-options', (_req: Request, res: Response): void => {
  const options = agentSettings.getToolOptions();
  res.json(options);
});

// GET /:id - Single agent (resolved with override)
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const agent = await agentSettings.getUserAgent(req.user!.userId, req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ agent });
  } catch (err) {
    logger.error('Failed to get agent', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// POST / - Create custom agent
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = createAgentSchema.parse(req.body);
    const agent = await agentSettings.createUserAgent(req.user!.userId, data);
    res.status(201).json({ agent });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    logger.error('Failed to create agent', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PATCH /:id - Update custom agent
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = updateAgentSchema.parse(req.body);
    const agent = await agentSettings.updateUserAgent(req.user!.userId, req.params.id, data);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found or not a custom agent' });
      return;
    }
    res.json({ agent });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    logger.error('Failed to update agent', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// DELETE /:id - Delete custom agent
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await agentSettings.deleteUserAgent(req.user!.userId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Agent not found or is a builtin agent' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete agent', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// PUT /:builtinId/override - Create/update builtin override
router.put('/:builtinId/override', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = updateAgentSchema.parse(req.body);
    const agent = await agentSettings.saveBuiltinOverride(req.user!.userId, req.params.builtinId, data);
    res.json({ agent });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    if ((err as Error).message.includes('not found')) {
      res.status(404).json({ error: (err as Error).message });
      return;
    }
    logger.error('Failed to save override', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to save override' });
  }
});

// DELETE /:builtinId/override - Reset builtin to defaults
router.delete('/:builtinId/override', async (req: Request, res: Response): Promise<void> => {
  try {
    const reset = await agentSettings.resetBuiltinOverride(req.user!.userId, req.params.builtinId);
    if (!reset) {
      res.status(404).json({ error: 'No override found for this builtin' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to reset override', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to reset override' });
  }
});

export default router;
