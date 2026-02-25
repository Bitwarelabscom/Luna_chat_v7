'use client';

import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { useChatStore } from '@/lib/store';
import { voiceApi } from '@/lib/api';
import { Send, Volume2, VolumeX, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { useThinkingMessage } from './ThinkingStatus';

type StopRecordingOptions = {
  autoResume?: boolean;
};

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

const ANALYSER_FFT_SIZE = 1024;

export default function VoiceChatArea() {
  const {
    isSending,
    streamingContent,
    reasoningContent,
    statusMessage,
    addUserMessage,
    addAssistantMessage,
    setIsSending,
    setStreamingContent,
    appendStreamingContent,
    setReasoningContent,
    appendReasoningContent,
    setStatusMessage,
  } = useChatStore();

  const thinkingPhrase = useThinkingMessage(isSending && !streamingContent, 'voice');
  const [showReasoning, setShowReasoning] = useState(true);

  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const [hasStartedConversation, setHasStartedConversation] = useState(false);
  const [isStartingConversation, setIsStartingConversation] = useState(false);

  // WebSocket and Audio refs
  const wsRef = useRef<WebSocket | null>(null);
  const recordingContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingMuteGainRef = useRef<GainNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);

  const audioQueueRef = useRef<Blob[]>([]);
  const isProcessingQueueRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const responseBufferRef = useRef('');

  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const hasStartedConversationRef = useRef(false);
  const autoResumePendingRef = useRef(false);
  const wasSpeakingRef = useRef(false);
  const autoPlayEnabledRef = useRef(true);
  const recordingStartInFlightRef = useRef(false);
  const pendingSampleRateRef = useRef<number | null>(null);

  const micWaveformRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const ttsWaveformRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const handleWsMessageRef = useRef<(msg: any) => void>(() => {});
  const orbRef = useRef<HTMLDivElement>(null);
  const orbRafRef = useRef<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    hasStartedConversationRef.current = hasStartedConversation;
  }, [hasStartedConversation]);

  useEffect(() => {
    autoPlayEnabledRef.current = autoPlayEnabled;
  }, [autoPlayEnabled]);

  const connectWebSocket = useCallback(
    (sessionId?: string) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const wsUrl = apiUrl
        ? `${apiUrl.replace(/^http/, 'ws')}/ws/voice`
        : `${protocol}//${window.location.port === '3004' ? `${window.location.hostname}:3005` : window.location.host}/ws/voice`;

      console.log('Connecting to Voice WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Voice WebSocket connected');
        const sid = sessionId || voiceSessionId;
        if (sid) {
          ws.send(JSON.stringify({ type: 'session', sessionId: sid }));
        }

        if (pendingSampleRateRef.current) {
          ws.send(
            JSON.stringify({
              type: 'config',
              sampleRate: pendingSampleRateRef.current,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            handleWsMessageRef.current(msg);
          } catch {
            // Ignore non-JSON text payloads.
          }
          return;
        }

        if (!autoPlayEnabledRef.current) {
          return;
        }

        if (event.data instanceof Blob) {
          audioQueueRef.current.push(event.data);
          void processAudioQueue();
        }
      };

      ws.onerror = (e) => console.error('Voice WebSocket error:', e);
      ws.onclose = () => console.log('Voice WebSocket closed');
    },
    [voiceSessionId]
  );

  const stopRecording = useCallback((options: StopRecordingOptions = {}) => {
    const shouldAutoResume = options.autoResume === true;

    if (shouldAutoResume && isListeningRef.current) {
      autoResumePendingRef.current = true;
    } else if (!shouldAutoResume) {
      autoResumePendingRef.current = false;
    }

    isListeningRef.current = false;
    setIsListening(false);

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (recordingMuteGainRef.current) {
      recordingMuteGainRef.current.disconnect();
      recordingMuteGainRef.current = null;
    }

    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }

    if (micAnalyserRef.current) {
      micAnalyserRef.current.disconnect();
      micAnalyserRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    const recordingContext = recordingContextRef.current;
    recordingContextRef.current = null;
    if (recordingContext && recordingContext.state !== 'closed') {
      recordingContext.close().catch(console.error);
    }
  }, []);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (recordingStartInFlightRef.current || isListeningRef.current) {
      return true;
    }

    try {
      recordingStartInFlightRef.current = true;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatusMessage('Microphone access requires HTTPS or localhost');
        console.error('navigator.mediaDevices is undefined. This usually happens in non-secure (HTTP) contexts.');
        return false;
      }

      const wsState = wsRef.current?.readyState;
      if (!wsRef.current || wsState === WebSocket.CLOSED || wsState === WebSocket.CLOSING) {
        connectWebSocket();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recordingContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      recordingContextRef.current = recordingContext;

      pendingSampleRateRef.current = recordingContext.sampleRate;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'config',
            sampleRate: recordingContext.sampleRate,
          })
        );
      }

      const source = recordingContext.createMediaStreamSource(stream);
      mediaSourceRef.current = source;

      const analyser = recordingContext.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      micAnalyserRef.current = analyser;

      const processor = recordingContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      const muteGain = recordingContext.createGain();
      muteGain.gain.value = 0;
      recordingMuteGainRef.current = muteGain;

      isListeningRef.current = true;
      setIsListening(true);
      setStatusMessage('Listening...');

      processor.onaudioprocess = (event) => {
        if (!isListeningRef.current) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);

        for (let i = 0; i < inputData.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(pcmData.buffer);
        }
      };

      // Split mic source to analyser and processor so UI metering does not affect PCM path.
      source.connect(analyser);
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(recordingContext.destination);

      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      setStatusMessage('Microphone access denied');
      stopRecording();
      return false;
    } finally {
      recordingStartInFlightRef.current = false;
    }
  }, [connectWebSocket, setStatusMessage, stopRecording]);

  const stopAudio = useCallback(() => {
    audioSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Ignore errors for already-stopped sources.
      }
    });

    audioSourcesRef.current = [];
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const processAudioQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || audioQueueRef.current.length === 0 || !autoPlayEnabledRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;
    setIsSpeaking(true);

    try {
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        const playbackContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = playbackContext.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;
        analyser.connect(playbackContext.destination);

        playbackContextRef.current = playbackContext;
        ttsAnalyserRef.current = analyser;
      }

      const ctx = playbackContextRef.current;
      if (!ctx) {
        return;
      }

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      while (audioQueueRef.current.length > 0 && autoPlayEnabledRef.current) {
        const blob = audioQueueRef.current.shift();
        if (!blob) {
          break;
        }

        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const now = ctx.currentTime;

          if (nextStartTimeRef.current < now) {
            nextStartTimeRef.current = now + 0.05;
          }

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ttsAnalyserRef.current || ctx.destination);

          const startTime = nextStartTimeRef.current;
          source.start(startTime);
          audioSourcesRef.current.push(source);
          nextStartTimeRef.current += audioBuffer.duration;

          source.onended = () => {
            audioSourcesRef.current = audioSourcesRef.current.filter((activeSource) => activeSource !== source);
          };
        } catch (error) {
          console.error('Audio chunk decoding/playback failed:', error);
        }
      }
    } finally {
      isProcessingQueueRef.current = false;

      const monitorPlayback = () => {
        const ctx = playbackContextRef.current;
        if (!ctx) {
          setIsSpeaking(false);
          return;
        }

        if (ctx.currentTime < nextStartTimeRef.current - 0.1) {
          setTimeout(monitorPlayback, 100);
          return;
        }

        if (!isProcessingQueueRef.current && audioQueueRef.current.length === 0) {
          setIsSpeaking(false);
        }
      };

      monitorPlayback();
    }
  }, []);

  const handleWsMessage = useCallback(
    (msg: any) => {
      switch (msg.type) {
        case 'status':
          if (msg.status === 'transcribing') {
            setIsSending(true);
            setStatusMessage('Transcribing...');
          } else if (msg.status === 'thinking') {
            setIsSending(true);
            setStreamingContent('');
            setReasoningContent('');
            responseBufferRef.current = '';
            setStatusMessage(`${thinkingPhrase}...`);
          } else if (msg.status === 'speaking') {
            setStatusMessage('Speaking...');
            if (isListeningRef.current) {
              stopRecording({ autoResume: true });
            }
          } else {
            setStatusMessage('');
          }
          break;
        case 'reasoning':
          appendReasoningContent(msg.content);
          break;
        case 'transcript':
          if (msg.text) {
            setInput(msg.text);
            addUserMessage(msg.text);
          }
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

          if (autoResumePendingRef.current && !isSpeakingRef.current && hasStartedConversationRef.current) {
            autoResumePendingRef.current = false;
            void startRecording();
          }
          break;
        case 'error':
          console.error('WS Error:', msg.error);
          setStatusMessage('Error: ' + msg.error);
          setIsSending(false);
          stopRecording();
          break;
        default:
          break;
      }
    },
    [
      addAssistantMessage,
      addUserMessage,
      appendReasoningContent,
      appendStreamingContent,
      setIsSending,
      setReasoningContent,
      setStatusMessage,
      setStreamingContent,
      startRecording,
      stopRecording,
      thinkingPhrase,
    ]
  );

  useEffect(() => {
    handleWsMessageRef.current = handleWsMessage;
  }, [handleWsMessage]);

  // Initialize voice session.
  useEffect(() => {
    const initSession = async () => {
      try {
        console.log('VoiceChatArea: Creating session...');
        const { sessionId } = await voiceApi.createSession();
        console.log('VoiceChatArea: Session created:', sessionId);
        setVoiceSessionId(sessionId);
        connectWebSocket(sessionId);
      } catch (error) {
        console.error('VoiceChatArea: Failed to initialize voice session:', error);
        setStatusMessage('Session initialization failed');
      }
    };

    void initSession();

    return () => {
      stopRecording();
      stopAudio();

      if (wsRef.current) {
        wsRef.current.close();
      }

      if (recordingContextRef.current) {
        recordingContextRef.current.close().catch(console.error);
      }

      if (playbackContextRef.current) {
        playbackContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  // Update session id if it changes after connection.
  useEffect(() => {
    if (voiceSessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'session', sessionId: voiceSessionId }));
    }
  }, [voiceSessionId]);

  // Auto-resume mic after speaking finishes.
  useEffect(() => {
    const wasSpeaking = wasSpeakingRef.current;

    if (wasSpeaking && !isSpeaking && autoResumePendingRef.current && hasStartedConversationRef.current) {
      autoResumePendingRef.current = false;
      void startRecording();
    }

    wasSpeakingRef.current = isSpeaking;
  }, [isSpeaking, startRecording]);

  const getNormalizedAmplitude = useCallback(
    (analyser: AnalyserNode | null, bufferRef: MutableRefObject<Uint8Array<ArrayBuffer> | null>) => {
      if (!analyser) {
        return 0;
      }

      if (!bufferRef.current || bufferRef.current.length !== analyser.fftSize) {
        bufferRef.current = new Uint8Array(analyser.fftSize);
      }

      analyser.getByteTimeDomainData(bufferRef.current);

      let sum = 0;
      for (let i = 0; i < bufferRef.current.length; i += 1) {
        const sample = (bufferRef.current[i] - 128) / 128;
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / bufferRef.current.length);
      return Math.min(1, rms * 4.5);
    },
    []
  );

  const orbState: OrbState = isSpeaking ? 'speaking' : isSending ? 'thinking' : isListening ? 'listening' : 'idle';

  // Drive listening/speaking orb scale from analyser amplitude.
  useEffect(() => {
    const shouldAnimateByAudio = orbState === 'listening' || orbState === 'speaking';

    if (!shouldAnimateByAudio) {
      if (orbRafRef.current) {
        cancelAnimationFrame(orbRafRef.current);
        orbRafRef.current = null;
      }
      if (orbRef.current) {
        orbRef.current.style.transform = 'scale(1)';
      }
      return;
    }

    const loop = () => {
      const analyser = orbState === 'speaking' ? ttsAnalyserRef.current : micAnalyserRef.current;
      const dataRef = orbState === 'speaking' ? ttsWaveformRef : micWaveformRef;
      const amplitude = getNormalizedAmplitude(analyser, dataRef);
      const range = orbState === 'speaking' ? 0.5 : 0.4;
      const scale = 1 + amplitude * range;

      if (orbRef.current) {
        orbRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      }

      orbRafRef.current = requestAnimationFrame(loop);
    };

    orbRafRef.current = requestAnimationFrame(loop);

    return () => {
      if (orbRafRef.current) {
        cancelAnimationFrame(orbRafRef.current);
        orbRafRef.current = null;
      }
      if (orbRef.current) {
        orbRef.current.style.transform = 'scale(1)';
      }
    };
  }, [getNormalizedAmplitude, orbState]);

  const handleStartConversation = useCallback(async () => {
    if (isStartingConversation) {
      return;
    }

    setIsStartingConversation(true);
    const started = await startRecording();
    if (started) {
      setHasStartedConversation(true);
    }
    setIsStartingConversation(false);
  }, [isStartingConversation, startRecording]);

  const handleToggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((previous) => {
      const next = !previous;
      autoPlayEnabledRef.current = next;

      if (!next) {
        stopAudio();
      } else {
        void processAudioQueue();
      }

      return next;
    });
  }, [processAudioQueue, stopAudio]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || isSending) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setStatusMessage('Not connected to voice server');
      const wsState = wsRef.current?.readyState;
      if (!wsRef.current || wsState === WebSocket.CLOSED || wsState === WebSocket.CLOSING) {
        connectWebSocket();
      }
      return;
    }

    if (isListeningRef.current) {
      stopRecording({ autoResume: hasStartedConversationRef.current });
    }

    addUserMessage(message);
    setInput('');
    setIsSending(true);
    setStreamingContent('');
    setReasoningContent('');
    responseBufferRef.current = '';

    wsRef.current.send(
      JSON.stringify({
        type: 'text',
        text: message,
      })
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const stripEmotionTags = (text: string) => text.replace(/\[.*?\]/g, '').trim();

  const displayText = streamingContent ? stripEmotionTags(streamingContent) : null;

  const orbLabel =
    orbState === 'speaking' ? 'Speaking...' : orbState === 'thinking' ? 'Thinking...' : orbState === 'listening' ? 'Listening...' : 'Ready';

  const orbVisuals: Record<OrbState, { core: string; glow: string; aura: string }> = {
    idle: {
      core: 'radial-gradient(circle at 30% 30%, #94a3b8 0%, #475569 55%, #1f2937 100%)',
      glow: '0 0 30px rgba(148, 163, 184, 0.35), 0 0 70px rgba(100, 116, 139, 0.25)',
      aura: 'radial-gradient(circle, rgba(148, 163, 184, 0.28) 0%, rgba(15, 23, 42, 0) 68%)',
    },
    listening: {
      core: 'radial-gradient(circle at 30% 30%, #bfdbfe 0%, #60a5fa 55%, #1d4ed8 100%)',
      glow: '0 0 34px rgba(96, 165, 250, 0.6), 0 0 90px rgba(59, 130, 246, 0.45)',
      aura: 'radial-gradient(circle, rgba(96, 165, 250, 0.35) 0%, rgba(30, 58, 138, 0) 70%)',
    },
    thinking: {
      core: 'radial-gradient(circle at 30% 30%, #fde68a 0%, #f59e0b 55%, #92400e 100%)',
      glow: '0 0 34px rgba(245, 158, 11, 0.55), 0 0 90px rgba(217, 119, 6, 0.4)',
      aura: 'radial-gradient(circle, rgba(245, 158, 11, 0.35) 0%, rgba(120, 53, 15, 0) 70%)',
    },
    speaking: {
      core: 'radial-gradient(circle at 30% 30%, #dcfce7 0%, #4ade80 55%, #166534 100%)',
      glow: '0 0 38px rgba(74, 222, 128, 0.62), 0 0 96px rgba(34, 197, 94, 0.48)',
      aura: 'radial-gradient(circle, rgba(74, 222, 128, 0.35) 0%, rgba(20, 83, 45, 0) 70%)',
    },
  };

  const isOrbIdle = orbState === 'idle';
  const isOrbThinking = orbState === 'thinking';

  return (
    <main className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <div
        className={clsx('pointer-events-none absolute inset-0 transition-opacity duration-700', orbState === 'speaking' ? 'opacity-100' : 'opacity-60')}
        style={{
          background:
            orbState === 'speaking'
              ? 'radial-gradient(ellipse at center top, rgba(74, 222, 128, 0.16) 0%, transparent 55%)'
              : orbState === 'thinking'
                ? 'radial-gradient(ellipse at center top, rgba(245, 158, 11, 0.14) 0%, transparent 55%)'
                : orbState === 'listening'
                  ? 'radial-gradient(ellipse at center top, rgba(96, 165, 250, 0.14) 0%, transparent 55%)'
                  : 'radial-gradient(ellipse at center top, rgba(148, 163, 184, 0.12) 0%, transparent 55%)',
        }}
      />

      <div className="relative z-10 flex flex-shrink-0 flex-col items-center pb-4 pt-6">
        <div className="relative flex h-56 w-56 items-center justify-center">
          <div
            className="pointer-events-none absolute h-56 w-56 rounded-full blur-3xl transition-all duration-500"
            style={{
              background: orbVisuals[orbState].aura,
              animation: isOrbThinking ? 'orb-breathe 2.2s ease-in-out infinite' : isOrbIdle ? 'orb-idle 4.2s ease-in-out infinite' : 'none',
            }}
          />
          <div className="pointer-events-none absolute h-40 w-40 rounded-full border border-white/10" />
          <div
            ref={orbRef}
            className="relative h-32 w-32 rounded-full transition-[background,box-shadow] duration-300 will-change-transform"
            style={{
              background: orbVisuals[orbState].core,
              boxShadow: orbVisuals[orbState].glow,
              animation: isOrbThinking ? 'orb-breathe 2.2s ease-in-out infinite' : isOrbIdle ? 'orb-idle 4.2s ease-in-out infinite' : 'none',
            }}
          />
        </div>

        <h2 className="mt-2 text-2xl font-light tracking-wide text-white">Luna</h2>
        <p className="mt-1 text-sm text-gray-300">{orbLabel}</p>

        {statusMessage && !isListening && !isSpeaking && (
          <p className="mt-1 text-xs text-gray-500">{statusMessage}</p>
        )}

        {!hasStartedConversation && !isListening && !isSending && !isSpeaking && (
          <button
            onClick={handleStartConversation}
            disabled={isStartingConversation}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-blue-500 px-7 py-3 text-sm font-medium text-white transition-all hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStartingConversation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>Start Conversation</span>
          </button>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleToggleAutoPlay}
            className={clsx(
              'rounded-full p-2.5 transition-all',
              autoPlayEnabled ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
            )}
            title={autoPlayEnabled ? 'Disable auto-play' : 'Enable auto-play'}
          >
            {autoPlayEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          {isSpeaking && (
            <button
              onClick={stopAudio}
              className="rounded-full bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-700"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-y-auto px-6">
        <div className="w-full max-w-2xl py-4 text-center">
          {reasoningContent && (
            <div className="mb-6 text-left">
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="mx-auto mb-2 flex items-center gap-2 text-xs text-gray-500 transition-colors hover:text-gray-400"
              >
                {showReasoning ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span>{thinkingPhrase}...</span>
              </button>
              {showReasoning && (
                <div className="custom-scrollbar max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-gray-400">
                  {reasoningContent}
                </div>
              )}
            </div>
          )}

          {isSending && !streamingContent ? (
            <div className="flex justify-center">
              <div className="flex gap-2">
                <span className="h-3 w-3 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: '0ms' }} />
                <span className="h-3 w-3 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: '150ms' }} />
                <span className="h-3 w-3 animate-bounce rounded-full bg-gray-500" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          ) : displayText ? (
            <p
              className={clsx(
                'text-base font-light leading-relaxed transition-all duration-300 md:text-lg lg:text-xl',
                isSpeaking ? 'text-white' : 'text-gray-300'
              )}
            >
              {displayText}
            </p>
          ) : (
            <p className="text-lg font-light text-gray-600">
              {hasStartedConversation ? 'Speak naturally, Luna will respond and keep listening.' : 'Press start to begin a two-way voice conversation.'}
            </p>
          )}
        </div>
      </div>

      <div className="pointer-events-auto relative z-50 flex-shrink-0 p-4 pb-6">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center rounded-full border border-gray-700 bg-gray-900/80 transition focus-within:border-gray-500">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? 'Listening... or type a message' : 'Type a message...'}
                className="flex-1 bg-transparent px-6 py-4 text-white outline-none placeholder:text-gray-500"
                disabled={isSending}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || isSending}
                className="m-1.5 rounded-full bg-green-500 p-3 text-white transition hover:bg-green-400 disabled:cursor-not-allowed disabled:bg-gray-700"
              >
                {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes orb-idle {
          0% {
            transform: scale(0.98);
            opacity: 0.88;
          }
          50% {
            transform: scale(1.03);
            opacity: 1;
          }
          100% {
            transform: scale(0.98);
            opacity: 0.88;
          }
        }

        @keyframes orb-breathe {
          0% {
            transform: scale(0.96);
          }
          50% {
            transform: scale(1.06);
          }
          100% {
            transform: scale(0.96);
          }
        }
      `}</style>
    </main>
  );
}
