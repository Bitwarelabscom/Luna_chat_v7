import { api } from './core';
import type { EmailStatus } from './integrations.js';

// Email API
export interface Email {
  id: string;
  uid?: number;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  read: boolean;
}

export const emailApi = {
  getInbox: (limit = 10) =>
    api<{ emails: Email[] }>(`/api/email/inbox?limit=${limit}`),

  getUnread: () =>
    api<{ count: number; emails: Email[] }>('/api/email/unread'),

  getStatus: () =>
    api<EmailStatus>('/api/email/status'),

  getEmail: (uid: number) =>
    api<{ email: Email }>(`/api/email/${uid}`),

  deleteEmail: (uid: number) =>
    api<{ message: string; uid: number }>(`/api/email/${uid}`, { method: 'DELETE' }),

  markRead: (uid: number, isRead: boolean) =>
    api<{ message: string; uid: number; isRead: boolean }>(`/api/email/${uid}/read`, {
      method: 'PUT',
      body: JSON.stringify({ isRead }),
    }),

  reply: (uid: number, body: string) =>
    api<{ message: string; messageId?: string }>(`/api/email/${uid}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};
