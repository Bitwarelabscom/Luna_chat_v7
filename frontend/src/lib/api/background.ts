import { api, API_URL, API_PREFIX, ApiError } from './core';

// Background API
export interface Background {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  backgroundType: 'generated' | 'uploaded' | 'preset';
  style: string | null;
  prompt: string | null;
  isActive: boolean;
  createdAt: string;
}

export const backgroundApi = {
  // Get all backgrounds for user
  getBackgrounds: () =>
    api<{ backgrounds: Background[] }>('/api/backgrounds'),

  // Get active background
  getActiveBackground: () =>
    api<{ background: Background | null }>('/api/backgrounds/active'),

  // Generate a new background
  generate: (prompt: string, style: string = 'custom', setActive: boolean = false) =>
    api<{ background: Background }>('/api/backgrounds/generate', {
      method: 'POST',
      body: { prompt, style, setActive },
    }),

  // Activate a background
  activate: (id: string) =>
    api<{ success: boolean; background: Background }>(`/api/backgrounds/${id}/activate`, { method: 'PUT' }),

  // Reset to default (no active background)
  reset: () =>
    api<{ success: boolean }>('/api/backgrounds/reset', { method: 'PUT' }),

  // Delete a background
  delete: (id: string) =>
    api<{ success: boolean }>(`/api/backgrounds/${id}`, { method: 'DELETE' }),
};

// Upload background image using FormData
export async function uploadBackgroundImage(file: File): Promise<Background> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}${API_PREFIX}/api/backgrounds/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new ApiError(response.status, error.error || 'Upload failed');
  }

  const data = await response.json();
  return data.background;
}
