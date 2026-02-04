'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Plus, ChevronRight } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { streamMessage } from '@/lib/api';
import ReactMarkdown from 'react-markdown';

export function ChatView() {
  const {
    sessions,
    currentSession,
    isLoadingSessions,
    isSending,
    streamingContent,
    statusMessage,
    loadSessions,
    loadSession,
    createSession,
    addUserMessage,
    addAssistantMessage,
    setStreamingContent,
    appendStreamingContent,
    setIsSending,
    setStatusMessage,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [projectMode, setProjectMode] = useState(true);
  const [showSessions, setShowSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, streamingContent]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    const message = input.trim();
    setInput('');

    // Create session if none exists
    let sessionId = currentSession?.id;
    if (!sessionId) {
      const session = await createSession('companion');
      sessionId = session.id;
      await loadSession(sessionId);
    }

    addUserMessage(message);
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    try {
      let fullContent = '';
      let messageId = '';

      for await (const chunk of streamMessage(sessionId, message, projectMode)) {
        if (chunk.type === 'content' && chunk.content) {
          fullContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
        } else if (chunk.type === 'done' && chunk.messageId) {
          messageId = chunk.messageId;
          addAssistantMessage(fullContent, messageId, chunk.metrics);
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setStatusMessage('Failed to send message');
    } finally {
      setIsSending(false);
      setStreamingContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = async () => {
    const mode = window.confirm('Start DJ Luna session?') ? 'dj_luna' : 'companion';
    const session = await createSession(mode);
    await loadSession(session.id);
    setShowSessions(false);
  };

  const handleSelectSession = async (id: string) => {
    await loadSession(id);
    setShowSessions(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--terminal-border)]">
        <button
          onClick={() => setShowSessions(!showSessions)}
          className="flex items-center gap-2 text-[var(--terminal-text)]"
        >
          <span className="font-medium truncate max-w-[200px]">
            {currentSession?.title || 'New Chat'}
          </span>
          <ChevronRight size={16} className={`transition-transform ${showSessions ? 'rotate-90' : ''}`} />
        </button>
        <button
          onClick={handleNewChat}
          className="p-2 text-[var(--terminal-accent)] hover:bg-[var(--terminal-surface-hover)] rounded-lg"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Sessions Drawer */}
      {showSessions && (
        <div className="absolute inset-x-0 top-[52px] bottom-0 bg-[var(--terminal-bg)] z-40 overflow-y-auto">
          <div className="p-4 space-y-2">
            {isLoadingSessions ? (
              <div className="text-center py-8 text-[var(--terminal-text-muted)]">Loading...</div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 text-[var(--terminal-text-muted)]">No conversations yet</div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    currentSession?.id === session.id
                      ? 'bg-[var(--terminal-accent)] text-black'
                      : 'bg-[var(--terminal-surface)] hover:bg-[var(--terminal-surface-hover)]'
                  }`}
                >
                  <div className="font-medium truncate">{session.title || 'Untitled'}</div>
                  <div className={`text-xs mt-1 ${
                    currentSession?.id === session.id ? 'opacity-70' : 'text-[var(--terminal-text-muted)]'
                  }`}>
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 hide-scrollbar">
        {currentSession?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'message-user rounded-br-md'
                  : 'message-assistant rounded-bl-md'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Streaming content */}
        {(streamingContent || statusMessage) && (
          <div className="flex justify-start">
            <div className="max-w-[85%] message-assistant rounded-2xl rounded-bl-md px-4 py-3">
              {statusMessage && (
                <div className="text-xs text-[var(--terminal-text-muted)] mb-2 flex items-center gap-2">
                  <div className="w-2 h-2 bg-[var(--terminal-accent)] rounded-full animate-pulse" />
                  {statusMessage}
                </div>
              )}
              {streamingContent && (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--terminal-border)]">
        <div className="flex items-center gap-2 mb-2 px-1">
          <label className="flex items-center gap-2 text-xs text-[var(--terminal-text-muted)]">
            <input
              type="checkbox"
              checked={projectMode}
              onChange={(e) => setProjectMode(e.target.checked)}
              className="rounded border-[var(--terminal-border)] bg-[var(--terminal-surface)] accent-[var(--terminal-accent)]"
            />
            <span>Project Mode</span>
          </label>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Luna..."
            rows={1}
            className="flex-1 px-4 py-3 resize-none min-h-[48px] max-h-[120px]"
            style={{ height: 'auto' }}
            disabled={isSending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            className="p-3 bg-[var(--terminal-accent)] text-black rounded-lg disabled:opacity-50 transition-opacity"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
