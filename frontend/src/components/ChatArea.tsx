'use client';

import { useState, useRef, useEffect, useMemo, ChangeEvent } from 'react';
import { useChatStore } from '@/lib/store';
import { useActivityStore } from '@/lib/activity-store';
import { streamMessage, streamMessageWithFiles, regenerateMessage, chatApi } from '@/lib/api';
import { Send, Moon, Loader2, Mic, Sparkles, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import MessageActions from './MessageActions';
import MessageMetrics from './MessageMetrics';
import { useAudioPlayer } from './useAudioPlayer';
import { parseMediaBlocks } from './YouTubeEmbed';
import ImageEmbed from './ImageEmbed';
import { AttachmentCard } from './AttachmentCard';
import { FileChip } from './FileChip';
import { useThinkingMessage } from './ThinkingStatus';
import { ModelSelector } from './os/ModelSelector';
import dynamic from 'next/dynamic';
import SuggestionChips from './SuggestionChips';
import { useWindowStore } from '@/lib/window-store';

const VoiceChatArea = dynamic(() => import('./VoiceChatArea'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-theme-accent-primary" /></div>
});

export default function ChatArea() {
  const { currentSession } = useChatStore();

  // Render VoiceChatArea for voice mode sessions
  if (currentSession?.mode === 'voice') {
    return <VoiceChatArea />;
  }

  return <StandardChatArea />;
}

function TogglePill({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'px-3 py-1 rounded-full text-xs font-medium transition-all select-none',
        active
          ? 'bg-theme-accent-primary/20 text-theme-accent-primary border border-theme-accent-primary/40'
          : 'bg-theme-bg-tertiary text-theme-text-secondary border border-transparent hover:bg-white/10'
      )}
    >
      {label}
    </button>
  );
}

