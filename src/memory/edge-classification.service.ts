import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import { createEdge } from './memorycore-graph.service.js';
import { mcQuery } from '../db/memorycore-pool.js';
import logger from '../utils/logger.js';

// Tight 8-type taxonomy for semantic edge classification
export const SEMANTIC_EDGE_TYPES = [
  'discussed',
  'interested_in',
  'working_on',
  'knows_person',
  'dislikes',
  'geopolitical',
  'temporal_pattern',
  'technical_tool',
] as const;

export type SemanticEdgeType = (typeof SEMANTIC_EDGE_TYPES)[number];

const VALID_TYPES_SET = new Set<string>(SEMANTIC_EDGE_TYPES);

interface EntityInfo {
  label: string;
  type: string;
}

/**
 * Classify edges between extracted entities using a background LLM call.
 * Creates additional typed edges alongside the existing co_occurrence edges.
 * Fire-and-forget - errors are logged but never propagated.
 */
export async function classifyEdges(
  userId: string,
  sessionId: string,
  messageContent: string,
  messageRole: string,
  entities: EntityInfo[],
): Promise<void> {
  if (entities.length < 2) return;

  // Build unique pairs
  const pairs: Array<[EntityInfo, EntityInfo]> = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      pairs.push([entities[i], entities[j]]);
    }
  }

  // Cap pairs to avoid huge prompts
  const cappedPairs = pairs.slice(0, 15);

  const pairsText = cappedPairs
    .map(([a, b], idx) => `${idx + 1}. "${a.label}" (${a.type}) <-> "${b.label}" (${b.type})`)
    .join('\n');

  const systemPrompt = `You classify entity relationships from conversation messages.

Given a message and entity pairs, assign each pair exactly one relationship type from this taxonomy:
- discussed: Neutral mention or generic reference
- interested_in: Active interest, curiosity, or enthusiasm
- working_on: Project, task, or work relationship
- knows_person: Social connection between people
- dislikes: Negative valence, concern, or dislike
- geopolitical: News, world events, political context
- temporal_pattern: Recurring time-based pattern (e.g. Sunday+Coffee)
- technical_tool: Infrastructure, tool, stack, or technology

Respond with ONLY a JSON array. Each element: {"pair": <1-based index>, "type": "<edge_type>"}
If a pair is just a neutral co-mention with no clear relationship, use "discussed".
Do not include any text outside the JSON array.`;

  const userPrompt = `Message (${messageRole}): "${messageContent.slice(0, 500)}"

Entity pairs:
${pairsText}`;

  try {
    const result = await createBackgroundCompletionWithFallback({
      userId,
      sessionId,
      feature: 'edge_classification',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      maxTokens: 300,
    });

    if (!result.content) return;

    // Extract JSON array from response (handle markdown fences)
    let jsonStr = result.content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let classifications: Array<{ pair: number; type: string }>;
    try {
      classifications = JSON.parse(jsonStr);
    } catch {
      logger.warn('Edge classification: failed to parse LLM JSON', {
        raw: jsonStr.slice(0, 200),
      });
      return;
    }

    if (!Array.isArray(classifications)) return;

    // Resolve node IDs for all entities in one query
    const labels = entities.map(e => e.label.toLowerCase());
    const nodeRows = await mcQuery<{ id: string; node_label: string }>(
      `SELECT id, LOWER(node_label) as node_label FROM memory_nodes
       WHERE user_id = $1 AND is_active = true AND LOWER(node_label) = ANY($2::text[])`,
      [userId, labels]
    );
    const labelToId = new Map<string, string>();
    for (const row of nodeRows) {
      labelToId.set(row.node_label as string, row.id as string);
    }

    // Process each classification
    let created = 0;
    for (const item of classifications) {
      if (!item || typeof item.pair !== 'number') continue;
      const pairIdx = item.pair - 1;
      if (pairIdx < 0 || pairIdx >= cappedPairs.length) continue;

      const edgeType = VALID_TYPES_SET.has(item.type) ? item.type as SemanticEdgeType : 'discussed';
      // Skip 'discussed' - co_occurrence already covers neutral mentions
      if (edgeType === 'discussed') continue;

      const [entityA, entityB] = cappedPairs[pairIdx];
      const sourceId = labelToId.get(entityA.label.toLowerCase());
      const targetId = labelToId.get(entityB.label.toLowerCase());
      if (!sourceId || !targetId) continue;

      try {
        await createEdge(userId, {
          sourceId,
          targetId,
          type: edgeType,
          strength: 0.6,
          sessionId,
        });
        created++;
      } catch (err) {
        logger.debug('Edge classification: failed to create typed edge', {
          error: (err as Error).message,
          edgeType,
          source: entityA.label,
          target: entityB.label,
        });
      }
    }

    if (created > 0) {
      logger.info('Edge classification: created typed edges', {
        userId,
        sessionId,
        created,
        totalPairs: cappedPairs.length,
      });
    }
  } catch (error) {
    logger.warn('Edge classification failed', {
      error: (error as Error).message,
      userId,
      entityCount: entities.length,
    });
  }
}
