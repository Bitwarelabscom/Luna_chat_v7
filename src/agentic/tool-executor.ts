/**
 * Unified tool executor - extracted from chat.service.ts
 *
 * Every tool the LLM can call is handled here via a single executeTool() function.
 * Returns { toolResponse, sideEffects } so the caller can decide how to yield them.
 */

import type { ToolExecutionContext, ToolExecutionResult } from './types.js';
import { convertLocalTimeToUTC } from './shared-helpers.js';
import { isArtifactTool, handleArtifactToolCall } from '../chat/artifact-tool-handler.js';
import {
  formatSearchResultsForContext,
  formatAgentResultForContext,
} from '../llm/openai.client.js';
import * as searxng from '../search/searxng.client.js';
import * as webfetch from '../search/webfetch.service.js';
import * as agents from '../abilities/agents.service.js';
import * as workspace from '../abilities/workspace.service.js';
import * as sandbox from '../abilities/sandbox.service.js';
import * as emailService from '../abilities/email.service.js';
import * as telegramService from '../triggers/telegram.service.js';
import * as documents from '../abilities/documents.service.js';
import * as youtube from '../abilities/youtube.service.js';
import * as localMedia from '../abilities/local-media.service.js';
import * as ytdlp from '../abilities/ytdlp.service.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as calendarService from '../abilities/calendar.service.js';
import * as reminderService from '../abilities/reminder.service.js';
import * as browser from '../abilities/browser.service.js';
import * as imageGeneration from '../abilities/image-generation.service.js';
import * as backgroundService from '../abilities/background.service.js';
import * as researchAgent from '../abilities/research.agent.service.js';
import * as n8nService from '../abilities/n8n.service.js';
import * as sunoService from '../abilities/suno-generator.service.js';
import * as mcpService from '../mcp/mcp.service.js';
import * as questionsService from '../autonomous/questions.service.js';
import * as loadContextHandler from '../context/load-context.handler.js';
import * as browserScreencast from '../abilities/browser-screencast.service.js';
import * as sessionLogService from '../chat/session-log.service.js';
import * as torrentService from '../abilities/torrent.service.js';
import * as movieGrabber from '../abilities/movie-grabber.service.js';
import * as sessionService from '../chat/session.service.js';
import { broadcastToUser } from '../triggers/delivery.service.js';
import { executeSysmonTool } from '../abilities/sysmon.service.js';
import { summonAgent } from '../agents/communication.js';
import { hasDesktopBrowser, executeRemoteBrowserCommand, sendDesktopAction } from '../desktop/desktop.websocket.js';
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// --- Helper functions (moved from chat.service.ts) ---

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&#x27;': "'", '&#x2F;': '/', '&#47;': '/', '&nbsp;': ' ',
  };
  return text.replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39|#x27|#x2F|#47);/gi,
    (match) => entities[match.toLowerCase()] || match);
}

function getBrowserOpenUrl(userId: string, fallback = 'https://www.google.com'): string {
  return browserScreencast.getSessionInfo(userId)?.currentUrl || fallback;
}

function formatBrowserPageContentForTool(content: browserScreencast.BrowserPageContent): string {
  return JSON.stringify(content, null, 2);
}

