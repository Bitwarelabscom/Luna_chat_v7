import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import OpenAI from 'openai';
import { fileTypeFromBuffer } from 'file-type';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as xaiProvider from '../llm/providers/xai.provider.js';

// Paths
const IMAGES_DIR = path.join(process.cwd(), 'images');
const BACKGROUNDS_DIR = path.join(IMAGES_DIR, 'backgrounds');
const GENERATED_DIR = path.join(BACKGROUNDS_DIR, 'generated');
const UPLOADED_DIR = path.join(BACKGROUNDS_DIR, 'uploaded');
const CHAT_GENERATED_DIR = path.join(IMAGES_DIR, 'generated');

// Ensure directories exist
for (const dir of [BACKGROUNDS_DIR, GENERATED_DIR, UPLOADED_DIR, CHAT_GENERATED_DIR]) {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
}

// SECURITY: Allowed image types whitelist
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BACKGROUNDS_PER_USER = 20;

// Style prompts for background generation
const STYLE_PROMPTS: Record<string, string> = {
  abstract: 'Abstract digital art background with flowing gradients, geometric shapes, and modern aesthetics. ',
  nature: 'Beautiful serene nature landscape, photorealistic, peaceful scenery with natural lighting. ',
  artistic: 'Artistic illustration with creative composition, visually striking colors and design. ',
  custom: '' // User provides full description
};

const BASE_PROMPT_SUFFIX = 'Desktop wallpaper, panoramic wide format 19:6, ultra-wide cinematic composition, high quality, no text, suitable for desktop background with good contrast for UI overlays.';

export interface Background {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  backgroundType: 'generated' | 'uploaded' | 'preset';
  style: string | null;
  prompt: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface BackgroundResult {
  success: boolean;
  background?: Background;
  error?: string;
}

export interface GeneratedImageOption {
  filename: string;
  imageUrl: string;
  createdAt: Date;
  sizeBytes: number;
}

/**
 * SECURITY: Validate uploaded image file
 */
async function validateImageFile(
  buffer: Buffer,
  originalName: string,
  _claimedMimeType: string
): Promise<{ isValid: boolean; error?: string; detectedMimeType?: string }> {
  // 1. Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return { isValid: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
  }

  // 2. Check extension whitelist
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { isValid: false, error: `File extension "${ext}" not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` };
  }

  // 3. Detect actual MIME type from magic bytes
  const detectedType = await fileTypeFromBuffer(buffer);
  if (!detectedType || !ALLOWED_MIME_TYPES.has(detectedType.mime)) {
    return { isValid: false, error: 'Invalid image file - content does not match allowed image types' };
  }

  // 4. Prevent path traversal
  if (originalName.includes('..') || originalName.includes('/') || originalName.includes('\\')) {
    return { isValid: false, error: 'Invalid filename detected' };
  }

  // 5. Check filename length
  if (originalName.length > 255) {
    return { isValid: false, error: 'Filename too long (max 255 characters)' };
  }

  return { isValid: true, detectedMimeType: detectedType.mime };
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
 * Generate a unique filename
 */
