/**
 * Per-message Sentiment Analysis Service
 *
 * Uses Groq (llama-3.1-8b-instant) for fast VAD sentiment extraction.
 * Results are cached by content hash to prevent duplicate calls.
 */

import { createCompletion } from '../llm/router.js';
import logger from '../utils/logger.js';

export interface MessageSentiment {
  valence: number;    // -1.0 to 1.0 (negative to positive)
  arousal: number;    // 0.0 to 1.0 (calm to excited)
  dominance: number;  // 0.0 to 1.0 (submissive to dominant)
}

// Cache with TTL
interface SentimentCacheEntry {
  sentiment: MessageSentiment;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 200;
const sentimentCache = new Map<string, SentimentCacheEntry>();

const DEFAULT_SENTIMENT: MessageSentiment = { valence: 0.0, arousal: 0.3, dominance: 0.5 };

function getCacheKey(text: string): string {
  return text.slice(0, 500);
}

function cleanCache(): void {
  const now = Date.now();
  for (const [key, entry] of sentimentCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      sentimentCache.delete(key);
    }
  }
  if (sentimentCache.size > CACHE_MAX_SIZE) {
    const entries = Array.from(sentimentCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, sentimentCache.size - CACHE_MAX_SIZE);
    for (const [key] of toRemove) {
      sentimentCache.delete(key);
    }
  }
}

/**
 * Analyze message sentiment using Groq for fast inference.
 * Returns VAD (Valence, Arousal, Dominance) scores.
 */
export async function analyze(text: string, userId?: string): Promise<MessageSentiment> {
  if (!text || text.length < 3) return DEFAULT_SENTIMENT;

  const cacheKey = getCacheKey(text);
  const now = Date.now();

  // Check cache
  const cached = sentimentCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.sentiment;
  }

  try {
    const result = await createCompletion(
      'groq',
      'llama-3.1-8b-instant',
      [
        {
          role: 'system',
          content: 'You are a sentiment analyzer. Given a message, output ONLY a JSON object with three float values: valence (-1.0 to 1.0, negative to positive), arousal (0.0 to 1.0, calm to excited), dominance (0.0 to 1.0, submissive to dominant). No other text.',
        },
        {
          role: 'user',
          content: text.slice(0, 500),
        },
      ],
      {
        temperature: 0.1,
        maxTokens: 60,
        ...(userId ? {
          loggingContext: {
            userId,
            source: 'sentiment',
            nodeName: 'sentiment',
          },
        } : {}),
      }
    );

    const parsed = JSON.parse(result.content.trim());
    const sentiment: MessageSentiment = {
      valence: Math.max(-1, Math.min(1, parseFloat(parsed.valence) || 0)),
      arousal: Math.max(0, Math.min(1, parseFloat(parsed.arousal) || 0.3)),
      dominance: Math.max(0, Math.min(1, parseFloat(parsed.dominance) || 0.5)),
    };

    // Cache result
    sentimentCache.set(cacheKey, { sentiment, timestamp: now });
    if (sentimentCache.size > CACHE_MAX_SIZE / 2) {
      cleanCache();
    }

    return sentiment;
  } catch (error) {
    logger.debug('Sentiment analysis failed, using default', { error: (error as Error).message });
    return DEFAULT_SENTIMENT;
  }
}

export default { analyze };
