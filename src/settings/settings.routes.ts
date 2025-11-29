import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as settingsService from './settings.service.js';
import * as modelConfigService from '../llm/model-config.service.js';
import { PROVIDERS, CONFIGURABLE_TASKS } from '../llm/types.js';
import { LUNA_BASE_PROMPT, ASSISTANT_MODE_PROMPT, COMPANION_MODE_PROMPT } from '../persona/luna.persona.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// === SYSTEM PROMPTS ===

// Get default prompts (built-in)
router.get('/prompts/defaults', (_req: Request, res: Response) => {
  res.json({
    basePrompt: LUNA_BASE_PROMPT,
    assistantMode: ASSISTANT_MODE_PROMPT,
    companionMode: COMPANION_MODE_PROMPT,
  });
});

// Get saved prompts for user
router.get('/prompts', async (req: Request, res: Response) => {
  try {
    const prompts = await settingsService.getSavedPrompts(req.user!.userId);
    res.json({ prompts });
  } catch (error) {
    logger.error('Failed to get saved prompts', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get saved prompts' });
  }
});

// Get active prompt
router.get('/prompts/active', async (req: Request, res: Response) => {
  try {
    const prompt = await settingsService.getActivePrompt(req.user!.userId);
    res.json({ prompt });
  } catch (error) {
    logger.error('Failed to get active prompt', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get active prompt' });
  }
});

// Set active prompt
router.put('/prompts/active', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      promptId: z.string().uuid().nullable(),
    });
    const { promptId } = schema.parse(req.body);

    await settingsService.setActivePrompt(req.user!.userId, promptId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to set active prompt', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to set active prompt' });
  }
});

// Create saved prompt
const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  basePrompt: z.string().min(1),
  assistantAdditions: z.string().optional(),
  companionAdditions: z.string().optional(),
  isDefault: z.boolean().optional(),
});

router.post('/prompts', async (req: Request, res: Response) => {
  try {
    const data = createPromptSchema.parse(req.body);
    const prompt = await settingsService.createSavedPrompt(req.user!.userId, data);
    res.status(201).json({ prompt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    const message = (error as Error).message;
    if (message.includes('duplicate key')) {
      res.status(409).json({ error: 'A prompt with this name already exists' });
      return;
    }
    logger.error('Failed to create prompt', { error: message });
    res.status(500).json({ error: 'Failed to create prompt' });
  }
});

// Update saved prompt
const updatePromptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  basePrompt: z.string().min(1).optional(),
  assistantAdditions: z.string().optional(),
  companionAdditions: z.string().optional(),
  isDefault: z.boolean().optional(),
});

router.patch('/prompts/:id', async (req: Request, res: Response) => {
  try {
    const data = updatePromptSchema.parse(req.body);
    const prompt = await settingsService.updateSavedPrompt(req.user!.userId, req.params.id, data);

    if (!prompt) {
      res.status(404).json({ error: 'Prompt not found' });
      return;
    }

    res.json({ prompt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    const message = (error as Error).message;
    if (message.includes('duplicate key')) {
      res.status(409).json({ error: 'A prompt with this name already exists' });
      return;
    }
    logger.error('Failed to update prompt', { error: message });
    res.status(500).json({ error: 'Failed to update prompt' });
  }
});

// Delete saved prompt
router.delete('/prompts/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await settingsService.deleteSavedPrompt(req.user!.userId, req.params.id);

    if (!deleted) {
      res.status(404).json({ error: 'Prompt not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete prompt', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});

// === STATS ===

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await settingsService.getUserStats(req.user!.userId);
    res.json({ stats });
  } catch (error) {
    logger.error('Failed to get stats', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// === BACKUP & RESTORE ===

// Export user data
router.get('/backup', async (req: Request, res: Response) => {
  try {
    const data = await settingsService.exportUserData(req.user!.userId);
    res.json(data);
  } catch (error) {
    logger.error('Failed to export data', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Import user data
const importSchema = z.object({
  version: z.string(),
  exportedAt: z.string(),
  user: z.object({
    email: z.string(),
    displayName: z.string().nullable(),
    settings: z.record(z.unknown()),
  }),
  savedPrompts: z.array(z.object({
    name: z.string(),
    description: z.string().nullable(),
    basePrompt: z.string(),
    assistantAdditions: z.string().nullable(),
    companionAdditions: z.string().nullable(),
  })).optional(),
  sessions: z.array(z.object({
    title: z.string(),
    mode: z.string(),
    createdAt: z.string(),
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
      createdAt: z.string(),
    })),
  })).optional(),
  facts: z.array(z.object({
    category: z.string(),
    factKey: z.string(),
    factValue: z.string(),
    confidence: z.number(),
  })).optional(),
  conversationSummaries: z.array(z.unknown()).optional(),
});

router.post('/restore', async (req: Request, res: Response) => {
  try {
    const data = importSchema.parse(req.body);
    const result = await settingsService.importUserData(req.user!.userId, data as settingsService.BackupData);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid backup format', details: error.errors });
      return;
    }
    logger.error('Failed to restore data', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to restore data' });
  }
});

// === CLEAR DATA ===

// Clear memory only (facts, embeddings, summaries)
router.delete('/memory', async (req: Request, res: Response) => {
  try {
    const result = await settingsService.clearMemory(req.user!.userId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to clear memory', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to clear memory' });
  }
});

// Clear all data
router.delete('/all-data', async (req: Request, res: Response) => {
  try {
    const result = await settingsService.clearAllData(req.user!.userId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to clear all data', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to clear all data' });
  }
});

// === MODEL CONFIGURATION ===

// Get available providers and models
router.get('/models/available', (_req: Request, res: Response) => {
  res.json({
    providers: PROVIDERS,
    tasks: CONFIGURABLE_TASKS,
  });
});

// Get user's model configurations
router.get('/models', async (req: Request, res: Response) => {
  try {
    const configs = await modelConfigService.getAllUserModelConfigs(req.user!.userId);
    res.json({ configs });
  } catch (error) {
    logger.error('Failed to get model configs', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get model configurations' });
  }
});

// Update model configuration for a task
const updateModelConfigSchema = z.object({
  taskType: z.string().min(1),
  provider: z.enum(['openai', 'groq', 'anthropic', 'xai']),
  model: z.string().min(1),
});

router.put('/models/:taskType', async (req: Request, res: Response) => {
  try {
    const { taskType } = req.params;
    const { provider, model } = updateModelConfigSchema.omit({ taskType: true }).parse(req.body);

    await modelConfigService.setUserModelConfig(req.user!.userId, taskType, provider, model);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    logger.error('Failed to update model config', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update model configuration' });
  }
});

// Reset model configurations to defaults
router.delete('/models', async (req: Request, res: Response) => {
  try {
    await modelConfigService.resetUserModelConfigs(req.user!.userId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to reset model configs', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to reset model configurations' });
  }
});

export default router;
