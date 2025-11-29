import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import { healthCheck as postgresHealth, closePool } from './db/postgres.js';
import { healthCheck as redisHealth, closeRedis } from './db/redis.js';
import { healthCheck as searxngHealth } from './search/searxng.client.js';
import { healthCheck as memorycoreHealth } from './memory/memorycore.client.js';
import authRoutes from './auth/auth.routes.js';
import chatRoutes from './chat/chat.routes.js';
import abilitiesRoutes from './abilities/abilities.routes.js';
import settingsRoutes from './settings/settings.routes.js';

const app = express();

// Trust proxy for accurate IP in rate limiting and X-Forwarded-* headers
app.set('trust proxy', 1);

// SECURITY: HTTPS enforcement in production (skip for health checks)
if (config.nodeEnv === 'production') {
  app.use((req, res, next) => {
    // Skip HTTPS redirect for health check endpoint (used by Docker)
    if (req.path === '/api/health') {
      return next();
    }
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// SECURITY: Helmet with strict CSP and HSTS
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
    },
  },
  hsts: {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

app.use(cors({
  origin: config.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

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
  const [postgres, redis, searxng, memorycore] = await Promise.all([
    postgresHealth(),
    redisHealth(),
    searxngHealth(),
    memorycoreHealth(),
  ]);

  const healthy = postgres && redis;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    services: {
      postgres: postgres ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      searxng: searxng ? 'up' : 'down',
      memorycore: memorycore ? 'up' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/abilities', abilitiesRoutes);
app.use('/api/settings', settingsRoutes);

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
  await closePool();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
app.listen(config.port, () => {
  logger.info(`Luna Chat API running on port ${config.port}`, {
    env: config.nodeEnv,
    memorycore: config.memorycore.enabled ? 'enabled' : 'disabled',
    searxng: config.searxng.enabled ? 'enabled' : 'disabled',
  });
});

export default app;
