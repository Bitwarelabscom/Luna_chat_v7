import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import * as voiceChat from '../chat/voice-chat.service.js';
import { synthesizeSpeech } from '../llm/tts.service.js';
import { streamChatCompletion } from '../llm/openai.client.js';
import { logActivityAndBroadcast } from '../activity/activity.service.js';
import { getVoicePrompt } from '../persona/voice.persona.js';

// Configuration
const CHANNELS = 1;
const BIT_DEPTH = 16;
const VAD_THRESHOLD_DB = config.stt.silenceThreshold || -35; // -35dB (normalized)
const VAD_SILENCE_DURATION_MS = config.stt.silenceDuration; // 700ms
const MIN_SPEECH_DURATION_MS = 400; // Minimum speech duration to process (ignore short blips)
const MIN_UTTERANCE_ENERGY_DB = -30; // Minimum average energy for an utterance to be worth transcribing

// Common Whisper hallucination patterns on silence/noise
const WHISPER_HALLUCINATIONS = new Set([
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'subscribe',
  'like and subscribe',
  'you',
  'bye',
  'bye.',
  'the end',
  'the end.',
  'so',
  'oh',
  'hmm',
  'ugh',
  'ah',
  'um',
  'okay',
  'i\'m sorry',
  'i\'m sorry.',
  'thank you for watching',
  'thank you for watching.',
  'please subscribe',
  'subtitles by',
  'translated by',
  'copyright',
  '...',
  '.',
  '',
]);

// VAD State
interface VADState {
  isSpeaking: boolean;
  silenceStart: number | null;
  buffer: Buffer[];
  speechStart: number;
  _lastDbLog?: number;
}

export function handleVoiceWsConnection(ws: WebSocket, req: IncomingMessage) {
  const userId = (req as any).user?.userId;
  let currentSampleRate = 24000; // Connection-local default, updated by client config.
  
  if (!userId) {
    logger.warn('Voice WebSocket connection rejected: Unauthorized');
    ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized - please log in' }));
    ws.close();
    return;
  }

  logger.info('Voice WebSocket connected', { userId });

  const vadState: VADState = {
    isSpeaking: false,
    silenceStart: null,
    buffer: [],
    speechStart: 0,
  };

  // Session ID for conversation history
  let sessionId: string | null = null;
  // Suppress VAD while TTS is playing to prevent feedback loops
  (ws as any)._ttsPlaying = false;

  ws.on('message', async (data, isBinary) => {
    if (!isBinary) {
      // Handle text control messages (auth, config, etc.)
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth') {
           // Handle auth if needed
        } else if (msg.type === 'session') {
           sessionId = msg.sessionId;
        } else if (msg.type === 'config') {
           if (msg.sampleRate) {
             currentSampleRate = msg.sampleRate;
             logger.info('Voice WS: Updated sample rate', { sampleRate: currentSampleRate });
           }
        } else if (msg.type === 'text') {
           if (msg.text) {
             logger.info('Voice WS: Received text message', { text: msg.text });
             processTextCommand(ws, userId || 'anonymous', msg.text, sessionId);
           }
        }
      } catch (e) {
        logger.error('Invalid JSON message', { error: (e as Error).message });
      }
      return;
    }

    // Skip audio processing during TTS playback to prevent feedback loops
    if ((ws as any)._ttsPlaying) return;

    const pcmData = data as Buffer;
    processAudioChunk(ws, userId || 'anonymous', pcmData, vadState, sessionId, currentSampleRate);
  });

  ws.on('close', () => {
    logger.info('Voice WebSocket closed', { userId });
  });

  ws.on('error', (err) => {
    logger.error('Voice WebSocket error', { error: err.message });
  });
}

