import Redis from 'ioredis';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err) => {
  logger.error('Redis error', { error: err.message });
});

redis.on('reconnecting', () => {
  logger.warn('Redis reconnecting');
});

// Session state helpers
const SESSION_PREFIX = 'chat:session:';
const SESSION_TTL = 60 * 60 * 2; // 2 hours

export async function setSessionState(sessionId: string, state: Record<string, unknown>): Promise<void> {
  await redis.setex(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL, JSON.stringify(state));
}

export async function getSessionState(sessionId: string): Promise<Record<string, unknown> | null> {
  const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteSessionState(sessionId: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
}

// Rate limiting helpers
const RATE_LIMIT_PREFIX = 'ratelimit:';

export async function incrementRateLimit(userId: string): Promise<number> {
  const key = `${RATE_LIMIT_PREFIX}${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, Math.ceil(config.rateLimit.windowMs / 1000));
  }
  return count;
}

export async function getRateLimitCount(userId: string): Promise<number> {
  const count = await redis.get(`${RATE_LIMIT_PREFIX}${userId}`);
  return count ? parseInt(count, 10) : 0;
}

// Health check
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}

export default redis;
