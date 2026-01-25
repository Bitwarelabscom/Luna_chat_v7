// ============================================
// Intent Types - Core interfaces for intent persistence
// ============================================

/**
 * Intent type categories
 * - task: Specific action to complete (debugging, fixing, implementing)
 * - goal: Longer-term objective (learning, building, achieving)
 * - exploration: Open-ended curiosity (researching, understanding)
 * - companion: Social/emotional need (venting, discussing, companionship)
 */
export type IntentType = 'task' | 'goal' | 'exploration' | 'companion';

/**
 * Intent lifecycle status
 * - active: Currently being worked on
 * - suspended: Paused (too many intents, or user switched focus)
 * - resolved: Completed, abandoned, merged, or superseded
 * - decayed: Untouched for decay period (7 days default)
 */
export type IntentStatus = 'active' | 'suspended' | 'resolved' | 'decayed';

/**
 * Intent priority levels
 * - high: User explicitly prioritized or urgent (max 3 allowed)
 * - medium: Default priority
 * - low: Background or less urgent
 */
export type IntentPriority = 'high' | 'medium' | 'low';

/**
 * Resolution type when intent is resolved
 */
export type ResolutionType = 'completed' | 'abandoned' | 'merged' | 'superseded';

/**
 * Relation types between intents
 */
export type IntentRelationType = 'blocks' | 'depends_on' | 'related_to' | 'supersedes';

/**
 * Touch type for tracking how an intent was engaged
 */
export type IntentTouchType = 'explicit' | 'implicit' | 'progress' | 'blocker' | 'approach_change';

/**
 * Core intent interface
 */
export interface Intent {
  id: string;
  userId: string;
  type: IntentType;
  label: string;
  status: IntentStatus;
  priority: IntentPriority;
  createdAt: Date;
  lastTouchedAt: Date;
  touchCount: number;
  goal: string;
  constraints: string[];
  triedApproaches: string[];
  currentApproach: string | null;
  blockers: string[];
  emotionalContext: string | null;
  parentIntentId: string | null;
  resolvedAt: Date | null;
  resolutionType: ResolutionType | null;
  sourceSessionId: string | null;
  updatedAt: Date;
}

/**
 * Intent summary for cache and context
 */
export interface IntentSummary {
  id: string;
  type: IntentType;
  label: string;
  status: IntentStatus;
  priority: IntentPriority;
  goal: string;
  currentApproach: string | null;
  blockers: string[];
  lastTouchedAt: Date;
  touchCount: number;
}

/**
 * Intent relation
 */
export interface IntentRelation {
  id: string;
  fromIntentId: string;
  toIntentId: string;
  relationType: IntentRelationType;
  createdAt: Date;
}

/**
 * Intent touch record
 */
export interface IntentTouch {
  id: string;
  intentId: string;
  sessionId: string | null;
  messageSnippet: string | null;
  touchType: IntentTouchType;
  createdAt: Date;
}

/**
 * Create intent input
 */
export interface CreateIntentInput {
  userId: string;
  type: IntentType;
  label: string;
  goal: string;
  priority?: IntentPriority;
  constraints?: string[];
  currentApproach?: string;
  emotionalContext?: string;
  parentIntentId?: string;
  sourceSessionId?: string;
}

/**
 * Update intent input
 */
export interface UpdateIntentInput {
  label?: string;
  status?: IntentStatus;
  priority?: IntentPriority;
  goal?: string;
  constraints?: string[];
  currentApproach?: string | null;
  blockers?: string[];
  emotionalContext?: string | null;
  resolutionType?: ResolutionType;
}

/**
 * Intent signal detected from user message
 */
export interface IntentSignal {
  action: 'create' | 'update' | 'resolve' | 'switch' | 'suspend';
  confidence: number;
  type?: IntentType;
  label?: string;
  goal?: string;
  updates?: Partial<UpdateIntentInput>;
  matchedIntentId?: string;
  triggerType: 'explicit' | 'implicit';
  matchedPattern?: string;
}

/**
 * Intent context for prompt injection
 */
export interface IntentContext {
  activeIntents: IntentSummary[];
  suspendedIntents: IntentSummary[];
  recentlyResolved: IntentSummary[];
}

/**
 * Cross-session recovery settings
 */
export interface IntentRecoveryConfig {
  maxHighPriorityShown: number;  // Default: 3
  maxMediumPriorityShown: number;  // Default: 2
  mediumPriorityMaxAgeDays: number;  // Default: 2 (48h)
}

/**
 * Intent merge candidate
 */
export interface IntentMergeCandidate {
  existingIntent: Intent;
  newIntent: Partial<CreateIntentInput>;
  similarityScore: number;
  suggestedAction: 'merge' | 'create_separate' | 'update_existing';
}

/**
 * Default configuration values
 */
export const INTENT_DEFAULTS = {
  // Confidence thresholds
  EXPLICIT_MIN_CONFIDENCE: 0.85,  // No confirmation needed
  IMPLICIT_MIN_CONFIDENCE: 0.6,   // May require confirmation
  LOG_ONLY_THRESHOLD: 0.6,        // Below this, just log

  // Similarity for merging
  MERGE_SIMILARITY_THRESHOLD: 0.85,

  // Limits
  MAX_ACTIVE_INTENTS: 5,
  MAX_HIGH_PRIORITY: 3,
  MAX_HIERARCHY_DEPTH: 2,

  // Recovery
  RECOVERY_HIGH_PRIORITY_MAX: 3,
  RECOVERY_MEDIUM_PRIORITY_MAX: 2,
  RECOVERY_MEDIUM_MAX_AGE_HOURS: 48,

  // Decay
  DECAY_DAYS: 7,
  AUTO_SUSPEND_MESSAGES: 10,  // Suspend if not referenced in N messages

  // Cache
  REDIS_CACHE_TTL_SECONDS: 7200,  // 2 hours
} as const;
