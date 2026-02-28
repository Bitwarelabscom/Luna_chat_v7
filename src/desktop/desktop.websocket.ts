/**
 * Desktop WebSocket Handler
 *
 * Manages the Luna KDE desktop integration WebSocket connection.
 * Receives desktop events (window focus, clipboard, etc.) and
 * sends actions/chat back to the KDE client.
 */

import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { logActivityAndBroadcast } from '../activity/activity.service.js';
import { processMessage as processChat } from '../chat/chat.service.js';
import { createSession } from '../chat/session.service.js';

// Per-user desktop state
interface DesktopState {
  ws: WebSocket;
  userId: string;
  currentApp: string;
  currentWindow: string;
  currentDesktop: number;
  connectedAt: Date;
}

const desktopClients = new Map<string, DesktopState>();

// Pending browser command requests keyed by requestId
interface PendingBrowserRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingBrowserRequests = new Map<string, PendingBrowserRequest>();

const BROWSER_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Check if a user has a connected desktop client with browser capability.
 */
export function hasDesktopBrowser(userId: string): boolean {
  const state = desktopClients.get(userId);
  return !!state && state.ws.readyState === WebSocket.OPEN;
}

/**
 * Send a browser command to the desktop client and wait for the result.
 */
export function executeRemoteBrowserCommand(
  userId: string,
  command: Record<string, unknown>,
): Promise<any> {
  const state = desktopClients.get(userId);
  if (!state || state.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('No desktop connection available'));
  }

  const requestId = randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBrowserRequests.delete(requestId);
      reject(new Error('Desktop browser command timed out after 30s'));
    }, BROWSER_COMMAND_TIMEOUT_MS);

    pendingBrowserRequests.set(requestId, { resolve, reject, timer });

    state.ws.send(JSON.stringify({
      type: 'browser_command',
      requestId,
      command,
    }));
  });
}

/**
 * Get current desktop context string for a user (injected into LLM prompt)
 */
export function getDesktopContext(userId: string): string | undefined {
  const state = desktopClients.get(userId);
  if (!state) return undefined;

  const parts: string[] = [];
  parts.push('Platform: KDE Plasma desktop (user\'s local computer)');
  parts.push('Desktop browser: use the open_url tool to open any URL in Firefox on the user\'s desktop. This is fire-and-forget - the page opens but no content is returned. Use fetch_url if you need to read page content programmatically.');
  if (state.currentApp) {
    parts.push(`Current app: ${state.currentApp}`);
  }
  if (state.currentWindow) {
    parts.push(`Window: ${state.currentWindow}`);
  }
  if (state.currentDesktop > 0) {
    parts.push(`Desktop: ${state.currentDesktop}`);
  }
  return parts.join('\n');
}

/**
 * Send an action to a user's desktop client
 */
export function sendDesktopAction(
  userId: string,
  action: string,
  data: Record<string, unknown>
): boolean {
  const state = desktopClients.get(userId);
  if (!state || state.ws.readyState !== WebSocket.OPEN) return false;

  state.ws.send(JSON.stringify({ type: 'action', action, data }));
  return true;
}

/**
 * Handle a new desktop WebSocket connection
 */
