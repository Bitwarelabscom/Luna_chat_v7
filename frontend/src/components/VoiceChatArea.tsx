'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/lib/store';
import { streamMessage, synthesizeSpeech, getMediaUrl } from '@/lib/api';
import { Send, Mic, MicOff, Volume2, VolumeX, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useSpeechToText } from './useSpeechToText';
import Image from 'next/image';

export default function VoiceChatArea() {
  const {
    currentSession,
    isSending,
    streamingContent,
    statusMessage,
    loadSessions,
    addUserMessage,
    addAssistantMessage,
    appendStreamingContent,
    setIsSending,
    setStreamingContent,
    setStatusMessage,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speechToText = useSpeechToText();

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

    const sessionId = currentSession?.id;
    if (!sessionId) return;

    addUserMessage(message);
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    try {
      let accumulatedContent = '';
      for await (const chunk of streamMessage(sessionId, message)) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
        } else if (chunk.type === 'content' && chunk.content) {
          setStatusMessage('');
          accumulatedContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId, chunk.metrics);
          setStreamingContent('');
          setStatusMessage('');
          playAudio(accumulatedContent);
        }
      }

      loadSessions();
    } catch (error) {
      console.error('Failed to send message:', error);
      addAssistantMessage(
        'Sorry, I had trouble processing that. Could you try again?',
        `error-${Date.now()}`
      );
    } finally {
      setIsSending(false);
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
    <main className="fixed inset-0 flex flex-col bg-black overflow-hidden">
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
      <div className="relative z-10 flex-shrink-0 pt-12 pb-8 flex flex-col items-center">
        {/* Glow ring behind avatar */}
        <div className="relative">
          <div
            className={clsx(
              'absolute -inset-4 rounded-full transition-all duration-500',
              isSpeaking
                ? 'bg-green-500/20 blur-xl scale-110'
                : 'bg-theme-accent-primary/10 blur-lg scale-100'
            )}
          />

          {/* Avatar */}
          <div
            className={clsx(
              'relative w-40 h-40 md:w-48 md:h-48 rounded-full overflow-hidden border-4 transition-all duration-300',
              isSpeaking
                ? 'border-green-400 shadow-2xl shadow-green-500/40'
                : 'border-gray-700'
            )}
          >
            <Image
              src={getMediaUrl('/images/luna2.jpg')}
              alt="Luna"
              width={192}
              height={192}
              className={clsx(
                'w-full h-full object-cover transition-transform duration-300',
                isSpeaking && 'scale-105'
              )}
              priority
            />
          </div>

          {/* Audio visualizer rings */}
          {isSpeaking && (
            <>
              <div className="absolute inset-0 -m-2 rounded-full border-2 border-green-400/50 animate-ping" style={{ animationDuration: '1.5s' }} />
              <div className="absolute inset-0 -m-4 rounded-full border border-green-400/30 animate-ping" style={{ animationDuration: '2s' }} />
            </>
          )}
        </div>

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
      <div className="relative z-10 flex-shrink-0 p-6 pb-8">
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
