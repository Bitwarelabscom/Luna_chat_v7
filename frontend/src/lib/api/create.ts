import { api } from './core';

interface CreateRequestSummary {
  id: string;
  ideaText: string;
  status: string;
  productionId: string | null;
  createdAt: string;
  completedAt: string | null;
  songCount?: number;
  completedSongs?: number;
}

interface SongDetail {
  trackNumber: number;
  title: string;
  status: string;
  streamUrl: string | null;
  durationSeconds: number | null;
}

interface CreateRequestDetail {
  id: string;
  ideaText: string;
  status: string;
  productionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  songs: SongDetail[];
}

export const createApi = {
  submitIdea: (idea: string) =>
    api<{ requestId: string; status: string }>('/api/create/request', {
      method: 'POST',
      body: { idea },
    }),

  listRequests: () =>
    api<{ requests: CreateRequestSummary[] }>('/api/create/requests'),

  getRequest: (id: string) =>
    api<CreateRequestDetail>(`/api/create/requests/${id}`),

  registerWithInvite: (inviteCode: string, email: string, password: string, displayName: string) =>
    api<{ user: { id: string; email: string; displayName: string | null } }>(
      '/api/auth/register-invite',
      { method: 'POST', body: { inviteCode, email, password, displayName } },
    ),
};
