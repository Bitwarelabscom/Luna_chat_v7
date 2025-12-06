/**
 * MCP (Model Context Protocol) Routes
 * API endpoints for managing MCP servers and tools
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware.js';
import * as mcpService from './mcp.service.js';
import { MCP_PRESETS } from './presets.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================================================
// Server Management
// ============================================================================

/**
 * GET /api/mcp/servers
 * List all MCP servers for the user
 */
router.get('/servers', async (req: Request, res: Response) => {
  try {
    const servers = await mcpService.getServers(req.user!.userId);
    res.json({ servers });
  } catch (error) {
    logger.error('Failed to get MCP servers', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get MCP servers' });
  }
});

const createServerSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  description: z.string().max(500).optional(),
  headers: z.record(z.string()).optional(),
});

/**
 * POST /api/mcp/servers
 * Create a new MCP server connection
 */
router.post('/servers', async (req: Request, res: Response) => {
  try {
    const data = createServerSchema.parse(req.body);
    const server = await mcpService.createServer(req.user!.userId, data);

    // Auto-discover tools after creation
    try {
      await mcpService.discoverTools(server.id);
    } catch (discoverError) {
      logger.warn('Failed to auto-discover tools', { serverId: server.id, error: (discoverError as Error).message });
    }

    // Get server with tools
    const serverWithTools = await mcpService.getServer(req.user!.userId, server.id);
    res.status(201).json({ server: serverWithTools });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    logger.error('Failed to create MCP server', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create MCP server' });
  }
});

/**
 * GET /api/mcp/servers/:id
 * Get a specific MCP server with its tools
 */
router.get('/servers/:id', async (req: Request, res: Response) => {
  try {
    const server = await mcpService.getServer(req.user!.userId, req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json({ server });
  } catch (error) {
    logger.error('Failed to get MCP server', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get MCP server' });
  }
});

const updateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  description: z.string().max(500).optional(),
  headers: z.record(z.string()).optional(),
  isEnabled: z.boolean().optional(),
});

/**
 * PUT /api/mcp/servers/:id
 * Update an MCP server
 */
router.put('/servers/:id', async (req: Request, res: Response) => {
  try {
    const updates = updateServerSchema.parse(req.body);
    const server = await mcpService.updateServer(req.user!.userId, req.params.id, updates);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json({ server });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    logger.error('Failed to update MCP server', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update MCP server' });
  }
});

/**
 * DELETE /api/mcp/servers/:id
 * Delete an MCP server and its tools
 */
router.delete('/servers/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await mcpService.deleteServer(req.user!.userId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete MCP server', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete MCP server' });
  }
});

// ============================================================================
// Tool Discovery & Management
// ============================================================================

/**
 * POST /api/mcp/servers/:id/discover
 * Discover/refresh tools from an MCP server
 */
router.post('/servers/:id/discover', async (req: Request, res: Response) => {
  try {
    // Verify ownership
    const server = await mcpService.getServer(req.user!.userId, req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const tools = await mcpService.discoverTools(req.params.id);
    res.json({ tools });
  } catch (error) {
    logger.error('Failed to discover MCP tools', { error: (error as Error).message });
    res.status(500).json({ error: `Failed to discover tools: ${(error as Error).message}` });
  }
});

/**
 * GET /api/mcp/servers/:id/tools
 * List tools for a specific MCP server
 */
router.get('/servers/:id/tools', async (req: Request, res: Response) => {
  try {
    // Verify ownership
    const server = await mcpService.getServer(req.user!.userId, req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const tools = await mcpService.getServerTools(req.params.id);
    res.json({ tools });
  } catch (error) {
    logger.error('Failed to get MCP tools', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get MCP tools' });
  }
});

const updateToolSchema = z.object({
  isEnabled: z.boolean(),
});

/**
 * PUT /api/mcp/tools/:id
 * Enable/disable an MCP tool
 */
router.put('/tools/:id', async (req: Request, res: Response) => {
  try {
    const updates = updateToolSchema.parse(req.body);
    const tool = await mcpService.updateTool(req.params.id, updates);
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }
    res.json({ tool });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    logger.error('Failed to update MCP tool', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update MCP tool' });
  }
});

// ============================================================================
// Connection Testing
// ============================================================================

const testConnectionSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

/**
 * POST /api/mcp/test
 * Test connection to an MCP server
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { url, headers } = testConnectionSchema.parse(req.body);
    const result = await mcpService.testConnection(url, headers || {});
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    logger.error('Failed to test MCP connection', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

// ============================================================================
// Presets
// ============================================================================

/**
 * GET /api/mcp/presets
 * List available MCP server presets
 */
router.get('/presets', (_req: Request, res: Response) => {
  const presets = Object.entries(MCP_PRESETS).map(([id, preset]) => ({
    id,
    ...preset,
  }));
  res.json({ presets });
});

const addPresetSchema = z.object({
  presetId: z.string(),
});

/**
 * POST /api/mcp/presets/add
 * Add an MCP server from a preset
 */
router.post('/presets/add', async (req: Request, res: Response) => {
  try {
    const { presetId } = addPresetSchema.parse(req.body);

    const preset = MCP_PRESETS[presetId as keyof typeof MCP_PRESETS];
    if (!preset) {
      res.status(404).json({ error: 'Preset not found' });
      return;
    }

    const server = await mcpService.createServer(req.user!.userId, {
      name: preset.name,
      url: preset.url,
      description: preset.description,
      headers: preset.headers,
    });

    // Auto-discover tools
    try {
      await mcpService.discoverTools(server.id);
    } catch (discoverError) {
      logger.warn('Failed to auto-discover tools from preset', { presetId, error: (discoverError as Error).message });
    }

    const serverWithTools = await mcpService.getServer(req.user!.userId, server.id);
    res.status(201).json({ server: serverWithTools });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    logger.error('Failed to add MCP preset', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to add preset' });
  }
});

export default router;
