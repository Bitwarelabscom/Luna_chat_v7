/**
 * Intent Classification - Step 1
 *
 * Classify the intent of the message, not the wording.
 *
 * | Class      | Definition                         |
 * |------------|-----------------------------------|
 * | chat       | Casual conversation, opinions      |
 * | transform  | Rewrite, summarize, format         |
 * | factual    | Static explanations                |
 * | actionable | Leads to real-world action         |
 *
 * Implementation uses:
 * 1. Keyword tables (fastest)
 * 2. Regex patterns (medium)
 * 3. Tiny classifier model fallback (only for ambiguous cases)
 */

import type { ClassificationResult, IntentClass, DecisionSource } from '../router.types.js';

/**
 * Keyword-based classification tables
 */
const CHAT_KEYWORDS = new Set([
  'hi', 'hello', 'hey', 'howdy', 'greetings',
  'thanks', 'thank you', 'thx', 'ty',
  'bye', 'goodbye', 'see you', 'later', 'cya',
  'how are you', 'whats up', "what's up", 'sup',
  'lol', 'haha', 'nice', 'cool', 'awesome', 'great',
  'ok', 'okay', 'sure', 'yep', 'yes', 'no', 'nope',
  'good morning', 'good afternoon', 'good evening', 'good night',
  'what do you think', 'your opinion', 'do you like',
  'tell me about yourself', 'who are you',
  'interesting', 'wow', 'amazing', 'i see', 'got it',
]);

const TRANSFORM_KEYWORDS = new Set([
  'rewrite', 'rephrase', 'paraphrase',
  'summarize', 'summary', 'tldr', 'tl;dr',
  'translate', 'translation',
  'format', 'reformat', 'formatting',
  'convert', 'conversion',
  'simplify', 'make simpler', 'explain like',
  'shorten', 'make shorter', 'condense',
  'expand', 'elaborate', 'make longer',
  'proofread', 'fix grammar', 'correct',
  'bullet points', 'list format', 'table format',
  'make it more', 'make it less', 'tone',
  'style', 'formal', 'informal', 'casual', 'professional',
]);

const FACTUAL_KEYWORDS = new Set([
  'what is', 'what are', 'whats', "what's",
  'who is', 'who are', 'whos', "who's",
  'explain', 'explanation', 'describe',
  'define', 'definition', 'meaning of',
  'history of', 'origin of', 'background',
  'how does', 'how do', 'how to',
  'why is', 'why are', 'why does', 'why do',
  'difference between', 'compare', 'versus', 'vs',
  'example of', 'examples of', 'such as',
  'list of', 'types of', 'kinds of',
  'concept', 'theory', 'principle',
  'when was', 'where was', 'where is',
]);

const ACTIONABLE_KEYWORDS = new Set([
  'buy', 'purchase', 'order', 'checkout',
  'book', 'reserve', 'reservation', 'schedule',
  'send', 'email', 'message', 'text', 'call',
  'create', 'make', 'generate', 'build',
  'set', 'set up', 'configure', 'setup',
  'remind', 'reminder', 'alert', 'notify',
  'pay', 'payment', 'transfer', 'wire',
  'cancel', 'refund', 'return',
  'subscribe', 'unsubscribe', 'sign up', 'register',
  'download', 'install', 'update', 'upgrade',
  'delete', 'remove', 'clear',
  'start', 'stop', 'pause', 'resume',
  'enable', 'disable', 'turn on', 'turn off',
  'connect', 'disconnect', 'link', 'unlink',
  'submit', 'apply', 'file', 'request',
]);

/**
 * Pattern-based classification for more complex detection
 */
const CHAT_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /^(hi|hello|hey|howdy)[\s!.?,]*$/i, weight: 1.0 },
  { pattern: /^(thanks|thank\s+you|thx|ty)[\s!.?,]*$/i, weight: 1.0 },
  { pattern: /^(ok|okay|sure|yep|yes|no|nope)[\s!.?,]*$/i, weight: 0.9 },
  { pattern: /^good\s+(morning|afternoon|evening|night)/i, weight: 1.0 },
  { pattern: /what\s+do\s+you\s+think/i, weight: 0.8 },
  { pattern: /your\s+opinion/i, weight: 0.8 },
  { pattern: /^(lol|haha|hahaha|lmao|rofl)[\s!.?,]*$/i, weight: 1.0 },
];

