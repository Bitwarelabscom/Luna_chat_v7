import { api } from './core';

// Tasks API
export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export const tasksApi = {
  list: () =>
    api<{ tasks: Task[] }>('/api/abilities/tasks'),

  create: (data: { title: string; description?: string; priority?: string; dueDate?: string }) =>
    api<{ task: Task }>('/api/abilities/tasks', { method: 'POST', body: data }),

  update: (id: string, data: { title?: string; description?: string; priority?: string; dueDate?: string }) =>
    api<{ task: Task }>(`/api/abilities/tasks/${id}`, { method: 'PUT', body: data }),

  updateStatus: (id: string, status: string) =>
    api<{ task: Task }>(`/api/abilities/tasks/${id}/status`, { method: 'PUT', body: { status } }),

  delete: (id: string) =>
    api<{ success: boolean }>(`/api/abilities/tasks/${id}`, { method: 'DELETE' }),
};
