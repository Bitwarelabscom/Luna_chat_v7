import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// TTS voice options
export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

// Get OpenAI client for TTS
let ttsClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!ttsClient) {
    ttsClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return ttsClient;
}

export interface TTSOptions {
  text: string;
  voice?: TTSVoice;
  speed?: number; // 0.25 to 4.0
}

/**
 * Synthesize text to speech using OpenAI's gpt-4o-mini-tts model
 * Returns a Buffer containing MP3 audio data
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<Buffer> {
  const {
    text,
    voice = 'nova', // Luna's default voice - warm and friendly
    speed = 1.0,
  } = options;

  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  // Limit text length for TTS (OpenAI has a 4096 character limit)
  const maxLength = 4096;
  const truncatedText = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

  logger.info('Synthesizing speech', {
    textLength: truncatedText.length,
    voice,
    speed,
  });

  try {
    const client = getClient();

    const response = await client.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice,
      input: truncatedText,
      speed,
      response_format: 'mp3',
    });

    // Get the audio data as a buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info('Speech synthesized successfully', {
      audioSize: buffer.length,
      voice,
    });

    return buffer;
  } catch (error) {
    logger.error('TTS synthesis error', {
      error: (error as Error).message,
      textLength: truncatedText.length,
      voice,
    });
    throw error;
  }
}

/**
 * Get the Luna voice based on session mode
 */
export function getLunaVoice(_mode: 'assistant' | 'companion' = 'assistant'): TTSVoice {
  // Luna uses 'nova' for both modes - warm, friendly, and clear
  // This matches her persona of being approachable yet professional
  return 'nova';
}

export default {
  synthesizeSpeech,
  getLunaVoice,
};