const TRANSFORM_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\b(rewrite|rephrase|paraphrase)\s+(this|the|my)/i, weight: 1.0 },
  { pattern: /\b(summarize|summary\s+of)\s/i, weight: 1.0 },
  { pattern: /\b(translate|translation)\s+(to|into|from)/i, weight: 1.0 },
  { pattern: /\bconvert\s+(this|it|the)\s+to\b/i, weight: 1.0 },
  { pattern: /\bmake\s+(it|this)\s+(shorter|longer|simpler|formal|casual)/i, weight: 0.9 },
  { pattern: /\b(fix|correct)\s+(the\s+)?(grammar|spelling|errors)/i, weight: 0.9 },
  { pattern: /\bput\s+(this|it)\s+in\s+(bullet|list|table)/i, weight: 0.9 },
  { pattern: /\bformat\s+(this|it)\s+as\b/i, weight: 0.9 },
];

const FACTUAL_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /^what\s+(is|are|was|were)\s/i, weight: 0.9 },
  { pattern: /^who\s+(is|are|was|were)\s/i, weight: 0.9 },
  { pattern: /^why\s+(is|are|does|do|did)\s/i, weight: 0.8 },
  { pattern: /^how\s+(does|do|did|is|are)\s/i, weight: 0.8 },
  { pattern: /^when\s+(was|were|is|did)\s/i, weight: 0.8 },
  { pattern: /^where\s+(is|are|was|were)\s/i, weight: 0.8 },
  { pattern: /\bexplain\s+(to\s+me\s+)?(what|how|why)/i, weight: 0.9 },
  { pattern: /\b(define|definition\s+of)\s/i, weight: 1.0 },
  { pattern: /\bdifference\s+between\s/i, weight: 0.9 },
  { pattern: /\bhistory\s+of\s/i, weight: 0.9 },
];

const ACTIONABLE_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\b(buy|purchase|order)\s+(me\s+)?(a|an|the|some)/i, weight: 1.0 },
  { pattern: /\b(book|reserve|schedule)\s+(a|an|the|my)/i, weight: 1.0 },
  { pattern: /\b(send|email|message)\s+(a|an|the|this|to)/i, weight: 1.0 },
  { pattern: /\b(set|create)\s+(a\s+)?(reminder|alert|alarm)/i, weight: 1.0 },
  { pattern: /\bremind\s+me\s+(to|about|in|at)/i, weight: 1.0 },
  { pattern: /\b(pay|transfer|wire)\s+(\$|money|funds)/i, weight: 1.0 },
  { pattern: /\b(cancel|refund)\s+(my|the|this)/i, weight: 1.0 },
  { pattern: /\b(sign\s+up|register|subscribe)\s+(for|to)/i, weight: 1.0 },
  { pattern: /\b(turn\s+on|turn\s+off|enable|disable)\s/i, weight: 0.9 },
  { pattern: /\bcan\s+you\s+(please\s+)?(send|book|schedule|create|set)/i, weight: 0.9 },
  { pattern: /\bplease\s+(send|book|schedule|create|set|remind)/i, weight: 0.9 },
];

/**
 * Normalize text for keyword matching
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?]+$/g, '') // Remove trailing punctuation
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Check if any keyword from a set is present in the text
 */
