'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Square, RefreshCw, Plus, Target, BookOpen,
  Sparkles, Trash2, Check, User, MessageCircle, X, Send,
  Maximize2
} from 'lucide-react';
import { autonomousApi } from '../../../lib/api';
import type {
  AutonomousConfig, AutonomousStatus, Goal, Achievement, ProactiveInsight, AutonomousQuestion, SessionNote
} from '../../../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

type TabId = 'theater' | 'goals' | 'journal' | 'questions';

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

const goalTypeConfig: Record<string, { color: string; bg: string; label: string }> = {
  user_focused: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'User Focused' },
  self_improvement: { color: 'text-purple-400', bg: 'bg-purple-400/10', label: 'Self Improvement' },
  relationship: { color: 'text-pink-400', bg: 'bg-pink-400/10', label: 'Relationship' },
  research: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Research' },
};

const COUNCIL_MEMBERS = [
  { key: 'polaris', name: 'Polaris', role: 'The Anchor', color: '#4A90D9' },
  { key: 'aurora', name: 'Aurora', role: 'The Intuitive', color: '#9B59B6' },
  { key: 'vega', name: 'Vega', role: 'The Skeptic', color: '#E74C3C' },
  { key: 'sol', name: 'Sol', role: 'The Driver', color: '#F39C12' },
];

