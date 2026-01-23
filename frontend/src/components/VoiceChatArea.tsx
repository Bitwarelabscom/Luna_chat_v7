'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/lib/store';
import { voiceApi, synthesizeSpeech } from '@/lib/api';
import { Send, Mic, MicOff, Volume2, VolumeX, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useSpeechToText } from './useSpeechToText';
import LunaAvatar from './LunaAvatar';

export default function VoiceChatArea() {
  const {
    currentSession,
    isSending,
    streamingContent,
    statusMessage,
    addUserMessage,
    addAssistantMessage,
    setIsSending,
    setStreamingContent,
    setStatusMessage,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speechToText = useSpeechToText();

  // Initialize voice session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const { sessionId } = await voiceApi.createSession();
        setVoiceSessionId(sessionId);
      } catch (error) {
        console.error('Failed to initialize voice session:', error);
      }
    };
    initSession();
  }, []);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Handle speech-to-text transcript
  useEffect(() => {
    if (speechToText.transcript) {
      setInput(speechToText.transcript);
    }
  }, [speechToText.transcript]);

  // Auto-submit when speech recognition ends with transcript
  useEffect(() => {
    if (!speechToText.isListening && speechToText.transcript && !isSending) {
      const timer = setTimeout(() => {
        handleSend();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [speechToText.isListening, speechToText.transcript]);

  const playAudio = useCallback(async (text: string) => {
    if (!autoPlayEnabled) return;

    const contentCheck = text.replace(/\[.*?\]/g, '').trim();
    if (!contentCheck) return;

    setIsLoadingAudio(true);
    try {
      const audioBlob = await synthesizeSpeech(text);
      const audioUrl = URL.createObjectURL(audioBlob);

      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('Failed to play audio:', error);
      setIsSpeaking(false);
    } finally {
      setIsLoadingAudio(false);
    }
  }, [autoPlayEnabled]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || isSending) return;

    setInput('');
    speechToText.resetTranscript();

    let sessionId = voiceSessionId;

    // Create a voice session if one doesn't exist
    if (!sessionId) {
      try {
        const { sessionId: newSessionId } = await voiceApi.createSession();
        sessionId = newSessionId;
        setVoiceSessionId(newSessionId);
      } catch (error) {
        console.error('Failed to create voice session:', error);
        return;
      }
    }

    addUserMessage(message);
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('Thinking...');

    try {
      // Use fast voice API - no streaming, direct response
      const response = await voiceApi.sendMessage(sessionId, message);

      // Add the assistant response
      addAssistantMessage(response.content, response.messageId);
      setStreamingContent('');
      setStatusMessage('');

      // Play the audio response
      playAudio(response.content);
    } catch (error) {
      console.error('Failed to send message:', error);

      // Determine user-friendly error message based on error response
      let errorMessage = 'Sorry, I had trouble processing that. Could you try again?';

      if (error instanceof Error) {
        // Check if error has code property (from ApiError)
        const anyError = error as { code?: string; status?: number };
        const errorCode = anyError.code;
        const status = anyError.status;

        if (errorCode === 'MODEL_ERROR') {
          errorMessage = 'I had trouble thinking about that. Let me try again in a moment.';
        } else if (errorCode === 'TOOL_ERROR') {
          errorMessage = 'I had trouble performing that action. Could you rephrase your request?';
        } else if (errorCode === 'TIMEOUT_ERROR') {
          errorMessage = 'That took too long. Could you try a simpler question?';
        } else if (errorCode === 'DATABASE_ERROR') {
          errorMessage = 'I had trouble accessing my memory. Please try again.';
        } else if (status === 401 || error.message.includes('unauthorized')) {
          errorMessage = 'Your session has expired. Please refresh the page and log in again.';
        } else if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
          errorMessage = 'I lost connection. Please check your internet and try again.';
        }
      }

      addAssistantMessage(errorMessage, `error-${Date.now()}`);
    } finally {
      setIsSending(false);
      setStatusMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleMicrophone = () => {
    if (speechToText.isListening) {
      speechToText.stopListening();
    } else {
      speechToText.startListening();
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsSpeaking(false);
    }
  };

  const messages = currentSession?.messages || [];
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');

  const stripEmotionTags = (text: string) => {
    return text.replace(/\[.*?\]/g, '').trim();
  };

  // Get the display text - streaming, last message, or welcome
  const getDisplayText = () => {
    if (streamingContent) {
      return stripEmotionTags(streamingContent);
    }
    if (lastAssistantMessage) {
      return stripEmotionTags(lastAssistantMessage.content);
    }
    return null;
  };

  const displayText = getDisplayText();

  return (
    <main className="h-full w-full flex flex-col bg-black overflow-hidden relative">
      {/* Ambient background glow */}
      <div
        className={clsx(
          'absolute inset-0 transition-opacity duration-1000',
          isSpeaking ? 'opacity-100' : 'opacity-30'
        )}
        style={{
          background: 'radial-gradient(ellipse at center top, rgba(74, 222, 128, 0.15) 0%, transparent 50%)',
        }}
      />

      {/* Fixed top section - Luna Avatar */}
      <div className="relative z-10 flex-shrink-0 pt-6 pb-4 flex flex-col items-center">
        {/* Video Avatar with loop cycling */}
        <LunaAvatar
          isSpeaking={isSpeaking}
          size="lg"
        />

        {/* Name and status */}
        <h2 className="mt-6 text-2xl font-light text-white tracking-wide">Luna</h2>
        <div className="flex items-center gap-2 mt-1">
          {isSpeaking ? (
            <span className="flex items-center gap-2 text-green-400 text-sm">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              Speaking
            </span>
          ) : isLoadingAudio ? (
            <span className="text-gray-400 text-sm">Preparing audio...</span>
          ) : isSending ? (
            <span className="text-gray-400 text-sm">{statusMessage || 'Thinking...'}</span>
          ) : (
            <span className="text-gray-500 text-sm">Voice Mode</span>
          )}
        </div>

        {/* Audio controls */}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setAutoPlayEnabled(!autoPlayEnabled)}
            className={clsx(
              'p-2.5 rounded-full transition-all',
              autoPlayEnabled
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
            )}
            title={autoPlayEnabled ? 'Disable auto-play' : 'Enable auto-play'}
          >
            {autoPlayEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          {isSpeaking && (
            <button
              onClick={stopAudio}
              className="px-4 py-2 text-sm bg-gray-800 text-gray-300 rounded-full hover:bg-gray-700 transition"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Middle section - Luna's response text */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 overflow-y-auto">
        <div className="max-w-2xl w-full text-center py-4">
          {isSending && !streamingContent ? (
            <div className="flex justify-center">
              <div className="flex gap-2">
                <span className="w-3 h-3 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-3 h-3 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-3 h-3 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          ) : displayText ? (
            <p
              className={clsx(
                'text-base md:text-lg lg:text-xl font-light leading-relaxed transition-all duration-300',
                isSpeaking ? 'text-white' : 'text-gray-300'
              )}
            >
              {displayText}
            </p>
          ) : (
            <p className="text-lg text-gray-600 font-light">
              Tap the microphone or type to start talking with Luna
            </p>
          )}
        </div>
      </div>

      {/* Bottom section - User input */}
      <div className="relative z-10 flex-shrink-0 p-4 pb-6">
        <div className="max-w-xl mx-auto">
          {/* Speech-to-text interim display */}
          {speechToText.isListening && speechToText.interimTranscript && (
            <div className="mb-4 px-4 py-3 bg-gray-900/80 rounded-2xl border border-gray-700">
              <p className="text-gray-400 italic text-center">
                {speechToText.interimTranscript}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            {/* Microphone button */}
            {speechToText.isSupported && (
              <button
                onClick={toggleMicrophone}
                disabled={isSending}
                className={clsx(
                  'p-4 rounded-full transition-all',
                  speechToText.isListening
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/50 scale-110'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                )}
                title={speechToText.isListening ? 'Stop listening' : 'Start voice input'}
              >
                {speechToText.isListening ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </button>
            )}

            {/* Text input */}
            <div className="flex-1 flex items-center bg-gray-900/80 rounded-full border border-gray-700 focus-within:border-gray-500 transition">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={speechToText.isListening ? 'Listening...' : 'Type a message...'}
                className="flex-1 bg-transparent px-6 py-4 outline-none text-white placeholder-gray-500"
                disabled={isSending || speechToText.isListening}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="p-3 m-1.5 bg-green-500 hover:bg-green-400 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-full transition text-white"
              >
                {isSending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Error display */}
          {speechToText.error && (
            <p className="mt-3 text-xs text-red-400 text-center">
              Microphone error: {speechToText.error}
            </p>
          )}
        </div>
      </div>

      {/* Custom styles */}
      <style jsx>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </main>
  );
}
