'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/lib/store';
import { streamMessage } from '@/lib/api';
import { Send, Moon, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';

export default function ChatArea() {
  const {
    currentSession,
    isLoadingMessages,
    isSending,
    streamingContent,
    statusMessage,
    loadSessions,
    createSession,
    loadSession,
    addUserMessage,
    addAssistantMessage,
    appendStreamingContent,
    setIsSending,
    setStreamingContent,
    setStatusMessage,
  } = useChatStore();

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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
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
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const messages = currentSession?.messages || [];
  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <main className="flex-1 flex flex-col h-screen">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingMessages ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-theme-accent-primary" />
          </div>
        ) : !hasMessages ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <div className="w-20 h-20 rounded-full bg-theme-accent-primary/20 flex items-center justify-center mb-6">
              <Moon className="w-10 h-10 text-theme-accent-primary" />
            </div>
            <h2 className="text-2xl font-semibold text-theme-text-primary mb-2">Hello! I&apos;m Luna</h2>
            <p className="text-theme-text-muted text-center max-w-md">
              Your AI personal assistant and conversation companion. How can I help you today?
            </p>
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
                    'inline-block max-w-[85%] px-4 py-3 rounded-2xl',
                    msg.role === 'user'
                      ? 'bg-theme-message-user text-theme-message-user-text rounded-br-md'
                      : 'bg-theme-message-assistant text-theme-message-assistant-text rounded-bl-md border border-theme-border'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="message-content prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Streaming message */}
            {streamingContent && (
              <div className="mb-6">
                <div className="inline-block max-w-[85%] px-4 py-3 rounded-2xl bg-theme-message-assistant text-theme-message-assistant-text rounded-bl-md border border-theme-border">
                  <div className="message-content prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
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
              className="flex-1 bg-transparent px-4 py-3 outline-none resize-none max-h-[200px] text-theme-text-primary placeholder-theme-text-muted"
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
    </main>
  );
}
