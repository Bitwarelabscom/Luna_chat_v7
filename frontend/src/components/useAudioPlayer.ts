'use client';

import { useState, useRef, useCallback } from 'react';
import { synthesizeSpeech } from '@/lib/api';

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentMessageId: string | null;
}

export function useAudioPlayer() {
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    isLoading: false,
    error: null,
    currentMessageId: null,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setState({ isPlaying: false, isLoading: false, error: null, currentMessageId: null });
  }, []);

  const play = useCallback(async (messageId: string, text: string) => {
    // If already playing this message, toggle off
    if (state.currentMessageId === messageId && state.isPlaying) {
      stop();
      return;
    }

    // Stop any current playback first
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    setState({ isPlaying: false, isLoading: true, error: null, currentMessageId: messageId });

    try {
      // Get audio from TTS API
      console.log('TTS: Fetching audio for text length:', text.length);
      const audioBlob = await synthesizeSpeech(text);
      console.log('TTS: Got audio blob, size:', audioBlob.size, 'type:', audioBlob.type);

      // Create audio element
      const audioUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = audioUrl;
      console.log('TTS: Created object URL:', audioUrl);

      const audio = new Audio();
      audioRef.current = audio;

      // Set up event handlers before setting src
      audio.onended = () => {
        console.log('TTS: Audio playback ended');
        setState({ isPlaying: false, isLoading: false, error: null, currentMessageId: null });
      };

      audio.onerror = (e) => {
        console.error('TTS: Audio playback error:', e, audio.error);
        setState({ isPlaying: false, isLoading: false, error: 'Failed to play audio', currentMessageId: null });
      };

      audio.oncanplaythrough = () => {
        console.log('TTS: Audio can play through');
      };

      // Set source and load
      audio.src = audioUrl;
      audio.load();

      // Wait for audio to be ready, then play
      await new Promise<void>((resolve, reject) => {
        audio.oncanplay = () => resolve();
        audio.onerror = () => reject(new Error('Failed to load audio'));
        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Audio load timeout')), 10000);
      });

      console.log('TTS: Audio loaded, attempting to play...');
      await audio.play();
      console.log('TTS: Audio playing');
      setState({ isPlaying: true, isLoading: false, error: null, currentMessageId: messageId });
    } catch (err) {
      console.error('TTS: Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to synthesize speech';
      setState({ isPlaying: false, isLoading: false, error: errorMessage, currentMessageId: null });
      // Clean up on error
      if (audioRef.current) {
        audioRef.current.src = '';
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    }
  }, [state.currentMessageId, state.isPlaying, stop]);

  return {
    ...state,
    play,
    stop,
  };
}
