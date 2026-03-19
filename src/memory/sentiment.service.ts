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

// Emoji and emoticon VAD lookup map
const EMOJI_VAD_MAP: Record<string, MessageSentiment> = {
  // Text emoticons - happy/positive
  ':)':  { valence: 0.7, arousal: 0.4, dominance: 0.5 },
  '=)':  { valence: 0.7, arousal: 0.4, dominance: 0.5 },
  ':-)': { valence: 0.7, arousal: 0.4, dominance: 0.5 },
  ':D':  { valence: 0.9, arousal: 0.7, dominance: 0.6 },
  ':-D': { valence: 0.9, arousal: 0.7, dominance: 0.6 },
  'XD':  { valence: 0.8, arousal: 0.8, dominance: 0.5 },
  'xD':  { valence: 0.8, arousal: 0.8, dominance: 0.5 },
  ':P':  { valence: 0.6, arousal: 0.5, dominance: 0.5 },
  ':p':  { valence: 0.6, arousal: 0.5, dominance: 0.5 },
  ':-P': { valence: 0.6, arousal: 0.5, dominance: 0.5 },
  ';)':  { valence: 0.6, arousal: 0.5, dominance: 0.6 },
  ';-)': { valence: 0.6, arousal: 0.5, dominance: 0.6 },
  '<3':  { valence: 0.9, arousal: 0.6, dominance: 0.4 },
  '^^':  { valence: 0.7, arousal: 0.4, dominance: 0.4 },
  '^_^': { valence: 0.7, arousal: 0.4, dominance: 0.4 },
  'c:':  { valence: 0.7, arousal: 0.4, dominance: 0.5 },
  ':3':  { valence: 0.6, arousal: 0.4, dominance: 0.3 },
  // Text emoticons - negative
  ':(': { valence: -0.6, arousal: 0.4, dominance: 0.3 },
  '=(': { valence: -0.6, arousal: 0.4, dominance: 0.3 },
  ':-(': { valence: -0.6, arousal: 0.4, dominance: 0.3 },
  ":'(": { valence: -0.8, arousal: 0.6, dominance: 0.2 },
  '>:(': { valence: -0.7, arousal: 0.7, dominance: 0.7 },
  'D:':  { valence: -0.7, arousal: 0.7, dominance: 0.3 },
  // Text emoticons - ambiguous (require whitespace before to avoid URL false positives)
  ':/':  { valence: -0.3, arousal: 0.3, dominance: 0.4 },
  '=/':  { valence: -0.3, arousal: 0.3, dominance: 0.4 },
  ':-/': { valence: -0.3, arousal: 0.3, dominance: 0.4 },
  // Unicode emoji - happy
  '\u{1F600}': { valence: 0.8, arousal: 0.6, dominance: 0.5 },
  '\u{1F603}': { valence: 0.8, arousal: 0.6, dominance: 0.5 },
  '\u{1F604}': { valence: 0.9, arousal: 0.7, dominance: 0.5 },
  '\u{1F601}': { valence: 0.8, arousal: 0.6, dominance: 0.5 },
  '\u{1F606}': { valence: 0.9, arousal: 0.8, dominance: 0.5 },
  '\u{1F602}': { valence: 0.8, arousal: 0.8, dominance: 0.5 },
  '\u{1F60A}': { valence: 0.8, arousal: 0.4, dominance: 0.4 },
  '\u{1F642}': { valence: 0.5, arousal: 0.3, dominance: 0.5 },
  // Unicode emoji - love
  '\u{2764}\u{FE0F}': { valence: 0.9, arousal: 0.6, dominance: 0.4 },
  '\u{1F60D}': { valence: 0.9, arousal: 0.7, dominance: 0.4 },
  '\u{1F618}': { valence: 0.8, arousal: 0.5, dominance: 0.4 },
  '\u{1F970}': { valence: 0.9, arousal: 0.6, dominance: 0.3 },
  // Unicode emoji - sad
  '\u{1F622}': { valence: -0.7, arousal: 0.5, dominance: 0.2 },
  '\u{1F62D}': { valence: -0.8, arousal: 0.7, dominance: 0.2 },
  '\u{1F625}': { valence: -0.6, arousal: 0.5, dominance: 0.3 },
  '\u{1F641}': { valence: -0.5, arousal: 0.3, dominance: 0.4 },
  // Unicode emoji - angry
  '\u{1F620}': { valence: -0.8, arousal: 0.8, dominance: 0.7 },
  '\u{1F621}': { valence: -0.9, arousal: 0.9, dominance: 0.8 },
  '\u{1F624}': { valence: -0.6, arousal: 0.7, dominance: 0.7 },
  // Unicode emoji - playful
  '\u{1F61C}': { valence: 0.6, arousal: 0.6, dominance: 0.5 },
  '\u{1F61D}': { valence: 0.6, arousal: 0.6, dominance: 0.5 },
  '\u{1F609}': { valence: 0.6, arousal: 0.5, dominance: 0.6 },
  '\u{1F60F}': { valence: 0.4, arousal: 0.4, dominance: 0.7 },
  // Unicode emoji - fire/party
  '\u{1F525}': { valence: 0.7, arousal: 0.8, dominance: 0.7 },
  '\u{1F389}': { valence: 0.8, arousal: 0.8, dominance: 0.5 },
  '\u{1F38A}': { valence: 0.8, arousal: 0.7, dominance: 0.5 },
  '\u{1F680}': { valence: 0.7, arousal: 0.8, dominance: 0.7 },
  // Unicode emoji - thumbs
  '\u{1F44D}': { valence: 0.6, arousal: 0.3, dominance: 0.6 },
  '\u{1F44E}': { valence: -0.5, arousal: 0.4, dominance: 0.6 },
  '\u{1F44F}': { valence: 0.7, arousal: 0.6, dominance: 0.5 },
  // Unicode emoji - fear/surprise
  '\u{1F628}': { valence: -0.5, arousal: 0.8, dominance: 0.2 },
  '\u{1F631}': { valence: -0.6, arousal: 0.9, dominance: 0.2 },
  '\u{1F633}': { valence: -0.2, arousal: 0.7, dominance: 0.3 },
  // Unicode emoji - neutral/misc
  '\u{1F914}': { valence: 0.0, arousal: 0.4, dominance: 0.5 },
  '\u{1F644}': { valence: -0.3, arousal: 0.4, dominance: 0.6 },
  '\u{1F612}': { valence: -0.4, arousal: 0.3, dominance: 0.5 },
};

