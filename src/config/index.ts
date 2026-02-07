import { z } from 'zod';
import dotenv from 'dotenv';
import { getOptionalSecret } from '../utils/secrets';

dotenv.config();

// Load secrets from Docker secrets or environment variables
const secrets = {
  postgresPassword: getOptionalSecret('postgres_password', 'POSTGRES_PASSWORD') || '',
  jwtSecret: getOptionalSecret('jwt_secret', 'JWT_SECRET') || '',
  redisPassword: getOptionalSecret('redis_password', 'REDIS_PASSWORD'),
  neo4jPassword: getOptionalSecret('neo4j_password', 'NEO4J_PASSWORD'),
  openaiApiKey: getOptionalSecret('openai_api_key', 'OPENAI_API_KEY') || '',
  moonshotApiKey: getOptionalSecret('moonshot_api_key', 'MOONSHOT_API_KEY'),
  groqApiKey: getOptionalSecret('groq_api_key', 'GROQ_API_KEY'),
  anthropicApiKey: getOptionalSecret('anthropic_api_key', 'ANTHROPIC_API_KEY'),
  xaiApiKey: getOptionalSecret('xai_api_key', 'XAI_API_KEY'),
  openrouterApiKey: getOptionalSecret('openrouter_api_key', 'OPENROUTER_API_KEY'),
  encryptionKey: getOptionalSecret('encryption_key', 'ENCRYPTION_KEY'),
  googleClientId: getOptionalSecret('google_client_id', 'GOOGLE_CLIENT_ID'),
  googleClientSecret: getOptionalSecret('google_client_secret', 'GOOGLE_CLIENT_SECRET'),
  microsoftClientId: getOptionalSecret('microsoft_client_id', 'MICROSOFT_CLIENT_ID'),
  microsoftClientSecret: getOptionalSecret('microsoft_client_secret', 'MICROSOFT_CLIENT_SECRET'),
  emailPassword: getOptionalSecret('email_password', 'EMAIL_PASSWORD'),
  googleApiKey: getOptionalSecret('google_api_key', 'GOOGLE_API_KEY'),
  elevenlabsApiKey: getOptionalSecret('elevenlabs_api_key', 'ELEVENLABS_API_KEY'),
  spotifyClientId: getOptionalSecret('spotify_client_id', 'SPOTIFY_CLIENT_ID'),
  spotifyClientSecret: getOptionalSecret('spotify_client_secret', 'SPOTIFY_CLIENT_SECRET'),
};

