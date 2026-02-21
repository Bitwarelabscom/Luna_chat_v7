import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import logger from '../utils/logger.js';
import { verifyToken } from '../auth/jwt.js';
import {
  startBrowserSession,
  sendBrowserCommand,
  closeBrowserSession,
} from './browser-screencast.service.js';

interface BrowserMessage {
  type: string;
  url?: string;
  x?: number;
  y?: number;
  deltaY?: number;
  text?: string;
  key?: string;
  selector?: string;
  value?: string;
  timeout?: number;
}

/**
 * Parse cookies from header
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      cookies[name] = value;
    }
  });

  return cookies;
}

/**
 * Handle browser WebSocket connection
 */
export function handleBrowserWsConnection(ws: WebSocket, request: IncomingMessage): void {
  // Extract token from query string or cookies
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  let token = url.searchParams.get('token');

  // If no token in query, try cookies
  if (!token) {
    const cookies = parseCookies(request.headers.cookie);
    token = cookies['accessToken'];
  }

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', error: 'Authentication required', code: 4001 }));
    ws.close(4001, 'Missing authentication token');
    return;
  }

  // Verify token
  let userId: string;
  try {
    const payload = verifyToken(token);
    userId = payload.userId;
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid or expired token', code: 4002 }));
    ws.close(4002, 'Invalid authentication token');
    return;
  }

  logger.info('Browser WebSocket connected', { userId });

  // Start browser session
  startBrowserSession(userId, ws)
    .then(() => {
      logger.info('Browser session started', { userId });
    })
    .catch((error) => {
      logger.error('Failed to start browser session', { userId, error: error.message });
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to start browser session: ' + error.message,
      }));
      ws.close(4003, 'Failed to start browser session');
    });

  // Handle messages from client
  ws.on('message', (data) => {
    try {
      const message: BrowserMessage = JSON.parse(data.toString());
      const queueCommand = (command: {
        action: string;
        url?: string;
        x?: number;
        y?: number;
        deltaY?: number;
        text?: string;
        key?: string;
        selector?: string;
        value?: string;
        timeout?: number;
      }) => {
        void sendBrowserCommand(userId, command).catch((error) => {
          logger.warn('Browser command failed from websocket', {
            userId,
            action: command.action,
            error: (error as Error).message,
          });
        });
      };

      switch (message.type) {
        case 'navigate':
          if (message.url) {
            queueCommand({ action: 'navigate', url: message.url });
          }
          break;

        case 'click':
          if (message.x !== undefined && message.y !== undefined) {
            queueCommand({ action: 'click', x: message.x, y: message.y });
          }
          break;

        case 'scroll':
          if (message.deltaY !== undefined) {
            queueCommand({ action: 'scroll', deltaY: message.deltaY });
          }
          break;

        case 'type':
          if (message.text) {
            queueCommand({ action: 'type', text: message.text });
          }
          break;

        case 'keypress':
          if (message.key) {
            queueCommand({ action: 'keypress', key: message.key });
          }
          break;

        case 'back':
          queueCommand({ action: 'back' });
          break;

        case 'forward':
          queueCommand({ action: 'forward' });
          break;

        case 'refresh':
          queueCommand({ action: 'refresh' });
          break;

        case 'clickSelector':
          if (message.selector) {
            queueCommand({ action: 'clickSelector', selector: message.selector });
          }
          break;

        case 'fillSelector':
          if (message.selector && message.value !== undefined) {
            queueCommand({ action: 'fillSelector', selector: message.selector, value: message.value });
          }
          break;

        case 'waitForSelector':
          if (message.selector) {
            queueCommand({
              action: 'waitForSelector',
              selector: message.selector,
              timeout: message.timeout,
            });
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          logger.warn('Unknown browser message type', { userId, type: message.type });
      }
    } catch (error) {
      logger.error('Error handling browser message', { userId, error });
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    logger.info('Browser WebSocket disconnected', { userId });
    void closeBrowserSession(userId);
  });

  ws.on('error', (error) => {
    logger.error('Browser WebSocket error', { userId, error: error.message });
    void closeBrowserSession(userId);
  });
}

export default {
  handleBrowserWsConnection,
};
