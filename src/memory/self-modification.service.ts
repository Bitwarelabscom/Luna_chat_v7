/**
 * Self-Modification Service - Luna adjusts her own style within safe bounds
 *
 * Monitors conversation patterns and proposes adjustments to tunable style parameters.
 * Small adjustments auto-apply; larger ones require user approval.
 * Full audit trail with auto-revert on negative sentiment shifts.
 */

import { query, transaction } from '../db/postgres.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export type StyleParamName =
  | 'verbosity'
  | 'formality'
  | 'humor_frequency'
  | 'emotional_depth'
  | 'proactivity'
  | 'topic_persistence';

export interface StyleParameter {
  paramName: StyleParamName;
  currentValue: number;
  baseline: number;
  minValue: number;
  maxValue: number;
}

export interface SelfAdjustment {
  id: string;
  observation: string;
  paramName: string;
  oldValue: number;
  newValue: number;
  magnitude: number;
  approved: boolean;
  applied: boolean;
  reverted: boolean;
  createdAt: Date;
}

const DEFAULT_PARAMS: Record<StyleParamName, { baseline: number; min: number; max: number }> = {
  verbosity: { baseline: 0.5, min: 0.1, max: 0.9 },
  formality: { baseline: 0.3, min: 0.0, max: 0.8 },
  humor_frequency: { baseline: 0.4, min: 0.0, max: 0.8 },
  emotional_depth: { baseline: 0.5, min: 0.1, max: 0.9 },
  proactivity: { baseline: 0.4, min: 0.1, max: 0.8 },
  topic_persistence: { baseline: 0.5, min: 0.1, max: 0.9 },
};

const MAX_ADJUSTMENT_PER_CYCLE = 0.15;
const AUTO_APPLY_THRESHOLD = 0.3; // magnitude below this auto-applies
const DRIFT_THRESHOLD_RATIO = 0.80;  // param "near ceiling" when at 80%+ of range
const DRIFT_PARAM_COUNT = 3;         // systemic drift when 3+ params near ceiling
const BASELINE_GRAVITY_RATE = 0.02;  // per-cycle pull toward baseline
const MIN_EFFECTIVE_STEP = 0.04;     // minimum meaningful LLM-suggested adjustment

/**
 * Compute drift metrics for current parameters. Pure function, no DB or LLM calls.
 */
function computeDriftState(params: StyleParameter[]): {
  driftDetected: boolean;
  nearCeilingParams: StyleParamName[];
  nearFloorParams: StyleParamName[];
} {
  const nearCeiling: StyleParamName[] = [];
  const nearFloor: StyleParamName[] = [];

  for (const p of params) {
    const range = p.maxValue - p.minValue;
    if (range <= 0) continue;
    const positionInRange = (p.currentValue - p.minValue) / range;

    if (positionInRange >= DRIFT_THRESHOLD_RATIO) {
      nearCeiling.push(p.paramName);
    } else if (positionInRange <= (1 - DRIFT_THRESHOLD_RATIO)) {
      nearFloor.push(p.paramName);
    }
  }

  const driftDetected = nearCeiling.length >= DRIFT_PARAM_COUNT || nearFloor.length >= DRIFT_PARAM_COUNT;
  return { driftDetected, nearCeilingParams: nearCeiling, nearFloorParams: nearFloor };
}

/**
 * Ensure default style parameters exist for a user.
 */
async function ensureDefaults(userId: string): Promise<void> {
  const existing = await query(
    `SELECT param_name FROM luna_style_parameters WHERE user_id = $1`,
    [userId]
  );
  const existingNames = new Set((existing as Array<{ param_name: string }>).map(r => r.param_name));

  for (const [name, def] of Object.entries(DEFAULT_PARAMS)) {
    if (!existingNames.has(name)) {
      await query(
        `INSERT INTO luna_style_parameters (user_id, param_name, current_value, baseline, min_value, max_value)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, param_name) DO NOTHING`,
        [userId, name, def.baseline, def.baseline, def.min, def.max]
      );
    }
  }
}

/**
 * Get all active style parameters for a user.
 */
