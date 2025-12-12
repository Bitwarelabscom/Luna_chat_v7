import { WebSocket as WS } from 'ws';
import { spawn } from 'child_process';
import logger from '../utils/logger.js';
import { validateExternalUrl } from '../utils/url-validator.js';

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER || 'luna-sandbox';
const DOCKER_HOST = process.env.DOCKER_HOST || 'http://docker-proxy:2375';
const SESSION_TIMEOUT = 300000; // 5 minutes idle timeout
const SCREENCAST_QUALITY = 80;
const SCREENCAST_MAX_WIDTH = 1280;
const SCREENCAST_MAX_HEIGHT = 720;

interface BrowserSession {
  userId: string;
  wsClient: WS;
  process: ReturnType<typeof spawn> | null;
  cdpWs: WS | null;
  pageId: string | null;
  currentUrl: string | null;
  lastActivityAt: Date;
  isActive: boolean;
}

const activeSessions = new Map<string, BrowserSession>();

// Cleanup idle sessions
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of activeSessions) {
    if (now - session.lastActivityAt.getTime() > SESSION_TIMEOUT) {
      logger.info('Cleaning up idle browser screencast session', { userId });
      closeBrowserSession(userId);
    }
  }
}, 60000);

/**
 * Start a browser session for screencast
 */
export async function startBrowserSession(userId: string, wsClient: WS): Promise<void> {
  // Close any existing session
  if (activeSessions.has(userId)) {
    await closeBrowserSession(userId);
  }

  const session: BrowserSession = {
    userId,
    wsClient,
    process: null,
    cdpWs: null,
    pageId: null,
    currentUrl: null,
    lastActivityAt: new Date(),
    isActive: false,
  };

  activeSessions.set(userId, session);

  try {
    // Start browser in sandbox container with remote debugging
    const debugPort = 9222 + (Math.floor(Math.random() * 1000));

    // Run a long-running browser process with CDP enabled
    const script = `
const { chromium } = require('/usr/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=${debugPort}',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,720',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  // Enable CDP session
  const cdpSession = await page.context().newCDPSession(page);

  // Start screencast
  await cdpSession.send('Page.startScreencast', {
    format: 'jpeg',
    quality: ${SCREENCAST_QUALITY},
    maxWidth: ${SCREENCAST_MAX_WIDTH},
    maxHeight: ${SCREENCAST_MAX_HEIGHT},
    everyNthFrame: 1,
  });

  cdpSession.on('Page.screencastFrame', async (frame) => {
    // Output frame data to stdout for parent process
    console.log(JSON.stringify({
      type: 'frame',
      data: frame.data,
      metadata: frame.metadata,
      sessionId: frame.sessionId,
    }));

    // Acknowledge frame
    await cdpSession.send('Page.screencastFrameAck', {
      sessionId: frame.sessionId,
    });
  });

  // Navigate to blank page initially
  await page.goto('about:blank');
  console.log(JSON.stringify({ type: 'ready', debugPort: ${debugPort} }));

  // Keep alive - listen for commands on stdin
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (data) => {
    try {
      const cmd = JSON.parse(data.toString().trim());

      if (cmd.action === 'navigate' && cmd.url) {
        await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(JSON.stringify({ type: 'navigated', url: cmd.url }));
      } else if (cmd.action === 'click' && cmd.x !== undefined && cmd.y !== undefined) {
        await page.mouse.click(cmd.x, cmd.y);
        console.log(JSON.stringify({ type: 'clicked', x: cmd.x, y: cmd.y }));
      } else if (cmd.action === 'scroll' && cmd.deltaY !== undefined) {
        await page.mouse.wheel(0, cmd.deltaY);
        console.log(JSON.stringify({ type: 'scrolled', deltaY: cmd.deltaY }));
      } else if (cmd.action === 'type' && cmd.text) {
        await page.keyboard.type(cmd.text);
        console.log(JSON.stringify({ type: 'typed', text: cmd.text }));
      } else if (cmd.action === 'keypress' && cmd.key) {
        await page.keyboard.press(cmd.key);
        console.log(JSON.stringify({ type: 'keypressed', key: cmd.key }));
      } else if (cmd.action === 'close') {
        await browser.close();
        process.exit(0);
      }
    } catch (error) {
      console.log(JSON.stringify({ type: 'error', error: error.message }));
    }
  });

  // Handle close
  process.on('SIGTERM', async () => {
    await browser.close();
    process.exit(0);
  });

})();
`;

    const dockerArgs = ['exec', '-i', SANDBOX_CONTAINER, 'node', '-e', script];
    const proc = spawn('docker', dockerArgs, {
      env: { ...process.env, DOCKER_HOST },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = proc;
    session.isActive = true;

    // Handle stdout - browser events and frames
    let buffer = '';
    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handleBrowserMessage(userId, msg);
        } catch (e) {
          logger.warn('Failed to parse browser message', { line, error: e });
        }
      }
    });

    proc.stderr.on('data', (data) => {
      logger.warn('Browser stderr', { userId, data: data.toString() });
    });

    proc.on('close', (code) => {
      logger.info('Browser process closed', { userId, code });
      closeBrowserSession(userId);
    });

    proc.on('error', (error) => {
      logger.error('Browser process error', { userId, error: error.message });
      closeBrowserSession(userId);
    });

  } catch (error) {
    logger.error('Failed to start browser session', { userId, error });
    throw error;
  }
}

