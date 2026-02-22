'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, Music2 } from 'lucide-react';
import { chatApi, streamMessage } from '@/lib/api/chat';
import { useDJLunaStore } from '@/lib/dj-luna-store';

const DJ_SESSION_KEY = 'dj-luna-session-id';

const LYRICS_PATTERN = /\[(Verse|Chorus|Bridge|Intro|Outro|Drop|Hook|Pre-Chorus|Post-Chorus|Breakdown|Solo)/i;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  hasLyrics?: boolean;
}

interface DJLunaChatProps {
  onSendToCanvas?: (content: string) => void;
}

export function DJLunaChat({ onSendToCanvas }: DJLunaChatProps) {
  const { sessionId, setSessionId, activeStyle, canvasContent, canvasDirty, setCanvasContent } = useDJLunaStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      setIsInitializing(true);
      try {
        // Check stored session
        let storedId = typeof window !== 'undefined' ? localStorage.getItem(DJ_SESSION_KEY) : null;

        if (storedId) {
          // Verify it still exists
          try {
            const session = await chatApi.getSession(storedId);
            if (session) {
              setSessionId(storedId);
              setMessages(
                (session.messages || [])
                  .filter((m) => m.role !== 'system')
                  .map((m) => ({
                    id: m.id,
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                    hasLyrics: m.role === 'assistant' && LYRICS_PATTERN.test(m.content),
                  }))
              );
              return;
            }
          } catch {
            // Session expired or deleted
            localStorage.removeItem(DJ_SESSION_KEY);
          }
        }

        // Create new session
        const session = await chatApi.createSession({ mode: 'dj_luna', title: 'DJ Luna Studio' });
        setSessionId(session.id);
        if (typeof window !== 'undefined') localStorage.setItem(DJ_SESSION_KEY, session.id);

        // Initial greeting
        setMessages([{
          id: 'init',
          role: 'assistant',
          content: "DJ Luna here. Ready to make some music. Pick a style in the panel to the right, then tell me what we're building - genre, vibe, what the song's about.",
        }]);
      } catch (err) {
        console.error('Failed to initialize DJ Luna session:', err);
      } finally {
        setIsInitializing(false);
      }
    };

    initSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extractLyrics = (content: string): string | null => {
    const match = LYRICS_PATTERN.exec(content);
    if (!match) return null;
    return content.slice(match.index);
  };

  const handleSendToCanvas = useCallback((content: string) => {
    const lyrics = extractLyrics(content);
    if (!lyrics) return;

    if (canvasDirty && canvasContent.trim()) {
      const confirmed = confirm('Replace existing canvas content with these lyrics?');
      if (!confirmed) return;
    }
    setCanvasContent(lyrics, true);
    onSendToCanvas?.(lyrics);
  }, [canvasDirty, canvasContent, setCanvasContent, onSendToCanvas]);

  const handleRegenerateSection = useCallback((section: string) => {
    setInput(`Rewrite just the [${section}] keeping the same style and theme`);
    inputRef.current?.focus();
  }, []);

  // Expose regenerate handler to parent via a custom event
  useEffect(() => {
    const handler = (e: CustomEvent<string>) => handleRegenerateSection(e.detail);
    window.addEventListener('dj-luna:regenerate', handler as EventListener);
    return () => window.removeEventListener('dj-luna:regenerate', handler as EventListener);
  }, [handleRegenerateSection]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !sessionId) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    try {
      let accumulated = '';
      const stream = streamMessage(sessionId, trimmed, false, false, false, activeStyle || undefined);

      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          setStatusMessage(chunk.status || '');
        } else if (chunk.type === 'content') {
          accumulated += chunk.content || '';
          setStreamingContent(accumulated);
        } else if (chunk.type === 'done') {
          const hasLyrics = LYRICS_PATTERN.test(accumulated);
          setMessages((prev) => [
            ...prev,
            {
              id: chunk.messageId || `assistant-${Date.now()}`,
              role: 'assistant',
              content: accumulated,
              hasLyrics,
            },
          ]);
          setStreamingContent('');
          setStatusMessage('');
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'assistant', content: 'Something went wrong. Try again.' },
        ]);
      }
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }, [input, isSending, sessionId, activeStyle]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Music2 size={32} className="text-purple-400 animate-pulse" />
          <span className="text-sm">Starting DJ Luna...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-2' : 'order-1'}`}>
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-1.5 mb-1">
                  <Music2 size={12} className="text-purple-400" />
                  <span className="text-xs text-purple-400 font-medium">DJ Luna</span>
                </div>
              )}
              <div
                className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-tr-sm'
                    : 'bg-gray-800 text-gray-200 rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>
              {msg.hasLyrics && msg.role === 'assistant' && (
                <button
                  onClick={() => handleSendToCanvas(msg.content)}
                  className="mt-1.5 px-3 py-1 bg-purple-900/60 hover:bg-purple-800/80 border border-purple-700/50 text-purple-300 text-xs rounded-lg transition-colors"
                >
                  Send to Canvas
                </button>
              )}
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              <div className="flex items-center gap-1.5 mb-1">
                <Music2 size={12} className="text-purple-400" />
                <span className="text-xs text-purple-400 font-medium">DJ Luna</span>
              </div>
              <div className="bg-gray-800 text-gray-200 rounded-xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed">
                {streamingContent}
                <span className="inline-block w-1.5 h-4 bg-purple-400 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="flex justify-center">
            <span className="text-xs text-gray-500 italic">{statusMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700 bg-gray-900">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell DJ Luna what to write..."
            disabled={isSending}
            rows={2}
            className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-xl px-3 py-2.5 resize-none border border-gray-700 focus:border-purple-500 focus:outline-none placeholder-gray-600 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={isSending || !input.trim()}
            className="p-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0"
          >
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1 px-1">Enter to send, Shift+Enter for newline</p>
      </div>
    </div>
  );
}
