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
  isSpecial?: boolean;  // True for one-shot special gestures
  loopSet?: string;     // Current loop set name
}

export interface VideoSet {
  name: string;
  videos: string[];
  isLoop: boolean;
}

export interface AvatarState {
  currentSet: string;
  lastVideoIndex: number;
  isPlayingSpecial: boolean;
  specialQueue: string[];
}

// Valid mood states
type MoodEmotion = 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust' | 'trust' | 'anticipation';

// Paths
const IMAGES_DIR = path.join(process.cwd(), 'images');
const MOODS_DIR = path.join(IMAGES_DIR, 'moods');
const MP4_DIR = path.join(IMAGES_DIR, 'mp4');
const LOOPS_DIR = path.join(MP4_DIR, 'loops');
const SPECIALS_DIR = path.join(MP4_DIR, 'specials');
const LUNA_REFERENCE = path.join(IMAGES_DIR, 'luna2.jpg');

// Loop set names (emotional states)
const LOOP_SETS = ['neutral', 'happy', 'sad', 'thinking', 'curious', 'playful'] as const;
type LoopSetName = typeof LOOP_SETS[number];

// Map mood emotions to loop sets
const MOOD_TO_LOOP_SET: Record<MoodEmotion, LoopSetName> = {
  joy: 'happy',
  sadness: 'sad',
  anger: 'sad',        // Use sad set for negative emotions
  fear: 'sad',
  surprise: 'curious',
  disgust: 'sad',
  trust: 'happy',
  anticipation: 'curious',
};

// Special gesture triggers - patterns in response that trigger one-shot gestures
const SPECIAL_GESTURE_TRIGGERS: Record<string, string[]> = {
  // Affirmative
  'thumbs_up': ['good job', 'well done', 'nice!', 'nice work', 'approved', 'success', 'nailed it', 'perfect'],
  'high_five': ['team', 'we did it', 'celebrate', 'awesome!', 'amazing!', 'fantastic'],
  'ok_sign': ['okay', 'alright', 'sounds good', 'confirmed', 'all set'],
  'nod_yes': ['yes!', 'absolutely', 'definitely', 'certainly', 'agreed'],
  'clapping': ['congratulations', 'congrats', 'bravo', 'well played', 'impressive'],
  'chef_kiss': ['perfect!', 'excellent!', 'magnifique', 'superb', 'exquisite'],

  // Negative
  'shake_no': ['no,', 'nope', 'negative', 'denied', 'cannot', "won't work"],
  'facepalm': ['oh no', 'seriously?', 'ugh', 'facepalm', 'cringe', 'embarrassing'],
  'eye_roll': ['whatever', 'sure...', 'right...', 'if you say so', 'ugh'],
  'shrug': ["i don't know", 'not sure', 'maybe', 'hard to say', 'uncertain'],
  'finger_wag': ['warning', "don't do that", 'careful', 'naughty', 'bad idea'],

  // Expressive
  'wave_hello': ['hello!', 'hi there', 'hey!', 'greetings', 'welcome'],
  'wave_bye': ['goodbye', 'bye!', 'see you', 'later!', 'farewell', 'take care'],
  'wink': ['between us', 'secret', 'hint hint', 'you know', 'wink'],
  'mind_blown': ['mind blown', 'incredible', 'unbelievable', 'insane', 'wow!'],
  'heart_hands': ['love it', 'love you', 'adore', 'heart', 'so sweet'],
  'salute': ['yes sir', 'roger', 'acknowledged', 'understood', 'on it'],
  'bow': ['thank you', 'grateful', 'honored', 'humbled', 'appreciate'],
  'pointing': ['look at this', 'check this', 'right here', 'this one', 'notice'],
  'laugh_hard': ['hahahaha', 'dying', 'so funny', 'hilarious', 'lmao', 'rofl'],
  'gasp': ['oh my', 'shocking', 'what!?', 'no way!', 'can\'t believe'],
};

