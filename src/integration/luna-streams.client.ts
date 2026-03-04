/**
 * Luna Streams Client - fire-and-forget event emission + context retrieval.
 *
 * Communicates with the luna-streams service (Mamba SSM continuous cognition)
 * via HTTP. All event emissions are fire-and-forget (no blocking).
 * Context retrieval uses delta tracking to avoid unnecessary regeneration.
 */

import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Cache for delta tracking - context only changes on meaningful state shifts
const contextCache = new Map<string, { context: string; hash: string; tokenCount: number }>();

function getBaseUrl(): string {
  return config.lunaStreams?.url || 'http://luna-streams:8100';
}

function isEnabled(): boolean {
  return config.lunaStreams?.enabled ?? false;
}

// -------------------------------------------------------------------
// Event emission (fire-and-forget)
// -------------------------------------------------------------------

interface StreamEvent {
  timestamp: string;
  event_type: 'memory_entry' | 'entity_update' | 'edge_update' | 'conversation_meta';
  source: 'conversation' | 'agent_dialogue' | 'neuralsleep' | 'system';
  content: {
    entities?: string[];
    relations?: Array<{ from: string; to: string; type: string; weight: number }>;
    topic_tags?: string[];
    sentiment?: number;
    importance?: number;
    summary?: string;
  };
  conversation_meta?: {
    message_length?: number;
    response_time_ms?: number;
    session_duration_min?: number;
    active_persona?: string;
    active_model?: string;
    turn_number?: number;
  };
}

/**
 * Emit a structured event to luna-streams. Fire-and-forget - never blocks chat.
 */
export function emitEvent(event: StreamEvent): void {
  if (!isEnabled()) return;

  // Fire-and-forget: no await, catch errors silently
  fetch(`${getBaseUrl()}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [event] }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => {
    logger.debug(`[luna-streams] emit failed: ${err.message}`);
  });
}

/**
 * Emit a chat interaction as a memory_entry event.
 */
export function emitChatInteraction(
  content: string,
  metadata: {
    mode?: string;
    model?: string;
    sentiment?: number;
    attentionScore?: number;
    responseTimeMs?: number;
    entities?: string[];
    topicTags?: string[];
    turnNumber?: number;
  },
): void {
  emitEvent({
    timestamp: new Date().toISOString(),
    event_type: 'memory_entry',
    source: 'conversation',
    content: {
      entities: metadata.entities || [],
      topic_tags: metadata.topicTags || [],
      sentiment: metadata.sentiment ?? 0.0,
      importance: metadata.attentionScore ?? 0.5,
      summary: content.slice(0, 150),
    },
    conversation_meta: {
      active_model: metadata.model,
      active_persona: metadata.mode,
      response_time_ms: metadata.responseTimeMs,
      turn_number: metadata.turnNumber,
    },
  });
}

/**
 * Emit entity extraction results as an entity_update event.
 */
export function emitEntityUpdate(
  entities: Array<{ label: string; type: string; confidence: number }>,
  cooccurrences: number,
): void {
  emitEvent({
    timestamp: new Date().toISOString(),
    event_type: 'entity_update',
    source: 'conversation',
    content: {
      entities: entities.map(e => e.label),
      importance: Math.max(...entities.map(e => e.confidence), 0.5),
      summary: `${entities.length} entities, ${cooccurrences} cooccurrences`,
    },
  });
}

/**
 * Emit edge classification results as an edge_update event.
 */
export function emitEdgeUpdate(
  edges: Array<{ source: string; target: string; edge_type: string; weight: number }>,
): void {
  emitEvent({
    timestamp: new Date().toISOString(),
    event_type: 'edge_update',
    source: 'conversation',
    content: {
      entities: [...new Set(edges.flatMap(e => [e.source, e.target]))],
      relations: edges.map(e => ({
        from: e.source,
        to: e.target,
        type: e.edge_type,
        weight: e.weight,
      })),
      summary: `${edges.length} edges classified`,
    },
  });
}

/**
 * Emit session metadata as a conversation_meta event.
 */
export function emitSessionMeta(meta: {
  messageLength?: number;
  responseTimeMs?: number;
  sessionDurationMin?: number;
  activePersona?: string;
  activeModel?: string;
  turnNumber?: number;
}): void {
  emitEvent({
    timestamp: new Date().toISOString(),
    event_type: 'conversation_meta',
    source: 'conversation',
    content: {},
    conversation_meta: {
      message_length: meta.messageLength,
      response_time_ms: meta.responseTimeMs,
      session_duration_min: meta.sessionDurationMin,
      active_persona: meta.activePersona,
      active_model: meta.activeModel,
      turn_number: meta.turnNumber,
    },
  });
}

// -------------------------------------------------------------------
// Context retrieval (with delta tracking)
// -------------------------------------------------------------------

interface StreamContextResponse {
  context: string;
  changed: boolean;
  token_count: number;
}

/**
 * Get stream context for prompt injection. Returns null if unchanged or unavailable.
 * Uses delta tracking - only returns new context when state has meaningfully shifted.
 */
export async function getStreamContext(userId?: string): Promise<string | null> {
  if (!isEnabled()) return null;

  try {
    const url = userId
      ? `${getBaseUrl()}/api/context?user_id=${encodeURIComponent(userId)}`
      : `${getBaseUrl()}/api/context`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as StreamContextResponse;

    // Delta tracking: return null if nothing changed
    const cacheKey = userId || '__default__';
    const cached = contextCache.get(cacheKey);
    if (cached && !data.changed) {
      return cached.context;
    }

    // Update cache
    contextCache.set(cacheKey, {
      context: data.context,
      hash: '', // Server handles delta detection via 'changed' field
      tokenCount: data.token_count,
    });

    return data.context;
  } catch (err) {
    logger.debug(`[luna-streams] context fetch failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Health check for luna-streams service.
 */
export async function healthCheck(): Promise<boolean> {
  if (!isEnabled()) return false;

  try {
    const response = await fetch(`${getBaseUrl()}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
