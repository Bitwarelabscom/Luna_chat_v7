/**
 * Attention Score Service
 *
 * Computes a composite attention score for each message based on:
 * - Message length (longer = more engaged)
 * - Response latency (faster = higher attention)
 * - Semantic continuity (cosine sim with previous message)
 */

export interface AttentionResult {
  score: number;          // 0.0 to 1.0
  lengthFactor: number;
  latencyFactor: number;
  continuityFactor: number;
}

// Typical message length for normalization (words)
const TYPICAL_LENGTH = 25;
// Typical latency for normalization (ms)
const TYPICAL_LATENCY_MS = 5000;

/**
 * Sigmoid-like normalization to [0, 1]
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute attention score for a message.
 *
 * @param message - The message text
 * @param currentEmbedding - Pre-computed embedding for this message
 * @param prevEmbedding - Embedding of the previous message (if any)
 * @param latencyMs - Time since last message in ms (0 if unknown)
 */
export function compute(
  message: string,
  currentEmbedding: number[],
  prevEmbedding: number[] | null,
  latencyMs: number
): AttentionResult {
  // Length factor: sigmoid of normalized word count
  const wordCount = message.split(/\s+/).length;
  const lengthFactor = sigmoid((wordCount - TYPICAL_LENGTH) / TYPICAL_LENGTH);

  // Latency factor: fast responses indicate high attention
  let latencyFactor = 0.5;
  if (latencyMs > 0) {
    // Inverse normalized: short latency = high factor
    latencyFactor = Math.max(0, Math.min(1, 1 - (latencyMs / (TYPICAL_LATENCY_MS * 3))));
  }

  // Continuity factor: cosine similarity with previous message
  let continuityFactor = 0.5;
  if (prevEmbedding && currentEmbedding.length === prevEmbedding.length) {
    continuityFactor = cosineSimilarity(currentEmbedding, prevEmbedding);
    continuityFactor = Math.max(0, Math.min(1, continuityFactor));
  }

  // Weighted composite
  const score = 0.3 * lengthFactor + 0.2 * latencyFactor + 0.5 * continuityFactor;

  return {
    score: Math.max(0, Math.min(1, score)),
    lengthFactor,
    latencyFactor,
    continuityFactor,
  };
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export default { compute };
