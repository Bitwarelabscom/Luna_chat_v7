import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { WebSocket as WS } from 'ws';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '../utils/logger.js';
import { validateExternalUrl } from '../utils/url-validator.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';
const BROWSER_PROFILE_BASE_DIR = process.env.BROWSER_PROFILE_BASE_DIR || '/app/browser-profiles';
const SESSION_TIMEOUT = 300000; // 5 minutes idle timeout
const NAVIGATION_TIMEOUT_MS = 30000;
const SELECTOR_TIMEOUT_MS = 10000;
const SCREENCAST_QUALITY = 80;
const SCREENCAST_MAX_WIDTH = 1280;
const SCREENCAST_MAX_HEIGHT = 720;

export interface BrowserPageElement {
  tag: string;
  text: string;
  selector: string;
  type?: string;
}

export interface BrowserPageContent {
  url: string;
  title: string;
  text: string;
  elements: BrowserPageElement[];
}

interface BrowserSession {
  userId: string;
  wsClient: WS | null;
  context: BrowserContext;
  page: Page;
  cdpSession: CDPSession;
  currentUrl: string | null;
  lastActivityAt: Date;
  isActive: boolean;
  frameCount: number;
  lastFrameLogAt: number;
  screencastStarted: boolean;
  screencastHandler: ((frame: { data: string; metadata?: unknown; sessionId: number }) => Promise<void>) | null;
}

interface BrowserCommand {
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
}

const activeSessions = new Map<string, BrowserSession>();
const pendingSessionCreations = new Map<string, Promise<BrowserSession>>();

// Cleanup idle sessions
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of activeSessions) {
    if (now - session.lastActivityAt.getTime() > SESSION_TIMEOUT) {
      logger.info('Cleaning up idle browser screencast session', { userId });
      void closeBrowserSession(userId);
    }
  }
}, 60000);

cleanupTimer.unref?.();

function sanitizeProfileKey(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function ensureProfileDirectory(userId: string): Promise<string> {
  const profileDir = path.join(BROWSER_PROFILE_BASE_DIR, sanitizeProfileKey(userId));
  await fs.mkdir(profileDir, { recursive: true });
  return profileDir;
}

function sendWsMessage(session: BrowserSession, payload: Record<string, unknown>): void {
  if (!session.wsClient || session.wsClient.readyState !== WS.OPEN) {
    return;
  }

  try {
    session.wsClient.send(JSON.stringify({ ...payload, timestamp: Date.now() }));
  } catch (error) {
    logger.warn('Failed to send browser websocket message', {
      userId: session.userId,
      error: (error as Error).message,
      type: payload.type,
    });
  }
}

function updateNavigationState(session: BrowserSession, url: string): void {
  if (!url) {
    return;
  }

  if (session.currentUrl !== url) {
    session.currentUrl = url;
    sendWsMessage(session, {
      type: 'browser_navigated',
      url,
    });
  }
}

function isLocalSandboxUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Check if a file:// URL points to a valid workspace file
 * Security: Uses realpath to prevent symlink attacks and path traversal
 */
async function isAllowedFileUrl(urlString: string, userId: string): Promise<{ allowed: boolean; error?: string; sandboxPath?: string }> {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'file:') {
      return { allowed: false, error: 'Not a file:// URL' };
    }

    // Get file path from URL (handles URL encoding)
    const filePath = decodeURIComponent(url.pathname);

    // The URL should use /workspace/{userId}/ format (sandbox path)
    const expectedPrefix = `/workspace/${userId}/`;
    if (!filePath.startsWith(expectedPrefix)) {
      return { allowed: false, error: 'File path must be within your workspace' };
    }

    // Extract filename from path
    const filename = filePath.substring(expectedPrefix.length);

    // Check for path traversal attempts in filename
    if (filename.includes('..') || filename.includes('/')) {
      return { allowed: false, error: 'Invalid filename - path traversal not allowed' };
    }

    // Build host path for validation
    const hostPath = path.join(WORKSPACE_DIR, userId, filename);

    // Check file exists on host
    try {
      const stat = await fs.stat(hostPath);
      if (!stat.isFile()) {
        return { allowed: false, error: 'Path is not a regular file' };
      }
    } catch {
      return { allowed: false, error: 'File not found in workspace' };
    }

    // Use realpath to resolve any symlinks and verify it's still in workspace
    const realPath = await fs.realpath(hostPath);
    const workspaceRealPath = await fs.realpath(path.join(WORKSPACE_DIR, userId));

    if (!realPath.startsWith(workspaceRealPath + path.sep) && realPath !== workspaceRealPath) {
      return { allowed: false, error: 'File resolves outside workspace (symlink attack prevented)' };
    }

    // Return the sandbox path for the browser to use
    return { allowed: true, sandboxPath: filePath };
  } catch (error) {
    logger.error('Error validating file URL in screencast', { urlString, userId, error: (error as Error).message });
    return { allowed: false, error: 'Failed to validate file URL' };
  }
}

