import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

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

/**
 * Analyze an image using Ollama (qwen3-vl:8b) with Grok (xAI) as fallback
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  options: {
    prompt?: string;
  } = {}
): Promise<VisionAnalysisResult> {
  const {
    prompt = 'Analyze this image in detail. Describe what you see, including any text, objects, people, colors, composition, and context. Be thorough and specific.',
  } = options;

  // Convert buffer to base64
  const base64Image = imageBuffer.toString('base64');

  // Try Ollama first (local vision model)
  const ollamaUrl = config.ollamaTertiary?.url || 'http://10.0.0.30:11434';
  try {
    const result = await analyzeWithOllama(ollamaUrl, base64Image, prompt);
    logger.info('Image analyzed with Ollama', { model: VISION_MODELS.ollama, url: ollamaUrl });
    return {
      description: result,
      provider: 'ollama',
      model: VISION_MODELS.ollama,
    };
  } catch (ollamaError) {
    logger.warn('Ollama vision failed, falling back to xAI Grok', {
      error: (ollamaError as Error).message,
    });
  }

  // Fallback to xAI Grok
  const xai = getXaiClient();
  if (xai) {
    try {
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      const result = await analyzeWithClient(xai, VISION_MODELS.xai, dataUrl, prompt);
      logger.info('Image analyzed with xAI', { model: VISION_MODELS.xai });
      return {
        description: result,
        provider: 'xai',
        model: VISION_MODELS.xai,
      };
    } catch (xaiError) {
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
): Promise<string> {
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

  const data = await response.json() as { message?: { content?: string }; error?: string };

  if (data.error) {
    throw new Error(`Ollama error: ${data.error}`);
  }

  const content = data.message?.content;
  if (!content) {
    throw new Error('No description generated from Ollama vision model');
  }

  return content;
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
