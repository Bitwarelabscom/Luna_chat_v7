'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore, useAuthStore } from '@/lib/store';
import { streamMessage, regenerateMessage, chatApi, settingsApi, emailApi, calendarApi, lunaMediaApi, getMediaUrl, type Email, type UserStats, type SystemMetrics, type CalendarEvent, type LunaMediaSelection, type DailyTokenStats, type CreateCalendarEventInput } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import YouTubeEmbed, { parseMediaBlocks } from './YouTubeEmbed';
import ImageEmbed from './ImageEmbed';
import MessageActions from './MessageActions';
import MessageMetrics from './MessageMetrics';
import { useAudioPlayer } from './useAudioPlayer';
import dynamic from 'next/dynamic';
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileBottomNav from './MobileBottomNav';
import MobileSessionsOverlay from './MobileSessionsOverlay';

const VoiceChatArea = dynamic(() => import('./VoiceChatArea'), {
  ssr: false,
  loading: () => <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div style={{ color: '#00ff9f' }}>Loading voice mode...</div></div>
});

import AppearanceTab from './settings/AppearanceTab';
import PromptsTab from './settings/PromptsTab';
import ModelsTab from './settings/ModelsTab';
import IntegrationsTab from './settings/IntegrationsTab';
import TasksTab from './settings/TasksTab';
import StatsTab from './settings/StatsTab';
import DataTab from './settings/DataTab';
import WorkspaceTab from './settings/WorkspaceTab';
import AutonomousTab from './settings/AutonomousTab';
import FriendsTab from './settings/FriendsTab';
import MemoryTab from './settings/MemoryTab';
import TriggersTab from './settings/TriggersTab';
import McpTab from './settings/McpTab';
import QuestionNotification from './QuestionNotification';
import TradingTerminal from './trading/terminal/TradingTerminal';

interface ActivityLog {
  time: string;
  event: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

type MainTab = 'chat' | 'autonomous' | 'friends' | 'tasks' | 'workspace' | 'email' | 'calendar' | 'trading' | 'settings' | 'activity';
type SettingsTab = 'appearance' | 'prompts' | 'models' | 'integrations' | 'mcpconfig' | 'workspace' | 'tasks' | 'memory' | 'autonomous' | 'triggers' | 'stats' | 'data';

// Format token count for compact display
function formatTokenCount(count: number): string {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return count.toString();
}

const CommandCenter = () => {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const {
    sessions,
    currentSession,
    isLoadingSessions,
    isLoadingMessages,
    isSending,
    streamingContent,
    statusMessage,
    startupSuggestions,
    isLoadingStartup,
    loadSessions,
    loadSession,
    createSession,
    deleteSession,
    addUserMessage,
    addAssistantMessage,
    updateMessage,
    removeMessagesFrom,
    appendStreamingContent,
    setIsSending,
    setStreamingContent,
    setStatusMessage,
    setStartupSuggestions,
    clearStartupSuggestions,
    setIsLoadingStartup,
  } = useChatStore();

  const audioPlayer = useAudioPlayer();
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState<{
    messageId: string;
    content: string;
  } | null>(null);

  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<MainTab>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [emails, setEmails] = useState<Email[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [stats, setStats] = useState<UserStats | null>(null);
  const [dailyTokens, setDailyTokens] = useState<DailyTokenStats | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarView, setCalendarView] = useState<'today' | 'week'>('week');
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [eventFormData, setEventFormData] = useState<CreateCalendarEventInput>({
    title: '',
    description: '',
    startAt: '',
    endAt: '',
    location: '',
    isAllDay: false,
    reminderMinutes: null,
  });
  const [customReminderMinutes, setCustomReminderMinutes] = useState('');
  const [eventFormLoading, setEventFormLoading] = useState(false);
  const [showSessions, setShowSessions] = useState(true);
  const [showActivity, setShowActivity] = useState(true);
  const [lunaMedia, setLunaMedia] = useState<LunaMediaSelection | null>(null);
  const [lunaMediaLoading, setLunaMediaLoading] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [emailActionLoading, setEmailActionLoading] = useState<number | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  // Mobile detection
  const isMobile = useIsMobile();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startupTriggeredRef = useRef<string | null>(null);

  // Trigger startup greeting for new sessions
  useEffect(() => {
    const sessionId = currentSession?.id;
    const messages = currentSession?.messages || [];

    if (
      sessionId &&
      messages.length === 0 &&
      !isLoadingMessages &&
      !isLoadingStartup &&
      startupTriggeredRef.current !== sessionId
    ) {
      startupTriggeredRef.current = sessionId;
      triggerStartup(sessionId);
    }
  }, [currentSession?.id, currentSession?.messages?.length, isLoadingMessages, isLoadingStartup]);

  const triggerStartup = async (sessionId: string) => {
    setIsLoadingStartup(true);
    try {
      const { message, suggestions } = await chatApi.getSessionStartup(sessionId);
      addAssistantMessage(message.content, message.id);
      setStartupSuggestions(suggestions);
      addLog('Luna initialized session', 'success');
    } catch (error) {
      console.error('Failed to generate startup message:', error);
    } finally {
      setIsLoadingStartup(false);
    }
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setInput(suggestion);
    clearStartupSuggestions();
    inputRef.current?.focus();
  };

  // Add activity log
  const addLog = useCallback((event: string, type: ActivityLog['type'] = 'info') => {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0];
    setActivityLogs(prev => [{ time, event, type }, ...prev.slice(0, 19)]);
  }, []);

  // Update Luna media based on response and mood
  const updateLunaMedia = useCallback(async (responseContent: string) => {
    try {
      setLunaMediaLoading(true);
      // Extract mood from response or use default
      // The backend will detect mood from the response content
      const mood = 'joy'; // Default mood, will be overridden by context analysis
      const media = await lunaMediaApi.selectMedia(responseContent, mood);
      setLunaMedia(media);
    } catch (error) {
      console.log('Luna media update not available:', error);
    } finally {
      setLunaMediaLoading(false);
    }
  }, []);

  // Load system metrics
  const loadSystemMetrics = useCallback(async () => {
    try {
      const metrics = await settingsApi.getSystemMetrics();
      setSystemMetrics(metrics);
    } catch (error) {
      console.log('System metrics not available');
    }
  }, []);

  // Load calendar events
  const loadCalendarEvents = useCallback(async () => {
    try {
      setCalendarLoading(true);
      const data = calendarView === 'today'
        ? await calendarApi.getToday()
        : await calendarApi.getEvents(7, 20);
      setCalendarEvents(data.events || []);
    } catch (error) {
      console.log('Calendar not available');
    } finally {
      setCalendarLoading(false);
    }
  }, [calendarView]);

  // Load initial data
  useEffect(() => {
    loadSessions();
    loadEmails();
    loadStats();
    loadSystemMetrics();
    // Load default Luna media (neutral video)
    lunaMediaApi.selectMedia('Hello', 'neutral').then(setLunaMedia).catch(() => {});
    addLog('Command center initialized', 'success');
  }, []);

  // Load calendar when tab changes or view changes
  useEffect(() => {
    if (activeTab === 'calendar') {
      loadCalendarEvents();
    }
  }, [activeTab, calendarView, loadCalendarEvents]);

