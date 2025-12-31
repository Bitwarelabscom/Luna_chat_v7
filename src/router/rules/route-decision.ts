/**
 * Route Decision - Step 4
 *
 * Determines the final route based on classification, freshness, and risk.
 *
 * Decision matrix:
 * | Class      | Fresh Data | Risk   | Route       |
 * |------------|------------|--------|-------------|
 * | actionable | yes        | any    | pro+tools   |
 * | any        | any        | high   | pro+tools   |
 * | factual    | yes        | any    | pro+tools   |
 * | any        | any        | medium | pro         |
 * | chat       | no         | low    | nano        |
 * | transform  | no         | low    | nano        |
 * | factual    | no         | low    | pro         |
 *
 * If uncertain -> escalate.
 */

import type {
  IntentClass,
  RiskLevel,
  Route,
  ConfidenceLevel,
} from '../router.types.js';

export interface RouteDecisionInput {
  /** Classified intent */
  class: IntentClass;

  /** Does it need fresh/current data? */
  needsFreshData: boolean;

  /** Risk level if wrong */
  riskLevel: RiskLevel;

  /** Confidence in the classification (0-1) */
  classificationConfidence: number;
}

export interface RouteDecisionOutput {
  /** Final route */
  route: Route;

  /** Required confidence level */
  confidenceRequired: ConfidenceLevel;

  /** Should tools be used? */
  needsTools: boolean;

  /** Reason for this route */
  reason: string;
}

/**
 * Make the final route decision.
 *
 * The logic is deterministic and follows the decision matrix.
 * When uncertain, we ALWAYS escalate (over-escalation is acceptable).
 */
export function determineRoute(input: RouteDecisionInput): RouteDecisionOutput {
  const { class: intentClass, needsFreshData, riskLevel, classificationConfidence } = input;

  // Rule 1: High risk ALWAYS escalates to pro+tools
  if (riskLevel === 'high') {
    return {
      route: 'pro+tools',
      confidenceRequired: 'verified',
      needsTools: true,
      reason: 'High risk - wrong answer has real cost',
    };
  }

  // Rule 2: Actionable + fresh data = pro+tools
  if (intentClass === 'actionable' && needsFreshData) {
    return {
      route: 'pro+tools',
      confidenceRequired: 'verified',
      needsTools: true,
      reason: 'Actionable intent with fresh data requirement',
    };
  }

  // Rule 3: Actionable even without fresh data = pro+tools (safer)
  if (intentClass === 'actionable') {
    return {
      route: 'pro+tools',
      confidenceRequired: 'verified',
      needsTools: true,
      reason: 'Actionable intent - real-world action',
    };
  }

  // Rule 4: Factual + fresh data = pro+tools
  if (intentClass === 'factual' && needsFreshData) {
    return {
      route: 'pro+tools',
      confidenceRequired: 'verified',
      needsTools: true,
      reason: 'Factual query requiring current data',
    };
  }

  // Rule 5: Medium risk = pro (optional tools)
  if (riskLevel === 'medium') {
    return {
      route: 'pro',
      confidenceRequired: 'estimate',
      needsTools: false,
      reason: 'Medium risk - needs reasoning depth',
    };
  }

  // Rule 6: Low confidence classification = escalate to pro
  if (classificationConfidence < 0.6) {
    return {
      route: 'pro',
      confidenceRequired: 'estimate',
      needsTools: false,
      reason: 'Low classification confidence - escalating',
    };
  }

  // Rule 7: Chat = nano (fast, cheap)
  if (intentClass === 'chat') {
    return {
      route: 'nano',
      confidenceRequired: 'estimate',
      needsTools: false,
      reason: 'Casual conversation',
    };
  }

  // Rule 8: Transform = nano (fast, cheap, user will verify)
  if (intentClass === 'transform') {
    return {
      route: 'nano',
      confidenceRequired: 'estimate',
      needsTools: false,
      reason: 'Transform task - user will verify result',
    };
  }

  // Rule 9: Factual without fresh data = pro (needs reasoning)
  if (intentClass === 'factual') {
    return {
      route: 'pro',
      confidenceRequired: 'estimate',
      needsTools: false,
      reason: 'Factual explanation - needs reasoning depth',
    };
  }

  // Default: escalate to pro (fail safe)
  return {
    route: 'pro',
    confidenceRequired: 'estimate',
    needsTools: false,
    reason: 'Default escalation - fail safe',
  };
}

/**
 * Quick route for obvious cases (used for fast path)
 */
export function quickRoute(
  isObviouslyHighRisk: boolean,
  isObviouslyLowRisk: boolean,
  needsFreshData: boolean
): Route | null {
  // Obvious high risk = pro+tools immediately
  if (isObviouslyHighRisk) {
    return 'pro+tools';
  }

  // Obvious low risk without fresh data = nano
  if (isObviouslyLowRisk && !needsFreshData) {
    return 'nano';
  }

  // Need full analysis
  return null;
}

/**
 * Validate a route decision.
 * Returns true if the route is valid for the given constraints.
 */
export function validateRoute(
  route: Route,
  riskLevel: RiskLevel,
  needsFreshData: boolean,
  intentClass: IntentClass
): boolean {
  // High risk MUST use pro+tools
  if (riskLevel === 'high' && route !== 'pro+tools') {
    return false;
  }

  // Fresh data + actionable MUST use pro+tools
  if (needsFreshData && intentClass === 'actionable' && route !== 'pro+tools') {
    return false;
  }

  // Nano cannot handle fresh data requirements
  if (needsFreshData && route === 'nano') {
    return false;
  }

  return true;
}