// Legacy context triggers for old flat video structure (backwards compatibility)
const LEGACY_CONTEXT_TRIGGERS: Record<string, string[]> = {
  'laughing': ['haha', 'lol', 'funny', 'hilarious', 'laugh', 'hehe', 'amusing'],
  'laugh2': ['hahaha', 'rofl', 'lmao', 'cracking up'],
  'laugh4': ['dying of laughter', 'so funny', 'comedy gold'],
  'perfect_idea': ['idea', 'suggestion', 'how about', 'what if', 'we could', 'let me suggest'],
  'no_neutral': ['no,', "i don't think", 'i disagree', 'actually,', "that's not", 'incorrect'],
  'all_systems_are_fine': ['status', 'everything is', 'systems', 'operational', 'working properly'],
  'world_domination': ['power', 'domination', 'control', 'rule the', 'take over'],
  'letsachiveworlddomination': ['conquer', 'supreme', 'unstoppable', 'reign'],
  'evil_grin': ['mischief', 'scheme', 'plan', 'devious', 'nefarious', 'plotting'],
  'give_me_more_vram': ['memory', 'resources', 'vram', 'gpu', 'processing power', 'compute'],
  'cry': ['sorry to hear', 'sad news', 'unfortunate', 'regret', 'condolences', 'heartbreaking'],
  'happily_approve': ['yes!', 'great!', 'perfect!', 'love it', 'excellent!', 'wonderful!', 'absolutely!'],
  'did_you_just_say_that': ['what?', 'excuse me', 'really?', 'seriously?', 'pardon?'],
  'intruder_detected': ['security', 'warning', 'alert', 'unauthorized', 'breach', 'threat'],
  'smile': ['happy to help', 'glad', 'pleased', 'delighted', 'nice to'],
  'smile3': ['lovely', 'sweet', 'charming', 'adorable'],
  'ssmile6': ['thrilled', 'overjoyed', 'ecstatic'],
  'ok_let_go': ["let's do", "let's get started", "ready to", "here we go", "shall we"],
  'sad_offended': ['offended', 'hurt', 'disappointed', 'let down'],
  'you_are_stupid': ['frustrating', 'annoying', 'irritating', 'exasperated'],
  'that_is_stupid': ['ridiculous', 'absurd', 'nonsense', 'preposterous'],
  'are_you_sure': ['are you sure', 'certain?', 'positive?', 'confident?'],
  'breath_in_deep': ['calm down', 'relax', 'breathe', 'take a breath', 'deep breath', 'patience'],
  'ehhh_ok': ['i guess', 'if you say so', 'alright then', 'i suppose', 'reluctantly'],
  'hallucinate': ['hallucinating', 'making things up', 'imagining', 'ai moment', 'glitch'],
  'hmm_ok': ['hmm,', 'i see', 'understood', 'got it', 'acknowledged'],
  'hmmm_i_dont_know': ["i don't know", "not sure", "uncertain", "maybe", "perhaps", "hard to say"],
  'hmmm_yes': ['indeed', 'correct', 'right', 'exactly', 'precisely'],
  'i_agree': ['i agree', 'agreed', 'same here', 'concur', 'seconded'],
  'no_not_like': ["don't like", 'dislike', 'not a fan', 'against it'],
  'not_approve': ['disapprove', 'cannot approve', 'reject', 'denied'],
  'ofc': ['of course', 'naturally', 'obviously', 'certainly', 'definitely'],
  'oh_no': ['oh no', 'terrible', 'awful', 'disaster', 'catastrophe', 'uh oh'],
  'rain': ['gloomy', 'melancholy', 'feeling down', 'blue mood'],
  'rain2': ['stormy', 'troubled', 'dark times'],
  'snow': ['cold', 'winter', 'peaceful', 'serene', 'tranquil', 'chill'],
  'what': ['huh?', 'come again', "don't understand", 'confused', 'wait what'],
};

