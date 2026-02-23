'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, useChatStore } from '@/lib/store';
import {
  Moon,
  Plus,
  MessageSquare,
  Trash2,
  Menu,
  X,
  Pencil,
  Check,
  Heart,
  Mic,
  Archive,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Music,
  Briefcase,
} from 'lucide-react';
import clsx from 'clsx';
import UserMenu from './UserMenu';
import SettingsModal from './SettingsModal';

export default function Sidebar() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const {
    sessions,
    archivedSessions,
    currentSession,
    isLoadingSessions,
    loadSession,
    createSession,
    archiveSession,
    restoreSession,
    deleteSession,
    renameSession,
    loadArchivedSessions,
  } = useChatStore();

  const [isOpen, setIsOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const modeSelectorRef = useRef<HTMLDivElement>(null);

  // Load archived sessions when expanded
  useEffect(() => {
    if (showArchived) {
      loadArchivedSessions();
    }
  }, [showArchived, loadArchivedSessions]);

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

  const getModeIcon = (mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna') => {
    switch (mode) {
      case 'voice': return <Mic className="w-4 h-4 flex-shrink-0 text-green-400" />;
      case 'companion': return <Heart className="w-4 h-4 flex-shrink-0 text-pink-400" />;
      case 'dj_luna': return <Music className="w-4 h-4 flex-shrink-0 text-yellow-400" />;
      case 'ceo_luna': return <Briefcase className="w-4 h-4 flex-shrink-0 text-orange-400" />;
      default: return <MessageSquare className="w-4 h-4 flex-shrink-0" />;
    }
  };

  const handleNewChat = async (mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna') => {
    if (mode === 'dj_luna') {
      router.push('/?open=dj-luna');
      setShowModeSelector(false);
      return;
    }
    if (mode === 'ceo_luna') {
      router.push('/?open=ceo-luna');
      setShowModeSelector(false);
      return;
    }
    const session = await createSession(mode);
    loadSession(session.id);
    setShowModeSelector(false);
  };

  const handleSelectSession = (id: string) => {
    if (id !== currentSession?.id) {
      loadSession(id);
    }
  };

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await archiveSession(id);
  };

  const handleRestore = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await restoreSession(id);
  };

  const handlePermanentDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Permanently delete this conversation? This cannot be undone.')) {
      await deleteSession(id);
    }
  };

  const handleStartEdit = (e: React.MouseEvent, session: { id: string; title: string }) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const handleSaveEdit = async (id: string) => {
    if (editTitle.trim()) {
      await renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-theme-bg-tertiary rounded-lg text-theme-text-primary"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed lg:relative z-40 h-full w-72 bg-theme-bg-secondary border-r border-theme-border flex flex-col transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-theme-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-theme-accent-primary flex items-center justify-center">
              <Moon className="w-5 h-5 text-theme-text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-theme-text-primary">Luna</h1>
              <p className="text-xs text-theme-text-muted">AI Assistant - Beta 0.8.7</p>
            </div>
          </div>

          <div className="relative" ref={modeSelectorRef}>
            <button
              onClick={() => setShowModeSelector(!showModeSelector)}
              className="w-full py-2.5 px-4 bg-theme-accent-primary hover:bg-theme-accent-hover rounded-lg font-medium transition flex items-center justify-center gap-2 text-theme-text-primary"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>

            {showModeSelector && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-theme-bg-tertiary rounded-lg border border-theme-border shadow-lg overflow-hidden z-50">
                <button
                  onClick={() => handleNewChat('assistant')}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-theme-bg-primary transition text-left"
                >
                  <MessageSquare className="w-5 h-5 text-blue-400" />
                  <div>
                    <div className="text-sm font-medium text-theme-text-primary">Assistant</div>
                    <div className="text-xs text-theme-text-muted">Task-focused help</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('companion')}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-theme-bg-primary transition text-left border-t border-theme-border"
                >
                  <Heart className="w-5 h-5 text-pink-400" />
                  <div>
                    <div className="text-sm font-medium text-theme-text-primary">Companion</div>
                    <div className="text-xs text-theme-text-muted">Friendly conversation</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('voice')}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-theme-bg-primary transition text-left border-t border-theme-border"
                >
                  <Mic className="w-5 h-5 text-green-400" />
                  <div>
                    <div className="text-sm font-medium text-theme-text-primary">Voice</div>
                    <div className="text-xs text-theme-text-muted">Talk with Luna</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('dj_luna')}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-theme-bg-primary transition text-left border-t border-theme-border"
                >
                  <Music className="w-5 h-5 text-yellow-400" />
                  <div>
                    <div className="text-sm font-medium text-theme-text-primary">DJ Luna</div>
                    <div className="text-xs text-theme-text-muted">Suno Music Gen</div>
                  </div>
                </button>
                <button
                  onClick={() => handleNewChat('ceo_luna')}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-theme-bg-primary transition text-left border-t border-theme-border"
                >
                  <Briefcase className="w-5 h-5 text-orange-400" />
                  <div>
                    <div className="text-sm font-medium text-theme-text-primary">CEO Luna</div>
                    <div className="text-xs text-theme-text-muted">Business execution mode</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoadingSessions ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-theme-accent-primary border-t-transparent rounded-full" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-center text-theme-text-muted py-8 text-sm">
              No conversations yet
            </p>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={clsx(
                    'group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition',
                    currentSession?.id === session.id
                      ? 'bg-theme-bg-tertiary text-theme-text-primary'
                      : 'text-theme-text-muted hover:bg-theme-bg-tertiary/50 hover:text-theme-text-secondary'
                  )}
                >
                  {getModeIcon(session.mode)}

                  {editingId === session.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(session.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => handleSaveEdit(session.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-theme-bg-primary px-2 py-0.5 rounded text-sm outline-none border border-theme-border text-theme-text-primary"
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 truncate text-sm">{session.title}</span>
                  )}

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    {editingId === session.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveEdit(session.id);
                        }}
                        className="p-1 hover:bg-theme-bg-primary rounded"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => handleStartEdit(e, session)}
                          className="p-1 hover:bg-theme-bg-primary rounded"
                          title="Rename"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleArchive(e, session.id)}
                          className="p-1 hover:bg-theme-bg-primary rounded text-theme-text-muted hover:text-red-400"
                          title="Archive"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Archived sessions section */}
          {(sessions.length > 0 || archivedSessions.length > 0) && (
            <div className="mt-4 border-t border-theme-border pt-2">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-theme-text-muted hover:text-theme-text-secondary transition"
              >
                {showArchived ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <Archive className="w-4 h-4" />
                <span>Archived ({archivedSessions.length})</span>
              </button>

              {showArchived && archivedSessions.length > 0 && (
                <div className="space-y-1 mt-1">
                  {archivedSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => handleSelectSession(session.id)}
                      className="group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition text-theme-text-muted hover:bg-theme-bg-tertiary/50 hover:text-theme-text-secondary opacity-60"
                    >
                      {getModeIcon(session.mode)}
                      <span className="flex-1 truncate text-sm">{session.title}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={(e) => handleRestore(e, session.id)}
                          className="p-1 hover:bg-theme-bg-primary rounded text-green-400"
                          title="Restore"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handlePermanentDelete(e, session.id)}
                          className="p-1 hover:bg-theme-bg-primary rounded text-red-400"
                          title="Delete permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User section */}
        <div className="p-4 border-t border-theme-border">
          <UserMenu
            user={user}
            onLogout={handleLogout}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </div>
      </aside>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}
