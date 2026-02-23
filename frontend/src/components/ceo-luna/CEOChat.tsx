'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, Briefcase, Terminal } from 'lucide-react';
import { streamMessage } from '@/lib/api/chat';
import { chatApi } from '@/lib/api/chat';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import {
  startBuild,
  pauseBuild,
  continueBuild,
  doneBuild,
  listBuilds,
  slashCost,
  slashIncome,
  type ActiveBuild,
} from '@/lib/api/ceo';

const CEO_SESSION_KEY = 'ceo-luna-session-id';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface SystemBubble {
  id: string;
  text: string;
  timestamp: Date;
}

const SLASH_HINT = '/build start <name>  /build pause <#>  /build done <#>  /build list\n/cost <amount> <keyword> [note]  /income <amount> <source> [note]';

export function CEOChat() {
  const { sessionId, setSessionId } = useCEOLunaStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [pendingSystemLog, setPendingSystemLog] = useState<string | null>(null);
  const [systemBubbles, setSystemBubbles] = useState<SystemBubble[]>([]);
  const [showHint, setShowHint] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, systemBubbles, scrollToBottom]);

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      setIsInitializing(true);
      try {
        const storedId = typeof window !== 'undefined' ? localStorage.getItem(CEO_SESSION_KEY) : null;

        if (storedId) {
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
                    timestamp: new Date(m.createdAt),
                  }))
              );
              return;
            }
          } catch {
            localStorage.removeItem(CEO_SESSION_KEY);
          }
        }

        // Create new session
        const session = await chatApi.createSession({ mode: 'ceo_luna', title: 'CEO Luna' });
        setSessionId(session.id);
        if (typeof window !== 'undefined') localStorage.setItem(CEO_SESSION_KEY, session.id);

        setMessages([{
          id: 'init',
          role: 'assistant',
          content: 'CEO Luna online. Share priorities, costs, leads, experiments, or blockers. Use /build to track work sessions.',
          timestamp: new Date(),
        }]);
      } catch (err) {
        console.error('Failed to initialize CEO Luna session:', err);
      } finally {
        setIsInitializing(false);
      }
    };

    initSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addSystemBubble(text: string) {
    setSystemBubbles(prev => [...prev, { id: crypto.randomUUID(), text, timestamp: new Date() }]);
  }

  // Build command handlers
  async function handleBuildStart(taskName: string) {
    try {
      const result = await startBuild(taskName.trim());
      addSystemBubble(`Build #${result.data.buildNum} started - "${result.data.taskName}"`);
      setPendingSystemLog(result.systemLog);
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  async function handleBuildPause(buildNum: number) {
    try {
      const result = await pauseBuild(buildNum);
      addSystemBubble(`Build #${result.data.buildNum} paused`);
      setPendingSystemLog(result.systemLog);
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  async function handleBuildContinue(buildNum: number) {
    try {
      const result = await continueBuild(buildNum);
      addSystemBubble(`Build #${result.data.buildNum} resumed - "${result.data.taskName}"`);
      setPendingSystemLog(result.systemLog);
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  async function handleBuildDone(buildNum: number) {
    try {
      const result = await doneBuild(buildNum);
      addSystemBubble(`Build #${result.data.buildNum} completed - "${result.data.taskName}"`);
      setPendingSystemLog(result.systemLog);
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  async function handleBuildList() {
    try {
      const result = await listBuilds();
      if (result.builds.length === 0) {
        addSystemBubble('No active builds.');
        return;
      }
      const lines = result.builds.map((b: ActiveBuild) => {
        const elapsed = getElapsed(b);
        return `Build #${b.buildNum}: "${b.taskName}" [${b.status} - ${elapsed}]`;
      });
      addSystemBubble(lines.join('\n'));
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  function getElapsed(build: ActiveBuild): string {
    let secs = build.elapsedSeconds;
    if (build.status === 'active') {
      secs += Math.floor((Date.now() - new Date(build.sessionStartedAt).getTime()) / 1000);
    }
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }

  async function handleCost(amount: number, keyword: string, note: string) {
    try {
      const result = await slashCost(amount, keyword, note);
      addSystemBubble(`Expense $${amount.toFixed(2)} logged - ${result.data.category} (${keyword}${note ? ': ' + note : ''})`);
      setPendingSystemLog(result.systemLog);
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  async function handleIncome(amount: number, source: string, note: string) {
    try {
      const result = await slashIncome(amount, source, note);
      addSystemBubble(`Income +$${amount.toFixed(2)} logged - ${source}${note ? ': ' + note : ''}`);
      setPendingSystemLog(result.systemLog);
    } catch (err) {
      addSystemBubble(`Error: ${(err as Error).message}`);
    }
  }

  function parseSlashCommand(input: string): { isCommand: boolean; handler?: () => Promise<void> } {
    const trimmed = input.trim();

    const buildStart = trimmed.match(/^\/build\s+start\s+(.+)/i);
    if (buildStart) return { isCommand: true, handler: () => handleBuildStart(buildStart[1]) };

    const buildPause = trimmed.match(/^\/build\s+pause\s+(\d+)/i);
    if (buildPause) return { isCommand: true, handler: () => handleBuildPause(parseInt(buildPause[1], 10)) };

    const buildContinue = trimmed.match(/^\/build\s+continue\s+(\d+)/i);
    if (buildContinue) return { isCommand: true, handler: () => handleBuildContinue(parseInt(buildContinue[1], 10)) };

    const buildDone = trimmed.match(/^\/build\s+done\s+(\d+)/i);
    if (buildDone) return { isCommand: true, handler: () => handleBuildDone(parseInt(buildDone[1], 10)) };

    if (/^\/build\s+list$/i.test(trimmed)) return { isCommand: true, handler: handleBuildList };

    const cost = trimmed.match(/^\/cost\s+([\d.]+)\s+(\S+)\s*(.*)/i);
    if (cost) return { isCommand: true, handler: () => handleCost(parseFloat(cost[1]), cost[2], cost[3].trim()) };

    const income = trimmed.match(/^\/income\s+([\d.]+)\s+(\S+)\s*(.*)/i);
    if (income) return { isCommand: true, handler: () => handleIncome(parseFloat(income[1]), income[2], income[3].trim()) };

    return { isCommand: false };
  }

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !sessionId) return;

    const { isCommand, handler } = parseSlashCommand(trimmed);
    if (isCommand && handler) {
      setInput('');
      setShowHint(false);
      await handler();
      return;
    }

    // Regular message - consume pending system log
    const logToInject = pendingSystemLog;
    setPendingSystemLog(null);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setShowHint(false);
    setIsSending(true);
    setStreamingContent('');
    setStatusMessage('');

    try {
      let accumulated = '';
      const stream = streamMessage(
        sessionId,
        trimmed,
        undefined,
        undefined,
        undefined,
        undefined,
        logToInject ?? undefined
      );

      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          setStatusMessage(chunk.status || '');
        } else if (chunk.type === 'content') {
          accumulated += chunk.content || '';
          setStreamingContent(accumulated);
        } else if (chunk.type === 'done') {
          setMessages((prev) => [
            ...prev,
            {
              id: chunk.messageId || `assistant-${Date.now()}`,
              role: 'assistant',
              content: accumulated,
              timestamp: new Date(),
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
          { id: `err-${Date.now()}`, role: 'assistant', content: 'Something went wrong. Try again.', timestamp: new Date() },
        ]);
      }
    } finally {
      setIsSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isSending, sessionId, pendingSystemLog]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setShowHint(val.startsWith('/'));
  };

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Briefcase size={32} className="text-slate-400 animate-pulse" />
          <span className="text-sm">Starting CEO Luna...</span>
        </div>
      </div>
    );
  }

  // Merge chat messages and system bubbles for unified timeline rendering
  type TimelineItem =
    | { kind: 'message'; msg: ChatMessage }
    | { kind: 'bubble'; bubble: SystemBubble };

  const timeline: TimelineItem[] = [
    ...messages.map(msg => ({ kind: 'message' as const, msg, ts: msg.timestamp })),
    ...systemBubbles.map(bubble => ({ kind: 'bubble' as const, bubble, ts: bubble.timestamp })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {timeline.map((item) => {
          if (item.kind === 'bubble') {
            return (
              <div key={item.bubble.id} className="flex justify-center my-1">
                <div className="bg-zinc-800/60 text-zinc-400 text-xs px-3 py-1.5 rounded-full border border-zinc-700/50 font-mono flex items-center gap-1.5 max-w-[90%] whitespace-pre-wrap">
                  <Terminal size={10} className="shrink-0 text-slate-500" />
                  {item.bubble.text}
                </div>
              </div>
            );
          }

          const msg = item.msg;
          return (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-2' : 'order-1'}`}>
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <Briefcase size={12} className="text-slate-400" />
                    <span className="text-xs text-slate-400 font-medium">CEO Luna</span>
                  </div>
                )}
                <div
                  className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-slate-600 text-white rounded-tr-sm'
                      : 'bg-gray-800 text-gray-200 rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              <div className="flex items-center gap-1.5 mb-1">
                <Briefcase size={12} className="text-slate-400" />
                <span className="text-xs text-slate-400 font-medium">CEO Luna</span>
              </div>
              <div className="bg-gray-800 text-gray-200 rounded-xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed">
                {streamingContent}
                <span className="inline-block w-1.5 h-4 bg-slate-400 animate-pulse ml-0.5 align-middle" />
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

      {/* Slash command hint */}
      {showHint && (
        <div className="mx-4 mb-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-400 font-mono whitespace-pre-wrap">
          {SLASH_HINT}
        </div>
      )}

      {/* Pending system log indicator */}
      {pendingSystemLog && (
        <div className="mx-4 mb-1 flex items-center gap-1.5 text-xs text-amber-500/80">
          <Terminal size={10} />
          <span className="truncate">Context queued for next message</span>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700 bg-gray-900">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Share priorities, costs, leads, or /build start..."
            disabled={isSending}
            rows={2}
            className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-xl px-3 py-2.5 resize-none border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={isSending || !input.trim()}
            className="p-2.5 bg-slate-600 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0"
          >
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1 px-1">Enter to send - type / for commands</p>
      </div>
    </div>
  );
}
