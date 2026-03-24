import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { generateImage as comfyuiGenerate } from '../integration/comfyui.client.js';
import * as sessionService from '../chat/session.service.js';
import { broadcastToUser } from '../triggers/delivery.service.js';
import * as telegramService from '../triggers/telegram.service.js';

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
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'webp';
    }
  }
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
 * Generate an image using local ComfyUI (Flux 2 Klein 4B GGUF)
 */
export async function generateImage(
  userId: string,
  prompt: string,
  options?: { width?: number; height?: number }
): Promise<ImageResult> {
  const startTime = Date.now();

  try {
    logger.info('Generating image via ComfyUI', { userId, promptLength: prompt.length });

    const result = await comfyuiGenerate({
      prompt,
      width: options?.width ?? 1024,
      height: options?.height ?? 1024,
    });

    const imageType = detectImageType(result.buffer);
    const extension = getExtensionForType(imageType);
    const filename = generateFilename(userId, 'gen', extension);
    const outputPath = path.join(GENERATED_DIR, filename);
    fs.writeFileSync(outputPath, result.buffer);

    const imageUrl = `/api/images/generated/${filename}`;
    logger.info('Image generated successfully', { userId, filename, imageUrl, durationMs: Date.now() - startTime });

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
 * Fire-and-forget image generation.
 * Generates the image, persists it as an assistant message, broadcasts via SSE,
 * and forwards to Telegram if connected.
 */
export async function generateImageAsync(
  userId: string,
  sessionId: string,
  prompt: string,
  options?: { width?: number; height?: number }
): Promise<void> {
  try {
    const result = await generateImage(userId, prompt, options);

    if (!result.success || !result.imageUrl) {
      const errorContent = `Image generation failed: ${result.error || 'Unknown error'}`;
      await sessionService.addMessage({ sessionId, role: 'assistant', content: errorContent, source: 'web' }).catch(err =>
        logger.warn('Failed to persist image error message', { sessionId, error: (err as Error).message })
      );
      broadcastToUser(userId, {
        type: 'new_message',
        sessionId,
        message: errorContent,
        timestamp: new Date(),
      });
      return;
    }

    const caption = `Generated image: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`;
    const content = formatImageForChat(result.imageUrl, caption);

    // Persist as assistant message
    await sessionService.addMessage({ sessionId, role: 'assistant', content, source: 'web' });

    // Broadcast to frontend
    broadcastToUser(userId, {
      type: 'new_message',
      sessionId,
      message: content,
      timestamp: new Date(),
    });

    // Forward to Telegram if connected
    if (result.filePath) {
      const connection = await telegramService.getTelegramConnection(userId);
      if (connection && connection.isActive) {
        telegramService.sendTelegramPhoto(connection.chatId, result.filePath, caption).catch(err =>
          logger.error('Failed to send generated image to Telegram', { error: (err as Error).message })
        );
      }
    }

    logger.info('Async image generation complete', { userId, sessionId, imageUrl: result.imageUrl });
  } catch (error) {
    logger.error('Async image generation failed', { userId, sessionId, error: (error as Error).message });

    // Try to inject error message into session
    const errorContent = `Image generation failed: ${(error as Error).message}`;
    await sessionService.addMessage({ sessionId, role: 'assistant', content: errorContent, source: 'web' }).catch(err =>
      logger.warn('Failed to persist image error message', { sessionId, error: (err as Error).message })
    );
    broadcastToUser(userId, {
      type: 'new_message',
      sessionId,
      message: errorContent,
      timestamp: new Date(),
    });
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
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Clean, 'base64');

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
 */
export function formatImageForChat(imageUrl: string, caption: string): string {
  return `:::image[${imageUrl}]\n${caption}\n:::`;
}

/**
 * Get the full filesystem path for a generated image
 */
export function getImagePath(filename: string): string | null {
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
    logger.info('Generating project image via ComfyUI', { userId, projectDir, promptLength: prompt.length });

    const result = await comfyuiGenerate({ prompt });

    const imageType = detectImageType(result.buffer);
    const extension = getExtensionForType(imageType);

    const finalFilename = filename || generateFilename(userId, 'img', extension);
    const filenameWithExt = finalFilename.includes('.') ? finalFilename : `${finalFilename}.${extension}`;

    const imagesDir = path.join(projectDir, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const outputPath = path.join(imagesDir, filenameWithExt);
    fs.writeFileSync(outputPath, result.buffer);

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
  generateImageAsync,
  generateProjectImage,
  saveScreenshot,
  formatImageForChat,
  getImagePath,
  cleanupOldImages,
};
