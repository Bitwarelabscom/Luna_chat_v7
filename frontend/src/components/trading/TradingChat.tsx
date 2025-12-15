'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, TrendingUp, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { tradingApi, type Portfolio, type PriceData } from '@/lib/api';
import type { DisplayContent } from '@/types/display';

interface TradingChatProps {
  portfolio: Portfolio | null;
  prices: PriceData[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDisplayChange: (display: DisplayContent) => void;
  onTradeExecuted?: () => void;  // Called when a trade or conditional order is placed
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function TradingChat({
  portfolio: _portfolio,
  prices: _prices,
  isExpanded: _isExpanded,
  onToggleExpand,
  onDisplayChange,
  onTradeExecuted,
}: TradingChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hey! I'm Trader Luna, your trading assistant. I can help you with:

- Market analysis and technical indicators
- Trading strategy recommendations
- Portfolio analysis and risk assessment
- Setting up and managing trading bots

What would you like to know about the markets today?`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize session on mount
  useEffect(() => {
    initSession();
  }, []);

  const initSession = async () => {
    try {
      const { sessionId: newSessionId } = await tradingApi.createChatSession();
      setSessionId(newSessionId);

      // Load previous messages if any
      const history = await tradingApi.getChatMessages(newSessionId);
      if (history.length > 0) {
        const loadedMessages: Message[] = history.map((msg, i) => ({
          id: `history-${i}`,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(),
        }));
        setMessages([messages[0], ...loadedMessages]);
      }
    } catch (err) {
      console.error('Failed to init trading session:', err);
      // Continue without session - will try to create on first message
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      // Ensure we have a session
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const { sessionId: newSessionId } = await tradingApi.createChatSession();
        setSessionId(newSessionId);
        activeSessionId = newSessionId;
      }

      // Send message to trading chat API
      const response = await tradingApi.sendChatMessage(activeSessionId, userMessage.content);

      const assistantMessage: Message = {
        id: response.messageId,
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Handle display content changes from Luna
      if (response.display) {
        onDisplayChange(response.display);
      }

      // Notify parent to refresh data if a trade was executed
      if (response.tradeExecuted && onTradeExecuted) {
        onTradeExecuted();
      }
    } catch (err) {
      console.error('Failed to send trading chat message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');

      // Add error message to chat
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRetry = () => {
    setError(null);
    initSession();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #2a3545',
        background: 'rgba(42, 53, 69, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TrendingUp style={{ width: 16, height: 16, color: '#00ff9f' }} />
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#fff' }}>Trader Luna</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {error && (
            <button
              onClick={handleRetry}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid #ef4444',
                borderRadius: '4px',
                color: '#ef4444',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              <RefreshCw style={{ width: 12, height: 12 }} />
              Retry
            </button>
          )}
          <button
            onClick={onToggleExpand}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
            title="Close chat"
          >
            <X style={{ width: 16, height: 16, color: '#8892a0' }} />
          </button>
        </div>
      </div>

      {/* Connection Error Banner */}
      {error && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(239, 68, 68, 0.1)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: '#ef4444',
          fontSize: '12px',
        }}>
          <AlertTriangle style={{ width: 14, height: 14 }} />
          {error}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              display: 'flex',
              gap: '10px',
              marginBottom: '16px',
            }}
          >
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: message.role === 'assistant' ? '#00ff9f20' : '#2a3545',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {message.role === 'assistant' ? (
                <Bot style={{ width: 14, height: 14, color: '#00ff9f' }} />
              ) : (
                <User style={{ width: 14, height: 14, color: '#8892a0' }} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: '#607080', marginBottom: '4px' }}>
                {message.role === 'assistant' ? 'Trader Luna' : 'You'}
              </div>
              <div style={{
                fontSize: '13px',
                color: '#c0c8d0',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}>
                {message.content}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: '#00ff9f20',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Bot style={{ width: 14, height: 14, color: '#00ff9f' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff9f', animation: 'pulse 1s ease-in-out infinite' }} />
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff9f', animation: 'pulse 1s ease-in-out infinite', animationDelay: '0.2s' }} />
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff9f', animation: 'pulse 1s ease-in-out infinite', animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid #2a3545',
        display: 'flex',
        gap: '8px',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask about markets, trading strategies, or portfolio analysis..."
          rows={1}
          style={{
            flex: 1,
            background: '#0a0f18',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            padding: '10px 12px',
            color: '#fff',
            fontSize: '13px',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          style={{
            background: input.trim() && !isLoading ? '#00ff9f' : '#2a3545',
            border: 'none',
            borderRadius: '8px',
            padding: '0 14px',
            cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Send style={{ width: 16, height: 16, color: input.trim() && !isLoading ? '#000' : '#607080' }} />
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