// Simple Energy-based VAD
async function processAudioChunk(
  ws: WebSocket,
  userId: string,
  chunk: Buffer,
  state: VADState,
  sessionId: string | null,
  sampleRate: number
) {
  // 1. Calculate RMS (normalized to 0.0-1.0 range so dB is negative for quiet audio)
  const rms = calculateRMS(chunk) / 32768;
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;

  // Periodic debug: log dB level every ~2 seconds
  if (!state._lastDbLog || Date.now() - state._lastDbLog > 2000) {
    logger.info('VAD audio level', { db: Math.round(db * 10) / 10, rms: Math.round(rms), threshold: VAD_THRESHOLD_DB, chunkSize: chunk.length, isSpeaking: state.isSpeaking });
    state._lastDbLog = Date.now();
  }

  // 2. State Machine
  if (db > VAD_THRESHOLD_DB) {
    // Speech detected
    if (!state.isSpeaking) {
      state.isSpeaking = true;
      state.speechStart = Date.now();
      logger.info('VAD: Speech started', { db: Math.round(db * 10) / 10 });
    }
    state.silenceStart = null;
    state.buffer.push(chunk);
  } else {
    // Silence
    if (state.isSpeaking) {
      state.buffer.push(chunk); // Keep buffering trailing silence for context
      
      if (!state.silenceStart) {
        state.silenceStart = Date.now();
      }

      const silenceDuration = Date.now() - state.silenceStart;
      if (silenceDuration > VAD_SILENCE_DURATION_MS) {
        // Speech ended
        logger.info('VAD: Speech ended', { duration: Date.now() - state.speechStart });
        state.isSpeaking = false;
        state.silenceStart = null;
        
        // Process the complete utterance
        const audioBuffer = Buffer.concat(state.buffer);
        state.buffer = []; // Clear buffer
        
        // Don't process extremely short blips
        const speechDurationMs = Date.now() - state.speechStart;
        if (speechDurationMs < MIN_SPEECH_DURATION_MS) {
            logger.debug('VAD: Ignoring short blip', { durationMs: speechDurationMs });
            return;
        }

        // Check average energy of the entire utterance - reject if too quiet (likely noise)
        const utteranceRms = calculateRMS(audioBuffer) / 32768;
        const utteranceDb = utteranceRms > 0 ? 20 * Math.log10(utteranceRms) : -100;
        if (utteranceDb < MIN_UTTERANCE_ENERGY_DB) {
            logger.debug('VAD: Ignoring low-energy utterance', { utteranceDb: Math.round(utteranceDb * 10) / 10 });
            return;
        }

        await processUtterance(ws, userId, audioBuffer, sessionId, sampleRate);
      }
    } else {
        // Not speaking, just silence. 
        // We could keep a rolling buffer of silence for "pre-roll" context if needed.
    }
  }
}

function calculateRMS(buffer: Buffer): number {
  let sum = 0;
  // Assuming 16-bit signed integer
  for (let i = 0; i < buffer.length; i += 2) {
    const val = buffer.readInt16LE(i);
    sum += val * val;
  }
  const numSamples = buffer.length / 2;
  return Math.sqrt(sum / numSamples);
}

