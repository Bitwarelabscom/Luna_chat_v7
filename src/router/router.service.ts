/**
 * Router Service - Main Entry Point
 *
 * The router decides which compute tier handles each message.
 * It NEVER generates text. It only routes.
 *
 * If the router fails, the system becomes untrustworthy regardless of model quality.
 */

import type {
  RouterDecision,
  RouterConfig,
  RouterContext,
  Route,
  IntentClass,
  DecisionSource,
} from './router.types.js';
import { DEFAULT_ROUTER_CONFIG } from './router.types.js';
import { shouldHardEscalate } from './rules/hard-escalation.js';
import { classifyIntent, isConfidentClassification } from './rules/intent-classifier.js';
import { checkFreshness, obviouslyNeedsFreshData } from './rules/freshness-check.js';
import { assessRisk, obviouslyHighRisk, obviouslyLowRisk } from './rules/risk-assessment.js';
import { determineRoute, quickRoute } from './rules/route-decision.js';
import { createCompletion as anthropicCompletion } from '../llm/providers/anthropic.provider.js';
import { createCompletion as groqCompletion } from '../llm/providers/groq.provider.js';
import { createCompletion as googleCompletion } from '../llm/providers/google.provider.js';
import { createCompletion as openaiCompletion } from '../llm/providers/openai.provider.js';
import logger from '../utils/logger.js';

// Provider completion functions
const providerCompletions = {
  anthropic: anthropicCompletion,
  groq: groqCompletion,
  google: googleCompletion,
  openai: openaiCompletion,
} as const;

// Cache for classifier results to avoid repeated calls
const classifierCache = new Map<string, { class: IntentClass; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clean up old cache entries
 */
function cleanCache(): void {
  const now = Date.now();
  const entries = Array.from(classifierCache.entries());
  for (const [key, value] of entries) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      classifierCache.delete(key);
    }
  }
}

/**
 * Generate a cache key for classifier results
 */
function getCacheKey(message: string): string {
  // Normalize and truncate for caching
  return message.toLowerCase().trim().slice(0, 200);
}

/**
 * Call the classifier model for ambiguous cases.
 *
 * This is the fallback when keyword/regex classification is not confident.
 * Uses a fast, cheap model (Groq llama-3.1-8b-instant by default).
 */
async function callClassifier(
  message: string,
  config: RouterConfig
): Promise<IntentClass> {
  const cacheKey = getCacheKey(message);

  // Check cache first
  const cached = classifierCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug('Router classifier cache hit', { cacheKey: cacheKey.slice(0, 50) });
    return cached.class;
  }

  const systemPrompt = `You are an intent classifier. Classify the user's message into exactly one of these categories:

- chat: Casual conversation, greetings, opinions, social interaction
- transform: Requests to rewrite, summarize, translate, or format text
- factual: Questions seeking explanations, definitions, or static knowledge
- actionable: Requests that lead to real-world actions (booking, buying, sending, scheduling)

Respond with ONLY the category name, nothing else. No explanation.

Examples:
"hi there" -> chat
"summarize this article" -> transform
"what is photosynthesis" -> factual
"book me a flight to NYC" -> actionable`;

  try {
    // Get the completion function for the configured provider
    const completionFn = providerCompletions[config.classifierProvider];
    if (!completionFn) {
      throw new Error(`Unknown classifier provider: ${config.classifierProvider}`);
    }

    const result = await Promise.race([
      completionFn(config.classifierModel, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ], {
        temperature: 0,
        maxTokens: 10,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Classifier timeout')), config.classifierTimeoutMs)
      ),
    ]);

    const response = result.content.toLowerCase().trim();
    let intentClass: IntentClass;

    // Parse the response
    if (response.includes('chat')) {
      intentClass = 'chat';
    } else if (response.includes('transform')) {
      intentClass = 'transform';
    } else if (response.includes('factual')) {
      intentClass = 'factual';
    } else if (response.includes('actionable')) {
      intentClass = 'actionable';
    } else {
      // Default to factual if unclear
      logger.warn('Classifier returned unexpected response', { response, message: message.slice(0, 100) });
      intentClass = 'factual';
    }

    // Cache the result
    classifierCache.set(cacheKey, { class: intentClass, timestamp: Date.now() });

    logger.debug('Router classifier result', {
      message: message.slice(0, 100),
      class: intentClass,
      tokensUsed: result.tokensUsed,
    });

    return intentClass;
  } catch (error) {
    logger.warn('Classifier call failed, using default', {
      error: (error as Error).message,
      message: message.slice(0, 100),
    });
    // On error, escalate to factual (safer than chat/transform)
    return 'factual';
  }
}