async function normalizeNavigationUrl(userId: string, url: string): Promise<string> {
  if (url.startsWith('file://')) {
    const fileCheck = await isAllowedFileUrl(url, userId);
    if (!fileCheck.allowed) {
      throw new Error(fileCheck.error || 'File URL not allowed');
    }

    return `file://${fileCheck.sandboxPath}`;
  }

  if (isLocalSandboxUrl(url)) {
    return url;
  }

  await validateExternalUrl(url, { allowHttp: true });
  return url;
}

async function waitForPageSettle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function startScreencast(session: BrowserSession): Promise<void> {
  if (session.screencastStarted) {
    return;
  }

  const frameHandler = async (frame: { data: string; metadata?: unknown; sessionId: number }): Promise<void> => {
    try {
      session.lastActivityAt = new Date();

      if (session.wsClient && session.wsClient.readyState === WS.OPEN) {
        session.wsClient.send(JSON.stringify({
          type: 'browser_frame',
          data: frame.data,
          metadata: frame.metadata,
          timestamp: Date.now(),
        }));

        session.frameCount += 1;
        const now = Date.now();
        if (now - session.lastFrameLogAt > 5000) {
          logger.info('Browser frames sent', {
            userId: session.userId,
            frameCount: session.frameCount,
            currentUrl: session.currentUrl,
          });
          session.lastFrameLogAt = now;
        }
      }
    } catch (error) {
      logger.warn('Failed to process screencast frame', {
        userId: session.userId,
        error: (error as Error).message,
      });
    } finally {
      try {
        await session.cdpSession.send('Page.screencastFrameAck', {
          sessionId: frame.sessionId,
        });
      } catch (error) {
        logger.warn('Failed to acknowledge screencast frame', {
          userId: session.userId,
          error: (error as Error).message,
        });
      }
    }
  };

  await session.cdpSession.send('Page.startScreencast', {
    format: 'jpeg',
    quality: SCREENCAST_QUALITY,
    maxWidth: SCREENCAST_MAX_WIDTH,
    maxHeight: SCREENCAST_MAX_HEIGHT,
    everyNthFrame: 1,
  });

  session.cdpSession.on('Page.screencastFrame', frameHandler);
  session.screencastStarted = true;
  session.screencastHandler = frameHandler;
}

async function stopScreencast(session: BrowserSession): Promise<void> {
  if (!session.screencastStarted) {
    return;
  }

  if (session.screencastHandler) {
    session.cdpSession.off('Page.screencastFrame', session.screencastHandler);
  }

  try {
    await session.cdpSession.send('Page.stopScreencast');
  } catch (error) {
    logger.debug('Failed to stop screencast cleanly', {
      userId: session.userId,
      error: (error as Error).message,
    });
  }

  session.screencastStarted = false;
  session.screencastHandler = null;
}

async function createSession(userId: string): Promise<BrowserSession> {
  const profileDir = await ensureProfileDirectory(userId);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
    ],
    viewport: { width: 1280, height: 720 },
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

  const cdpSession = await context.newCDPSession(page);

  const session: BrowserSession = {
    userId,
    wsClient: null,
    context,
    page,
    cdpSession,
    currentUrl: page.url() || null,
    lastActivityAt: new Date(),
    isActive: true,
    frameCount: 0,
    lastFrameLogAt: 0,
    screencastStarted: false,
    screencastHandler: null,
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      session.lastActivityAt = new Date();
      updateNavigationState(session, frame.url());
    }
  });

  context.on('close', () => {
    const active = activeSessions.get(userId);
    if (active === session) {
      activeSessions.delete(userId);
    }

    session.isActive = false;
  });

  activeSessions.set(userId, session);

  logger.info('Browser session created', { userId, profileDir });
  return session;
}

async function ensureSession(userId: string): Promise<BrowserSession> {
  const existing = activeSessions.get(userId);
  if (existing && existing.isActive) {
    return existing;
  }

  const pending = pendingSessionCreations.get(userId);
  if (pending) {
    return pending;
  }

  const createPromise = createSession(userId)
    .finally(() => {
      pendingSessionCreations.delete(userId);
    });

  pendingSessionCreations.set(userId, createPromise);
  return createPromise;
}

