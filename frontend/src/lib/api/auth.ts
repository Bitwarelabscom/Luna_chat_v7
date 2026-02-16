import { api } from './core';

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api<{
      user: { id: string; email: string; displayName: string | null };
    }>('/api/auth/login', { method: 'POST', body: { email, password } }),

  register: (email: string, password: string, displayName?: string) =>
    api<{
      user: { id: string; email: string; displayName: string | null };
    }>('/api/auth/register', { method: 'POST', body: { email, password, displayName } }),

  logout: () => api<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () =>
    api<{
      id: string;
      email: string;
      displayName: string | null;
      settings: Record<string, unknown>;
    }>('/api/auth/me'),
};
