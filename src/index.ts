import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import { healthCheck as postgresHealth, closePool } from './db/postgres.js';
import { healthCheck as redisHealth, closeRedis } from './db/redis.js';
import { healthCheck as searxngHealth } from './search/searxng.client.js';
import { healthCheck as memorycoreHealth } from './memory/memorycore.client.js';
import { neo4jService, neo4jClient } from './graph/index.js';
import authRoutes from './auth/auth.routes.js';
import chatRoutes from './chat/chat.routes.js';
import abilitiesRoutes from './abilities/abilities.routes.js';
import spotifyOAuthRoutes from './abilities/spotify-oauth.routes.js';
import settingsRoutes from './settings/settings.routes.js';
import oauthRoutes from './integrations/oauth.routes.js';
import localEmailRoutes from './integrations/local-email.routes.js';
import autonomousRoutes from './autonomous/autonomous.routes.js';
import triggersRoutes, { telegramWebhookRouter } from './triggers/triggers.routes.js';
import { clearAllTelegramTimers } from './triggers/telegram.service.js';
import mcpRoutes from './mcp/mcp.routes.js';
import tradingRoutes from './trading/trading.routes.js';
import voiceRoutes from './voice/voice.routes.js';
import projectRoutes from './abilities/project.routes.js';
import activityRoutes from './activity/activity.routes.js';
import backgroundRoutes from './abilities/background.routes.js';
import consciousnessRoutes from './consciousness/consciousness.routes.js';
import editorBridgeRoutes from './editor/editor-bridge.routes.js';
import plannerRoutes from './planner/planner.routes.js';
import { startJobs, stopJobs } from './jobs/job-runner.js';
import { setBroadcastFunction } from './activity/activity.service.js';
import { initializeCritiqueQueue, shutdownCritiqueQueue } from './layered-agent/services/critique-queue.service.js';
import { broadcastActivity, type ActivityPayload } from './triggers/delivery.service.js';
import { ipWhitelistMiddleware } from './security/ip-whitelist.middleware.js';
import { fail2banMiddleware } from './security/fail2ban.middleware.js';
import {
  handleClientConnection as handleTradingWsConnection,
  initializeTradingWebSocket,
  shutdownTradingWebSocket,
} from './trading/trading.websocket.js';
import { handleBrowserWsConnection } from './abilities/browser.websocket.js';
import { handleVoiceWsConnection } from './voice/voice.websocket.js';
import { handleEditorWsUpgrade } from './editor/editor.websocket.js';
import { shutdownHocuspocusServer } from './editor/hocuspocus.server.js';
import { verifyToken } from './auth/jwt.js';
import { isWireGuardRequest, WIREGUARD_USER } from './auth/auth.middleware.js';

const app = express();

// Trust proxy for accurate IP in rate limiting and X-Forwarded-* headers
app.set('trust proxy', 1);

// SECURITY: IP whitelist - block non-whitelisted IPs before any processing
app.use(ipWhitelistMiddleware);

// SECURITY: Fail2ban - block IPs with too many failed login attempts
app.use(fail2banMiddleware);

// SECURITY: HTTPS enforcement in production (skip for WireGuard, health checks, webhooks, and static files)
if (config.nodeEnv === 'production') {
  app.use((req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || '';
    // Skip HTTPS redirect for WireGuard network (10.0.0.x) and Docker internal network (172.x.x.x)
    if (clientIp.includes('10.0.0.') || clientIp.includes('172.')) {
      return next();
    }
    // Skip HTTPS redirect for health check, Telegram webhook, and static images
    // Static files like /api/images/* need to load without redirect for img tags
    if (req.path === '/api/health' ||
        req.path === '/api/triggers/telegram/webhook' ||
        req.path.startsWith('/api/images/')) {
      return next();
    }
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// SECURITY: Helmet with strict CSP (disabled HTTPS upgrade for WireGuard)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // unsafe-inline needed for some UI frameworks
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", config.cors.origin],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null,  // Disable for WireGuard HTTP access
    },
  },
  hsts: false,  // Disable HSTS for WireGuard HTTP access
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    // WireGuard network requests (10.0.0.x) and local hostname only
    if (!origin ||
        origin.includes('10.0.0.') ||
        origin.includes('://luna:') ||
        origin === config.cors.origin) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Static file serving for Luna media (images and videos)
// Override CORP header to allow images to load in any context
import path from 'path';
app.use('/api/images', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(process.cwd(), 'images')));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  next();
});