function pickRandomSuggestions(suggestions: string[], count: number): string[] {
  if (suggestions.length <= count) return suggestions;
  const shuffled = [...suggestions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function StandardChatArea() {
  const pulseLunaControl = useWindowStore((state) => state.pulseLunaControl);
  const {
    currentSession,
    isLoadingMessages,
    isSending,
    streamingContent,
    reasoningContent,
    statusMessage,
    isLoadingStartup,
    startupSuggestions,
    loadSessions,
    createSession,
    loadSession,
    addUserMessage,
    addAssistantMessage,
    updateMessage,
    removeMessagesFrom,
    appendStreamingContent,
    appendReasoningContent,
    setIsSending,
    setStreamingContent,
    setReasoningContent,
    setStatusMessage,
    setIsLoadingStartup,
    fetchSuggestions,
    clearStartupSuggestions,
    setBrowserAction,
    setVideoAction,
    setMediaAction,
    setCanvasAction,
  } = useChatStore();

  const thinkingPhrase = useThinkingMessage(isSending && !streamingContent);

  // Track background reflection status
  const activities = useActivityStore((state) => state.activities);
  const [waitingForReview, setWaitingForReview] = useState(false);
  const lastMessageTimeRef = useRef<number>(0);

  // When message send completes, start waiting for review
  useEffect(() => {
    if (!isSending && lastMessageTimeRef.current > 0) {
      // Message just completed - start showing reflection indicator
      setWaitingForReview(true);
      // Auto-hide after 15 seconds if no review comes in
      const timer = setTimeout(() => setWaitingForReview(false), 15000);
      return () => clearTimeout(timer);
    }
  }, [isSending]);

  // Track when we start sending
  useEffect(() => {
    if (isSending) {
      lastMessageTimeRef.current = Date.now();
    }
  }, [isSending]);

  // When a response_review activity comes in, stop showing reflection
  useEffect(() => {
    if (!currentSession?.id || !waitingForReview) return;
    const hasRecentReview = activities.some(
      (a) =>
        a.category === 'background' &&
        a.eventType === 'response_review' &&
        a.sessionId === currentSession.id &&
        new Date(a.createdAt).getTime() > lastMessageTimeRef.current
    );
    if (hasRecentReview) {
      setWaitingForReview(false);
    }
  }, [activities, currentSession?.id, waitingForReview]);

  // Show reflection indicator when waiting for review
  const isReflecting = waitingForReview;

  const audioPlayer = useAudioPlayer();
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState<{
    messageId: string;
    content: string;
  } | null>(null);

  const [input, setInput] = useState('');
  const [projectMode, setProjectMode] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [novaMode, setNovaMode] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentSession?.messages, streamingContent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      // Max height is 50% of viewport for comfortable viewing of long prompts
      const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.5 : 400;
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
    }
  }, [input]);

  // Auto-focus input after sending completes and on mount
  useEffect(() => {
    if (!isSending && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isSending]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [currentSession?.id]);

  useEffect(() => {
    const session = currentSession;
    if (!session || isLoadingMessages) return;
    if (session.messages.length > 0) return;
    fetchSuggestions(session.mode);
  }, [currentSession?.id, currentSession?.mode, currentSession?.messages?.length, isLoadingMessages, fetchSuggestions]);

  useEffect(() => {
    if (isSending) {
      clearStartupSuggestions();
    }
  }, [isSending, clearStartupSuggestions]);

  // End session on browser close/tab close to trigger memory consolidation
  useEffect(() => {
    const sessionId = currentSession?.id;
    if (!sessionId) return;

    const handleBeforeUnload = () => {
      // Use fetch with keepalive for reliable delivery during page unload
      // This triggers MemoryCore consolidation (Working Memory → Episodic)
      fetch(`/api/chat/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true, // Ensures request survives page navigation
        body: JSON.stringify({}),
      }).catch(() => {}); // Ignore errors on unload
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentSession?.id]);

  // Startup message trigger DISABLED - wait for user input instead
  // const startupTriggeredRef = useRef<string | null>(null);
  // useEffect(() => {
  //   const sessionId = currentSession?.id;
  //   const messages = currentSession?.messages || [];
  //   if (
  //     sessionId &&
  //     messages.length === 0 &&
  //     !isLoadingMessages &&
  //     !isLoadingStartup &&
  //     startupTriggeredRef.current !== sessionId
  //   ) {
  //     startupTriggeredRef.current = sessionId;
  //     triggerStartup(sessionId);
  //   }
  // }, [currentSession?.id, currentSession?.messages?.length, isLoadingMessages, isLoadingStartup]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const triggerStartup = async (sessionId: string) => {
    setIsLoadingStartup(true);
    try {
      const { message } = await chatApi.getSessionStartup(sessionId);
      addAssistantMessage(message.content, message.id);
    } catch (error) {
      console.error('Failed to generate startup message:', error);
      // Silently fail - user will see static welcome screen
    } finally {
      setIsLoadingStartup(false);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isSending) return;

    const message = input.trim() || ''; // Allow empty message if files attached
    const files = [...attachedFiles];
    setInput('');
    setAttachedFiles([]);

    let sessionId = currentSession?.id;

    // Create new session if needed
    if (!sessionId) {
      const session = await createSession('assistant');
      sessionId = session.id;
      await loadSession(sessionId);
    }

    // Add user message to UI
    addUserMessage(message || '[Uploaded files]');
    setIsSending(true);
    setStreamingContent('');
    setReasoningContent('');  // Clear previous reasoning
    setStatusMessage('');

    try {
      // Stream the response - accumulate content locally to avoid stale closure
      let accumulatedContent = '';
      const streamFunction = files.length > 0
        ? streamMessageWithFiles(sessionId, message, files, projectMode, thinkingMode, novaMode)
        : streamMessage(sessionId, message, projectMode, thinkingMode, novaMode);

      for await (const chunk of streamFunction) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
        } else if (chunk.type === 'reasoning' && chunk.content) {
          // xAI Grok thinking output - accumulate separately
          appendReasoningContent(chunk.content);
        } else if (chunk.type === 'content' && chunk.content) {
          setStatusMessage(''); // Clear status when content starts
          accumulatedContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'browser_action' && chunk.action === 'open') {
          pulseLunaControl();
          // Signal to open browser window for visual browsing
          setBrowserAction({ type: 'open', url: chunk.url });
        } else if (chunk.type === 'browser_action') {
          pulseLunaControl();
        } else if (chunk.type === 'video_action' && chunk.videos && chunk.query) {
          // Signal to open videos window with YouTube search results
          setVideoAction({ type: 'open', videos: chunk.videos, query: chunk.query });
        } else if (chunk.type === 'media_action' && chunk.items) {
          // Signal to open media player with Jellyfin or local results
          setMediaAction({ type: (chunk.action as 'search' | 'play') || 'search', items: chunk.items, query: chunk.query || '', source: (chunk.source as 'youtube' | 'jellyfin' | 'local') || 'local' });
        } else if (chunk.type === 'canvas_artifact' && chunk.artifactId && chunk.content) {
          // Signal to open canvas window with generated artifact
          setCanvasAction({ type: 'complete', artifactId: chunk.artifactId, content: chunk.content });
        } else if (chunk.type === 'background_refresh') {
          // Signal to refresh desktop background (after Luna generates/changes it)
          window.dispatchEvent(new CustomEvent('luna:background-refresh'));
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId, chunk.metrics);
          setStreamingContent('');
          setStatusMessage('');
        }
      }

      // Reload sessions to update titles
      loadSessions();
    } catch (error) {
      console.error('Failed to send message:', error);
      // Show error in chat
      addAssistantMessage(
        'Sorry, I encountered an error processing your message. Please try again.',
        `error-${Date.now()}`
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    if (!currentSession) return;

    try {
      await chatApi.editMessage(currentSession.id, messageId, newContent);
      updateMessage(messageId, newContent);

      // Show confirmation dialog for regeneration
      setShowRegenerateConfirm({ messageId, content: newContent });
    } catch (error) {
      console.error('Failed to edit message:', error);
    }
  };

  const handleRegenerate = async (messageId: string) => {
    if (!currentSession) return;

    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    // Remove messages from this point (the regenerate endpoint handles deletion)
    removeMessagesFrom(messageId);

    try {
      let accumulatedContent = '';
      for await (const chunk of regenerateMessage(currentSession.id, messageId)) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
        } else if (chunk.type === 'content' && chunk.content) {
          setStatusMessage('');
          accumulatedContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'canvas_artifact' && chunk.artifactId && chunk.content) {
          // Signal to open/update canvas window with generated artifact
          setCanvasAction({ type: 'complete', artifactId: chunk.artifactId, content: chunk.content });
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId, chunk.metrics);
          setStreamingContent('');
          setStatusMessage('');
        }
      }

      loadSessions();
    } catch (error) {
      console.error('Failed to regenerate:', error);
      addAssistantMessage(
        'Sorry, I encountered an error regenerating the response. Please try again.',
        `error-${Date.now()}`
      );
    } finally {
      setIsSending(false);
    }
  };

  const handlePlayAudio = (messageId: string, content: string) => {
    audioPlayer.play(messageId, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024; // 10MB
    const maxFiles = 5;

    // Filter out oversized files
    const validFiles = files.filter(file => {
      if (file.size > maxSize) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        return false;
      }
      return true;
    });

    // Check total file count
    const newTotal = attachedFiles.length + validFiles.length;
    if (newTotal > maxFiles) {
      alert(`Maximum ${maxFiles} files allowed. You can only add ${maxFiles - attachedFiles.length} more.`);
      setAttachedFiles([...attachedFiles, ...validFiles.slice(0, maxFiles - attachedFiles.length)]);
    } else {
      setAttachedFiles([...attachedFiles, ...validFiles]);
    }

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(files => files.filter((_, i) => i !== index));
  };

  const messages = currentSession?.messages || [];
  const hasMessages = messages.length > 0 || streamingContent;
  const cardSuggestions = useMemo(
    () => pickRandomSuggestions(startupSuggestions, 3),
    [startupSuggestions]
  );

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingMessages ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-theme-accent-primary" />
          </div>
        ) : !hasMessages ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            {isLoadingStartup ? (
              <>
                <div className="w-20 h-20 rounded-full bg-theme-accent-primary/20 flex items-center justify-center mb-6">
                  <Loader2 className="w-10 h-10 text-theme-accent-primary animate-spin" />
                </div>
                <h2 className="text-2xl font-semibold text-theme-text-primary mb-2">Luna is getting ready...</h2>
                <p className="text-theme-text-muted text-center max-w-md">
                  Preparing a personalized greeting for you.
                </p>
              </>
            ) : !currentSession ? (
              <>
                <div className="w-16 h-16 rounded-full bg-theme-accent-primary/20 flex items-center justify-center mb-4">
                  <Moon className="w-8 h-8 text-theme-accent-primary" />
                </div>
                <h2 className="text-xl font-semibold text-theme-text-primary mb-1">Hello! I&apos;m Luna</h2>
                <p className="text-theme-text-muted text-center max-w-sm text-sm">
                  Start a new chat from the sidebar to begin.
                </p>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-theme-accent-primary/20 flex items-center justify-center mb-6">
                  <Moon className="w-10 h-10 text-theme-accent-primary" />
                </div>
                <h2 className="text-2xl font-semibold text-theme-text-primary mb-2">Hello! I&apos;m Luna</h2>
                <p className="text-theme-text-muted text-center max-w-md">
                  Your AI personal assistant and conversation companion. How can I help you today?
                </p>
                {startupSuggestions.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 max-w-3xl w-full">
                    {cardSuggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion}-${index}`}
                        onClick={() => {
                          setInput(suggestion);
                          clearStartupSuggestions();
                        }}
                        className="p-3 rounded-xl bg-theme-bg-tertiary border border-theme-border hover:border-theme-accent-primary/50 text-sm text-theme-text-secondary hover:text-theme-text-primary text-left transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-8 px-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={clsx('mb-6', msg.role === 'user' ? 'text-right' : '')}
              >
                <div
                  className={clsx(
                    'inline-block max-w-[85%]',
                    msg.role === 'user' ? 'text-left' : ''
                  )}
                >
                  <div
                    className={clsx(
                      'px-4 py-3 rounded-2xl',
                      msg.role === 'user'
                        ? 'bg-theme-message-user text-theme-message-user-text rounded-br-md'
                        : 'bg-theme-message-assistant text-theme-message-assistant-text rounded-bl-md border border-theme-border'
                    )}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="message-content prose prose-invert prose-sm max-w-none">
                        {parseMediaBlocks(msg.content).map((block, idx) => (
                          block.type === 'image' ? (
                            <ImageEmbed
                              key={`img-${idx}`}
                              url={block.url}
                              caption={block.caption}
                            />
                          ) : block.type === 'text' ? (
                            <ReactMarkdown key={`md-${idx}`}>{block.content}</ReactMarkdown>
                          ) : null
                        ))}
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {/* Display attachments for user messages */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-col gap-2 mt-3">
                            {msg.attachments.map((attachment) => (
                              <AttachmentCard key={attachment.id} attachment={attachment} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {/* Actions and metrics */}
                  <div className={clsx(
                    'flex items-start gap-4 mt-1',
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  )}>
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
              </div>
            ))}

            {/* Reasoning content (xAI Grok thinking) */}
            {reasoningContent && (
              <div className="mb-4">
                <details className="inline-block max-w-[85%]" open>
                  <summary className="cursor-pointer px-3 py-2 rounded-lg bg-theme-surface-secondary text-theme-text-secondary text-sm flex items-center gap-2 hover:bg-theme-surface-tertiary transition-colors">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{thinkingPhrase}...</span>
                  </summary>
                  <div className="mt-2 px-3 py-2 rounded-lg bg-theme-surface-secondary border border-theme-border text-theme-text-secondary text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {reasoningContent}
                  </div>
                </details>
              </div>
            )}

            {/* Streaming message */}
            {streamingContent && (
              <div className="mb-6">
                <div className="inline-block max-w-[85%] px-4 py-3 rounded-2xl bg-theme-message-assistant text-theme-message-assistant-text rounded-bl-md border border-theme-border">
                  <div className="message-content prose prose-invert prose-sm max-w-none">
                    {parseMediaBlocks(streamingContent).map((block, idx) => (
                      block.type === 'image' ? (
                        <ImageEmbed
                          key={`img-stream-${idx}`}
                          url={block.url}
                          caption={block.caption}
                        />
                      ) : block.type === 'text' ? (
                        <ReactMarkdown key={`md-stream-${idx}`}>{block.content}</ReactMarkdown>
                      ) : null
                    ))}
                    <span className="typing-cursor" />
                  </div>
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {isSending && !streamingContent && (
              <div className="mb-6">
                <div className="inline-block px-4 py-3 rounded-2xl bg-theme-message-assistant rounded-bl-md border border-theme-border">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-theme-accent-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-theme-accent-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-theme-accent-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-theme-text-secondary text-sm">{statusMessage || `${thinkingPhrase}...`}</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Reflection indicator - shows when Luna is processing in background */}
      {isReflecting && !isSending && (
        <div className="px-4 py-2 border-t border-theme-border/50 bg-theme-bg-secondary/30">
          <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-theme-text-secondary">
            <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
            <span>Luna is reflecting...</span>
          </div>
        </div>
      )}

      {/* Input area - hidden when no session (user must pick mode first) */}
      {currentSession && (
        <div className="border-t border-theme-border p-4">
          <div className="max-w-3xl mx-auto">
            {!hasMessages && !input && startupSuggestions.length > 0 && (
              <SuggestionChips
                suggestions={startupSuggestions.slice(0, 4)}
                onSelect={(suggestion) => {
                  setInput(suggestion);
                  clearStartupSuggestions();
                }}
              />
            )}
            {/* File chips preview */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachedFiles.map((file, index) => (
                  <FileChip
                    key={`${file.name}-${index}`}
                    file={file}
                    onRemove={() => removeFile(index)}
                  />
                ))}
              </div>
            )}

            <div className="relative flex items-end gap-2 bg-theme-bg-secondary rounded-xl border border-theme-border focus-within:border-theme-border-focus transition">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={attachedFiles.length > 0 ? "Add a message (optional)..." : "Message Luna..."}
                rows={1}
                className="flex-1 bg-transparent px-4 py-3 outline-none resize-none max-h-[50vh] text-theme-text-primary placeholder-theme-text-muted"
                disabled={isSending}
              />
              <div className="flex items-center gap-1 p-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.php,.rb,.go,.rs,.swift,.kt,.md,.html,.css,.xml,.yaml,.yml"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-theme-text-muted hover:text-theme-accent-primary transition-colors rounded-lg"
                  title="Attach files"
                  disabled={isSending}
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <button
                  onClick={async () => {
                    const session = await createSession('voice');
                    await loadSession(session.id);
                  }}
                  className="p-2 text-theme-text-muted hover:text-theme-accent-primary transition-colors rounded-lg"
                  title="Switch to Voice Mode"
                >
                  <Mic className="w-5 h-5" />
                </button>
                <button
                  onClick={handleSend}
                  disabled={(!input.trim() && attachedFiles.length === 0) || isSending}
                  className="p-2 bg-theme-accent-primary hover:bg-theme-accent-hover disabled:bg-theme-bg-tertiary disabled:cursor-not-allowed rounded-lg transition text-theme-text-primary"
                >
                  {isSending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 px-1">
              <TogglePill label="Project" active={projectMode} onToggle={() => setProjectMode(!projectMode)} />
              <TogglePill
                label="Thinking"
                active={thinkingMode}
                onToggle={() => {
                  if (!thinkingMode) setNovaMode(false);
                  setThinkingMode(!thinkingMode);
                }}
              />
              <TogglePill
                label="Nova"
                active={novaMode}
                onToggle={() => {
                  if (!novaMode) setThinkingMode(false);
                  setNovaMode(!novaMode);
                }}
              />
              <div className="w-px h-4 bg-theme-border mx-1" />
              <ModelSelector />
              <span className="ml-auto text-xs text-theme-text-muted">
                Luna can make mistakes.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate confirmation dialog */}
      {showRegenerateConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-theme-text-primary mb-2">
              Message edited
            </h3>
            <p className="text-theme-text-secondary mb-4">
              Would you like Luna to generate a new response based on your edited message?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowRegenerateConfirm(null)}
                className="px-4 py-2 rounded-lg bg-theme-bg-tertiary hover:bg-theme-bg-primary text-theme-text-secondary transition"
              >
                Keep current response
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
                className="px-4 py-2 rounded-lg bg-theme-accent-primary hover:bg-theme-accent-hover text-theme-text-primary transition"
              >
                Regenerate response
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