async function processTextCommand(
  ws: WebSocket,
  userId: string,
  text: string,
  sessionId: string | null
) {
  if (!sessionId) {
    sessionId = await voiceChat.getOrCreateVoiceSession(userId);
  }

  ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

  // Save user message to history
  await voiceChat.addMessage(sessionId, 'user', text);

  // Get history
  const history = await voiceChat.getSessionMessages(sessionId, 6);
  const systemPrompt = getVoicePrompt({});
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: text }
  ];

  let fullResponse = '';
  let sentenceBuffer = '';
  const sentenceEndings = /[.!?。]/;

  try {
      const stream = streamChatCompletion({
          messages,
          model: 'grok-4-1-fast', // Force fast model for voice
          provider: 'xai',
          maxTokens: 300,
          loggingContext: {
            userId,
            sessionId: sessionId || undefined,
            source: 'voice-websocket',
            nodeName: 'voice_ws_text_stream',
          },
      });
      let loggedReasoningVisible = false;

      ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));

      for await (const chunk of stream) {
          if (chunk.type === 'reasoning' && chunk.content) {
              ws.send(JSON.stringify({ type: 'reasoning', content: chunk.content }));
              if (!loggedReasoningVisible) {
                loggedReasoningVisible = true;
                void logActivityAndBroadcast({
                  userId,
                  sessionId: sessionId || undefined,
                  category: 'state_event',
                  eventType: 'thinking_visible',
                  level: 'info',
                  title: 'Thinking view shown',
                  message: 'Reasoning stream displayed in voice mode',
                  details: {
                    mode: 'voice',
                    sourceType: 'text_command',
                  },
                  source: 'voice-stream',
                }).catch((activityError) => {
                  logger.warn('Failed to log thinking visibility activity', {
                    error: (activityError as Error).message,
                    sessionId,
                  });
                });
              }
          } else if (chunk.type === 'content' && chunk.content) {
              const content = chunk.content;
              fullResponse += content;
              sentenceBuffer += content;

              // Check for sentence completion
              if (sentenceEndings.test(content) || sentenceBuffer.length > 100) {
                 const sentenceToSpeak = sentenceBuffer.trim();
                 sentenceBuffer = '';
                 if (sentenceToSpeak) {
                    await streamTTS(ws, sentenceToSpeak);
                 }
              }
              
              ws.send(JSON.stringify({ type: 'text_delta', delta: content }));
          }
      }

      if (sentenceBuffer.trim()) {
          await streamTTS(ws, sentenceBuffer.trim());
      }

      ws.send(JSON.stringify({ type: 'text_done' }));
      clearTtsFlag(ws);
      await voiceChat.addMessage(sessionId, 'assistant', fullResponse);
  } catch (error) {
     (ws as any)._ttsPlaying = false;
     logger.error('Text command processing failed', { error: (error as Error).message });
     ws.send(JSON.stringify({ type: 'error', error: 'Thinking failed' }));
  }
}