/**
 * Start or attach a browser session to a websocket client
 */
export async function startBrowserSession(userId: string, wsClient: WS): Promise<void> {
  const session = await ensureSession(userId);

  // Replace previous websocket if user re-opened browser window
  if (session.wsClient && session.wsClient !== wsClient && session.wsClient.readyState === WS.OPEN) {
    try {
      session.wsClient.close(4000, 'Superseded by new browser connection');
    } catch {
      // Ignore close failures
    }
  }

  session.wsClient = wsClient;
  session.lastActivityAt = new Date();

  await startScreencast(session);

  sendWsMessage(session, { type: 'browser_ready' });

  const currentUrl = session.page.url();
  if (currentUrl && currentUrl !== 'about:blank') {
    updateNavigationState(session, currentUrl);
  }
}

/**
 * Send command to browser
 */
export async function sendBrowserCommand(userId: string, command: BrowserCommand): Promise<void> {
  const session = await ensureSession(userId);
  session.lastActivityAt = new Date();

  const logMeta = {
    userId,
    action: command.action,
    url: command.url,
    selector: command.selector,
  };

  try {
    if (command.action === 'close') {
      await closeBrowserSession(userId);
      return;
    }

    if (command.action === 'navigate') {
      if (!command.url) {
        throw new Error('navigate action requires url');
      }

      const safeUrl = await normalizeNavigationUrl(userId, command.url);

      try {
        await session.page.goto(safeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATION_TIMEOUT_MS,
        });
      } catch (error) {
        const message = (error as Error).message || '';
        if (message.includes('ERR_ABORTED')) {
          await session.page.waitForTimeout(1000);
          await session.page.goto(safeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: NAVIGATION_TIMEOUT_MS,
          });
        } else {
          throw error;
        }
      }

      await waitForPageSettle(session.page);
      updateNavigationState(session, session.page.url());
      return;
    }

    if (command.action === 'click') {
      if (command.x === undefined || command.y === undefined) {
        throw new Error('click action requires x and y coordinates');
      }

      const urlBefore = session.page.url();
      await session.page.mouse.click(command.x, command.y);
      await waitForPageSettle(session.page);
      const urlAfter = session.page.url();
      if (urlAfter !== urlBefore) {
        updateNavigationState(session, urlAfter);
      }
      return;
    }

    if (command.action === 'scroll') {
      if (command.deltaY === undefined) {
        throw new Error('scroll action requires deltaY');
      }

      // Use both mouse wheel and direct window scroll to improve reliability across sites.
      await session.page.mouse.wheel(0, command.deltaY).catch(() => undefined);
      await session.page.evaluate((delta) => {
        const maybeWindow = globalThis as unknown as { scrollBy?: (x: number, y: number) => void };
        maybeWindow.scrollBy?.(0, delta);
      }, command.deltaY).catch(() => undefined);
      return;
    }

    if (command.action === 'type') {
      if (!command.text) {
        throw new Error('type action requires text');
      }

      await session.page.keyboard.type(command.text);
      return;
    }

    if (command.action === 'keypress') {
      if (!command.key) {
        throw new Error('keypress action requires key');
      }

      const urlBefore = session.page.url();
      await session.page.keyboard.press(command.key);
      await waitForPageSettle(session.page);
      const urlAfter = session.page.url();
      if (urlAfter !== urlBefore) {
        updateNavigationState(session, urlAfter);
      }
      return;
    }

    if (command.action === 'clickSelector') {
      if (!command.selector) {
        throw new Error('clickSelector action requires selector');
      }

      const urlBefore = session.page.url();
      await session.page.click(command.selector, { timeout: SELECTOR_TIMEOUT_MS });
      await waitForPageSettle(session.page);
      const urlAfter = session.page.url();
      if (urlAfter !== urlBefore) {
        updateNavigationState(session, urlAfter);
      }
      return;
    }

    if (command.action === 'fillSelector') {
      if (!command.selector) {
        throw new Error('fillSelector action requires selector');
      }

      if (command.value === undefined) {
        throw new Error('fillSelector action requires value');
      }

      await session.page.fill(command.selector, command.value, { timeout: SELECTOR_TIMEOUT_MS });
      return;
    }

    if (command.action === 'waitForSelector') {
      if (!command.selector) {
        throw new Error('waitForSelector action requires selector');
      }

      await session.page.waitForSelector(command.selector, {
        timeout: command.timeout ?? SELECTOR_TIMEOUT_MS,
      });
      return;
    }

    if (command.action === 'refresh') {
      await session.page.reload({
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await waitForPageSettle(session.page);
      updateNavigationState(session, session.page.url());
      return;
    }

    if (command.action === 'back') {
      await session.page.goBack({
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      }).catch(() => null);
      await waitForPageSettle(session.page);
      updateNavigationState(session, session.page.url());
      return;
    }

    if (command.action === 'forward') {
      await session.page.goForward({
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      }).catch(() => null);
      await waitForPageSettle(session.page);
      updateNavigationState(session, session.page.url());
      return;
    }

    throw new Error(`Unknown browser action: ${command.action}`);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('Browser command failed', { ...logMeta, error: message });
    sendWsMessage(session, {
      type: 'browser_error',
      error: message,
    });
    throw error;
  }
}

