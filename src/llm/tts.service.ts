import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { Readable } from 'stream';
import { pool } from '../db/index.js';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const OPENAI_API_URL = 'https://api.openai.com/v1';

// OpenAI TTS voices
export const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type OpenAIVoice = typeof OPENAI_VOICES[number];

// TTS Settings interface
export interface TTSSettings {
  engine: 'elevenlabs' | 'openai';
  openaiVoice: OpenAIVoice;
}

// Default TTS settings
const DEFAULT_TTS_SETTINGS: TTSSettings = {
  engine: 'elevenlabs',
  openaiVoice: 'nova',
};

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
 * Get TTS settings from database
 */
export async function getTtsSettings(): Promise<TTSSettings> {
  try {
    const result = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'tts_settings'`
    );
    if (result.rows.length > 0) {
      // Value is already parsed by PostgreSQL (jsonb column)
      const parsed = result.rows[0].value;
      return {
        engine: parsed.engine || DEFAULT_TTS_SETTINGS.engine,
        openaiVoice: parsed.openaiVoice || DEFAULT_TTS_SETTINGS.openaiVoice,
      };
    }
  } catch (error) {
    logger.warn('Failed to get TTS settings, using defaults', {
      error: (error as Error).message,
    });
  }
  return DEFAULT_TTS_SETTINGS;
}

/**
 * Update TTS settings in database
 */
export async function updateTtsSettings(settings: Partial<TTSSettings>): Promise<TTSSettings> {
  const current = await getTtsSettings();
  const updated: TTSSettings = {
    engine: settings.engine || current.engine,
    openaiVoice: settings.openaiVoice || current.openaiVoice,
  };

  // Validate OpenAI voice
  if (updated.engine === 'openai' && !OPENAI_VOICES.includes(updated.openaiVoice)) {
    throw new Error(`Invalid OpenAI voice: ${updated.openaiVoice}`);
  }

  await pool.query(
    `INSERT INTO system_settings (key, value)
     VALUES ('tts_settings', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(updated)]
  );

  logger.info('TTS settings updated', updated);
  return updated;
}

/**
 * Synthesize speech using OpenAI TTS API
 */
async function synthesizeWithOpenAI(text: string, voice: OpenAIVoice): Promise<Buffer> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // OpenAI TTS has a 4096 character limit
  const maxLength = 4096;
  const truncatedText = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

  logger.info('Synthesizing speech with OpenAI TTS', {
    textLength: truncatedText.length,
    voice,
  });

  try {
    const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: truncatedText,
        voice: voice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI TTS API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info('Speech synthesized successfully with OpenAI', {
      audioSize: buffer.length,
      voice,
    });

    return buffer;
  } catch (error) {
    logger.error('OpenAI TTS synthesis error', {
      error: (error as Error).message,
      textLength: truncatedText.length,
      voice,
    });
    throw error;
  }
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
 * Synthesize text to speech using configured TTS engine
 * Routes to ElevenLabs or OpenAI based on settings
 * Returns a Buffer containing audio data (MP3)
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<Buffer> {
  const { text } = options;

  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  // Get current TTS settings
  const settings = await getTtsSettings();

  // Route to appropriate engine
  if (settings.engine === 'openai') {
    return synthesizeWithOpenAI(text, settings.openaiVoice);
  }

  // Default to ElevenLabs
  return synthesizeWithElevenLabs(options);
}

/**
 * Synthesize speech using ElevenLabs API
 */
async function synthesizeWithElevenLabs(options: TTSOptions): Promise<Buffer> {
  const {
    text,
    voiceId = getDefaultVoiceId(),
    model = getDefaultModel(),
    voiceSettings = DEFAULT_VOICE_SETTINGS,
  } = options;

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
      textLength: text.length,
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
  getTtsSettings,
  updateTtsSettings,
  OPENAI_VOICES,
};
