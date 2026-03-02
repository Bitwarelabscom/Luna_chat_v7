import { api } from './core';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeApi = {
  list: (options?: { category?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.category) params.set('category', options.category);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    const qs = params.toString();
    return api<KnowledgeItem[]>(`/api/abilities/knowledge${qs ? `?${qs}` : ''}`);
  },

  search: (query: string, limit = 20) =>
    api<KnowledgeItem[]>(`/api/abilities/knowledge/search?q=${encodeURIComponent(query)}&limit=${limit}`),

  create: (data: { title: string; content: string; category?: string; tags?: string[]; isPinned?: boolean }) =>
    api<KnowledgeItem>('/api/abilities/knowledge', { method: 'POST', body: data }),

  update: (id: string, data: Partial<{ title: string; content: string; category: string; tags: string[]; isPinned: boolean }>) =>
    api<KnowledgeItem>(`/api/abilities/knowledge/${id}`, { method: 'PUT', body: data }),

  delete: (id: string) =>
    api<{ success: boolean }>(`/api/abilities/knowledge/${id}`, { method: 'DELETE' }),
};
