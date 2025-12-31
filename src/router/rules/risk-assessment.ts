/**
 * Risk Assessment - Step 3
 *
 * Ask exactly one question:
 * > If this answer is wrong, does the user pay a cost?
 *
 * | Cost                      | Risk   |
 * |---------------------------|--------|
 * | None / annoyance          | low    |
 * | Confusion / wasted time   | medium |
 * | Money / plans / trust     | high   |
 *
 * No nuance. No empathy. No guessing.
 */

import type { RiskResult, RiskLevel } from '../router.types.js';

/**
 * Patterns that indicate HIGH risk if wrong.
 * Wrong answer damages money, plans, or trust.
 */
const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Financial decisions
  { pattern: /\b(buy|sell|invest|trade|transfer|send\s+money)\b/i, label: 'financial_action' },
  { pattern: /\b(payment|pay|wire|withdraw|deposit)\b/i, label: 'payment' },
  { pattern: /\$\d+/i, label: 'dollar_amount' },
  { pattern: /\b(price|cost|fee|rate)\s+(is|for|of)\b/i, label: 'price_query' },
  { pattern: /\b(stock|crypto|bitcoin|ethereum|trading)\b/i, label: 'trading' },
  { pattern: /\b(portfolio|balance|account)\b/i, label: 'account' },

  // Medical/health
  { pattern: /\b(medical|medicine|medication|drug|prescription)\b/i, label: 'medical' },
  { pattern: /\b(symptom|symptoms|diagnosis|treatment|therapy)\b/i, label: 'health' },
  { pattern: /\b(doctor|hospital|emergency|urgent\s+care)\b/i, label: 'healthcare' },
  { pattern: /\b(dosage|dose|mg|milligrams)\b/i, label: 'dosage' },
  { pattern: /\b(side\s+effect|interaction|allergy)\b/i, label: 'drug_safety' },

  // Legal
  { pattern: /\b(legal|lawyer|attorney|lawsuit|sue|court)\b/i, label: 'legal' },
  { pattern: /\b(contract|agreement|liability|rights)\b/i, label: 'contract' },
  { pattern: /\b(law|regulation|compliance|illegal)\b/i, label: 'law' },

  // Travel/booking
  { pattern: /\b(flight|booking|reservation|ticket)\b/i, label: 'booking' },
  { pattern: /\b(departure|arrival|gate|terminal)\b/i, label: 'travel' },
  { pattern: /\b(hotel|room|accommodation)\b/i, label: 'lodging' },

  // Safety/security
  { pattern: /\b(safe|safety|dangerous|hazard|risk)\b/i, label: 'safety' },
  { pattern: /\b(password|security|authentication|login)\b/i, label: 'security' },
  { pattern: /\b(emergency|urgent|critical)\b/i, label: 'emergency' },

  // Important deadlines
  { pattern: /\b(deadline|due\s+date|expires|expiration)\b/i, label: 'deadline' },
  { pattern: /\b(application|apply|submit)\s+(by|before|deadline)/i, label: 'application' },

  // Real-world actions
  { pattern: /\b(navigate|directions|route\s+to)\b/i, label: 'navigation' },
  { pattern: /\b(open|closed|hours)\s+(today|now)/i, label: 'hours' },
];

/**
 * Patterns that indicate MEDIUM risk if wrong.
 * Wrong answer causes confusion or wastes time.
 */
const MEDIUM_RISK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Recommendations with some stakes
  { pattern: /\b(recommend|should\s+i|best|which\s+one)\b/i, label: 'recommendation' },
  { pattern: /\b(compare|comparison|versus|vs)\b/i, label: 'comparison' },
  { pattern: /\b(pros\s+and\s+cons|advantages|disadvantages)\b/i, label: 'pros_cons' },

  // Planning and scheduling
  { pattern: /\b(schedule|appointment|meeting|calendar)\b/i, label: 'schedule' },
  { pattern: /\b(plan|planning|itinerary)\b/i, label: 'planning' },
  { pattern: /\b(how\s+long|duration|time\s+to)\b/i, label: 'duration' },

  // Technical decisions
  { pattern: /\b(install|setup|configure|implementation)\b/i, label: 'technical' },
  { pattern: /\b(compatible|compatibility|work\s+with)\b/i, label: 'compatibility' },
  { pattern: /\b(requirement|requires|needed)\b/i, label: 'requirements' },

  // Factual but consequential
  { pattern: /\b(is\s+it\s+true|fact\s+check|accurate)\b/i, label: 'fact_check' },
  { pattern: /\b(confirm|verify|make\s+sure)\b/i, label: 'verification' },

  // Instructions that could waste time
  { pattern: /\b(how\s+to|step\s+by\s+step|instructions)\b/i, label: 'instructions' },
  { pattern: /\b(tutorial|guide|walkthrough)\b/i, label: 'guide' },
];

