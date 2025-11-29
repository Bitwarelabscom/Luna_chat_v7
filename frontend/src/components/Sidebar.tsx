'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import clsx from 'clsx';
import UserMenu from './UserMenu';
import SettingsModal from './SettingsModal';

export default function Sidebar() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const {
    sessions,
    currentSession,
    isLoadingSessions,
    loadSession,
    createSession,
    deleteSession,
    renameSession,
  } = useChatStore();

  const [isOpen, setIsOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleNewChat = async () => {
    const session = await createSession('assistant');
    loadSession(session.id);
  };

  const handleSelectSession = (id: string) => {
    if (id !== currentSession?.id) {
      loadSession(id);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
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
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-gray-800 rounded-lg"
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
          'fixed lg:relative z-40 h-full w-72 bg-gray-900 border-r border-gray-800 flex flex-col transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-luna-600 flex items-center justify-center">
              <Moon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-white">Luna</h1>
              <p className="text-xs text-gray-400">AI Assistant</p>
            </div>
          </div>

          <button
            onClick={handleNewChat}
            className="w-full py-2.5 px-4 bg-luna-600 hover:bg-luna-700 rounded-lg font-medium transition flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoadingSessions ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-luna-500 border-t-transparent rounded-full" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">
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
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                  )}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />

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
                      className="flex-1 bg-gray-700 px-2 py-0.5 rounded text-sm outline-none"
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
                        className="p-1 hover:bg-gray-700 rounded"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => handleStartEdit(e, session)}
                          className="p-1 hover:bg-gray-700 rounded"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, session.id)}
                          className="p-1 hover:bg-gray-700 rounded text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User section */}
        <div className="p-4 border-t border-gray-800">
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
