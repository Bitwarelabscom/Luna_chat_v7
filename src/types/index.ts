import { z } from 'zod';

// User types
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastLogin: z.date().nullable(),
  isActive: z.boolean(),
  settings: z.object({
    theme: z.enum(['light', 'dark']).default('dark'),
    language: z.string().default('en'),
    notifications: z.boolean().default(true),
    defaultMode: z.enum(['assistant', 'companion', 'voice']).default('assistant'),
  }),
});

export type User = z.infer<typeof userSchema>;

export interface UserCreate {
  email: string;
  password: string;
  displayName?: string;
}

// Session types
export const sessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  mode: z.enum(['assistant', 'companion', 'voice']),
  isArchived: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.unknown()),
});

export type Session = z.infer<typeof sessionSchema>;

export interface SessionCreate {
  userId: string;
  title?: string;
  mode?: 'assistant' | 'companion' | 'voice';
}

// Message types
// Metrics for message token tracking
export const messageMetricsSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  processingTimeMs: z.number(),
  tokensPerSecond: z.number(),
  toolsUsed: z.array(z.string()),
  model: z.string(),
}).optional();

export type MessageMetrics = z.infer<typeof messageMetricsSchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  tokensUsed: z.number(),
  model: z.string().nullable(),
  searchResults: z.unknown().nullable(),
  memoryContext: z.unknown().nullable(),
  createdAt: z.date(),
  metrics: messageMetricsSchema,
});

export type Message = z.infer<typeof messageSchema>;

export type MessageSource = 'web' | 'telegram' | 'api';

export interface MessageCreate {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  model?: string;
  provider?: string;
  searchResults?: unknown;
  memoryContext?: unknown;
  source?: MessageSource;
}

// Auth types
export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Chat types
export interface ChatRequest {
  sessionId: string;
  message: string;
  mode?: 'assistant' | 'companion' | 'voice';
}

export interface ChatResponse {
  messageId: string;
  content: string;
  tokensUsed: number;
  searchResults?: SearchResult[];
}

// Search types
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

// MemoryCore types
export interface MemoryContext {
  semanticMemory?: {
    proficiencyModel?: Record<string, unknown>;
    learningStyleModel?: Record<string, unknown>;
    persistentPatterns?: Record<string, unknown>;
  };
  recentPatterns?: Array<{
    type: string;
    pattern: string;
    confidence: number;
  }>;
}

// Express extension
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}
