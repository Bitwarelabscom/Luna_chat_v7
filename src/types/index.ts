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
    defaultMode: z.enum(['assistant', 'companion', 'voice', 'dj_luna']).default('assistant'),
  }),
});

export type User = z.infer<typeof userSchema>;

export interface UserCreate {
  email: string;
  password: string;
  displayName?: string;
}

// Session types
export const intentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  confidenceScore: z.number(),
  status: z.enum(['active', 'dormant', 'closed']),
  createdAt: z.date(),
  lastActiveAt: z.date(),
  metadata: z.record(z.unknown()),
});

export type Intent = z.infer<typeof intentSchema>;

export const sessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  mode: z.enum(['assistant', 'companion', 'voice', 'dj_luna']),
  isArchived: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.unknown()),
  primaryIntentId: z.string().uuid().nullable().optional(),
  secondaryIntentIds: z.array(z.string().uuid()).optional(),
});

export type Session = z.infer<typeof sessionSchema>;

export interface SessionCreate {
  userId: string;
  title?: string;
  mode?: 'assistant' | 'companion' | 'voice' | 'dj_luna';
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

// Attachment types
export interface MessageAttachment {
  id: string;
  documentId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: 'processing' | 'ready' | 'error';
  analysisPreview?: string;
}

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
  attachments: z.array(z.custom<MessageAttachment>()).optional(),
  attachmentMetadata: z.unknown().nullable().optional(),
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
  routeDecision?: unknown;  // Router-First Architecture decision metadata
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
  mode?: 'assistant' | 'companion' | 'voice' | 'dj_luna';
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
  consciousness?: ConsciousnessMetrics;
}

// Consciousness metrics from NeuralSleep
export interface ConsciousnessMetrics {
  phi: number;                    // Integrated Information (Φ)
  selfReferenceDepth: number;     // Self-model recursion depth
  temporalIntegration: number;    // Past-present-future coherence
  causalDensity: number;          // Causal connections density
  dynamicalComplexity?: number;   // System complexity measure
  consciousnessLevel?: string;    // Human-readable level
  isConscious?: boolean;          // Φ > threshold
  // Dual-LNN metrics
  thematicStability?: number;     // LNN-A convergence on theme (0-1)
  relationalCoherence?: number;   // LNN-B connection strength (0-1)
  crossStreamFlow?: number;       // Mutual information between A and B
}

// Consolidated user model from NeuralSleep LNN
export interface ConsolidatedUserModel {
  userId: string;
  lastUpdated: Date;
  semanticKnowledge: {
    proficiencyModel?: Record<string, unknown>;
    learningStyleModel?: Record<string, unknown>;
    persistentPatterns?: Record<string, unknown>;
  };
  episodicPatterns: Array<{
    type: string;
    pattern: string;
    confidence: number;
    occurrences: number;
  }>;
  consciousness: ConsciousnessMetrics;
  // Dual-LNN promoted knowledge
  preferences?: Array<{
    theme: string;
    centroid: number[];
    valence: number;
    confidence: number;
    sessionCount: number;
  }>;
  knownFacts?: Array<{
    theme: string;
    centroid: number[];
    confidence: number;
    sessionCount: number;
  }>;
  thematicClusters?: Array<{
    centroid: number[];
    size: number;
    spanSessions: number;
    avgValence: number;
    lastSeen: Date;
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
