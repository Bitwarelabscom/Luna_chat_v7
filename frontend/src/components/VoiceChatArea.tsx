'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/lib/store';
import { voiceApi } from '@/lib/api';
import { Send, Mic, MicOff, Volume2, VolumeX, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import LunaAvatar from './LunaAvatar';

export default function VoiceChatArea() {
  const {
    isSending,
    streamingContent,
    statusMessage,
    addUserMessage,
    addAssistantMessage,
    setIsSending,
    setStreamingContent,
    appendStreamingContent,
    setStatusMessage,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  
  // WebSocket and Audio Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  const audioQueueRef = useRef<Blob[]>([]);
  const isProcessingQueueRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const responseBufferRef = useRef('');
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize voice session
  useEffect(() => {
    const initSession = async () => {
      try {
        console.log('VoiceChatArea: Creating session...');
        const { sessionId } = await voiceApi.createSession();
        console.log('VoiceChatArea: Session created:', sessionId);
        setVoiceSessionId(sessionId);
        // Connect WebSocket with the newly created sessionId
        connectWebSocket(sessionId);
      } catch (error) {
        console.error('VoiceChatArea: Failed to initialize voice session:', error);
        setStatusMessage('Session initialization failed');
      }
    };
    initSession();
    
    return () => {
      stopRecording();
      stopAudio();
      if (wsRef.current) wsRef.current.close();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  const connectWebSocket = useCallback((sessionId?: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use port 3005 for API if we're on the default 3004 frontend port
    const apiHost = window.location.port === '3004' 
      ? `${window.location.hostname}:3005`
      : window.location.host;
      
    const wsUrl = `${protocol}//${apiHost}/ws/voice`;
    
    console.log('Connecting to Voice WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Voice WebSocket connected');
      const sid = sessionId || voiceSessionId;
      if (sid) {
        ws.send(JSON.stringify({ type: 'session', sessionId: sid }));
      }
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch (e) {
          // Ignore parse errors for non-json strings if any
        }
      } else if (event.data instanceof Blob) {
        // Audio chunk received
        audioQueueRef.current.push(event.data);
        processAudioQueue();
      }
    };

    ws.onerror = (e) => console.error('Voice WebSocket error:', e);
    ws.onclose = () => console.log('Voice WebSocket closed');
  }, [voiceSessionId]);
  
  // Update session ID if it changes after connection
  useEffect(() => {
    if (voiceSessionId && wsRef.current?.readyState === WebSocket.OPEN) {
       wsRef.current.send(JSON.stringify({ type: 'session', sessionId: voiceSessionId }));
    }
  }, [voiceSessionId]);

  const handleWsMessage = (msg: any) => {
    switch (msg.type) {
      case 'status':
        setStatusMessage(msg.status === 'thinking' ? 'Thinking...' : 
                         msg.status === 'transcribing' ? 'Transcribing...' :
                         msg.status === 'speaking' ? 'Speaking...' : '');
        if (msg.status === 'thinking') {
             setIsSending(true);
             setStreamingContent('');
             responseBufferRef.current = '';
        }
        break;
      case 'transcript':
        setInput(msg.text);
        addUserMessage(msg.text);
        break;
      case 'text_delta':
        appendStreamingContent(msg.delta);
        responseBufferRef.current += msg.delta;
        break;
      case 'text_done':
        setIsSending(false);
        if (responseBufferRef.current) {
             addAssistantMessage(responseBufferRef.current, `msg-${Date.now()}`);
        }
        setStreamingContent('');
        responseBufferRef.current = '';
        setStatusMessage('');
        break;
      case 'error':
        console.error('WS Error:', msg.error);
        setStatusMessage('Error: ' + msg.error);
        setIsSending(false);
        setIsListening(false);
        stopRecording();
        break;
    }
  };

  const processAudioQueue = async () => {
    if (isProcessingQueueRef.current || audioQueueRef.current.length === 0 || !autoPlayEnabled) return;
    
    isProcessingQueueRef.current = true;
    setIsSpeaking(true);
    
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      while (audioQueueRef.current.length > 0 && autoPlayEnabled) {
        const blob = audioQueueRef.current.shift();
        if (!blob) break;

        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          
          const now = ctx.currentTime;
          if (nextStartTimeRef.current < now) {
            nextStartTimeRef.current = now + 0.05; // 50ms initial buffer
          }
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          
          const startTime = nextStartTimeRef.current;
          source.start(startTime);
          audioSourcesRef.current.push(source);
          
          nextStartTimeRef.current += audioBuffer.duration;
          
          // Cleanup finished sources occasionally
          source.onended = () => {
            audioSourcesRef.current = audioSourcesRef.current.filter(s => s !== source);
          };
        } catch (e) {
          console.error('Audio chunk decoding/playback failed:', e);
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
      
      // Monitor when audio actually stops to toggle isSpeaking UI state
      const monitorPlayback = () => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        
        if (ctx.currentTime < nextStartTimeRef.current - 0.1) {
          setTimeout(monitorPlayback, 100);
        } else {
          // Queue is empty and scheduled audio has finished
          if (!isProcessingQueueRef.current && audioQueueRef.current.length === 0) {
            setIsSpeaking(false);
          }
        }
      };
      monitorPlayback();
    }
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatusMessage('Microphone access requires HTTPS or localhost');
        console.error('navigator.mediaDevices is undefined. This usually happens in non-secure (HTTP) contexts.');
        return;
      }

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connectWebSocket();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      wsRef.current?.send(JSON.stringify({ 
          type: 'config', 
          sampleRate: audioContext.sampleRate 
      }));

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isListening) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(pcmData.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsListening(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatusMessage('Microphone access denied');
    }
  };

  const stopRecording = () => {
    setIsListening(false);
    
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const toggleMicrophone = () => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  
  const stopAudio = () => {
      // Stop all currently scheduled/playing sources
      audioSourcesRef.current.forEach(source => {
        try { source.stop(); } catch (e) {}
      });
      audioSourcesRef.current = [];
      audioQueueRef.current = [];
      nextStartTimeRef.current = 0;
      setIsSpeaking(false);
  };

  const handleSend = async () => {
      const message = input.trim();
      if (!message || isSending) return;
      
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          setStatusMessage('Not connected to voice server');
          connectWebSocket();
          return;
      }

      // Add user message to UI
      addUserMessage(message);
      setInput('');
      setIsSending(true);
      setStreamingContent('');
      responseBufferRef.current = '';
      
      // Send via WS
      wsRef.current.send(JSON.stringify({ 
          type: 'text', 
          text: message 
      }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  // Display Logic
  const stripEmotionTags = (text: string) => {
    return text.replace(/\[.*?\]/g, '').trim();
  };

  const getDisplayText = () => {
    if (streamingContent) {
      return stripEmotionTags(streamingContent);
    }
    return null;
  };

  const displayText = getDisplayText();

  return (
    <main className="h-full w-full flex flex-col bg-black overflow-hidden relative">
      {/* Ambient background glow */}
      <div
        className={clsx(
          'absolute inset-0 transition-opacity duration-1000 pointer-events-none',
          isSpeaking ? 'opacity-100' : 'opacity-30'
        )}
        style={{
          background: 'radial-gradient(ellipse at center top, rgba(74, 222, 128, 0.15) 0%, transparent 50%)',
        }}
      />

      {/* Fixed top section - Luna Avatar */}
      <div className="relative z-10 flex-shrink-0 pt-6 pb-4 flex flex-col items-center">
        <LunaAvatar isSpeaking={isSpeaking} size="lg" />

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
          ) : isSending ? (
            <span className="text-gray-400 text-sm">{statusMessage || 'Thinking...'}</span>
          ) : isListening ? (
             <span className="text-red-400 text-sm animate-pulse">Listening...</span>
          ) : (
            <span className="text-gray-500 text-sm">Voice Mode (Streaming)</span>
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
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
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
            <div className="space-y-6">
              <p className="text-lg text-gray-600 font-light">
                {isListening ? 'I\'m listening...' : 'Ready to start talking with Luna?'}
              </p>
              {!isListening && !isSending && (
                <button
                  onClick={startRecording}
                  className="px-8 py-3 bg-green-500 hover:bg-green-400 text-black font-medium rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-green-500/20"
                >
                  Start Streaming
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom section - User input */}
      <div className="relative z-50 flex-shrink-0 p-4 pb-6 pointer-events-auto">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-3">
            {/* Microphone button */}
            <button
                onClick={toggleMicrophone}
                className={clsx(
                  'p-4 rounded-full transition-all',
                  isListening
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/50 scale-110'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                )}
                title={isListening ? 'Stop listening' : 'Start voice input'}
              >
                {isListening ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
            </button>

            {/* Text input */}
            <div className="flex-1 flex items-center bg-gray-900/80 rounded-full border border-gray-700 focus-within:border-gray-500 transition">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? 'Listening...' : 'Type a message...'}
                className="flex-1 bg-transparent px-6 py-4 outline-none text-white placeholder-gray-500"
                disabled={isSending || isListening}
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
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </main>
  );
}
