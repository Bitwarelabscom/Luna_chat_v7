'use client';

import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '@/lib/store';
import {
  MessageSquare, Plus, Bot,
  MoreVertical, Trash2, Pencil, Archive,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import clsx from 'clsx';
import { useLayoutStore } from '@/lib/layout-store';

type SessionMode = 'assistant' | 'companion';

function getModeIcon(mode: string) {
  switch (mode) {
    case 'companion':
      return <Bot className="w-3.5 h-3.5 text-pink-400" />;
    default:
      return <MessageSquare className="w-3.5 h-3.5 text-blue-400" />;
  }
}

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Previous 7 Days';
  if (diffDays < 30) return 'Previous 30 Days';
  return 'Older';
}


export function SessionList() {
  const {
    sessions,
    currentSession,
    loadSessions,
    loadSession,
    createSession,
    deleteSession,
    archiveSession,
    renameSession,
  } = useChatStore();

  const { sessionSidebarOpen, toggleSessionSidebar } = useLayoutStore();

  const [sidebarMode, setSidebarMode] = useState<'companion' | 'assistant'>('companion');
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Close context menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = () => setShowMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showMenu]);

  // Focus rename input when starting rename
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleNewChat = async (mode?: SessionMode) => {
    const targetMode = mode ?? sidebarMode;
    const session = await createSession(targetMode);
    await loadSession(session.id);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setShowMenu(null);
    if (confirm('Delete this chat?')) {
      await deleteSession(id);
    }
  };

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setShowMenu(null);
    await archiveSession(id);
  };

  const handleStartRename = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setShowMenu(null);
    setRenamingId(id);
    setRenameValue(currentTitle || '');
  };

  const handleFinishRename = async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  // Filter sessions by current sidebar mode tab
  const filteredSessions = sessions.filter((s) => s.mode === sidebarMode);

  // Group sessions by date
  const groups: Record<string, typeof sessions> = {};
  const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'];
  for (const session of filteredSessions) {
    const group = getDateGroup(session.updatedAt);
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
  }

  // Collapsed state - narrow icon strip
  if (!sessionSidebarOpen) {
    return (
      <div
        className="w-10 flex-shrink-0 flex flex-col items-center py-2 border-r"
        style={{
          background: 'var(--theme-bg-secondary)',
          borderColor: 'var(--theme-border)',
        }}
      >
        <button
          onClick={toggleSessionSidebar}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          title="Expand sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
        <button
          onClick={() => handleNewChat()}
          className="mt-2 p-2 rounded-lg hover:bg-white/10 transition-colors"
          title={`New ${sidebarMode} chat`}
        >
          <Plus className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-64 flex-shrink-0 flex flex-col border-r"
      style={{
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
        <div className="flex rounded-lg overflow-hidden border text-xs" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setSidebarMode('companion')}
            className={sidebarMode === 'companion' ? 'bg-white/15 px-3 py-1' : 'px-3 py-1 hover:bg-white/5'}
            style={{ color: 'var(--theme-text-primary)' }}
          >
            Companion
          </button>
          <button
            onClick={() => setSidebarMode('assistant')}
            className={sidebarMode === 'assistant' ? 'bg-white/15 px-3 py-1' : 'px-3 py-1 hover:bg-white/5'}
            style={{ color: 'var(--theme-text-primary)' }}
          >
            Assistant
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleNewChat()}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title={`New ${sidebarMode} chat`}
          >
            <Plus className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          </button>
          <button
            onClick={toggleSessionSidebar}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto py-2">
        {filteredSessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
            <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No chats yet</p>
          </div>
        ) : (
          groupOrder.map((groupName) => {
            const groupSessions = groups[groupName];
            if (!groupSessions || groupSessions.length === 0) return null;
            return (
              <div key={groupName}>
                <div className="px-4 pt-3 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                    {groupName}
                  </span>
                </div>
                {groupSessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => loadSession(session.id)}
                    className={clsx(
                      'group relative mx-2 mb-0.5 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                      currentSession?.id === session.id ? 'bg-white/10' : 'hover:bg-white/5'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-shrink-0 opacity-60">
                        {getModeIcon(session.mode)}
                      </div>
                      <div className="flex-1 min-w-0">
                        {renamingId === session.id ? (
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleFinishRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFinishRename();
                              if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-sm bg-transparent border-b outline-none"
                            style={{ color: 'var(--theme-text-primary)', borderColor: 'var(--theme-accent-primary)' }}
                          />
                        ) : (
                          <p className="text-sm truncate" style={{ color: 'var(--theme-text-primary)' }}>
                            {session.title || 'New Chat'}
                          </p>
                        )}
                      </div>

                      {/* Three-dot menu */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(showMenu === session.id ? null : session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition-all flex-shrink-0"
                      >
                        <MoreVertical className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-secondary)' }} />
                      </button>
                    </div>

                    {/* Context menu */}
                    {showMenu === session.id && (
                      <div
                        className="absolute right-2 top-full mt-1 z-50 py-1 rounded-lg shadow-xl border min-w-[130px]"
                        style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => handleStartRename(e, session.id, session.title)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/10 transition-colors"
                          style={{ color: 'var(--theme-text-secondary)' }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Rename
                        </button>
                        <button
                          onClick={(e) => handleArchive(e, session.id)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/10 transition-colors"
                          style={{ color: 'var(--theme-text-secondary)' }}
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Archive
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, session.id)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/10 transition-colors text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default SessionList;
