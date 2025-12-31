/**
 * Router-First Architecture Types
 *
 * The router decides which compute tier handles each message based on:
 * - Intent classification (chat/transform/factual/actionable)
 * - Freshness requirements (needs current data?)
 * - Risk assessment (cost of being wrong)
 *
 * The router NEVER generates text. It only routes.
 */

export type IntentClass = 'chat' | 'transform' | 'factual' | 'actionable';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ConfidenceLevel = 'estimate' | 'verified';
export type Route = 'nano' | 'pro' | 'pro+tools';
export type DecisionSource = 'hard_rule' | 'regex' | 'keyword' | 'classifier';

/**
 * The router's output schema - a fixed, deterministic decision.
 * No free-form text. No reasoning output. No ambiguity.
 */
export interface RouterDecision {
  /** Intent classification */
  class: IntentClass;

  /** Does the answer require current/live data? */
  needs_fresh_data: boolean;

  /** Are tools required to answer correctly? */
  needs_tools: boolean;

  /** What's the cost if the answer is wrong? */
  risk_if_wrong: RiskLevel;

  /** What confidence level is required? */
  confidence_required: ConfidenceLevel;

  /** Which compute tier should handle this? */
  route: Route;

  /** How was this decision made? */
  decision_source: DecisionSource;

  /** Time taken to make the decision (ms) */
  decision_time_ms: number;

  /** Patterns that matched (for debugging) */
  matched_patterns?: string[];
}

/**
 * Configuration for the router
 */
export interface RouterConfig {
  /** Is the router enabled? */
  enabled: boolean;

  /** Model to use for ambiguous classification */
  classifierModel: string;

  /** Provider for the classifier model */
  classifierProvider: 'anthropic' | 'google' | 'groq' | 'openai';

  /** Timeout for classifier calls (ms) */
  classifierTimeoutMs: number;

  /** Maximum time for rules-based routing (ms) */
  rulesTimeoutMs: number;

  /** Default route when uncertain */
  fallbackRoute: Route;
}

/**
 * Context passed to the router for decision-making
 */
export interface RouterContext {
  /** User ID */
  userId: string;

  /** Session ID */
  sessionId: string;

  /** Current session mode */
  mode?: 'assistant' | 'companion' | 'voice';

  /** Source of the message */
  source?: 'web' | 'telegram' | 'api' | 'voice';
}

/**
 * Result of a classification step
 */
export interface ClassificationResult {
  /** The classified intent */
  class: IntentClass;

  /** Confidence in the classification (0-1) */
  confidence: number;

  /** How was this classified? */
  source: DecisionSource;

  /** Patterns that matched */
  matchedPatterns?: string[];
}

/**
 * Result of the freshness check
 */
export interface FreshnessResult {
  /** Does this need fresh/current data? */
  needsFreshData: boolean;

  /** Patterns that indicated freshness requirement */
  matchedPatterns?: string[];
}

/**
 * Result of the risk assessment
 */
export interface RiskResult {
  /** Risk level if answer is wrong */
  riskLevel: RiskLevel;

  /** Patterns that indicated risk */
  matchedPatterns?: string[];
}

/**
 * Provenance metadata for UI display
 */
export interface RouteProvenance {
  /** Which route was used */
  route: Route;

  /** Confidence level */
  confidence: ConfidenceLevel;

  /** Intent class */
  class: IntentClass;
}

/**
 * Default router configuration
 */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  enabled: false,
  classifierModel: 'llama-3.1-8b-instant',
  classifierProvider: 'groq',
  classifierTimeoutMs: 200,
  rulesTimeoutMs: 50,
  fallbackRoute: 'pro+tools',
};
