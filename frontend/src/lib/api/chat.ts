import { api, ApiError, API_URL, API_PREFIX } from './core';

// Chat API
export interface Session {
  id: string;
  userId: string;
  title: string;
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna';
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LLMCallBreakdown {
  node: string;      // plan, draft, critique, repair
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  cost: number;
  durationMs?: number;
}

export interface RouteInfo {
  route: 'nano' | 'pro' | 'pro+tools';
  confidence: 'estimate' | 'verified';
  class: 'chat' | 'transform' | 'factual' | 'actionable';
}

export interface MessageMetrics {
  promptTokens: number;
  completionTokens: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  toolsUsed: string[];
  model: string;
  // Layered agent breakdown
  llmBreakdown?: LLMCallBreakdown[];
  totalCost?: number;
  // Router-First Architecture provenance
  routeInfo?: RouteInfo;
}

export interface MessageAttachment {
  id: string;
  documentId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: 'processing' | 'ready' | 'error';
  analysisPreview?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokensUsed: number;
  createdAt: string;
  metrics?: MessageMetrics;
  attachments?: MessageAttachment[];
}

export interface StartupResponse {
  message: Message;
  suggestions: string[];
}

export interface SuggestionsResponse {
  suggestions: string[];
}

export const chatApi = {
  getSessions: (params?: { limit?: number; offset?: number; archived?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.archived) searchParams.set('archived', 'true');
    const query = searchParams.toString();
    return api<{ sessions: Session[] }>(`/api/chat/sessions${query ? `?${query}` : ''}`);
  },

  getSession: (id: string) =>
    api<Session & { messages: Message[] }>(`/api/chat/sessions/${id}`),

  createSession: (data?: { title?: string; mode?: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna' }) =>
    api<Session>('/api/chat/sessions', { method: 'POST', body: data || {} }),

  updateSession: (id: string, data: { title?: string; mode?: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna'; isArchived?: boolean }) =>
    api<Session>(`/api/chat/sessions/${id}`, { method: 'PATCH', body: data }),

  deleteSession: (id: string) =>
    api<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),

  // End session and trigger memory consolidation (called on browser close)
  endSession: (id: string) =>
    api<{ success: boolean }>(`/api/chat/sessions/${id}/end`, { method: 'POST' }),

  sendMessage: (sessionId: string, message: string, projectMode?: boolean) =>
    api<{ messageId: string; content: string; tokensUsed: number }>(`/api/chat/sessions/${sessionId}/send`, {
      method: 'POST',
      body: { message, stream: false, projectMode },
    }),

  editMessage: (sessionId: string, messageId: string, content: string) =>
    api<Message>(`/api/chat/sessions/${sessionId}/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    }),

  getSessionStartup: (sessionId: string) =>
    api<StartupResponse>(`/api/chat/sessions/${sessionId}/startup`, { method: 'POST' }),

  getSuggestions: (mode: 'assistant' | 'companion') =>
    api<SuggestionsResponse>(`/api/chat/suggestions?mode=${encodeURIComponent(mode)}`),
};

// Streaming helper
export async function* streamMessage(
  sessionId: string,
  message: string,
  projectMode?: boolean,
  thinkingMode?: boolean,
  novaMode?: boolean,
  djStyleContext?: string,
  ceoSystemLog?: string
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action' | 'reasoning' | 'background_refresh' | 'video_action' | 'media_action' | 'canvas_artifact'; content?: string | any; status?: string; messageId?: string; metrics?: MessageMetrics; action?: string; url?: string; videos?: any[]; query?: string; items?: any[]; source?: string; artifactId?: string }> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/sessions/${sessionId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ message, stream: true, projectMode, thinkingMode, novaMode, djStyleContext, ceoSystemLog }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to send message');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Streaming helper with file uploads
export async function* streamMessageWithFiles(
  sessionId: string,
  message: string,
  files: File[],
  projectMode?: boolean,
  thinkingMode?: boolean,
  novaMode?: boolean
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action' | 'reasoning' | 'background_refresh' | 'video_action' | 'media_action' | 'canvas_artifact'; content?: string | any; status?: string; messageId?: string; metrics?: MessageMetrics; action?: string; url?: string; videos?: any[]; query?: string; items?: any[]; source?: string; artifactId?: string }> {
  const formData = new FormData();
  formData.append('message', message);
  formData.append('stream', 'true');
  if (projectMode) formData.append('projectMode', 'true');
  if (thinkingMode) formData.append('thinkingMode', 'true');
  if (novaMode) formData.append('novaMode', 'true');

  // Add files to FormData
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/sessions/${sessionId}/send`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to send message');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Regenerate message streaming helper
export async function* regenerateMessage(
  sessionId: string,
  messageId: string
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'reasoning' | 'canvas_artifact'; content?: string | any; status?: string; messageId?: string; metrics?: MessageMetrics; artifactId?: string }> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/sessions/${sessionId}/messages/${messageId}/regenerate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to regenerate message');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// TTS helper - returns audio blob
export async function synthesizeSpeech(text: string): Promise<Blob> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/chat/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'TTS failed' }));
    throw new ApiError(response.status, error.error || 'TTS failed');
  }

  return response.blob();
}
