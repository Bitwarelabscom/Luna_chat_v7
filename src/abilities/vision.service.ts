import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Vision-capable models by provider
const VISION_MODELS = {
  openai: 'gpt-4o',
  openrouter: 'google/gemini-2.0-flash-exp:free', // Free vision model
};

let openaiClient: OpenAI | null = null;
let openrouterClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!config.openai.apiKey) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

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

export interface VisionAnalysisResult {
  description: string;
  provider: 'openai' | 'openrouter';
  model: string;
}

/**
 * Analyze an image and return a detailed text description
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  options: {
    prompt?: string;
    preferFree?: boolean;
  } = {}
): Promise<VisionAnalysisResult> {
  const {
    prompt = 'Analyze this image in detail. Describe what you see, including any text, objects, people, colors, composition, and context. Be thorough and specific.',
    preferFree = true
  } = options;

  // Convert buffer to base64 data URL
  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Try OpenRouter first if preferFree is true (free vision models)
  if (preferFree) {
    const openrouterClient = getOpenRouterClient();
    if (openrouterClient) {
      try {
        const result = await analyzeWithClient(
          openrouterClient,
          VISION_MODELS.openrouter,
          dataUrl,
          prompt
        );
        logger.info('Image analyzed with OpenRouter', { model: VISION_MODELS.openrouter });
        return {
          description: result,
          provider: 'openrouter',
          model: VISION_MODELS.openrouter,
        };
      } catch (error) {
        logger.warn('OpenRouter vision failed, falling back to OpenAI', {
          error: (error as Error).message
        });
      }
    }
  }

  // Fallback to OpenAI
  const openai = getOpenAIClient();
  if (openai) {
    try {
      const result = await analyzeWithClient(
        openai,
        VISION_MODELS.openai,
        dataUrl,
        prompt
      );
      logger.info('Image analyzed with OpenAI', { model: VISION_MODELS.openai });
      return {
        description: result,
        provider: 'openai',
        model: VISION_MODELS.openai,
      };
    } catch (error) {
      logger.error('OpenAI vision failed', { error: (error as Error).message });
      throw error;
    }
  }

  throw new Error('No vision-capable provider available. Please configure OpenAI or OpenRouter API key.');
}

async function analyzeWithClient(
  client: OpenAI,
  model: string,
  imageDataUrl: string,
  prompt: string
): Promise<string> {
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

  return content;
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
