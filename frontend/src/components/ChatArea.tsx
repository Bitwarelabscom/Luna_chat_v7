'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/lib/store';
import { streamMessage, regenerateMessage, chatApi } from '@/lib/api';
import { Send, Moon, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import MessageActions from './MessageActions';
import MessageMetrics from './MessageMetrics';
import { useAudioPlayer } from './useAudioPlayer';
import YouTubeEmbed, { parseMediaBlocks } from './YouTubeEmbed';
import ImageEmbed from './ImageEmbed';
import dynamic from 'next/dynamic';

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

function StandardChatArea() {
  const {
    currentSession,
    isLoadingMessages,
    isSending,
    streamingContent,
    statusMessage,
    isLoadingStartup,
    loadSessions,
    createSession,
    loadSession,
    addUserMessage,
    addAssistantMessage,
    updateMessage,
    removeMessagesFrom,
    appendStreamingContent,
    setIsSending,
    setStreamingContent,
    setStatusMessage,
    setIsLoadingStartup,
    setBrowserAction,
  } = useChatStore();

  const audioPlayer = useAudioPlayer();
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState<{
    messageId: string;
    content: string;
  } | null>(null);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!input.trim() || isSending) return;

    const message = input.trim();
    setInput('');

    let sessionId = currentSession?.id;

    // Create new session if needed
    if (!sessionId) {
      const session = await createSession('assistant');
      sessionId = session.id;
      await loadSession(sessionId);
    }

    // Add user message to UI
    addUserMessage(message);
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    try {
      // Stream the response - accumulate content locally to avoid stale closure
      let accumulatedContent = '';
      for await (const chunk of streamMessage(sessionId, message)) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
        } else if (chunk.type === 'content' && chunk.content) {
          setStatusMessage(''); // Clear status when content starts
          accumulatedContent += chunk.content;
          appendStreamingContent(chunk.content);
        } else if (chunk.type === 'browser_action' && chunk.action === 'open') {
          // Signal to open browser window for visual browsing
          setBrowserAction({ type: 'open', url: chunk.url });
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

  const messages = currentSession?.messages || [];
  const hasMessages = messages.length > 0 || streamingContent;

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
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-theme-accent-primary/20 flex items-center justify-center mb-6">
                  <Moon className="w-10 h-10 text-theme-accent-primary" />
                </div>
                <h2 className="text-2xl font-semibold text-theme-text-primary mb-2">Hello! I&apos;m Luna</h2>
                <p className="text-theme-text-muted text-center max-w-md">
                  Your AI personal assistant and conversation companion. How can I help you today?
                </p>
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
                      <div className="message-content prose prose-invert prose-sm max-w-none" data-youtube-test="enabled">
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
                      <p className="whitespace-pre-wrap">{msg.content}</p>
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

            {/* Streaming message */}
            {streamingContent && (
              <div className="mb-6">
                <div className="inline-block max-w-[85%] px-4 py-3 rounded-2xl bg-theme-message-assistant text-theme-message-assistant-text rounded-bl-md border border-theme-border">
                  <div className="message-content prose prose-invert prose-sm max-w-none">
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
                    <span className="text-theme-text-secondary text-sm">{statusMessage || 'Luna is thinking...'}</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-theme-border p-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-end gap-2 bg-theme-bg-secondary rounded-xl border border-theme-border focus-within:border-theme-border-focus transition">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Luna..."
              rows={1}
              className="flex-1 bg-transparent px-4 py-3 outline-none resize-none max-h-[50vh] text-theme-text-primary placeholder-theme-text-muted"
              disabled={isSending}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              className="p-3 m-1 bg-theme-accent-primary hover:bg-theme-accent-hover disabled:bg-theme-bg-tertiary disabled:cursor-not-allowed rounded-lg transition text-theme-text-primary"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-xs text-theme-text-muted text-center mt-2">
            Luna can make mistakes. Consider checking important information.
          </p>
        </div>
      </div>

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
