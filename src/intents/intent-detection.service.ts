/**
 * Intent Detection Service
 * Detects explicit and implicit intent signals from user messages
 */

import logger from '../utils/logger.js';
import { query } from '../db/postgres.js';
import { createChatCompletion } from '../llm/openai.client.js';
import {
  IntentSignal,
  IntentType,
  IntentSummary,
  IntentContext,
  INTENT_DEFAULTS,
} from './intent.types.js';
import * as intentService from './intent.service.js';

// ============================================
// Explicit Patterns (>= 0.85 confidence, no confirmation)
// ============================================

interface PatternMatcher {
  pattern: RegExp;
  extractor: (match: RegExpMatchArray) => { label: string; goal?: string };
}

const EXPLICIT_PATTERNS: Record<IntentType, PatternMatcher[]> = {
  task: [
    {
      pattern: /\bi(?:'m| am) (?:trying to|working on|debugging|fixing)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Complete: ${m[1].trim()}` }),
    },
    {
      pattern: /\bhelp me (?:with|to)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Help user with: ${m[1].trim()}` }),
    },
    {
      pattern: /\blet's (?:work on|figure out|debug|fix)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Complete: ${m[1].trim()}` }),
    },
    {
      pattern: /\bneed to (?:fix|debug|figure out|solve)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Resolve: ${m[1].trim()}` }),
    },
    {
      pattern: /\bcan you help (?:me )?(?:with|debug|fix)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Help user with: ${m[1].trim()}` }),
    },
  ],
  goal: [
    {
      pattern: /\bmy goal is (?:to )?\s*(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: m[1].trim() }),
    },
    {
      pattern: /\bi want to (?:eventually |ultimately )?(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: m[1].trim() }),
    },
    {
      pattern: /\bi(?:'m| am) aiming to\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: m[1].trim() }),
    },
  ],
  exploration: [
    {
      pattern: /\bi(?:'m| am) (?:curious about|exploring|researching|looking into)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Explore: ${m[1].trim()}` }),
    },
    {
      pattern: /\bi want to (?:learn|understand|explore)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Learn about: ${m[1].trim()}` }),
    },
    {
      pattern: /\btell me (?:more )?about\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Understand: ${m[1].trim()}` }),
    },
  ],
  companion: [
    {
      pattern: /\bi(?:'m| am) (?:feeling|stressed about|worried about)\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Support user feeling: ${m[1].trim()}` }),
    },
    {
      pattern: /\bneed to (?:vent|talk) about\s+(.+)/i,
      extractor: (m) => ({ label: m[1].trim(), goal: `Listen about: ${m[1].trim()}` }),
    },
  ],
};

// ============================================
// Implicit Patterns (0.6-0.84 confidence, may confirm)
// ============================================

interface ImplicitPattern {
  pattern: RegExp;
  signalType: 'continuation' | 'frustration' | 'progress' | 'blocker' | 'switch' | 'resolve';
  extractor?: (match: RegExpMatchArray) => { label?: string; update?: string };
}

