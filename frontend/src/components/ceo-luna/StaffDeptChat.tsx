'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Trash2 } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import type { DepartmentSlug } from '@/lib/api/ceo';

const DEPT_INFO: Record<string, { name: string; persona: string; focus: string[]; color: string; bgColor: string }> = {
  economy: {
    name: 'Finance Luna',
    persona: 'Precise, analytical, risk-aware',
    focus: ['cash flow', 'burn rate', 'budget optimization'],
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/20',
  },
  marketing: {
    name: 'Market Luna',
    persona: 'Creative, trend-aware, audience-focused',
    focus: ['campaigns', 'content strategy', 'brand positioning'],
    color: 'text-purple-400',
    bgColor: 'bg-purple-900/20',
  },
  development: {
    name: 'Dev Luna',
    persona: 'Technical, pragmatic, quality-focused',
    focus: ['sprint planning', 'tech debt', 'architecture'],
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/20',
  },
  research: {
    name: 'Research Luna',
    persona: 'Curious, thorough, trend-spotting',
    focus: ['market research', 'competitors', 'opportunities'],
    color: 'text-amber-400',
    bgColor: 'bg-amber-900/20',
  },
};

export function StaffDeptChat({ dept }: { dept: DepartmentSlug }) {
  const {
    staffSessions, staffMessages, isStaffSending,
    loadStaffSession, sendStaffMessage, clearStaffSession,
  } = useCEOLunaStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const info = DEPT_INFO[dept];

  const session = staffSessions[dept];
  const messages = session ? (staffMessages[session.id] || []) : [];

  useEffect(() => {
    loadStaffSession(dept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !session || isStaffSending) return;
    const msg = input.trim();
    setInput('');
    await sendStaffMessage(session.id, msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!info) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Dept header */}
      <div className={`px-4 py-3 border-b border-gray-700 ${info.bgColor}`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-sm font-medium ${info.color}`}>{info.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{info.persona}</p>
            <div className="flex gap-2 mt-1">
              {info.focus.map((f) => (
                <span key={f} className="text-xs text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded">{f}</span>
              ))}
            </div>
          </div>
          {session && messages.length > 0 && (
            <button
              onClick={() => clearStaffSession(session.id)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800"
              title="Clear chat"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isStaffSending && (
          <p className="text-xs text-gray-500 text-center mt-8">
            Start a conversation with {info.name}. Ask about their department focus areas.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-slate-600 text-gray-100'
                : `${info.bgColor} border border-gray-700 text-gray-200`
            }`}>
              {msg.role === 'assistant' && (
                <span className={`text-xs font-medium ${info.color} block mb-1`}>{info.name}</span>
              )}
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {isStaffSending && (
          <div className="flex justify-start">
            <div className={`rounded-lg px-3 py-2 ${info.bgColor} border border-gray-700`}>
              <Loader2 size={14} className={`animate-spin ${info.color}`} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700 bg-gray-900">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${info.name}...`}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500"
            disabled={isStaffSending || !session}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStaffSending || !session}
            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
