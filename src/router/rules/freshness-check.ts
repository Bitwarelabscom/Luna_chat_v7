/**
 * Freshness Check - Step 2
 *
 * Determines if the answer requires current/live data.
 *
 * Set needs_fresh_data = true if:
 * - The answer changes over time
 * - The question depends on current state
 * - The user implies temporal relevance
 *
 * Examples:
 * - Weather -> true
 * - Flight prices -> true
 * - Historical explanation -> false
 */

import type { FreshnessResult } from '../router.types.js';

/**
 * Patterns that indicate fresh data is needed
 */
const FRESH_DATA_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Temporal indicators
  { pattern: /\b(current|currently|now|right\s+now|at\s+the\s+moment)\b/i, label: 'current' },
  { pattern: /\b(today|tonight|this\s+morning|this\s+afternoon)\b/i, label: 'today' },
  { pattern: /\b(latest|newest|most\s+recent|up\s+to\s+date)\b/i, label: 'latest' },
  { pattern: /\b(live|real-?time|happening)\b/i, label: 'realtime' },

  // Time-sensitive data
  { pattern: /\b(price|prices|pricing|cost|costs|rate|rates)\b/i, label: 'prices' },
  { pattern: /\b(stock|stocks|share|shares|market)\b/i, label: 'market' },
  { pattern: /\b(weather|forecast|temperature|rain|snow)\b/i, label: 'weather' },
  { pattern: /\b(score|scores|game|match|playing)\b/i, label: 'sports' },
  { pattern: /\b(news|headlines|breaking)\b/i, label: 'news' },

  // Availability and status
  { pattern: /\b(available|availability|open|closed|hours)\b/i, label: 'availability' },
  { pattern: /\b(status|update|updates)\b/i, label: 'status' },
  { pattern: /\b(traffic|delay|delays|delayed)\b/i, label: 'traffic' },
  { pattern: /\b(flight|flights|departure|arrival)\b/i, label: 'flight' },

  // Location-based (often needs real-time data)
  { pattern: /\b(near\s+me|nearby|closest|nearest)\b/i, label: 'location' },

  // Trending/popular
  { pattern: /\b(trending|viral|popular|hot\s+right\s+now)\b/i, label: 'trending' },

  // Explicit freshness requests
  { pattern: /\b(what\s+is\s+the\s+current|what\s+are\s+the\s+current)\b/i, label: 'explicit_current' },
  { pattern: /\b(check|look\s+up|find\s+out)\b/i, label: 'lookup' },
];

/**
 * Patterns that indicate static/historical data (no freshness needed)
 */
const STATIC_DATA_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Historical
  { pattern: /\b(history|historical|historically)\b/i, label: 'history' },
  { pattern: /\b(in\s+the\s+past|previously|back\s+in)\b/i, label: 'past' },
  { pattern: /\b(origin|origins|began|started|invented)\b/i, label: 'origin' },

  // Conceptual/educational
  { pattern: /\bexplain\s+(the\s+)?(concept|idea|theory|principle)/i, label: 'concept' },
  { pattern: /\b(define|definition|meaning\s+of)\b/i, label: 'definition' },
  { pattern: /\bwhat\s+is\s+(a|an|the)\s+(concept|theory|principle)/i, label: 'what_is_concept' },

  // General knowledge
  { pattern: /\b(always|generally|typically|usually|normally)\b/i, label: 'general' },
  { pattern: /\b(in\s+general|on\s+average|commonly)\b/i, label: 'common' },

  // Hypothetical
  { pattern: /\b(would|could|should|might)\s+(be|have|do)\b/i, label: 'hypothetical' },
  { pattern: /\bwhat\s+if\b/i, label: 'what_if' },

  // Learning/understanding
  { pattern: /\bhelp\s+me\s+understand\b/i, label: 'understand' },
  { pattern: /\bcan\s+you\s+explain\b/i, label: 'explain' },
];

/**
 * Check if the message requires fresh/current data.
 */
export function checkFreshness(message: string): FreshnessResult {
  const normalizedMessage = message.toLowerCase().trim();
  const freshPatterns: string[] = [];
  const staticPatterns: string[] = [];

  // Check for fresh data indicators
  for (const { pattern, label } of FRESH_DATA_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      freshPatterns.push(label);
    }
  }

  // Check for static data indicators
  for (const { pattern, label } of STATIC_DATA_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      staticPatterns.push(label);
    }
  }

  // Decision logic:
  // - If ONLY static patterns match, no fresh data needed
  // - If ANY fresh patterns match (even with static), fresh data needed
  // - If nothing matches, default to no fresh data needed

  const needsFreshData = freshPatterns.length > 0 && staticPatterns.length === 0
    || freshPatterns.length > staticPatterns.length;

  return {
    needsFreshData,
    matchedPatterns: needsFreshData ? freshPatterns : staticPatterns,
  };
}

/**
 * Quick check for obvious fresh data requirements.
 * Used for fast-path optimization.
 */
export function obviouslyNeedsFreshData(message: string): boolean {
  const quickPatterns = [
    /\b(price|weather|stock|score|traffic|flight|live|current)\b/i,
    /\b(today|now|right\s+now|latest)\b/i,
  ];

  for (const pattern of quickPatterns) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Quick check for obvious static/historical content.
 * Used for fast-path optimization.
 */
export function obviouslyStatic(message: string): boolean {
  const quickPatterns = [
    /\b(history\s+of|explain\s+the\s+concept|define|what\s+does\s+.+\s+mean)\b/i,
    /\b(how\s+does\s+.+\s+work|difference\s+between)\b/i,
  ];

  for (const pattern of quickPatterns) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}
