import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as xaiProvider from '../llm/providers/xai.provider.js';

// Paths
const IMAGES_DIR = path.join(process.cwd(), 'images');
const GENERATED_DIR = path.join(IMAGES_DIR, 'generated');

// Ensure generated directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

export interface ImageResult {
  success: boolean;
  imageUrl?: string;
  filename?: string;
  filePath?: string;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Detect image type from buffer magic bytes
 */
function detectImageType(buffer: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' {
  // Check magic bytes
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'gif';
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // RIFF header - check for WEBP
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'webp';
    }
  }
  // Default to png if unknown
  return 'png';
}

/**
 * Get file extension for image type
 */
function getExtensionForType(type: 'png' | 'jpeg' | 'gif' | 'webp'): string {
  return type === 'jpeg' ? 'jpg' : type;
}

/**
 * Generate a unique filename for an image
 */
function generateFilename(userId: string, prefix: string = 'img', extension: string = 'png'): string {
  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${userId.substring(0, 8)}_${timestamp}_${hash}.${extension}`;
}

/**
 * Generate an image using the configured provider (OpenAI or xAI)
 */
export async function generateImage(
  userId: string,
  prompt: string
): Promise<ImageResult> {
  const startTime = Date.now();

  try {
    const modelConfig = await getUserModelConfig(userId, 'image_generation');
    logger.info('Generating image', { userId, promptLength: prompt.length, provider: modelConfig.provider, model: modelConfig.model });

    let imageBuffer: Buffer;

    if (modelConfig.provider === 'xai') {
      const result = await xaiProvider.generateImage(prompt, { model: modelConfig.model });
      if (result.url) {
        const imageResponse = await fetch(result.url);
        if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`);
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else if (result.b64_json) {
        imageBuffer = Buffer.from(result.b64_json, 'base64');
      } else {
        throw new Error('No image data returned from xAI');
      }
    } else {
      // Default to OpenAI
      const openai = new OpenAI({ apiKey: config.openai.apiKey });
      const response = await openai.images.generate({
        model: modelConfig.model || 'gpt-image-1-mini', // Fallback if config is somehow empty
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'low',
      });

      if (!response.data || !response.data[0]) throw new Error('No image data returned from OpenAI');
      const imageData = response.data[0];

      if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`);
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, 'base64');
      } else {
        throw new Error('No image URL or base64 data in response');
      }
    }

    // Detect actual image type from content and use correct extension
    const imageType = detectImageType(imageBuffer);
    const extension = getExtensionForType(imageType);

    const filename = generateFilename(userId, 'gen', extension);
    const outputPath = path.join(GENERATED_DIR, filename);
    fs.writeFileSync(outputPath, imageBuffer);

    const imageUrl = `/api/images/generated/${filename}`;
    logger.info('Image generated successfully', { userId, filename, imageUrl });

    return {
      success: true,
      imageUrl,
      filename,
      filePath: outputPath,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Image generation failed', { userId, error: errorMessage });

    return {
      success: false,
      error: errorMessage,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Save a base64-encoded screenshot to disk
 */
export async function saveScreenshot(
  userId: string,
  base64Data: string,
  source: string
): Promise<ImageResult> {
  const startTime = Date.now();

  try {
    // Remove data URL prefix if present
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');

    const imageBuffer = Buffer.from(base64Clean, 'base64');

    // Detect actual image type from content and use correct extension
    const imageType = detectImageType(imageBuffer);
    const extension = getExtensionForType(imageType);

    const filename = generateFilename(userId, 'screenshot', extension);
    const outputPath = path.join(GENERATED_DIR, filename);

    fs.writeFileSync(outputPath, imageBuffer);

    const imageUrl = `/api/images/generated/${filename}`;
    logger.info('Screenshot saved', { userId, filename, source, sizeKB: Math.round(imageBuffer.length / 1024) });

    return {
      success: true,
      imageUrl,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Failed to save screenshot', { userId, source, error: errorMessage });

    return {
      success: false,
      error: errorMessage,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Format image result for chat display
 * Returns the special image block format that frontend will parse
 */
export function formatImageForChat(imageUrl: string, caption: string): string {
  return `:::image[${imageUrl}]\n${caption}\n:::`;
}

/**
 * Get the full filesystem path for a generated image
 */
export function getImagePath(filename: string): string | null {
  // Security: prevent path traversal
  const sanitizedFilename = path.basename(filename);
  const imagePath = path.join(GENERATED_DIR, sanitizedFilename);

  if (fs.existsSync(imagePath)) {
    return imagePath;
  }
  return null;
}

/**
 * Clean up old generated images (older than specified days)
 */
export async function cleanupOldImages(maxAgeDays: number = 7): Promise<number> {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deletedCount = 0;

  try {
    const files = fs.readdirSync(GENERATED_DIR);

    for (const file of files) {
      const filePath = path.join(GENERATED_DIR, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info('Cleaned up old generated images', { deletedCount, maxAgeDays });
    }
  } catch (error) {
    logger.error('Failed to cleanup old images', { error: (error as Error).message });
  }

  return deletedCount;
}

/**
 * Generate an image for a project and save to project directory
 */
export async function generateProjectImage(
  userId: string,
  projectDir: string,
  prompt: string,
  filename?: string
): Promise<ImageResult & { filePath?: string; relativePath?: string }> {
  const startTime = Date.now();

  try {
    const modelConfig = await getUserModelConfig(userId, 'image_generation');
    logger.info('Generating project image', { userId, projectDir, promptLength: prompt.length, provider: modelConfig.provider, model: modelConfig.model });

    let imageBuffer: Buffer;

    if (modelConfig.provider === 'xai') {
      const result = await xaiProvider.generateImage(prompt, { model: modelConfig.model });
      if (result.url) {
        const imageResponse = await fetch(result.url);
        if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`);
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else if (result.b64_json) {
        imageBuffer = Buffer.from(result.b64_json, 'base64');
      } else {
        throw new Error('No image data returned from xAI');
      }
    } else {
      const openai = new OpenAI({ apiKey: config.openai.apiKey });
      const response = await openai.images.generate({
        model: modelConfig.model || 'gpt-image-1-mini',
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'low',
      });

      if (!response.data || !response.data[0]) throw new Error('No image data returned from OpenAI');
      const imageData = response.data[0];

      if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`);
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, 'base64');
      } else {
        throw new Error('No image URL or base64 data in response');
      }
    }

    // Detect actual image type from content
    const imageType = detectImageType(imageBuffer);
    const extension = getExtensionForType(imageType);

    // Use provided filename or generate one
    const finalFilename = filename || generateFilename(userId, 'img', extension);
    const filenameWithExt = finalFilename.includes('.') ? finalFilename : `${finalFilename}.${extension}`;

    // Save to project's images directory
    const imagesDir = path.join(projectDir, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const outputPath = path.join(imagesDir, filenameWithExt);
    fs.writeFileSync(outputPath, imageBuffer);

    // Relative path for use in HTML
    const relativePath = `images/${filenameWithExt}`;

    logger.info('Project image generated', { userId, filename: filenameWithExt, projectDir });

    return {
      success: true,
      imageUrl: `/api/images/generated/${filenameWithExt}`,
      filePath: outputPath,
      relativePath,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Project image generation failed', { userId, error: errorMessage });

    return {
      success: false,
      error: errorMessage,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

export default {
  generateImage,
  generateProjectImage,
  saveScreenshot,
  formatImageForChat,
  getImagePath,
  cleanupOldImages,
};