function generateFilename(userId: string, prefix: string, extension: string): string {
  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${userId.substring(0, 8)}_${timestamp}_${hash}.${extension}`;
}

/**
 * Check if a generated image filename belongs to this user.
 * Image generation service stores user id prefix in the filename.
 */
function isUserGeneratedImageFilename(userId: string, filename: string): boolean {
  const userPrefix = userId.substring(0, 8);
  return (
    filename.startsWith(`gen_${userPrefix}_`) ||
    filename.startsWith(`screenshot_${userPrefix}_`)
  );
}

/**
 * Map database row to Background object
 */
function mapRowToBackground(row: Record<string, unknown>): Background {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    description: row.description as string | null,
    imageUrl: row.image_url as string,
    thumbnailUrl: row.thumbnail_url as string | null,
    backgroundType: row.background_type as 'generated' | 'uploaded' | 'preset',
    style: row.style as string | null,
    prompt: row.prompt as string | null,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Generate a desktop background using OpenAI or xAI
 */
export async function generateBackground(
  userId: string,
  prompt: string,
  style: string = 'custom'
): Promise<BackgroundResult> {
  try {
    // Check user background count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM desktop_backgrounds WHERE user_id = $1',
      [userId]
    );
    if (parseInt(countResult.rows[0].count) >= MAX_BACKGROUNDS_PER_USER) {
      return { success: false, error: `Maximum backgrounds reached (${MAX_BACKGROUNDS_PER_USER}). Delete some first.` };
    }

    const modelConfig = await getUserModelConfig(userId, 'image_generation');

    // Build the full prompt
    const stylePrefix = STYLE_PROMPTS[style] || STYLE_PROMPTS.custom;
    const fullPrompt = `${stylePrefix}${prompt}. ${BASE_PROMPT_SUFFIX}`;

    logger.info('Generating desktop background', { userId, style, provider: modelConfig.provider, model: modelConfig.model });

    let imageBuffer: Buffer;

    if (modelConfig.provider === 'xai') {
      const result = await xaiProvider.generateImage(fullPrompt, {
        model: modelConfig.model,
        aspect_ratio: '16:9',
      });

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
        model: modelConfig.model || 'gpt-image-1-mini',
        prompt: fullPrompt,
        n: 1,
        size: '1792x1024', // Best wide format for DALL-E/GPT-Image
        quality: 'standard',
      });

      if (!response.data || !response.data[0]) {
        return { success: false, error: 'No image data returned from OpenAI' };
      }

      const imageData = response.data[0];
      if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`);
        imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      } else if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, 'base64');
      } else {
        return { success: false, error: 'No image URL or base64 data in response' };
      }
    }

    // Detect image type and save
    const imageType = detectImageType(imageBuffer);
    const extension = getExtensionForType(imageType);
    const filename = generateFilename(userId, 'bg', extension);
    const outputPath = path.join(GENERATED_DIR, filename);

    await fs.writeFile(outputPath, imageBuffer, { mode: 0o644 });

    const imageUrl = `/api/images/backgrounds/generated/${filename}`;

    // Create a name from the prompt
    const name = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt;

    // Save to database
    const result = await pool.query(
      `INSERT INTO desktop_backgrounds (user_id, name, description, image_url, background_type, style, prompt)
       VALUES ($1, $2, $3, $4, 'generated', $5, $6)
       RETURNING *`,
      [userId, name, prompt, imageUrl, style, fullPrompt]
    );

    const background = mapRowToBackground(result.rows[0]);
    logger.info('Desktop background generated', { userId, backgroundId: background.id, imageUrl });

    return { success: true, background };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Background generation failed', { userId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Upload a custom background image
 */
