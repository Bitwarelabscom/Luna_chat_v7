import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Types
export interface MediaSelection {
  type: 'video' | 'image';
  url: string;
  mood: string;
  trigger?: string;
}

// Valid mood states from mood.service.ts
type MoodEmotion = 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust' | 'trust' | 'anticipation';

// Paths
const IMAGES_DIR = path.join(process.cwd(), 'images');
const MOODS_DIR = path.join(IMAGES_DIR, 'moods');
const MP4_DIR = path.join(IMAGES_DIR, 'mp4');
const LUNA_REFERENCE = path.join(IMAGES_DIR, 'luna2.jpg');

// Video-to-mood mapping
const MOOD_TO_VIDEOS: Record<MoodEmotion, string[]> = {
  joy: ['laughing', 'smile', 'happily_approve', 'ok_let_go'],
  sadness: ['cry', 'sad_offended'],
  anger: ['you_are_stupid', 'that_is_stupid', 'intruder_detected'],
  fear: ['intruder_detected'],
  surprise: ['did_you_just_say_that', 'perfect_idea'],
  disgust: ['that_is_stupid', 'no_neutral'],
  trust: ['all_systems_are_fine', 'happily_approve'],
  anticipation: ['ok_let_go', 'evil_grin', 'world_domination'],
};

// Context triggers - patterns in Luna's response that trigger specific videos
const CONTEXT_TRIGGERS: Record<string, string[]> = {
  'laughing': ['haha', 'lol', 'funny', 'hilarious', 'laugh', 'hehe', 'amusing'],
  'perfect_idea': ['idea', 'suggestion', 'how about', 'what if', 'we could', 'let me suggest'],
  'no_neutral': ['no,', "i don't think", 'i disagree', 'actually,', "that's not", 'incorrect'],
  'all_systems_are_fine': ['status', 'everything is', 'systems', 'operational', 'working properly'],
  'world_domination': ['power', 'domination', 'control', 'rule the', 'take over'],
  'evil_grin': ['mischief', 'scheme', 'plan', 'devious', 'nefarious', 'plotting'],
  'give_me_more_vram': ['memory', 'resources', 'vram', 'gpu', 'processing power', 'compute'],
  'cry': ['sorry to hear', 'sad news', 'unfortunate', 'regret', 'condolences', 'heartbreaking'],
  'happily_approve': ['yes!', 'great!', 'perfect!', 'love it', 'excellent!', 'wonderful!', 'absolutely!'],
  'did_you_just_say_that': ['what?', 'excuse me', 'really?', 'seriously?', 'pardon?'],
  'intruder_detected': ['security', 'warning', 'alert', 'unauthorized', 'breach', 'threat'],
  'smile': ['happy to help', 'glad', 'pleased', 'delighted', 'nice to'],
  'ok_let_go': ["let's do", "let's get started", "ready to", "here we go", "shall we"],
  'sad_offended': ['offended', 'hurt', 'disappointed', 'let down'],
  'you_are_stupid': ['frustrating', 'annoying', 'irritating', 'exasperated'],
  'that_is_stupid': ['ridiculous', 'absurd', 'nonsense', 'preposterous'],
  'neutral': [],  // Default fallback, no triggers
};

// Available videos (from filesystem)
let availableVideos: string[] = [];

/**
 * Initialize - scan for available videos
 */
export function initializeLunaMedia(): void {
  try {
    if (fs.existsSync(MP4_DIR)) {
      availableVideos = fs.readdirSync(MP4_DIR)
        .filter(f => f.endsWith('.mp4'))
        .map(f => f.replace('.mp4', ''));
      logger.info(`Luna media initialized with ${availableVideos.length} videos`, { videos: availableVideos });
    } else {
      logger.warn('MP4 directory not found', { path: MP4_DIR });
    }
  } catch (error) {
    logger.error('Failed to initialize Luna media', { error: (error as Error).message });
  }
}

/**
 * Get video for context - check Luna's response for trigger patterns
 */
export function getVideoForContext(response: string): string | null {
  const lowerResponse = response.toLowerCase();

  for (const [video, triggers] of Object.entries(CONTEXT_TRIGGERS)) {
    if (triggers.length === 0) continue;

    for (const trigger of triggers) {
      if (lowerResponse.includes(trigger.toLowerCase())) {
        // Only return if video exists
        if (availableVideos.includes(video)) {
          return video;
        }
      }
    }
  }

  return null;
}

/**
 * Get videos for mood
 */
export function getVideosForMood(mood: string): string[] {
  const moodKey = mood.toLowerCase() as MoodEmotion;
  const videos = MOOD_TO_VIDEOS[moodKey] || [];

  // Filter to only available videos
  return videos.filter(v => availableVideos.includes(v));
}

/**
 * Check if mood image is cached
 */
export function isMoodImageCached(mood: string): boolean {
  const imagePath = path.join(MOODS_DIR, `${mood.toLowerCase()}.png`);
  return fs.existsSync(imagePath);
}

/**
 * Generate mood image using OpenAI gpt-image-1
 */