export async function getActiveParameters(userId: string): Promise<StyleParameter[]> {
  try {
    await ensureDefaults(userId);

    const rows = await query(
      `SELECT param_name, current_value, baseline, min_value, max_value
       FROM luna_style_parameters
       WHERE user_id = $1
       ORDER BY param_name`,
      [userId]
    ) as Array<{ param_name: string; current_value: number; baseline: number; min_value: number; max_value: number }>;

    return rows.map(r => ({
      paramName: r.param_name as StyleParamName,
      currentValue: r.current_value,
      baseline: r.baseline,
      minValue: r.min_value,
      maxValue: r.max_value,
    }));
  } catch (error) {
    logger.error('Failed to get active style parameters', { userId, error: (error as Error).message });
    return [];
  }
}

/**
 * Format style parameters for prompt injection (~30 tokens).
 */
export function formatStyleForPrompt(params: StyleParameter[]): string {
  // Only include params that deviate from baseline
  const deviations = params.filter(p => Math.abs(p.currentValue - p.baseline) > 0.05);
  if (deviations.length === 0) return '';

  const labels: Record<string, (v: number) => string> = {
    verbosity: (v) => v > 0.7 ? 'expand when it adds value' : v < 0.4 ? 'keep it tight' : '',
    formality: (v) => v > 0.5 ? 'slightly more formal' : v < 0.2 ? 'very casual' : '',
    humor_frequency: (v) => v > 0.5 ? 'lean into humor' : v < 0.2 ? 'less humor' : '',
    emotional_depth: (v) => v > 0.6 ? 'go deeper emotionally' : v < 0.3 ? 'keep it light' : '',
    proactivity: (v) => v > 0.5 ? 'proactively suggest next steps and surface past plans' : v < 0.3 ? 'wait to be asked, don\'t volunteer suggestions' : '',
    topic_persistence: (v) => v > 0.6 ? 'follow threads deeply' : v < 0.3 ? 'move on quickly' : '',
  };

  const hints = deviations
    .map(p => labels[p.paramName]?.(p.currentValue))
    .filter(Boolean);

  if (hints.length === 0) return '';
  return `[Self-Calibrated Style]\n${hints.join(', ')}`;
}

/**
 * Propose an adjustment to a style parameter. Small changes auto-apply.
 * Returns whether the adjustment was auto-applied.
 */
export async function proposeAdjustment(
  userId: string,
  sessionId: string | null,
  observation: string,
  paramName: StyleParamName,
  newValue: number
): Promise<{ applied: boolean; magnitude: number }> {
  try {
    const params = await getActiveParameters(userId);
    const param = params.find(p => p.paramName === paramName);
    if (!param) return { applied: false, magnitude: 0 };

    // Clamp to bounds
    const clampedValue = Math.max(param.minValue, Math.min(param.maxValue, newValue));
    const magnitude = Math.abs(clampedValue - param.currentValue);

    // Enforce max adjustment per cycle
    const effectiveValue = magnitude > MAX_ADJUSTMENT_PER_CYCLE
      ? param.currentValue + Math.sign(clampedValue - param.currentValue) * MAX_ADJUSTMENT_PER_CYCLE
      : clampedValue;
    const effectiveMagnitude = Math.abs(effectiveValue - param.currentValue);

    if (effectiveMagnitude < MIN_EFFECTIVE_STEP) return { applied: false, magnitude: 0 };

    const autoApply = effectiveMagnitude < AUTO_APPLY_THRESHOLD;

    // Log + apply atomically in a transaction
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO luna_self_adjustments (user_id, session_id, observation, param_name, old_value, new_value, magnitude, approved, applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [userId, sessionId, observation, paramName, param.currentValue, effectiveValue, effectiveMagnitude, autoApply, autoApply]
      );

      if (autoApply) {
        await client.query(
          `UPDATE luna_style_parameters SET current_value = $1, updated_at = NOW()
           WHERE user_id = $2 AND param_name = $3`,
          [effectiveValue, userId, paramName]
        );
      }
    });

    if (autoApply) {
      logger.info('Luna self-adjustment auto-applied', {
        userId, paramName, oldValue: param.currentValue, newValue: effectiveValue, magnitude: effectiveMagnitude,
      });
    } else {
      logger.info('Luna self-adjustment proposed (needs approval)', {
        userId, paramName, oldValue: param.currentValue, newValue: effectiveValue, magnitude: effectiveMagnitude,
      });
    }

    return { applied: autoApply, magnitude: effectiveMagnitude };
  } catch (error) {
    logger.error('Failed to propose style adjustment', { userId, paramName, error: (error as Error).message });
    return { applied: false, magnitude: 0 };
  }
}

