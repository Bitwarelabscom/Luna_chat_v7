'use client';

import { useState, useRef, useCallback } from 'react';
import { synthesizeSpeech } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || '';

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentMessageId: string | null;
}

/**
 * Decode base64 WAV chunks and queue them for sequential playback.
 * Starts playing the first chunk immediately while remaining chunks generate.
 */
async function playStreamedChunks(
  text: string,
  onStart: () => void,
  onEnd: () => void,
  onError: (err: string) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'TTS failed' }));
    throw new Error(error.error || 'TTS failed');
  }

  const contentType = response.headers.get('content-type') || '';

  // If not NDJSON, it's a single audio file - play directly
  if (!contentType.includes('ndjson')) {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    try {
      onStart();
      await playAudioUrl(url, abortSignal);
    } finally {
      URL.revokeObjectURL(url);
      onEnd();
    }
    return;
  }

  // NDJSON streaming - read chunks and queue playback
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const audioQueue: string[] = []; // base64 wav chunks
  let playing = false;
  let allReceived = false;
  let started = false;

  async function playNext(): Promise<void> {
    if (playing || audioQueue.length === 0) return;
    playing = true;

    while (audioQueue.length > 0) {
      if (abortSignal.aborted) return;
      const b64 = audioQueue.shift()!;
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      try {
        if (!started) {
          started = true;
          onStart();
        }
        await playAudioUrl(url, abortSignal);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    playing = false;
    if (allReceived && audioQueue.length === 0) {
      onEnd();
    }
  }

  // Read NDJSON stream
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.error) {
          onError(`Chunk ${event.index} failed: ${event.error}`);
          continue;
        }
        if (event.chunk) {
          audioQueue.push(event.chunk);
          // Start playing as soon as first chunk arrives
          playNext();
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  allReceived = true;
  // Play any remaining queued chunks
  if (audioQueue.length > 0) {
    await playNext();
  } else if (!playing) {
    onEnd();
  }

  // Wait for playback to finish
  while (playing) {
    await new Promise(r => setTimeout(r, 100));
  }
}

function playAudioUrl(url: string, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.src = url;

    const cleanup = () => {
      audio.pause();
      audio.src = '';
      resolve();
    };

    if (abortSignal.aborted) {
      resolve();
      return;
    }
    abortSignal.addEventListener('abort', cleanup, { once: true });

    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Audio playback failed'));
    audio.oncanplay = () => audio.play().catch(reject);
    audio.load();

    // Safety timeout per chunk (60s)
    setTimeout(() => cleanup(), 60000);
  });
}

export function useAudioPlayer() {
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    isLoading: false,
    error: null,
    currentMessageId: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState({ isPlaying: false, isLoading: false, error: null, currentMessageId: null });
  }, []);

  const play = useCallback(async (messageId: string, text: string) => {
    // If already playing this message, toggle off
    if (state.currentMessageId === messageId && (state.isPlaying || state.isLoading)) {
      stop();
      return;
    }

    // Stop any current playback
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setState({ isPlaying: false, isLoading: true, error: null, currentMessageId: messageId });

    try {
      await playStreamedChunks(
        text,
        () => setState({ isPlaying: true, isLoading: false, error: null, currentMessageId: messageId }),
        () => setState({ isPlaying: false, isLoading: false, error: null, currentMessageId: null }),
        (err) => console.warn('TTS chunk error:', err),
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('TTS error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to synthesize speech';
      setState({ isPlaying: false, isLoading: false, error: errorMessage, currentMessageId: null });
    }
  }, [state.currentMessageId, state.isPlaying, state.isLoading, stop]);

  return {
    ...state,
    play,
    stop,
  };
}
