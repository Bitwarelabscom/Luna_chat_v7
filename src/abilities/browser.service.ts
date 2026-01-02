import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { validateExternalUrl } from '../utils/url-validator.js';
import logger from '../utils/logger.js';
import * as browserScreencast from './browser-screencast.service.js';

// Workspace directory constant (must match workspace.service.ts)
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER || 'luna-sandbox';
const DOCKER_HOST = process.env.DOCKER_HOST || 'http://docker-proxy:2375';
const BROWSER_TIMEOUT = 60000; // 60 seconds per operation
const MAX_OUTPUT_LENGTH = 500000; // 500KB output limit for screenshots
const MAX_CONTENT_LENGTH = 100000; // 100KB for text content
const SESSION_IDLE_TIMEOUT = 300000; // 5 minutes idle timeout

// Types
export interface BrowserResult {
  success: boolean;
  data?: unknown;
  screenshot?: string; // base64 encoded
  error?: string;
  executionTimeMs: number;
  pageTitle?: string;
  pageUrl?: string;
}

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  quality?: number;
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export interface FillOptions {
  delay?: number;
}

export interface PageContent {
  title: string;
  url: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}

export interface ExtractedElement {
  tag: string;
  text: string;
  attributes: Record<string, string>;
}

// Session management - track browser state per user
interface BrowserSession {
  userId: string;
  pageUrl: string | null;
  lastActivityAt: Date;
}

const userSessions = new Map<string, BrowserSession>();

// Blocked URL patterns for security
// NOTE: file: is handled separately via isAllowedFileUrl() to allow workspace files
const BLOCKED_URL_PATTERNS = [
  /^javascript:/i,
  /^data:/i,
  /^about:/i,
  /^chrome:/i,
  /^view-source:/i,
];

function isBlockedUrl(url: string): boolean {
  return BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url));
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
    // Convert to host path for validation
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
    logger.error('Error validating file URL', { urlString, userId, error: (error as Error).message });
    return { allowed: false, error: 'Failed to validate file URL' };
  }
}

// Update session activity
function updateSession(userId: string, pageUrl?: string): void {
  const existing = userSessions.get(userId);
  if (existing) {
    existing.lastActivityAt = new Date();
    if (pageUrl !== undefined) {
      existing.pageUrl = pageUrl;
    }
  } else {
    userSessions.set(userId, {
      userId,
      pageUrl: pageUrl || null,
      lastActivityAt: new Date(),
    });
  }
}

// Get session info
function getSession(userId: string): BrowserSession | undefined {
  return userSessions.get(userId);
}

// Cleanup idle sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of userSessions) {
    if (now - session.lastActivityAt.getTime() > SESSION_IDLE_TIMEOUT) {
      logger.info('Cleaning up idle browser session', { userId });
      userSessions.delete(userId);
    }
  }
}, 60000);

/**
 * Execute a Playwright script in the sandbox container
 */
