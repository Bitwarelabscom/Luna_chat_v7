'use client';

import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '@/lib/store';
import ChatArea from '@/components/ChatArea';
import {
  MessageSquare, Plus, ChevronLeft, ChevronRight,
  Trash2, MoreVertical, Mic, Bot, Music
} from 'lucide-react';
import clsx from 'clsx';

function SessionSidebar({
  isCollapsed,
  onToggle
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const {
    sessions,
    currentSession,
    loadSessions,
    loadSession,
    createSession,
    deleteSession
  } = useChatStore();

  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const modeSelectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Close mode selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeSelectorRef.current && !modeSelectorRef.current.contains(event.target as Node)) {
        setShowModeSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNewChat = async (mode: 'assistant' | 'companion' | 'voice' | 'dj_luna') => {
    const session = await createSession(mode);
    await loadSession(session.id);
    setShowModeSelector(false);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm('Delete this chat?')) {
      await deleteSession(sessionId);
    }
    setShowMenu(null);
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'voice':
        return <Mic className="w-3.5 h-3.5" />;
      case 'companion':
        return <Bot className="w-3.5 h-3.5 text-pink-400" />;
      case 'dj_luna':
        return <Music className="w-3.5 h-3.5 text-yellow-400" />;
      default:
        return <MessageSquare className="w-3.5 h-3.5" />;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (isCollapsed) {
    return (
      <div
        className="w-10 flex-shrink-0 flex flex-col items-center py-2 border-r relative"
        style={{
          background: 'var(--theme-bg-secondary)',
          borderColor: 'var(--theme-border)'
        }}
      >
        <button
          onClick={onToggle}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          title="Expand sidebar"
        >
          <ChevronRight className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <div className="relative" ref={isCollapsed ? modeSelectorRef : undefined}>
          <button
            onClick={() => setShowModeSelector(!showModeSelector)}
            className="mt-2 p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="New chat"
          >
            <Plus className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          </button>
          {showModeSelector && (
            <div
              className="absolute left-full top-0 ml-2 py-1 rounded-lg shadow-xl border min-w-[160px] z-50"
              style={{
                background: 'var(--theme-bg-tertiary)',
                borderColor: 'var(--theme-border)'
              }}
            >
              <button
                onClick={() => handleNewChat('assistant')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/10 transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <div className="text-left">
                  <div style={{ color: 'var(--theme-text-primary)' }}>Assistant</div>
                  <div style={{ color: 'var(--theme-text-muted)' }}>Task-focused help</div>
                </div>
              </button>
              <button
                onClick={() => handleNewChat('companion')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/10 transition-colors"
              >
                <Bot className="w-4 h-4 text-pink-400" />
                <div className="text-left">
                  <div style={{ color: 'var(--theme-text-primary)' }}>Companion</div>
                  <div style={{ color: 'var(--theme-text-muted)' }}>Friendly conversation</div>
                </div>
              </button>
              <button
                onClick={() => handleNewChat('voice')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/10 transition-colors"
              >
                <Mic className="w-4 h-4 text-green-400" />
                <div className="text-left">
                  <div style={{ color: 'var(--theme-text-primary)' }}>Voice</div>
                  <div style={{ color: 'var(--theme-text-muted)' }}>Talk with Luna</div>
                </div>
              </button>
              <button
                onClick={() => handleNewChat('dj_luna')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/10 transition-colors"
              >
                <Music className="w-4 h-4 text-yellow-400" />
                <div className="text-left">
                  <div style={{ color: 'var(--theme-text-primary)' }}>DJ Luna</div>
                  <div style={{ color: 'var(--theme-text-muted)' }}>Suno Music Gen</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-64 flex-shrink-0 flex flex-col border-r"
      style={{
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border)'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'var(--theme-border)' }}>
        <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          Chats
        </span>
        <div className="flex items-center gap-1">
          <div className="relative" ref={!isCollapsed ? modeSelectorRef : undefined}>
            <button
              onClick={() => setShowModeSelector(!showModeSelector)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title="New chat"
            >
              <Plus className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
            </button>
            {showModeSelector && (
              <div
                className="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-xl border min-w-[180px] z-50"
                style={{
                  background: 'var(--theme-bg-tertiary)',
                  borderColor: 'var(--theme-border)'
                }}
              >
                <button
                  onClick={() => handleNewChat('assistant')}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 transition-colors"
                >
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  <div className="text-left">
                    <div className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>Assistant</div>
                    <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Task-focused help</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('companion')}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 transition-colors"
                >
                  <Bot className="w-4 h-4 text-pink-400" />
                  <div className="text-left">
                    <div className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>Companion</div>
                    <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Friendly conversation</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('voice')}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 transition-colors"
                >
                  <Mic className="w-4 h-4 text-green-400" />
                  <div className="text-left">
                    <div className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>Voice</div>
                    <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Talk with Luna</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('dj_luna')}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 transition-colors"
                >
                  <Music className="w-4 h-4 text-yellow-400" />
                  <div className="text-left">
                    <div className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>DJ Luna</div>
                    <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Suno Music Gen</div>
                  </div>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
            <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              No chats yet
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => loadSession(session.id)}
              className={clsx(
                'group relative mx-2 mb-1 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                currentSession?.id === session.id
                  ? 'bg-white/10'
                  : 'hover:bg-white/5'
              )}
            >
              <div className="flex items-start gap-2">
                <div
                  className="mt-0.5 opacity-60"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {getModeIcon(session.mode)}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm truncate"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    {session.title || 'New Chat'}
                  </p>
                  <p
                    className="text-xs truncate"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    {formatDate(session.updatedAt)}
                  </p>
                </div>

                {/* Menu button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(showMenu === session.id ? null : session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition-all"
                >
                  <MoreVertical className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-secondary)' }} />
                </button>
              </div>

              {/* Dropdown menu */}
              {showMenu === session.id && (
                <div
                  className="absolute right-2 top-full mt-1 z-50 py-1 rounded-lg shadow-xl border min-w-[120px]"
                  style={{
                    background: 'var(--theme-bg-tertiary)',
                    borderColor: 'var(--theme-border)'
                  }}
                >
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/10 transition-colors text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ChatWindow() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClick = () => {
      // This will be handled by the SessionSidebar component
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="h-full w-full flex overflow-hidden">
      <SessionSidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="flex-1 min-w-0">
        <ChatArea />
      </div>
    </div>
  );
}

export default ChatWindow;
