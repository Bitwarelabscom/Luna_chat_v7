/**
 * Router-First Architecture
 *
 * Compute arbitration for trustworthy AI responses.
 *
 * The router exists to solve one problem:
 * > Do not answer a question cheaply if being wrong has a real cost.
 *
 * The router decides:
 * - Which model is allowed to answer
 * - Whether tools are mandatory
 * - What confidence contract applies
 *
 * The router NEVER generates text.
 * It does NOT help.
 * It only routes.
 */

// Main routing function
export { route, quickRouteCheck, isEnabled, getDefaultConfig } from './router.service.js';

// Types
export type {
  RouterDecision,
  RouterConfig,
  RouterContext,
  Route,
  IntentClass,
  RiskLevel,
  ConfidenceLevel,
  DecisionSource,
  RouteProvenance,
} from './router.types.js';

export { DEFAULT_ROUTER_CONFIG } from './router.types.js';

// Individual rule modules (for testing)
export { shouldHardEscalate, checkHardEscalation, isPrimaryGreeting } from './rules/hard-escalation.js';
export { classifyIntent, isConfidentClassification, CLASSIFIER_CONFIDENCE_THRESHOLD } from './rules/intent-classifier.js';
export { checkFreshness, obviouslyNeedsFreshData, obviouslyStatic } from './rules/freshness-check.js';
export { assessRisk, obviouslyHighRisk, obviouslyLowRisk } from './rules/risk-assessment.js';
export { determineRoute, quickRoute, validateRoute } from './rules/route-decision.js';
