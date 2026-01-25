/**
 * Context Summary Types
 * Types for on-demand context loading via Redis-stored summaries
 */

// ============================================
// Session Summary Types
// ============================================

/**
 * Rich session summary stored in Redis
 * Generated when sessions end (timeout/close/delete)
 */
export interface SessionSummary {
  sessionId: string;
  userId: string;

  // Basic info
  title: string;
  oneLiner: string;  // Max 15 words

  // Topics and search
  topics: string[];
  keywords: string[];

  // Detailed summary
  summary: string;  // 2-3 sentences

  // Key outcomes
  decisions: string[];  // Decisions made during session
  openQuestions: string[];  // Unresolved questions
  actionItems: string[];  // Tasks/todos mentioned

  // Emotional context
  moodArc: string;  // e.g., "started frustrated, ended relieved"
  energyEnd: 'high' | 'medium' | 'low';

  // Artifacts created
  artifacts: SessionArtifact[];

  // Intent tracking
  intentsActive: string[];  // Intent IDs touched
  intentsResolved: string[];  // Intent IDs resolved

  // Metadata
  messageCount: number;
  toolsUsed: string[];
  startedAt: Date;
  endedAt: Date;
  generatedAt: Date;
}

export interface SessionArtifact {
  type: 'file' | 'code' | 'task' | 'knowledge' | 'calendar_event' | 'email';
  name: string;
  description?: string;
}

// ============================================
// Intent Context Summary Types
// ============================================

/**
 * Intent summary for context loading
 * Different from IntentSummary in intent.types.ts - this is for context retrieval
 */
export interface IntentContextSummary {
  intentId: string;
  userId: string;

  // Basic info from intent
  type: 'task' | 'goal' | 'exploration' | 'companion';
  label: string;
  goal: string;
  status: 'active' | 'suspended' | 'resolved' | 'decayed';
  priority: 'high' | 'medium' | 'low';

  // Generated context summary
  contextSummary: string;  // What is this intent about, in context

  // Progress tracking
  decisions: string[];  // Key decisions made
  approachesTried: string[];  // What we've tried
  currentApproach: string | null;  // Current strategy
  blockers: string[];  // Current blockers

  // Session history
  relatedSessions: RelatedSessionRef[];

  // Metadata
  createdAt: Date;
  lastTouchedAt: Date;
  touchCount: number;
  generatedAt: Date;
}

export interface RelatedSessionRef {
  sessionId: string;
  title: string;
  summary: string;
  touchedAt: Date;
}

// ============================================
// Load Context Tool Types
// ============================================

/**
 * Parameters for load_context tool
 */
export interface LoadContextParams {
  intent_id?: string;  // Specific intent ID to load
  session_id?: string;  // Specific session ID to load
  query?: string;  // Search query to find relevant context
  depth?: 'brief' | 'summary' | 'detailed';
}

/**
 * Result from load_context tool
 */
export interface LoadContextResult {
  success: boolean;

  // Loaded context
  sessions?: SessionSummaryBrief[];
  intents?: IntentContextBrief[];

  // Search results (if query was provided)
  searchResults?: ContextSearchResult[];

  // Error info
  error?: string;
}

/**
 * Brief session summary for context loading (depth=brief)
 */
export interface SessionSummaryBrief {
  sessionId: string;
  title: string;
  oneLiner: string;
  topics: string[];
  startedAt: Date;
}

/**
 * Brief intent summary for context loading (depth=brief)
 */
export interface IntentContextBrief {
  intentId: string;
  label: string;
  goal: string;
  status: string;
  currentApproach: string | null;
  blockers: string[];
}

/**
 * Search result for context queries
 */
export interface ContextSearchResult {
  type: 'session' | 'intent';
  id: string;
  title: string;
  snippet: string;
  keywords: string[];
  relevance: number;  // 0-1 score
  timestamp: Date;
}

// ============================================
// Correct Summary Tool Types
// ============================================

/**
 * Parameters for correct_summary tool
 */
export interface CorrectSummaryParams {
  type: 'session' | 'intent';
  id: string;
  field: 'decision' | 'approach' | 'blocker' | 'summary';
  correction: string;
}

/**
 * Result from correct_summary tool
 */
export interface CorrectSummaryResult {
  success: boolean;
  message: string;
  previousValue?: string;
  newValue?: string;
}

// ============================================
// Redis Key Patterns
// ============================================

/**
 * Redis key patterns for context summaries
 * TTLs:
 * - Session summaries: 90 days
 * - Active intent summaries: No TTL
 * - Resolved intent summaries: 180 days
 * - Decayed intent summaries: 30 days
 */
export const CONTEXT_REDIS_KEYS = {
  SESSION_SUMMARY: (userId: string, sessionId: string) =>
    `luna:${userId}:summaries:session:${sessionId}`,

  INTENT_SUMMARY: (userId: string, intentId: string) =>
    `luna:${userId}:summaries:intent:${intentId}`,

  RECENT_SESSIONS: (userId: string) =>
    `luna:${userId}:summaries:recent`,

  SEARCH_INDEX: (userId: string) =>
    `luna:${userId}:summaries:search_index`,
} as const;

/**
 * TTL values in seconds
 */
export const CONTEXT_TTLS = {
  SESSION_SUMMARY: 90 * 24 * 60 * 60,  // 90 days
  INTENT_ACTIVE: -1,  // No TTL (persist indefinitely)
  INTENT_RESOLVED: 180 * 24 * 60 * 60,  // 180 days
  INTENT_DECAYED: 30 * 24 * 60 * 60,  // 30 days
  RECENT_SESSIONS_LIST: 90 * 24 * 60 * 60,  // 90 days
  SEARCH_INDEX: 90 * 24 * 60 * 60,  // 90 days
} as const;

/**
 * Maximum items in recent sessions list
 */
export const MAX_RECENT_SESSIONS = 20;
