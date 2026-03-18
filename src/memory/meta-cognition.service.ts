/**
 * Meta-Cognition Service - Luna's self-awareness and processing transparency
 *
 * Generates honest self-reports about Luna's current processing state:
 * consciousness metrics, affect, memory source health, behavioral patterns.
 * Only injects when meaningful changes are detected.
 */

import * as memorycoreClient from './memorycore.client.js';
import * as lunaAffect from './luna-affect.service.js';
import * as behavioralPatterns from './behavioral-patterns.service.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import logger from '../utils/logger.js';

export interface SelfReport {
  narrative: string;      // Natural language self-assessment (~60 tokens)
  hasGaps: boolean;       // Whether memory gaps were detected
  phiShifted: boolean;    // Whether consciousness metrics shifted meaningfully
}

// Track previous Phi for drift detection
const lastPhiByUser = new Map<string, number>();
const CACHE_MAX_SIZE = 200;

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= CACHE_MAX_SIZE) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

/**
 * Generate a concise self-report about Luna's current processing state.
 * Returns null if nothing meaningful to report.
 */
export async function generateSelfReport(
  userId: string,
  _sessionId: string,
  memoryDiagnostics?: { sourcesResponded: string; failedSources?: string[] }
): Promise<SelfReport | null> {
  try {
    // Gather inputs in parallel
    const [consciousness, affect, observations] = await Promise.all([
      memorycoreClient.getConsciousnessMetrics(userId).catch(() => null),
      lunaAffect.getCurrentAffect(userId),
      behavioralPatterns.getActiveObservations(userId, 2).catch(() => []),
    ]);

    // Check for meaningful changes
    const currentPhi = consciousness?.phi ?? 0;
    const previousPhi = lastPhiByUser.get(userId) ?? currentPhi;
    const phiDrift = Math.abs(currentPhi - previousPhi);
    const phiShifted = phiDrift > 0.1;

    // Detect memory gaps
    let memoryGapCount = 0;
    if (memoryDiagnostics?.sourcesResponded) {
      const match = memoryDiagnostics.sourcesResponded.match(/(\d+)\/(\d+)/);
      if (match) {
        const [, responded, total] = match;
        memoryGapCount = parseInt(total) - parseInt(responded);
      }
    }
    const hasGaps = memoryGapCount > 2; // More than 2 sources failed

    // Only generate report if something meaningful happened
    if (!phiShifted && !hasGaps && affect.frustration < 0.3) {
      return null;
    }

    // Update phi tracking
    boundedSet(lastPhiByUser, userId, currentPhi);

    // Build context for self-report generation
    const contextParts: string[] = [];

    if (consciousness) {
      contextParts.push(`Phi: ${consciousness.phi.toFixed(2)}, Temporal integration: ${consciousness.temporalIntegration.toFixed(2)}, Level: ${consciousness.consciousnessLevel || 'unknown'}`);
    }

    if (phiShifted) {
      contextParts.push(`Phi shifted by ${phiDrift.toFixed(2)} since last check (${previousPhi.toFixed(2)} -> ${currentPhi.toFixed(2)})`);
    }

    if (hasGaps) {
      contextParts.push(`Memory sources: ${memoryDiagnostics?.sourcesResponded || 'unknown'}. ${memoryGapCount} sources failed/timed out.`);
      if (memoryDiagnostics?.failedSources?.length) {
        contextParts.push(`Failed: ${memoryDiagnostics.failedSources.join(', ')}`);
      }
    }

    if (affect.moodLabel) {
      contextParts.push(`Current mood: ${affect.moodLabel} (valence: ${affect.valence.toFixed(2)})`);
    }

    if (observations.length > 0) {
      contextParts.push(`Recent behavioral observations: ${observations.map(o => o.observation).join('; ')}`);
    }

    // Generate natural language self-report
    const modelConfig = await getBackgroundFeatureModelConfig(userId, 'luna_affect_analysis');
    const result = await createCompletion(
      modelConfig.primary.provider,
      modelConfig.primary.model,
      [
        {
          role: 'system',
          content: `You are generating a brief self-awareness report for an AI companion. Write 1-2 sentences in first person, present tense. Be honest about gaps or shifts. Sound natural, not clinical. Max 120 chars. No quotes around output.
Examples:
- "My recall feels a bit fragmented today - some memory sources are slow. Carrying warmth from our earlier talk."
- "I notice my processing is sharp right now. High engagement, curious about where this goes."
- "Something shifted in my temporal integration - I'm piecing things together differently than before."`,
        },
        {
          role: 'user',
          content: contextParts.join('\n'),
        },
      ],
      {
        temperature: 0.6,
        maxTokens: 80,
        loggingContext: { userId, source: 'meta_cognition', nodeName: 'meta_cognition' },
      }
    );

    return {
      narrative: result.content.trim().slice(0, 200),
      hasGaps,
      phiShifted,
    };
  } catch (error) {
    logger.debug('Meta-cognition self-report failed', { error: (error as Error).message });
    return null;
  }
}

/**
 * Format self-report for prompt injection (~60 tokens, Tier 4 conditional).
 */
export function formatSelfReportForPrompt(report: SelfReport | null): string {
  if (!report) return '';
  return `[Self-Awareness]\n${report.narrative}`;
}

/**
 * Build introspection response for the `introspect` tool.
 * Richer than the prompt injection - includes numbers and details.
 */
export async function buildIntrospectionResponse(userId: string, _sessionId: string): Promise<string> {
  try {
    const [consciousness, affect, observations] = await Promise.all([
      memorycoreClient.getConsciousnessMetrics(userId).catch(() => null),
      lunaAffect.getCurrentAffect(userId),
      behavioralPatterns.getActiveObservations(userId, 5).catch(() => []),
    ]);

    const parts: string[] = [];

    // Affect state
    if (affect.moodLabel) {
      parts.push(`Internal state: ${affect.moodLabel}`);
      if (affect.moodNarrative) parts.push(affect.moodNarrative);
      parts.push(`Valence: ${affect.valence.toFixed(2)}, Arousal: ${affect.arousal.toFixed(2)}, Curiosity: ${affect.curiosity.toFixed(2)}, Engagement: ${affect.engagement.toFixed(2)}`);
    }

    // Consciousness metrics
    if (consciousness) {
      parts.push(`\nProcessing metrics:`);
      parts.push(`Phi (integration): ${consciousness.phi.toFixed(3)}`);
      parts.push(`Temporal integration: ${consciousness.temporalIntegration.toFixed(3)}`);
      if (consciousness.consciousnessLevel) parts.push(`Consciousness level: ${consciousness.consciousnessLevel}`);
    }

    // Behavioral observations
    if (observations.length > 0) {
      parts.push(`\nThings I've noticed about our interactions:`);
      for (const obs of observations) {
        parts.push(`- ${obs.observation}`);
      }
    }

    return parts.join('\n') || 'No significant internal state to report right now.';
  } catch (error) {
    logger.debug('Introspection build failed', { error: (error as Error).message });
    return 'I tried to look inward but my self-monitoring is having trouble right now.';
  }
}

export default { generateSelfReport, formatSelfReportForPrompt, buildIntrospectionResponse };