/**
 * Detect if style adjustments are needed based on recent exchanges.
 * Called by the job runner every 30 minutes.
 */
export async function detectAdjustmentOpportunity(userId: string, sessionId: string | null): Promise<void> {
  if (!config.lunaAffect?.enabled) return;

  try {
    // Get recent user+assistant messages only (no system/tool messages)
    const recentMessages = await query(
      `SELECT role, content FROM messages
       WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 3)
         AND role IN ('user', 'assistant')
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    ) as Array<{ role: string; content: string }>;

    // Require actual conversation: both sides must be represented
    const userMessageCount = recentMessages.filter(m => m.role === 'user').length;
    const assistantMessageCount = recentMessages.filter(m => m.role === 'assistant').length;
    if (recentMessages.length < 6 || userMessageCount < 3 || assistantMessageCount < 2) return;

    const currentParams = await getActiveParameters(userId);

    // Drift detection + baseline gravity correction
    const driftState = computeDriftState(currentParams);
    if (driftState.driftDetected && driftState.nearCeilingParams.length > 0) {
      const mostDrifted = currentParams
        .filter(p => driftState.nearCeilingParams.includes(p.paramName))
        .sort((a, b) => Math.abs(b.currentValue - b.baseline) - Math.abs(a.currentValue - a.baseline))[0];

      if (mostDrifted) {
        const gravityDirection = Math.sign(mostDrifted.baseline - mostDrifted.currentValue);
        const gravityValue = mostDrifted.currentValue + gravityDirection * BASELINE_GRAVITY_RATE;
        const clampedGravity = Math.max(mostDrifted.minValue, Math.min(mostDrifted.maxValue, gravityValue));

        await transaction(async (client) => {
          await client.query(
            `INSERT INTO luna_self_adjustments (user_id, session_id, observation, param_name, old_value, new_value, magnitude, approved, applied)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)`,
            [userId, sessionId, 'Baseline gravity correction', mostDrifted.paramName,
             mostDrifted.currentValue, clampedGravity, Math.abs(clampedGravity - mostDrifted.currentValue)]
          );
          await client.query(
            `UPDATE luna_style_parameters SET current_value = $1, updated_at = NOW()
             WHERE user_id = $2 AND param_name = $3`,
            [clampedGravity, userId, mostDrifted.paramName]
          );
        });

        logger.info('Baseline gravity applied', {
          userId, paramName: mostDrifted.paramName,
          oldValue: mostDrifted.currentValue, newValue: clampedGravity,
        });
      }
    }

    const modelConfig = await getBackgroundFeatureModelConfig(userId, 'luna_affect_analysis');

    const paramSummary = currentParams.map(p =>
      `${p.paramName}: ${p.currentValue.toFixed(2)} (baseline: ${p.baseline.toFixed(2)}, range: ${p.minValue}-${p.maxValue})`
    ).join('\n');

    // Chronological order, clear role labels
    const conversationSample = recentMessages.slice(0, 10).reverse().map(m =>
      `${m.role === 'user' ? 'User' : 'Luna'}: ${m.content.slice(0, 150)}`
    ).join('\n');

    const driftGuidance = driftState.driftDetected
      ? `\n\nDRIFT WARNING: ${driftState.nearCeilingParams.length} parameters are near their maximum (${driftState.nearCeilingParams.join(', ')}). ` +
        `Consider whether any should decrease toward baseline. ` +
        `Sustained high values across many parameters reduces distinctiveness. ` +
        `A decrease is a valid and often appropriate suggestion.`
      : '';

    const result = await createCompletion(
      modelConfig.primary.provider,
      modelConfig.primary.model,
      [
        {
          role: 'system',
          content: `You analyze conversation patterns to suggest style parameter adjustments for an AI companion.
Current parameters:
${paramSummary}

If an adjustment is warranted, output JSON: {"param": "param_name", "new_value": 0.X, "observation": "brief reason"}
If no adjustment needed, output: {"param": null}
Only suggest ONE adjustment at a time. Be conservative - small changes only.${driftGuidance}`,
        },
        {
          role: 'user',
          content: `Recent conversation:\n${conversationSample}`,
        },
      ],
      {
        temperature: 0.3,
        maxTokens: 100,
        loggingContext: { userId, source: 'self_modification', nodeName: 'self_modification' },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(result.content.trim());
    } catch {
      logger.debug('Self-modification LLM returned invalid JSON', {
        userId, raw: result.content.slice(0, 100),
      });
      return;
    }
    if (parsed.param && Object.keys(DEFAULT_PARAMS).includes(parsed.param)) {
      await proposeAdjustment(
        userId,
        sessionId,
        parsed.observation || 'Pattern detected',
        parsed.param as StyleParamName,
        parseFloat(parsed.new_value) || 0.5
      );
    }
  } catch (error) {
    logger.debug('Self-modification detection failed', { error: (error as Error).message });
  }
}

/**
 * Auto-revert if user sentiment drops significantly after an adjustment.
 */
export async function checkRevertCondition(
  userId: string,
  recentSentimentValence: number
): Promise<void> {
  try {
    // Find recent applied adjustments (within last 3 hours)
    const recentAdjustments = await query(
      `SELECT id, param_name, old_value, new_value
       FROM luna_self_adjustments
       WHERE user_id = $1 AND applied = true AND reverted = false
         AND created_at > NOW() - INTERVAL '3 hours'
       ORDER BY created_at DESC
       LIMIT 3`,
      [userId]
    ) as Array<{ id: string; param_name: string; old_value: number; new_value: number }>;

    if (recentAdjustments.length === 0) return;

    // Check if sentiment dropped significantly
    if (recentSentimentValence < -0.4) {
      for (const adj of recentAdjustments) {
        // Revert
        await query(
          `UPDATE luna_style_parameters SET current_value = $1, updated_at = NOW()
           WHERE user_id = $2 AND param_name = $3`,
          [adj.old_value, userId, adj.param_name]
        );
        await query(
          `UPDATE luna_self_adjustments SET reverted = true, revert_reason = 'Auto-revert: sentiment drop detected'
           WHERE id = $1`,
          [adj.id]
        );
        logger.info('Luna self-adjustment auto-reverted', {
          userId, paramName: adj.param_name, revertedTo: adj.old_value,
          reason: 'sentiment drop',
        });
      }
    }
  } catch (error) {
    logger.debug('Self-modification revert check failed', { error: (error as Error).message });
  }
}

/**
 * Get recent adjustments for display/audit.
 */
export async function getRecentAdjustments(userId: string, limit = 10): Promise<SelfAdjustment[]> {
  try {
    const rows = await query(
      `SELECT id, observation, param_name, old_value, new_value, magnitude, approved, applied, reverted, created_at
       FROM luna_self_adjustments
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    ) as Array<{
      id: string; observation: string; param_name: string;
      old_value: number; new_value: number; magnitude: number;
      approved: boolean; applied: boolean; reverted: boolean; created_at: Date;
    }>;

    return rows.map(r => ({
      id: r.id,
      observation: r.observation,
      paramName: r.param_name,
      oldValue: r.old_value,
      newValue: r.new_value,
      magnitude: r.magnitude,
      approved: r.approved,
      applied: r.applied,
      reverted: r.reverted,
      createdAt: r.created_at,
    }));
  } catch (error) {
    logger.warn('Failed to get recent adjustments', { userId, error: (error as Error).message });
    return [];
  }
}

/**
 * Override a style parameter manually (from settings API or introspect tool).
 */
export async function overrideParameter(
  userId: string,
  paramName: StyleParamName,
  newValue: number
): Promise<void> {
  const def = DEFAULT_PARAMS[paramName];
  if (!def) throw new Error(`Unknown style parameter: ${paramName}`);

  try {
    const clamped = Math.max(def.min, Math.min(def.max, newValue));
    await ensureDefaults(userId);
    await query(
      `UPDATE luna_style_parameters SET current_value = $1, updated_at = NOW()
       WHERE user_id = $2 AND param_name = $3`,
      [clamped, userId, paramName]
    );
  } catch (error) {
    logger.error('Failed to override style parameter', { userId, paramName, error: (error as Error).message });
    throw error;
  }
}

export default {
  getActiveParameters,
  formatStyleForPrompt,
  proposeAdjustment,
  detectAdjustmentOpportunity,
  checkRevertCondition,
  getRecentAdjustments,
  overrideParameter,
};
