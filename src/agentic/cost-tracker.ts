/**
 * Simple token-to-USD cost estimation for known providers/models.
 * Prices are per 1M tokens (input/output).
 */

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// Pricing table - approximate as of early 2026
const PRICING: Record<string, ModelPricing> = {
  // xAI Grok
  'grok-3': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'grok-3-fast': { inputPer1M: 5.00, outputPer1M: 25.00 },
  'grok-3-mini': { inputPer1M: 0.30, outputPer1M: 0.50 },
  'grok-3-mini-fast': { inputPer1M: 0.10, outputPer1M: 0.25 },
  'grok-4-fast': { inputPer1M: 3.00, outputPer1M: 9.00 },
  // Anthropic Claude
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },
  'claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00 },
  // Google Gemini
  'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.5-flash-preview-05-20': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gemini-2.5-pro-preview-05-06': { inputPer1M: 1.25, outputPer1M: 10.00 },
  // Groq (near-zero)
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
  'llama-3.1-8b-instant': { inputPer1M: 0.05, outputPer1M: 0.08 },
  // Moonshot
  'moonshot-v1-auto': { inputPer1M: 0.55, outputPer1M: 0.55 },
};

// Provider-level defaults for unknown models
const PROVIDER_DEFAULTS: Record<string, ModelPricing> = {
  ollama: { inputPer1M: 0, outputPer1M: 0 },
  ollama_secondary: { inputPer1M: 0, outputPer1M: 0 },
  ollama_tertiary: { inputPer1M: 0, outputPer1M: 0 },
  groq: { inputPer1M: 0.50, outputPer1M: 0.70 },
  xai: { inputPer1M: 3.00, outputPer1M: 15.00 },
  anthropic: { inputPer1M: 3.00, outputPer1M: 15.00 },
  google: { inputPer1M: 0.15, outputPer1M: 0.60 },
  openrouter: { inputPer1M: 2.00, outputPer1M: 8.00 },
  moonshot: { inputPer1M: 0.55, outputPer1M: 0.55 },
};

/**
 * Estimate the cost in USD for a given number of input/output tokens.
 */
export function estimateCost(
  provider: string | undefined,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  // Try exact model match first
  const pricing = (model && PRICING[model])
    || (provider && PROVIDER_DEFAULTS[provider])
    || { inputPer1M: 1.00, outputPer1M: 3.00 }; // conservative fallback

  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}