  // Load emails
  const loadEmails = async () => {
    try {
      const [inbox, unread] = await Promise.all([
        emailApi.getInbox(10),
        emailApi.getUnread(),
      ]);
      setEmails(inbox.emails || []);
      setUnreadCount(unread.count || 0);
      if (unread.count > 0) {
        addLog(`${unread.count} unread emails`, 'info');
      }
    } catch (error) {
      console.log('Email not available');
    }
  };

  // Email actions
  const handleMarkEmailRead = async (uid: number, isRead: boolean) => {
    if (!uid) return;
    setEmailActionLoading(uid);
    try {
      await emailApi.markRead(uid, isRead);
      addLog(`Email marked as ${isRead ? 'read' : 'unread'}`, 'success');
      await loadEmails();
    } catch (error) {
      console.error('Failed to mark email:', error);
      addLog('Failed to update email', 'error');
    } finally {
      setEmailActionLoading(null);
    }
  };

  const handleDeleteEmail = async (uid: number) => {
    if (!uid) return;
    if (!confirm('Are you sure you want to delete this email? This action cannot be undone.')) {
      return;
    }
    setEmailActionLoading(uid);
    try {
      await emailApi.deleteEmail(uid);
      addLog('Email deleted', 'success');
      await loadEmails();
    } catch (error) {
      console.error('Failed to delete email:', error);
      addLog('Failed to delete email', 'error');
    } finally {
      setEmailActionLoading(null);
    }
  };

  const handleViewEmail = async (uid: number) => {
    if (!uid) return;
    setEmailActionLoading(uid);
    try {
      const result = await emailApi.getEmail(uid);
      setSelectedEmail(result.email);
      // Mark as read when viewing
      if (!result.email.read) {
        await emailApi.markRead(uid, true);
        await loadEmails();
      }
    } catch (error) {
      console.error('Failed to load email:', error);
      addLog('Failed to load email', 'error');
    } finally {
      setEmailActionLoading(null);
    }
  };

  // Load stats
  const loadStats = async () => {
    try {
      const { stats } = await settingsApi.getStats();
      setStats(stats);
    } catch (error) {
      console.log('Stats not available');
    }
  };

  // Load daily token usage (for header display)
  const loadDailyTokens = useCallback(async () => {
    try {
      const tokens = await settingsApi.getDailyTokens();
      setDailyTokens(tokens);
    } catch (error) {
      console.log('Daily tokens not available');
    }
  }, []);

  // Load daily tokens on mount
  useEffect(() => {
    loadDailyTokens();
  }, [loadDailyTokens]);

  // Poll system metrics every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadSystemMetrics();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadSystemMetrics]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, streamingContent]);

  const getCurrentTime = () => {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
  };

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    const message = input.trim();
    setInput('');

    let sessionId = currentSession?.id;

    // Create new session if needed
    if (!sessionId) {
      const session = await createSession('assistant');
      sessionId = session.id;
      await loadSession(sessionId);
      addLog('New assistant session created', 'success');
    }

    // Add user message
    addUserMessage(message);
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');
    addLog('Processing neural request', 'info');