async function processUtterance(
  ws: WebSocket, 
  userId: string, 
  pcmBuffer: Buffer,
  sessionId: string | null,
  sampleRate: number
) {
  if (!sessionId) {
     sessionId = await voiceChat.getOrCreateVoiceSession(userId);
  }

  // 1. Transcribe (Whisper)
  // Wrap in WAV
  const wavBuffer = createWavHeader(pcmBuffer, sampleRate);
  const file = new File([wavBuffer], 'input.wav', { type: 'audio/wav' });

  // Inform client: Thinking
  ws.send(JSON.stringify({ type: 'status', status: 'transcribing' }));

  let transcript = '';
  try {
    const sttClient = config.stt.baseUrl
      ? new OpenAI({ apiKey: 'not-needed', baseURL: config.stt.baseUrl })
      : new OpenAI({ apiKey: config.openai.apiKey });
    const response = await sttClient.audio.transcriptions.create({
      file: file,
      model: config.stt.model,
      language: config.stt.language,
    });
    transcript = response.text.trim();
  } catch (err) {
    logger.error('STT Failed', { error: (err as Error).message });
    ws.send(JSON.stringify({ type: 'error', error: 'Transcription failed' }));
    return;
  }

  if (!transcript) return;

  // Filter Whisper hallucinations (common phantom outputs on noise/silence)
  const normalizedTranscript = transcript.toLowerCase().replace(/[^\w\s']/g, '').trim();
  if (WHISPER_HALLUCINATIONS.has(normalizedTranscript) || normalizedTranscript.length < 2) {
    logger.info('STT: Filtered likely hallucination', { transcript, normalized: normalizedTranscript });
    return;
  }

  logger.info('STT Transcript', { transcript });
  ws.send(JSON.stringify({ type: 'transcript', text: transcript }));
  ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

  // Save user transcript to history
  await voiceChat.addMessage(sessionId, 'user', transcript);

  // 2. Chat (Streaming)
  // We need to bypass processMessage for streaming, but use its logic manually
  // Or better, use a simplified streaming chat flow
  
  // Get history
  const history = await voiceChat.getSessionMessages(sessionId, 6);
  const systemPrompt = getVoicePrompt({});
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: transcript }
  ];

  let fullResponse = '';
  let sentenceBuffer = '';
  const sentenceEndings = /[.!?。]/;

  try {
      const stream = streamChatCompletion({
          messages,
          model: 'grok-4-1-fast', // Force fast model for voice
          provider: 'xai',
          maxTokens: 300,
          loggingContext: {
            userId,
            sessionId: sessionId || undefined,
            source: 'voice-websocket',
            nodeName: 'voice_ws_audio_stream',
          },
      });
      let loggedReasoningVisible = false;

      ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));

      for await (const chunk of stream) {
          if (chunk.type === 'reasoning' && chunk.content) {
              ws.send(JSON.stringify({ type: 'reasoning', content: chunk.content }));
              if (!loggedReasoningVisible) {
                loggedReasoningVisible = true;
                void logActivityAndBroadcast({
                  userId,
                  sessionId: sessionId || undefined,
                  category: 'state_event',
                  eventType: 'thinking_visible',
                  level: 'info',
                  title: 'Thinking view shown',
                  message: 'Reasoning stream displayed in voice mode',
                  details: {
                    mode: 'voice',
                    sourceType: 'utterance',
                  },
                  source: 'voice-stream',
                }).catch((activityError) => {
                  logger.warn('Failed to log thinking visibility activity', {
                    error: (activityError as Error).message,
                    sessionId,
                  });
                });
              }
          } else if (chunk.type === 'content' && chunk.content) {
              const content = chunk.content;
              fullResponse += content;
              sentenceBuffer += content;

              // Check for sentence completion
              if (sentenceEndings.test(content) || sentenceBuffer.length > 100) {
                 // Send sentence to TTS
                 const sentenceToSpeak = sentenceBuffer.trim();
                 sentenceBuffer = '';
                 
                 if (sentenceToSpeak) {
                    await streamTTS(ws, sentenceToSpeak);
                 }
              }
              
              // Send text chunk to client
              ws.send(JSON.stringify({ type: 'text_delta', delta: content }));
          }
      }

      // Flush remaining buffer
      if (sentenceBuffer.trim()) {
          await streamTTS(ws, sentenceBuffer.trim());
      }

      ws.send(JSON.stringify({ type: 'text_done' }));
      clearTtsFlag(ws);

      // Save to history
      await voiceChat.addMessage(sessionId, 'assistant', fullResponse);

  } catch (error) {
     (ws as any)._ttsPlaying = false;
     logger.error('Chat Streaming Failed', { error: (error as Error).message });
     ws.send(JSON.stringify({ type: 'error', error: 'Thinking failed' }));
  }
}

async function streamTTS(ws: WebSocket, text: string) {
    try {
        (ws as any)._ttsPlaying = true;
        const audioBuffer = await synthesizeSpeech({ text });
        // Send audio chunk
        ws.send(JSON.stringify({ type: 'audio_start' }));
        ws.send(audioBuffer);
        ws.send(JSON.stringify({ type: 'audio_end' }));
    } catch (e) {
        logger.error('TTS Failed', { error: (e as Error).message });
    }
}

// Clear TTS flag with a cooldown after playback to let echo fade
function clearTtsFlag(ws: WebSocket) {
    setTimeout(() => {
        (ws as any)._ttsPlaying = false;
    }, 2500);
}

function createWavHeader(pcmData: Buffer, sampleRate: number): Buffer {
    const numChannels = CHANNELS;
    const bitsPerSample = BIT_DEPTH;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
  
    const header = Buffer.alloc(headerSize);
  
    // RIFF chunk
    header.write('RIFF', 0);
    header.writeUInt32LE(totalSize - 8, 4);
    header.write('WAVE', 8);
  
    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
  
    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
  
    return Buffer.concat([header, pcmData]);
  }
