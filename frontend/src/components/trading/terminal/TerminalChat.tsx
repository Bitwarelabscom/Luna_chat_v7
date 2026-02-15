'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Zap, TrendingUp, FileCode2, Loader2 } from 'lucide-react';
import { useThinkingMessage } from '../../ThinkingStatus';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface TerminalChatProps {
  userId?: string;
  onTradeExecuted?: () => void;
  currentTab?: string;
}

export default function TerminalChat({ onTradeExecuted, currentTab: _currentTab }: TerminalChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Luna Terminal ready. Ask me about market analysis, create trading rules, or execute trades.',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const thinkingPhrase = useThinkingMessage(loading);

  // Initialize trading chat session
  const initSession = useCallback(async () => {
    try {
      const response = await fetch('/api/trading/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSessionId(data.sessionId);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to init trading session:', response.status, errorData);
      }
    } catch (err) {
      console.error('Failed to init trading session:', err);
    }
  }, []);

  useEffect(() => {
    initSession();
  }, [initSession]);

  // Quick action prompts based on current tab
  const quickActions = [
    { icon: <TrendingUp size={12} />, label: 'Market analysis', prompt: 'Give me a quick market analysis for BTC and ETH' },
    { icon: <FileCode2 size={12} />, label: 'Create rule', prompt: 'Create a rule to buy when RSI drops below 30' },
    { icon: <Zap size={12} />, label: 'Buy signal', prompt: 'What are the current buy signals?' },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = input;
    setInput('');
    setLoading(true);

    try {
      // Ensure we have a session
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        const sessionResponse = await fetch('/api/trading/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          currentSessionId = sessionData.sessionId;
          setSessionId(currentSessionId);
        }
      }

      if (!currentSessionId) {
        throw new Error('Failed to create chat session');
      }

      // Call trading chat API with session
      const response = await fetch(`/api/trading/chat/session/${currentSessionId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: messageText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || data.message || 'I understand. How can I help you with trading?',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Check if trade was executed
      if (data.tradeExecuted && onTradeExecuted) {
        onTradeExecuted();
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${errorMsg}. Please refresh and try again.`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Quick Actions */}
      <div style={{
        display: 'flex',
        gap: '0.375rem',
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--terminal-border)',
        flexWrap: 'wrap',
      }}>
        {quickActions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleQuickAction(action.prompt)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.25rem 0.5rem',
              background: 'var(--terminal-surface-hover)',
              border: '1px solid var(--terminal-border)',
              borderRadius: '3px',
              color: 'var(--terminal-text-muted)',
              fontSize: '0.65rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--terminal-border)';
              e.currentTarget.style.color = 'var(--terminal-text)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--terminal-surface-hover)';
              e.currentTarget.style.color = 'var(--terminal-text-muted)';
            }}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}>
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
            }}
          >
            <div
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                background: msg.role === 'user'
                  ? 'var(--terminal-accent)'
                  : 'var(--terminal-surface-hover)',
                color: msg.role === 'user' ? '#000' : 'var(--terminal-text)',
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              {msg.content}
            </div>
            <div
              style={{
                fontSize: '0.6rem',
                color: 'var(--terminal-text-dim)',
                marginTop: '0.25rem',
                textAlign: msg.role === 'user' ? 'right' : 'left',
              }}
            >
              {new Date(msg.timestamp).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--terminal-text-muted)' }}>
            <Loader2 size={14} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '0.75rem' }}>{thinkingPhrase}...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '0.75rem',
        borderTop: '1px solid var(--terminal-border)',
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Luna..."
            disabled={loading}
            className="terminal-input"
            style={{ flex: 1, fontSize: '0.8rem' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="terminal-btn terminal-btn-primary"
            style={{
              padding: '0.5rem',
              opacity: !input.trim() || loading ? 0.5 : 1,
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Spin animation */}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