const IMPLICIT_PATTERNS: ImplicitPattern[] = [
  // Continuation signals
  {
    pattern: /\bback to\s+(.+)/i,
    signalType: 'continuation',
    extractor: (m) => ({ label: m[1].trim() }),
  },
  {
    pattern: /\bwhere were we with\s+(.+)/i,
    signalType: 'continuation',
    extractor: (m) => ({ label: m[1].trim() }),
  },
  {
    pattern: /\bcontinuing (?:with |on )?(.+)/i,
    signalType: 'continuation',
    extractor: (m) => ({ label: m[1].trim() }),
  },
  {
    pattern: /\bpicking (?:up|back up) (?:where we left off|on)\s*(.+)?/i,
    signalType: 'continuation',
    extractor: (m) => ({ label: m[1]?.trim() }),
  },

  // Frustration signals (may indicate blocker)
  {
    pattern: /\bstill (?:can't|cannot|struggling with|stuck on)\s+(.+)/i,
    signalType: 'frustration',
    extractor: (m) => ({ update: m[1].trim() }),
  },
  {
    pattern: /\b(?:this|it) (?:still )?(?:isn't|doesn't) work/i,
    signalType: 'frustration',
  },
  {
    pattern: /\bkeeps? (?:failing|breaking|not working)/i,
    signalType: 'frustration',
  },

  // Progress signals
  {
    pattern: /\bi (?:figured out|solved|fixed|got)\s+(.+)/i,
    signalType: 'progress',
    extractor: (m) => ({ update: m[1].trim() }),
  },
  {
    pattern: /\bthat worked\b/i,
    signalType: 'progress',
  },
  {
    pattern: /\b(?:finally|it's) working/i,
    signalType: 'progress',
  },
  {
    pattern: /\bmade progress on\s+(.+)/i,
    signalType: 'progress',
    extractor: (m) => ({ update: m[1].trim() }),
  },

  // Blocker signals
  {
    pattern: /\bblocked (?:by|on)\s+(.+)/i,
    signalType: 'blocker',
    extractor: (m) => ({ update: m[1].trim() }),
  },
  {
    pattern: /\bwaiting (?:for|on)\s+(.+)/i,
    signalType: 'blocker',
    extractor: (m) => ({ update: m[1].trim() }),
  },
  {
    pattern: /\bcan't (?:proceed|continue) (?:until|because)\s+(.+)/i,
    signalType: 'blocker',
    extractor: (m) => ({ update: m[1].trim() }),
  },

  // Switch signals
  {
    pattern: /\blet's (?:switch to|do something else|work on something different)/i,
    signalType: 'switch',
  },
  {
    pattern: /\bputting (?:this|that) aside/i,
    signalType: 'switch',
  },
  {
    pattern: /\bnever ?mind\b/i,
    signalType: 'switch',
  },

  // Resolution signals
  {
    pattern: /\bdone with\s+(.+)/i,
    signalType: 'resolve',
    extractor: (m) => ({ label: m[1].trim() }),
  },
  {
    pattern: /\bfinished\s+(.+)/i,
    signalType: 'resolve',
    extractor: (m) => ({ label: m[1].trim() }),
  },
  {
    pattern: /\bcompleted\s+(.+)/i,
    signalType: 'resolve',
    extractor: (m) => ({ label: m[1].trim() }),
  },
  {
    pattern: /\btask (?:is )?(?:done|complete)/i,
    signalType: 'resolve',
  },
];

// ============================================
// Approach Change Detection
// ============================================

const APPROACH_PATTERNS = [
  /\blet(?:'s| me) try\s+(.+)/i,
  /\bwhat if (?:we|i)\s+(.+)/i,
  /\binstead,?\s*(?:let's|i'll|we could)\s+(.+)/i,
  /\bmaybe (?:we should|i should|try)\s+(.+)/i,
  /\banother approach[:\s]+(.+)/i,
  /\bnew plan[:\s]+(.+)/i,
];

// ============================================
// Detection Functions
// ============================================

/**
 * Detect explicit intent signal from message
 */
function detectExplicitSignal(message: string): IntentSignal | null {
  const lower = message.toLowerCase().trim();

  // Skip very short messages
  if (lower.length < 10) return null;

  for (const [type, patterns] of Object.entries(EXPLICIT_PATTERNS) as [IntentType, PatternMatcher[]][]) {
    for (const { pattern, extractor } of patterns) {
      const match = message.match(pattern);
      if (match) {
        const extracted = extractor(match);
        return {
          action: 'create',
          confidence: INTENT_DEFAULTS.EXPLICIT_MIN_CONFIDENCE,
          type,
          label: extracted.label,
          goal: extracted.goal || extracted.label,
          triggerType: 'explicit',
          matchedPattern: pattern.source,
        };
      }
    }
  }

  return null;
}

/**
 * Detect implicit intent signal from message
 */
function detectImplicitSignal(
  message: string,
  activeIntents: IntentSummary[]
): IntentSignal | null {
  for (const { pattern, signalType, extractor } of IMPLICIT_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const extracted = extractor?.(match);

      // Try to match to an existing intent
      let matchedIntent: IntentSummary | undefined;
      if (extracted?.label) {
        matchedIntent = findMatchingIntent(extracted.label, activeIntents);
      }

      // Base confidence for implicit signals
      let confidence = 0.7;

      // Boost confidence if we matched an existing intent
      if (matchedIntent) {
        confidence = 0.8;
      }

      switch (signalType) {
        case 'continuation':
          return {
            action: matchedIntent ? 'update' : 'switch',
            confidence,
            matchedIntentId: matchedIntent?.id,
            label: extracted?.label,
            triggerType: 'implicit',
            matchedPattern: pattern.source,
          };

        case 'frustration':
          // If matched to an intent, this suggests a blocker
          return {
            action: 'update',
            confidence,
            matchedIntentId: matchedIntent?.id || activeIntents[0]?.id,
            updates: extracted?.update ? { blockers: [extracted.update] } : undefined,
            triggerType: 'implicit',
            matchedPattern: pattern.source,
          };

        case 'progress':
          return {
            action: 'update',
            confidence,
            matchedIntentId: matchedIntent?.id || activeIntents[0]?.id,
            triggerType: 'implicit',
            matchedPattern: pattern.source,
          };

        case 'blocker':
          return {
            action: 'update',
            confidence,
            matchedIntentId: matchedIntent?.id || activeIntents[0]?.id,
            updates: extracted?.update ? { blockers: [extracted.update] } : undefined,
            triggerType: 'implicit',
            matchedPattern: pattern.source,
          };

        case 'switch':
          return {
            action: 'suspend',
            confidence: 0.65,
            matchedIntentId: activeIntents[0]?.id,
            triggerType: 'implicit',
            matchedPattern: pattern.source,
          };

        case 'resolve':
          return {
            action: 'resolve',
            confidence,
            matchedIntentId: matchedIntent?.id || activeIntents[0]?.id,
            label: extracted?.label,
            triggerType: 'implicit',
            matchedPattern: pattern.source,
          };
      }
    }
  }

  return null;
}

/**
 * Detect approach change in message
 */
function detectApproachChange(message: string): string | null {
  for (const pattern of APPROACH_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Find matching intent by label similarity
 */
function findMatchingIntent(
  label: string,
  intents: IntentSummary[]
): IntentSummary | undefined {
  const normalizedLabel = label.toLowerCase().trim();

  // Exact match
  let match = intents.find(
    (i) => i.label.toLowerCase() === normalizedLabel
  );
  if (match) return match;

  // Partial match
  match = intents.find(
    (i) =>
      i.label.toLowerCase().includes(normalizedLabel) ||
      normalizedLabel.includes(i.label.toLowerCase())
  );
  if (match) return match;

  // Word overlap
  const labelWords = new Set(normalizedLabel.split(/\s+/).filter((w) => w.length > 3));
  if (labelWords.size === 0) return undefined;

  let bestMatch: IntentSummary | undefined;
  let bestOverlap = 0;

  for (const intent of intents) {
    const intentWords = new Set(
      intent.label.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    );
    let overlap = 0;
    for (const word of labelWords) {
      if (intentWords.has(word)) overlap++;
    }
    const overlapRatio = overlap / Math.max(labelWords.size, intentWords.size);
    if (overlapRatio > bestOverlap && overlapRatio > 0.3) {
      bestOverlap = overlapRatio;
      bestMatch = intent;
    }
  }

  return bestMatch;
}

// ============================================
// Public API
// ============================================

/**
 * Detect intent signal from user message
 * Returns the most confident signal found
 */
export function detectIntentSignal(
  message: string,
  activeIntents: IntentSummary[] = []
): IntentSignal | null {
  // Try explicit detection first
  const explicitSignal = detectExplicitSignal(message);
  if (explicitSignal) {
    logger.debug('Detected explicit intent signal', {
      action: explicitSignal.action,
      type: explicitSignal.type,
      label: explicitSignal.label?.slice(0, 50),
      confidence: explicitSignal.confidence,
    });
    return explicitSignal;
  }

  // Try implicit detection
  const implicitSignal = detectImplicitSignal(message, activeIntents);
  if (implicitSignal) {
    logger.debug('Detected implicit intent signal', {
      action: implicitSignal.action,
      matchedIntentId: implicitSignal.matchedIntentId,
      confidence: implicitSignal.confidence,
    });
    return implicitSignal;
  }

  return null;
}

/**
 * Detect intent using LLM when regex fails
 */
async function detectIntentWithLLM(
  message: string,
  activeIntents: IntentSummary[]
): Promise<IntentSignal | null> {
  const prompt = `
Analyze the user's intent in this message.
Active intents:
${activeIntents.map(i => `- ${i.label} (ID: ${i.id})`).join('\n')}

Message: "${message}"

Determine if this message:
1. Relates to an active intent (update/continuation).
2. Starts a NEW distinct intent (goal/task).
3. Is just casual chat (ignore).

Return JSON only:
{
  "action": "create" | "update" | "ignore",
  "intent_id": "existing_uuid" (if update),
  "label": "short label" (if create),
  "type": "task" | "goal" | "exploration" | "companion" (if create),
  "confidence": 0.0-1.0
}
`;

  try {
    const response = await createChatCompletion({
      messages: [{ role: 'system', content: prompt }],
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 200,
    });

    const content = response.content.replace(/```json|```/g, '').trim();
    const result = JSON.parse(content);

    if (result.confidence < 0.7 || result.action === 'ignore') return null;

    if (result.action === 'update' && result.intent_id) {
      return {
        action: 'update',
        confidence: result.confidence,
        matchedIntentId: result.intent_id,
        triggerType: 'implicit',
      };
    }

    if (result.action === 'create' && result.label) {
      return {
        action: 'create',
        confidence: result.confidence,
        type: result.type || 'task',
        label: result.label,
        goal: result.label, // Simple goal
        triggerType: 'implicit',
      };
    }

    return null;
  } catch (error) {
    logger.warn('LLM intent detection failed', { error: (error as Error).message });
    return null;
  }
}

/**
 * Process message for intent updates
 * Called after response generation to update intent state
 */
export async function processMessageForIntents(
  userId: string,
  sessionId: string,
  userMessage: string,
  _assistantResponse: string,
  context: IntentContext
): Promise<void> {
  try {
    let signal = detectIntentSignal(userMessage, context.activeIntents);
    let activeIntentId: string | null = null;

    if (!signal) {
      // Check for approach change without explicit signal
      const newApproach = detectApproachChange(userMessage);
      if (newApproach && context.activeIntents.length > 0) {
        const intent = context.activeIntents[0];
        await intentService.addTriedApproach(intent.id, newApproach);
        const updated = await intentService.touchIntent(intent.id, sessionId, userMessage.slice(0, 200), 'approach_change');
        if (updated) activeIntentId = updated.id;
        
        logger.debug('Updated intent with new approach', {
          intentId: intent.id,
          approach: newApproach.slice(0, 50),
        });
      } else if (userMessage.length > 15) {
        // Fallback to LLM detection for complex intents
        signal = await detectIntentWithLLM(userMessage, context.activeIntents);
      }
    }

    // Process signal if found (either regex or LLM)
    if (signal && signal.confidence >= INTENT_DEFAULTS.LOG_ONLY_THRESHOLD) {
      // Process based on action
      switch (signal.action) {
        case 'create':
          if (signal.label && signal.type) {
            const existing = await intentService.findIntentByLabel(userId, signal.label);
            if (existing) {
              const updated = await intentService.touchIntent(existing.id, sessionId, userMessage.slice(0, 200), 'explicit');
              if (updated) activeIntentId = updated.id;
              
              logger.debug('Touched existing intent instead of creating duplicate', {
                intentId: existing.id,
                label: signal.label,
              });
            } else if (signal.confidence >= INTENT_DEFAULTS.EXPLICIT_MIN_CONFIDENCE) {
              const newIntent = await intentService.createIntent({
                userId,
                type: signal.type,
                label: signal.label,
                goal: signal.goal || signal.label,
                sourceSessionId: sessionId,
              });
              activeIntentId = newIntent.id;
            }
          }
          break;

        case 'update':
          if (signal.matchedIntentId) {
            const updated = await intentService.touchIntent(
              signal.matchedIntentId,
              sessionId,
              userMessage.slice(0, 200),
              signal.triggerType
            );
            if (updated) activeIntentId = updated.id;

            if (signal.updates?.blockers && signal.updates.blockers.length > 0) {
              await intentService.addBlocker(signal.matchedIntentId, signal.updates.blockers[0]);
            }
          }
          break;

        case 'resolve':
          if (signal.matchedIntentId) {
            await intentService.resolveIntent(signal.matchedIntentId, 'completed');
            // Don't set activeIntentId for resolved intents
          }
          break;

        case 'suspend':
          if (signal.matchedIntentId) {
            await intentService.suspendIntent(signal.matchedIntentId);
          }
          break;

        case 'switch':
          if (signal.label) {
            const existing = await intentService.findIntentByLabel(userId, signal.label);
            if (existing && existing.status === 'suspended') {
              const reactivated = await intentService.reactivateIntent(existing.id);
              if (reactivated) activeIntentId = reactivated.id;
            }
          }
          break;
      }
    } else if (!activeIntentId && context.activeIntents.length > 0) {
       // If no new signal, but we have active intents, implicit continuation of top priority?
       // Maybe not update timestamp, but we can assume session is related to top intent?
       // Only if confidence is reasonable? 
       // For now, let's NOT assume unless signal is present to avoid noise.
       // However, if we found an "approach change" above, activeIntentId is set.
    }

    // Tag session with the active intent if one was interacted with
    if (activeIntentId) {
      await query(`UPDATE sessions SET primary_intent_id = $1 WHERE id = $2`, [activeIntentId, sessionId]);
    }

  } catch (error) {
    logger.warn('Failed to process message for intents', {
      error: (error as Error).message,
      userId,
    });
  }
}

/**
 * Check if message references any active intent
 * Used for determining if we should touch intents
 */
export function messageReferencesIntent(
  message: string,
  intents: IntentSummary[]
): IntentSummary | null {
  const match = findMatchingIntent(message, intents);
  return match || null;
}

export default {
  detectIntentSignal,
  processMessageForIntents,
  messageReferencesIntent,
};