function hasKeyword(text: string, keywords: Set<string>): boolean {
  const normalized = normalizeText(text);

  // Direct match for short phrases
  if (keywords.has(normalized)) {
    return true;
  }

  // Check if text starts with any keyword
  const keywordArray = Array.from(keywords);
  for (const keyword of keywordArray) {
    if (normalized.startsWith(keyword + ' ') || normalized.startsWith(keyword + ',')) {
      return true;
    }
    // Check for keyword presence with word boundaries
    const keywordRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (keywordRegex.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Score text against pattern set
 */
function scorePatterns(text: string, patterns: Array<{ pattern: RegExp; weight: number }>): number {
  let maxWeight = 0;

  for (const { pattern, weight } of patterns) {
    if (pattern.test(text)) {
      maxWeight = Math.max(maxWeight, weight);
    }
  }

  return maxWeight;
}

/**
 * Find matched patterns for debugging
 */
function findMatchedPatterns(
  text: string,
  patterns: Array<{ pattern: RegExp; weight: number }>,
  label: string
): string[] {
  const matched: string[] = [];

  for (const { pattern } of patterns) {
    if (pattern.test(text)) {
      matched.push(`${label}:${pattern.source.slice(0, 30)}`);
    }
  }

  return matched;
}

/**
 * Classify intent using keywords and patterns (no ML).
 *
 * Returns the classification with confidence score.
 * If confidence is below threshold, caller should use classifier model.
 */
export function classifyIntent(message: string): ClassificationResult {
  const normalized = normalizeText(message);
  const matchedPatterns: string[] = [];

  // Keyword-based classification (fastest)
  const keywordScores: Record<IntentClass, number> = {
    chat: hasKeyword(normalized, CHAT_KEYWORDS) ? 0.9 : 0,
    transform: hasKeyword(normalized, TRANSFORM_KEYWORDS) ? 0.9 : 0,
    factual: hasKeyword(normalized, FACTUAL_KEYWORDS) ? 0.9 : 0,
    actionable: hasKeyword(normalized, ACTIONABLE_KEYWORDS) ? 0.9 : 0,
  };

  // Pattern-based scoring (more nuanced)
  const patternScores: Record<IntentClass, number> = {
    chat: scorePatterns(normalized, CHAT_PATTERNS),
    transform: scorePatterns(normalized, TRANSFORM_PATTERNS),
    factual: scorePatterns(normalized, FACTUAL_PATTERNS),
    actionable: scorePatterns(normalized, ACTIONABLE_PATTERNS),
  };

  // Combine scores (pattern score is more specific)
  const combinedScores: Record<IntentClass, number> = {
    chat: Math.max(keywordScores.chat, patternScores.chat),
    transform: Math.max(keywordScores.transform, patternScores.transform),
    factual: Math.max(keywordScores.factual, patternScores.factual),
    actionable: Math.max(keywordScores.actionable, patternScores.actionable),
  };

  // Find highest scoring class
  let bestClass: IntentClass = 'factual'; // Default fallback
  let bestScore = 0;
  let source: DecisionSource = 'keyword';

  for (const [cls, score] of Object.entries(combinedScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestClass = cls as IntentClass;
      source = patternScores[cls as IntentClass] > keywordScores[cls as IntentClass] ? 'regex' : 'keyword';
    }
  }

  // Collect matched patterns for debugging
  if (patternScores.chat > 0) matchedPatterns.push(...findMatchedPatterns(normalized, CHAT_PATTERNS, 'chat'));
  if (patternScores.transform > 0) matchedPatterns.push(...findMatchedPatterns(normalized, TRANSFORM_PATTERNS, 'transform'));
  if (patternScores.factual > 0) matchedPatterns.push(...findMatchedPatterns(normalized, FACTUAL_PATTERNS, 'factual'));
  if (patternScores.actionable > 0) matchedPatterns.push(...findMatchedPatterns(normalized, ACTIONABLE_PATTERNS, 'actionable'));

  // Special case: very short messages are likely chat
  if (normalized.length < 20 && bestScore < 0.5) {
    return {
      class: 'chat',
      confidence: 0.7,
      source: 'keyword',
      matchedPatterns: ['short_message'],
    };
  }

  return {
    class: bestClass,
    confidence: bestScore,
    source,
    matchedPatterns,
  };
}

/**
 * Confidence threshold for using the classifier model.
 * If confidence is below this, we should call the classifier for disambiguation.
 */
export const CLASSIFIER_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Check if classification is confident enough to use without model fallback
 */
export function isConfidentClassification(result: ClassificationResult): boolean {
  return result.confidence >= CLASSIFIER_CONFIDENCE_THRESHOLD;
}