const configSchema = z.object({
  port: z.coerce.number().default(3003),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Layered Agent Architecture feature flag
  agentEngine: z.enum(['legacy', 'layered_v1']).default('legacy'),

  // Router-First Architecture feature flag
  router: z.object({
    enabled: z.coerce.boolean().default(false),
    classifierModel: z.string().default('llama-3.1-8b-instant'),
    classifierProvider: z.enum(['anthropic', 'google', 'groq', 'openai']).default('groq'),
    classifierTimeoutMs: z.coerce.number().default(200),
    rulesTimeoutMs: z.coerce.number().default(50),
    fallbackRoute: z.enum(['nano', 'pro', 'pro+tools']).default('pro+tools'),
  }).optional(),

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

  moonshot: z.object({
    apiKey: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

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

  openrouter: z.object({
    apiKey: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  google: z.object({
    apiKey: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  sanhedrin: z.object({
    baseUrl: z.string().url().default('http://localhost:8000'),
    timeout: z.coerce.number().default(120000),
    enabled: z.coerce.boolean().default(false),
  }).optional(),

  elevenlabs: z.object({
    apiKey: z.string().optional(),
    voiceId: z.string().default('21m00Tcm4TlvDq8ikWAM'),  // Rachel - warm, calm voice
    model: z.string().default('eleven_v3'),  // v3 for best emotion tag support
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  memorycore: z.object({
    url: z.string().url(),
    enabled: z.coerce.boolean().default(true),
    consciousnessEnabled: z.coerce.boolean().default(true),
    phiThreshold: z.coerce.number().default(0.5),
  }),

  neo4j: z.object({
    uri: z.string().default('bolt://luna-neo4j:7687'),
    user: z.string().default('neo4j'),
    password: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

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

  oauth: z.object({
    google: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      enabled: z.coerce.boolean().default(false),
    }),
    microsoft: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      tenantId: z.string().default('common'),
      enabled: z.coerce.boolean().default(false),
    }),
    callbackBaseUrl: z.string().default('http://localhost:3003'),
  }),

  email: z.object({
    smtp: z.object({
      host: z.string().default('localhost'),
      port: z.coerce.number().default(587),
      secure: z.coerce.boolean().default(false),
      user: z.string().default('luna@bitwarelabs.com'),
      password: z.string().optional(),
    }),
    imap: z.object({
      host: z.string().default('imap.example.com'),
      port: z.coerce.number().default(993),
      secure: z.coerce.boolean().default(true),
      user: z.string().default('luna@example.com'),
      password: z.string().optional(),
    }),
    from: z.string().default('Luna <luna@example.com>'),
    approvedRecipients: z.array(z.string()).default([]),
    enabled: z.coerce.boolean().default(true),
    gatekeeper: z.object({
      enabled: z.coerce.boolean().default(true),
      trustedSenders: z.array(z.string()).default([]),
      riskThreshold: z.coerce.number().min(0).max(1).default(0.5),
      model: z.string().default('qwen2.5:3b'),
      classifierTimeoutMs: z.coerce.number().default(15000),
    }).optional(),
  }),

  ollama: z.object({
    url: z.string().url().default('http://localhost:11434'),
    embeddingModel: z.string().default('bge-m3'),
    chatModel: z.string().default('qwen2.5:3b'),
  }),

  ollamaSecondary: z.object({
    url: z.string().url().default('http://10.0.0.3:11434'),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  orchestration: z.object({
    maxConcurrency: z.coerce.number().min(1).max(10).default(3),
    maxRetries: z.coerce.number().min(0).max(10).default(3),
    enableSummarization: z.coerce.boolean().default(true),
    intentCacheTtl: z.coerce.number().min(60).default(3600),
  }).optional(),

  radicale: z.object({
    url: z.string().url().default('http://localhost:5232'),
    enabled: z.coerce.boolean().default(true),
  }),

  spotify: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    enabled: z.coerce.boolean().default(true),
  }).optional(),

  stt: z.object({
    provider: z.enum(['openai', 'groq', 'local']).default('openai'),
    model: z.string().default('whisper-1'),
    language: z.string().optional(),
    silenceDetection: z.coerce.boolean().default(true),
    silenceThreshold: z.coerce.number().default(-50), // dB
    silenceDuration: z.coerce.number().default(700), // ms
  }),
});

const rawConfig = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  agentEngine: process.env.AGENT_ENGINE,

  router: process.env.ROUTER_ENABLED ? {
    enabled: process.env.ROUTER_ENABLED,
    classifierModel: process.env.ROUTER_CLASSIFIER_MODEL,
    classifierProvider: process.env.ROUTER_CLASSIFIER_PROVIDER,
    classifierTimeoutMs: process.env.ROUTER_CLASSIFIER_TIMEOUT_MS,
    rulesTimeoutMs: process.env.ROUTER_RULES_TIMEOUT_MS,
    fallbackRoute: process.env.ROUTER_FALLBACK_ROUTE,
  } : undefined,

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

  moonshot: {
    apiKey: secrets.moonshotApiKey,
    enabled: process.env.MOONSHOT_ENABLED,
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

  openrouter: {
    apiKey: secrets.openrouterApiKey,
    enabled: process.env.OPENROUTER_ENABLED,
  },

  google: {
    apiKey: secrets.googleApiKey,
    enabled: process.env.GOOGLE_ENABLED,
  },

  sanhedrin: {
    baseUrl: process.env.SANHEDRIN_BASE_URL,
    timeout: process.env.SANHEDRIN_TIMEOUT,
    enabled: process.env.SANHEDRIN_ENABLED,
  },

  elevenlabs: {
    apiKey: secrets.elevenlabsApiKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    model: process.env.ELEVENLABS_MODEL,
    enabled: process.env.ELEVENLABS_ENABLED,
  },

  memorycore: {
    url: process.env.MEMORYCORE_URL,
    enabled: process.env.MEMORYCORE_ENABLED,
    consciousnessEnabled: process.env.MEMORYCORE_CONSCIOUSNESS_ENABLED,
    phiThreshold: process.env.MEMORYCORE_PHI_THRESHOLD,
  },

  neo4j: {
    uri: process.env.NEO4J_URI,
    user: process.env.NEO4J_USER,
    password: secrets.neo4jPassword,
    enabled: process.env.NEO4J_ENABLED,
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

  oauth: {
    google: {
      clientId: secrets.googleClientId,
      clientSecret: secrets.googleClientSecret,
      enabled: process.env.GOOGLE_OAUTH_ENABLED,
    },
    microsoft: {
      clientId: secrets.microsoftClientId,
      clientSecret: secrets.microsoftClientSecret,
      tenantId: process.env.MICROSOFT_TENANT_ID,
      enabled: process.env.MICROSOFT_OAUTH_ENABLED,
    },
    callbackBaseUrl: process.env.OAUTH_CALLBACK_BASE_URL,
  },

  email: {
    smtp: {
      host: process.env.EMAIL_SMTP_HOST,
      port: process.env.EMAIL_SMTP_PORT,
      secure: process.env.EMAIL_SMTP_SECURE,
      user: process.env.EMAIL_SMTP_USER,
      password: secrets.emailPassword,
    },
    imap: {
      host: process.env.EMAIL_IMAP_HOST,
      port: process.env.EMAIL_IMAP_PORT,
      secure: process.env.EMAIL_IMAP_SECURE,
      user: process.env.EMAIL_IMAP_USER,
      password: secrets.emailPassword,
    },
    from: process.env.EMAIL_FROM,
    approvedRecipients: process.env.EMAIL_APPROVED_RECIPIENTS?.split(',').map(e => e.trim()).filter(Boolean) || [],
    enabled: process.env.EMAIL_ENABLED,
    gatekeeper: {
      enabled: process.env.EMAIL_GATEKEEPER_ENABLED ?? 'true',
      trustedSenders: process.env.EMAIL_TRUSTED_SENDERS?.split(',').map(e => e.trim()).filter(Boolean) || [],
      riskThreshold: process.env.EMAIL_GATEKEEPER_RISK_THRESHOLD,
      model: process.env.EMAIL_GATEKEEPER_MODEL,
      classifierTimeoutMs: process.env.EMAIL_GATEKEEPER_CLASSIFIER_TIMEOUT_MS,
    },
  },

  ollama: {
    url: process.env.OLLAMA_URL,
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
    chatModel: process.env.OLLAMA_CHAT_MODEL,
  },

  ollamaSecondary: {
    url: process.env.OLLAMA_SECONDARY_URL,
    enabled: process.env.OLLAMA_SECONDARY_ENABLED,
  },

  orchestration: process.env.ORCHESTRATION_MAX_CONCURRENCY ? {
    maxConcurrency: process.env.ORCHESTRATION_MAX_CONCURRENCY,
    maxRetries: process.env.ORCHESTRATION_MAX_RETRIES,
    enableSummarization: process.env.ORCHESTRATION_ENABLE_SUMMARIZATION,
    intentCacheTtl: process.env.ORCHESTRATION_INTENT_CACHE_TTL,
  } : undefined,

  radicale: {
    url: process.env.RADICALE_URL,
    enabled: process.env.RADICALE_ENABLED,
  },

  spotify: {
    clientId: secrets.spotifyClientId,
    clientSecret: secrets.spotifyClientSecret,
    enabled: process.env.SPOTIFY_ENABLED,
  },

  stt: {
    provider: process.env.STT_PROVIDER,
    model: process.env.STT_MODEL,
    language: process.env.STT_LANGUAGE,
    silenceDetection: process.env.STT_SILENCE_DETECTION,
    silenceThreshold: process.env.STT_SILENCE_THRESHOLD,
    silenceDuration: process.env.STT_SILENCE_DURATION,
  },
};

export const config = configSchema.parse(rawConfig);
export type Config = z.infer<typeof configSchema>;