/**
 * Main routing function.
 *
 * This is the entry point for all routing decisions.
 * It runs once per user message.
 *
 * The router outputs a fixed schema with no free-form text.
 */
export async function route(
  message: string,
  context: RouterContext,
  config: RouterConfig = DEFAULT_ROUTER_CONFIG
): Promise<RouterDecision> {
  const startTime = Date.now();
  const matchedPatterns: string[] = [];

  // Periodic cache cleanup
  if (Math.random() < 0.1) {
    cleanCache();
  }

  // STEP 0: Hard Escalation Rules
  // These bypass all ML and heuristics
  const hardEscalation = shouldHardEscalate(message);
  if (hardEscalation) {
    matchedPatterns.push(...hardEscalation.matchedPatterns);

    const decision: RouterDecision = {
      class: 'actionable',
      needs_fresh_data: true,
      needs_tools: true,
      risk_if_wrong: 'high',
      confidence_required: 'verified',
      route: 'pro+tools',
      decision_source: 'hard_rule',
      decision_time_ms: Date.now() - startTime,
      matched_patterns: matchedPatterns,
    };

    logger.info('Router: Hard escalation triggered', {
      userId: context.userId,
      sessionId: context.sessionId,
      route: decision.route,
      category: hardEscalation.category,
      patterns: matchedPatterns.slice(0, 5),
      timeMs: decision.decision_time_ms,
    });

    return decision;
  }

  // STEP 1: Intent Classification
  let classification = classifyIntent(message);
  let decisionSource: DecisionSource = classification.source;

  // If not confident, try the classifier model
  if (!isConfidentClassification(classification)) {
    try {
      const classifiedIntent = await callClassifier(message, config);
      classification = {
        class: classifiedIntent,
        confidence: 0.8, // Classifier is reasonably confident
        source: 'classifier',
        matchedPatterns: ['classifier_fallback'],
      };
      decisionSource = 'classifier';
    } catch (error) {
      // On classifier error, stick with the original classification
      logger.warn('Classifier failed, using keyword classification', {
        error: (error as Error).message,
        originalClass: classification.class,
        confidence: classification.confidence,
      });
    }
  }

  if (classification.matchedPatterns) {
    matchedPatterns.push(...classification.matchedPatterns);
  }

  // STEP 2: Freshness Check
  const freshness = checkFreshness(message);
  if (freshness.matchedPatterns) {
    matchedPatterns.push(...freshness.matchedPatterns.map(p => `fresh:${p}`));
  }

  // STEP 3: Risk Assessment
  const risk = assessRisk(message);
  if (risk.matchedPatterns) {
    matchedPatterns.push(...risk.matchedPatterns.map(p => `risk:${p}`));
  }

  // STEP 4: Route Decision
  const routeResult = determineRoute({
    class: classification.class,
    needsFreshData: freshness.needsFreshData,
    riskLevel: risk.riskLevel,
    classificationConfidence: classification.confidence,
  });

  const decision: RouterDecision = {
    class: classification.class,
    needs_fresh_data: freshness.needsFreshData,
    needs_tools: routeResult.needsTools,
    risk_if_wrong: risk.riskLevel,
    confidence_required: routeResult.confidenceRequired,
    route: routeResult.route,
    decision_source: decisionSource,
    decision_time_ms: Date.now() - startTime,
    matched_patterns: matchedPatterns,
  };

  logger.info('Router decision', {
    userId: context.userId,
    sessionId: context.sessionId,
    route: decision.route,
    class: decision.class,
    risk: decision.risk_if_wrong,
    freshData: decision.needs_fresh_data,
    confidence: decision.confidence_required,
    source: decision.decision_source,
    timeMs: decision.decision_time_ms,
    reason: routeResult.reason,
  });

  return decision;
}

/**
 * Quick route check for obvious cases.
 *
 * This can be used as a fast-path optimization before full routing.
 * Returns null if the case is not obvious and full routing is needed.
 */
export function quickRouteCheck(message: string): Route | null {
  // Hard escalation check (fastest)
  const hardEscalation = shouldHardEscalate(message);
  if (hardEscalation) {
    return 'pro+tools';
  }

  // Quick risk/freshness checks
  const isHighRisk = obviouslyHighRisk(message);
  const isLowRisk = obviouslyLowRisk(message);
  const needsFresh = obviouslyNeedsFreshData(message);

  return quickRoute(isHighRisk, isLowRisk, needsFresh);
}

/**
 * Check if the router is enabled
 */
export function isEnabled(config: RouterConfig): boolean {
  return config.enabled;
}

/**
 * Get the default configuration
 */
export function getDefaultConfig(): RouterConfig {
  return { ...DEFAULT_ROUTER_CONFIG };
}
