'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, RefreshCw, Plus, Trash2, Edit3, X, Clock, MapPin
} from 'lucide-react';
import { calendarApi, type CalendarEvent, type CreateCalendarEventInput } from '@/lib/api';

const initialFormData: CreateCalendarEventInput = {
  title: '',
  startAt: '',
  endAt: '',
  description: '',
  location: '',
  reminderMinutes: 15,
};

export default function CalendarWindow() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'today' | 'week'>('week');
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formData, setFormData] = useState<CreateCalendarEventInput>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ connected: boolean; provider?: string } | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      const [eventsData, statusData] = await Promise.all([
        view === 'today' ? calendarApi.getToday() : calendarApi.getEvents(7, 50),
        calendarApi.getStatus(),
      ]);
      setEvents(eventsData.events || []);
      setStatus(statusData);
    } catch (error) {
      console.error('Failed to load calendar events:', error);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleOpenNewForm = () => {
    setEditingEvent(null);
    const now = new Date();
    const startAt = new Date(now.getTime() + 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    setFormData({
      title: '',
      startAt: startAt.toISOString().slice(0, 16),
      endAt: endAt.toISOString().slice(0, 16),
      description: '',
      location: '',
      reminderMinutes: 15,
    });
    setShowForm(true);
  };

  const handleEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormData({
      title: event.title,
      startAt: new Date(event.startAt).toISOString().slice(0, 16),
      endAt: new Date(event.endAt).toISOString().slice(0, 16),
      description: event.description || '',
      location: event.location || '',
      reminderMinutes: event.reminderMinutes ?? 15,
    });
    setShowForm(true);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Delete this event?')) return;
    try {
      await calendarApi.deleteEvent(eventId);
      await loadEvents();
    } catch (error) {
      console.error('Failed to delete event:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    try {
      setSaving(true);
      const dataToSave = {
        ...formData,
        startAt: new Date(formData.startAt).toISOString(),
        endAt: new Date(formData.endAt).toISOString(),
      };

      if (editingEvent) {
        await calendarApi.updateEvent(editingEvent.externalId, dataToSave);
      } else {
        await calendarApi.createEvent(dataToSave);
      }

      setShowForm(false);
      setEditingEvent(null);
      await loadEvents();
    } catch (error) {
      console.error('Failed to save event:', error);
    } finally {
      setSaving(false);
    }
  };

  const formatEventTime = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startStr = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const endStr = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${startStr} - ${endStr}`;
  };

  const formatEventDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const groupEventsByDate = (events: CalendarEvent[]) => {
    const groups: Record<string, CalendarEvent[]> = {};
    events.forEach(event => {
      const dateKey = new Date(event.startAt).toDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });
    return Object.entries(groups).sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  };

  if (!status?.connected && !loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8" style={{ background: 'var(--theme-bg-primary)' }}>
        <Calendar className="w-16 h-16 mb-4 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
        <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--theme-text-primary)' }}>Calendar</h2>
        <p className="text-sm text-center mb-4" style={{ color: 'var(--theme-text-muted)' }}>
          Connect your calendar in Settings - Integrations or create local events
        </p>
        <button
          onClick={handleOpenNewForm}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm"
          style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
        >
          <Plus className="w-4 h-4" />
          Create Event
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('today')}
            className={`px-3 py-1.5 text-sm rounded transition ${
              view === 'today'
                ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setView('week')}
            className={`px-3 py-1.5 text-sm rounded transition ${
              view === 'week'
                ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]'
            }`}
          >
            Week
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenNewForm}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
          >
            <Plus className="w-4 h-4" />
            New Event
          </button>
          <button
            onClick={loadEvents}
            disabled={loading}
            className="p-1.5 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
            <Calendar className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm mb-2">No upcoming events</p>
            <button
              onClick={handleOpenNewForm}
              className="text-sm underline"
              style={{ color: 'var(--theme-accent-primary)' }}
            >
              Create one
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {groupEventsByDate(events).map(([dateStr, dateEvents]) => (
              <div key={dateStr}>
                <h3 className="text-sm font-medium mb-3 sticky top-0 py-1" style={{ color: 'var(--theme-text-muted)', background: 'var(--theme-bg-primary)' }}>
                  {formatEventDate(dateEvents[0].startAt)}
                </h3>
                <div className="space-y-2">
                  {dateEvents.map((event) => (
                    <div
                      key={event.id}
                      className="p-3 rounded-lg border transition hover:border-[var(--theme-accent-primary)]/50"
                      style={{ background: 'var(--theme-bg-tertiary)', borderColor: 'var(--theme-border-default)' }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate" style={{ color: 'var(--theme-text-primary)' }}>
                            {event.title}
                          </h4>
                          <div className="flex items-center gap-3 mt-1 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {formatEventTime(event.startAt, event.endAt)}
                            </span>
                            {event.location && (
                              <span className="flex items-center gap-1 truncate">
                                <MapPin className="w-3.5 h-3.5" />
                                {event.location}
                              </span>
                            )}
                          </div>
                          {event.description && (
                            <p className="text-sm mt-2 line-clamp-2" style={{ color: 'var(--theme-text-muted)' }}>
                              {event.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleEditEvent(event)}
                            className="p-1.5 rounded transition hover:bg-[var(--theme-bg-secondary)]"
                            style={{ color: 'var(--theme-text-muted)' }}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(event.externalId)}
                            className="p-1.5 rounded transition hover:bg-red-500/20"
                            style={{ color: 'var(--theme-text-muted)' }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Event Form Modal */}
      {showForm && (
        <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div
            className="w-full max-w-md rounded-lg shadow-xl"
            style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--theme-border-default)' }}>
              <h3 className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                {editingEvent ? 'Edit Event' : 'New Event'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ color: 'var(--theme-text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--theme-text-muted)' }}>Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded text-sm focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--theme-bg-input)',
                    color: 'var(--theme-text-primary)',
                    border: '1px solid var(--theme-border-default)',
                  }}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--theme-text-muted)' }}>Start</label>
                  <input
                    type="datetime-local"
                    value={formData.startAt}
                    onChange={(e) => setFormData(prev => ({ ...prev, startAt: e.target.value }))}
                    className="w-full px-3 py-2 rounded text-sm focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--theme-bg-input)',
                      color: 'var(--theme-text-primary)',
                      border: '1px solid var(--theme-border-default)',
                    }}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--theme-text-muted)' }}>End</label>
                  <input
                    type="datetime-local"
                    value={formData.endAt}
                    onChange={(e) => setFormData(prev => ({ ...prev, endAt: e.target.value }))}
                    className="w-full px-3 py-2 rounded text-sm focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--theme-bg-input)',
                      color: 'var(--theme-text-primary)',
                      border: '1px solid var(--theme-border-default)',
                    }}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--theme-text-muted)' }}>Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  className="w-full px-3 py-2 rounded text-sm focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--theme-bg-input)',
                    color: 'var(--theme-text-primary)',
                    border: '1px solid var(--theme-border-default)',
                  }}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--theme-text-muted)' }}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 resize-none"
                  style={{
                    background: 'var(--theme-bg-input)',
                    color: 'var(--theme-text-primary)',
                    border: '1px solid var(--theme-border-default)',
                  }}
                  rows={3}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--theme-text-muted)' }}>Reminder</label>
                <select
                  value={formData.reminderMinutes ?? 0}
                  onChange={(e) => setFormData(prev => ({ ...prev, reminderMinutes: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 rounded text-sm focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--theme-bg-input)',
                    color: 'var(--theme-text-primary)',
                    border: '1px solid var(--theme-border-default)',
                  }}
                >
                  <option value={0}>No reminder</option>
                  <option value={5}>5 minutes before</option>
                  <option value={15}>15 minutes before</option>
                  <option value={30}>30 minutes before</option>
                  <option value={60}>1 hour before</option>
                  <option value={1440}>1 day before</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm rounded"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded disabled:opacity-50"
                  style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
                >
                  {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {editingEvent ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
