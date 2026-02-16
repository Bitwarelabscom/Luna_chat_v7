import { api } from './core';

// Luna Media API (Videos + Generated Images)
export interface LunaMediaSelection {
  type: 'video' | 'image';
  url: string;
  mood: string;
  trigger?: string;
  isSpecial?: boolean;
  loopSet?: string;
}

export interface AvatarState {
  currentSet: string;
  lastVideoIndex: number;
  isPlayingSpecial: boolean;
  specialQueue: string[];
}

export const lunaMediaApi = {
  selectMedia: (response: string, mood: string) =>
    api<LunaMediaSelection>(`/api/abilities/luna/media?response=${encodeURIComponent(response)}&mood=${encodeURIComponent(mood)}`),

  getVideos: () =>
    api<{ videos: string[] }>('/api/abilities/luna/videos'),

  getCachedImages: () =>
    api<{ images: string[] }>('/api/abilities/luna/cached-images'),

  generateImage: (mood: string) =>
    api<{ url: string; cached: boolean; generated_at: string }>('/api/abilities/luna/generate-image', {
      method: 'POST',
      body: { mood },
    }),

  // Avatar (loop-based video system)
  getAvatarState: () =>
    api<{ state: AvatarState }>('/api/abilities/luna/avatar/state'),

  getNextVideo: (set?: string) =>
    api<LunaMediaSelection>(`/api/abilities/luna/avatar/next${set ? `?set=${set}` : ''}`),

  getLoopSets: () =>
    api<{ loopSets: Record<string, number> }>('/api/abilities/luna/avatar/loop-sets'),

  getSpecialGestures: () =>
    api<{ specials: string[] }>('/api/abilities/luna/avatar/specials'),

  queueSpecialGesture: (gesture: string) =>
    api<{ queued: boolean; video: LunaMediaSelection }>('/api/abilities/luna/avatar/special', {
      method: 'POST',
      body: { gesture },
    }),

  finishSpecialGesture: () =>
    api<{ success: boolean }>('/api/abilities/luna/avatar/special/finish', {
      method: 'POST',
    }),

  setMood: (mood: string) =>
    api<{ loopSet: string }>('/api/abilities/luna/avatar/mood', {
      method: 'POST',
      body: { mood },
    }),
};

// Media Download API
export const mediaApi = {
  downloadMedia: (videoId: string, title: string, format: 'video' | 'audio') =>
    api<{ downloadId: string; status: string }>('/api/media/download', {
      method: 'POST',
      body: { videoId, title, format },
    }),

  getDownloadStatus: (downloadId: string) =>
    api<{ id: string; status: string; progress?: string; filePath?: string; error?: string; duration: number }>(
      `/api/media/download/${downloadId}/status`
    ),

  getDownloads: () =>
    api<{ downloads: Array<{ id: string; videoId: string; title: string; format: string; status: string }> }>(
      '/api/media/downloads'
    ),
};

// Voice Luna API (Fast voice chat - bypasses layered agent)
export interface VoiceMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface VoiceChatResponse {
  messageId: string;
  content: string;
  tokensUsed: number;
}

export const voiceApi = {
  // Create or get existing voice session
  createSession: () =>
    api<{ sessionId: string }>('/api/voice/session', { method: 'POST' }),

  // Get session messages
  getMessages: (sessionId: string, limit = 50) =>
    api<VoiceMessage[]>(`/api/voice/session/${sessionId}/messages?limit=${limit}`),

  // Send message (non-streaming for fast TTS)
  sendMessage: (sessionId: string, message: string) =>
    api<VoiceChatResponse>(`/api/voice/session/${sessionId}/send`, {
      method: 'POST',
      body: { message },
    }),

  // Delete session
  deleteSession: (sessionId: string) =>
    api<{ success: boolean }>(`/api/voice/session/${sessionId}`, { method: 'DELETE' }),
};
