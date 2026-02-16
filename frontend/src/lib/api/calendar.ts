import { api } from './core';

// Calendar API
export interface CalendarEvent {
  id: string;
  externalId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  location?: string;
  isAllDay: boolean;
  reminderMinutes?: number | null;
}

export interface CalendarStatus {
  enabled: boolean;
  connected: boolean;
  eventCount: number;
  lastSync: string | null;
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  location?: string;
  isAllDay?: boolean;
  reminderMinutes?: number | null;
}

export const calendarApi = {
  getEvents: (days = 7, limit = 20) =>
    api<{ events: CalendarEvent[] }>(`/api/abilities/calendar/events?days=${days}&limit=${limit}`),

  getToday: () =>
    api<{ events: CalendarEvent[] }>('/api/abilities/calendar/today'),

  getConnections: () =>
    api<{ connections: { id: string; provider: string; isActive: boolean }[] }>('/api/abilities/calendar/connections'),

  getStatus: () =>
    api<CalendarStatus>('/api/abilities/calendar/status'),

  getEvent: (id: string) =>
    api<CalendarEvent>(`/api/abilities/calendar/events/${id}`),

  createEvent: (input: CreateCalendarEventInput) =>
    api<CalendarEvent>('/api/abilities/calendar/events', {
      method: 'POST',
      body: input,
    }),

  updateEvent: (id: string, input: Partial<CreateCalendarEventInput>) =>
    api<CalendarEvent>(`/api/abilities/calendar/events/${id}`, {
      method: 'PUT',
      body: input,
    }),

  deleteEvent: (id: string) =>
    api<void>(`/api/abilities/calendar/events/${id}`, {
      method: 'DELETE',
    }),
};
