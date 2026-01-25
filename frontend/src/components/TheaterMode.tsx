'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Minimize2, Maximize2, MessageCircle, FileText, Send, ChevronRight } from 'lucide-react';
import { autonomousApi } from '../lib/api';
import type { AutonomousQuestion, SessionNote } from '../lib/api';

// API URL for SSE connections - must match where cookies are set
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface TheaterModeProps {
  sessionId: string;
  onClose: () => void;
}

interface CouncilMessage {
  speaker: string;
  message: string;
  timestamp: string;
  phase: string;
}

interface StreamEvent {
  type: 'connected' | 'phase_start' | 'phase_end' | 'council_message' | 'action' | 'session_end' | 'error' | 'tool_count_update' | 'tool_limit_reached' | 'search_start' | 'search_complete' | 'web_fetch_start' | 'web_fetched' | 'document_created' | 'history_load' | 'session_paused' | 'ping';
  phase?: string;
  speaker?: string;
  message?: string;
  action?: string;
  loopCount?: number;
  sessionId?: string;
  toolUseCount?: number;
  maxToolUses?: number;
  query?: string;
  resultCount?: number;
  url?: string;
  title?: string;
  deliberations?: Array<{ conversationData?: CouncilMessage[]; loopNumber?: number }>;
  currentLoop?: number;
  timestamp?: string;
}

const councilConfig: Record<string, { name: string; emoji: string; color: string; role: string }> = {
  planning: { name: 'Luna', emoji: '\uD83D\uDCDD', color: '#10B981', role: 'Planning' },
  polaris: { name: 'Polaris', emoji: '\u2B50', color: '#4A90D9', role: 'The Anchor' },
  aurora: { name: 'Aurora', emoji: '\u2728', color: '#9B59B6', role: 'The Intuitive' },
  vega: { name: 'Vega', emoji: '\uD83D\uDD25', color: '#E74C3C', role: 'The Skeptic' },
  sol: { name: 'Sol', emoji: '\u2600\uFE0F', color: '#F39C12', role: 'The Driver' },
  luna: { name: 'Luna', emoji: '\uD83C\uDF19', color: '#3B82F6', role: 'Your Assistant' },
  act: { name: 'Luna', emoji: '\uD83C\uDF19', color: '#3B82F6', role: 'Taking Action' },
  philosopher: { name: 'Philosopher', emoji: '\uD83E\uDDD0', color: '#8B5CF6', role: 'Expert' },
  pragmatist: { name: 'Pragmatist', emoji: '\uD83D\uDEE0\uFE0F', color: '#06B6D4', role: 'Expert' },
  critic: { name: 'Critic', emoji: '\uD83E\uDD14', color: '#F59E0B', role: 'Expert' },
  synthesizer: { name: 'Synthesizer', emoji: '\uD83E\uDDE9', color: '#EC4899', role: 'Expert' },
};

const phaseDescriptions: Record<string, string> = {
  planning: 'Creating a plan for the task...',
  polaris: 'Where are we? Reviewing context and priorities...',
  aurora: 'Anything shifted? Scanning for patterns and changes...',
  vega: 'What do we need to know? Validating assumptions...',
  sol: 'What is the move? Making the decision...',
  act: 'Luna is taking action...',
};

