import { api } from './core';

export interface SunoGeneration {
  id: string;
  userId: string | null;
  title: string;
  style: string;
  bpm: number | null;
  key: string | null;
  n8nTaskId: string | null;
  sunoId: string | null;
  audioUrl: string | null;
  filePath: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage: string | null;
  durationSeconds: number | null;
  createdAt: string;
  completedAt: string | null;
}

export const triggerGeneration = (count: number, styleOverride?: string) =>
  api<{ generations: SunoGeneration[]; count: number }>('/api/suno/generate', {
    method: 'POST',
    body: { count, style_override: styleOverride },
  });

export const getGenerations = (limit = 50) =>
  api<{ generations: SunoGeneration[] }>(`/api/suno/generations?limit=${limit}`);
