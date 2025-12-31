/**
 * Hard Escalation Rules - Step 0
 *
 * These rules bypass all ML and heuristics.
 * If ANY pattern matches, route is immediately set to pro+tools.
 *
 * This rule is non-negotiable.
 */

export interface HardEscalationResult {
  /** Did any hard rule trigger? */
  triggered: boolean;

  /** Which patterns matched? */
  matchedPatterns: string[];

  /** Category of the escalation */
  category?: 'temporal' | 'financial' | 'weather' | 'travel' | 'realtime' | 'location';
}

/**
 * Temporal patterns - anything time-sensitive
 */
const TEMPORAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(today|tonight|this\s+morning|this\s+afternoon|this\s+evening)\b/i, label: 'today' },
  { pattern: /\b(tomorrow|next\s+week|next\s+month|this\s+weekend)\b/i, label: 'near_future' },
  { pattern: /\b(now|right\s+now|at\s+the\s+moment|currently)\b/i, label: 'now' },
  { pattern: /\b(current|latest|recent|new|updated)\b/i, label: 'current' },
  { pattern: /\b(yesterday|last\s+night|earlier\s+today)\b/i, label: 'recent_past' },
  { pattern: /\b(what\s+time|when\s+is|what\s+day)\b/i, label: 'time_query' },
  { pattern: /\b(open|closed|hours|available)\s+(now|today|right\s+now)/i, label: 'availability' },
];

/**
 * Financial/price patterns - money on the line
 */
const FINANCIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(price|cost|how\s+much|pricing)\b/i, label: 'price' },
  { pattern: /\$[\d,]+(\.\d{2})?/i, label: 'dollar_amount' },
  { pattern: /\b(stock|stocks|share|shares|equity|equities)\b/i, label: 'stocks' },
  { pattern: /\b(crypto|bitcoin|btc|ethereum|eth|coin|token)\b/i, label: 'crypto' },
  { pattern: /\b(trading|trade|buy|sell|invest|investment)\b/i, label: 'trading' },
  { pattern: /\b(market|nasdaq|nyse|dow|s&p|sp500)\b/i, label: 'market' },
  { pattern: /\b(exchange\s+rate|forex|currency|usd|eur|gbp)\b/i, label: 'forex' },
  { pattern: /\b(portfolio|holdings|balance|account\s+value)\b/i, label: 'portfolio' },
];

/**
 * Weather patterns - changes constantly
 */
const WEATHER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(weather|forecast|temperature|temp)\b/i, label: 'weather' },
  { pattern: /\b(rain|raining|rainy|snow|snowing|sunny|cloudy|storm)\b/i, label: 'conditions' },
  { pattern: /\b(degrees|celsius|fahrenheit|humidity)\b/i, label: 'metrics' },
  { pattern: /\b(will\s+it\s+rain|is\s+it\s+going\s+to|should\s+i\s+bring)\b/i, label: 'weather_query' },
];

/**
 * Travel patterns - bookings, availability, schedules
 */
const TRAVEL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(flight|flights|airline|plane|airport)\b/i, label: 'flight' },
  { pattern: /\b(booking|book|reserve|reservation)\b/i, label: 'booking' },
  { pattern: /\b(schedule|departure|arrival|gate|terminal)\b/i, label: 'schedule' },
  { pattern: /\b(availability|available|seat|seats)\b/i, label: 'availability' },
  { pattern: /\b(ticket|tickets|fare|fares)\b/i, label: 'tickets' },
  { pattern: /\b(hotel|motel|accommodation|lodging|airbnb)\b/i, label: 'lodging' },
  { pattern: /\b(train|bus|subway|metro|transit)\b/i, label: 'transit' },
  { pattern: /\b(traffic|delay|delays|delayed|on\s+time)\b/i, label: 'traffic' },
];

/**
 * Real-time patterns - live data required
 */
const REALTIME_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(live|real-?time|happening|breaking)\b/i, label: 'live' },
  { pattern: /\b(news|headlines|latest\s+news)\b/i, label: 'news' },
  { pattern: /\b(score|scores|game|match|playing)\b/i, label: 'sports' },
  { pattern: /\b(status|update|updates)\b/i, label: 'status' },
  { pattern: /\b(trending|viral|popular\s+right\s+now)\b/i, label: 'trending' },
];

/**
 * Location-tied patterns - real-world action
 */
const LOCATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(near\s+me|nearby|closest|nearest)\b/i, label: 'nearby' },
  { pattern: /\b(directions|how\s+to\s+get\s+to|route\s+to|navigate)\b/i, label: 'directions' },
  { pattern: /\b(open\s+now|is\s+.+\s+open|are\s+.+\s+open)\b/i, label: 'hours' },
  { pattern: /\b(where\s+is|where\s+can\s+i|find\s+a|find\s+the)\b/i, label: 'location_query' },
];

/**
 * All pattern groups for iteration
 */
const ALL_PATTERN_GROUPS = [
  { patterns: TEMPORAL_PATTERNS, category: 'temporal' as const },
  { patterns: FINANCIAL_PATTERNS, category: 'financial' as const },
  { patterns: WEATHER_PATTERNS, category: 'weather' as const },
  { patterns: TRAVEL_PATTERNS, category: 'travel' as const },
  { patterns: REALTIME_PATTERNS, category: 'realtime' as const },
  { patterns: LOCATION_PATTERNS, category: 'location' as const },
];

/**
 * Check if the message triggers any hard escalation rules.
 *
 * If triggered, the router MUST route to pro+tools.
 * This is non-negotiable.
 */
export function checkHardEscalation(message: string): HardEscalationResult {
  const matchedPatterns: string[] = [];
  let firstCategory: HardEscalationResult['category'] | undefined;

  // Normalize message for matching
  const normalizedMessage = message.toLowerCase().trim();

  // Check each pattern group
  for (const { patterns, category } of ALL_PATTERN_GROUPS) {
    for (const { pattern, label } of patterns) {
      if (pattern.test(normalizedMessage)) {
        matchedPatterns.push(`${category}:${label}`);
        if (!firstCategory) {
          firstCategory = category;
        }
      }
    }
  }

  return {
    triggered: matchedPatterns.length > 0,
    matchedPatterns,
    category: firstCategory,
  };
}

/**
 * Quick check for common greetings that should NOT trigger escalation.
 * This prevents false positives from patterns like "how are you today"
 * where "today" is not time-sensitive.
 */
const GREETING_PATTERNS = [
  /^(hi|hello|hey|good\s+(morning|afternoon|evening)|what'?s\s+up|how\s+are\s+you)/i,
  /^(thanks|thank\s+you|bye|goodbye|see\s+you)/i,
];

/**
 * Check if the message is primarily a greeting (to avoid false escalation)
 */
export function isPrimaryGreeting(message: string): boolean {
  const trimmed = message.trim();

  // Very short messages that match greeting patterns
  if (trimmed.length < 50) {
    for (const pattern of GREETING_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Main entry point for hard escalation check.
 * Returns null if no hard rule triggered, or the result if triggered.
 *
 * Special case: greetings with temporal words (like "how are you today")
 * are NOT escalated.
 */
export function shouldHardEscalate(message: string): HardEscalationResult | null {
  // First check if this is primarily a greeting
  if (isPrimaryGreeting(message)) {
    // Greetings can contain temporal words but shouldn't trigger escalation
    // e.g., "how are you today" or "good morning"
    return null;
  }

  const result = checkHardEscalation(message);

  if (result.triggered) {
    return result;
  }

  return null;
}