export default function TheaterMode({ sessionId, onClose }: TheaterModeProps) {
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [loopCount, setLoopCount] = useState(1);
  const [toolUseCount, setToolUseCount] = useState(0);
  const [maxToolUses, setMaxToolUses] = useState(100);
  const [isConnected, setIsConnected] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<AutonomousQuestion[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [questionResponse, setQuestionResponse] = useState('');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const MAX_RECONNECT_ATTEMPTS = 5;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Connect to SSE stream with reconnection logic
  useEffect(() => {
    // Load existing deliberations first
    loadExistingMessages();

    const connect = () => {
      // Close existing connection if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Connect to live stream with credentials for auth
      const eventSource = new EventSource(`${API_URL}/api/autonomous/deliberations/live`, {
        withCredentials: true,
      });

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        setReconnectAttempt(0); // Reset on successful connection
      };

      eventSource.onmessage = (event) => {
        try {
          const data: StreamEvent = JSON.parse(event.data);
          handleStreamEvent(data);
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();

        // Attempt reconnection with exponential backoff
        if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
          setError(`Reconnecting in ${Math.round(delay / 1000)}s...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempt(prev => prev + 1);
            connect();
          }, delay);
        } else {
          setError('Connection lost. Please refresh to reconnect.');
        }
      };

      eventSourceRef.current = eventSource;
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [sessionId]);

  const loadExistingMessages = async () => {
    try {
      const { deliberations } = await autonomousApi.getSessionDeliberations(sessionId);
      if (deliberations && deliberations.length > 0) {
        const latest = deliberations[deliberations.length - 1];
        if (latest.conversationData) {
          setMessages(latest.conversationData);
        }
        setLoopCount(latest.loopNumber || 1);
      }
    } catch (e) {
      console.error('Failed to load existing messages:', e);
    }
  };

  // Load questions and notes
  const loadQuestionsAndNotes = async () => {
    try {
      const [questionsRes, notesRes] = await Promise.all([
        autonomousApi.getPendingQuestions().catch(() => ({ questions: [] })),
        autonomousApi.getSessionNotes(sessionId).catch(() => ({ notes: [] })),
      ]);
      setPendingQuestions(questionsRes.questions || []);
      setSessionNotes(notesRes.notes || []);
    } catch (e) {
      console.error('Failed to load questions/notes:', e);
    }
  };

  // Poll for questions and notes every 5 seconds
  useEffect(() => {
    loadQuestionsAndNotes();
    const interval = setInterval(loadQuestionsAndNotes, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const handleAnswerQuestion = async (questionId: string) => {
    if (!questionResponse.trim()) return;
    try {
      await autonomousApi.answerQuestion(questionId, questionResponse);
      setQuestionResponse('');
      await loadQuestionsAndNotes();
    } catch (e) {
      console.error('Failed to answer question:', e);
    }
  };

  const handleDismissQuestion = async (questionId: string) => {
    try {
      await autonomousApi.dismissQuestion(questionId);
      await loadQuestionsAndNotes();
    } catch (e) {
      console.error('Failed to dismiss question:', e);
    }
  };

  const handleStreamEvent = (event: StreamEvent) => {
    // Update tool counts from any event that includes them
    if (event.toolUseCount !== undefined) {
      setToolUseCount(event.toolUseCount);
    }
    if (event.maxToolUses !== undefined) {
      setMaxToolUses(event.maxToolUses);
    }

    switch (event.type) {
      case 'connected':
        setIsConnected(true);
        break;

      case 'phase_start':
        setCurrentPhase(event.phase || null);
        if (event.loopCount) setLoopCount(event.loopCount);
        break;

      case 'phase_end':
        // Phase completed
        break;

      case 'council_message':
        if (event.speaker && event.message) {
          setMessages(prev => [...prev, {
            speaker: event.speaker!,
            message: event.message!,
            timestamp: new Date().toISOString(),
            phase: event.phase || '',
          }]);
        }
        break;

      case 'action':
        if (event.action) {
          const actionMsg = event.action;
          setMessages(prev => [...prev, {
            speaker: 'luna',
            message: actionMsg,
            timestamp: new Date().toISOString(),
            phase: 'act',
          }]);
        }
        break;

      case 'tool_count_update':
        // Already handled above
        break;

      case 'tool_limit_reached':
        setMessages(prev => [...prev, {
          speaker: 'luna',
          message: `Tool use limit reached (${event.toolUseCount}/${event.maxToolUses}). Session ending.`,
          timestamp: new Date().toISOString(),
          phase: 'act',
        }]);
        break;

      case 'search_start':
        setMessages(prev => [...prev, {
          speaker: 'luna',
          message: `Searching for: "${event.query}"...`,
          timestamp: new Date().toISOString(),
          phase: 'act',
        }]);
        break;

      case 'search_complete':
        setMessages(prev => [...prev, {
          speaker: 'luna',
          message: `Found ${event.resultCount} results for "${event.query}"`,
          timestamp: new Date().toISOString(),
          phase: 'act',
        }]);
        break;

      case 'web_fetch_start':
        setMessages(prev => [...prev, {
          speaker: 'luna',
          message: `Fetching: ${event.url}...`,
          timestamp: new Date().toISOString(),
          phase: 'act',
        }]);
        break;

      case 'web_fetched':
      case 'document_created':
        setMessages(prev => [...prev, {
          speaker: 'luna',
          message: `Fetched: ${event.title || event.url}`,
          timestamp: new Date().toISOString(),
          phase: 'act',
        }]);
        break;

      case 'session_end':
        setCurrentPhase(null);
        setIsConnected(false);
        break;

      case 'history_load':
        // Session was interrupted - load existing deliberations
        if (event.deliberations && event.deliberations.length > 0) {
          const latest = event.deliberations[event.deliberations.length - 1];
          if (latest.conversationData) {
            setMessages(latest.conversationData);
          }
        }
        if (event.currentLoop) setLoopCount(event.currentLoop);
        setIsConnected(true);
        break;

      case 'session_paused':
        setError(event.message || 'Session was interrupted');
        // Keep isConnected true - connection is still open for heartbeat
        break;

      case 'ping':
        // Keep-alive heartbeat - no action needed, just confirms connection is alive
        break;

      case 'error':
        setError(event.message || 'An error occurred');
        break;
    }
  };

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 px-4 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg hover:bg-theme-bg-tertiary"
        >
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          <MessageCircle className="w-4 h-4" />
          <span className="text-sm">Council Session</span>
          <Maximize2 className="w-4 h-4 ml-2" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-white/80 text-sm">
              {isConnected ? 'Live' : 'Disconnected'}
            </span>
          </div>
          <div className="text-white font-medium">
            Luna's Council Deliberation
          </div>
          <div className="text-white/50 text-sm">
            Loop #{loopCount}
          </div>
          <div className="h-4 w-px bg-white/20" />
          <div className="flex items-center gap-2">
            <div className="text-xs text-white/50">Tools:</div>
            <div className={`text-sm font-mono ${
              toolUseCount >= maxToolUses * 0.9
                ? 'text-red-400'
                : toolUseCount >= maxToolUses * 0.7
                  ? 'text-yellow-400'
                  : 'text-green-400'
            }`}>
              {toolUseCount}/{maxToolUses}
            </div>
            <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  toolUseCount >= maxToolUses * 0.9
                    ? 'bg-red-400'
                    : toolUseCount >= maxToolUses * 0.7
                      ? 'bg-yellow-400'
                      : 'bg-green-400'
                }`}
                style={{ width: `${Math.min((toolUseCount / maxToolUses) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle Notes Sidebar */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              showSidebar ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="text-sm">Notes</span>
            {sessionNotes.length > 0 && (
              <span className="bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {sessionNotes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>


      {/* Current Phase Indicator */}
      {currentPhase && (
        <div className="px-6 py-3 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {councilConfig[currentPhase]?.emoji || '\uD83D\uDCE2'}
            </span>
            <div>
              <div className="text-white font-medium">
                {councilConfig[currentPhase]?.name || currentPhase.toUpperCase()}
              </div>
              <div className="text-white/50 text-sm">
                {phaseDescriptions[currentPhase] || 'Processing...'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content with optional sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages Area */}
        <div className={`flex-1 overflow-y-auto p-6 space-y-4 ${showSidebar ? 'pr-3' : ''}`}>
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-400">
              {error}
            </div>
          )}

        {messages.length === 0 && !error && (
          <div className="text-center text-white/30 py-12">
            <div className="text-4xl mb-4">{'\uD83C\uDF19'}</div>
            <p>Waiting for the council to convene...</p>
          </div>
        )}

        {messages.map((msg, index) => {
          const config = councilConfig[msg.speaker] || {
            name: msg.speaker,
            emoji: '\uD83D\uDCE2',
            color: '#888888',
            role: 'System',
          };

          return (
            <div key={index} className="flex gap-4 animate-fadeIn">
              {/* Avatar */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
                style={{ backgroundColor: `${config.color}20` }}
              >
                {config.emoji}
              </div>

              {/* Message Content */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white" style={{ color: config.color }}>
                    {config.name}
                  </span>
                  <span className="text-white/30 text-xs">
                    {config.role}
                  </span>
                </div>
                <div className="text-white/90 whitespace-pre-wrap leading-relaxed">
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator when phase is active */}
        {currentPhase && currentPhase !== 'act' && (
          <div className="flex gap-4 animate-pulse">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
              style={{ backgroundColor: `${councilConfig[currentPhase]?.color || '#888'}20` }}
            >
              {councilConfig[currentPhase]?.emoji || '\uD83D\uDCE2'}
            </div>
            <div className="flex items-center">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>

        {/* Notes Sidebar */}
        {showSidebar && (
          <div className="w-80 border-l border-white/10 bg-black/50 flex flex-col">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="text-white font-medium">Session Notes</span>
              </div>
              <button
                onClick={() => setShowSidebar(false)}
                className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {sessionNotes.length === 0 ? (
                <div className="text-center text-white/30 py-8">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No notes yet...</p>
                  <p className="text-xs mt-1">Luna will add notes during deliberation</p>
                </div>
              ) : (
                sessionNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`bg-white/5 rounded-lg p-3 border-l-2 ${
                      note.noteType === 'planning' ? 'border-blue-400' :
                      note.noteType === 'observation' ? 'border-purple-400' :
                      note.noteType === 'finding' ? 'border-green-400' :
                      note.noteType === 'decision' ? 'border-yellow-400' :
                      note.noteType === 'question' ? 'border-red-400' :
                      'border-gray-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                        note.noteType === 'planning' ? 'bg-blue-400/20 text-blue-300' :
                        note.noteType === 'observation' ? 'bg-purple-400/20 text-purple-300' :
                        note.noteType === 'finding' ? 'bg-green-400/20 text-green-300' :
                        note.noteType === 'decision' ? 'bg-yellow-400/20 text-yellow-300' :
                        note.noteType === 'question' ? 'bg-red-400/20 text-red-300' :
                        'bg-gray-400/20 text-gray-300'
                      }`}>
                        {note.noteType}
                      </span>
                      {note.phase && (
                        <span className="text-xs text-white/30">{note.phase}</span>
                      )}
                    </div>
                    {note.title && (
                      <div className="text-sm text-white/90 font-medium mb-1">{note.title}</div>
                    )}
                    <div className="text-xs text-white/70 whitespace-pre-wrap">{note.content}</div>
                    <div className="text-xs text-white/30 mt-2">
                      {new Date(note.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer - Question Input or Council Members */}
      <div className="border-t border-white/10">
        {/* Question Input - when Luna asks a question */}
        {pendingQuestions.length > 0 && (
          <div className="px-6 py-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10">
            <div className="flex items-start gap-4">
              {/* Luna's avatar */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0"
                style={{ backgroundColor: '#3B82F620' }}
              >
                {'\uD83C\uDF19'}
              </div>
              <div className="flex-1">
                <div className="text-blue-300 text-sm mb-2">
                  Luna asks:
                </div>
                <div className="text-white mb-3">
                  {pendingQuestions[0].question}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAnswerQuestion(pendingQuestions[0].id);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={questionResponse}
                    onChange={(e) => setQuestionResponse(e.target.value)}
                    placeholder="Type your response..."
                    className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:border-blue-400"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={!questionResponse.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismissQuestion(pendingQuestions[0].id)}
                    className="px-3 py-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg"
                  >
                    Skip
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Council Members - always shown */}
        <div className="px-6 py-3">
          <div className="flex items-center justify-center gap-6">
            {['polaris', 'aurora', 'vega', 'sol'].map((member) => {
              const config = councilConfig[member];
              const isActive = currentPhase === member;
              return (
                <div
                  key={member}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                    isActive ? 'bg-white/10 scale-110' : 'opacity-50'
                  }`}
                >
                  <span className="text-xl">{config.emoji}</span>
                  <span className="text-white/80 text-sm">{config.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CSS Animation */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
