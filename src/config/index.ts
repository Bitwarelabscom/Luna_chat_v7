import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  port: z.coerce.number().default(3003),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  postgres: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(5432),
    user: z.string().default('luna'),
    password: z.string(),
    database: z.string().default('luna_chat'),
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
});

const rawConfig = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,

  postgres: {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  },

  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY,
    enabled: process.env.GROQ_ENABLED,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    enabled: process.env.ANTHROPIC_ENABLED,
  },

  xai: {
    apiKey: process.env.XAI_API_KEY,
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
};

export const config = configSchema.parse(rawConfig);
export type Config = z.infer<typeof configSchema>;
