import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { Readable } from 'stream';
import { pool } from '../db/index.js';
import { gpuOrchestrator } from '../gpu/gpu-orchestrator.service.js';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const OPENAI_API_URL = 'https://api.openai.com/v1';
const FISH_AUDIO_API_URL = 'https://api.fish.audio/v1';

// OpenAI TTS voices
export const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type OpenAIVoice = typeof OPENAI_VOICES[number];

// Orpheus TTS voices
export const ORPHEUS_VOICES = ['tara', 'leah', 'jess', 'leo', 'dan', 'mia', 'zac', 'zoe', 'naomi'] as const;
export type OrpheusVoice = typeof ORPHEUS_VOICES[number];

// TTS Settings interface
export interface TTSSettings {
  engine: 'elevenlabs' | 'openai' | 'orpheus' | 'fish_audio';
  openaiVoice: OpenAIVoice;
  orpheusVoice: OrpheusVoice;
  fishAudioReferenceId?: string;
  fishAudioModel?: 's1' | 's2-pro';
}

// Default TTS settings
const DEFAULT_TTS_SETTINGS: TTSSettings = {
  engine: 'fish_audio',
  openaiVoice: 'nova',
  orpheusVoice: 'zoe',
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
        orpheusVoice: parsed.orpheusVoice || DEFAULT_TTS_SETTINGS.orpheusVoice,
        fishAudioReferenceId: parsed.fishAudioReferenceId,
        fishAudioModel: parsed.fishAudioModel,
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
    orpheusVoice: settings.orpheusVoice || current.orpheusVoice,
    fishAudioReferenceId: settings.fishAudioReferenceId !== undefined ? settings.fishAudioReferenceId : current.fishAudioReferenceId,
    fishAudioModel: settings.fishAudioModel || current.fishAudioModel,
  };

  // Validate OpenAI voice
  if (updated.engine === 'openai' && !OPENAI_VOICES.includes(updated.openaiVoice)) {
    throw new Error(`Invalid OpenAI voice: ${updated.openaiVoice}`);
  }

  // Validate Orpheus voice
  if (updated.engine === 'orpheus' && !ORPHEUS_VOICES.includes(updated.orpheusVoice)) {
    throw new Error(`Invalid Orpheus voice: ${updated.orpheusVoice}`);
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
export async function synthesizeWithOpenAI(text: string, voice: OpenAIVoice): Promise<Buffer> {
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
  const elevenLabsOk = config.elevenlabs?.enabled !== false && !!config.elevenlabs?.apiKey;
  const fishAudioOk = config.fishAudio?.enabled !== false && !!config.fishAudio?.apiKey;
  return elevenLabsOk || fishAudioOk;
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

  if (settings.engine === 'orpheus') {
    return synthesizeWithOrpheus(text, settings.orpheusVoice);
  }

  if (settings.engine === 'fish_audio') {
    return synthesizeWithFishAudio(text, settings.fishAudioReferenceId, settings.fishAudioModel);
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
 * Split text into paragraph-based chunks for streaming TTS.
 * Prioritizes paragraph breaks, then falls back to sentence boundaries.
 */
function splitIntoChunks(text: string, maxChunkLen = 500): string[] {
  // First split by paragraphs (double newline or multiple newlines)
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);

  const chunks: string[] = [];
  Array.from(paragraphs).forEach(para => {
    if (para.length <= maxChunkLen) {
      chunks.push(para);
    } else {
      // Split long paragraphs by sentences
      const sentences = para.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g) || [para];
      let current = '';
      Array.from(sentences).forEach(sentence => {
        if (current.length + sentence.length > maxChunkLen && current.length > 0) {
          chunks.push(current.trim());
          current = sentence;
        } else {
          current += sentence;
        }
      });
      if (current.trim().length > 0) {
        chunks.push(current.trim());
      }
    }
  });
  return chunks;
}

/**
 * Generate audio for a single text chunk via Orpheus
 */
async function generateOrpheusChunk(orpheusUrl: string, text: string, voice: OrpheusVoice): Promise<Buffer> {
  const response = await fetch(`${orpheusUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'orpheus',
      input: text,
      voice,
      response_format: 'wav',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Orpheus TTS API error: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Synthesize speech using Orpheus TTS (local, GPU-accelerated)
 * For short texts, returns a single buffer. For long texts, chunks internally.
 */
async function synthesizeWithOrpheus(text: string, voice: OrpheusVoice = 'tara'): Promise<Buffer> {
  const orpheusUrl = config.orpheus?.url;
  if (!orpheusUrl) {
    throw new Error('Orpheus TTS URL not configured');
  }

  // Ensure GPU is in TTS mode (swaps 3080 from ollama to Orpheus)
  await gpuOrchestrator.ensureOrpheusReady();

  logger.info('Synthesizing speech with Orpheus TTS', {
    textLength: text.length,
    voice,
  });

  try {
    // For short text, single request
    if (text.length <= 2000) {
      const buf = await generateOrpheusChunk(orpheusUrl, text, voice);
      gpuOrchestrator.recordTtsActivity();
      return buf;
    }

    // For long text, chunk and concatenate PCM data
    const chunks = splitIntoChunks(text);
    logger.info('Orpheus TTS: splitting into chunks', { chunks: chunks.length, totalLength: text.length });

    const audioBuffers: Buffer[] = [];
    let wavHeader: Buffer | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const buf = await generateOrpheusChunk(orpheusUrl, chunks[i], voice);
      if (i === 0) {
        // Keep the full first chunk (header + data)
        wavHeader = buf.subarray(0, 44);
        audioBuffers.push(buf.subarray(44));
      } else {
        // Strip WAV header (44 bytes) from subsequent chunks
        audioBuffers.push(buf.subarray(44));
      }
    }

    // Rebuild WAV with correct total size
    const pcmData = Buffer.concat(audioBuffers);
    const totalSize = 44 + pcmData.length;
    const header = Buffer.from(wavHeader!);
    // Update RIFF chunk size (bytes 4-7)
    header.writeUInt32LE(totalSize - 8, 4);
    // Update data chunk size (bytes 40-43)
    header.writeUInt32LE(pcmData.length, 40);

    const result = Buffer.concat([header, pcmData]);
    gpuOrchestrator.recordTtsActivity();
    logger.info('Speech synthesized successfully with Orpheus', {
      audioSize: result.length,
      voice,
      chunks: chunks.length,
    });
    return result;
  } catch (error) {
    logger.error('Orpheus TTS synthesis error', {
      error: (error as Error).message,
      textLength: text.length,
      voice,
    });
    throw error;
  }
}

/**
 * Synthesize speech using Fish Audio TTS API (cloud)
 */
async function synthesizeWithFishAudio(text: string, referenceId?: string, model?: string): Promise<Buffer> {
  const apiKey = config.fishAudio?.apiKey;
  if (!apiKey) {
    throw new Error('Fish Audio API key not configured');
  }

  const fishModel = model || config.fishAudio?.model || 's1';
  const fishRefId = referenceId || config.fishAudio?.referenceId || undefined;

  logger.info('Synthesizing speech with Fish Audio', {
    textLength: text.length,
    model: fishModel,
    referenceId: fishRefId ? `${fishRefId.slice(0, 8)}...` : 'none',
  });

  try {
    const body: Record<string, unknown> = {
      text,
      format: 'mp3',
      mp3_bitrate: 128,
      latency: 'balanced',
      chunk_length: 300,
    };
    if (fishRefId) {
      body.reference_id = fishRefId;
    }

    const response = await fetch(`${FISH_AUDIO_API_URL}/tts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'model': fishModel,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Fish Audio TTS API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`Fish Audio TTS error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info('Speech synthesized successfully with Fish Audio', {
      audioSize: buffer.length,
      model: fishModel,
    });

    return buffer;
  } catch (error) {
    logger.error('Fish Audio TTS synthesis error', {
      error: (error as Error).message,
      textLength: text.length,
    });
    throw error;
  }
}

/**
 * Stream Fish Audio TTS response directly to Express response.
 * Fish Audio returns Transfer-Encoding: chunked natively as audio/mpeg.
 */
export async function streamFishAudioChunked(
  text: string,
  referenceId: string | undefined,
  model: string | undefined,
  res: import('express').Response
): Promise<void> {
  const apiKey = config.fishAudio?.apiKey;
  if (!apiKey) {
    throw new Error('Fish Audio API key not configured');
  }

  const cleanText = stripMarkdown(text);
  const fishModel = model || config.fishAudio?.model || 's1';
  const fishRefId = referenceId || config.fishAudio?.referenceId || undefined;

  logger.info('Streaming Fish Audio TTS', { textLength: cleanText.length, model: fishModel });

  const body: Record<string, unknown> = {
    text: cleanText,
    format: 'mp3',
    mp3_bitrate: 128,
    latency: 'normal',
  };
  if (fishRefId) {
    body.reference_id = fishRefId;
  }

  const response = await fetch(`${FISH_AUDIO_API_URL}/tts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'model': fishModel,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fish Audio stream error: ${response.status} - ${errorText}`);
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = response.body!.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (error) {
    logger.error('Fish Audio stream pipe error', { error: (error as Error).message });
  } finally {
    res.end();
  }
}

/**
 * Strip markdown formatting from text for cleaner TTS output
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\s*/g, '')  // ISO timestamps
    .replace(/```[\s\S]*?```/g, '')        // code blocks
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold
    .replace(/\*([^*]+)\*/g, '$1')         // italic
    .replace(/__([^_]+)__/g, '$1')         // bold alt
    .replace(/_([^_]+)_/g, '$1')           // italic alt
    .replace(/^#{1,6}\s+/gm, '')           // headers
    .replace(/^\s*[-*+]\s+/gm, '')         // list items
    .replace(/^\s*\d+\.\s+/gm, '')         // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/~~([^~]+)~~/g, '$1')         // strikethrough
    .replace(/\n{3,}/g, '\n\n')            // collapse extra newlines
    .trim();
}

/**
 * Stream Orpheus TTS as NDJSON events with base64 audio chunks.
 * Each line: {"chunk": "<base64 wav>", "index": N, "total": M}
 * Splits text by paragraphs so first paragraph plays immediately
 * while remaining paragraphs generate in the background.
 */
export async function streamOrpheusChunked(text: string, voice: OrpheusVoice, res: import('express').Response): Promise<void> {
  const orpheusUrl = config.orpheus?.url;
  if (!orpheusUrl) {
    throw new Error('Orpheus TTS URL not configured');
  }

  // Ensure GPU is in TTS mode (swaps 3080 from ollama to Orpheus)
  await gpuOrchestrator.ensureOrpheusReady();

  const cleanText = stripMarkdown(text);
  const chunks = splitIntoChunks(cleanText);
  const total = chunks.length;

  logger.info('Streaming Orpheus TTS', { chunks: total, textLength: cleanText.length, voice });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  for (let i = 0; i < chunks.length; i++) {
    try {
      const audioBuffer = await generateOrpheusChunk(orpheusUrl, chunks[i], voice);
      gpuOrchestrator.recordTtsActivity();
      const event = JSON.stringify({
        chunk: audioBuffer.toString('base64'),
        index: i,
        total,
      });
      res.write(event + '\n');
      // Flush to ensure nginx/proxy sends immediately
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch (error) {
      logger.error('Orpheus stream chunk error', { index: i, error: (error as Error).message });
      const errorEvent = JSON.stringify({ error: (error as Error).message, index: i, total });
      res.write(errorEvent + '\n');
    }
  }

  res.end();
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
  streamOrpheusChunked,
  streamFishAudioChunked,
  getLunaVoice,
  listVoices,
  isEnabled,
  getTtsSettings,
  updateTtsSettings,
  OPENAI_VOICES,
  ORPHEUS_VOICES,
};
