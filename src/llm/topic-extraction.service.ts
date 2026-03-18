/**
 * Topic Extraction Service
 *
 * Uses the ollama_micro provider (LFM 2.5 1.2B on 10.0.0.3) for fast,
 * local topic extraction and intent classification.
 *
 * Typical latency: ~1s. No external API cost.
 */

import { createCompletion, isConfigured } from './providers/ollama-micro.provider.js';
import logger from '../utils/logger.js';

const DEFAULT_MODEL = 'tomng/lfm2.5-instruct:1.2b-q8_0';
const TIMEOUT_MS = 3000;

export interface TopicExtractionResult {
  topics: string[];
  intent: 'chat' | 'question' | 'request' | 'opinion' | 'story' | 'unknown';
}

// Simple in-memory cache (message hash -> result)
const cache = new Map<string, { result: TopicExtractionResult; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(text: string): string {
  return text.toLowerCase().trim().slice(0, 200);
}

function cleanCache(): void {
  const now = Date.now();
  Array.from(cache.entries()).forEach(([key, val]) => {
    if (now - val.ts > CACHE_TTL_MS) cache.delete(key);
  });
}

/**
 * Extract topics and classify intent from a message.
 *
 * Returns 1-3 topic keywords and a broad intent class.
 * Falls back to empty result on error (never throws).
 */
export async function extractTopics(message: string): Promise<TopicExtractionResult> {
  const empty: TopicExtractionResult = { topics: [], intent: 'unknown' };

  if (!message || message.length < 5) return empty;
  if (!isConfigured()) {
    logger.debug('Topic extraction skipped - ollama_micro not configured');
    return empty;
  }

  // Check cache
  const key = cacheKey(message);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  // Periodic cleanup
  if (Math.random() < 0.05) cleanCache();

  try {
    const result = await Promise.race([
      createCompletion(DEFAULT_MODEL, [
        {
          role: 'system',
          content: `Extract topics and intent from the user message. Output JSON only.

Format: {"topics":["topic1","topic2"],"intent":"chat|question|request|opinion|story"}

Rules:
- 1-3 topic keywords, lowercase, no filler words
- intent: chat (greetings/social), question (seeking info), request (asking for action), opinion (sharing views), story (telling about events)

Examples:
"Hey how are you?" -> {"topics":["greeting"],"intent":"chat"}
"What's the best way to learn guitar?" -> {"topics":["guitar","learning"],"intent":"question"}
"Can you play some jazz music?" -> {"topics":["jazz","music"],"intent":"request"}
"I think AI is going to change everything" -> {"topics":["ai","future"],"intent":"opinion"}`,
        },
        { role: 'user', content: message.slice(0, 500) },
      ], {
        temperature: 0.1,
        maxTokens: 60,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Topic extraction timeout')), TIMEOUT_MS)
      ),
    ]);

    const parsed = parseResponse(result.content);
    cache.set(key, { result: parsed, ts: Date.now() });

    logger.debug('Topic extraction done', {
      topics: parsed.topics,
      intent: parsed.intent,
      tokens: result.tokensUsed,
    });

    return parsed;
  } catch (error) {
    logger.warn('Topic extraction failed', { error: (error as Error).message });
    return empty;
  }
}

function parseResponse(raw: string): TopicExtractionResult {
  const empty: TopicExtractionResult = { topics: [], intent: 'unknown' };

  try {
    // Try to find JSON in the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return empty;

    const data = JSON.parse(jsonMatch[0]);
    const validIntents = ['chat', 'question', 'request', 'opinion', 'story'];

    return {
      topics: Array.isArray(data.topics)
        ? data.topics.filter((t: unknown) => typeof t === 'string').slice(0, 3)
        : [],
      intent: validIntents.includes(data.intent) ? data.intent : 'unknown',
    };
  } catch {
    return empty;
  }
}