/**
 * Return DOM-based content for the current page to let the LLM reason
 */
export async function getPageContent(userId: string): Promise<BrowserPageContent> {
  const session = await ensureSession(userId);
  session.lastActivityAt = new Date();

  const extracted = await session.page.evaluate(() => {
    const MAX_TEXT_LENGTH = 5000;
    const MAX_ELEMENTS = 120;

    const documentAny = (globalThis as any).document;

    const cssEscape = (value: string): string => {
      const cssApi = (globalThis as any).CSS;
      if (cssApi && typeof cssApi.escape === 'function') {
        return cssApi.escape(value);
      }

      return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };

    const isVisible = (element: any): boolean => {
      const style = (globalThis as any).getComputedStyle(element);
      if (!style) return false;

      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const buildSelector = (element: any): string => {
      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }

      const parts: string[] = [];
      let current = element;
      let depth = 0;

      while (current && depth < 6) {
        const tagName = String(current.tagName || '').toLowerCase();
        if (!tagName) break;

        if (current.id) {
          parts.unshift(`#${cssEscape(current.id)}`);
          break;
        }

        let nth = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (String(sibling.tagName || '').toLowerCase() === tagName) {
            nth += 1;
          }
          sibling = sibling.previousElementSibling;
        }

        parts.unshift(`${tagName}:nth-of-type(${nth})`);
        current = current.parentElement;
        depth += 1;
      }

      return parts.join(' > ');
    };

    const bodyText = String(documentAny?.body?.innerText || '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_TEXT_LENGTH);

    const candidates = Array.from(
      documentAny.querySelectorAll(
        'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [onclick], [tabindex]'
      )
    ) as any[];

    const seenSelectors = new Set<string>();
    const elements: BrowserPageElement[] = [];

    for (const candidate of candidates) {
      const element = candidate as any;
      if (elements.length >= MAX_ELEMENTS) {
        break;
      }

      if (!isVisible(element)) {
        continue;
      }

      const selector = buildSelector(element);
      if (!selector || seenSelectors.has(selector)) {
        continue;
      }

      seenSelectors.add(selector);

      const tag = String(element.tagName || '').toLowerCase();
      const text = (
        String(element.innerText || '') ||
        String(element.value || '') ||
        String(element.getAttribute?.('aria-label') || '') ||
        String(element.getAttribute?.('placeholder') || '')
      )
        .trim()
        .slice(0, 200);

      let type: string | undefined;
      if (tag === 'input') {
        type = String(element.type || 'text');
      } else if (tag === 'button') {
        type = 'button';
      } else if (tag === 'a') {
        type = 'link';
      }

      elements.push({
        tag,
        text,
        selector,
        type,
      });
    }

    return {
      text: bodyText,
      elements,
    };
  });

  const url = session.page.url();
  const title = await session.page.title();

  updateNavigationState(session, url);

  return {
    url,
    title,
    text: extracted.text,
    elements: extracted.elements,
  };
}

/**
 * Close browser session
 */
export async function closeBrowserSession(userId: string): Promise<void> {
  const session = activeSessions.get(userId);
  if (!session) {
    return;
  }

  activeSessions.delete(userId);
  session.isActive = false;

  try {
    await stopScreencast(session);
  } catch (error) {
    logger.warn('Error while stopping screencast during close', {
      userId,
      error: (error as Error).message,
    });
  }

  try {
    await session.context.close();
  } catch (error) {
    logger.warn('Error closing browser context', {
      userId,
      error: (error as Error).message,
    });
  }

  session.wsClient = null;

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
  if (!session) {
    return null;
  }

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
  getPageContent,
  closeBrowserSession,
  hasActiveSession,
  getSessionInfo,
  getSearchUrl,
  setPendingVisualBrowse,
  consumePendingVisualBrowse,
  hasPendingVisualBrowse,
};
