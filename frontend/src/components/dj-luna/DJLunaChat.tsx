'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, Music2, Zap, X } from 'lucide-react';
import { chatApi, streamMessage } from '@/lib/api/chat';
import { GENRE_PRESETS } from '@/lib/genre-presets';
import { useDJLunaStore } from '@/lib/dj-luna-store';
import { useThinkingMessage } from '../ThinkingStatus';
import { useSlashCommands } from '@/hooks/useSlashCommands';
import { SlashCommandDropdown } from '../shared/SlashCommandDropdown';
import { ChatInputBadge } from '../shared/ChatInputBadge';

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

/**
 * Extract clean lyrics block from assistant message.
 * Starts at the first section tag and drops trailing paragraphs
 * that contain no section markers (trailing prose/commentary).
 */
function extractLyrics(content: string): string | null {
  const match = LYRICS_PATTERN.exec(content);
  if (!match) return null;
  let lyrics = content.slice(match.index);
  // Drop trailing paragraphs that have no section markers
  const paragraphs = lyrics.split(/\n\n+/);
  while (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1].trim();
    if (!LYRICS_PATTERN.test(last) && !/^\[/.test(last)) {
      paragraphs.pop();
    } else {
      break;
    }
  }
  return paragraphs.join('\n\n').trim();
}

/**
 * Look for a "Style: ..." line anywhere before the lyrics block.
 */
