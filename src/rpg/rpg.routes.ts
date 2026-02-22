import { Router, type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import logger from '../utils/logger.js';
import { createGame, listGames, loadGame, takeAction } from './rpg.service.js';

const router = Router();

router.use(authenticate as RequestHandler);

const createGameSchema = z.object({
  saveName: z.string().min(1).max(120),
  coreIdea: z.string().min(1).max(2500),
  playerName: z.string().max(120).optional(),
  castSize: z.number().int().min(3).max(8).optional(),
  perk: z.number().int().min(1).max(4).optional(),
});

const actionSchema = z.object({
  action: z.enum([
    'refresh_intents',
    'explore',
    'work',
    'rest',
    'talk',
    'combat',
    'custom',
    'use_item',
    'shop_buy',
    'shop_sell',
  ]),
  detail: z.string().max(2000).optional(),
  npcName: z.string().max(160).optional(),
  itemId: z.string().max(80).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  style: z.enum(['attack', 'overcharge', 'defend', 'flee']).optional(),
});

function getUserId(req: Request): string {
  return req.user!.userId;
}

router.get('/games', async (req: Request, res: Response) => {
  try {
    const games = await listGames(getUserId(req));
    res.json({ games });
  } catch (error) {
    logger.error('Failed to list RPG games', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list RPG games' });
  }
});

router.post('/games', async (req: Request, res: Response) => {
  try {
    const input = createGameSchema.parse(req.body);
    const game = await createGame(getUserId(req), input);
    res.status(201).json({ game });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    const message = (error as Error).message || 'Failed to create RPG game';
    logger.error('Failed to create RPG game', { error: message });
    res.status(500).json({ error: message });
  }
});

router.get('/games/:gameId', async (req: Request, res: Response) => {
  try {
    const game = await loadGame(getUserId(req), req.params.gameId);
    res.json({ game });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('not found')) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    logger.error('Failed to load RPG game', { error: message, gameId: req.params.gameId });
    res.status(500).json({ error: 'Failed to load RPG game' });
  }
});

router.post('/games/:gameId/actions', async (req: Request, res: Response) => {
  try {
    const action = actionSchema.parse(req.body);
    const result = await takeAction(getUserId(req), req.params.gameId, action);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }

    const message = (error as Error).message;
    if (message.toLowerCase().includes('not found')) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (
      message.includes('Not enough credits') ||
      message.includes('Invalid itemId') ||
      message.includes('Custom action detail') ||
      message.includes('permadeath') ||
      message.includes('own enough')
    ) {
      res.status(400).json({ error: message });
      return;
    }

    logger.error('Failed to execute RPG action', {
      gameId: req.params.gameId,
      error: message,
    });
    res.status(500).json({ error: 'Failed to execute RPG action' });
  }
});

export default router;
