import { z } from 'zod';
import dotenv from 'dotenv';
import { getOptionalSecret } from '../utils/secrets';

dotenv.config();

// Load secrets from Docker secrets or environment variables
const secrets = {
  postgresPassword: getOptionalSecret('postgres_password', 'POSTGRES_PASSWORD') || '',
  jwtSecret: getOptionalSecret('jwt_secret', 'JWT_SECRET') || '',
  redisPassword: getOptionalSecret('redis_password', 'REDIS_PASSWORD'),
  openaiApiKey: getOptionalSecret('openai_api_key', 'OPENAI_API_KEY') || '',
  groqApiKey: getOptionalSecret('groq_api_key', 'GROQ_API_KEY'),
  anthropicApiKey: getOptionalSecret('anthropic_api_key', 'ANTHROPIC_API_KEY'),
  xaiApiKey: getOptionalSecret('xai_api_key', 'XAI_API_KEY'),
  encryptionKey: getOptionalSecret('encryption_key', 'ENCRYPTION_KEY'),
};

const configSchema = z.object({
  port: z.coerce.number().default(3003),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  postgres: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(5432),
    user: z.string().default('luna'),
    password: z.string(),
    database: z.string().default('luna_chat'),
    sslEnabled: z.coerce.boolean().default(true),
    sslRejectUnauthorized: z.coerce.boolean().default(true),
    sslCa: z.string().optional(),
    dockerHost: z.string().default('http://docker-proxy:2375'),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),

  jwt: z.object({
    secret: z.string().min(32),
    expiresIn: z.string().default('7d'),
    refreshExpiresIn: z.string().default('30d'),
  }),

  openai: z.object({
    apiKey: z.string(),
    model: z.string().default('gpt-5.1-chat-latest'),
  }),

  groq: z.object({
    apiKey: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  anthropic: z.object({
    apiKey: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  xai: z.object({
    apiKey: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  memorycore: z.object({
    url: z.string().url(),
    enabled: z.coerce.boolean().default(true),
  }),

  searxng: z.object({
    url: z.string().url(),
    enabled: z.coerce.boolean().default(true),
  }),

  rateLimit: z.object({
    windowMs: z.coerce.number().default(60000),
    maxRequests: z.coerce.number().default(40),
  }),

  cors: z.object({
    origin: z.string().default('http://localhost:3000'),
  }),

  encryptionKey: z.string().min(64, 'Encryption key must be a 64 character hex string'),
});

const rawConfig = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,

  postgres: {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: secrets.postgresPassword,
    database: process.env.POSTGRES_DB,
    sslEnabled: process.env.POSTGRES_SSL_ENABLED,
    sslRejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED,
    sslCa: process.env.POSTGRES_SSL_CA,
    dockerHost: process.env.DOCKER_HOST,
  },

  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: secrets.redisPassword,
  },

  jwt: {
    secret: secrets.jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  },

  openai: {
    apiKey: secrets.openaiApiKey,
    model: process.env.OPENAI_MODEL,
  },

  groq: {
    apiKey: secrets.groqApiKey,
    enabled: process.env.GROQ_ENABLED,
  },

  anthropic: {
    apiKey: secrets.anthropicApiKey,
    enabled: process.env.ANTHROPIC_ENABLED,
  },

  xai: {
    apiKey: secrets.xaiApiKey,
    enabled: process.env.XAI_ENABLED,
  },

  memorycore: {
    url: process.env.MEMORYCORE_URL,
    enabled: process.env.MEMORYCORE_ENABLED,
  },

  searxng: {
    url: process.env.SEARXNG_URL,
    enabled: process.env.SEARXNG_ENABLED,
  },

  rateLimit: {
    windowMs: process.env.RATE_LIMIT_WINDOW_MS,
    maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS,
  },

  cors: {
    origin: process.env.CORS_ORIGIN,
  },

  encryptionKey: secrets.encryptionKey,
};

export const config = configSchema.parse(rawConfig);
export type Config = z.infer<typeof configSchema>;
