import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { MemoryContext } from '../types/index.js';

interface MemoryCoreSession {
  sessionId: string;
  userId: string;
  startTime: Date;
}

interface MemoryCoreInteraction {
  type: 'message' | 'response';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export async function startSession(userId: string): Promise<MemoryCoreSession | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/memory/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as MemoryCoreSession;
    logger.debug('MemoryCore session started', { userId, sessionId: data.sessionId });
    return data;
  } catch (error) {
    logger.warn('Failed to start MemoryCore session', { error: (error as Error).message });
    return null;
  }
}

export async function endSession(sessionId: string): Promise<void> {
  if (!config.memorycore.enabled) return;

  try {
    await fetch(`${config.memorycore.url}/api/memory/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    logger.debug('MemoryCore session ended', { sessionId });
  } catch (error) {
    logger.warn('Failed to end MemoryCore session', { error: (error as Error).message });
  }
}

export async function recordInteraction(
  sessionId: string,
  interaction: MemoryCoreInteraction
): Promise<void> {
  if (!config.memorycore.enabled) return;

  try {
    await fetch(`${config.memorycore.url}/api/memory/interaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, interaction }),
    });
  } catch (error) {
    logger.warn('Failed to record interaction', { error: (error as Error).message });
  }
}

export async function getSemanticMemory(userId: string): Promise<MemoryContext | null> {
  if (!config.memorycore.enabled) return null;

  try {
    const response = await fetch(`${config.memorycore.url}/api/memory/user/${userId}/model`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // User has no memory yet
        return null;
      }
      throw new Error(`MemoryCore returned ${response.status}`);
    }

    const data = await response.json() as MemoryContext;
    return {
      semanticMemory: data.semanticMemory,
      recentPatterns: data.recentPatterns,
    };
  } catch (error) {
    logger.warn('Failed to get semantic memory', { userId, error: (error as Error).message });
    return null;
  }
}

export async function queryEpisodicMemory(
  userId: string,
  options?: { limit?: number; timeWindow?: string }
): Promise<Array<{ type: string; pattern: string; confidence: number }>> {
  if (!config.memorycore.enabled) return [];

  const { limit = 10, timeWindow = '7d' } = options || {};

  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
      timeWindow,
    });

    const response = await fetch(
      `${config.memorycore.url}/api/memory/user/${userId}/episodic?${params}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { patterns?: Array<{ type: string; pattern: string; confidence: number }> };
    return data.patterns || [];
  } catch (error) {
    logger.warn('Failed to query episodic memory', { userId, error: (error as Error).message });
    return [];
  }
}

export async function healthCheck(): Promise<boolean> {
  if (!config.memorycore.enabled) return true;

  try {
    const response = await fetch(`${config.memorycore.url}/api/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function formatMemoryForPrompt(memory: MemoryContext | null): string {
  if (!memory) return '';

  const parts: string[] = [];

  if (memory.semanticMemory?.learningStyleModel) {
    const style = memory.semanticMemory.learningStyleModel;
    parts.push(`User preferences: ${JSON.stringify(style)}`);
  }

  if (memory.recentPatterns && memory.recentPatterns.length > 0) {
    const patterns = memory.recentPatterns
      .slice(0, 3)
      .map((p) => `- ${p.type}: ${p.pattern}`)
      .join('\n');
    parts.push(`Recent patterns:\n${patterns}`);
  }

  if (parts.length === 0) return '';

  return `\n\n[User Context from Memory]\n${parts.join('\n')}\n`;
}

export default {
  startSession,
  endSession,
  recordInteraction,
  getSemanticMemory,
  queryEpisodicMemory,
  healthCheck,
  formatMemoryForPrompt,
};
