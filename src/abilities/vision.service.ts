import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { activityHelpers } from '../activity/activity.service.js';

// Vision-capable models by provider
const VISION_MODELS = {
  openrouter: 'nvidia/nemotron-nano-12b-v2-vl:free',
  xai: 'grok-4.1-fast',
};

let openrouterClient: OpenAI | null = null;
let xaiClient: OpenAI | null = null;

function getOpenRouterClient(): OpenAI | null {
  if (!config.openrouter?.apiKey) return null;
  if (!openrouterClient) {
    openrouterClient = new OpenAI({
      apiKey: config.openrouter.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://luna-chat.bitwarelabs.com',
        'X-Title': 'Luna Chat',
      },
    });
  }
  return openrouterClient;
}

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
  provider: 'openrouter' | 'xai',
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
  ).catch(e => logger.debug('Activity log failed', { err: (e as Error).message }));
}

/**
 * Analyze an image using OpenRouter Nemotron VL with xAI Grok as fallback
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

  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Try OpenRouter Nemotron VL first (free)
  const orClient = getOpenRouterClient();
  if (orClient) {
    const orStart = Date.now();
    try {
      const result = await analyzeWithClient(orClient, VISION_MODELS.openrouter, dataUrl, prompt);
      logVisionActivity(
        loggingContext,
        'openrouter',
        VISION_MODELS.openrouter,
        Date.now() - orStart,
        prompt,
        mimeType,
        result
      );
      logger.info('Image analyzed with OpenRouter', { model: VISION_MODELS.openrouter });
      return {
        description: result.description,
        provider: 'openrouter',
        model: VISION_MODELS.openrouter,
      };
    } catch (orError) {
      logVisionActivity(
        loggingContext,
        'openrouter',
        VISION_MODELS.openrouter,
        Date.now() - orStart,
        prompt,
        mimeType,
        undefined,
        (orError as Error).message
      );
      logger.warn('OpenRouter vision failed, falling back to xAI Grok', {
        error: (orError as Error).message,
      });
    }
  }

  // Fallback to xAI Grok
  const xai = getXaiClient();
  if (xai) {
    const xaiStart = Date.now();
    try {
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

  throw new Error('No vision-capable provider available. OpenRouter failed and xAI API key not configured.');
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