function extractStyle(content: string): string | null {
  const m = content.match(/^Style:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

export function DJLunaChat({ onSendToCanvas }: DJLunaChatProps) {
  const {
    sessionId, setSessionId,
    activeStyle, setActiveStyle,
    activeGenreId,
    canvasContent, canvasDirty, setCanvasContent,
    currentSong, triggerSongGeneration,
  } = useDJLunaStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localSystemBubbles, setLocalSystemBubbles] = useState<{ id: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  // Track which message id had its lyrics sent to canvas
  const [canvasSentMsgId, setCanvasSentMsgId] = useState<string | null>(null);
  // Suno generation confirm dialog state
  const [sunoConfirmMsgId, setSunoConfirmMsgId] = useState<string | null>(null);
  const [sunoGenerating, setSunoGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingPhrase = useThinkingMessage(isSending && !streamingContent, 'dj_luna');

  const addSystemBubble = (text: string) => {
    setLocalSystemBubbles(prev => [...prev, { id: crypto.randomUUID(), text }]);
  };

  const slash = useSlashCommands({
    addSystemBubble,
    sessionId: sessionId,
    mode: 'dj_luna',
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, localSystemBubbles, scrollToBottom]);

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

  const handleSendToCanvas = useCallback((msg: ChatMessage) => {
    const lyrics = extractLyrics(msg.content);
    if (!lyrics) return;

    if (canvasDirty && canvasContent.trim()) {
      const confirmed = confirm('Replace existing canvas content with these lyrics?');
      if (!confirmed) return;
    }
    const style = extractStyle(msg.content);
    if (style) setActiveStyle(style);
    setCanvasContent(lyrics, true);
    onSendToCanvas?.(lyrics);
    setCanvasSentMsgId(msg.id);
  }, [canvasDirty, canvasContent, setCanvasContent, setActiveStyle, onSendToCanvas]);

  // Auto-send to canvas when stream completes and canvas is empty
  const autoSendToCanvas = useCallback((msg: ChatMessage) => {
    if (!canvasContent.trim()) {
      const lyrics = extractLyrics(msg.content);
      if (lyrics) {
        const style = extractStyle(msg.content);
        if (style) setActiveStyle(style);
        setCanvasContent(lyrics, true);
        onSendToCanvas?.(lyrics);
        setCanvasSentMsgId(msg.id);
      }
    }
  }, [canvasContent, setCanvasContent, setActiveStyle, onSendToCanvas]);

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

  const handleGenerateWithSuno = useCallback(async (msg: ChatMessage) => {
    const lyrics = extractLyrics(msg.content);
    if (!lyrics) return;
    const style = extractStyle(msg.content) || activeStyle || 'pop, 120bpm, female vocal';
    const title = currentSong?.title || 'Untitled';
    setSunoGenerating(true);
    try {
      await triggerSongGeneration(title, lyrics, style);
    } catch (err) {
      console.error('Failed to trigger Suno generation:', err);
    } finally {
      setSunoGenerating(false);
      setSunoConfirmMsgId(null);
    }
  }, [activeStyle, currentSong, triggerSongGeneration]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !sessionId) return;

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const handled = await slash.handleSubmit();
      if (handled) {
        setInput('');
        return;
      }
    }

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
      const activeGenrePreset = activeGenreId ? GENRE_PRESETS.find(p => p.id === activeGenreId) : null;
      const genreContext = activeGenrePreset
        ? `Genre: ${activeGenrePreset.name}. Rhyme scheme: ${activeGenrePreset.rhymeScheme}. Syllable range: ${activeGenrePreset.syllableRange.min}-${activeGenrePreset.syllableRange.max} per line. Structure: ${Array.from(new Set(activeGenrePreset.structure.map(s => s.tag))).join(', ')}.`
        : undefined;
      const stream = streamMessage(sessionId, trimmed, false, false, false, activeStyle || undefined, undefined, genreContext, slash.activeSkill?.content);

      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          setStatusMessage(chunk.status || '');
        } else if (chunk.type === 'content') {
          accumulated += chunk.content || '';
          setStreamingContent(accumulated);
        } else if (chunk.type === 'done') {
          const hasLyrics = LYRICS_PATTERN.test(accumulated);
          const newMsg: ChatMessage = {
            id: chunk.messageId || `assistant-${Date.now()}`,
            role: 'assistant',
            content: accumulated,
            hasLyrics,
          };
          setMessages((prev) => [...prev, newMsg]);
          setStreamingContent('');
          setStatusMessage('');
          // Auto-fill canvas if it's empty and lyrics were detected
          if (hasLyrics) {
            autoSendToCanvas(newMsg);
          }
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
  }, [input, isSending, sessionId, activeStyle, autoSendToCanvas, slash]);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.showDropdown) {
      const handled = await slash.handleKeyDown(e);
      if (handled) return;
    }
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
        {messages.map((msg) => {
          const isSent = canvasSentMsgId === msg.id;
          const isConfirming = sunoConfirmMsgId === msg.id;
          return (
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
                  <div className="mt-1.5 flex flex-col gap-1">
                    {/* Send to Canvas / Sent indicator */}
                    {isSent ? (
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 bg-green-900/40 border border-green-700/40 text-green-400 text-xs rounded-lg">
                          Sent to canvas
                        </span>
                        {/* Generate with Suno button */}
                        {!isConfirming && (
                          <button
                            onClick={() => setSunoConfirmMsgId(msg.id)}
                            className="flex items-center gap-1.5 px-3 py-1 bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/50 text-amber-300 text-xs rounded-lg transition-colors"
                          >
                            <Zap size={10} /> Generate with Suno
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSendToCanvas(msg)}
                        className="px-3 py-1 bg-purple-900/60 hover:bg-purple-800/80 border border-purple-700/50 text-purple-300 text-xs rounded-lg transition-colors self-start"
                      >
                        Send to Canvas
                      </button>
                    )}

                    {/* Suno confirmation dialog */}
                    {isConfirming && (
                      <div className="mt-1 p-3 bg-gray-900 border border-amber-600/40 rounded-xl text-xs space-y-2">
                        <div className="text-amber-300 font-semibold flex items-center gap-1.5">
                          <Zap size={12} /> Generate with Suno
                        </div>
                        <div className="text-gray-400 space-y-0.5">
                          <div><span className="text-gray-500">Title:</span> {currentSong?.title || 'Untitled'}</div>
                          <div><span className="text-gray-500">Style:</span> {extractStyle(msg.content) || activeStyle || 'default'}</div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleGenerateWithSuno(msg)}
                            disabled={sunoGenerating}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                          >
                            {sunoGenerating ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                            {sunoGenerating ? 'Queuing...' : 'Generate 1 track'}
                          </button>
                          <button
                            onClick={() => setSunoConfirmMsgId(null)}
                            disabled={sunoGenerating}
                            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

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

        {(statusMessage || (isSending && !streamingContent)) && (
          <div className="flex justify-center">
            <span className="text-xs text-gray-500 italic">{statusMessage || `${thinkingPhrase}...`}</span>
          </div>
        )}

        {/* Local system bubbles (from slash commands) */}
        {localSystemBubbles.map((bubble) => (
          <div key={bubble.id} className="flex justify-center my-1">
            <div className="bg-zinc-800/60 text-zinc-400 text-xs px-3 py-1.5 rounded-full border border-zinc-700/50 font-mono flex items-center gap-1.5 max-w-[90%] whitespace-pre-wrap">
              {bubble.text}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700 bg-gray-900">
        <ChatInputBadge
          activeSkillName={slash.activeBadgeLabel}
          activeModelLabel={slash.activeModelLabel}
          onRemoveSkill={slash.clearActiveSkill}
        />
        <div className="flex gap-2 items-end relative">
          {slash.showDropdown && (
            <SlashCommandDropdown
              items={slash.dropdownItems}
              selectedIndex={slash.selectedIndex}
              onSelect={(idx) => { slash.handleSelect(idx); setInput(''); }}
            />
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={async (e) => { setInput(e.target.value); await slash.handleInputChange(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Tell DJ Luna what to write... (/ for commands)"
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