// Health check endpoint
app.get('/api/health', async (_req, res) => {
  const [postgres, redis, searxng, memorycore, neo4j] = await Promise.all([
    postgresHealth(),
    redisHealth(),
    searxngHealth(),
    memorycoreHealth(),
    neo4jClient.healthCheck(),
  ]);

  const healthy = postgres && redis;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    services: {
      postgres: postgres ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      searxng: searxng ? 'up' : 'down',
      memorycore: memorycore ? 'up' : 'down',
      neo4j: neo4j ? 'up' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
// Spotify OAuth callback - NO AUTH REQUIRED (browser redirect from Spotify)
app.use('/api/abilities/spotify', spotifyOAuthRoutes);
app.use('/api/abilities', abilitiesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/integrations/oauth', oauthRoutes);
app.use('/api/email', localEmailRoutes);
app.use('/api/autonomous', autonomousRoutes);
// Telegram webhook - no auth required (comes from Telegram) - MUST be before authenticated routes
app.use('/api/triggers', telegramWebhookRouter);
app.use('/api/triggers', triggersRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/backgrounds', backgroundRoutes);
app.use('/api/consciousness', consciousnessRoutes);
app.use('/api/editor/bridge', editorBridgeRoutes);
app.use('/api/planner', plannerRoutes);
app.use('/api/consolidation', consciousnessRoutes);  // Consolidation logs share routes

// Connect activity service to delivery service's SSE broadcast
setBroadcastFunction((userId: string, activity) => {
  broadcastActivity(userId, activity as ActivityPayload);
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  stopJobs();
  clearAllTelegramTimers();
  shutdownTradingWebSocket();
  shutdownHocuspocusServer();
  await shutdownCritiqueQueue();
  await neo4jService.close();
  await closePool();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Create HTTP server
const server = createServer(app);

// Create WebSocket server for trading
const wss = new WebSocketServer({ noServer: true });

// Create WebSocket server for browser
const browserWss = new WebSocketServer({ noServer: true });

// Create WebSocket server for voice
const voiceWss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  // 1. Auto-authenticate trusted requests (WireGuard/Docker)
  if (isWireGuardRequest(request)) {
    (request as any).user = WIREGUARD_USER;
  } else {
    // 2. Extract auth from cookie for other requests
    const cookieHeader = request.headers.cookie || '';
    const token = cookieHeader
      .split(';')
      .map(c => c.trim())
      .find(c => c.startsWith('accessToken='))
      ?.split('=')[1] || null;

    if (token) {
      try {
        const payload = verifyToken(token);
        (request as any).user = payload;
      } catch (e) {
        logger.debug('WS upgrade token verification failed', { error: (e as Error).message });
      }
    }
  }

  if (pathname === '/ws/trading') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/browser') {
    browserWss.handleUpgrade(request, socket, head, (ws) => {
      handleBrowserWsConnection(ws, request);
    });
  } else if (pathname === '/ws/voice') {
    voiceWss.handleUpgrade(request, socket, head, (ws) => {
      handleVoiceWsConnection(ws, request);
    });
  } else if (pathname === '/ws/editor') {
    // Hocuspocus handles the upgrade internally
    handleEditorWsUpgrade(request, socket, head);
  } else {
    // Reject unknown WebSocket paths
    socket.destroy();
  }
});

// Handle WebSocket connections
wss.on('connection', (ws: WebSocket) => {
  handleTradingWsConnection(ws);
});

// Start server
server.listen(config.port, () => {
  logger.info(`Luna Chat API running on port ${config.port}`, {
    env: config.nodeEnv,
    memorycore: config.memorycore.enabled ? 'enabled' : 'disabled',
    searxng: config.searxng.enabled ? 'enabled' : 'disabled',
  });

  // Initialize trading WebSocket (connect to Binance)
  initializeTradingWebSocket();

  // Initialize background critique queue (fast path feature)
  initializeCritiqueQueue();

  // Start background jobs
  startJobs();

  // Initialize Neo4j (schema and connectivity)
  neo4jService.initialize().catch(err => {
    logger.error('Failed to initialize Neo4j on startup', { error: err.message });
  });
});

export default app;