export default function CouncilWindow() {
  const [activeTab, setActiveTab] = useState<TabId>('theater');
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  const [_config, setConfig] = useState<AutonomousConfig | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [insights, setInsights] = useState<ProactiveInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [userAvailable, setUserAvailable] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<AutonomousQuestion[]>([]);
  const [councilTopic, setCouncilTopic] = useState('');
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [newGoal, setNewGoal] = useState({ goalType: 'self_improvement', title: '', description: '', priority: 5 });
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);
  const [questionResponse, setQuestionResponse] = useState('');

  // Theater state
  const [theaterMessages, setTheaterMessages] = useState<CouncilMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [loopCount, setLoopCount] = useState(1);
  const [toolUseCount, setToolUseCount] = useState(0);
  const [maxToolUses, setMaxToolUses] = useState(100);
  const [isConnected, setIsConnected] = useState(false);
  const [theaterError, setTheaterError] = useState<string | null>(null);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, configRes, goalsRes, achievementsRes, insightsRes, availabilityRes, questionsRes] = await Promise.all([
        autonomousApi.getStatus(),
        autonomousApi.getConfig(),
        autonomousApi.getGoals(),
        autonomousApi.getAchievements(),
        autonomousApi.getInsights({ unshared: true }),
        autonomousApi.getAvailability().catch(() => ({ available: false })),
        autonomousApi.getPendingQuestions().catch(() => ({ questions: [] })),
      ]);

      setStatus(statusRes);
      setConfig(configRes.config);
      setGoals(goalsRes.goals || []);
      setAchievements(achievementsRes.achievements || []);
      setInsights(insightsRes.insights || []);
      setUserAvailable(availabilityRes.available);
      setPendingQuestions(questionsRes.questions || []);
    } catch (error) {
      console.error('Failed to load council data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // SSE connection for live deliberations
  const isActive = status?.status === 'active';
  const sessionId = status?.currentSession?.id;

  useEffect(() => {
    if (!isActive || !sessionId) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    // Load existing messages
    const loadExisting = async () => {
      try {
        const { deliberations } = await autonomousApi.getSessionDeliberations(sessionId);
        if (deliberations && deliberations.length > 0) {
          const latest = deliberations[deliberations.length - 1];
          if (latest.conversationData) setTheaterMessages(latest.conversationData);
          setLoopCount(latest.loopNumber || 1);
        }
      } catch (e) {
        console.error('Failed to load existing messages:', e);
      }
    };
    loadExisting();

    const connect = () => {
      if (eventSourceRef.current) eventSourceRef.current.close();

      const es = new EventSource(`${API_URL}/api/autonomous/deliberations/live`, { withCredentials: true });
      es.onopen = () => { setIsConnected(true); setTheaterError(null); reconnectAttemptRef.current = 0; };
      es.onmessage = (event) => {
        try { handleStreamEvent(JSON.parse(event.data)); } catch (e) { console.error('Failed to parse SSE:', e); }
      };
      es.onerror = () => {
        setIsConnected(false);
        es.close();
        if (reconnectAttemptRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
          setTheaterError(`Reconnecting in ${Math.round(delay / 1000)}s...`);
          reconnectTimeoutRef.current = setTimeout(() => { reconnectAttemptRef.current++; connect(); }, delay);
        } else {
          setTheaterError('Connection lost. Click refresh to reconnect.');
        }
      };
      eventSourceRef.current = es;
    };
    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sessionId]);

  // Poll notes + questions while active
  useEffect(() => {
    if (!isActive || !sessionId) return;
    const poll = async () => {
      try {
        const [questionsRes, notesRes] = await Promise.all([
          autonomousApi.getPendingQuestions().catch(() => ({ questions: [] })),
          autonomousApi.getSessionNotes(sessionId).catch(() => ({ notes: [] })),
        ]);
        setPendingQuestions(questionsRes.questions || []);
        setSessionNotes(notesRes.notes || []);
      } catch (_e) { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [isActive, sessionId]);

  // Auto-scroll theater messages
  useEffect(() => {
    if (activeTab === 'theater') messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [theaterMessages, activeTab]);

  const handleStreamEvent = (event: StreamEvent) => {
    if (event.toolUseCount !== undefined) setToolUseCount(event.toolUseCount);
    if (event.maxToolUses !== undefined) setMaxToolUses(event.maxToolUses);

    switch (event.type) {
      case 'connected': setIsConnected(true); break;
      case 'phase_start': setCurrentPhase(event.phase || null); if (event.loopCount) setLoopCount(event.loopCount); break;
      case 'phase_end': break;
      case 'council_message':
        if (event.speaker && event.message) {
          setTheaterMessages(prev => [...prev, { speaker: event.speaker!, message: event.message!, timestamp: new Date().toISOString(), phase: event.phase || '' }]);
        }
        break;
      case 'action':
        if (event.action) setTheaterMessages(prev => [...prev, { speaker: 'luna', message: event.action!, timestamp: new Date().toISOString(), phase: 'act' }]);
        break;
      case 'tool_limit_reached':
        setTheaterMessages(prev => [...prev, { speaker: 'luna', message: `Tool use limit reached (${event.toolUseCount}/${event.maxToolUses}). Session ending.`, timestamp: new Date().toISOString(), phase: 'act' }]);
        break;
      case 'search_start':
        setTheaterMessages(prev => [...prev, { speaker: 'luna', message: `Searching for: "${event.query}"...`, timestamp: new Date().toISOString(), phase: 'act' }]);
        break;
      case 'search_complete':
        setTheaterMessages(prev => [...prev, { speaker: 'luna', message: `Found ${event.resultCount} results for "${event.query}"`, timestamp: new Date().toISOString(), phase: 'act' }]);
        break;
      case 'web_fetch_start':
        setTheaterMessages(prev => [...prev, { speaker: 'luna', message: `Fetching: ${event.url}...`, timestamp: new Date().toISOString(), phase: 'act' }]);
        break;
      case 'web_fetched':
      case 'document_created':
        setTheaterMessages(prev => [...prev, { speaker: 'luna', message: `Fetched: ${event.title || event.url}`, timestamp: new Date().toISOString(), phase: 'act' }]);
        break;
      case 'session_end': setCurrentPhase(null); setIsConnected(false); loadData(); break;
      case 'history_load':
        if (event.deliberations?.length) {
          const latest = event.deliberations[event.deliberations.length - 1];
          if (latest.conversationData) setTheaterMessages(latest.conversationData);
        }
        if (event.currentLoop) setLoopCount(event.currentLoop);
        setIsConnected(true);
        break;
      case 'session_paused': setTheaterError(event.message || 'Session was interrupted'); break;
      case 'ping': break;
      case 'error': setTheaterError(event.message || 'An error occurred'); break;
    }
  };

  // Handlers
  const handleStart = async () => {
    try {
      await autonomousApi.start(councilTopic.trim() ? { taskDescription: councilTopic.trim() } : undefined);
      setCouncilTopic('');
      setTheaterMessages([]);
      await loadData();
    } catch (error) {
      console.error('Failed to start:', error);
      alert(error instanceof Error ? error.message : 'Failed to start autonomous mode');
    }
  };

  const handleStop = async () => {
    try {
      await autonomousApi.stop();
      await loadData();
    } catch (error) {
      console.error('Failed to stop:', error);
    }
  };

  const handleToggleAvailability = async () => {
    try {
      const result = await autonomousApi.setAvailability(!userAvailable);
      setUserAvailable(result.available);
    } catch (error) {
      console.error('Failed to toggle availability:', error);
    }
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.title.trim()) return;
    try {
      await autonomousApi.createGoal({
        goalType: newGoal.goalType as Goal['goalType'],
        title: newGoal.title,
        description: newGoal.description || null,
        priority: newGoal.priority,
      });
      setNewGoal({ goalType: 'self_improvement', title: '', description: '', priority: 5 });
      setShowNewGoal(false);
      await loadData();
    } catch (error) { console.error('Failed to create goal:', error); }
  };

  const handleCompleteGoal = async (goalId: string) => {
    try { await autonomousApi.updateGoal(goalId, { status: 'completed' }); await loadData(); } catch (error) { console.error('Failed:', error); }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (!confirm('Delete this goal?')) return;
    try { await autonomousApi.deleteGoal(goalId); await loadData(); } catch (error) { console.error('Failed:', error); }
  };

  const handleAnswerQuestion = async (questionId: string) => {
    if (!questionResponse.trim()) return;
    try {
      await autonomousApi.answerQuestion(questionId, questionResponse);
      setQuestionResponse('');
      setAnsweringQuestion(null);
      await loadData();
    } catch (error) { console.error('Failed:', error); }
  };

  const handleDismissQuestion = async (questionId: string) => {
    try { await autonomousApi.dismissQuestion(questionId); await loadData(); } catch (error) { console.error('Failed:', error); }
  };

  const handleDismissInsight = async (insightId: string) => {
    try { await autonomousApi.dismissInsight(insightId); await loadData(); } catch (error) { console.error('Failed:', error); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--theme-bg-primary)' }}>
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
      </div>
    );
  }

  // Fullscreen theater overlay
  if (showFullscreen && isActive && sessionId) {
    const TheaterMode = require('../../TheaterMode').default;
    return <TheaterMode sessionId={sessionId} onClose={() => setShowFullscreen(false)} />;
  }

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Status Bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}>
        {isActive ? (
          <>
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
              LIVE
            </span>
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              Loop #{loopCount}
            </span>
            {currentPhase && (
              <>
                <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>-</span>
                <span className="text-xs capitalize" style={{ color: councilConfig[currentPhase]?.color || 'var(--theme-text-secondary)' }}>
                  {councilConfig[currentPhase]?.name || currentPhase} speaking...
                </span>
              </>
            )}
            {/* Tools progress */}
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Tools:</span>
              <span className={`text-xs font-mono ${toolUseCount >= maxToolUses * 0.9 ? 'text-red-400' : toolUseCount >= maxToolUses * 0.7 ? 'text-yellow-400' : 'text-green-400'}`}>
                {toolUseCount}/{maxToolUses}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowFullscreen(true)}
                className="p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors"
                style={{ color: 'var(--theme-text-muted)' }}
                title="Fullscreen theater"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />
            <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>IDLE</span>
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              {status?.todaySessionCount || 0} sessions today
            </span>
            <div className="ml-auto flex items-center gap-2">
              <input
                type="text"
                value={councilTopic}
                onChange={(e) => setCouncilTopic(e.target.value)}
                placeholder="Topic (optional)..."
                className="px-2.5 py-1 text-xs rounded-lg border w-48"
                style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
              />
              <button
                onClick={handleStart}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30"
              >
                <Play className="w-3 h-3" />
                Start
              </button>
            </div>
          </>
        )}
      </div>

      {/* Main content: sidebar + tabs */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[200px] flex-shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}>
          {/* Council members */}
          <div className="p-3 space-y-1.5">
            {COUNCIL_MEMBERS.map(member => {
              const isSpeaking = currentPhase === member.key;
              return (
                <div
                  key={member.key}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all ${isSpeaking ? 'bg-[var(--theme-bg-tertiary)]' : ''}`}
                  style={isSpeaking ? { boxShadow: `inset 0 0 0 1px ${member.color}40` } : {}}
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: member.color, opacity: isSpeaking ? 1 : 0.4 }} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: isSpeaking ? member.color : 'var(--theme-text-primary)' }}>
                      {member.name}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
                      {member.role}
                    </div>
                  </div>
                  {isSpeaking && <div className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: member.color }} />}
                </div>
              );
            })}
          </div>

          <div className="mx-3 border-t" style={{ borderColor: 'var(--theme-border-default)' }} />

          {/* Stats */}
          <div className="p-3 space-y-2 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            <div className="flex justify-between">
              <span>Sessions today</span>
              <span style={{ color: 'var(--theme-text-primary)' }}>{status?.todaySessionCount || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Active goals</span>
              <span className="text-green-400">{activeGoals.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Achievements</span>
              <span className="text-purple-400">{achievements.length}</span>
            </div>
            {insights.length > 0 && (
              <div className="flex justify-between">
                <span>Insights</span>
                <span className="text-yellow-400">{insights.length}</span>
              </div>
            )}
          </div>

          <div className="mx-3 border-t" style={{ borderColor: 'var(--theme-border-default)' }} />

          {/* Availability toggle */}
          <div className="p-3">
            <button
              onClick={handleToggleAvailability}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                userAvailable ? 'bg-green-500/10 text-green-400' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-tertiary)]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{userAvailable ? 'Available' : 'Away'}</span>
              <div className={`ml-auto w-7 h-4 rounded-full transition-colors ${userAvailable ? 'bg-green-500' : 'bg-gray-600'}`}>
                <div className={`w-3 h-3 mt-0.5 bg-white rounded-full transition-transform ${userAvailable ? 'ml-3.5' : 'ml-0.5'}`} />
              </div>
            </button>
          </div>

          <div className="flex-1" />

          {/* Refresh */}
          <div className="p-3">
            <button
              onClick={loadData}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs hover:bg-[var(--theme-bg-tertiary)] transition-colors"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--theme-border-default)' }}>
            {([
              { id: 'theater' as TabId, label: 'Theater' },
              { id: 'goals' as TabId, label: 'Goals' },
              { id: 'journal' as TabId, label: 'Journal' },
              { id: 'questions' as TabId, label: `Questions${pendingQuestions.length > 0 ? ` (${pendingQuestions.length})` : ''}` },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'theater' && renderTheater()}
            {activeTab === 'goals' && renderGoals()}
            {activeTab === 'journal' && renderJournal()}
            {activeTab === 'questions' && renderQuestions()}
          </div>

          {/* Question footer when session is active and there are pending questions */}
          {isActive && pendingQuestions.length > 0 && activeTab === 'theater' && (
            <div className="border-t px-4 py-3 bg-gradient-to-r from-blue-500/5 to-purple-500/5" style={{ borderColor: 'var(--theme-border-default)' }}>
              <div className="flex items-start gap-3">
                <MessageCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-blue-400 mb-1">Luna asks:</div>
                  <div className="text-sm mb-2" style={{ color: 'var(--theme-text-primary)' }}>
                    {pendingQuestions[0].question}
                  </div>
                  <form onSubmit={(e) => { e.preventDefault(); handleAnswerQuestion(pendingQuestions[0].id); }} className="flex gap-2">
                    <input
                      type="text"
                      value={questionResponse}
                      onChange={(e) => setQuestionResponse(e.target.value)}
                      placeholder="Type your response..."
                      className="flex-1 text-sm px-3 py-1.5 rounded-lg border"
                      style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
                      autoFocus
                    />
                    <button type="submit" disabled={!questionResponse.trim()} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs hover:bg-blue-600 disabled:opacity-50">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => handleDismissQuestion(pendingQuestions[0].id)} className="px-2 py-1.5 text-xs rounded-lg hover:bg-[var(--theme-bg-tertiary)]" style={{ color: 'var(--theme-text-muted)' }}>
                      Skip
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // --- Panel renderers ---

  function renderTheater() {
    if (!isActive) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--theme-text-muted)' }}>
          <div className="text-4xl">{'\uD83C\uDF19'}</div>
          <p className="text-sm">No active session. Start a council deliberation from the status bar above.</p>
        </div>
      );
    }

    return (
      <div className="flex h-full">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {theaterError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{theaterError}</div>
          )}

          {theaterMessages.length === 0 && !theaterError && (
            <div className="text-center py-12" style={{ color: 'var(--theme-text-muted)' }}>
              <div className="text-4xl mb-4">{'\uD83C\uDF19'}</div>
              <p className="text-sm">Waiting for the council to convene...</p>
            </div>
          )}

          {theaterMessages.map((msg, index) => {
            const cfg = councilConfig[msg.speaker] || { name: msg.speaker, emoji: '\uD83D\uDCE2', color: '#888', role: 'System' };
            return (
              <div key={index} className="flex gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: `${cfg.color}15` }}>
                  {cfg.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.name}</span>
                    <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>{cfg.role}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--theme-text-primary)' }}>
                    {msg.message}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {currentPhase && currentPhase !== 'act' && (
            <div className="flex gap-3 animate-pulse">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: `${councilConfig[currentPhase]?.color || '#888'}15` }}>
                {councilConfig[currentPhase]?.emoji || '\uD83D\uDCE2'}
              </div>
              <div className="flex items-center gap-1 pt-3">
                <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms', color: 'var(--theme-text-muted)' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms', color: 'var(--theme-text-muted)' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms', color: 'var(--theme-text-muted)' }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Notes sidebar (inside theater) */}
        {sessionNotes.length > 0 && (
          <div className="w-56 border-l overflow-y-auto p-3 space-y-2" style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}>
            <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--theme-text-muted)' }}>Session Notes</div>
            {sessionNotes.map(note => (
              <div key={note.id} className="rounded-lg p-2 border-l-2 text-xs" style={{ background: 'var(--theme-bg-tertiary)', borderLeftColor: noteColor(note.noteType) }}>
                <span className="text-[10px] uppercase tracking-wide" style={{ color: noteColor(note.noteType) }}>{note.noteType}</span>
                {note.title && <div className="font-medium mt-0.5" style={{ color: 'var(--theme-text-primary)' }}>{note.title}</div>}
                <div className="mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--theme-text-secondary)' }}>{note.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderGoals() {
    return (
      <div className="p-4 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>Goals</h3>
          <button
            onClick={() => setShowNewGoal(!showNewGoal)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)] hover:bg-[var(--theme-accent-primary)]/30"
          >
            <Plus className="w-3.5 h-3.5" />
            New Goal
          </button>
        </div>

        {showNewGoal && (
          <form onSubmit={handleCreateGoal} className="rounded-lg p-4 space-y-3 border" style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)' }}>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--theme-text-muted)' }}>Type</label>
              <select value={newGoal.goalType} onChange={(e) => setNewGoal({ ...newGoal, goalType: e.target.value })} className="w-full px-3 py-1.5 rounded-lg text-sm border" style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}>
                <option value="user_focused">User Focused</option>
                <option value="self_improvement">Self Improvement</option>
                <option value="relationship">Relationship</option>
                <option value="research">Research</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--theme-text-muted)' }}>Title</label>
              <input type="text" value={newGoal.title} onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })} placeholder="What to achieve?" className="w-full px-3 py-1.5 rounded-lg text-sm border" style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--theme-text-muted)' }}>Description (optional)</label>
              <textarea value={newGoal.description} onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })} rows={2} placeholder="Details..." className="w-full px-3 py-1.5 rounded-lg text-sm border resize-none" style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 px-3 py-1.5 bg-[var(--theme-accent-primary)] text-white rounded-lg text-xs hover:opacity-90">Create</button>
              <button type="button" onClick={() => setShowNewGoal(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-secondary)' }}>Cancel</button>
            </div>
          </form>
        )}

        {/* Active goals */}
        {activeGoals.length === 0 && completedGoals.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--theme-text-muted)' }}>
            <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No goals yet. Create one to get started!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeGoals.map(goal => renderGoalCard(goal))}
            {completedGoals.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider font-medium pt-2" style={{ color: 'var(--theme-text-muted)' }}>Completed</div>
                {completedGoals.map(goal => renderGoalCard(goal))}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderGoalCard(goal: Goal) {
    const tc = goalTypeConfig[goal.goalType] || { color: 'text-gray-400', bg: 'bg-gray-400/10', label: goal.goalType };
    return (
      <div key={goal.id} className={`rounded-lg p-3 border ${goal.status === 'completed' ? 'opacity-60' : ''}`} style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${tc.bg} ${tc.color}`}>{tc.label}</span>
              {goal.status === 'completed' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-400/10 text-green-400">Done</span>}
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{goal.title}</div>
            {goal.description && <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-secondary)' }}>{goal.description}</p>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {goal.status === 'active' && (
              <button onClick={() => handleCompleteGoal(goal.id)} className="p-1 text-green-400 hover:bg-green-400/10 rounded" title="Complete">
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => handleDeleteGoal(goal.id)} className="p-1 text-red-400 hover:bg-red-400/10 rounded" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderJournal() {
    return (
      <div className="p-4 space-y-4">
        <h3 className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>Achievement Journal</h3>

        {/* Insights */}
        {insights.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--theme-text-muted)' }}>Pending Insights</div>
            {insights.map(insight => (
              <div key={insight.id} className="rounded-lg p-3 border" style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        insight.sourceType === 'council_deliberation' ? 'bg-purple-400/10 text-purple-400' :
                        insight.sourceType === 'rss_article' ? 'bg-blue-400/10 text-blue-400' :
                        insight.sourceType === 'goal_progress' ? 'bg-green-400/10 text-green-400' :
                        'bg-yellow-400/10 text-yellow-400'
                      }`}>
                        {insight.sourceType.replace('_', ' ')}
                      </span>
                      {insight.priority >= 7 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400">High</span>}
                    </div>
                    <div className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{insight.insightTitle}</div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-secondary)' }}>{insight.insightContent}</p>
                  </div>
                  <button onClick={() => handleDismissInsight(insight.id)} className="p-1 rounded hover:bg-[var(--theme-bg-secondary)]" style={{ color: 'var(--theme-text-muted)' }} title="Dismiss">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Achievements */}
        {achievements.length === 0 && insights.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--theme-text-muted)' }}>
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No achievements yet. Complete goals to earn them!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {achievements.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--theme-text-muted)' }}>Achievements</div>
            )}
            {achievements.map(a => (
              <div key={a.id} className="rounded-lg p-3 border flex items-start gap-3" style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)' }}>
                <div className="text-xl shrink-0">
                  {a.achievementType === 'goal_completed' ? '\uD83C\uDFC6' :
                   a.achievementType === 'milestone' ? '\uD83C\uDF1F' :
                   a.achievementType === 'discovery' ? '\uD83D\uDD0D' :
                   a.achievementType === 'insight' ? '\uD83D\uDCA1' : '\u2728'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{a.title}</div>
                  {a.journalEntry && <p className="text-xs italic mt-0.5" style={{ color: 'var(--theme-text-secondary)' }}>"{a.journalEntry}"</p>}
                  <div className="text-[10px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>{new Date(a.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderQuestions() {
    return (
      <div className="p-4 space-y-4">
        <h3 className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>Questions from Luna</h3>

        {pendingQuestions.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--theme-text-muted)' }}>
            <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No pending questions. Luna will ask when she needs your input.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingQuestions.map(q => (
              <div key={q.id} className="rounded-lg p-4 border" style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {q.priority >= 8 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 mb-1 inline-block">Urgent</span>}
                    <p className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>{q.question}</p>
                    {q.context && <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>{q.context}</p>}
                  </div>
                  <button onClick={() => handleDismissQuestion(q.id)} className="p-1 rounded hover:bg-[var(--theme-bg-secondary)]" style={{ color: 'var(--theme-text-muted)' }} title="Dismiss">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {answeringQuestion === q.id ? (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={questionResponse}
                      onChange={(e) => setQuestionResponse(e.target.value)}
                      placeholder="Type your response..."
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm border"
                      style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAnswerQuestion(q.id)}
                      autoFocus
                    />
                    <button onClick={() => handleAnswerQuestion(q.id)} className="px-3 py-1.5 bg-[var(--theme-accent-primary)] text-white rounded-lg text-xs">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { setAnsweringQuestion(null); setQuestionResponse(''); }} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-secondary)' }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAnsweringQuestion(q.id)}
                    className="mt-2 text-xs hover:underline"
                    style={{ color: 'var(--theme-accent-primary)' }}
                  >
                    Reply to Luna
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}

function noteColor(noteType: string): string {
  switch (noteType) {
    case 'planning': return '#3B82F6';
    case 'observation': return '#8B5CF6';
    case 'finding': return '#10B981';
    case 'decision': return '#F59E0B';
    case 'question': return '#EF4444';
    default: return '#6B7280';
  }
}