export function handleDesktopWsConnection(ws: WebSocket, req: IncomingMessage) {
  const userId = (req as any).user?.userId;

  if (!userId) {
    logger.warn('Desktop WebSocket rejected: no auth');
    ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized' }));
    ws.close();
    return;
  }

  // Close existing connection for this user (single-client model)
  const existing = desktopClients.get(userId);
  if (existing && existing.ws.readyState === WebSocket.OPEN) {
    existing.ws.close(1000, 'Replaced by new connection');
  }

  const state: DesktopState = {
    ws,
    userId,
    currentApp: '',
    currentWindow: '',
    currentDesktop: 1,
    connectedAt: new Date(),
  };
  desktopClients.set(userId, state);

  logger.info('Desktop WebSocket connected', { userId });

  void logActivityAndBroadcast({
    userId,
    category: 'system',
    eventType: 'desktop_connected',
    level: 'info',
    title: 'KDE Desktop connected',
    source: 'desktop-ws',
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(state, msg);
    } catch (e) {
      logger.error('Desktop WS message error', { error: (e as Error).message });
    }
  });

  ws.on('close', () => {
    if (desktopClients.get(userId)?.ws === ws) {
      desktopClients.delete(userId);
    }
    logger.info('Desktop WebSocket closed', { userId });

    void logActivityAndBroadcast({
      userId,
      category: 'system',
      eventType: 'desktop_disconnected',
      level: 'info',
      title: 'KDE Desktop disconnected',
      source: 'desktop-ws',
    });
  });

  ws.on('error', (err) => {
    logger.error('Desktop WebSocket error', { error: err.message, userId });
  });

  // Send initial connected confirmation
  ws.send(JSON.stringify({ type: 'connected', userId }));
}

/**
 * Handle incoming messages from desktop client
 */
async function handleMessage(state: DesktopState, msg: any): Promise<void> {
  switch (msg.type) {
    case 'desktop_event':
      await handleDesktopEvent(state, msg);
      break;

    case 'chat_message':
      await handleChatMessage(state, msg);
      break;

    case 'browser_result':
      handleBrowserResult(msg);
      break;

    default:
      logger.debug('Desktop WS: unknown message type', { type: msg.type });
  }
}

/**
 * Handle desktop events (window focus, clipboard, etc.)
 */
async function handleDesktopEvent(state: DesktopState, msg: any): Promise<void> {
  const { event, data } = msg;

  switch (event) {
    case 'window_focus':
      state.currentApp = data?.resource_class || '';
      state.currentWindow = data?.caption || '';
      break;
    case 'desktop_changed':
      state.currentDesktop = data?.desktop_number || 1;
      break;
  }

  // Log all desktop events as activity
  void logActivityAndBroadcast({
    userId: state.userId,
    category: 'system',
    eventType: `desktop_${event}`,
    level: 'info',
    title: `Desktop: ${event}`,
    message: data?.caption || data?.content?.substring(0, 100) || '',
    details: data,
    source: 'desktop-ws',
  });
}

/**
 * Handle chat messages from the plasmoid — send response back
 */
async function handleChatMessage(state: DesktopState, msg: any): Promise<void> {
  const { userId, ws } = state;
  const { message, sessionId: clientSessionId } = msg;

  if (!message) return;

  try {
    // Ensure we have a session
    let sessionId = clientSessionId;
    if (!sessionId) {
      const session = await createSession({ userId, title: 'KDE Desktop Chat', mode: 'companion' });
      sessionId = session.id;
    }

    // Use the existing chat pipeline
    const result = await processChat({
      userId,
      message,
      sessionId,
      mode: 'companion',
      source: 'api',
    });

    if (ws.readyState === WebSocket.OPEN) {
      // Send full response (chat_chunk + chat_done for client compatibility)
      ws.send(JSON.stringify({ type: 'chat_chunk', content: result.content }));
      ws.send(JSON.stringify({
        type: 'chat_done',
        sessionId,
        fullResponse: result.content,
      }));
    }
  } catch (error) {
    logger.error('Desktop chat error', { error: (error as Error).message, userId });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat_error', error: 'Failed to process message' }));
    }
  }
}

/**
 * Handle browser_result messages from desktop client — resolve pending promises
 */
function handleBrowserResult(msg: any): void {
  const requestId = msg.requestId;
  if (!requestId) return;

  const pending = pendingBrowserRequests.get(requestId);
  if (!pending) {
    logger.warn('Received browser_result for unknown requestId', { requestId });
    return;
  }

  clearTimeout(pending.timer);
  pendingBrowserRequests.delete(requestId);

  if (msg.error) {
    pending.reject(new Error(msg.error));
  } else {
    pending.resolve({
      url: msg.url,
      title: msg.title,
      text: msg.text,
      elements: msg.elements,
    });
  }
}
