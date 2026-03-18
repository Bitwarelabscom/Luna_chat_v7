'use client';

import { useState, useEffect, useRef } from 'react';
import { Calendar, ExternalLink } from 'lucide-react';
import { calendarApi, type CalendarEvent } from '@/lib/api';
import { useWindowStore } from '@/lib/window-store';

interface CalendarDropdownProps {
  onClose: () => void;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getDayLabel(dateStr: string): string {
  const eventDate = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const eventDay = eventDate.toDateString();
  if (eventDay === today.toDateString()) return 'Today';
  if (eventDay === tomorrow.toDateString()) return 'Tomorrow';
  return eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const label = getDayLabel(event.startAt);
    const existing = groups.get(label) ?? [];
    existing.push(event);
    groups.set(label, existing);
  }
  return groups;
}

export function CalendarDropdown({ onClose }: CalendarDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const openApp = useWindowStore((s) => s.openApp);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  useEffect(() => {
    const load = async () => {
      try {
        const { events: fetched } = await calendarApi.getEvents(7, 20);
        setEvents(fetched);
      } catch {
        setConnected(false);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const grouped = groupByDay(events);
  const today = new Date().toDateString();

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 bottom-full mb-2 w-[300px] backdrop-blur-xl border rounded-xl shadow-2xl overflow-hidden z-[9999]"
      style={{
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* Header */}
      <div
        className="p-3 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
          <h3 className="font-medium text-sm" style={{ color: 'var(--theme-text-primary)' }}>
            Upcoming
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-[10px]" style={{ color: 'var(--theme-text-secondary)' }}>
            {connected ? 'Synced' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center">
            <div className="text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>Loading...</div>
          </div>
        ) : events.length === 0 ? (
          <div className="p-6 text-center">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--theme-text-secondary)' }} />
            <div className="text-[12px]" style={{ color: 'var(--theme-text-secondary)' }}>
              No upcoming events
            </div>
          </div>
        ) : (
          <div className="p-2">
            {Array.from(grouped.entries()).map(([dayLabel, dayEvents]) => (
              <div key={dayLabel} className="mb-2 last:mb-0">
                <div
                  className="text-[10px] uppercase tracking-wider px-2 py-1 font-medium"
                  style={{ color: dayLabel === 'Today' ? 'var(--theme-accent-primary)' : 'var(--theme-text-secondary)' }}
                >
                  {dayLabel}
                </div>
                {dayEvents.map((event) => {
                  const isToday = new Date(event.startAt).toDateString() === today;
                  return (
                    <div
                      key={event.id}
                      className="px-2 py-1.5 rounded-lg mb-0.5 transition-colors hover:bg-white/5"
                      style={isToday ? { borderLeft: '2px solid var(--theme-accent-primary)', paddingLeft: '6px' } : {}}
                    >
                      <div className="flex items-center gap-2">
                        {event.isAllDay ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 flex-shrink-0">
                            All day
                          </span>
                        ) : (
                          <span className="text-[11px] flex-shrink-0 tabular-nums" style={{ color: 'var(--theme-text-secondary)' }}>
                            {formatTime(event.startAt)}–{formatTime(event.endAt)}
                          </span>
                        )}
                        <span className="text-[11px] truncate" style={{ color: 'var(--theme-text-primary)' }}>
                          {event.title}
                        </span>
                      </div>
                      {event.location && (
                        <div className="text-[10px] mt-0.5 truncate pl-[52px]" style={{ color: 'var(--theme-text-secondary)' }}>
                          {event.location}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-2" style={{ borderColor: 'var(--theme-border)' }}>
        <button
          onClick={() => {
            openApp('calendar');
            onClose();
          }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium hover:bg-white/5 transition-colors"
          style={{ color: 'var(--theme-accent-primary)' }}
        >
          <ExternalLink className="w-3 h-3" />
          Open Calendar
        </button>
      </div>
    </div>
  );
}

export default CalendarDropdown;