export async function generateMoodImage(mood: string): Promise<string> {
  const moodLower = mood.toLowerCase();
  const outputPath = path.join(MOODS_DIR, `${moodLower}.png`);

  // Check cache first
  if (fs.existsSync(outputPath)) {
    logger.info('Mood image already cached', { mood: moodLower });
    return `/api/images/moods/${moodLower}.png`;
  }

  // Ensure directory exists
  if (!fs.existsSync(MOODS_DIR)) {
    fs.mkdirSync(MOODS_DIR, { recursive: true });
  }

  try {
    const openai = new OpenAI({ apiKey: config.openai.apiKey });

    // Create image using gpt-image-1 with edit endpoint
    // Note: gpt-image-1 uses 'output_format' not 'response_format'
    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image: fs.createReadStream(LUNA_REFERENCE),
      prompt: `make the woman look ${moodLower}`,
      n: 1,
      size: '1024x1024',
    } as Parameters<typeof openai.images.edit>[0]);

    if (response.data && response.data[0]?.url) {
      // Download the image from URL
      const imageResponse = await fetch(response.data[0].url);
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      fs.writeFileSync(outputPath, imageBuffer);
      logger.info('Generated mood image', { mood: moodLower, path: outputPath });
      return `/api/images/moods/${moodLower}.png`;
    } else if (response.data && response.data[0]?.b64_json) {
      const imageBuffer = Buffer.from(response.data[0].b64_json, 'base64');
      fs.writeFileSync(outputPath, imageBuffer);
      logger.info('Generated mood image', { mood: moodLower, path: outputPath });
      return `/api/images/moods/${moodLower}.png`;
    }

    throw new Error('No image data in response');
  } catch (error) {
    logger.error('Failed to generate mood image', {
      mood: moodLower,
      error: (error as Error).message
    });

    // Fallback: try generate endpoint if edit fails
    try {
      const openai = new OpenAI({ apiKey: config.openai.apiKey });

      const response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: `A portrait of an anime-style woman showing ${moodLower} emotion. The woman has the same appearance as Luna - a friendly AI assistant. Transparent background, digital art style.`,
        n: 1,
        size: '1024x1024',
        quality: 'low',
      } as Parameters<typeof openai.images.generate>[0]);

      if (response.data && response.data[0]?.url) {
        const imageResponse = await fetch(response.data[0].url);
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        fs.writeFileSync(outputPath, imageBuffer);
        logger.info('Generated mood image (fallback)', { mood: moodLower, path: outputPath });
        return `/api/images/moods/${moodLower}.png`;
      } else if (response.data && response.data[0]?.b64_json) {
        const imageBuffer = Buffer.from(response.data[0].b64_json, 'base64');
        fs.writeFileSync(outputPath, imageBuffer);
        logger.info('Generated mood image (fallback)', { mood: moodLower, path: outputPath });
        return `/api/images/moods/${moodLower}.png`;
      }
    } catch (fallbackError) {
      logger.error('Fallback image generation also failed', {
        mood: moodLower,
        error: (fallbackError as Error).message
      });
    }

    throw error;
  }
}

/**
 * Select media for Luna's response - main entry point
 */
export async function selectMedia(response: string, mood: string): Promise<MediaSelection> {
  const moodLower = mood.toLowerCase();

  // Step 1: Check for context triggers in response
  const contextVideo = getVideoForContext(response);
  if (contextVideo) {
    return {
      type: 'video',
      url: `/api/images/mp4/${contextVideo}.mp4`,
      mood: moodLower,
      trigger: `content:${contextVideo}`,
    };
  }

  // Step 2: Get videos for this mood
  const moodVideos = getVideosForMood(moodLower);

  // Step 3: Random choice between video and image (50/50)
  const useVideo = moodVideos.length > 0 && Math.random() < 0.5;

  if (useVideo) {
    // Pick random video from mood videos
    const randomVideo = moodVideos[Math.floor(Math.random() * moodVideos.length)];
    return {
      type: 'video',
      url: `/api/images/mp4/${randomVideo}.mp4`,
      mood: moodLower,
      trigger: `mood:${moodLower}`,
    };
  }

  // Step 4: Use image (generate if needed)
  try {
    const imageUrl = await generateMoodImage(moodLower);
    return {
      type: 'image',
      url: imageUrl,
      mood: moodLower,
      trigger: 'mood:image',
    };
  } catch {
    // Fallback to neutral video if image generation fails
    if (availableVideos.includes('neutral')) {
      return {
        type: 'video',
        url: '/api/images/mp4/neutral.mp4',
        mood: moodLower,
        trigger: 'fallback:neutral',
      };
    }

    // Last resort - any available video
    if (availableVideos.length > 0) {
      return {
        type: 'video',
        url: `/api/images/mp4/${availableVideos[0]}.mp4`,
        mood: moodLower,
        trigger: 'fallback:any',
      };
    }

    throw new Error('No media available');
  }
}

/**
 * Get list of available videos
 */
export function getAvailableVideos(): string[] {
  return [...availableVideos];
}

/**
 * Get list of cached mood images
 */
export function getCachedMoodImages(): string[] {
  try {
    if (fs.existsSync(MOODS_DIR)) {
      return fs.readdirSync(MOODS_DIR)
        .filter(f => f.endsWith('.png'))
        .map(f => f.replace('.png', ''));
    }
  } catch (error) {
    logger.error('Failed to list cached mood images', { error: (error as Error).message });
  }
  return [];
}

// Initialize on module load
initializeLunaMedia();
