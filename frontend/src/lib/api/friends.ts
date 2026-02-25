import { api, ApiError, API_URL, API_PREFIX } from './core';

// Gossip queue topic
export interface GossipTopic {
  id: string;
  topicText: string;
  motivation: string | null;
  importance: number; // 1-5
  suggestedFriendId: string | null;
  suggestedFriendName: string | null;
  suggestedFriendEmoji: string | null;
  suggestedFriendColor: string | null;
  sourceType: 'session_pattern' | 'discussion' | 'manual';
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  createdAt: string;
}

// Friend types
export interface FriendPersonality {
  id: string;
  userId: string;
  name: string;
  personality: string;
  systemPrompt: string;
  avatarEmoji: string;
  color: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FriendConversation {
  id: string;
  sessionId: string;
  userId: string;
  topic: string;
  triggerType: 'pattern' | 'interest' | 'fact' | 'random';
  friendId: string;
  messages: Array<{
    speaker: string;
    message: string;
    timestamp: string;
  }>;
  summary: string | null;
  factsExtracted: string[];
  roundCount: number;
  createdAt: string;
}

// Friends API
export const friendsApi = {
  // Get all friends
  getFriends: () =>
    api<{ friends: FriendPersonality[] }>('/api/autonomous/friends'),

  // Create custom friend
  createFriend: (data: {
    name: string;
    personality: string;
    systemPrompt: string;
    avatarEmoji?: string;
    color?: string;
  }) =>
    api<{ friend: FriendPersonality }>('/api/autonomous/friends', { method: 'POST', body: data }),

  // Update custom friend
  updateFriend: (id: string, data: Partial<{
    name: string;
    personality: string;
    systemPrompt: string;
    avatarEmoji: string;
    color: string;
  }>) =>
    api<{ friend: FriendPersonality }>(`/api/autonomous/friends/${id}`, { method: 'PUT', body: data }),

  // Delete custom friend
  deleteFriend: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/friends/${id}`, { method: 'DELETE' }),

  // Start a friend discussion
  startDiscussion: (data?: { friendId?: string; topic?: string; rounds?: number }) =>
    api<{ conversation: FriendConversation }>('/api/autonomous/friends/discuss', { method: 'POST', body: data || {} }),

  // Get recent discussions
  getDiscussions: (limit = 10) =>
    api<{ discussions: FriendConversation[] }>(`/api/autonomous/friends/discussions?limit=${limit}`),

  // Get specific discussion
  getDiscussion: (id: string) =>
    api<{ discussion: FriendConversation }>(`/api/autonomous/friends/discussions/${id}`),

  // Delete a discussion
  deleteDiscussion: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/friends/discussions/${id}`, { method: 'DELETE' }),

  // Get gossip queue
  getGossipQueue: (limit = 50) =>
    api<{ topics: GossipTopic[] }>(`/api/autonomous/friends/topics?limit=${limit}`),

  // Add a manual topic
  addTopic: (data: { topicText: string; motivation?: string; importance?: number; suggestedFriendId?: string }) =>
    api<{ topic: GossipTopic }>('/api/autonomous/friends/topics', { method: 'POST', body: data }),

  // Update a topic
  updateTopic: (id: string, data: { importance?: number; motivation?: string | null; suggestedFriendId?: string | null; status?: string }) =>
    api<{ topic: GossipTopic }>(`/api/autonomous/friends/topics/${id}`, { method: 'PATCH', body: data }),

  // Delete a topic
  deleteTopic: (id: string) =>
    api<{ success: boolean }>(`/api/autonomous/friends/topics/${id}`, { method: 'DELETE' }),
};

// Friend discussion streaming event types
export interface FriendDiscussionEvent {
  type: 'start' | 'message' | 'round_complete' | 'generating_summary' | 'summary' | 'extracting_facts' | 'facts' | 'complete' | 'error';
  conversationId?: string;
  friend?: { name: string; avatarEmoji: string; color: string };
  topic?: string;
  message?: { speaker: string; message: string; timestamp: string };
  round?: number;
  totalRounds?: number;
  summary?: string;
  facts?: string[];
  error?: string;
}

// Streaming friend discussion helper
export async function* streamFriendDiscussion(
  data?: { friendId?: string; topic?: string; rounds?: number }
): AsyncGenerator<FriendDiscussionEvent> {
  const response = await fetch(`${API_URL}${API_PREFIX}/api/autonomous/friends/discuss/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data || {}),
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to start streaming discussion');
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
          const parsed = JSON.parse(data) as FriendDiscussionEvent;
          yield parsed;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Facts / Memory API
export interface UserFact {
  id: string;
  category: string;
  factKey: string;
  factValue: string;
  confidence: number;
  lastMentioned: string;
  mentionCount: number;
}

export interface FactCorrection {
  id: string;
  factKey: string;
  oldValue: string | null;
  newValue: string | null;
  correctionType: 'delete' | 'update';
  reason: string | null;
  createdAt: string;
}

export const factsApi = {
  // Get all user facts
  getFacts: (options?: { category?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.category) params.set('category', options.category);
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString();
    return api<UserFact[]>(`/api/abilities/facts${query ? `?${query}` : ''}`);
  },

  // Search facts
  searchFacts: (query: string) =>
    api<UserFact[]>(`/api/abilities/facts/search?q=${encodeURIComponent(query)}`),

  // Get a single fact
  getFact: (id: string) =>
    api<UserFact>(`/api/abilities/facts/${id}`),

  // Update a fact
  updateFact: (id: string, value: string, reason?: string) =>
    api<{ success: boolean; oldValue: string; newValue: string }>(`/api/abilities/facts/${id}`, {
      method: 'PUT',
      body: { value, reason },
    }),

  // Delete a fact
  deleteFact: (id: string, reason?: string) =>
    api<{ success: boolean }>(`/api/abilities/facts/${id}`, {
      method: 'DELETE',
      body: reason ? { reason } : undefined,
    }),

  // Get correction history
  getCorrectionHistory: (options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const query = params.toString();
    return api<FactCorrection[]>(`/api/abilities/facts/history${query ? `?${query}` : ''}`);
  },
};