/**
 * Handle messages from browser process
 */
function handleBrowserMessage(userId: string, msg: { type: string; [key: string]: unknown }): void {
  const session = activeSessions.get(userId);
  if (!session || session.wsClient.readyState !== WS.OPEN) return;

  session.lastActivityAt = new Date();

  if (msg.type === 'frame') {
    // Send frame to client
    session.wsClient.send(JSON.stringify({
      type: 'browser_frame',
      data: msg.data,
      metadata: msg.metadata,
      timestamp: Date.now(),
    }));
  } else if (msg.type === 'ready') {
    session.wsClient.send(JSON.stringify({
      type: 'browser_ready',
      timestamp: Date.now(),
    }));
  } else if (msg.type === 'navigated') {
    session.currentUrl = msg.url as string;
    session.wsClient.send(JSON.stringify({
      type: 'browser_navigated',
      url: msg.url,
      timestamp: Date.now(),
    }));
  } else if (msg.type === 'error') {
    session.wsClient.send(JSON.stringify({
      type: 'browser_error',
      error: msg.error,
      timestamp: Date.now(),
    }));
  }
}

/**
 * Send command to browser
 */
export async function sendBrowserCommand(userId: string, command: {
  action: string;
  url?: string;
  x?: number;
  y?: number;
  deltaY?: number;
  text?: string;
  key?: string;
}): Promise<void> {
  const session = activeSessions.get(userId);
  if (!session || !session.process || !session.isActive) {
    throw new Error('No active browser session');
  }

  session.lastActivityAt = new Date();

  // Validate URL if navigating
  if (command.action === 'navigate' && command.url) {
    // validateExternalUrl throws on invalid URL
    await validateExternalUrl(command.url, { allowHttp: true });
  }

  if (session.process.stdin) {
    session.process.stdin.write(JSON.stringify(command) + '\n');
  }
}

/**
 * Close browser session
 */
export function closeBrowserSession(userId: string): void {
  const session = activeSessions.get(userId);
  if (!session) return;

  session.isActive = false;

  if (session.process) {
    try {
      if (session.process.stdin) {
        session.process.stdin.write(JSON.stringify({ action: 'close' }) + '\n');
      }
      setTimeout(() => {
        if (session.process && !session.process.killed) {
          session.process.kill('SIGKILL');
        }
      }, 5000);
    } catch (e) {
      logger.warn('Error closing browser process', { userId, error: e });
      session.process.kill('SIGKILL');
    }
  }

  if (session.cdpWs) {
    session.cdpWs.close();
  }

  activeSessions.delete(userId);
  logger.info('Browser session closed', { userId });
}

/**
 * Check if user has active session
 */
export function hasActiveSession(userId: string): boolean {
  const session = activeSessions.get(userId);
  return session?.isActive ?? false;
}

/**
 * Get session info
 */
export function getSessionInfo(userId: string): { currentUrl: string | null } | null {
  const session = activeSessions.get(userId);
  if (!session) return null;
  return {
    currentUrl: session.currentUrl,
  };
}

/**
 * Get search URL for visual browsing
 */
export function getSearchUrl(query: string, engine: 'google' | 'google_news' | 'bing' = 'google_news'): string {
  const encodedQuery = encodeURIComponent(query);
  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${encodedQuery}`;
    case 'google_news':
      return `https://news.google.com/search?q=${encodedQuery}`;
    case 'bing':
      return `https://www.bing.com/search?q=${encodedQuery}`;
    default:
      return `https://news.google.com/search?q=${encodedQuery}`;
  }
}

/**
 * Pending visual browse requests - used to coordinate with frontend
 * When chat requests visual browse, we store the URL here.
 * When frontend opens browser window and connects WebSocket, it checks for pending URL.
 */
const pendingVisualBrowse = new Map<string, { url: string; createdAt: Date }>();

/**
 * Set a pending visual browse URL for a user
 * The frontend will pick this up when it opens the browser window
 */
export function setPendingVisualBrowse(userId: string, url: string): void {
  pendingVisualBrowse.set(userId, { url, createdAt: new Date() });
  // Clean up old pending requests after 30 seconds
  setTimeout(() => {
    const pending = pendingVisualBrowse.get(userId);
    if (pending && Date.now() - pending.createdAt.getTime() > 30000) {
      pendingVisualBrowse.delete(userId);
    }
  }, 30000);
}

/**
 * Get and clear pending visual browse URL
 */
export function consumePendingVisualBrowse(userId: string): string | null {
  const pending = pendingVisualBrowse.get(userId);
  if (pending) {
    pendingVisualBrowse.delete(userId);
    return pending.url;
  }
  return null;
}

/**
 * Check if there's a pending visual browse
 */
export function hasPendingVisualBrowse(userId: string): boolean {
  return pendingVisualBrowse.has(userId);
}

export default {
  startBrowserSession,
  sendBrowserCommand,
  closeBrowserSession,
  hasActiveSession,
  getSessionInfo,
  getSearchUrl,
  setPendingVisualBrowse,
  consumePendingVisualBrowse,
  hasPendingVisualBrowse,
};