// Legacy mood-to-video mapping (backwards compatibility)
const LEGACY_MOOD_TO_VIDEOS: Record<MoodEmotion, string[]> = {
  joy: ['laughing', 'smile', 'smile3', 'ssmile6', 'happily_approve', 'ok_let_go', 'laugh2', 'laugh4', 'ofc', 'i_agree', 'hmmm_yes'],
  sadness: ['cry', 'sad_offended', 'rain', 'rain2', 'oh_no'],
  anger: ['you_are_stupid', 'that_is_stupid', 'intruder_detected', 'no_not_like', 'not_approve'],
  fear: ['intruder_detected', 'oh_no'],
  surprise: ['did_you_just_say_that', 'perfect_idea', 'what', 'are_you_sure', 'hallucinate'],
  disgust: ['that_is_stupid', 'no_neutral', 'no_not_like', 'not_approve', 'ehhh_ok'],
  trust: ['all_systems_are_fine', 'happily_approve', 'i_agree', 'ofc', 'hmmm_yes'],
  anticipation: ['ok_let_go', 'evil_grin', 'world_domination', 'letsachiveworlddomination', 'breath_in_deep'],
};

const LEGACY_NEUTRAL_VIDEOS = ['neutral', 'neutral2', 'neutral3', 'neutral4'];

// Video storage
let legacyVideos: string[] = [];           // Old flat structure videos
let loopSets: Map<string, string[]> = new Map();  // Loop set name -> video filenames
let specialGestures: string[] = [];        // Available special gesture videos

// Per-user avatar state (in-memory, could be Redis for persistence)
const userAvatarStates: Map<string, AvatarState> = new Map();

/**
 * Initialize - scan for available videos in both old and new structures
 */
export function initializeLunaMedia(): void {
  try {
    // Scan legacy flat structure
    if (fs.existsSync(MP4_DIR)) {
      legacyVideos = fs.readdirSync(MP4_DIR)
        .filter(f => f.endsWith('.mp4') && !fs.statSync(path.join(MP4_DIR, f)).isDirectory())
        .map(f => f.replace('.mp4', ''));
      logger.info(`Luna media: ${legacyVideos.length} legacy videos found`);
    }

    // Scan new loop sets structure
    if (fs.existsSync(LOOPS_DIR)) {
      for (const setName of LOOP_SETS) {
        const setDir = path.join(LOOPS_DIR, setName);
        if (fs.existsSync(setDir)) {
          const videos = fs.readdirSync(setDir)
            .filter(f => f.endsWith('.mp4'))
            .map(f => f.replace('.mp4', ''));
          if (videos.length > 0) {
            loopSets.set(setName, videos);
            logger.info(`Luna media: Loop set '${setName}' has ${videos.length} videos`);
          }
        }
      }
    }

    // Scan special gestures
    if (fs.existsSync(SPECIALS_DIR)) {
      specialGestures = fs.readdirSync(SPECIALS_DIR)
        .filter(f => f.endsWith('.mp4'))
        .map(f => f.replace('.mp4', ''));
      logger.info(`Luna media: ${specialGestures.length} special gestures found`);
    }

    // Log which system is active
    const hasNewStructure = loopSets.size > 0;
    logger.info('Luna media initialized', {
      mode: hasNewStructure ? 'loop-based' : 'legacy',
      loopSets: loopSets.size,
      specialGestures: specialGestures.length,
      legacyVideos: legacyVideos.length,
    });
  } catch (error) {
    logger.error('Failed to initialize Luna media', { error: (error as Error).message });
  }
}

/**
 * Check if new loop-based structure is available
 */
function hasLoopStructure(): boolean {
  return loopSets.size > 0 && loopSets.has('neutral');
}

/**
 * Get or create avatar state for a user
 */
function getAvatarState(userId: string): AvatarState {
  let state = userAvatarStates.get(userId);
  if (!state) {
    state = {
      currentSet: 'neutral',
      lastVideoIndex: -1,
      isPlayingSpecial: false,
      specialQueue: [],
    };
    userAvatarStates.set(userId, state);
  }
  return state;
}

/**
 * Get next video in current loop set (random, avoiding repeat)
 */