async function executeBrowserScript(
  script: string,
  timeout: number = BROWSER_TIMEOUT
): Promise<{ output: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const dockerArgs = ['exec', '-i', SANDBOX_CONTAINER, 'node', '-e', script];

    const proc = spawn('docker', dockerArgs, {
      env: { ...process.env, DOCKER_HOST },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        proc.kill();
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Browser operation timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code === 0 || stdout) {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || undefined,
        });
      } else {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

/**
 * Generate Playwright script wrapper
 * Configured to look like a normal Chrome user to avoid bot detection
 */
function wrapPlaywrightScript(bodyCode: string): string {
  return `
const { chromium } = require('/usr/lib/node_modules/playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      geolocation: { longitude: 13.0038, latitude: 55.6050 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,sv;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    });

    // Remove webdriver flag to avoid detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });
      // Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'sv'] });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    ${bodyCode}

  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
`;
}

/**
 * Navigate to a URL
 */
export async function navigate(
  userId: string,
  url: string,
  options: NavigateOptions = {}
): Promise<BrowserResult> {
  const startTime = Date.now();
  const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;

  // Security: check blocked URL patterns
  if (isBlockedUrl(url)) {
    return {
      success: false,
      error: `URL scheme not allowed: ${url.split(':')[0]}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Handle file:// URLs - allow only workspace files
  let actualUrl = url;
  if (url.startsWith('file://')) {
    const fileCheck = await isAllowedFileUrl(url, userId);
    if (!fileCheck.allowed) {
      return {
        success: false,
        error: fileCheck.error || 'File URL not allowed',
        executionTimeMs: Date.now() - startTime,
      };
    }
    // Use the validated sandbox path
    actualUrl = `file://${fileCheck.sandboxPath}`;
    logger.info('Browser navigating to workspace file', { userId, file: fileCheck.sandboxPath });
  } else {
    // SSRF Protection: validate external URLs before navigating
    try {
      await validateExternalUrl(url, { allowHttp: true });
    } catch (error) {
      return {
        success: false,
        error: `URL validation failed: ${(error as Error).message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  // If there's an active screencast session, use it instead of creating a new one
  if (browserScreencast.hasActiveSession(userId)) {
    try {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'navigate',
        url: actualUrl,
      });
      logger.info('Browser navigate via screencast', { userId, url: actualUrl });
      return {
        success: true,
        pageUrl: actualUrl,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Browser navigate via screencast failed', { userId, url: actualUrl, error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  const script = wrapPlaywrightScript(`
    const response = await page.goto(${JSON.stringify(actualUrl)}, {
      waitUntil: ${JSON.stringify(waitUntil)},
      timeout: ${timeout}
    });

    const status = response?.status() || 0;
    const title = await page.title();
    const currentUrl = page.url();
    const bodyText = await page.textContent('body').catch(() => '');
    const contentLength = bodyText?.length || 0;

    // For file:// URLs, skip the content length check (local files are trusted)
    const isFileUrl = ${JSON.stringify(actualUrl)}.startsWith('file://');

    // Detect blocked/empty pages (skip for file:// URLs)
    if (!isFileUrl && (status >= 400 || contentLength < 100)) {
      console.log(JSON.stringify({
        success: false,
        error: status >= 400
          ? 'Page returned HTTP ' + status + ' - site may be blocking automated access'
          : 'Page loaded but has no content - site may require JavaScript or is blocking bots',
        pageTitle: title,
        pageUrl: currentUrl,
        httpStatus: status,
        contentLength: contentLength
      }));
    } else {
      console.log(JSON.stringify({
        success: true,
        pageTitle: title,
        pageUrl: currentUrl,
        httpStatus: status,
        contentLength: contentLength
      }));
    }
  `);

  try {
    const result = await executeBrowserScript(script, timeout + 10000);

    if (result.error && !result.output) {
      logger.error('Browser navigate failed', { userId, url: actualUrl, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser navigate success', { userId, url: actualUrl, title: parsed.pageTitle });

    return {
      success: parsed.success,
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser navigate exception', { userId, url: actualUrl, error: (error as Error).message });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Take a screenshot
 */
export async function screenshot(
  userId: string,
  url: string,
  options: ScreenshotOptions = {}
): Promise<BrowserResult> {
  const startTime = Date.now();
  const { fullPage = false, selector, quality = 80 } = options;

  // Security: check blocked URL patterns
  if (isBlockedUrl(url)) {
    return {
      success: false,
      error: `URL scheme not allowed: ${url.split(':')[0]}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Handle file:// URLs - allow only workspace files
  let actualUrl = url;
  if (url.startsWith('file://')) {
    const fileCheck = await isAllowedFileUrl(url, userId);
    if (!fileCheck.allowed) {
      return {
        success: false,
        error: fileCheck.error || 'File URL not allowed',
        executionTimeMs: Date.now() - startTime,
      };
    }
    // Use the validated sandbox path
    actualUrl = `file://${fileCheck.sandboxPath}`;
    logger.info('Browser screenshot of workspace file', { userId, file: fileCheck.sandboxPath });
  } else {
    // SSRF Protection: validate external URLs
    try {
      await validateExternalUrl(url, { allowHttp: true });
    } catch (error) {
      return {
        success: false,
        error: `URL validation failed: ${(error as Error).message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  const screenshotCode = selector
    ? `await page.locator(${JSON.stringify(selector)}).screenshot({ type: 'jpeg', quality: ${quality} })`
    : `await page.screenshot({ fullPage: ${fullPage}, type: 'jpeg', quality: ${quality} })`;

  const script = wrapPlaywrightScript(`
    const response = await page.goto(${JSON.stringify(actualUrl)}, { waitUntil: 'networkidle', timeout: 30000 });

    const status = response?.status() || 0;
    const title = await page.title();
    const currentUrl = page.url();
    const bodyText = await page.textContent('body').catch(() => '');
    const contentLength = bodyText?.length || 0;

    // For file:// URLs, skip the content length check (local files are trusted)
    const isFileUrl = ${JSON.stringify(actualUrl)}.startsWith('file://');

    // Detect blocked/empty pages before taking screenshot (skip for file:// URLs)
    if (!isFileUrl && (status >= 400 || contentLength < 100)) {
      console.log(JSON.stringify({
        success: false,
        error: status >= 400
          ? 'Page returned HTTP ' + status + ' - site may be blocking automated access. Try a different website.'
          : 'Page loaded but has no visible content - site may require JavaScript or is blocking bots. Try a different website.',
        pageTitle: title,
        pageUrl: currentUrl,
        httpStatus: status,
        contentLength: contentLength
      }));
    } else {
      const screenshotBuffer = ${screenshotCode};
      const screenshotBase64 = screenshotBuffer.toString('base64');

      console.log(JSON.stringify({
        success: true,
        screenshot: screenshotBase64,
        pageTitle: title,
        pageUrl: currentUrl,
        httpStatus: status,
        contentLength: contentLength
      }));
    }
  `);

  try {
    const result = await executeBrowserScript(script, 60000);

    if (result.error && !result.output) {
      logger.error('Browser screenshot failed', { userId, url: actualUrl, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser screenshot success', {
      userId,
      url,
      size: parsed.screenshot?.length || 0,
    });

    return {
      success: parsed.success,
      screenshot: parsed.screenshot,
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser screenshot exception', {
      userId,
      url,
      error: (error as Error).message,
    });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Click an element
 */
export async function click(
  userId: string,
  url: string,
  selector: string,
  options: ClickOptions = {}
): Promise<BrowserResult> {
  const startTime = Date.now();
  const { button = 'left', clickCount = 1, delay = 0 } = options;

  // SSRF Protection
  try {
    await validateExternalUrl(url, { allowHttp: true });
  } catch (error) {
    return {
      success: false,
      error: `URL validation failed: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  // If there's an active screencast session, use it instead of creating a new one
  if (browserScreencast.hasActiveSession(userId)) {
    try {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'clickSelector',
        selector,
      });
      logger.info('Browser click via screencast', { userId, selector });
      return {
        success: true,
        data: { message: `Clicked element: ${selector}` },
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Browser click via screencast failed', { userId, selector, error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  const script = wrapPlaywrightScript(`
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.click(${JSON.stringify(selector)}, {
      button: ${JSON.stringify(button)},
      clickCount: ${clickCount},
      delay: ${delay}
    });

    // Wait for potential navigation or state change
    await page.waitForTimeout(500);

    const title = await page.title();
    const currentUrl = page.url();

    console.log(JSON.stringify({
      success: true,
      pageTitle: title,
      pageUrl: currentUrl,
      message: 'Clicked element: ' + ${JSON.stringify(selector)}
    }));
  `);

  try {
    const result = await executeBrowserScript(script, 45000);

    if (result.error && !result.output) {
      logger.error('Browser click failed', { userId, selector, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser click success', { userId, selector });

    return {
      success: parsed.success,
      data: { message: parsed.message },
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser click exception', { userId, selector, error: (error as Error).message });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Fill a form field
 */
export async function fill(
  userId: string,
  url: string,
  selector: string,
  value: string,
  _options: FillOptions = {}
): Promise<BrowserResult> {
  const startTime = Date.now();

  // SSRF Protection
  try {
    await validateExternalUrl(url, { allowHttp: true });
  } catch (error) {
    return {
      success: false,
      error: `URL validation failed: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  // If there's an active screencast session, use it instead of creating a new one
  if (browserScreencast.hasActiveSession(userId)) {
    try {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'fillSelector',
        selector,
        value,
      });
      logger.info('Browser fill via screencast', { userId, selector });
      return {
        success: true,
        data: { message: `Filled field: ${selector}` },
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Browser fill via screencast failed', { userId, selector, error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  const script = wrapPlaywrightScript(`
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.fill(${JSON.stringify(selector)}, ${JSON.stringify(value)});

    const title = await page.title();
    const currentUrl = page.url();

    console.log(JSON.stringify({
      success: true,
      pageTitle: title,
      pageUrl: currentUrl,
      message: 'Filled field: ' + ${JSON.stringify(selector)}
    }));
  `);

  try {
    const result = await executeBrowserScript(script, 45000);

    if (result.error && !result.output) {
      logger.error('Browser fill failed', { userId, selector, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser fill success', { userId, selector });

    return {
      success: parsed.success,
      data: { message: parsed.message },
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser fill exception', { userId, selector, error: (error as Error).message });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Extract page content
 */
export async function getContent(userId: string, url: string): Promise<BrowserResult> {
  const startTime = Date.now();

  // SSRF Protection
  try {
    await validateExternalUrl(url, { allowHttp: true });
  } catch (error) {
    return {
      success: false,
      error: `URL validation failed: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const script = wrapPlaywrightScript(`
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle', timeout: 30000 });

    const title = await page.title();
    const currentUrl = page.url();

    // Extract main text content
    const text = await page.evaluate(() => {
      // Remove script, style, and other non-content elements
      const elementsToRemove = document.querySelectorAll('script, style, noscript, iframe, svg');
      elementsToRemove.forEach(el => el.remove());

      // Try to find main content area
      const main = document.querySelector('main, article, [role="main"], .content, #content');
      const contentElement = main || document.body;

      return contentElement.innerText.substring(0, 50000);
    });

    // Extract links
    const links = await page.evaluate(() => {
      const linkElements = Array.from(document.querySelectorAll('a[href]'));
      return linkElements.slice(0, 50).map(a => ({
        text: a.innerText.trim().substring(0, 100),
        href: a.href
      })).filter(l => l.text && l.href.startsWith('http'));
    });

    console.log(JSON.stringify({
      success: true,
      pageTitle: title,
      pageUrl: currentUrl,
      content: { title, url: currentUrl, text, links }
    }));
  `);

  try {
    const result = await executeBrowserScript(script, 45000);

    if (result.error && !result.output) {
      logger.error('Browser getContent failed', { userId, url, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser getContent success', { userId, url, textLength: parsed.content?.text?.length });

    return {
      success: parsed.success,
      data: parsed.content,
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser getContent exception', { userId, url, error: (error as Error).message });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Extract elements matching a selector
 */
export async function extractElements(
  userId: string,
  url: string,
  selector: string,
  limit: number = 10
): Promise<BrowserResult> {
  const startTime = Date.now();

  // SSRF Protection
  try {
    await validateExternalUrl(url, { allowHttp: true });
  } catch (error) {
    return {
      success: false,
      error: `URL validation failed: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const script = wrapPlaywrightScript(`
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const title = await page.title();
    const currentUrl = page.url();

    const elements = await page.evaluate(({ sel, lim }) => {
      const els = Array.from(document.querySelectorAll(sel));
      return els.slice(0, lim).map(el => ({
        tag: el.tagName.toLowerCase(),
        text: el.innerText?.substring(0, 500) || '',
        attributes: Object.fromEntries(
          Array.from(el.attributes).map(attr => [attr.name, attr.value])
        )
      }));
    }, { sel: ${JSON.stringify(selector)}, lim: ${Math.min(limit, 100)} });

    console.log(JSON.stringify({
      success: true,
      pageTitle: title,
      pageUrl: currentUrl,
      elements,
      count: elements.length
    }));
  `);

  try {
    const result = await executeBrowserScript(script, 45000);

    if (result.error && !result.output) {
      logger.error('Browser extractElements failed', { userId, selector, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser extractElements success', { userId, selector, count: parsed.count });

    return {
      success: parsed.success,
      data: { elements: parsed.elements, count: parsed.count },
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser extractElements exception', {
      userId,
      selector,
      error: (error as Error).message,
    });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Wait for an element to appear
 */
export async function waitFor(
  userId: string,
  url: string,
  selector: string,
  timeout: number = 10000
): Promise<BrowserResult> {
  const startTime = Date.now();

  // SSRF Protection
  try {
    await validateExternalUrl(url, { allowHttp: true });
  } catch (error) {
    return {
      success: false,
      error: `URL validation failed: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const script = wrapPlaywrightScript(`
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForSelector(${JSON.stringify(selector)}, { timeout: ${Math.min(timeout, 30000)} });

    const title = await page.title();
    const currentUrl = page.url();

    console.log(JSON.stringify({
      success: true,
      pageTitle: title,
      pageUrl: currentUrl,
      message: 'Element found: ' + ${JSON.stringify(selector)}
    }));
  `);

  try {
    const result = await executeBrowserScript(script, timeout + 35000);

    if (result.error && !result.output) {
      logger.error('Browser waitFor failed', { userId, selector, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, parsed.pageUrl);

    logger.info('Browser waitFor success', { userId, selector });

    return {
      success: parsed.success,
      data: { message: parsed.message },
      pageTitle: parsed.pageTitle,
      pageUrl: parsed.pageUrl,
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser waitFor exception', { userId, selector, error: (error as Error).message });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Close browser session (cleanup)
 */
export async function closeBrowser(userId: string): Promise<BrowserResult> {
  const startTime = Date.now();
  const session = getSession(userId);

  if (session) {
    userSessions.delete(userId);
    logger.info('Browser session closed', { userId });
  }

  return {
    success: true,
    data: { message: session ? 'Browser session closed' : 'No active session' },
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Get current browser state
 */
export async function getBrowserState(userId: string): Promise<BrowserResult> {
  const startTime = Date.now();
  const session = getSession(userId);

  return {
    success: true,
    data: {
      hasSession: !!session,
      pageUrl: session?.pageUrl || null,
      lastActivity: session?.lastActivityAt?.toISOString() || null,
    },
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Render HTML content and take a screenshot
 * This allows Luna to create visual HTML pages and show them to the user
 */
export async function renderHtml(
  userId: string,
  htmlContent: string,
  options: ScreenshotOptions = {}
): Promise<BrowserResult> {
  const startTime = Date.now();
  const { fullPage = true, quality = 90 } = options;

  // Validate HTML content isn't too large (max 500KB)
  if (htmlContent.length > 500000) {
    return {
      success: false,
      error: 'HTML content too large (max 500KB)',
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Escape the HTML for safe embedding in the script
  const escapedHtml = JSON.stringify(htmlContent);

  const script = wrapPlaywrightScript(`
    // Set the HTML content directly
    await page.setContent(${escapedHtml}, { waitUntil: 'networkidle', timeout: 30000 });

    const title = await page.title() || 'Luna HTML Page';

    const screenshotBuffer = await page.screenshot({
      fullPage: ${fullPage},
      type: 'jpeg',
      quality: ${quality}
    });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    console.log(JSON.stringify({
      success: true,
      screenshot: screenshotBase64,
      pageTitle: title,
      pageUrl: 'about:blank'
    }));
  `);

  try {
    const result = await executeBrowserScript(script, 60000);

    if (result.error && !result.output) {
      logger.error('Browser renderHtml failed', { userId, error: result.error });
      return {
        success: false,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const parsed = JSON.parse(result.output);
    updateSession(userId, 'html-render');

    logger.info('Browser renderHtml success', {
      userId,
      size: parsed.screenshot?.length || 0,
    });

    return {
      success: parsed.success,
      screenshot: parsed.screenshot,
      pageTitle: parsed.pageTitle,
      pageUrl: 'rendered-html',
      error: parsed.error,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Browser renderHtml exception', {
      userId,
      error: (error as Error).message,
    });
    return {
      success: false,
      error: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Format browser result for LLM prompt context
 */
export function formatBrowserResultForPrompt(result: BrowserResult): string {
  if (!result.success) {
    return `Browser Error: ${result.error || 'Unknown error'}`;
  }

  const parts: string[] = [];

  if (result.pageTitle) {
    parts.push(`Page Title: ${result.pageTitle}`);
  }
  if (result.pageUrl) {
    parts.push(`URL: ${result.pageUrl}`);
  }

  if (result.screenshot) {
    parts.push(`Screenshot captured (${Math.round(result.screenshot.length / 1024)}KB base64)`);
  }

  if (result.data) {
    const data = result.data as Record<string, unknown>;

    if (data.message) {
      parts.push(`Result: ${data.message}`);
    }

    if (data.text) {
      const text = (data.text as string).substring(0, MAX_CONTENT_LENGTH);
      parts.push(`\nPage Content:\n${text}`);
    }

    if (data.links && Array.isArray(data.links)) {
      const links = data.links as Array<{ text: string; href: string }>;
      if (links.length > 0) {
        parts.push(`\nLinks (${links.length} found):`);
        links.slice(0, 20).forEach((link) => {
          parts.push(`  - ${link.text}: ${link.href}`);
        });
      }
    }

    if (data.elements && Array.isArray(data.elements)) {
      const elements = data.elements as ExtractedElement[];
      parts.push(`\nExtracted Elements (${data.count || elements.length} found):`);
      elements.forEach((el, i) => {
        parts.push(`  ${i + 1}. <${el.tag}> ${el.text.substring(0, 200)}`);
      });
    }
  }

  parts.push(`\nExecution time: ${result.executionTimeMs}ms`);

  return parts.join('\n');
}

export default {
  navigate,
  screenshot,
  click,
  fill,
  getContent,
  extractElements,
  waitFor,
  closeBrowser,
  getBrowserState,
  formatBrowserResultForPrompt,
  renderHtml,
};
