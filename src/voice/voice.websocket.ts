import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import * as voiceChat from '../chat/voice-chat.service.js';
import { synthesizeWithOpenAI } from '../llm/tts.service.js';
import { streamChatCompletion } from '../llm/openai.client.js';
import { logActivityAndBroadcast } from '../activity/activity.service.js';
import { getVoicePrompt } from '../persona/voice.persona.js';

// Configuration
let currentSampleRate = 24000; // Default, can be updated by client
const CHANNELS = 1;
const BIT_DEPTH = 16;
const VAD_THRESHOLD_DB = config.stt.silenceThreshold; // -50dB
const VAD_SILENCE_DURATION_MS = config.stt.silenceDuration; // 700ms

// VAD State
interface VADState {
  isSpeaking: boolean;
  silenceStart: number | null;
  buffer: Buffer[];
  speechStart: number;
}

export function handleVoiceWsConnection(ws: WebSocket, req: IncomingMessage) {
  const userId = (req as any).user?.userId;
  
  if (!userId) {
    logger.warn('Voice WebSocket connection rejected: Unauthorized');
    ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized - please log in' }));
    ws.close();
    return;
  }

  logger.info('Voice WebSocket connected', { userId });

  let vadState: VADState = {
    isSpeaking: false,
    silenceStart: null,
    buffer: [],
    speechStart: 0,
  };

  // Session ID for conversation history
  let sessionId: string | null = null;

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

    const pcmData = data as Buffer;
    processAudioChunk(ws, userId || 'anonymous', pcmData, vadState, sessionId);
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
  sessionId: string | null
) {
  // 1. Calculate RMS
  const rms = calculateRMS(chunk);
  const db = 20 * Math.log10(rms);

  // 2. State Machine
  if (db > VAD_THRESHOLD_DB) {
    // Speech detected
    if (!state.isSpeaking) {
      state.isSpeaking = true;
      state.speechStart = Date.now();
      logger.debug('VAD: Speech started');
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
        logger.debug('VAD: Speech ended', { duration: Date.now() - state.speechStart });
        state.isSpeaking = false;
        state.silenceStart = null;
        
        // Process the complete utterance
        const audioBuffer = Buffer.concat(state.buffer);
        state.buffer = []; // Clear buffer
        
        // Don't process extremely short blips (< 200ms)
        if (audioBuffer.length < currentSampleRate * 2 * 0.2) { 
            return; 
        }

        await processUtterance(ws, userId, audioBuffer, sessionId);
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
          model: 'gpt-4o', // Force fast model for voice
          provider: 'openai',
          maxTokens: 300
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
          streamTTS(ws, sentenceBuffer.trim());
      }
      
      ws.send(JSON.stringify({ type: 'text_done' }));
      await voiceChat.addMessage(sessionId, 'assistant', fullResponse);
  } catch (error) {
     logger.error('Text command processing failed', { error: (error as Error).message });
     ws.send(JSON.stringify({ type: 'error', error: 'Thinking failed' }));
  }
}

async function processUtterance(
  ws: WebSocket, 
  userId: string, 
  pcmBuffer: Buffer,
  sessionId: string | null
) {
  if (!sessionId) {
     sessionId = await voiceChat.getOrCreateVoiceSession(userId);
  }

  // 1. Transcribe (Whisper)
  // Wrap in WAV
  const wavBuffer = createWavHeader(pcmBuffer, currentSampleRate);
  const file = new File([wavBuffer], 'input.wav', { type: 'audio/wav' });

  // Inform client: Thinking
  ws.send(JSON.stringify({ type: 'status', status: 'transcribing' }));

  let transcript = '';
  try {
    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    // Use configured STT model (Whisper)
    const response = await openai.audio.transcriptions.create({
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
          model: 'gpt-4o', // Force fast model for voice
          provider: 'openai',
          maxTokens: 300
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

      // Save to history
      await voiceChat.addMessage(sessionId, 'assistant', fullResponse);

  } catch (error) {
     logger.error('Chat Streaming Failed', { error: (error as Error).message });
     ws.send(JSON.stringify({ type: 'error', error: 'Thinking failed' }));
  }
}

async function streamTTS(ws: WebSocket, text: string) {
    try {
        const audioBuffer = await synthesizeWithOpenAI(text, 'nova'); // Default voice
        // Send audio chunk
        ws.send(JSON.stringify({ type: 'audio_start' })); 
        ws.send(audioBuffer); 
        ws.send(JSON.stringify({ type: 'audio_end' }));
    } catch (e) {
        logger.error('TTS Failed', { error: (e as Error).message });
    }
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