async function executeRemoteBrowserToolCall(
  userId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<{ toolResponse: string; openUrl: string }> {
  if (toolName === 'browser_navigate') {
    if (!args.url || typeof args.url !== 'string') throw new Error('browser_navigate requires url');
    const result = await executeRemoteBrowserCommand(userId, { action: 'navigate', url: args.url });
    const openUrl = result?.url || args.url;
    return { openUrl, toolResponse: `Navigated browser session.\n\n${formatBrowserPageContentForTool(result)}` };
  } else if (toolName === 'browser_click') {
    if (!args.selector || typeof args.selector !== 'string') throw new Error('browser_click requires selector');
    if (args.url && typeof args.url === 'string') {
      await executeRemoteBrowserCommand(userId, { action: 'navigate', url: args.url });
    }
    const result = await executeRemoteBrowserCommand(userId, { action: 'clickSelector', selector: args.selector });
    const openUrl = result?.url || args.url || '';
    return { openUrl, toolResponse: `Clicked selector "${args.selector}".\n\n${formatBrowserPageContentForTool(result)}` };
  } else if (toolName === 'browser_type') {
    if (!args.selector || typeof args.selector !== 'string') throw new Error('browser_type requires selector');
    if (typeof args.text !== 'string') throw new Error('browser_type requires text');
    if (args.url && typeof args.url === 'string') {
      await executeRemoteBrowserCommand(userId, { action: 'navigate', url: args.url });
    }
    await executeRemoteBrowserCommand(userId, { action: 'fillSelector', selector: args.selector, value: args.text });
    if (args.submit === true) {
      await executeRemoteBrowserCommand(userId, { action: 'keypress', key: 'Enter' });
    }
    const result = await executeRemoteBrowserCommand(userId, { action: 'get_page_content' });
    const openUrl = result?.url || args.url || '';
    const submissionNote = args.submit === true ? '\nSubmitted with Enter.' : '';
    return { openUrl, toolResponse: `Filled selector "${args.selector}".${submissionNote}\n\n${formatBrowserPageContentForTool(result)}` };
  } else if (toolName === 'browser_get_page_content') {
    if (args.url && typeof args.url === 'string') {
      await executeRemoteBrowserCommand(userId, { action: 'navigate', url: args.url });
    }
    const result = await executeRemoteBrowserCommand(userId, { action: 'get_page_content' });
    const openUrl = result?.url || args.url || '';
    return { openUrl, toolResponse: formatBrowserPageContentForTool(result) };
  }
  throw new Error(`Unsupported remote browser tool: ${toolName}`);
}

async function executeSharedBrowserToolCall(
  userId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<{ toolResponse: string; openUrl: string }> {
  if (hasDesktopBrowser(userId)) {
    return executeRemoteBrowserToolCall(userId, toolName, args);
  }

  if (toolName === 'browser_navigate') {
    if (!args.url || typeof args.url !== 'string') throw new Error('browser_navigate requires url');
    await browserScreencast.sendBrowserCommand(userId, { action: 'navigate', url: args.url });
    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || args.url;
    browserScreencast.setPendingVisualBrowse(userId, openUrl);
    return { openUrl, toolResponse: `Navigated browser session.\n\n${formatBrowserPageContentForTool(pageContent)}` };
  }

  if (toolName === 'browser_click') {
    if (args.url && typeof args.url === 'string') {
      await browserScreencast.sendBrowserCommand(userId, { action: 'navigate', url: args.url });
    }
    if (!args.selector || typeof args.selector !== 'string') throw new Error('browser_click requires selector');
    await browserScreencast.sendBrowserCommand(userId, { action: 'clickSelector', selector: args.selector });
    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || getBrowserOpenUrl(userId);
    browserScreencast.setPendingVisualBrowse(userId, openUrl);
    return { openUrl, toolResponse: `Clicked selector "${args.selector}".\n\n${formatBrowserPageContentForTool(pageContent)}` };
  }

  if (toolName === 'browser_type') {
    if (args.url && typeof args.url === 'string') {
      await browserScreencast.sendBrowserCommand(userId, { action: 'navigate', url: args.url });
    }
    if (!args.selector || typeof args.selector !== 'string') throw new Error('browser_type requires selector');
    if (typeof args.text !== 'string') throw new Error('browser_type requires text');
    await browserScreencast.sendBrowserCommand(userId, { action: 'fillSelector', selector: args.selector, value: args.text });
    if (args.submit === true) {
      await browserScreencast.sendBrowserCommand(userId, { action: 'keypress', key: 'Enter' });
    }
    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || getBrowserOpenUrl(userId);
    browserScreencast.setPendingVisualBrowse(userId, openUrl);
    const submissionNote = args.submit === true ? '\nSubmitted with Enter.' : '';
    return { openUrl, toolResponse: `Filled "${args.selector}".${submissionNote}\n\n${formatBrowserPageContentForTool(pageContent)}` };
  }

  if (toolName === 'browser_get_page_content') {
    if (args.url && typeof args.url === 'string') {
      await browserScreencast.sendBrowserCommand(userId, { action: 'navigate', url: args.url });
    }
    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || getBrowserOpenUrl(userId);
    browserScreencast.setPendingVisualBrowse(userId, openUrl);
    return { openUrl, toolResponse: formatBrowserPageContentForTool(pageContent) };
  }

  throw new Error(`Unknown shared browser tool: ${toolName}`);
}

// --- Interface for tool call shape ---

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

// --- Main executor ---

/**
 * Execute a single tool call and return the response + side effects.
 */
export async function executeTool(
  toolCall: ToolCall,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { userId, sessionId, mode } = ctx;
  const toolName = toolCall.function.name;
  const sideEffects: Array<Record<string, unknown>> = [];

  try {
    const args = JSON.parse(toolCall.function.arguments || '{}');

    // --- Search & Browse ---
    if (toolName === 'web_search') {
      const searchResults = await searxng.search(args.query);
      logger.info('Search executed', { query: args.query, results: searchResults?.length || 0 });
      const searchContext = searchResults && searchResults.length > 0
        ? formatSearchResultsForContext(searchResults)
        : 'No search results found.';
      return { toolResponse: searchContext, sideEffects };
    }

    if (toolName === 'youtube_search') {
      logger.info('YouTube search executing', { query: args.query, limit: args.limit });
      const results = await youtube.searchYouTube(args.query, args.limit || 3);
      if (results.videos.length > 0) {
        sideEffects.push({ type: 'video_action', videos: results.videos, query: results.query });
      }
      return { toolResponse: youtube.formatYouTubeForPrompt(results), sideEffects };
    }

    if (toolName === 'local_media_search') {
      logger.info('Local media search executing', { query: args.query });
      const items = await localMedia.searchLocalMedia(args.query, args.limit || 5);
      if (items.length > 0) {
        sideEffects.push({ type: 'media_action', action: 'search', items, query: args.query, source: 'local' });
      }
      return { toolResponse: localMedia.formatForPrompt(items, args.query), sideEffects };
    }

    if (toolName === 'local_media_play') {
      logger.info('Local media play executing', { fileId: args.fileId, fileName: args.fileName });
      const streamUrl = localMedia.getStreamUrl(args.fileId);
      const decodedPath = Buffer.from(args.fileId, 'base64url').toString();
      const fileExt = decodedPath.toLowerCase().split('.').pop() || '';
      const mediaType = ['mp3', 'flac', 'wav', 'm4a'].includes(fileExt) ? 'audio' : 'video';
      sideEffects.push({
        type: 'media_action', action: 'play',
        items: [{ id: args.fileId, name: args.fileName, type: mediaType, streamUrl }],
        query: args.fileName, source: 'local',
      });
      return { toolResponse: `Started streaming "${args.fileName}". Playback will start in the media player.`, sideEffects };
    }

    if (toolName === 'media_download') {
      logger.info('Media download executing', { videoId: args.videoId, title: args.title, format: args.format });
      const job = args.format === 'audio'
        ? await ytdlp.downloadAudio(args.videoId, args.title)
        : await ytdlp.downloadVideo(args.videoId, args.title);
      return { toolResponse: `Download started (ID: ${job.id}). "${args.title}" is being downloaded as ${args.format}. It will appear in the local media library once complete.`, sideEffects };
    }

    if (toolName === 'torrent_search') {
      logger.info('Torrent search executing', { query: args.query });
      const results = await torrentService.searchProwlarr(args.query);
      if (results.length === 0) {
        return { toolResponse: `No torrent results found for "${args.query}".`, sideEffects };
      }
      const top = results.slice(0, 15);
      const formatted = top.map((r, i) =>
        `${i + 1}. **${r.title}** [${r.category}]\n   Size: ${r.sizeHuman} | Seeders: ${r.seeders} | Leechers: ${r.leechers} | Indexer: ${r.indexer}\n   guid: ${r.guid} | indexerId: ${r.indexerId}`
      ).join('\n\n');
      return { toolResponse: `Found ${results.length} results for "${args.query}" (showing top ${top.length}):\n\n${formatted}`, sideEffects };
    }

    if (toolName === 'torrent_download') {
      logger.info('Torrent download executing', { guid: args.guid, indexerId: args.indexerId, title: args.title });
      await torrentService.grabTorrent(args.guid, args.indexerId);
      return { toolResponse: `Torrent "${args.title}" has been sent to Transmission for download.`, sideEffects };
    }

    if (toolName === 'transmission_status') {
      logger.info('Transmission status check');
      const torrents = await torrentService.getTransmissionTorrents();
      if (torrents.length === 0) {
        return { toolResponse: 'No active torrents in Transmission.', sideEffects };
      }
      const formatted = torrents.map(t => {
        let line = `- **${t.name}**\n  Status: ${t.status} | Progress: ${t.percentDone}% | DL: ${t.rateDownload} | UL: ${t.rateUpload} | ETA: ${t.eta} | Size: ${t.totalSize} | ID: ${t.id}`;
        if (t.mediaFiles.length > 0) {
          line += `\n  Playable files:`;
          t.mediaFiles.forEach(f => {
            line += `\n    - ${f.name} (${f.size}, ${f.type}) | fileId: ${f.fileId}`;
          });
          line += `\n  Use local_media_play with the fileId above to play.`;
        }
        return line;
      }).join('\n');
      return { toolResponse: `Transmission has ${torrents.length} torrent(s):\n\n${formatted}`, sideEffects };
    }

    if (toolName === 'transmission_remove') {
      logger.info('Transmission remove torrent', { id: args.id, deleteData: args.deleteData });
      await torrentService.removeTorrent(args.id, args.deleteData || false);
      return { toolResponse: `Torrent ID ${args.id} removed from Transmission${args.deleteData ? ' (data deleted)' : ''}.`, sideEffects };
    }

    if (toolName === 'movie_grab') {
      logger.info('Movie grab starting', { name: args.name, preferences: args.preferences });
      const result = await movieGrabber.grabMovie(args.name, args.preferences);
      return { toolResponse: result.ok ? `OK - ${result.message}` : `FAILED - ${result.message}`, sideEffects };
    }

    if (toolName === 'fetch_url') {
      logger.info('Fetching URL', { url: args.url });
      const page = await webfetch.fetchPage(args.url);
      const formattedContent = webfetch.formatPageForContext(page, 6000);
      return { toolResponse: `Successfully fetched URL:\n${formattedContent}`, sideEffects };
    }

    if (toolName === 'browser_visual_search') {
      const searchEngine = args.searchEngine || 'google_news';
      const searchUrl = browserScreencast.getSearchUrl(args.query, searchEngine);
      logger.info('Browser visual search', { query: args.query, searchEngine, searchUrl });
      sideEffects.push({ type: 'browser_action', action: 'open', url: searchUrl });
      browserScreencast.setPendingVisualBrowse(userId, searchUrl);
      const searchResults = await searxng.search(args.query);
      const searchContext = searchResults && searchResults.length > 0
        ? formatSearchResultsForContext(searchResults)
        : 'No search results found.';
      return { toolResponse: `Browser opened to ${searchUrl} for visual browsing.\n\nSearch results for context:\n${searchContext}`, sideEffects };
    }

    // --- Shared browser tools ---
    if (toolName === 'browser_navigate' || toolName === 'browser_click' ||
        toolName === 'browser_type' || toolName === 'browser_get_page_content') {
      const openUrl = typeof args.url === 'string' && args.url.length > 0
        ? args.url : getBrowserOpenUrl(userId);
      sideEffects.push({ type: 'browser_action', action: 'open', url: openUrl });
      sideEffects.push({ type: 'browser_action', action: toolName, url: openUrl });
      browserScreencast.setPendingVisualBrowse(userId, openUrl);
      logger.info('Shared browser tool', { userId, tool: toolName, url: args.url, selector: args.selector });
      const result = await executeSharedBrowserToolCall(userId, toolName, args);
      if (result.openUrl && result.openUrl !== openUrl) {
        sideEffects.push({ type: 'browser_action', action: 'open', url: result.openUrl });
      }
      return { toolResponse: result.toolResponse, sideEffects };
    }

    if (toolName === 'browser_screenshot') {
      sideEffects.push({ type: 'browser_action', action: 'open', url: args.url });
      logger.info('Browser screenshot', { userId, url: args.url, fullPage: args.fullPage });
      const result = await browser.screenshot(userId, args.url, { fullPage: args.fullPage, selector: args.selector });
      if (result.success && result.screenshot) {
        const saveResult = await imageGeneration.saveScreenshot(userId, result.screenshot, result.pageUrl || args.url);
        if (saveResult.success && saveResult.imageUrl) {
          const imageBlock = imageGeneration.formatImageForChat(saveResult.imageUrl, `Screenshot of ${result.pageTitle || result.pageUrl || args.url}`);
          return { toolResponse: `Screenshot captured successfully.\n\n${imageBlock}\n\nPage: ${result.pageUrl || args.url}\nTitle: ${result.pageTitle || 'N/A'}`, sideEffects };
        }
        return { toolResponse: `Screenshot was captured but could not be saved for display.\nPage visited: ${result.pageUrl || args.url}\nTitle: ${result.pageTitle || 'N/A'}`, sideEffects };
      }
      return { toolResponse: `Screenshot failed: ${result.error || 'Unknown error'}\nPage: ${result.pageUrl || args.url}`, sideEffects };
    }

    if (toolName === 'browser_fill') {
      sideEffects.push({ type: 'browser_action', action: 'open', url: args.url });
      logger.info('Browser fill', { userId, url: args.url, selector: args.selector });
      const result = await browser.fill(userId, args.url, args.selector, args.value);
      return { toolResponse: browser.formatBrowserResultForPrompt(result), sideEffects };
    }

    if (toolName === 'browser_extract') {
      sideEffects.push({ type: 'browser_action', action: 'open', url: args.url });
      logger.info('Browser extract', { userId, url: args.url, selector: args.selector });
      const result = args.selector
        ? await browser.extractElements(userId, args.url, args.selector, args.limit)
        : await browser.getContent(userId, args.url);
      return { toolResponse: browser.formatBrowserResultForPrompt(result), sideEffects };
    }

    if (toolName === 'browser_wait') {
      sideEffects.push({ type: 'browser_action', action: 'open', url: args.url });
      logger.info('Browser wait', { userId, url: args.url, selector: args.selector });
      const result = await browser.waitFor(userId, args.url, args.selector, args.timeout);
      return { toolResponse: browser.formatBrowserResultForPrompt(result), sideEffects };
    }

    if (toolName === 'browser_close') {
      logger.info('Browser close', { userId });
      const result = await browser.closeBrowser(userId);
      return { toolResponse: browser.formatBrowserResultForPrompt(result), sideEffects };
    }

    if (toolName === 'browser_render_html') {
      const htmlContent = decodeHtmlEntities(args.html);
      const pageTitle = args.title || 'Luna HTML Page';
      logger.info('Browser render HTML', { userId, htmlLength: htmlContent.length, title: pageTitle });
      const result = await browser.renderHtml(userId, htmlContent);
      if (result.success && result.screenshot) {
        const saveResult = await imageGeneration.saveScreenshot(userId, result.screenshot, 'rendered-html');
        if (saveResult.success && saveResult.imageUrl) {
          const imageBlock = imageGeneration.formatImageForChat(saveResult.imageUrl, pageTitle);
          return { toolResponse: `HTML page rendered successfully.\n\n${imageBlock}\n\nTitle: ${pageTitle}`, sideEffects };
        }
        return { toolResponse: 'HTML was rendered but the screenshot could not be saved for display.', sideEffects };
      }
      return { toolResponse: `HTML render failed: ${result.error || 'Unknown error'}`, sideEffects };
    }

    if (toolName === 'open_url') {
      logger.info('open_url tool', { userId, url: args.url });
      try {
        const parsed = new URL(args.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { toolResponse: `Rejected: only http and https URLs are allowed (got ${parsed.protocol})`, sideEffects };
        }
        const sent = sendDesktopAction(userId, 'open_url', { url: parsed.href });
        return { toolResponse: sent ? `Opened ${parsed.href} in Firefox on the desktop.` : 'Desktop not connected - could not open URL.', sideEffects };
      } catch {
        return { toolResponse: `Invalid URL: ${args.url}`, sideEffects };
      }
    }

    // --- Artifacts ---
    if (isArtifactTool(toolName)) {
      const result = await handleArtifactToolCall(toolName, args, userId, sessionId, true);
      for (const chunk of result.chunks) {
        sideEffects.push(chunk);
      }
      return { toolResponse: result.toolResponse, sideEffects };
    }

    // --- Agents ---
    if (toolName === 'delegate_to_agent') {
      logger.info('Delegating to agent', { agent: args.agent, task: args.task?.substring(0, 100) });
      const result = await agents.executeAgentTask(userId, {
        agentName: args.agent,
        task: args.task,
        context: args.context,
      });
      logger.info('Agent completed', { requestedAgent: args.agent, actualAgent: result.agentName, success: result.success, timeMs: result.executionTimeMs });
      return { toolResponse: formatAgentResultForContext(result.agentName, result.result, result.success), sideEffects };
    }

    if (toolName === 'summon_agent') {
      logger.info('Summoning agent', { agentId: args.agent_id, reason: args.reason?.substring(0, 100) });
      // Note: messages context must be passed differently since we don't have the full messages here.
      // The caller should handle building recentContext if needed, but summonAgent already handles it.
      const summonResult = await summonAgent({
        fromAgentId: mode,
        toAgentId: args.agent_id,
        reason: args.reason,
        conversationContext: args._recentContext || '',
        sessionId,
        userId,
      });
      return { toolResponse: `[${summonResult.agentName} responds]\n${summonResult.response}`, sideEffects };
    }

    // --- Workspace ---
    if (toolName === 'workspace_write') {
      logger.info('Workspace write', { userId, filename: args.filename, contentLength: args.content?.length });
      const file = await workspace.writeFile(userId, args.filename, args.content);
      logger.info('Workspace file written', { userId, filename: args.filename, size: file.size });
      return { toolResponse: `File "${args.filename}" saved successfully (${file.size} bytes)`, sideEffects };
    }

    if (toolName === 'workspace_read') {
      const content = await workspace.readFile(userId, args.filename);
      return { toolResponse: `Contents of ${args.filename}:\n\`\`\`\n${content}\n\`\`\``, sideEffects };
    }

    if (toolName === 'workspace_execute') {
      const result = await sandbox.executeWorkspaceFile(userId, args.filename, sessionId, args.args || []);
      return { toolResponse: result.success ? `Execution output:\n${result.output}` : `Execution error:\n${result.error}`, sideEffects };
    }

    if (toolName === 'workspace_list') {
      const files = await workspace.listFiles(userId);
      const fileList = files.length > 0
        ? files.map(f => `- ${f.name} (${f.size} bytes, ${f.mimeType})`).join('\n')
        : 'No files in workspace';
      return { toolResponse: `Workspace files:\n${fileList}`, sideEffects };
    }

    // --- Email ---
    if (toolName === 'send_email') {
      logger.info('Sending email', { to: args.to, subject: args.subject });
      const result = await emailService.sendLunaEmail([args.to], args.subject, args.body);
      if (result.success) {
        return { toolResponse: `Email sent successfully to ${args.to}. Message ID: ${result.messageId}`, sideEffects };
      }
      return { toolResponse: `Failed to send email: ${result.error}${result.blockedRecipients ? ` (blocked: ${result.blockedRecipients.join(', ')})` : ''}`, sideEffects };
    }

    if (toolName === 'check_email') {
      const unreadOnly = args.unreadOnly !== false;
      logger.info('Checking email (gated)', { unreadOnly });
      const { emails, quarantinedCount } = unreadOnly
        ? await emailService.getLunaUnreadEmailsGated(userId)
        : await emailService.checkLunaInboxGated(10, userId);
      if (emails.length > 0 || quarantinedCount > 0) {
        return { toolResponse: `Found ${emails.length} email(s):\n${emailService.formatGatedInboxForPrompt(emails, quarantinedCount)}`, sideEffects };
      }
      return { toolResponse: 'No emails found in inbox.', sideEffects };
    }

    if (toolName === 'read_email') {
      logger.info('Reading email (gated)', { uid: args.uid });
      const email = await emailService.fetchEmailByUidGated(args.uid, userId);
      if (email) {
        return { toolResponse: emailService.formatGatedEmailForPrompt(email), sideEffects };
      }
      return { toolResponse: `Email with UID ${args.uid} was quarantined for security review or not found.`, sideEffects };
    }

    if (toolName === 'reply_email') {
      logger.info('Replying to email', { uid: args.uid });
      const result = await emailService.replyToEmail(args.uid, args.body);
      if (result.success) {
        return { toolResponse: `Reply sent successfully. Message ID: ${result.messageId}`, sideEffects };
      }
      return { toolResponse: `Failed to send reply: ${result.error}${result.blockedRecipients ? ` (blocked: ${result.blockedRecipients.join(', ')})` : ''}`, sideEffects };
    }

    if (toolName === 'delete_email') {
      logger.info('Deleting email', { uid: args.uid });
      const success = await emailService.deleteEmail(args.uid);
      return { toolResponse: success ? `Email with UID ${args.uid} has been deleted successfully.` : `Failed to delete email with UID ${args.uid}.`, sideEffects };
    }

    if (toolName === 'mark_email_read') {
      logger.info('Marking email read status', { uid: args.uid, isRead: args.isRead });
      const success = await emailService.markEmailRead(args.uid, args.isRead);
      return { toolResponse: success ? `Email with UID ${args.uid} has been marked as ${args.isRead ? 'read' : 'unread'}.` : `Failed to update read status for email with UID ${args.uid}.`, sideEffects };
    }

    // --- Telegram ---
    if (toolName === 'send_telegram') {
      logger.info('Sending Telegram message', { userId });
      const connection = await telegramService.getTelegramConnection(userId);
      if (!connection || !connection.isActive) {
        return { toolResponse: 'Telegram is not connected for this user. Ask them to link their Telegram account in Settings.', sideEffects };
      }
      await telegramService.sendTelegramMessage(connection.chatId, args.message, { parseMode: 'Markdown' });
      return { toolResponse: 'Message sent successfully to Telegram.', sideEffects };
    }

    if (toolName === 'send_file_to_telegram') {
      logger.info('Sending file to Telegram', { userId, filename: args.filename });
      const connection = await telegramService.getTelegramConnection(userId);
      if (!connection || !connection.isActive) {
        return { toolResponse: 'Telegram is not connected for this user.', sideEffects };
      }
      const exists = await workspace.fileExists(userId, args.filename);
      if (!exists) {
        return { toolResponse: `File "${args.filename}" not found in workspace.`, sideEffects };
      }
      const filePath = `${workspace.getUserWorkspacePath(userId)}/${args.filename}`;
      const success = await telegramService.sendTelegramDocument(connection.chatId, filePath, args.caption);
      return { toolResponse: success ? 'File sent successfully to Telegram.' : 'Failed to send file to Telegram.', sideEffects };
    }

    // --- Documents ---
    if (toolName === 'search_documents') {
      logger.info('Searching documents', { query: args.query });
      const chunks = await documents.searchDocuments(userId, args.query);
      if (chunks.length > 0) {
        return { toolResponse: `Found ${chunks.length} relevant document section(s):\n${documents.formatDocumentsForPrompt(chunks)}`, sideEffects };
      }
      return { toolResponse: 'No matching content found in uploaded documents.', sideEffects };
    }

    // --- Todos ---
    if (toolName === 'list_todos') {
      logger.info('Listing todos', { includeCompleted: args.includeCompleted });
      const todos = await tasksService.getTasks(userId, { status: args.includeCompleted ? undefined : 'pending', limit: 20 });
      const todoList = todos.length > 0
        ? todos.map(t => {
            let entry = `- [${t.id.slice(0, 8)}] ${t.title} (${t.status}, ${t.priority})`;
            if (t.dueAt) entry += ` - due: ${new Date(t.dueAt).toLocaleDateString()}`;
            if (t.description) entry += `\n  Notes: ${t.description}`;
            return entry;
          }).join('\n')
        : 'No todos found.';
      return { toolResponse: `Found ${todos.length} todo(s):\n${todoList}`, sideEffects };
    }

    if (toolName === 'create_todo') {
      logger.info('Creating todo', { title: args.title, dueDate: args.dueDate });
      const parsed = tasksService.parseTaskFromText(args.dueDate || '');
      let remindAt: Date | undefined;
      if (parsed.dueAt && args.remindMinutesBefore) {
        remindAt = new Date(parsed.dueAt.getTime() - args.remindMinutesBefore * 60 * 1000);
      }
      const todo = await tasksService.createTask(userId, {
        title: args.title, description: args.notes, priority: args.priority || 'medium',
        dueAt: parsed.dueAt, remindAt, sourceSessionId: sessionId,
      });
      const dueStr = todo.dueAt ? ` - due: ${new Date(todo.dueAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}` : '';
      const remindStr = remindAt ? ` (reminder ${args.remindMinutesBefore} min before)` : '';
      return { toolResponse: `Created todo: "${todo.title}" [${todo.id.slice(0, 8)}]${dueStr}${remindStr}`, sideEffects };
    }

    if (toolName === 'complete_todo') {
      logger.info('Completing todo', { todoId: args.todoId, title: args.title });
      let todoId = args.todoId;
      const todos = await tasksService.getTasks(userId, { limit: 50 });
      if (todoId && todoId.length < 36) {
        const match = todos.find(t => t.id.startsWith(todoId));
        if (match) todoId = match.id;
      }
      if (!todoId && args.title) {
        const match = todos.find(t => t.title.toLowerCase().includes(args.title.toLowerCase()));
        if (match) todoId = match.id;
      }
      if (todoId) {
        const todo = await tasksService.updateTaskStatus(userId, todoId, 'completed');
        return { toolResponse: todo ? `Marked todo "${todo.title}" as completed.` : 'Todo not found.', sideEffects };
      }
      return { toolResponse: 'Could not find a matching todo. Use list_todos to see available todos.', sideEffects };
    }

    if (toolName === 'update_todo') {
      logger.info('Updating todo', { todoId: args.todoId, title: args.title });
      let todoId = args.todoId;
      const allTodos = await tasksService.getTasks(userId, { limit: 50 });
      if (todoId && todoId.length < 36) {
        const match = allTodos.find(t => t.id.startsWith(todoId));
        if (match) todoId = match.id;
      }
      if (!todoId && args.title) {
        const match = allTodos.find(t => t.title.toLowerCase().includes(args.title.toLowerCase()));
        if (match) todoId = match.id;
      }
      if (todoId) {
        const updates: Partial<tasksService.CreateTaskInput> = {};
        if (args.notes !== undefined) updates.description = args.notes;
        if (args.priority) updates.priority = args.priority;
        if (args.dueDate) {
          const parsed = tasksService.parseTaskFromText(args.dueDate);
          if (parsed.dueAt) updates.dueAt = parsed.dueAt;
        }
        if (args.status) {
          await tasksService.updateTaskStatus(userId, todoId, args.status);
        }
        const todo = Object.keys(updates).length > 0
          ? await tasksService.updateTask(userId, todoId, updates)
          : await tasksService.getTasks(userId, { limit: 1 }).then(t => t.find(x => x.id === todoId));
        return { toolResponse: todo ? `Updated todo "${todo.title}".${args.notes ? ` Notes: ${args.notes}` : ''}` : 'Todo not found.', sideEffects };
      }
      return { toolResponse: 'Could not find a matching todo. Use list_todos to see available todos.', sideEffects };
    }

    if (toolName === 'delete_todo') {
      logger.info('Deleting todo', { taskId: args.taskId });
      const taskId = args.taskId as string;
      if (!taskId) return { toolResponse: 'Error: task ID is required', sideEffects };
      const deleted = await tasksService.deleteTask(userId, taskId);
      return { toolResponse: deleted ? 'Task deleted.' : 'Task not found.', sideEffects };
    }

    // --- Calendar ---
    if (toolName === 'create_calendar_event') {
      logger.info('Creating calendar event', { title: args.title, startTime: args.startTime });
      let userTimezone = 'UTC';
      try {
        const userResult = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length > 0) {
          const settings = userResult.rows[0].settings as { timezone?: string };
          userTimezone = settings.timezone || 'UTC';
        }
      } catch (error) {
        logger.warn('Failed to fetch user timezone', { error: (error as Error).message });
      }
      const parsed = tasksService.parseTaskFromText(args.startTime || '');
      let startAt = parsed.dueAt || new Date();
      if (userTimezone !== 'UTC') startAt = convertLocalTimeToUTC(startAt, userTimezone);
      let endAt: Date;
      if (args.endTime) {
        const endParsed = tasksService.parseTaskFromText(args.endTime);
        endAt = endParsed.dueAt || new Date(startAt.getTime() + 60 * 60 * 1000);
        if (userTimezone !== 'UTC') endAt = convertLocalTimeToUTC(endAt, userTimezone);
      } else {
        endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      }
      const event = await calendarService.createEvent(userId, {
        title: args.title, description: args.description, startAt, endAt,
        location: args.location, isAllDay: args.isAllDay || false,
        reminderMinutes: args.reminderMinutes ?? 15,
      });
      const dateStr = new Date(event.startAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
      const reminderStr = event.reminderMinutes ? ` (reminder ${event.reminderMinutes} min before)` : '';
      return { toolResponse: `Created calendar event: "${event.title}" on ${dateStr}${event.location ? ` @ ${event.location}` : ''}${reminderStr}`, sideEffects };
    }

    if (toolName === 'list_calendar_events') {
      const days = args.days || 7;
      const events = await calendarService.getUpcomingEvents(userId, { days, limit: 10 });
      const eventList = events.length > 0
        ? events.map(e => {
            const d = new Date(e.startAt);
            const dateStr = d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
            return `- ${e.title} (${dateStr})${e.location ? ` @ ${e.location}` : ''}`;
          }).join('\n')
        : 'No upcoming events.';
      return { toolResponse: `Calendar events (next ${days} days):\n${eventList}`, sideEffects };
    }

    if (toolName === 'get_calendar_today') {
      const events = await calendarService.getTodayEvents(userId);
      if (events.length === 0) return { toolResponse: 'No events scheduled for today.', sideEffects };
      const list = events.slice(0, 5).map((e, i) => {
        const start = new Date(e.startAt);
        const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${i + 1}. ${e.title} at ${timeStr}${e.location ? ` (${e.location})` : ''}`;
      }).join('\n');
      return { toolResponse: `Today's events:\n${list}`, sideEffects };
    }

    if (toolName === 'get_calendar_upcoming') {
      const events = await calendarService.getUpcomingEvents(userId, { days: 7, limit: 5 });
      if (events.length === 0) return { toolResponse: 'No upcoming events in the next 7 days.', sideEffects };
      const list = events.map((e, i) => {
        const start = new Date(e.startAt);
        const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${i + 1}. ${e.title} - ${dateStr} at ${timeStr}${e.location ? ` (${e.location})` : ''}`;
      }).join('\n');
      return { toolResponse: `Upcoming events:\n${list}`, sideEffects };
    }

    if (toolName === 'update_calendar_event') {
      logger.info('Updating calendar event', { eventId: args.eventId });
      const eventId = args.eventId as string;
      if (!eventId) return { toolResponse: 'Error: event ID is required', sideEffects };
      const updates: { title?: string; startAt?: Date; endAt?: Date; location?: string } = {};
      if (args.title) updates.title = args.title;
      if (args.startTime) updates.startAt = new Date(args.startTime);
      if (args.endTime) updates.endAt = new Date(args.endTime);
      if (args.location) updates.location = args.location;
      try {
        const event = await calendarService.updateEvent(userId, eventId, updates);
        return { toolResponse: `Updated event: ${event.title}`, sideEffects };
      } catch (error) {
        return { toolResponse: `Failed to update event: ${(error as Error).message}`, sideEffects };
      }
    }

    if (toolName === 'delete_calendar_event') {
      logger.info('Deleting calendar event', { eventId: args.eventId });
      const eventId = args.eventId as string;
      if (!eventId) return { toolResponse: 'Error: event ID is required', sideEffects };
      try {
        await calendarService.deleteEvent(userId, eventId);
        return { toolResponse: 'Event deleted.', sideEffects };
      } catch (error) {
        return { toolResponse: `Failed to delete event: ${(error as Error).message}`, sideEffects };
      }
    }

    // --- Reminders ---
    if (toolName === 'create_reminder') {
      logger.info('Creating reminder', { message: args.message, delayMinutes: args.delay_minutes });
      const reminder = await reminderService.createReminder(userId, args.message, args.delay_minutes);
      const remindAt = reminder.remindAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      return { toolResponse: `Reminder set! I'll notify you via Telegram at ${remindAt} about: "${args.message}"`, sideEffects };
    }

    if (toolName === 'list_reminders') {
      logger.info('Listing reminders');
      const reminders = await reminderService.listReminders(userId);
      if (reminders.length === 0) {
        return { toolResponse: 'No pending reminders.', sideEffects };
      }
      const list = reminders.map(r => {
        const time = r.remindAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        return `- [${r.id.slice(0, 8)}] at ${time}: "${r.message}"`;
      }).join('\n');
      return { toolResponse: `Pending reminders:\n${list}`, sideEffects };
    }

    if (toolName === 'cancel_reminder') {
      logger.info('Cancelling reminder', { reminderId: args.reminder_id });
      const cancelled = await reminderService.cancelReminder(userId, args.reminder_id);
      return { toolResponse: cancelled ? 'Reminder cancelled.' : 'Reminder not found or already delivered.', sideEffects };
    }

    // --- Introspection ---
    if (toolName === 'introspect') {
      logger.info('Luna introspecting', { userId, sessionId });
      const { buildIntrospectionResponse } = await import('../memory/meta-cognition.service.js');
      const report = await buildIntrospectionResponse(userId, sessionId);
      return { toolResponse: report, sideEffects };
    }

    // --- Fact Management ---
    if (toolName === 'save_fact') {
      logger.info('Luna saving fact', { userId, category: args.category, key: args.fact_key });
      const factsService = await import('../memory/facts.service.js');
      await factsService.storeFact(
        userId,
        {
          category: args.category,
          factKey: args.fact_key,
          factValue: args.fact_value,
          confidence: 1.0,
          factType: args.fact_type || 'permanent',
          isCorrection: args.is_correction || false,
        },
        undefined,
        sessionId,
      );
      return { toolResponse: `Fact saved: ${args.category}/${args.fact_key} = "${args.fact_value}"${args.fact_type === 'temporary' ? ' (temporary)' : ''}`, sideEffects };
    }

    if (toolName === 'remove_fact') {
      logger.info('Luna removing fact', { userId, key: args.fact_key, category: args.category });
      const factsService = await import('../memory/facts.service.js');
      const fact = await factsService.getFactByKey(userId, args.fact_key, args.category);
      if (!fact) {
        return { toolResponse: `No active fact found with key "${args.fact_key}".`, sideEffects };
      }
      const result = await factsService.deleteFact(userId, fact.id, args.reason);
      if (result.success) {
        return { toolResponse: `Removed fact: ${fact.category}/${fact.factKey} (was "${fact.factValue}")`, sideEffects };
      }
      return { toolResponse: `Failed to remove fact "${args.fact_key}".`, sideEffects };
    }

    // --- Session / Notes ---
    if (toolName === 'session_note') {
      logger.info('Adding session note', { sessionId, note: args.note });
      await sessionLogService.appendToSummary(sessionId, args.note);
      return { toolResponse: 'Note saved. It will appear in future session greetings.', sideEffects };
    }

    // --- CEO tools ---
    if (toolName === 'ceo_note_build') {
      logger.info('CEO saving build note', { buildId: args.build_id, note: args.note });
      const { addNote } = await import('../ceo/build-tracker.service.js');
      await addNote(args.build_id, userId, args.note, 'checkin');
      return { toolResponse: `Progress note saved: "${args.note}"`, sideEffects };
    }

    if (toolName === 'commit_weekly_plan') {
      logger.info('CEO committing weekly plan', { userId, goals: args.goals?.length, tasks: args.tasks?.length });
      const { commitWeeklyPlan } = await import('../ceo/ceo-org.service.js');
      const result = await commitWeeklyPlan(userId, args);
      return { toolResponse: `Weekly plan committed: ${result.goalsCreated} goals, ${result.tasksCreated} tasks created.`, sideEffects };
    }

    if (toolName === 'query_department_history') {
      const { searchStaffHistory } = await import('../ceo/staff-chat.service.js');
      const results = await searchStaffHistory(userId, args.query, args.department, 8);
      const parts: string[] = [];
      if (results.memoResults.length > 0) {
        parts.push('## Memos');
        for (const m of results.memoResults) parts.push(`- [${m.department}/${m.type}] ${m.title}: ${m.content}`);
      }
      if (results.chatResults.length > 0) {
        parts.push('## Chat History');
        for (const c of results.chatResults) parts.push(`- [${c.department}] ${c.content}`);
      }
      return { toolResponse: parts.length > 0 ? parts.join('\n') : 'No results found.', sideEffects };
    }

    if (toolName === 'start_task') {
      const { startTaskExecution } = await import('../ceo/ceo-org.service.js');
      const task = await startTaskExecution(userId, args.task_id);
      return { toolResponse: task ? `Task "${task.title}" started in background.` : 'Task not found or not startable.', sideEffects };
    }

    if (toolName === 'get_task_status') {
      const { getRunningTasks, getRecentlyCompleted, listTasks } = await import('../ceo/ceo-org.service.js');
      if (args.task_id) {
        const tasks = await listTasks(userId, {});
        const task = tasks.find(t => t.id === args.task_id);
        return { toolResponse: task ? `"${task.title}" [${task.departmentSlug}]: status=${task.status}, execution=${task.executionStatus || 'not started'}${task.resultSummary ? ', result: ' + task.resultSummary : ''}` : 'Task not found.', sideEffects };
      }
      const [running, recent] = await Promise.all([getRunningTasks(userId), getRecentlyCompleted(userId, 10)]);
      const parts: string[] = [];
      if (running.length > 0) { parts.push(`Running (${running.length}):`); for (const t of running) parts.push(`- "${t.title}" [${t.departmentSlug}]`); }
      if (recent.length > 0) { parts.push(`Recently completed (${recent.length}):`); for (const t of recent) parts.push(`- "${t.title}" [${t.departmentSlug}] ${t.executionStatus}: ${t.resultSummary || 'no summary'}`); }
      return { toolResponse: parts.length > 0 ? parts.join('\n') : 'No running or recently completed tasks.', sideEffects };
    }

    // --- Goals ---
    if (toolName === 'suggest_goal') {
      logger.info('Suggesting goal', { title: args.title, goalType: args.goalType });
      await questionsService.storePendingGoalSuggestion(userId, {
        title: args.title, description: args.description, goalType: args.goalType,
      });
      await questionsService.askQuestion(userId, sessionId, {
        question: `Would you like me to create a goal: "${args.title}"?${args.description ? ` (${args.description})` : ''}`,
        context: `Goal type: ${args.goalType}`, priority: 5,
      });
      return { toolResponse: `Goal suggestion "${args.title}" created. The user will see a notification to confirm or decline.`, sideEffects };
    }

    // --- Image generation (fire-and-forget) ---
    if (toolName === 'generate_image') {
      logger.info('Generate image (fire-and-forget)', { userId, sessionId, promptLength: args.prompt?.length });
      imageGeneration.generateImageAsync(userId, sessionId, args.prompt).catch(err =>
        logger.error('Background image generation failed', { userId, error: (err as Error).message })
      );
      return { toolResponse: 'Image generation started. The image will appear when ready.', sideEffects };
    }

    if (toolName === 'generate_desktop_background') {
      logger.info('Generate desktop background (fire-and-forget)', { userId, sessionId, promptLength: args.prompt?.length, style: args.style });
      const setActive = args.setActive !== false;
      // Fire-and-forget: generate, set active, broadcast
      (async () => {
        try {
          const result = await backgroundService.generateBackground(userId, args.prompt, args.style || 'custom');
          if (result.success && result.background) {
            if (setActive) {
              await backgroundService.setActiveBackground(userId, result.background.id);
            }
            const imageBlock = imageGeneration.formatImageForChat(result.background.imageUrl, `Desktop background: ${result.background.name}`);
            const content = `Desktop background generated!${setActive ? ' It is now set as your active background.' : ''}\n\n${imageBlock}`;
            await sessionService.addMessage({ sessionId, role: 'assistant', content, source: 'web' });
            broadcastToUser(userId, {
              type: 'new_message',
              sessionId,
              message: content,
              timestamp: new Date(),
              ...(setActive ? { notification: { category: 'autonomous' as const, title: 'Background Ready', message: 'Your new desktop background is ready', priority: 3, eventType: 'background_refresh' } } : {}),
            });
          } else {
            const errorContent = `Background generation failed: ${result.error || 'Unknown error'}`;
            await sessionService.addMessage({ sessionId, role: 'assistant', content: errorContent, source: 'web' });
            broadcastToUser(userId, { type: 'new_message', sessionId, message: errorContent, timestamp: new Date() });
          }
        } catch (err) {
          logger.error('Background generation async failed', { userId, error: (err as Error).message });
        }
      })();
      return { toolResponse: 'Desktop background generation started. It will appear when ready.', sideEffects };
    }

    // --- Research ---
    if (toolName === 'research') {
      logger.info('Research tool', { userId, query: args.query?.substring(0, 100), depth: args.depth });
      const result = await researchAgent.executeResearch(args.query, userId, {
        depth: args.depth || 'thorough', saveToFile: args.save_to_file,
      });
      if (result.success) {
        let content = `**Research Summary:**\n${result.summary}\n\n**Details:**\n${result.details}`;
        if (result.savedFile) content += `\n\n**Saved to:** ${result.savedFile}`;
        return { toolResponse: content, sideEffects };
      }
      return { toolResponse: `Research failed: ${result.error || 'Unknown error'}`, sideEffects };
    }

    // --- n8n ---
    if (toolName === 'n8n_webhook') {
      logger.info('n8n webhook tool', { userId, workflowPath: args.workflow_path });
      const result = await n8nService.executeWebhook(
        args.workflow_path, args.payload || {},
        { useTestWebhook: args.use_test_webhook === true, userId, sessionId },
      );
      if (result.success) {
        return { toolResponse: `n8n workflow triggered successfully (status ${result.status}).\n${JSON.stringify(result.data ?? {}, null, 2)}`, sideEffects };
      }
      return { toolResponse: `n8n workflow failed (status ${result.status}): ${result.error || 'Unknown error'}`, sideEffects };
    }

    // --- Suno ---
    if (toolName === 'suno_generate') {
      logger.info('suno_generate tool', { userId, count: args.count });
      const gens = await sunoService.triggerBatch(userId, args.count ?? 1, args.style_override);
      return { toolResponse: `Triggered ${gens.length} ambient track generation(s). Check the Factory tab in DJ Luna to monitor progress.`, sideEffects };
    }

    // --- Context loading ---
    if (toolName === 'load_context') {
      logger.info('Load context tool', { userId, params: args });
      const result = await loadContextHandler.handleLoadContext(userId, args);
      return { toolResponse: loadContextHandler.formatLoadContextResult(result), sideEffects };
    }

    if (toolName === 'correct_summary') {
      logger.info('Correct summary tool', { userId, params: args });
      const result = await loadContextHandler.handleCorrectSummary(userId, args);
      return { toolResponse: loadContextHandler.formatCorrectSummaryResult(result), sideEffects };
    }

    // --- System monitoring tools ---
    if (toolName.startsWith('system_') || toolName.startsWith('network_') ||
        toolName.startsWith('process_') || toolName.startsWith('docker_') ||
        toolName.startsWith('service_') || toolName.startsWith('logs_') ||
        toolName.startsWith('maintenance_')) {
      logger.info('Sysmon tool called', { tool: toolName, args });
      const result = await executeSysmonTool(toolName, args);
      return { toolResponse: JSON.stringify(result, null, 2), sideEffects };
    }

    // --- MCP tools ---
    if (toolName.startsWith('mcp_')) {
      const parsed = mcpService.parseMcpToolName(toolName);
      if (parsed) {
        logger.info('MCP tool called', { tool: toolName, serverId: parsed.serverId, toolName: parsed.toolName, args });
        const mcpTool = ctx.mcpUserTools.find(t => t.serverId.startsWith(parsed.serverId) && t.name === parsed.toolName);
        if (mcpTool) {
          const result = await mcpService.executeTool(userId, mcpTool.serverId, parsed.toolName, args);
          return { toolResponse: result.content, sideEffects };
        }
        return { toolResponse: 'MCP tool not found or no longer available', sideEffects };
      }
      return { toolResponse: 'Invalid MCP tool name format', sideEffects };
    }

    // --- Fallback for unknown tools ---
    logger.warn('Unknown tool called', { tool: toolName });
    return { toolResponse: `Tool ${toolName} executed.`, sideEffects };

  } catch (error) {
    logger.error('Tool execution failed', { tool: toolName, error: (error as Error).message });
    return { toolResponse: `Error executing ${toolName}: ${(error as Error).message}`, sideEffects };
  }
}