export async function uploadBackground(
  userId: string,
  file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }
): Promise<BackgroundResult> {
  try {
    // SECURITY: Validate file
    const validation = await validateImageFile(file.buffer, file.originalname, file.mimetype);
    if (!validation.isValid) {
      logger.warn('Background upload rejected', { userId, reason: validation.error, filename: file.originalname });
      return { success: false, error: validation.error };
    }

    // Check user background count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM desktop_backgrounds WHERE user_id = $1',
      [userId]
    );
    if (parseInt(countResult.rows[0].count) >= MAX_BACKGROUNDS_PER_USER) {
      return { success: false, error: `Maximum backgrounds reached (${MAX_BACKGROUNDS_PER_USER}). Delete some first.` };
    }

    // Generate secure filename
    const imageType = detectImageType(file.buffer);
    const extension = getExtensionForType(imageType);
    const filename = generateFilename(userId, 'upload', extension);
    const outputPath = path.join(UPLOADED_DIR, filename);

    // Save file with restricted permissions
    await fs.writeFile(outputPath, file.buffer, { mode: 0o644 });

    const imageUrl = `/api/images/backgrounds/uploaded/${filename}`;

    // Use original filename as name (without path)
    const name = path.basename(file.originalname, path.extname(file.originalname));

    // Save to database
    const result = await pool.query(
      `INSERT INTO desktop_backgrounds (user_id, name, image_url, background_type)
       VALUES ($1, $2, $3, 'uploaded')
       RETURNING *`,
      [userId, name, imageUrl]
    );

    const background = mapRowToBackground(result.rows[0]);
    logger.info('Background uploaded', { userId, backgroundId: background.id, filename });

    return { success: true, background };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Background upload failed', { userId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * List generated chat images owned by the user (images/generated).
 */
export async function listUserGeneratedImages(userId: string): Promise<GeneratedImageOption[]> {
  try {
    const entries = await fs.readdir(CHAT_GENERATED_DIR, { withFileTypes: true });
    const imageFiles = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((filename) => {
        const ext = path.extname(filename).toLowerCase();
        return ALLOWED_EXTENSIONS.has(ext) && isUserGeneratedImageFilename(userId, filename);
      });

    const images = await Promise.all(imageFiles.map(async (filename) => {
      const filePath = path.join(CHAT_GENERATED_DIR, filename);
      const stat = await fs.stat(filePath);
      return {
        filename,
        imageUrl: `/api/images/generated/${filename}`,
        createdAt: stat.mtime,
        sizeBytes: stat.size,
      };
    }));

    return images.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch (error) {
    logger.error('Failed to list generated images', { userId, error: (error as Error).message });
    return [];
  }
}

/**
 * Create a desktop background entry by importing a user-generated chat image.
 * The source image is copied into images/backgrounds/generated for lifecycle consistency.
 */
export async function importGeneratedImageAsBackground(
  userId: string,
  filename: string
): Promise<BackgroundResult> {
  try {
    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename) {
      return { success: false, error: 'Invalid filename' };
    }

    if (!isUserGeneratedImageFilename(userId, sanitizedFilename)) {
      return { success: false, error: 'Generated image not found' };
    }

    const sourceExt = path.extname(sanitizedFilename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(sourceExt)) {
      return { success: false, error: 'Unsupported generated image type' };
    }

    const sourcePath = path.join(CHAT_GENERATED_DIR, sanitizedFilename);
    try {
      await fs.access(sourcePath);
    } catch {
      return { success: false, error: 'Generated image not found' };
    }

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM desktop_backgrounds WHERE user_id = $1',
      [userId]
    );
    if (parseInt(countResult.rows[0].count) >= MAX_BACKGROUNDS_PER_USER) {
      return { success: false, error: `Maximum backgrounds reached (${MAX_BACKGROUNDS_PER_USER}). Delete some first.` };
    }

    const normalizedExt = sourceExt === '.jpeg' ? 'jpg' : sourceExt.replace('.', '');
    const targetFilename = generateFilename(userId, 'bg', normalizedExt);
    const targetPath = path.join(GENERATED_DIR, targetFilename);
    await fs.copyFile(sourcePath, targetPath);

    const imageUrl = `/api/images/backgrounds/generated/${targetFilename}`;
    const result = await pool.query(
      `INSERT INTO desktop_backgrounds (user_id, name, description, image_url, background_type, style, prompt)
       VALUES ($1, $2, $3, $4, 'generated', $5, $6)
       RETURNING *`,
      [userId, 'Generated image', `Imported from ${sanitizedFilename}`, imageUrl, 'custom', null]
    );

    const background = mapRowToBackground(result.rows[0]);
    logger.info('Background imported from generated image', {
      userId,
      sourceFilename: sanitizedFilename,
      backgroundId: background.id,
    });

    return { success: true, background };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Failed to import generated image as background', { userId, filename, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Set a background as active (deactivates others)
 */
export async function setActiveBackground(
  userId: string,
  backgroundId: string | null
): Promise<BackgroundResult> {
  try {
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deactivate all backgrounds for user
      await client.query(
        'UPDATE desktop_backgrounds SET is_active = false WHERE user_id = $1',
        [userId]
      );

      let background: Background | undefined;

      // If backgroundId provided, activate it
      if (backgroundId) {
        const result = await client.query(
          `UPDATE desktop_backgrounds
           SET is_active = true
           WHERE id = $1 AND user_id = $2
           RETURNING *`,
          [backgroundId, userId]
        );

        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Background not found' };
        }

        background = mapRowToBackground(result.rows[0]);
      }

      await client.query('COMMIT');
      logger.info('Background activated', { userId, backgroundId });

      return { success: true, background };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Failed to set active background', { userId, backgroundId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Get user's active background
 */
export async function getActiveBackground(userId: string): Promise<Background | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM desktop_backgrounds WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapRowToBackground(result.rows[0]);
  } catch (error) {
    logger.error('Failed to get active background', { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * Get all backgrounds for a user
 */
export async function getUserBackgrounds(userId: string): Promise<Background[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM desktop_backgrounds WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    return result.rows.map(mapRowToBackground);
  } catch (error) {
    logger.error('Failed to get user backgrounds', { userId, error: (error as Error).message });
    return [];
  }
}

/**
 * Delete a background
 */
export async function deleteBackground(
  userId: string,
  backgroundId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get background info first
    const bgResult = await pool.query(
      'SELECT * FROM desktop_backgrounds WHERE id = $1 AND user_id = $2',
      [backgroundId, userId]
    );

    if (bgResult.rows.length === 0) {
      return { success: false, error: 'Background not found' };
    }

    const background = mapRowToBackground(bgResult.rows[0]);

    // Delete from database
    await pool.query(
      'DELETE FROM desktop_backgrounds WHERE id = $1 AND user_id = $2',
      [backgroundId, userId]
    );

    // Delete file from disk (only for generated/uploaded, not presets)
    if (background.backgroundType !== 'preset') {
      const filename = path.basename(background.imageUrl);
      const dir = background.backgroundType === 'generated' ? GENERATED_DIR : UPLOADED_DIR;
      const filePath = path.join(dir, filename);

      try {
        await fs.unlink(filePath);
      } catch (err) {
        // File might already be deleted, log but don't fail
        logger.warn('Could not delete background file', { filePath, error: (err as Error).message });
      }
    }

    logger.info('Background deleted', { userId, backgroundId });
    return { success: true };
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Failed to delete background', { userId, backgroundId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

export default {
  generateBackground,
  uploadBackground,
  listUserGeneratedImages,
  importGeneratedImageAsBackground,
  setActiveBackground,
  getActiveBackground,
  getUserBackgrounds,
  deleteBackground,
};
