import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { Readable } from 'stream';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Voice settings for Luna - optimized for v3 emotional expression
// v3 stability must be: 0.0 (Creative), 0.5 (Natural), or 1.0 (Robust)
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.0,           // Creative mode - most expressive for audio tags
  similarity_boost: 0.75,   // Higher = closer to original voice
  style: 0.5,               // Higher style for better emotion tag interpretation
  use_speaker_boost: true,  // Enhanced clarity
};

export interface TTSOptions {
  text: string;
  voiceId?: string;
  model?: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

export interface TTSStreamOptions extends TTSOptions {
  outputFormat?: string;  // mp3_44100_128, pcm_16000, etc.
}

/**
 * Get the ElevenLabs API key from config
 */
function getApiKey(): string {
  const apiKey = config.elevenlabs?.apiKey;
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  return apiKey;
}

/**
 * Get the default voice ID from config
 */
function getDefaultVoiceId(): string {
  return config.elevenlabs?.voiceId || '21m00Tcm4TlvDq8ikWAM';  // Rachel
}

/**
 * Get the default model from config
 */
function getDefaultModel(): string {
  return config.elevenlabs?.model || 'eleven_v3';
}

/**
 * Check if ElevenLabs is enabled
 */
export function isEnabled(): boolean {
  return config.elevenlabs?.enabled !== false && !!config.elevenlabs?.apiKey;
}

/**
 * Synthesize text to speech using ElevenLabs API
 * Returns a Buffer containing audio data (MP3 by default)
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<Buffer> {
  const {
    text,
    voiceId = getDefaultVoiceId(),
    model = getDefaultModel(),
    voiceSettings = DEFAULT_VOICE_SETTINGS,
  } = options;

  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  // ElevenLabs v3 has a 5,000 character limit (multilingual_v2 has 10,000)
  const maxLength = 5000;
  const truncatedText = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

  logger.info('Synthesizing speech with ElevenLabs', {
    textLength: truncatedText.length,
    voiceId,
    model,
  });

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': getApiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: truncatedText,
          model_id: model,
          voice_settings: {
            stability: voiceSettings.stability ?? DEFAULT_VOICE_SETTINGS.stability,
            similarity_boost: voiceSettings.similarity_boost ?? DEFAULT_VOICE_SETTINGS.similarity_boost,
            style: voiceSettings.style ?? DEFAULT_VOICE_SETTINGS.style,
            use_speaker_boost: voiceSettings.use_speaker_boost ?? DEFAULT_VOICE_SETTINGS.use_speaker_boost,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ElevenLabs API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info('Speech synthesized successfully', {
      audioSize: buffer.length,
      voiceId,
      model,
    });

    return buffer;
  } catch (error) {
    logger.error('TTS synthesis error', {
      error: (error as Error).message,
      textLength: truncatedText.length,
      voiceId,
    });
    throw error;
  }
}

/**
 * Stream speech synthesis using ElevenLabs streaming API
 * Returns a ReadableStream for real-time audio playback
 */
export async function streamSpeech(options: TTSStreamOptions): Promise<Readable> {
  const {
    text,
    voiceId = getDefaultVoiceId(),
    model = getDefaultModel(),
    voiceSettings = DEFAULT_VOICE_SETTINGS,
    outputFormat = 'mp3_44100_128',
  } = options;

  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  const maxLength = 5000;
  const truncatedText = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

  logger.info('Starting speech stream with ElevenLabs', {
    textLength: truncatedText.length,
    voiceId,
    model,
    outputFormat,
  });

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': getApiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: truncatedText,
          model_id: model,
          voice_settings: {
            stability: voiceSettings.stability ?? DEFAULT_VOICE_SETTINGS.stability,
            similarity_boost: voiceSettings.similarity_boost ?? DEFAULT_VOICE_SETTINGS.similarity_boost,
            style: voiceSettings.style ?? DEFAULT_VOICE_SETTINGS.style,
            use_speaker_boost: voiceSettings.use_speaker_boost ?? DEFAULT_VOICE_SETTINGS.use_speaker_boost,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ElevenLabs streaming API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from ElevenLabs streaming API');
    }

    // Convert web ReadableStream to Node.js Readable
    const webStream = response.body;
    const reader = webStream.getReader();

    const nodeStream = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
            logger.info('Speech stream completed', { voiceId, model });
          } else {
            this.push(Buffer.from(value));
          }
        } catch (error) {
          logger.error('Stream read error', { error: (error as Error).message });
          this.destroy(error as Error);
        }
      },
    });

    return nodeStream;
  } catch (error) {
    logger.error('TTS streaming error', {
      error: (error as Error).message,
      textLength: truncatedText.length,
      voiceId,
    });
    throw error;
  }
}

/**
 * Get the Luna voice ID based on session mode
 */
export function getLunaVoice(_mode: 'assistant' | 'companion' | 'voice' = 'assistant'): string {
  // Return the configured voice ID for Luna
  return getDefaultVoiceId();
}

/**
 * List available voices from ElevenLabs (optional utility)
 */
export async function listVoices(): Promise<Array<{ voice_id: string; name: string; category: string }>> {
  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        'xi-api-key': getApiKey(),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    const data = await response.json() as { voices: Array<{ voice_id: string; name: string; category: string }> };
    return data.voices;
  } catch (error) {
    logger.error('Failed to list ElevenLabs voices', { error: (error as Error).message });
    throw error;
  }
}

export default {
  synthesizeSpeech,
  streamSpeech,
  getLunaVoice,
  listVoices,
  isEnabled,
};
