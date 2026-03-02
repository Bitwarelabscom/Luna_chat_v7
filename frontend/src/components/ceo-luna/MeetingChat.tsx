'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Trash2, Briefcase } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

const DEPT_MSG_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  economy: { color: 'text-emerald-400', bg: 'border-emerald-700 bg-emerald-900/20', label: 'Finance Luna' },
  marketing: { color: 'text-purple-400', bg: 'border-purple-700 bg-purple-900/20', label: 'Market Luna' },
  development: { color: 'text-blue-400', bg: 'border-blue-700 bg-blue-900/20', label: 'Dev Luna' },
  research: { color: 'text-amber-400', bg: 'border-amber-700 bg-amber-900/20', label: 'Research Luna' },
  meeting: { color: 'text-white', bg: 'border-indigo-700 bg-indigo-900/20', label: 'CEO Luna' },
};

export function MeetingChat() {
  const {
    staffSessions, staffMessages, isStaffSending,
    loadStaffSession, sendMeetingMessage, clearStaffSession,
  } = useCEOLunaStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const session = staffSessions.meeting;
  const messages = session ? (staffMessages[session.id] || []) : [];

  useEffect(() => {
    loadStaffSession('meeting');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !session || isStaffSending) return;
    const msg = input.trim();
    setInput('');
    await sendMeetingMessage(session.id, msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 bg-indigo-950/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Briefcase size={14} className="text-indigo-400" />
              <h3 className="text-sm font-medium text-white">Department Meeting</h3>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              CEO Luna orchestrates multi-department discussions. Ask a question and relevant departments will weigh in.
            </p>
          </div>
          {session && messages.length > 0 && (
            <button
              onClick={() => clearStaffSession(session.id)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800"
              title="Clear meeting"
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
            Start a meeting. Ask a question like &quot;How should we allocate budget this quarter?&quot; and
            CEO Luna will bring in the relevant departments.
          </p>
        )}
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-lg px-3 py-2 bg-slate-600 text-gray-100">
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          }

          const deptStyle = DEPT_MSG_COLORS[msg.departmentSlug || 'meeting'] || DEPT_MSG_COLORS.meeting;
          const isCeo = msg.departmentSlug === 'meeting' || !msg.departmentSlug;

          return (
            <div key={msg.id} className="flex justify-start">
              <div className={`max-w-[85%] rounded-lg px-3 py-2 border ${deptStyle.bg}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {isCeo && <Briefcase size={12} className="text-indigo-400" />}
                  <span className={`text-xs font-medium ${deptStyle.color}`}>
                    {deptStyle.label}
                  </span>
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          );
        })}
        {isStaffSending && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 border border-indigo-700 bg-indigo-900/20">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-indigo-400" />
                <span className="text-xs text-gray-400">Departments are thinking...</span>
              </div>
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
            placeholder="Ask the team something..."
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