/**
 * Patterns that indicate LOW risk if wrong.
 * Wrong answer causes at most annoyance.
 */
const LOW_RISK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Casual conversation
  { pattern: /^(hi|hello|hey|thanks|bye)/i, label: 'greeting' },
  { pattern: /\b(chat|talk|conversation)\b/i, label: 'chat' },
  { pattern: /\b(opinion|think|feel|believe)\b/i, label: 'opinion' },

  // Entertainment
  { pattern: /\b(joke|funny|humor|fun)\b/i, label: 'entertainment' },
  { pattern: /\b(story|tale|fiction)\b/i, label: 'fiction' },
  { pattern: /\b(game|play|trivia)\b/i, label: 'game' },

  // Creative tasks
  { pattern: /\b(write|poem|song|lyrics|creative)\b/i, label: 'creative' },
  { pattern: /\b(brainstorm|ideas|suggestions)\b/i, label: 'brainstorm' },

  // Transform tasks (user will verify)
  { pattern: /\b(rewrite|rephrase|summarize|translate)\b/i, label: 'transform' },
  { pattern: /\b(format|style|tone)\b/i, label: 'style' },

  // General explanations (educational)
  { pattern: /\bexplain\s+(the\s+)?concept/i, label: 'concept' },
  { pattern: /\b(history\s+of|background|origin)\b/i, label: 'history' },
  { pattern: /\b(what\s+is|who\s+is|define)\b/i, label: 'definition' },
];

/**
 * Assess the risk level if the answer is wrong.
 */
export function assessRisk(message: string): RiskResult {
  const normalizedMessage = message.toLowerCase().trim();
  const highRiskMatches: string[] = [];
  const mediumRiskMatches: string[] = [];
  const lowRiskMatches: string[] = [];

  // Check high risk patterns
  for (const { pattern, label } of HIGH_RISK_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      highRiskMatches.push(label);
    }
  }

  // Check medium risk patterns
  for (const { pattern, label } of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      mediumRiskMatches.push(label);
    }
  }

  // Check low risk patterns
  for (const { pattern, label } of LOW_RISK_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      lowRiskMatches.push(label);
    }
  }

  // Decision logic:
  // - ANY high risk pattern = high risk (escalate)
  // - Medium risk patterns without high = medium
  // - Only low risk or nothing = low

  let riskLevel: RiskLevel;
  let matchedPatterns: string[];

  if (highRiskMatches.length > 0) {
    riskLevel = 'high';
    matchedPatterns = highRiskMatches;
  } else if (mediumRiskMatches.length > 0) {
    riskLevel = 'medium';
    matchedPatterns = mediumRiskMatches;
  } else {
    riskLevel = 'low';
    matchedPatterns = lowRiskMatches;
  }

  return {
    riskLevel,
    matchedPatterns,
  };
}

/**
 * Quick check for obvious high-risk queries.
 * Used for fast-path optimization.
 */
export function obviouslyHighRisk(message: string): boolean {
  const quickPatterns = [
    /\b(buy|sell|invest|trade|transfer|pay)\b/i,
    /\b(medical|symptom|medication|dosage)\b/i,
    /\b(legal|lawyer|lawsuit|contract)\b/i,
    /\$\d+/i,
  ];

  for (const pattern of quickPatterns) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Quick check for obvious low-risk queries.
 * Used for fast-path optimization.
 */
export function obviouslyLowRisk(message: string): boolean {
  // Very short messages are usually low risk
  if (message.trim().length < 15) {
    return true;
  }

  const quickPatterns = [
    /^(hi|hello|hey|thanks|bye|ok|okay)/i,
    /\b(rewrite|summarize|translate|explain\s+the\s+concept)\b/i,
    /\b(joke|fun|creative|brainstorm)\b/i,
  ];

  for (const pattern of quickPatterns) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}
