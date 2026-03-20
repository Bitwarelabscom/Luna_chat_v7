/**
 * Active Focus Service - Multi-session goal/project tracking
 *
 * After session summaries, extracts goals/projects via background LLM call.
 * Per-message reads return top active focuses for context.
 */

import { query } from '../db/postgres.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import * as embeddingService from './embedding.service.js';
import logger from '../utils/logger.js';

interface ExtractedFocus {
  label: string;
  type: 'project' | 'plan' | 'interest' | 'goal';
  progressNote?: string;
}

/**
 * Extract focuses from a conversation summary. Called after session summary generation.
 * Fire-and-forget - errors are logged but don't propagate.
 */
export async function extractFocuses(
  userId: string,
  sessionId: string,
  summary: string,
  topics: string[]
): Promise<void> {
  try {
    if (!summary || summary.length < 30) return;

    const modelConfig = await getBackgroundFeatureModelConfig(userId, 'luna_affect_analysis');

    // Get existing active focuses for dedup context
    const existing = await query(
      `SELECT id, focus_label, focus_type, confidence FROM user_active_focuses
       WHERE user_id = $1 AND status = 'active'
       ORDER BY last_seen_at DESC LIMIT 10`,
      [userId]
    ) as Array<{ id: string; focus_label: string; focus_type: string; confidence: number }>;

    const existingList = existing.length > 0
      ? existing.map(f => `- "${f.focus_label}" (${f.focus_type})`).join('\n')
      : 'None';

    const result = await createCompletion(
      modelConfig.primary.provider,
      modelConfig.primary.model,
      [
        {
          role: 'system',
          content: `Extract goals, projects, or ongoing interests from this conversation summary.
Also check if any existing focuses show progress.

Existing focuses:
${existingList}

Output JSON:
{
  "new": [{"label": "short description", "type": "project|plan|interest|goal"}],
  "progress": [{"label": "existing focus label (exact match)", "note": "what progress was made"}]
}
- Only extract genuine multi-session goals/projects, not one-off topics
- "new" should NOT duplicate existing focuses
- Max 3 new, max 3 progress updates
- Output ONLY JSON, no markdown`,
        },
        {
          role: 'user',
          content: `Summary: ${summary}\nTopics: ${topics.join(', ')}`,
        },
      ],
      {
        temperature: 0.3,
        maxTokens: 300,
        loggingContext: { userId, source: 'active_focus', nodeName: 'focus_extraction' },
      }
    );

    let parsed: { new?: ExtractedFocus[]; progress?: Array<{ label: string; note: string }> };
    try {
      const cleaned = result.content.trim().replace(/^```json?\n?|\n?```$/g, '');
      parsed = JSON.parse(cleaned);
    } catch {
      logger.debug('Failed to parse focus extraction result', { userId });
      return;
    }

    // Insert new focuses (with embedding-based dedup against existing)
    if (parsed.new && Array.isArray(parsed.new)) {
      for (const focus of parsed.new.slice(0, 3)) {
        if (!focus.label || !focus.type) continue;

        // Fuzzy dedup: check embedding similarity against existing
        const isDuplicate = await checkDuplicate(userId, focus.label);
        if (isDuplicate) continue;

        await query(
          `INSERT INTO user_active_focuses (user_id, focus_label, focus_type, source_session_ids, last_seen_at)
           VALUES ($1, $2, $3, ARRAY[$4::uuid], NOW())`,
          [userId, focus.label, focus.type, sessionId]
        );
      }
    }

    // Update progress on existing focuses
    if (parsed.progress && Array.isArray(parsed.progress)) {
      for (const prog of parsed.progress.slice(0, 3)) {
        if (!prog.label || !prog.note) continue;

        await query(
          `UPDATE user_active_focuses
           SET mention_count = mention_count + 1,
               last_seen_at = NOW(),
               progress_notes = array_append(progress_notes, $3),
               source_session_ids = array_append(source_session_ids, $4::uuid),
               confidence = LEAST(confidence + 0.1, 1.0),
               updated_at = NOW()
           WHERE user_id = $1 AND focus_label = $2 AND status = 'active'`,
          [userId, prog.label, prog.note, sessionId]
        );
      }
    }

    logger.debug('Focus extraction complete', {
      userId,
      newCount: parsed.new?.length || 0,
      progressCount: parsed.progress?.length || 0,
    });
  } catch (error) {
    logger.error('Focus extraction failed', { userId, error: (error as Error).message });
  }
}

/**
 * Check if a focus label is a duplicate of existing focuses using embedding similarity.
 */
async function checkDuplicate(userId: string, label: string): Promise<boolean> {
  try {
    const existing = await query(
      `SELECT focus_label FROM user_active_focuses
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    ) as Array<{ focus_label: string }>;

    if (existing.length === 0) return false;

    // Generate embedding for new label
    const { embedding: newEmb } = await embeddingService.generateEmbedding(label);

    // Compare against existing labels
    for (const ex of existing) {
      const { embedding: exEmb } = await embeddingService.generateEmbedding(ex.focus_label);
      const similarity = cosineSimilarity(newEmb, exEmb);
      if (similarity > 0.85) return true;
    }

    return false;
  } catch {
    return false; // On error, allow insert
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Get active focus context for a user. Called per-message (~2ms).
 */
export async function getActiveFocusContext(userId: string): Promise<string> {
  try {
    const focuses = await query(
      `SELECT focus_label, focus_type, mention_count, last_seen_at,
              progress_notes[array_upper(progress_notes, 1)] AS latest_note,
              first_seen_at
       FROM user_active_focuses
       WHERE user_id = $1 AND status = 'active' AND confidence > 0.3
       ORDER BY last_seen_at DESC, confidence DESC
       LIMIT 4`,
      [userId]
    ) as Array<{
      focus_label: string;
      focus_type: string;
      mention_count: number;
      last_seen_at: Date;
      latest_note: string | null;
      first_seen_at: Date;
    }>;

    if (focuses.length === 0) return '';

    const lines = focuses.map(f => {
      const daysSince = Math.floor((Date.now() - new Date(f.first_seen_at).getTime()) / (1000 * 60 * 60 * 24));
      const duration = daysSince === 0 ? 'today' : daysSince === 1 ? '1 day' : `${daysSince} days`;
      const progress = f.latest_note ? `, last: ${f.latest_note}` : '';
      const mentions = f.mention_count > 1 ? ` (mentioned ${f.mention_count}x)` : '';
      return `- ${f.focus_label} (${duration}${mentions}${progress})`;
    });

    return lines.join('\n');
  } catch (error) {
    logger.debug('Active focus context fetch failed', { error: (error as Error).message });
    return '';
  }
}

/**
 * Mark stale focuses. Called daily.
 */
export async function staleFocusCheck(): Promise<void> {
  try {
    await query(
      `UPDATE user_active_focuses
       SET status = 'stale', updated_at = NOW()
       WHERE status = 'active'
         AND last_seen_at < NOW() - INTERVAL '7 days'`
    );
  } catch (error) {
    logger.error('Stale focus check failed', { error: (error as Error).message });
  }
}
