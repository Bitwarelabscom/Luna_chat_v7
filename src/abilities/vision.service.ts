import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { activityHelpers } from '../activity/activity.service.js';

// Vision-capable models by provider
const VISION_MODELS = {
  ollama: 'qwen3-vl:8b',
  xai: 'grok-4.1-fast',
};

let xaiClient: OpenAI | null = null;

function getXaiClient(): OpenAI | null {
  if (!config.xai?.apiKey) return null;
  if (!xaiClient) {
    xaiClient = new OpenAI({
      apiKey: config.xai.apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
  }
  return xaiClient;
}

export interface VisionAnalysisResult {
  description: string;
  provider: 'openai' | 'openrouter' | 'ollama' | 'xai';
  model: string;
}

interface VisionProviderResult {
  description: string;
  promptTokens: number;
  completionTokens: number;
}

interface VisionLoggingContext {
  userId: string;
  sessionId?: string;
  turnId?: string;
  nodeName?: string;
}

function logVisionActivity(
  loggingContext: VisionLoggingContext | undefined,
  provider: 'ollama' | 'xai',
  model: string,
  durationMs: number,
  prompt: string,
  mimeType: string,
  result?: VisionProviderResult,
  errorMessage?: string
): void {
  if (!loggingContext) return;

  const baseNode = loggingContext.nodeName || 'vision_analysis';
  const nodeName = `${baseNode}_${provider}`;

  activityHelpers.logLLMCall(
    loggingContext.userId,
    loggingContext.sessionId,
    loggingContext.turnId,
    nodeName,
    model,
    provider,
    {
      input: result?.promptTokens || 0,
      output: result?.completionTokens || 0,
    },
    durationMs,
    undefined,
    undefined,
    {
      messages: [
        {
          role: 'user',
          content: `Vision analysis request (${mimeType})\n${prompt}`,
        },
      ],
      maxTokens: 2000,
      response: {
        content: (result?.description || errorMessage || '').slice(0, 4000),
        finishReason: errorMessage ? 'error' : 'stop',
      },
    }
  ).catch(() => {});
}

/**
 * Analyze an image using Ollama (qwen3-vl:8b) with Grok (xAI) as fallback
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  options: {
    prompt?: string;
    loggingContext?: VisionLoggingContext;
  } = {}
): Promise<VisionAnalysisResult> {
  const {
    prompt = 'Analyze this image in detail. Describe what you see, including any text, objects, people, colors, composition, and context. Be thorough and specific.',
    loggingContext,
  } = options;

  // Convert buffer to base64
  const base64Image = imageBuffer.toString('base64');

  // Try Ollama first (local vision model)
  const ollamaUrl = config.ollamaTertiary?.url || 'http://10.0.0.30:11434';
  const ollamaStart = Date.now();
  try {
    const result = await analyzeWithOllama(ollamaUrl, base64Image, prompt);
    logVisionActivity(
      loggingContext,
      'ollama',
      VISION_MODELS.ollama,
      Date.now() - ollamaStart,
      prompt,
      mimeType,
      result
    );
    logger.info('Image analyzed with Ollama', { model: VISION_MODELS.ollama, url: ollamaUrl });
    return {
      description: result.description,
      provider: 'ollama',
      model: VISION_MODELS.ollama,
    };
  } catch (ollamaError) {
    logVisionActivity(
      loggingContext,
      'ollama',
      VISION_MODELS.ollama,
      Date.now() - ollamaStart,
      prompt,
      mimeType,
      undefined,
      (ollamaError as Error).message
    );
    logger.warn('Ollama vision failed, falling back to xAI Grok', {
      error: (ollamaError as Error).message,
    });
  }

  // Fallback to xAI Grok
  const xai = getXaiClient();
  if (xai) {
    const xaiStart = Date.now();
    try {
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      const result = await analyzeWithClient(xai, VISION_MODELS.xai, dataUrl, prompt);
      logVisionActivity(
        loggingContext,
        'xai',
        VISION_MODELS.xai,
        Date.now() - xaiStart,
        prompt,
        mimeType,
        result
      );
      logger.info('Image analyzed with xAI', { model: VISION_MODELS.xai });
      return {
        description: result.description,
        provider: 'xai',
        model: VISION_MODELS.xai,
      };
    } catch (xaiError) {
      logVisionActivity(
        loggingContext,
        'xai',
        VISION_MODELS.xai,
        Date.now() - xaiStart,
        prompt,
        mimeType,
        undefined,
        (xaiError as Error).message
      );
      logger.error('xAI vision failed', { error: (xaiError as Error).message });
      throw xaiError;
    }
  }

  throw new Error('No vision-capable provider available. Ollama failed and xAI API key not configured.');
}

/**
 * Analyze image using Ollama API format (images as raw base64 in messages)
 */
async function analyzeWithOllama(
  baseUrl: string,
  base64Image: string,
  prompt: string
): Promise<VisionProviderResult> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODELS.ollama,
      stream: false,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [base64Image],
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama vision request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as {
    message?: { content?: string };
    error?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  if (data.error) {
    throw new Error(`Ollama error: ${data.error}`);
  }

  const content = data.message?.content;
  if (!content) {
    throw new Error('No description generated from Ollama vision model');
  }

  return {
    description: content,
    promptTokens: data.prompt_eval_count ?? data.prompt_tokens ?? data.usage?.prompt_tokens ?? 0,
    completionTokens: data.eval_count ?? data.completion_tokens ?? data.usage?.completion_tokens ?? 0,
  };
}

async function analyzeWithClient(
  client: OpenAI,
  model: string,
  imageDataUrl: string,
  prompt: string
): Promise<VisionProviderResult> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No description generated from vision model');
  }

  return {
    description: content,
    promptTokens: response.usage?.prompt_tokens || 0,
    completionTokens: response.usage?.completion_tokens || 0,
  };
}

/**
 * Check if a MIME type is an image
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Get supported image MIME types
 */
export function getSupportedImageTypes(): string[] {
  return [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
  ];
}

export default {
  analyzeImage,
  isImageMimeType,
  getSupportedImageTypes,
};