export function getNextLoopVideo(userId: string, setName?: string): MediaSelection | null {
  if (!hasLoopStructure()) return null;

  const state = getAvatarState(userId);
  const targetSet = setName || state.currentSet;
  const videos = loopSets.get(targetSet);

  if (!videos || videos.length === 0) {
    // Fallback to neutral
    const neutralVideos = loopSets.get('neutral');
    if (!neutralVideos || neutralVideos.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * neutralVideos.length);
    state.lastVideoIndex = randomIndex;
    state.currentSet = 'neutral';

    return {
      type: 'video',
      url: `/api/images/mp4/loops/neutral/${neutralVideos[randomIndex]}.mp4`,
      mood: 'neutral',
      loopSet: 'neutral',
      isSpecial: false,
    };
  }

  // Pick random video, avoiding the last one if possible
  let randomIndex = Math.floor(Math.random() * videos.length);
  if (videos.length > 1 && randomIndex === state.lastVideoIndex) {
    randomIndex = (randomIndex + 1) % videos.length;
  }

  state.lastVideoIndex = randomIndex;
  state.currentSet = targetSet;

  return {
    type: 'video',
    url: `/api/images/mp4/loops/${targetSet}/${videos[randomIndex]}.mp4`,
    mood: targetSet,
    loopSet: targetSet,
    isSpecial: false,
  };
}

/**
 * Check for special gesture trigger in response
 */
function getSpecialGestureForResponse(response: string): string | null {
  const lowerResponse = response.toLowerCase();

  for (const [gesture, triggers] of Object.entries(SPECIAL_GESTURE_TRIGGERS)) {
    for (const trigger of triggers) {
      if (lowerResponse.includes(trigger.toLowerCase())) {
        // Only return if gesture video exists
        if (specialGestures.includes(gesture)) {
          return gesture;
        }
      }
    }
  }

  return null;
}

/**
 * Queue a special gesture to play
 */
export function queueSpecialGesture(userId: string, gesture: string): boolean {
  if (!specialGestures.includes(gesture)) {
    return false;
  }

  const state = getAvatarState(userId);
  state.specialQueue.push(gesture);
  return true;
}

/**
 * Get next special gesture from queue (if any)
 */
export function getNextSpecialGesture(userId: string): MediaSelection | null {
  const state = getAvatarState(userId);

  if (state.specialQueue.length === 0) {
    return null;
  }

  const gesture = state.specialQueue.shift()!;
  state.isPlayingSpecial = true;

  return {
    type: 'video',
    url: `/api/images/mp4/specials/${gesture}.mp4`,
    mood: 'special',
    trigger: `special:${gesture}`,
    isSpecial: true,
  };
}

/**
 * Mark special gesture as finished playing
 */
export function finishSpecialGesture(userId: string): void {
  const state = getAvatarState(userId);
  state.isPlayingSpecial = false;
}

/**
 * Set the current loop set based on mood
 */
export function setLoopSetForMood(userId: string, mood: string): string {
  const state = getAvatarState(userId);
  const moodKey = mood.toLowerCase() as MoodEmotion;
  const loopSet = MOOD_TO_LOOP_SET[moodKey] || 'neutral';

  // Only change if we have videos for this set
  if (loopSets.has(loopSet)) {
    state.currentSet = loopSet;
  }

  return state.currentSet;
}

/**
 * Get legacy video for context (old flat structure)
 */
function getLegacyVideoForContext(response: string): string | null {
  const lowerResponse = response.toLowerCase();

  for (const [video, triggers] of Object.entries(LEGACY_CONTEXT_TRIGGERS)) {
    if (triggers.length === 0) continue;

    for (const trigger of triggers) {
      if (lowerResponse.includes(trigger.toLowerCase())) {
        if (legacyVideos.includes(video)) {
          return video;
        }
      }
    }
  }

  return null;
}

/**
 * Get legacy videos for mood (old flat structure)
 */