    try {
      let accumulatedContent = '';
      for await (const chunk of streamMessage(sessionId, message)) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
          const status = chunk.status.toLowerCase();
          let logType: 'info' | 'success' | 'warn' = 'info';

          if (status.includes('complete') || status.includes('success') || status.includes('found') || status.includes('sent')) {
            logType = 'success';
          } else if (status.includes('error') || status.includes('failed') || status.includes('retry')) {
            logType = 'warn';
          }

          addLog(`TOOL: ${chunk.status}`, logType);
        } else if (chunk.type === 'content' && chunk.content) {
          setStatusMessage('');
          accumulatedContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId, chunk.metrics);
          setStreamingContent('');
          setStatusMessage('');
          addLog('Response complete', 'success');
          // Update Luna's media based on response content
          updateLunaMedia(accumulatedContent);
        }
      }
      loadSessions();
      loadDailyTokens(); // Refresh token counts after message
    } catch (error) {
      console.error('Failed to send message:', error);
      addAssistantMessage(
        'Neural pathway error. Please retry transmission.',
        `error-${Date.now()}`
      );
      addLog('Transmission failed', 'error');
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

  const handleSelectSession = (id: string) => {
    if (id !== currentSession?.id) {
      loadSession(id);
      addLog('Session loaded', 'info');
    }
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id);
    addLog('Session terminated', 'warn');
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    if (!currentSession) return;

    try {
      await chatApi.editMessage(currentSession.id, messageId, newContent);
      updateMessage(messageId, newContent);
      addLog('Message edited', 'info');
      // Show confirmation dialog for regeneration
      setShowRegenerateConfirm({ messageId, content: newContent });
    } catch (error) {
      console.error('Failed to edit message:', error);
      addLog('Edit failed', 'error');
    }
  };

  const handleRegenerate = async (messageId: string) => {
    if (!currentSession) return;

    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    // Remove messages from this point
    removeMessagesFrom(messageId);
    addLog('Regenerating response', 'info');

    try {
      let accumulatedContent = '';
      for await (const chunk of regenerateMessage(currentSession.id, messageId)) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
          addLog(`TOOL: ${chunk.status}`, 'info');
        } else if (chunk.type === 'content' && chunk.content) {
          setStatusMessage('');
          accumulatedContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId, chunk.metrics);
          setStreamingContent('');
          setStatusMessage('');
          addLog('Regeneration complete', 'success');
        }
      }
      loadSessions();
    } catch (error) {
      console.error('Failed to regenerate:', error);
      addAssistantMessage(
        'Neural pathway error during regeneration. Please retry.',
        `error-${Date.now()}`
      );
      addLog('Regeneration failed', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handlePlayAudio = (messageId: string, content: string) => {
    audioPlayer.play(messageId, content);
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const formatEventTime = (dateStr: string, isAllDay: boolean) => {
    if (isAllDay) return 'Heldag';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  };

  const formatEventDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  // Format date for datetime-local input
  const formatDateTimeLocal = (date: Date | string) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Calendar event handlers
  const handleOpenNewEventForm = () => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    setEditingEvent(null);
    setEventFormData({
      title: '',
      description: '',
      startAt: formatDateTimeLocal(now),
      endAt: formatDateTimeLocal(oneHourLater),
      location: '',
      isAllDay: false,
      reminderMinutes: null,
    });
    setCustomReminderMinutes('');
    setShowEventForm(true);
  };

  const handleEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event);
    const reminderVal = event.reminderMinutes ?? null;
    const presetValues = [5, 10, 15, 30, 60];
    const isCustom = reminderVal !== null && !presetValues.includes(reminderVal);
    setEventFormData({
      title: event.title,
      description: event.description || '',
      startAt: formatDateTimeLocal(event.startAt),
      endAt: formatDateTimeLocal(event.endAt),
      location: event.location || '',
      isAllDay: event.isAllDay,
      reminderMinutes: isCustom ? -1 : reminderVal,
    });
    setCustomReminderMinutes(isCustom ? String(reminderVal) : '');
    setShowEventForm(true);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) return;
    try {
      await calendarApi.deleteEvent(eventId);
      addLog('Event deleted', 'success');
      loadCalendarEvents();
    } catch (error) {
      console.error('Failed to delete event:', error);
      addLog('Failed to delete event', 'error');
    }
  };

  const handleSaveEvent = async () => {
    if (!eventFormData.title.trim()) {
      alert('Please enter a title');
      return;
    }
    if (!eventFormData.startAt || !eventFormData.endAt) {
      alert('Please enter start and end times');
      return;
    }

    // Resolve custom reminder value
    let finalReminderMinutes: number | null = eventFormData.reminderMinutes ?? null;
    if (finalReminderMinutes === -1) {
      const customVal = parseInt(customReminderMinutes, 10);
      if (!customVal || customVal <= 0) {
        alert('Please enter a valid reminder time in minutes');
        return;
      }
      finalReminderMinutes = customVal;
    }

    const dataToSave = { ...eventFormData, reminderMinutes: finalReminderMinutes };

    setEventFormLoading(true);
    try {
      if (editingEvent) {
        await calendarApi.updateEvent(editingEvent.externalId, dataToSave);
        addLog('Event updated', 'success');
      } else {
        await calendarApi.createEvent(dataToSave);
        addLog('Event created', 'success');
      }
      setShowEventForm(false);
      loadCalendarEvents();
    } catch (error) {
      console.error('Failed to save event:', error);
      addLog('Failed to save event', 'error');
    } finally {
      setEventFormLoading(false);
    }
  };

  // Compact metrics component for header
  const CompactMetrics = () => (
    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
      {/* CPU */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: '#607080', fontSize: '10px', letterSpacing: '1px' }}>CPU</span>
        <div style={{
          width: '60px',
          height: '6px',
          background: '#1a2030',
          borderRadius: '3px',
          overflow: 'hidden',
          border: '1px solid #2a3545'
        }}>
          <div style={{
            width: `${systemMetrics?.cpu.percent || 0}%`,
            height: '100%',
            background: (systemMetrics?.cpu.percent || 0) > 80 ? '#ff6b6b' : '#00ff9f',
            boxShadow: `0 0 6px ${(systemMetrics?.cpu.percent || 0) > 80 ? '#ff6b6b' : '#00ff9f'}60`,
            transition: 'width 0.3s ease'
          }} />
        </div>
        <span style={{
          color: (systemMetrics?.cpu.percent || 0) > 80 ? '#ff6b6b' : '#00ff9f',
          fontSize: '10px',
          fontFamily: 'JetBrains Mono, monospace',
          minWidth: '35px'
        }}>{(systemMetrics?.cpu.percent || 0).toFixed(0)}%</span>
      </div>
      {/* Memory */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: '#607080', fontSize: '10px', letterSpacing: '1px' }}>MEM</span>
        <div style={{
          width: '60px',
          height: '6px',
          background: '#1a2030',
          borderRadius: '3px',
          overflow: 'hidden',
          border: '1px solid #2a3545'
        }}>
          <div style={{
            width: `${systemMetrics?.memory.percent || 0}%`,
            height: '100%',
            background: (systemMetrics?.memory.percent || 0) > 80 ? '#ff6b6b' : '#ffb800',
            boxShadow: `0 0 6px ${(systemMetrics?.memory.percent || 0) > 80 ? '#ff6b6b' : '#ffb800'}60`,
            transition: 'width 0.3s ease'
          }} />
        </div>
        <span style={{
          color: (systemMetrics?.memory.percent || 0) > 80 ? '#ff6b6b' : '#ffb800',
          fontSize: '10px',
          fontFamily: 'JetBrains Mono, monospace',
          minWidth: '35px'
        }}>{(systemMetrics?.memory.percent || 0).toFixed(0)}%</span>
      </div>
    </div>
  );

  const mainTabs: { id: MainTab; label: string }[] = [
    { id: 'chat', label: 'CHAT' },
    { id: 'autonomous', label: 'AUTONOMOUS' },
    { id: 'friends', label: 'FRIENDS' },
    { id: 'tasks', label: 'TASKS' },
    { id: 'workspace', label: 'WORKSPACE' },
    { id: 'email', label: 'EMAIL' },
    { id: 'calendar', label: 'CALENDAR' },
    { id: 'trading', label: 'TRADING' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const settingsTabs: { id: SettingsTab; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'models', label: 'Models' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'mcpconfig', label: 'MCP Servers' },
    { id: 'workspace', label: 'Workspace' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'memory', label: 'Memory' },
    { id: 'autonomous', label: 'Autonomous' },
    { id: 'triggers', label: 'Triggers' },
    { id: 'stats', label: 'Stats' },
    { id: 'data', label: 'Data' },
  ];

  const messages = currentSession?.messages || [];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0e14 0%, #0d1520 50%, #0a0e14 100%)',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      color: '#c0c8d0',
      padding: '20px',
      boxSizing: 'border-box',
    }}>
      {/* Scanline overlay */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
        pointerEvents: 'none',
        zIndex: 1000,
      }} />

      {/* Header - Mobile */}
      {isMobile ? (
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          padding: '12px 16px',
          background: 'linear-gradient(180deg, #151d28 0%, #0d1520 100%)',
          border: '1px solid #2a3545',
          borderRadius: '4px',
        }}>
          {/* Left - Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#00ff9f',
              boxShadow: '0 0 10px #00ff9f, 0 0 20px #00ff9f50',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#00ff9f',
              textShadow: '0 0 10px #00ff9f40',
              letterSpacing: '2px',
            }}>
              LUNA
            </span>
          </div>

          {/* Right - Hamburger Menu */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              background: 'transparent',
              border: '1px solid #2a3545',
              color: '#607080',
              padding: '8px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontFamily: 'inherit',
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {mobileMenuOpen ? '\u2715' : '\u2630'}
          </button>
        </header>
      ) : (
        /* Header - Desktop */
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          padding: '12px 20px',
          background: 'linear-gradient(180deg, #151d28 0%, #0d1520 100%)',
          border: '1px solid #2a3545',
          borderRadius: '4px',
          gap: '16px',
        }}>
          {/* Left - Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#00ff9f',
              boxShadow: '0 0 10px #00ff9f, 0 0 20px #00ff9f50',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#00ff9f',
              textShadow: '0 0 10px #00ff9f40',
              letterSpacing: '2px',
            }}>
              LUNA
            </span>
            <span style={{
              fontSize: '9px',
              color: '#607080',
              marginLeft: '4px',
            }}>
              Beta 0.8.6
            </span>
          </div>

          {/* Center - Main Tabs */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center', flex: 1 }}>
            {mainTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: activeTab === tab.id ? '#00ff9f20' : 'transparent',
                  border: activeTab === tab.id ? '1px solid #00ff9f50' : '1px solid transparent',
                  color: activeTab === tab.id ? '#00ff9f' : '#607080',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontFamily: 'inherit',
                  letterSpacing: '1px',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.id === 'email' && unreadCount > 0 ? `${tab.label} (${unreadCount})` : tab.label}
              </button>
            ))}
          </div>

          {/* Right - Metrics and User */}
          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', alignItems: 'center', flexShrink: 0 }}>
            <CompactMetrics />
            {/* Daily Token Usage Display */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ color: '#607080' }}>IN <span style={{ color: '#00b8ff' }}>{formatTokenCount(dailyTokens?.inputTokens || 0)}</span></span>
              <span style={{ color: '#607080' }}>CACHE <span style={{ color: '#00ff9f' }}>{formatTokenCount(dailyTokens?.cacheTokens || 0)}</span></span>
              <span style={{ color: '#607080' }}>OUT <span style={{ color: '#ff9f00' }}>{formatTokenCount(dailyTokens?.outputTokens || 0)}</span></span>
              {dailyTokens?.estimatedCost ? (
                <span style={{ color: '#607080' }}>(<span style={{ color: '#c0c8d0' }}>${dailyTokens.estimatedCost.toFixed(4)}</span>)</span>
              ) : null}
            </div>
            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                border: '1px solid #ff6b6b50',
                color: '#ff6b6b',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'inherit',
              }}
            >
              LOGOUT
            </button>
          </div>
        </header>
      )}

      {/* Mobile Sessions Overlay */}
      {isMobile && (
        <MobileSessionsOverlay
          sessions={sessions}
          currentSession={currentSession}
          isLoading={isLoadingSessions}
          isOpen={mobileMenuOpen}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          onCreate={async (mode) => {
            const session = await createSession(mode);
            await loadSession(session.id);
            addLog(`${mode} session created`, 'success');
          }}
          onClose={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <main style={{
        background: 'linear-gradient(180deg, #151d28 0%, #0d1520 100%)',
        border: '1px solid #2a3545',
        borderRadius: '4px',
        height: isMobile ? 'calc(100vh - 130px)' : 'calc(100vh - 120px)',
        marginBottom: isMobile ? '60px' : '0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Activity Tab (Mobile only) */}
        {activeTab === 'activity' && isMobile && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {/* Activity Log Header */}
            <div style={{ marginBottom: '16px' }}>
              <span style={{ color: '#607080', fontSize: '12px', letterSpacing: '2px' }}>ACTIVITY LOG</span>
            </div>

            {/* Activity Log Entries */}
            <div style={{ marginBottom: '24px', fontSize: '12px', lineHeight: '1.8' }}>
              {activityLogs.length === 0 ? (
                <div style={{ color: '#607080', textAlign: 'center', padding: '20px' }}>No activity yet</div>
              ) : (
                activityLogs.map((log, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    gap: '12px',
                    padding: '8px 0',
                    borderBottom: '1px solid #1a2030',
                  }}>
                    <span style={{ color: '#607080', flexShrink: 0 }}>{log.time}</span>
                    <span style={{
                      color: log.type === 'success' ? '#00ff9f' : log.type === 'warn' ? '#ffb800' : log.type === 'error' ? '#ff6b6b' : '#808890',
                    }}>
                      {log.event}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Luna Media Section */}
            <div style={{ marginBottom: '16px' }}>
              <span style={{ color: '#607080', fontSize: '12px', letterSpacing: '2px' }}>LUNA</span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              background: '#080c12',
              borderRadius: '8px',
              minHeight: '200px',
            }}>
              {lunaMediaLoading ? (
                <div style={{ color: '#607080', fontSize: '12px' }}>Loading...</div>
              ) : lunaMedia ? (
                lunaMedia.type === 'video' ? (
                  <video
                    key={lunaMedia.url}
                    src={getMediaUrl(lunaMedia.url)}
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{
                      maxWidth: '100%',
                      maxHeight: '300px',
                      objectFit: 'contain',
                      borderRadius: '8px',
                    }}
                  />
                ) : (
                  <img
                    src={getMediaUrl(lunaMedia.url)}
                    alt="Luna"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '300px',
                      objectFit: 'contain',
                      borderRadius: '8px',
                    }}
                  />
                )
              ) : (
                <div style={{ color: '#404550', fontSize: '12px', textAlign: 'center' }}>
                  Luna will appear here<br />based on her mood
                </div>
              )}
            </div>

            {/* Quick Commands */}
            <div style={{ marginTop: '24px' }}>
              <div style={{ fontSize: '12px', color: '#607080', marginBottom: '12px', letterSpacing: '2px' }}>QUICK COMMANDS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {['/status', '/memory', '/email', '/clear'].map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => { setInput(cmd); setActiveTab('chat'); }}
                    style={{
                      background: '#1a2535',
                      border: '1px solid #2a3545',
                      color: '#00b8ff',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '11px',
                      borderRadius: '4px',
                    }}
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Question Notification - floating component */}
            <QuestionNotification onOpenTheater={() => setActiveTab('autonomous')} />

            {/* Sessions Panel (collapsible) - Desktop only */}
            {!isMobile && showSessions && (
              <div style={{
                width: '200px',
                borderRight: '1px solid #2a3545',
                display: 'flex',
                flexDirection: 'column',
                background: '#0d1520',
              }}>
                <div style={{
                  padding: '12px',
                  borderBottom: '1px solid #2a3545',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{ color: '#607080', fontSize: '11px', letterSpacing: '1px' }}>SESSIONS</span>
                  <button
                    onClick={() => setShowSessions(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#607080',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '0 4px',
                    }}
                  >
                    &laquo;
                  </button>
                </div>
                <div style={{ position: 'relative', margin: '10px' }}>
                  <button
                    onClick={() => setShowModeSelector(!showModeSelector)}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                      border: '1px solid #00ff9f50',
                      color: '#00ff9f',
                      padding: '8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontFamily: 'inherit',
                    }}
                  >
                    + NEW SESSION
                  </button>
                  {showModeSelector && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#1a2535',
                      border: '1px solid #00ff9f30',
                      borderRadius: '4px',
                      marginTop: '4px',
                      zIndex: 100,
                      overflow: 'hidden',
                    }}>
                      <button
                        onClick={async () => {
                          const session = await createSession('assistant');
                          await loadSession(session.id);
                          setShowModeSelector(false);
                          addLog('Assistant session created', 'success');
                        }}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          color: '#a0c0ff',
                          padding: '10px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#2a3545'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <strong style={{ display: 'block', marginBottom: '2px' }}>Assistant</strong>
                        <span style={{ color: '#607080', fontSize: '10px' }}>Task-focused help</span>
                      </button>
                      <button
                        onClick={async () => {
                          const session = await createSession('companion');
                          await loadSession(session.id);
                          setShowModeSelector(false);
                          addLog('Companion session created', 'success');
                        }}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          borderTop: '1px solid #2a3545',
                          color: '#ff80c0',
                          padding: '10px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#2a3545'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <strong style={{ display: 'block', marginBottom: '2px' }}>Companion</strong>
                        <span style={{ color: '#607080', fontSize: '10px' }}>Friendly conversation</span>
                      </button>
                      <button
                        onClick={async () => {
                          const session = await createSession('voice');
                          await loadSession(session.id);
                          setShowModeSelector(false);
                          addLog('Voice session created', 'success');
                        }}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          borderTop: '1px solid #2a3545',
                          color: '#00ff9f',
                          padding: '10px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#2a3545'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <strong style={{ display: 'block', marginBottom: '2px' }}>Voice</strong>
                        <span style={{ color: '#607080', fontSize: '10px' }}>Talk with Luna</span>
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px' }}>
                  {isLoadingSessions ? (
                    <div style={{ color: '#607080', textAlign: 'center', padding: '20px', fontSize: '11px' }}>Loading...</div>
                  ) : (
                    sessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => handleSelectSession(session.id)}
                        style={{
                          padding: '8px 10px',
                          background: currentSession?.id === session.id ? '#1a2535' : 'transparent',
                          borderLeft: currentSession?.id === session.id ? '2px solid #00ff9f' : '2px solid transparent',
                          cursor: 'pointer',
                          marginBottom: '4px',
                          borderRadius: '0 4px 4px 0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {session.title}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ff6b6b',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: '10px',
                          }}
                        >
                          X
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Chat Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Toggle buttons bar - Desktop only */}
              {!isMobile && (
                <div style={{
                  padding: '8px 15px',
                  borderBottom: '1px solid #2a3545',
                  display: 'flex',
                  justifyContent: 'space-between',
                  background: '#0a0e14',
                }}>
                  {!showSessions && (
                    <button
                      onClick={() => setShowSessions(true)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #2a3545',
                        color: '#607080',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontFamily: 'inherit',
                      }}
                    >
                      SESSIONS &raquo;
                    </button>
                  )}
                  {showSessions && <div />}
                  {!showActivity && (
                    <button
                      onClick={() => setShowActivity(true)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #2a3545',
                        color: '#607080',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontFamily: 'inherit',
                      }}
                    >
                      &laquo; ACTIVITY
                    </button>
                  )}
                </div>
              )}

              {/* Messages / Voice Chat */}
              {currentSession?.mode === 'voice' ? (
                <VoiceChatArea />
              ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {messages.length === 0 && !streamingContent ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#607080' }}>
                    <div style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                      border: '2px solid #00ff9f50',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '20px',
                    }}>
                      <span style={{ fontSize: '32px', color: '#00ff9f' }}>L</span>
                    </div>
                    <div style={{ fontSize: '14px', marginBottom: '10px', color: '#c0c8d0' }}>LUNA NEURAL CORE</div>
                    <div style={{ fontSize: '12px' }}>
                      {isLoadingStartup ? 'Initializing...' : 'Systems nominal. Awaiting input...'}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div key={msg.id} style={{
                        marginBottom: '15px',
                        padding: '12px 15px',
                        background: msg.role === 'user' ? '#1a2535' : msg.role === 'system' ? 'transparent' : '#0d1520',
                        borderLeft: msg.role === 'user' ? '3px solid #00b8ff' : msg.role === 'system' ? 'none' : '3px solid #00ff9f',
                        borderRadius: '0 4px 4px 0',
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                          fontSize: '11px',
                        }}>
                          <span style={{
                            color: msg.role === 'user' ? '#00b8ff' : msg.role === 'system' ? '#ffb800' : '#00ff9f',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                          }}>
                            {msg.role === 'user' ? (user?.displayName || 'USER') : msg.role === 'system' ? 'SYSTEM' : 'LUNA'}
                          </span>
                          <span style={{ color: '#607080' }}>{new Date(msg.createdAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div style={{
                          fontSize: '14px',
                          lineHeight: '1.6',
                          color: msg.role === 'system' ? '#ffb800' : '#c0c8d0',
                        }}>
                          {msg.role === 'assistant' ? (
                            <div className="prose prose-invert prose-sm max-w-none">
                              {parseMediaBlocks(msg.content).map((block, idx) => (
                                block.type === 'youtube' ? (
                                  <YouTubeEmbed
                                    key={`yt-${idx}`}
                                    videoId={block.videoId}
                                    title={block.title}
                                    channel={block.channel}
                                    duration={block.duration}
                                  />
                                ) : block.type === 'image' ? (
                                  <ImageEmbed
                                    key={`img-${idx}`}
                                    url={block.url}
                                    caption={block.caption}
                                  />
                                ) : (
                                  <ReactMarkdown key={`md-${idx}`}>{block.content}</ReactMarkdown>
                                )
                              ))}
                            </div>
                          ) : (
                            <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                          )}
                        </div>
                        {/* Actions and metrics */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: '8px',
                          paddingTop: '8px',
                          borderTop: '1px solid #2a3545',
                        }}>
                          <MessageActions
                            role={msg.role}
                            content={msg.content}
                            onEdit={msg.role === 'user' ? (newContent) => handleEditMessage(msg.id, newContent) : undefined}
                            onRegenerate={msg.role === 'assistant' ? () => handleRegenerate(msg.id) : undefined}
                            onPlayAudio={msg.role === 'assistant' ? () => handlePlayAudio(msg.id, msg.content) : undefined}
                            isPlaying={audioPlayer.currentMessageId === msg.id && audioPlayer.isPlaying}
                            isLoadingAudio={audioPlayer.currentMessageId === msg.id && audioPlayer.isLoading}
                            disabled={isSending}
                          />
                          <MessageMetrics metrics={msg.metrics} role={msg.role} />
                        </div>
                      </div>
                    ))}

                    {/* Streaming message */}
                    {streamingContent && (
                      <div style={{
                        marginBottom: '15px',
                        padding: '12px 15px',
                        background: '#0d1520',
                        borderLeft: '3px solid #00ff9f',
                        borderRadius: '0 4px 4px 0',
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                          fontSize: '11px',
                        }}>
                          <span style={{ color: '#00ff9f', textTransform: 'uppercase', letterSpacing: '1px' }}>LUNA</span>
                          <span style={{ color: '#607080' }}>{getCurrentTime()}</span>
                        </div>
                        <div className="prose prose-invert prose-sm max-w-none" style={{ fontSize: '14px', lineHeight: '1.6' }}>
                          {parseMediaBlocks(streamingContent).map((block, idx) => (
                            block.type === 'youtube' ? (
                              <YouTubeEmbed
                                key={`yt-stream-${idx}`}
                                videoId={block.videoId}
                                title={block.title}
                                channel={block.channel}
                                duration={block.duration}
                              />
                            ) : block.type === 'image' ? (
                              <ImageEmbed
                                key={`img-stream-${idx}`}
                                url={block.url}
                                caption={block.caption}
                              />
                            ) : (
                              <ReactMarkdown key={`md-stream-${idx}`}>{block.content}</ReactMarkdown>
                            )
                          ))}
                          <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '16px',
                            background: '#00ff9f',
                            marginLeft: '2px',
                            animation: 'blink 1s infinite',
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Loading indicator */}
                    {isSending && !streamingContent && (
                      <div style={{
                        marginBottom: '15px',
                        padding: '12px 15px',
                        background: '#0d1520',
                        borderLeft: '3px solid #00ff9f',
                        borderRadius: '0 4px 4px 0',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <span style={{ width: '8px', height: '8px', background: '#00ff9f', borderRadius: '50%', animation: 'bounce 1s infinite' }} />
                            <span style={{ width: '8px', height: '8px', background: '#00ff9f', borderRadius: '50%', animation: 'bounce 1s infinite 0.15s' }} />
                            <span style={{ width: '8px', height: '8px', background: '#00ff9f', borderRadius: '50%', animation: 'bounce 1s infinite 0.3s' }} />
                          </div>
                          <span style={{ color: '#607080', fontSize: '12px' }}>{statusMessage || 'Processing neural pathways...'}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
              )}

              {/* Suggestion Chips */}
              {startupSuggestions.length > 0 && !isSending && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  padding: '12px 20px',
                  justifyContent: 'center',
                  borderTop: '1px solid #2a3545',
                }}>
                  {startupSuggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionSelect(suggestion)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '20px',
                        background: '#1a2535',
                        border: '1px solid #2a3545',
                        color: '#c0c8d0',
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#00ff9f20';
                        e.currentTarget.style.borderColor = '#00ff9f50';
                        e.currentTarget.style.color = '#00ff9f';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#1a2535';
                        e.currentTarget.style.borderColor = '#2a3545';
                        e.currentTarget.style.color = '#c0c8d0';
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div style={{
                padding: '15px 20px',
                borderTop: '1px solid #2a3545',
                background: '#0d1520',
              }}>
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-end',
                }}>
                  <span style={{ color: '#00ff9f', fontSize: '14px' }}>$</span>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter command..."
                    disabled={isSending}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#c0c8d0',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'none',
                      minHeight: '24px',
                      maxHeight: '120px',
                    }}
                    rows={1}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isSending}
                    style={{
                      background: isSending ? '#1a2030' : 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                      border: '1px solid #00ff9f50',
                      color: isSending ? '#607080' : '#00ff9f',
                      padding: '8px 20px',
                      borderRadius: '4px',
                      cursor: isSending ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      fontFamily: 'inherit',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {isSending ? 'PROCESSING' : 'EXECUTE'}
                  </button>
                </div>
              </div>
            </div>

            {/* Activity Log Panel (collapsible) - Desktop only */}
            {!isMobile && showActivity && (
              <div style={{
                width: '280px',
                borderLeft: '1px solid #2a3545',
                display: 'flex',
                flexDirection: 'column',
                background: '#0d1520',
              }}>
                {/* Activity Log Header */}
                <div style={{
                  padding: '12px',
                  borderBottom: '1px solid #2a3545',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <button
                    onClick={() => setShowActivity(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#607080',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '0 4px',
                    }}
                  >
                    &raquo;
                  </button>
                  <span style={{ color: '#607080', fontSize: '11px', letterSpacing: '1px' }}>ACTIVITY LOG</span>
                </div>

                {/* Activity Log Entries - Top Half */}
                <div style={{ height: '40%', overflowY: 'auto', padding: '10px', fontSize: '11px', lineHeight: '1.8', borderBottom: '1px solid #2a3545' }}>
                  {activityLogs.map((log, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      gap: '10px',
                      padding: '5px 0',
                      borderBottom: '1px solid #1a2030',
                    }}>
                      <span style={{ color: '#607080', flexShrink: 0 }}>{log.time}</span>
                      <span style={{
                        color: log.type === 'success' ? '#00ff9f' : log.type === 'warn' ? '#ffb800' : log.type === 'error' ? '#ff6b6b' : '#808890',
                      }}>
                        {log.event}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Luna Media Section - Bottom Half */}
                <div style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #2a3545',
                  background: '#0a0e14',
                }}>
                  <span style={{ color: '#607080', fontSize: '11px', letterSpacing: '1px' }}>LUNA</span>
                </div>
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '10px',
                  background: '#080c12',
                  minHeight: '200px',
                }}>
                  {lunaMediaLoading ? (
                    <div style={{ color: '#607080', fontSize: '11px' }}>Loading...</div>
                  ) : lunaMedia ? (
                    lunaMedia.type === 'video' ? (
                      <video
                        key={lunaMedia.url}
                        src={getMediaUrl(lunaMedia.url)}
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                          borderRadius: '8px',
                        }}
                      />
                    ) : (
                      <img
                        src={getMediaUrl(lunaMedia.url)}
                        alt="Luna"
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                          borderRadius: '8px',
                        }}
                      />
                    )
                  ) : (
                    <div style={{ color: '#404550', fontSize: '11px', textAlign: 'center' }}>
                      Luna will appear here<br />based on her mood
                    </div>
                  )}
                </div>

                {/* Quick Commands */}
                <div style={{
                  padding: '12px',
                  borderTop: '1px solid #2a3545',
                  background: '#0a0e14',
                }}>
                  <div style={{ fontSize: '11px', color: '#607080', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Quick Commands</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {['/status', '/memory', '/email', '/clear'].map((cmd) => (
                      <button
                        key={cmd}
                        onClick={() => setInput(cmd)}
                        style={{
                          background: '#1a2535',
                          border: '1px solid #2a3545',
                          color: '#00b8ff',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '10px',
                          borderRadius: '3px',
                        }}
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Workspace Tab */}
        {activeTab === 'workspace' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <div className="settings-content">
              <WorkspaceTab />
            </div>
          </div>
        )}

        {/* Autonomous Tab */}
        {activeTab === 'autonomous' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <div className="settings-content">
              <AutonomousTab />
            </div>
          </div>
        )}

        {/* Friends Tab */}
        {activeTab === 'friends' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <div className="settings-content">
              <FriendsTab />
            </div>
          </div>
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <div className="settings-content">
              <TasksTab />
            </div>
          </div>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ color: '#607080', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>
                Inbox ({unreadCount} unread)
              </div>
              <button
                onClick={loadEmails}
                style={{
                  background: 'transparent',
                  border: '1px solid #2a3545',
                  color: '#607080',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontFamily: 'inherit',
                }}
              >
                REFRESH
              </button>
            </div>

            {emails.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#607080' }}>
                <div style={{ fontSize: '14px', marginBottom: '10px' }}>No emails available</div>
                <div style={{ fontSize: '12px' }}>Connect your email in Settings &rarr; Integrations</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {emails.map((email) => (
                  <div key={email.id} style={{
                    padding: '15px 20px',
                    background: email.read ? '#0a0e14' : '#1a253520',
                    borderLeft: email.read ? '3px solid transparent' : '3px solid #ffb800',
                    border: '1px solid #2a3545',
                    borderRadius: '0 4px 4px 0',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ color: '#00b8ff', fontSize: '12px' }}>{email.from}</span>
                      <span style={{ color: '#607080', fontSize: '11px' }}>
                        {new Date(email.date).toLocaleString('sv-SE')}
                      </span>
                    </div>
                    <div style={{ color: '#c0c8d0', fontSize: '14px', marginBottom: '10px' }}>{email.subject}</div>
                    {/* Email Actions */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => email.uid && handleViewEmail(email.uid)}
                        disabled={!email.uid || emailActionLoading === email.uid}
                        style={{
                          background: '#1a2535',
                          border: '1px solid #2a3545',
                          color: '#00b8ff',
                          padding: '4px 10px',
                          borderRadius: '3px',
                          cursor: email.uid ? 'pointer' : 'not-allowed',
                          fontSize: '10px',
                          fontFamily: 'inherit',
                          opacity: emailActionLoading === email.uid ? 0.5 : 1,
                        }}
                      >
                        {emailActionLoading === email.uid ? '...' : 'VIEW'}
                      </button>
                      <button
                        onClick={() => email.uid && handleMarkEmailRead(email.uid, !email.read)}
                        disabled={!email.uid || emailActionLoading === email.uid}
                        style={{
                          background: '#1a2535',
                          border: '1px solid #2a3545',
                          color: email.read ? '#ffb800' : '#00ff9f',
                          padding: '4px 10px',
                          borderRadius: '3px',
                          cursor: email.uid ? 'pointer' : 'not-allowed',
                          fontSize: '10px',
                          fontFamily: 'inherit',
                          opacity: emailActionLoading === email.uid ? 0.5 : 1,
                        }}
                      >
                        {email.read ? 'MARK UNREAD' : 'MARK READ'}
                      </button>
                      <button
                        onClick={() => email.uid && handleDeleteEmail(email.uid)}
                        disabled={!email.uid || emailActionLoading === email.uid}
                        style={{
                          background: '#1a2535',
                          border: '1px solid #ff6b6b50',
                          color: '#ff6b6b',
                          padding: '4px 10px',
                          borderRadius: '3px',
                          cursor: email.uid ? 'pointer' : 'not-allowed',
                          fontSize: '10px',
                          fontFamily: 'inherit',
                          opacity: emailActionLoading === email.uid ? 0.5 : 1,
                        }}
                      >
                        DELETE
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setCalendarView('today')}
                  style={{
                    background: calendarView === 'today' ? '#00ff9f20' : 'transparent',
                    border: calendarView === 'today' ? '1px solid #00ff9f50' : '1px solid #2a3545',
                    color: calendarView === 'today' ? '#00ff9f' : '#607080',
                    padding: '6px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'inherit',
                  }}
                >
                  TODAY
                </button>
                <button
                  onClick={() => setCalendarView('week')}
                  style={{
                    background: calendarView === 'week' ? '#00ff9f20' : 'transparent',
                    border: calendarView === 'week' ? '1px solid #00ff9f50' : '1px solid #2a3545',
                    color: calendarView === 'week' ? '#00ff9f' : '#607080',
                    padding: '6px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'inherit',
                  }}
                >
                  WEEK
                </button>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleOpenNewEventForm}
                  style={{
                    background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                    border: '1px solid #00ff9f50',
                    color: '#00ff9f',
                    padding: '6px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'inherit',
                  }}
                >
                  + NEW EVENT
                </button>
                <button
                  onClick={loadCalendarEvents}
                  style={{
                    background: 'transparent',
                    border: '1px solid #2a3545',
                    color: '#607080',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: 'inherit',
                  }}
                >
                  REFRESH
                </button>
              </div>
            </div>

            {calendarLoading ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#607080', fontSize: '12px' }}>
                Loading...
              </div>
            ) : calendarEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#607080' }}>
                <div style={{ fontSize: '14px', marginBottom: '10px' }}>No upcoming events</div>
                <div style={{ fontSize: '12px', marginBottom: '20px' }}>Create a new event or connect your calendar in Settings</div>
                <button
                  onClick={handleOpenNewEventForm}
                  style={{
                    background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                    border: '1px solid #00ff9f50',
                    color: '#00ff9f',
                    padding: '10px 24px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                  }}
                >
                  + CREATE EVENT
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {calendarEvents.map((event) => (
                  <div key={event.id} style={{
                    padding: '15px 20px',
                    background: '#0a0e14',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    borderLeft: '3px solid #00b8ff',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ color: '#c0c8d0', fontSize: '14px', fontWeight: 500 }}>
                          {event.title}
                        </span>
                        {event.description && (
                          <div style={{ color: '#808890', fontSize: '12px', marginTop: '4px' }}>
                            {event.description}
                          </div>
                        )}
                        {event.location && (
                          <div style={{ color: '#607080', fontSize: '12px', marginTop: '6px' }}>
                            @ {event.location}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                        <div style={{ color: '#00b8ff', fontSize: '12px' }}>
                          {formatEventTime(event.startAt, event.isAllDay)}
                        </div>
                        <div style={{ color: '#607080', fontSize: '11px' }}>
                          {formatEventDate(event.startAt)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #1a2535' }}>
                      <button
                        onClick={() => handleEditEvent(event)}
                        style={{
                          background: '#1a2535',
                          border: '1px solid #2a3545',
                          color: '#00b8ff',
                          padding: '4px 10px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '10px',
                          fontFamily: 'inherit',
                        }}
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => handleDeleteEvent(event.externalId)}
                        style={{
                          background: '#1a2535',
                          border: '1px solid #ff6b6b50',
                          color: '#ff6b6b',
                          padding: '4px 10px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '10px',
                          fontFamily: 'inherit',
                        }}
                      >
                        DELETE
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Trading Tab */}
        {activeTab === 'trading' && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <TradingTerminal />
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Settings sidebar */}
            <div style={{
              width: '180px',
              borderRight: '1px solid #2a3545',
              padding: '15px 0',
              overflowY: 'auto',
              background: '#0d1520',
            }}>
              {settingsTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSettingsTab(tab.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 20px',
                    background: settingsTab === tab.id ? '#00ff9f10' : 'transparent',
                    borderLeft: settingsTab === tab.id ? '3px solid #00ff9f' : '3px solid transparent',
                    color: settingsTab === tab.id ? '#00ff9f' : '#c0c8d0',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '12px',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Settings content */}
            <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
              <div className="settings-content">
                {settingsTab === 'appearance' && <AppearanceTab />}
                {settingsTab === 'prompts' && <PromptsTab />}
                {settingsTab === 'models' && <ModelsTab />}
                {settingsTab === 'integrations' && <IntegrationsTab />}
                {settingsTab === 'mcpconfig' && <McpTab />}
                {settingsTab === 'workspace' && <WorkspaceTab />}
                {settingsTab === 'tasks' && <TasksTab />}
                {settingsTab === 'memory' && <MemoryTab />}
                {settingsTab === 'autonomous' && <AutonomousTab />}
                {settingsTab === 'triggers' && <TriggersTab />}
                {settingsTab === 'stats' && <StatsTab />}
                {settingsTab === 'data' && <DataTab />}
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }

        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: #0a0e14;
        }
        ::-webkit-scrollbar-thumb {
          background: #2a3545;
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #3a4555;
        }

        * {
          box-sizing: border-box;
        }

        .prose {
          color: #c0c8d0;
        }
        .prose code {
          background: #1a2535;
          padding: 2px 6px;
          border-radius: 4px;
          color: #00ff9f;
        }
        .prose pre {
          background: #0a0e14;
          border: 1px solid #2a3545;
          border-radius: 4px;
          padding: 12px;
          overflow-x: auto;
        }
        .prose pre code {
          background: transparent;
          padding: 0;
        }
        .prose a {
          color: #00b8ff;
        }
        .prose strong {
          color: #ffb800;
        }

        /* Settings content styling to work with Tailwind components */
        .settings-content {
          background: transparent;
        }
        .settings-content input,
        .settings-content select,
        .settings-content textarea {
          background: #0a0e14 !important;
          border: 1px solid #2a3545 !important;
          color: #c0c8d0 !important;
        }
        .settings-content button {
          font-family: 'JetBrains Mono', monospace;
        }
      `}</style>

      {/* Email viewer modal */}
      {selectedEmail && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={() => setSelectedEmail(null)}
          />
          <div style={{
            position: 'relative',
            width: '90%',
            maxWidth: '700px',
            maxHeight: '80vh',
            background: '#0d1218',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid #2a3545',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#c0c8d0', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                  {selectedEmail.subject}
                </div>
                <div style={{ color: '#00b8ff', fontSize: '13px', marginBottom: '4px' }}>
                  From: {selectedEmail.from}
                </div>
                <div style={{ color: '#607080', fontSize: '12px' }}>
                  {new Date(selectedEmail.date).toLocaleString('sv-SE')}
                </div>
              </div>
              <button
                onClick={() => setSelectedEmail(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#607080',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0 5px',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
            {/* Body */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '20px',
              color: '#c0c8d0',
              fontSize: '14px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {selectedEmail.body}
            </div>
          </div>
        </div>
      )}

      {/* Calendar Event Form Modal */}
      {showEventForm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={() => setShowEventForm(false)}
          />
          <div style={{
            position: 'relative',
            width: '90%',
            maxWidth: '500px',
            background: '#0d1218',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #2a3545',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ color: '#00ff9f', fontSize: '14px', fontWeight: 600 }}>
                {editingEvent ? 'Edit Event' : 'New Event'}
              </span>
              <button
                onClick={() => setShowEventForm(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#607080',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '0 5px',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            {/* Form */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', color: '#607080', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Title *
                </label>
                <input
                  type="text"
                  value={eventFormData.title}
                  onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                  placeholder="Event title"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#0a0e14',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    color: '#c0c8d0',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#607080', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Start * (YYYY-MM-DD HH:MM)
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="2025-12-08"
                    value={eventFormData.startAt.split('T')[0] || ''}
                    onChange={(e) => {
                      const time = eventFormData.startAt.split('T')[1] || '12:00';
                      setEventFormData({ ...eventFormData, startAt: `${e.target.value}T${time}` });
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      background: '#0a0e14',
                      border: '1px solid #2a3545',
                      borderRadius: '4px',
                      color: '#c0c8d0',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="14:30"
                    value={eventFormData.startAt.split('T')[1] || ''}
                    onChange={(e) => {
                      const date = eventFormData.startAt.split('T')[0] || new Date().toISOString().split('T')[0];
                      setEventFormData({ ...eventFormData, startAt: `${date}T${e.target.value}` });
                    }}
                    style={{
                      width: '80px',
                      padding: '10px 12px',
                      background: '#0a0e14',
                      border: '1px solid #2a3545',
                      borderRadius: '4px',
                      color: '#c0c8d0',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: '#607080', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  End * (YYYY-MM-DD HH:MM)
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="2025-12-08"
                    value={eventFormData.endAt.split('T')[0] || ''}
                    onChange={(e) => {
                      const time = eventFormData.endAt.split('T')[1] || '13:00';
                      setEventFormData({ ...eventFormData, endAt: `${e.target.value}T${time}` });
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      background: '#0a0e14',
                      border: '1px solid #2a3545',
                      borderRadius: '4px',
                      color: '#c0c8d0',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="15:30"
                    value={eventFormData.endAt.split('T')[1] || ''}
                    onChange={(e) => {
                      const date = eventFormData.endAt.split('T')[0] || new Date().toISOString().split('T')[0];
                      setEventFormData({ ...eventFormData, endAt: `${date}T${e.target.value}` });
                    }}
                    style={{
                      width: '80px',
                      padding: '10px 12px',
                      background: '#0a0e14',
                      border: '1px solid #2a3545',
                      borderRadius: '4px',
                      color: '#c0c8d0',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: '#607080', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Location
                </label>
                <input
                  type="text"
                  value={eventFormData.location}
                  onChange={(e) => setEventFormData({ ...eventFormData, location: e.target.value })}
                  placeholder="Location (optional)"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#0a0e14',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    color: '#c0c8d0',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#607080', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Description
                </label>
                <textarea
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                  placeholder="Description (optional)"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#0a0e14',
                    border: '1px solid #2a3545',
                    borderRadius: '4px',
                    color: '#c0c8d0',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="isAllDay"
                  checked={eventFormData.isAllDay}
                  onChange={(e) => setEventFormData({ ...eventFormData, isAllDay: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: '#00ff9f' }}
                />
                <label htmlFor="isAllDay" style={{ color: '#c0c8d0', fontSize: '13px', cursor: 'pointer' }}>
                  All-day event
                </label>
              </div>

              <div>
                <label style={{ display: 'block', color: '#607080', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Telegram Reminder
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    value={eventFormData.reminderMinutes ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setEventFormData({ ...eventFormData, reminderMinutes: null });
                        setCustomReminderMinutes('');
                      } else if (val === '-1') {
                        setEventFormData({ ...eventFormData, reminderMinutes: -1 });
                      } else {
                        setEventFormData({ ...eventFormData, reminderMinutes: parseInt(val, 10) });
                        setCustomReminderMinutes('');
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      background: '#0a0e14',
                      border: '1px solid #2a3545',
                      borderRadius: '4px',
                      color: '#c0c8d0',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">No reminder</option>
                    <option value="5">5 minutes before</option>
                    <option value="10">10 minutes before</option>
                    <option value="15">15 minutes before</option>
                    <option value="30">30 minutes before</option>
                    <option value="60">1 hour before</option>
                    <option value="-1">Custom...</option>
                  </select>
                  {eventFormData.reminderMinutes === -1 && (
                    <input
                      type="number"
                      min="1"
                      placeholder="min"
                      value={customReminderMinutes}
                      onChange={(e) => setCustomReminderMinutes(e.target.value)}
                      style={{
                        width: '80px',
                        padding: '10px 12px',
                        background: '#0a0e14',
                        border: '1px solid #2a3545',
                        borderRadius: '4px',
                        color: '#c0c8d0',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                        outline: 'none',
                      }}
                    />
                  )}
                </div>
                <span style={{ display: 'block', color: '#607080', fontSize: '10px', marginTop: '4px' }}>
                  Requires Telegram to be connected
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid #2a3545',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
            }}>
              <button
                onClick={() => setShowEventForm(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '4px',
                  background: '#1a2535',
                  border: '1px solid #2a3545',
                  color: '#c0c8d0',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEvent}
                disabled={eventFormLoading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '4px',
                  background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                  border: '1px solid #00ff9f50',
                  color: '#00ff9f',
                  cursor: eventFormLoading ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  opacity: eventFormLoading ? 0.5 : 1,
                }}
              >
                {eventFormLoading ? 'Saving...' : editingEvent ? 'Update Event' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate confirmation dialog */}
      {showRegenerateConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
        }}>
          <div style={{
            background: 'linear-gradient(180deg, #151d28 0%, #0d1520 100%)',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '400px',
            margin: '0 16px',
          }}>
            <h3 style={{ color: '#00ff9f', marginBottom: '12px', fontSize: '16px' }}>
              Message edited
            </h3>
            <p style={{ color: '#c0c8d0', marginBottom: '20px', fontSize: '14px', lineHeight: '1.5' }}>
              Would you like Luna to generate a new response based on your edited message?
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowRegenerateConfirm(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  background: '#1a2535',
                  border: '1px solid #2a3545',
                  color: '#c0c8d0',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                Keep current
              </button>
              <button
                onClick={() => {
                  const { messageId } = showRegenerateConfirm;
                  setShowRegenerateConfirm(null);
                  // Find next assistant message after this user message
                  const msgIndex = messages.findIndex(m => m.id === messageId);
                  const nextAssistantMsg = messages.slice(msgIndex + 1).find(m => m.role === 'assistant');
                  if (nextAssistantMsg) {
                    handleRegenerate(nextAssistantMsg.id);
                  }
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
                  border: '1px solid #00ff9f50',
                  color: '#00ff9f',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileBottomNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          unreadCount={unreadCount}
        />
      )}
    </div>
  );
};

export default CommandCenter;