// Ambiguous emoticons that could be URL fragments - require whitespace before them
const AMBIGUOUS_EMOTICONS = new Set([':/', '=/', ':-/']);

// Sorted longest-first for greedy matching
const TEXT_EMOTICONS = Object.keys(EMOJI_VAD_MAP)
  .filter(k => !/[\u{1F000}-\u{1FFFF}\u{2000}-\u{2FFF}]/u.test(k))
  .sort((a, b) => b.length - a.length);

/**
 * Extract emoji/emoticon sentiment signal from text.
 * Returns averaged VAD if any emoji/emoticons found, null otherwise.
 */
function extractEmojiSignal(text: string): MessageSentiment | null {
  const detected: MessageSentiment[] = [];

  // Scan for text emoticons (longest-first)
  let remaining = text;
  for (const emoticon of TEXT_EMOTICONS) {
    let idx = remaining.indexOf(emoticon);
    while (idx !== -1) {
      // Ambiguous emoticons need preceding whitespace or start-of-string
      if (AMBIGUOUS_EMOTICONS.has(emoticon)) {
        if (idx > 0 && remaining[idx - 1] !== ' ' && remaining[idx - 1] !== '\n' && remaining[idx - 1] !== '\t') {
          idx = remaining.indexOf(emoticon, idx + 1);
          continue;
        }
      }
      detected.push(EMOJI_VAD_MAP[emoticon]);
      // Replace matched emoticon to avoid double-matching substrings
      remaining = remaining.slice(0, idx) + ' '.repeat(emoticon.length) + remaining.slice(idx + emoticon.length);
      idx = remaining.indexOf(emoticon, idx + emoticon.length);
    }
  }

  // Scan for unicode emoji
  const emojiRegex = /\p{Emoji_Presentation}/gu;
  let match;
  while ((match = emojiRegex.exec(text)) !== null) {
    const emoji = match[0];
    if (EMOJI_VAD_MAP[emoji]) {
      detected.push(EMOJI_VAD_MAP[emoji]);
    }
  }

  if (detected.length === 0) return null;

  // Average all detected VAD values
  const avg: MessageSentiment = {
    valence: detected.reduce((s, d) => s + d.valence, 0) / detected.length,
    arousal: detected.reduce((s, d) => s + d.arousal, 0) / detected.length,
    dominance: detected.reduce((s, d) => s + d.dominance, 0) / detected.length,
  };

  return avg;
}

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

  // Extract emoji/emoticon signal before LLM call
  const emojiSignal = extractEmojiSignal(text);

  try {
    const result = await createCompletion(
      'groq',
      'llama-3.1-8b-instant',
      [
        {
          role: 'system',
          content: 'You are a sentiment analyzer. Given a message, output ONLY a JSON object with three float values: valence (-1.0 to 1.0, negative to positive), arousal (0.0 to 1.0, calm to excited), dominance (0.0 to 1.0, submissive to dominant). Pay special attention to emoji and emoticons as strong sentiment indicators. No other text.',
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
    const llmSentiment: MessageSentiment = {
      valence: Math.max(-1, Math.min(1, parseFloat(parsed.valence) || 0)),
      arousal: Math.max(0, Math.min(1, parseFloat(parsed.arousal) || 0.3)),
      dominance: Math.max(0, Math.min(1, parseFloat(parsed.dominance) || 0.5)),
    };

    // Emoji signal overrides LLM when present
    const sentiment = emojiSignal ?? llmSentiment;
    if (emojiSignal) {
      logger.debug('Emoji signal overriding LLM sentiment', { emojiSignal, llmSentiment });
    }

    // Cache result
    sentimentCache.set(cacheKey, { sentiment, timestamp: now });
    if (sentimentCache.size > CACHE_MAX_SIZE / 2) {
      cleanCache();
    }

    return sentiment;
  } catch (error) {
    logger.debug('Sentiment analysis failed, using emoji fallback or default', { error: (error as Error).message });
    return emojiSignal ?? DEFAULT_SENTIMENT;
  }
}

export default { analyze };