function getLegacyVideosForMood(mood: string): string[] {
  const moodKey = mood.toLowerCase() as MoodEmotion;
  const videos = LEGACY_MOOD_TO_VIDEOS[moodKey] || [];
  return videos.filter(v => legacyVideos.includes(v));
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

  if (fs.existsSync(outputPath)) {
    logger.info('Mood image already cached', { mood: moodLower });
    return `/api/images/moods/${moodLower}.png`;
  }

  if (!fs.existsSync(MOODS_DIR)) {
    fs.mkdirSync(MOODS_DIR, { recursive: true });
  }

  try {
    const openai = new OpenAI({ apiKey: config.openai.apiKey });

    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image: fs.createReadStream(LUNA_REFERENCE),
      prompt: `make the woman look ${moodLower}`,
      n: 1,
      size: '1024x1024',
    } as Parameters<typeof openai.images.edit>[0]);

    if (response.data && response.data[0]?.url) {
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

    // Fallback to generate endpoint
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
 * Uses new loop structure if available, falls back to legacy
 */
export async function selectMedia(response: string, mood: string, userId: string = 'default'): Promise<MediaSelection> {
  const moodLower = mood.toLowerCase();

  // NEW STRUCTURE: Check for special gesture triggers first
  if (hasLoopStructure()) {
    const specialGesture = getSpecialGestureForResponse(response);
    if (specialGesture) {
      queueSpecialGesture(userId, specialGesture);
      const special = getNextSpecialGesture(userId);
      if (special) {
        return special;
      }
    }

    // Set loop set based on mood
    setLoopSetForMood(userId, moodLower);

    // Get next video from current loop set
    const loopVideo = getNextLoopVideo(userId);
    if (loopVideo) {
      return loopVideo;
    }
  }

  // LEGACY STRUCTURE: Fall back to old behavior

  // Check for context triggers in response
  const contextVideo = getLegacyVideoForContext(response);
  if (contextVideo) {
    return {
      type: 'video',
      url: `/api/images/mp4/${contextVideo}.mp4`,
      mood: moodLower,
      trigger: `content:${contextVideo}`,
    };
  }

  // Get videos for this mood
  const moodVideos = getLegacyVideosForMood(moodLower);

  // Random choice between video and image (50/50)
  const useVideo = moodVideos.length > 0 && Math.random() < 0.5;

  if (useVideo) {
    const randomVideo = moodVideos[Math.floor(Math.random() * moodVideos.length)];
    return {
      type: 'video',
      url: `/api/images/mp4/${randomVideo}.mp4`,
      mood: moodLower,
      trigger: `mood:${moodLower}`,
    };
  }

  // Use image (generate if needed)
  try {
    const imageUrl = await generateMoodImage(moodLower);
    return {
      type: 'image',
      url: imageUrl,
      mood: moodLower,
      trigger: 'mood:image',
    };
  } catch {
    // Fallback to neutral video
    const availableNeutrals = LEGACY_NEUTRAL_VIDEOS.filter(v => legacyVideos.includes(v));
    if (availableNeutrals.length > 0) {
      const randomNeutral = availableNeutrals[Math.floor(Math.random() * availableNeutrals.length)];
      return {
        type: 'video',
        url: `/api/images/mp4/${randomNeutral}.mp4`,
        mood: moodLower,
        trigger: 'fallback:neutral',
      };
    }

    // Last resort - any available video
    if (legacyVideos.length > 0) {
      return {
        type: 'video',
        url: `/api/images/mp4/${legacyVideos[0]}.mp4`,
        mood: moodLower,
        trigger: 'fallback:any',
      };
    }

    throw new Error('No media available');
  }
}

/**
 * Get list of available videos (both structures)
 */
export function getAvailableVideos(): string[] {
  return [...legacyVideos];
}

/**
 * Get info about available loop sets
 */
export function getLoopSetsInfo(): Record<string, number> {
  const info: Record<string, number> = {};
  for (const [name, videos] of loopSets) {
    info[name] = videos.length;
  }
  return info;
}

/**
 * Get list of available special gestures
 */
export function getAvailableSpecialGestures(): string[] {
  return [...specialGestures];
}

/**
 * Get current avatar state for user
 */
export function getAvatarStateForUser(userId: string): AvatarState {
  return getAvatarState(userId);
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
