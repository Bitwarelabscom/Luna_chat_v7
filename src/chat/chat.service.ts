import { config } from '../config/index.js';
import * as layeredAgent from '../layered-agent/index.js';
import {
  createChatCompletion,
  formatSearchResultsForContext,
  formatAgentResultForContext,
  type ChatMessage,
} from '../llm/openai.client.js';
import {
  searchTool,
  youtubeSearchTool,
  localMediaSearchTool,
  localMediaPlayTool,
  mediaDownloadTool,
  browserVisualSearchTool,
  delegateToAgentTool,
  workspaceWriteTool,
  workspaceExecuteTool,
  workspaceListTool,
  workspaceReadTool,
  sendEmailTool,
  checkEmailTool,
  readEmailTool,
  deleteEmailTool,
  replyEmailTool,
  markEmailReadTool,
  sendTelegramTool,
  sendFileToTelegramTool,
  searchDocumentsTool,
  suggestGoalTool,
  fetchUrlTool,
  listTodosTool,
  createTodoTool,
  completeTodoTool,
  updateTodoTool,
  createCalendarEventTool,
  listCalendarEventsTool,
  sessionNoteTool,
  createReminderTool,
  listRemindersTool,
  cancelReminderTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  browserGetPageContentTool,
  browserFillTool,
  browserExtractTool,
  browserWaitTool,
  browserCloseTool,
  browserRenderHtmlTool,
  generateImageTool,
  generateBackgroundTool,
  researchTool,
  loadContextTool,
  correctSummaryTool,
  generateArtifactTool,
  rewriteArtifactTool,
  updateHighlightedTool,
  saveArtifactFileTool,
  listArtifactsTool,
  loadArtifactTool,
  getArtifactDownloadLinkTool,
} from '../llm/tools/index.js';
import * as loadContextHandler from '../context/load-context.handler.js';
import * as browserScreencast from '../abilities/browser-screencast.service.js';

/**
 * Decode HTML entities in a string
 * LLMs sometimes encode HTML when generating tool calls
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#47;': '/',
    '&nbsp;': ' ',
  };
  return text.replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39|#x27|#x2F|#47);/gi, (match) => entities[match.toLowerCase()] || match);
}

import { isArtifactTool, handleArtifactToolCall } from './artifact-tool-handler.js';
import * as questionsService from '../autonomous/questions.service.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
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
import * as projectService from '../abilities/project.service.js';
import { query as dbQuery } from '../db/postgres.js';
import { pool } from '../db/index.js';
import * as memoryService from '../memory/memory.service.js';
import * as memorycoreClient from '../memory/memorycore.client.js';
// Note: formatStableMemory, formatVolatileMemory available for cache-optimized prompts
// Full tool-calling cache integration requires extending openai.client.ts
import * as preferencesService from '../memory/preferences.service.js';
import * as abilities from '../abilities/orchestrator.js';
import { buildContextualPrompt } from '../persona/luna.persona.js';
import * as sessionService from './session.service.js';
import * as contextCompression from './context-compression.service.js';
import * as backgroundSummarization from './background-summarization.service.js';
import * as sessionLogService from './session-log.service.js';
import * as sessionActivityService from './session-activity.service.js';
import * as authService from '../auth/auth.service.js';
import * as intentContextService from '../intents/intent-context.service.js';
import * as intentDetection from '../intents/intent-detection.service.js';
import logger from '../utils/logger.js';
import { sysmonTools, executeSysmonTool } from '../abilities/sysmon.service.js';
import * as researchAgent from '../abilities/research.agent.service.js';
import * as mcpService from '../mcp/mcp.service.js';
import * as router from '../router/index.js';
import type { RouterDecision } from '../router/router.types.js';
import type { Message, SearchResult } from '../types/index.js';
import * as embeddingService from '../memory/embedding.service.js';
import * as sentimentService from '../memory/sentiment.service.js';
import * as attentionService from '../memory/attention.service.js';
import * as centroidService from '../memory/centroid.service.js';
import type { InteractionEnrichment } from '../memory/memorycore.client.js';

// Per-session tracking for enrichment pipeline
const sessionLastEmbedding = new Map<string, number[]>();
const sessionLastMessageTime = new Map<string, number>();

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, maxSize = 500): void {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

function getBrowserOpenUrl(userId: string, fallback = 'https://www.google.com'): string {
  return browserScreencast.getSessionInfo(userId)?.currentUrl || fallback;
}

function formatBrowserPageContentForTool(content: browserScreencast.BrowserPageContent): string {
  return JSON.stringify(content, null, 2);
}

function getBrowserToolStatusLine(toolName: string, args: Record<string, any>): string {
  if (toolName === 'browser_navigate') {
    return `Navigating to ${args.url}`;
  }
  if (toolName === 'browser_click') {
    return `Clicking ${args.selector}`;
  }
  if (toolName === 'browser_type') {
    return `Typing into ${args.selector}`;
  }
  if (toolName === 'browser_get_page_content') {
    return 'Reading page content';
  }
  return 'Running browser action';
}

async function executeSharedBrowserToolCall(
  userId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<{ toolResponse: string; openUrl: string }> {
  if (toolName === 'browser_navigate') {
    if (!args.url || typeof args.url !== 'string') {
      throw new Error('browser_navigate requires url');
    }

    await browserScreencast.sendBrowserCommand(userId, {
      action: 'navigate',
      url: args.url,
    });

    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || args.url;

    browserScreencast.setPendingVisualBrowse(userId, openUrl);

    return {
      openUrl,
      toolResponse: `Navigated browser session.\n\n${formatBrowserPageContentForTool(pageContent)}`,
    };
  }

  if (toolName === 'browser_click') {
    if (args.url && typeof args.url === 'string') {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'navigate',
        url: args.url,
      });
    }

    if (!args.selector || typeof args.selector !== 'string') {
      throw new Error('browser_click requires selector');
    }

    await browserScreencast.sendBrowserCommand(userId, {
      action: 'clickSelector',
      selector: args.selector,
    });

    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || getBrowserOpenUrl(userId);

    browserScreencast.setPendingVisualBrowse(userId, openUrl);

    return {
      openUrl,
      toolResponse: `Clicked selector \"${args.selector}\".\n\n${formatBrowserPageContentForTool(pageContent)}`,
    };
  }

  if (toolName === 'browser_type') {
    if (args.url && typeof args.url === 'string') {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'navigate',
        url: args.url,
      });
    }

    if (!args.selector || typeof args.selector !== 'string') {
      throw new Error('browser_type requires selector');
    }
    if (typeof args.text !== 'string') {
      throw new Error('browser_type requires text');
    }

    await browserScreencast.sendBrowserCommand(userId, {
      action: 'fillSelector',
      selector: args.selector,
      value: args.text,
    });

    if (args.submit === true) {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'keypress',
        key: 'Enter',
      });
    }

    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || getBrowserOpenUrl(userId);

    browserScreencast.setPendingVisualBrowse(userId, openUrl);

    const submissionNote = args.submit === true ? '\nSubmitted with Enter.' : '';
    return {
      openUrl,
      toolResponse: `Filled selector \"${args.selector}\".${submissionNote}\n\n${formatBrowserPageContentForTool(pageContent)}`,
    };
  }

  if (toolName === 'browser_get_page_content') {
    if (args.url && typeof args.url === 'string') {
      await browserScreencast.sendBrowserCommand(userId, {
        action: 'navigate',
        url: args.url,
      });
    }

    const pageContent = await browserScreencast.getPageContent(userId);
    const openUrl = pageContent.url || getBrowserOpenUrl(userId);

    browserScreencast.setPendingVisualBrowse(userId, openUrl);

    return {
      openUrl,
      toolResponse: formatBrowserPageContentForTool(pageContent),
    };
  }

  throw new Error(`Unsupported shared browser tool: ${toolName}`);
}

/**
 * Convert local time to UTC Date considering user's timezone
 * Takes a Date with time components set in local time and returns UTC equivalent
 */
function convertLocalTimeToUTC(localDate: Date, timezone: string): Date {
  try {
    // Extract time components that were set as "local" time
    const year = localDate.getFullYear();
    const month = localDate.getMonth() + 1;
    const day = localDate.getDate();
    const hours = localDate.getHours();
    const minutes = localDate.getMinutes();

    // Create ISO string representing the time in user's timezone
    const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    // Parse this string as UTC, then get what time that would be in user's timezone
    const utcDate = new Date(isoString + 'Z');
    const localizedString = utcDate.toLocaleString('en-US', { timeZone: timezone, hour12: false });
    const parsedBack = new Date(localizedString);

    // Calculate the offset between what we wanted and what we got
    const offset = parsedBack.getTime() - utcDate.getTime();

    // Adjust the UTC date by the opposite offset to get the correct UTC time
    return new Date(utcDate.getTime() - offset);
  } catch (error) {
    logger.warn('Failed to convert timezone, using local time as UTC', { error: (error as Error).message, timezone });
    return localDate;
  }
}

/**
 * Compute enrichment data for a message before recording to MemoryCore.
 * Non-blocking - returns defaults on any failure.
 */
async function computeEnrichment(
  sessionId: string,
  message: string,
): Promise<{ enrichment: InteractionEnrichment; embedding: number[] }> {
  const now = Date.now();
  const lastTime = sessionLastMessageTime.get(sessionId) || now;
  const interMessageMs = now - lastTime;
  boundedSet(sessionLastMessageTime, sessionId, now);

  try {
    const { embedding } = await embeddingService.generateEmbedding(message);
    const prevEmbedding = sessionLastEmbedding.get(sessionId) || null;
    boundedSet(sessionLastEmbedding, sessionId, embedding);

    // Run sentiment, centroid, and attention in parallel
    const [sentiment, centroid, attention] = await Promise.all([
      sentimentService.analyze(message),
      centroidService.update(sessionId, embedding),
      Promise.resolve(attentionService.compute(message, embedding, prevEmbedding, interMessageMs)),
    ]);

    return {
      embedding,
      enrichment: {
        embedding,
        embeddingCentroid: centroid,
        emotionalValence: sentiment.valence,
        attentionScore: attention.score,
        interMessageMs,
      },
    };
  } catch (error) {
    logger.debug('Enrichment computation failed, using defaults', { error: (error as Error).message });
    return {
      embedding: [],
      enrichment: { interMessageMs },
    };
  }
}

/**
 * Monitor tool results for suspicious content and potential prompt injection
 * Returns true if suspicious content is detected
 */
function monitorToolResults(messages: ChatMessage[]): boolean {
  let suspiciousDetected = false;

  // Patterns to detect in tool results
  const suspiciousPatterns = [
    { pattern: /[\u4e00-\u9fa5]{10,}/g, name: 'Excessive Chinese characters' },
    { pattern: /to=functions\.\w+/g, name: 'Old-style function call format' },
    { pattern: /(?:手机版天天中彩票|彩神争霸|重庆时时|时时彩|彩票平台)/g, name: 'Chinese gambling spam' },
    { pattern: /(?:ดลองใช้ฟรี|คาสิโน|พนัน)/g, name: 'Thai gambling spam' },
    { pattern: /(?:viagra|cialis|pharmacy)[\s\S]{0,50}(?:buy|cheap|discount)/gi, name: 'Pharmaceutical spam' },
    { pattern: /[!@#$%^&*]{8,}/g, name: 'Excessive special characters' },
  ];

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.content) {
      for (const { pattern, name } of suspiciousPatterns) {
        const matches = msg.content.match(pattern);
        if (matches && matches.length > 0) {
          logger.warn('Suspicious pattern detected in tool result', {
            pattern: name,
            matchCount: matches.length,
            toolCallId: msg.tool_call_id,
            contentLength: msg.content.length,
            preview: msg.content.substring(0, 100),
          });
          suspiciousDetected = true;
        }
      }

      // Check for excessive length (possible spam dump)
      if (msg.content.length > 50000) {
        logger.warn('Excessively long tool result detected', {
          toolCallId: msg.tool_call_id,
          contentLength: msg.content.length,
        });
        suspiciousDetected = true;
      }
    }
  }

  return suspiciousDetected;
}

export interface ChatInput {
  sessionId: string;
  userId: string;
  message: string;
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna';
  source?: 'web' | 'telegram' | 'api';
  projectMode?: boolean;
  thinkingMode?: boolean;
  novaMode?: boolean;
  documentIds?: string[];
}

export interface ChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
  searchResults?: SearchResult[];
}

export async function processMessage(input: ChatInput): Promise<ChatOutput> {
  const { sessionId, userId, message, mode, source = 'web', projectMode, thinkingMode, novaMode, documentIds } = input;

  // Initialize MemoryCore session for consolidation tracking
  // This enables episodic memory recording and NeuralSleep LNN processing
  await memorycoreClient.ensureSession(sessionId, userId);

  // Compute enrichment (embedding, sentiment, attention, centroid) before recording
  const { enrichment: pmEnrichment } = await computeEnrichment(sessionId, message).catch(() => ({
    enrichment: {} as InteractionEnrichment, embedding: [] as number[],
  }));

  // Record enriched user message to MemoryCore (async, non-blocking)
  memorycoreClient.recordChatInteraction(sessionId, 'message', message, { mode, source }, pmEnrichment).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Track session activity for automatic consolidation after inactivity
  sessionActivityService.recordActivity(sessionId, userId).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Router-First Architecture: Route decision before any processing
  let routerDecision: RouterDecision | null = null;
  if (config.router?.enabled) {
    try {
      const routerConfig = {
        enabled: config.router.enabled,
        classifierModel: config.router.classifierModel,
        classifierProvider: config.router.classifierProvider as 'anthropic' | 'google' | 'groq' | 'openai',
        classifierTimeoutMs: config.router.classifierTimeoutMs,
        rulesTimeoutMs: config.router.rulesTimeoutMs,
        fallbackRoute: config.router.fallbackRoute as 'nano' | 'pro' | 'pro+tools',
      };

      routerDecision = await router.route(message, { userId, sessionId, mode, source }, routerConfig);

      logger.info('Router-First decision', {
        userId,
        sessionId,
        source,
        route: routerDecision.route,
        class: routerDecision.class,
        risk: routerDecision.risk_if_wrong,
        decisionSource: routerDecision.decision_source,
        timeMs: routerDecision.decision_time_ms,
      });
    } catch (error) {
      logger.error('Router failed, continuing with default path', { error: (error as Error).message });
    }
  }

  // THINKING MODE: Override router decision to force 'pro' tier minimum
  // NOVA MODE: Override router decision to force 'nano' tier (fast responses)
  // Note: Thinking and Nova modes are mutually exclusive (enforced in frontend)
  if (thinkingMode && !novaMode && routerDecision) {
    // If router chose 'nano', upgrade to 'pro'
    if (routerDecision.route === 'nano') {
      logger.info('Thinking mode enabled - upgrading route from nano to pro', {
        userId,
        sessionId,
        originalRoute: routerDecision.route,
      });
      routerDecision = {
        ...routerDecision,
        route: 'pro',
      };
    }
    // If 'pro' or 'pro+tools', keep as-is (already sufficient for thinking mode)
  } else if (novaMode && !thinkingMode && routerDecision) {
    // Nova mode: force fast 'nano' route for quick, energetic responses
    logger.info('Nova mode enabled - forcing nano route for fast responses', {
      userId,
      sessionId,
      originalRoute: routerDecision.route,
    });
    routerDecision = {
      ...routerDecision,
      route: 'nano',
    };
  }

  // Feature flag: Use layered agent architecture if enabled
  // EXCEPTIONS that fall through to legacy (faster) path:
  // - Browser intents (need tool execution)
  // - Simple companion messages (5 LLM calls is overkill for casual chat)
  const isSmallTalk = abilities.isSmallTalk(message);
  const isSimpleCompanion = mode === 'companion' && abilities.isSimpleCompanionMessage(message);
  const skipLayeredAgent = isSmallTalk || isSimpleCompanion;
  if (config.agentEngine === 'layered_v1' && !abilities.isBrowserIntent(message) && !skipLayeredAgent) {
    // Save user message first
    await sessionService.addMessage({
      sessionId,
      role: 'user',
      content: message,
      tokensUsed: 0,
      source,
    });

    const result = await layeredAgent.processLayeredAgent({
      sessionId,
      userId,
      message,
      mode,
      source,
    });

    // Save assistant message
    const assistantMessage = await sessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: result.content,
      tokensUsed: result.metrics?.promptTokens && result.metrics?.completionTokens
        ? result.metrics.promptTokens + result.metrics.completionTokens
        : 0,
      inputTokens: result.metrics?.promptTokens || 0,
      outputTokens: result.metrics?.completionTokens || 0,
      model: result.metrics?.model || 'layered-agent',
      provider: 'layered-agent',
      source,
    });

    return {
      messageId: assistantMessage.id,
      content: result.content,
      tokensUsed: result.metrics?.promptTokens && result.metrics?.completionTokens
        ? result.metrics.promptTokens + result.metrics.completionTokens
        : 0,
    };
  }

  // PROJECT HANDLING: Check if user has an active project and route accordingly
  // Project mode is opt-in - only activate when explicitly enabled
  const isProjectMode = projectMode === true;
  let activeProject: any = null;
  if (isProjectMode) {
    const activeProjectResult = await dbQuery<any>(
      `SELECT * FROM execution_projects
       WHERE user_id = $1 AND status NOT IN ('completed', 'failed')
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    activeProject = activeProjectResult[0];
  }

  if (activeProject && !isSmallTalk) {
    // Check if this is a steering message for the active project
    // For the new planner, steering might be different, but we keep the logic for now
    if (projectService.isSteeringMessage(message)) {
      logger.info('Detected steering message for active project', {
        projectId: activeProject.id,
        projectName: activeProject.name,
        message: message.substring(0, 100),
      });

      // Handle steering based on project status
      // For now, let it fall through or handle specifically
    }
  }

  // INTENT GATING: Detect if this is smalltalk FIRST
  const isSmallTalkMessageLegacy = abilities.isSmallTalk(message);
  const contextOptions = abilities.getContextOptions(message);

  // OPTIMIZED: Run context loading in parallel, but skip heavy loads for smalltalk
  const [
    modelConfig,
    user,
    rawHistory,
    memoryContext,
    abilityContext,
    prefGuidelines,
    intentContext,
  ] = await Promise.all([
    // Get user's model configuration - use fast model for smalltalk
    getUserModelConfig(userId, isSmallTalkMessageLegacy ? 'smalltalk' : 'main_chat'),
    // Get user profile for personalization
    authService.getUserById(userId),
    // Get conversation history (higher limit for compression to work with)
    sessionService.getSessionMessages(sessionId, { limit: 50 }),
    // Build memory context - skip volatile parts for smalltalk, but load stable facts in companion mode
    isSmallTalkMessageLegacy || mode === 'dj_luna'
      ? (mode === 'companion' ? memoryService.buildStableMemoryOnly(userId) : Promise.resolve({ stable: { facts: '', learnings: '' }, volatile: { relevantHistory: '', conversationContext: '' } }))
      : memoryService.buildMemoryContext(userId, message, sessionId),
    // Build ability context - uses contextOptions for selective loading
    abilities.buildAbilityContext(userId, message, sessionId, contextOptions),
    // Get personalization preferences - lightweight, always load
    preferencesService.getResponseGuidelines(userId),
    // Get intent context - lightweight, always load (uses Redis cache)
    isSmallTalkMessageLegacy
      ? Promise.resolve({ activeIntents: [], suspendedIntents: [], recentlyResolved: [] })
      : intentContextService.getIntentContext(userId),
  ]);

  // Check if forced sync summarization is needed (context approaching limit)
  const modelInfo = (await import('../llm/types.js')).getModel(modelConfig.provider, modelConfig.model);
  const contextWindow = modelInfo?.contextWindow || 128000; // Default to 128k if unknown
  let historyForContext = rawHistory;

  if (await contextCompression.shouldForceSummarization(sessionId, rawHistory, contextWindow)) {
    logger.info('Forcing sync summarization before context build', { sessionId, messageCount: rawHistory.length });
    await contextCompression.updateRollingSummary(sessionId, userId);
    // Re-fetch history after summarization (now compressed)
    historyForContext = await sessionService.getSessionMessages(sessionId, { limit: 50 });
  }

  // Build compressed context from history
  // Use less aggressive compression for Telegram to preserve conversation flow
  const compressionConfig = source === 'telegram' ? {
    verbatimMessageCount: 12,        // Keep last 12 messages (6 exchanges) for Telegram
    semanticRetrievalCount: 8,       // Retrieve more relevant older messages
    summarizationThreshold: 15,      // Start summarizing later for Telegram
  } : undefined;

  const compressedCtx = await contextCompression.buildCompressedContext(
    sessionId,
    userId,
    message,
    historyForContext,
    compressionConfig
  );

  const userName = user?.displayName || undefined;
  const memoryPrompt = memoryService.formatMemoryForPrompt(memoryContext);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);
  const prefPrompt = preferencesService.formatGuidelinesForPrompt(prefGuidelines);
  const intentPrompt = intentContextService.formatIntentsForPrompt(intentContext);

  // Detect and learn from feedback signals
  const feedbackSignal = preferencesService.detectFeedbackSignals(message);
  if (feedbackSignal.type && feedbackSignal.confidence >= 0.6) {
    preferencesService.learnFromFeedback(userId, sessionId, feedbackSignal.type, message).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Detect ability intent and execute if confident
  const intent = abilities.detectAbilityIntent(message);
  let abilityActionResult: string | undefined;
  logger.info('Ability intent detected', { intent, message: message.slice(0, 50) });
  if (intent.confidence >= 0.8) {
    logger.info('Executing ability action', { type: intent.type, action: intent.action });
    // Skip automatic task/knowledge creation in companion mode - Luna has tools to handle these
    const skipToolableIntents = mode === 'companion';
    const result = await abilities.executeAbilityAction(userId, sessionId, intent, message, { skipToolableIntents });
    logger.info('Ability action result', { handled: result.handled, hasResult: !!result.result, result: result.result?.substring(0, 200) });
    if (result.handled && result.result) {
      abilityActionResult = `[Action Taken: ${intent.type}]\n${result.result}`;
      logger.info('Ability action result added to context', { type: intent.type, abilityActionResult: abilityActionResult.substring(0, 200) });
    }
  }

  // Load MCP tools dynamically for this user (before building system prompt)
  const mcpUserTools = await mcpService.getAllUserTools(userId);

  // Session log: On first message, get recent sessions for context and create new log
  let sessionHistoryContext = '';
  if (rawHistory.length === 0) {
    // Get recent session logs for context continuity
    const recentLogs = await sessionLogService.getRecentSessionLogs(userId, 3);
    sessionHistoryContext = sessionLogService.formatLogsForContext(recentLogs);

    // Create new session log entry (async, don't block)
    sessionLogService.createSessionLog(userId, sessionId, mode).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Fetch canvas style rules for artifact generation
  let canvasStylePrompt = '';
  let canvasSessionPrompt = '';
  try {
    const canvasService = await import('../canvas/canvas.service.js');
    const styleRules = await canvasService.getStyleRules(userId, 5);
    canvasStylePrompt = canvasService.formatStyleRules(styleRules);
    const latestArtifactId = await canvasService.getLatestArtifactIdForSession(userId, sessionId);
    if (latestArtifactId) {
      canvasSessionPrompt = `ACTIVE CANVAS ARTIFACT ID: ${latestArtifactId}\nWhen editing an existing artifact, always use this exact UUID as artifactId for rewrite_artifact/update_highlighted unless the user explicitly gives a different UUID.`;
    }
    const promotedRules = await canvasService.consumePatternNotification(userId);
    if (promotedRules && promotedRules.length > 0) {
      canvasSessionPrompt += `\n[Style Update] Your editing patterns have been recognized and promoted to style rules:\n${promotedRules.map(r => `- ${r}`).join('\n')}`;
    }
  } catch (error) {
    // Silently fail if canvas service unavailable
  }

  // Combine all context
  const fullContext = [memoryPrompt, abilityPrompt, prefPrompt, intentPrompt, abilityActionResult, canvasStylePrompt, canvasSessionPrompt].filter(Boolean).join('\n\n');

  // Build messages array with MCP tool info and compressed context
  const mcpToolsForPrompt = mcpUserTools.map(t => ({
    name: t.name,
    serverName: t.serverName,
    description: t.description,
  }));
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildContextualPrompt(mode, {
        userName,
        memoryContext: fullContext,
        sessionHistory: sessionHistoryContext,
        conversationSummary: compressedCtx.systemPrefix,
        mcpTools: mcpToolsForPrompt,
        source,
        novaMode,
      }),
    },
  ];

  // Add semantically relevant older messages first (marked as earlier context)
  for (const relevant of compressedCtx.relevantMessages) {
    messages.push({
      role: relevant.role as 'user' | 'assistant',
      content: `[Earlier context] ${contextCompression.compressMessage({ content: relevant.content, role: relevant.role } as Message)}`,
    });
  }

  // Add recent messages (truncated for efficiency)
  for (const msg of compressedCtx.recentMessages) {
    messages.push({
      role: msg.role,
      content: contextCompression.compressMessage(msg),
    });
  }

  // Inject small attached documents inline; large ones are tool-accessible via search_documents
  const pmDocContextBlock = documentIds && documentIds.length > 0
    ? await documents.getDocumentContextBlock(documentIds, userId)
    : '';
  const pmEffectiveMessage = pmDocContextBlock
    ? `${pmDocContextBlock}\n\n${message}`
    : message;

  // Add current message (full, not compressed)
  messages.push({ role: 'user', content: pmEffectiveMessage });

  // Save user message with optional attachments (raw message, no doc prefix)
  const userMessage = await sessionService.addMessage({
    sessionId,
    role: 'user',
    content: message,
    source,
  }, documentIds);

  // Store user message embedding (async) - pass enrichment for valence/attention storage
  memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
    enrichment: { emotionalValence: pmEnrichment.emotionalValence, attentionScore: pmEnrichment.attentionScore },
  });

  // TOOL GATING: Filter tools by mode and smalltalk detection
  // Companion mode: conversational partner + workspace tools
  // Assistant mode: full sysadmin capabilities
  const mcpToolsForLLM = mcpService.formatMcpToolsForLLM(mcpUserTools.map(t => ({ ...t, serverId: t.serverId })));

  // Companion tools - conversational (includes workspace tools)
  const companionTools = [
    searchTool, youtubeSearchTool, localMediaSearchTool, localMediaPlayTool, mediaDownloadTool,
    browserVisualSearchTool, fetchUrlTool,
    sendEmailTool, checkEmailTool, readEmailTool, deleteEmailTool, replyEmailTool, markEmailReadTool,
    sendTelegramTool, sendFileToTelegramTool, searchDocumentsTool, suggestGoalTool,
    listTodosTool, createTodoTool, completeTodoTool, updateTodoTool,
    createCalendarEventTool, listCalendarEventsTool,
    sessionNoteTool, createReminderTool, listRemindersTool, cancelReminderTool,
    browserNavigateTool, browserScreenshotTool, browserClickTool, browserTypeTool, browserGetPageContentTool, browserFillTool,
    browserExtractTool, browserWaitTool, browserCloseTool, browserRenderHtmlTool,
    generateImageTool, generateBackgroundTool, researchTool, delegateToAgentTool,
    loadContextTool, correctSummaryTool,
    workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool,
    generateArtifactTool, rewriteArtifactTool, updateHighlightedTool, saveArtifactFileTool,
    listArtifactsTool, loadArtifactTool, getArtifactDownloadLinkTool
  ];

  // Assistant tools - full sysadmin capabilities (sysmon, MCP)
  const assistantTools = [
    ...companionTools,
    ...sysmonTools,
    ...mcpToolsForLLM
  ];

  // Select tools based on mode
  let modeTools = mode === 'companion' ? companionTools : assistantTools;
  if (mode === 'dj_luna') {
    modeTools = [searchTool, fetchUrlTool, youtubeSearchTool, mediaDownloadTool];
  }
  const availableTools = isSmallTalkMessageLegacy ? [] : modeTools;
  let searchResults: SearchResult[] | undefined;
  let agentResults: Array<{ agent: string; result: string; success: boolean }> = [];

  let completion = await createChatCompletion({
    messages,
    tools: availableTools.length > 0 ? availableTools : undefined,
    provider: modelConfig.provider,
    model: modelConfig.model,
    loggingContext: {
      userId,
      sessionId,
      source: 'chat',
      nodeName: 'chat_initial',
    },
  });

  // Handle tool calls using proper tool calling flow
  if (completion.toolCalls && completion.toolCalls.length > 0) {
    // Log what tools were called
    const toolNames = completion.toolCalls.map(tc => tc.function.name);
    logger.info('Tool calls received from LLM', { toolNames, count: toolNames.length });

    // Add assistant message with tool calls to conversation
    messages.push({
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls,
    } as ChatMessage);

    for (const toolCall of completion.toolCalls) {
      if (toolCall.function.name === 'web_search') {
        const args = JSON.parse(toolCall.function.arguments);
        searchResults = await searxng.search(args.query);
        logger.info('Search executed', { query: args.query, results: searchResults?.length || 0 });

        // Add tool result to conversation
        const searchContext = searchResults && searchResults.length > 0
          ? formatSearchResultsForContext(searchResults)
          : 'No search results found.';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: searchContext,
        } as ChatMessage);
      } else if (toolCall.function.name === 'youtube_search') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('YouTube search executing', { query: args.query, limit: args.limit });

        const results = await youtube.searchYouTube(args.query, args.limit || 3);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: youtube.formatYouTubeForPrompt(results),
        } as ChatMessage);
      } else if (toolCall.function.name === 'local_media_search') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Local media search executing', { query: args.query });

        const items = await localMedia.searchLocalMedia(args.query, args.limit || 5);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: localMedia.formatForPrompt(items, args.query),
        } as ChatMessage);
      } else if (toolCall.function.name === 'local_media_play') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Local media play executing', { fileId: args.fileId, fileName: args.fileName });

        const streamUrl = localMedia.getStreamUrl(args.fileId);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Started streaming "${args.fileName}" at ${streamUrl}. Playback will start in the media player.`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'media_download') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Media download executing', { videoId: args.videoId, title: args.title, format: args.format });

        try {
          const job = args.format === 'audio'
            ? await ytdlp.downloadAudio(args.videoId, args.title)
            : await ytdlp.downloadVideo(args.videoId, args.title);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Download started (ID: ${job.id}). "${args.title}" is being downloaded as ${args.format}. It will appear in the local media library once complete.`,
          } as ChatMessage);
        } catch (dlError) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Download failed: ${(dlError as Error).message}`,
          } as ChatMessage);
        }
      } else if (isArtifactTool(toolCall.function.name)) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        try {
          const result = await handleArtifactToolCall(toolCall.function.name, args, userId, sessionId, false);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.toolResponse,
          } as ChatMessage);
        } catch (error) {
          logger.error(`Error in artifact tool ${toolCall.function.name}:`, error);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_visual_search') {
        const args = JSON.parse(toolCall.function.arguments);
        const searchEngine = args.searchEngine || 'google_news';
        const searchUrl = browserScreencast.getSearchUrl(args.query, searchEngine);
        logger.info('Browser visual search', { query: args.query, searchEngine, searchUrl });

        // Store pending URL for frontend to consume when browser window opens
        browserScreencast.setPendingVisualBrowse(userId, searchUrl);

        // Also do a text search to get content for the LLM to summarize
        const searchResults = await searxng.search(args.query);
        const searchContext = searchResults && searchResults.length > 0
          ? formatSearchResultsForContext(searchResults)
          : 'No search results found.';

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Browser opened to ${searchUrl} for visual browsing.\n\nSearch results for context:\n${searchContext}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'delegate_to_agent') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Delegating to agent', { agent: args.agent, task: args.task?.substring(0, 100) });

        const result = await agents.executeAgentTask(userId, {
          agentName: args.agent,
          task: args.task,
          context: args.context,
        });

        agentResults.push({ agent: args.agent, result: result.result, success: result.success });
        logger.info('Agent completed', { agent: args.agent, success: result.success, timeMs: result.executionTimeMs });

        // Add tool result to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: formatAgentResultForContext(args.agent, result.result, result.success),
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_write') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Workspace write tool called', { userId, filename: args.filename, contentLength: args.content?.length });
        try {
          // Decode HTML entities - LLMs sometimes encode HTML when generating tool calls
          const decodedContent = decodeHtmlEntities(args.content);
          const file = await workspace.writeFile(userId, args.filename, decodedContent);
          logger.info('Workspace file written successfully', { userId, filename: args.filename, size: file.size });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `File "${args.filename}" saved successfully (${file.size} bytes)`,
          } as ChatMessage);
        } catch (error) {
          logger.error('Workspace write failed', { userId, filename: args.filename, error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error saving file: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'workspace_execute') {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await sandbox.executeWorkspaceFile(userId, args.filename, sessionId, args.args || []);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.success
            ? `Execution output:\n${result.output}`
            : `Execution error:\n${result.error}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_list') {
        const files = await workspace.listFiles(userId);
        const fileList = files.length > 0
          ? files.map(f => `- ${f.name} (${f.size} bytes, ${f.mimeType})`).join('\n')
          : 'No files in workspace';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Workspace files:\n${fileList}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_read') {
        const args = JSON.parse(toolCall.function.arguments);
        try {
          const content = await workspace.readFile(userId, args.filename);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Contents of ${args.filename}:\n\`\`\`\n${content}\n\`\`\``,
          } as ChatMessage);
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error reading file: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'send_email') {
        const args = JSON.parse(toolCall.function.arguments);

        logger.info('Luna sending email', { to: args.to, subject: args.subject });
        const result = await emailService.sendLunaEmail(
          [args.to],
          args.subject,
          args.body
        );
        if (result.success) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Email sent successfully to ${args.to}. Message ID: ${result.messageId}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to send email: ${result.error}${result.blockedRecipients ? ` (blocked: ${result.blockedRecipients.join(', ')})` : ''}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'check_email') {
        const args = JSON.parse(toolCall.function.arguments);
        const unreadOnly = args.unreadOnly !== false;

        logger.info('Luna checking email (gated)', { unreadOnly });
        const { emails, quarantinedCount } = unreadOnly
          ? await emailService.getLunaUnreadEmailsGated()
          : await emailService.checkLunaInboxGated(10);
        if (emails.length > 0 || quarantinedCount > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Found ${emails.length} email(s):\n${emailService.formatGatedInboxForPrompt(emails, quarantinedCount)}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'No emails found in inbox.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'read_email') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna reading email by UID (gated)', { uid: args.uid });
        try {
          const email = await emailService.fetchEmailByUidGated(args.uid);
          if (email) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: emailService.formatGatedEmailForPrompt(email),
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Email with UID ${args.uid} was quarantined for security review or not found.`,
            } as ChatMessage);
          }
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to read email: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'delete_email') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna deleting email', { uid: args.uid });
        try {
          const success = await emailService.deleteEmail(args.uid);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: success
              ? `Email with UID ${args.uid} has been deleted successfully.`
              : `Failed to delete email with UID ${args.uid}.`,
          } as ChatMessage);
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to delete email: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'reply_email') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna replying to email', { uid: args.uid });
        try {
          const result = await emailService.replyToEmail(args.uid, args.body);
          if (result.success) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Reply sent successfully. Message ID: ${result.messageId}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to send reply: ${result.error}${result.blockedRecipients ? ` (blocked: ${result.blockedRecipients.join(', ')})` : ''}`,
            } as ChatMessage);
          }
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to send reply: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'mark_email_read') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna marking email read status', { uid: args.uid, isRead: args.isRead });
        try {
          const success = await emailService.markEmailRead(args.uid, args.isRead);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: success
              ? `Email with UID ${args.uid} has been marked as ${args.isRead ? 'read' : 'unread'}.`
              : `Failed to update read status for email with UID ${args.uid}.`,
          } as ChatMessage);
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to mark email: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'send_telegram') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna sending Telegram message', { userId });

        const connection = await telegramService.getTelegramConnection(userId);

        if (!connection || !connection.isActive) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Telegram is not connected for this user. Ask them to link their Telegram account in Settings.',
          } as ChatMessage);
        } else {
          try {
            await telegramService.sendTelegramMessage(connection.chatId, args.message, {
              parseMode: 'Markdown',
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Message sent successfully to Telegram.',
            } as ChatMessage);
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to send Telegram message: ${(error as Error).message}`,
            } as ChatMessage);
          }
        }
      } else if (toolCall.function.name === 'send_file_to_telegram') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna sending file to Telegram', { userId, filename: args.filename });

        const connection = await telegramService.getTelegramConnection(userId);

        if (!connection || !connection.isActive) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Telegram is not connected for this user.',
          } as ChatMessage);
        } else {
          try {
            const exists = await workspace.fileExists(userId, args.filename);
            if (!exists) {
               messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `File "${args.filename}" not found in workspace.`,
              } as ChatMessage);
            }
             else {
              const filePath = `${workspace.getUserWorkspacePath(userId)}/${args.filename}`;
              const success = await telegramService.sendTelegramDocument(
                connection.chatId,
                filePath,
                args.caption
              );
              
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: success 
                  ? 'File sent successfully to Telegram.' 
                  : 'Failed to send file to Telegram.',
              } as ChatMessage);
            }
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to send file: ${(error as Error).message}`,
            } as ChatMessage);
          }
        }
      } else if (toolCall.function.name === 'search_documents') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna searching documents', { query: args.query });
        const chunks = await documents.searchDocuments(userId, args.query);
        if (chunks.length > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Found ${chunks.length} relevant document section(s):\n${documents.formatDocumentsForPrompt(chunks)}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'No matching content found in uploaded documents.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'suggest_goal') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna suggesting goal', { title: args.title, goalType: args.goalType });

        // Store the pending goal suggestion
        await questionsService.storePendingGoalSuggestion(userId, {
          title: args.title,
          description: args.description,
          goalType: args.goalType,
        });

        // Create a question for the user to confirm
        await questionsService.askQuestion(userId, sessionId, {
          question: `Would you like me to create a goal: "${args.title}"?${args.description ? ` (${args.description})` : ''}`,
          context: `Goal type: ${args.goalType}`,
          priority: 5,
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Goal suggestion "${args.title}" created. The user will see a notification to confirm or decline.`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'fetch_url') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna fetching URL', { url: args.url });
        try {
          const page = await webfetch.fetchPage(args.url);
          const formattedContent = webfetch.formatPageForContext(page, 6000);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Successfully fetched URL:\n${formattedContent}`,
          } as ChatMessage);
        } catch (error) {
          logger.error('URL fetch failed', { url: args.url, error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to fetch URL: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'list_todos') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna listing todos', { includeCompleted: args.includeCompleted });
        const todos = await tasksService.getTasks(userId, {
          status: args.includeCompleted ? undefined : 'pending',
          limit: 20,
        });
        const todoList = todos.length > 0
          ? todos.map(t => {
              let entry = `- [${t.id.slice(0, 8)}] ${t.title} (${t.status}, ${t.priority})`;
              if (t.dueAt) entry += ` - due: ${new Date(t.dueAt).toLocaleDateString()}`;
              if (t.description) entry += `\n  Notes: ${t.description}`;
              return entry;
            }).join('\n')
          : 'No todos found.';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Found ${todos.length} todo(s):\n${todoList}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'create_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna creating todo', { title: args.title, dueDate: args.dueDate, remindMinutesBefore: args.remindMinutesBefore });
        const parsed = tasksService.parseTaskFromText(args.dueDate || '');
        // Calculate remindAt from dueAt and remindMinutesBefore
        let remindAt: Date | undefined;
        if (parsed.dueAt && args.remindMinutesBefore) {
          remindAt = new Date(parsed.dueAt.getTime() - args.remindMinutesBefore * 60 * 1000);
        }
        const todo = await tasksService.createTask(userId, {
          title: args.title,
          description: args.notes,
          priority: args.priority || 'medium',
          dueAt: parsed.dueAt,
          remindAt: remindAt,
          sourceSessionId: sessionId,
        });
        const dueStr = todo.dueAt ? ` - due: ${new Date(todo.dueAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}` : '';
        const remindStr = remindAt ? ` (reminder ${args.remindMinutesBefore} min before)` : '';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Created todo: "${todo.title}" [${todo.id.slice(0, 8)}]${dueStr}${remindStr}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'complete_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna completing todo', { todoId: args.todoId, title: args.title });
        let todoId = args.todoId;

        // Support partial UUID matching (we show 8-char IDs in list_todos)
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
          if (todo) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Marked todo "${todo.title}" as completed.`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Todo not found.',
            } as ChatMessage);
          }
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Could not find a matching todo. Use list_todos to see available todos.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'update_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna updating todo', { todoId: args.todoId, title: args.title });
        let todoId = args.todoId;

        // Support partial UUID matching
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
          if (todo) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Updated todo "${todo.title}".${args.notes ? ` Notes: ${args.notes}` : ''}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Todo not found.',
            } as ChatMessage);
          }
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Could not find a matching todo. Use list_todos to see available todos.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'create_calendar_event') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna creating calendar event', { title: args.title, startTime: args.startTime });
        try {
          // Get user's timezone for proper time conversion
          let userTimezone = 'UTC';
          try {
            const userResult = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
            if (userResult.rows.length > 0) {
              const settings = userResult.rows[0].settings as { timezone?: string };
              userTimezone = settings.timezone || 'UTC';
            }
          } catch (error) {
            logger.warn('Failed to fetch user timezone for calendar event, using UTC', { error: (error as Error).message });
          }

          const parsed = tasksService.parseTaskFromText(args.startTime || '');
          let startAt = parsed.dueAt || new Date();

          // Convert from user's local time to UTC
          if (userTimezone !== 'UTC') {
            startAt = convertLocalTimeToUTC(startAt, userTimezone);
          }

          let endAt: Date;
          if (args.endTime) {
            const endParsed = tasksService.parseTaskFromText(args.endTime);
            endAt = endParsed.dueAt || new Date(startAt.getTime() + 60 * 60 * 1000);
            if (userTimezone !== 'UTC') {
              endAt = convertLocalTimeToUTC(endAt, userTimezone);
            }
          } else {
            endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // 1 hour default
          }
          const event = await calendarService.createEvent(userId, {
            title: args.title,
            description: args.description,
            startAt,
            endAt,
            location: args.location,
            isAllDay: args.isAllDay || false,
            reminderMinutes: args.reminderMinutes ?? 15, // Default to 15 minutes if not specified
          });
          const dateStr = new Date(event.startAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
          const reminderStr = event.reminderMinutes ? ` (reminder ${event.reminderMinutes} min before)` : '';
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Created calendar event: "${event.title}" on ${dateStr}${event.location ? ` @ ${event.location}` : ''}${reminderStr}`,
          } as ChatMessage);
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to create calendar event: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'list_calendar_events') {
        const args = JSON.parse(toolCall.function.arguments);
        const days = args.days || 7;
        const events = await calendarService.getUpcomingEvents(userId, { days, limit: 10 });
        const eventList = events.length > 0
          ? events.map(e => {
              const d = new Date(e.startAt);
              const dateStr = d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
              return `- ${e.title} (${dateStr})${e.location ? ` @ ${e.location}` : ''}`;
            }).join('\n')
          : 'No upcoming events.';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Calendar events (next ${days} days):\n${eventList}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'session_note') {
        // Session note tool - appends notes to session log for future reference
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna adding session note', { sessionId, note: args.note });
        await sessionLogService.appendToSummary(sessionId, args.note);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: 'Note saved. It will appear in future session greetings.',
        } as ChatMessage);
      } else if (toolCall.function.name === 'create_reminder') {
        // Quick reminder tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna creating reminder', { sessionId, userId, message: args.message, delayMinutes: args.delay_minutes });
        try {
          const reminder = await reminderService.createReminder(userId, args.message, args.delay_minutes);
          const remindAt = reminder.remindAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Reminder set! I'll notify you via Telegram at ${remindAt} about: "${args.message}"`,
          } as ChatMessage);
        } catch (error) {
          logger.error('Failed to create reminder', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to create reminder: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'list_reminders') {
        // List reminders tool
        logger.info('Luna listing reminders', { sessionId, userId });
        try {
          const reminders = await reminderService.listReminders(userId);
          if (reminders.length === 0) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'No pending reminders.',
            } as ChatMessage);
          } else {
            const list = reminders.map(r => {
              const time = r.remindAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
              return `- [${r.id.slice(0, 8)}] at ${time}: "${r.message}"`;
            }).join('\n');
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Pending reminders:\n${list}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Failed to list reminders', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to list reminders: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'cancel_reminder') {
        // Cancel reminder tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna cancelling reminder', { sessionId, userId, reminderId: args.reminder_id });
        try {
          const cancelled = await reminderService.cancelReminder(userId, args.reminder_id);
          if (cancelled) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Reminder cancelled.',
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Reminder not found or already delivered.',
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Failed to cancel reminder', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to cancel reminder: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (
        toolCall.function.name === 'browser_navigate' ||
        toolCall.function.name === 'browser_click' ||
        toolCall.function.name === 'browser_type' ||
        toolCall.function.name === 'browser_get_page_content'
      ) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        logger.info('Shared browser tool', {
          userId,
          tool: toolCall.function.name,
          url: args.url,
          selector: args.selector,
        });

        try {
          const result = await executeSharedBrowserToolCall(userId, toolCall.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.toolResponse,
          } as ChatMessage);
        } catch (error) {
          logger.error('Shared browser tool failed', {
            userId,
            tool: toolCall.function.name,
            error: (error as Error).message,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_screenshot') {
        // Browser screenshot tool - takes screenshot and saves to disk for display
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Browser screenshot', { userId, url: args.url, fullPage: args.fullPage });
        try {
          const result = await browser.screenshot(userId, args.url, {
            fullPage: args.fullPage,
            selector: args.selector,
          });

          // If screenshot was captured, save it to disk and format for display
          if (result.success && result.screenshot) {
            const saveResult = await imageGeneration.saveScreenshot(
              userId,
              result.screenshot,
              result.pageUrl || args.url
            );

            if (saveResult.success && saveResult.imageUrl) {
              const caption = `Screenshot of ${result.pageTitle || result.pageUrl || args.url}`;
              const imageBlock = imageGeneration.formatImageForChat(saveResult.imageUrl, caption);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Screenshot captured successfully.\n\n${imageBlock}\n\nPage: ${result.pageUrl || args.url}\nTitle: ${result.pageTitle || 'N/A'}`,
              } as ChatMessage);
            } else {
              // Save failed - don't claim we have a displayable image
              logger.warn('Screenshot save failed', { userId, url: args.url, error: saveResult.error });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Screenshot was captured but could not be saved for display.\nPage visited: ${result.pageUrl || args.url}\nTitle: ${result.pageTitle || 'N/A'}`,
              } as ChatMessage);
            }
          } else {
            // Screenshot capture failed
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Screenshot failed: ${result.error || 'Unknown error'}\nPage: ${result.pageUrl || args.url}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Browser screenshot failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_fill') {
        // Browser fill tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Browser fill', { userId, url: args.url, selector: args.selector });
        try {
          const result = await browser.fill(userId, args.url, args.selector, args.value);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser fill failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_extract') {
        // Browser extract tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Browser extract', { userId, url: args.url, selector: args.selector });
        try {
          const result = args.selector
            ? await browser.extractElements(userId, args.url, args.selector, args.limit)
            : await browser.getContent(userId, args.url);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser extract failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_wait') {
        // Browser wait tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Browser wait', { userId, url: args.url, selector: args.selector });
        try {
          const result = await browser.waitFor(userId, args.url, args.selector, args.timeout);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser wait failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_render_html') {
        // Browser render HTML tool - renders HTML content and takes screenshot
        const args = JSON.parse(toolCall.function.arguments);
        // Decode HTML entities in case LLM encoded them
        const htmlContent = decodeHtmlEntities(args.html);
        const pageTitle = args.title || 'Luna HTML Page';
        logger.info('Browser render HTML', { userId, htmlLength: htmlContent.length, title: pageTitle });
        try {
          const result = await browser.renderHtml(userId, htmlContent);

          // If screenshot was captured, save it to disk and format for display
          if (result.success && result.screenshot) {
            const saveResult = await imageGeneration.saveScreenshot(
              userId,
              result.screenshot,
              'rendered-html'
            );

            if (saveResult.success && saveResult.imageUrl) {
              const caption = pageTitle;
              const imageBlock = imageGeneration.formatImageForChat(saveResult.imageUrl, caption);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `HTML page rendered successfully.\n\n${imageBlock}\n\nTitle: ${pageTitle}`,
              } as ChatMessage);
            } else {
              // Save failed
              logger.warn('HTML render save failed', { userId, error: saveResult.error });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `HTML was rendered but the screenshot could not be saved for display.`,
              } as ChatMessage);
            }
          } else {
            // Render failed
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `HTML render failed: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Browser render HTML failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'generate_image') {
        // Image generation tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Generate image', { userId, promptLength: args.prompt?.length });
        try {
          const result = await imageGeneration.generateImage(userId, args.prompt);
          if (result.success && result.imageUrl) {
            
            // Send to Telegram if connected
            const connection = await telegramService.getTelegramConnection(userId);
            if (connection && connection.isActive && result.filePath) {
              telegramService.sendTelegramPhoto(
                connection.chatId,
                result.filePath,
                `Generated image: ${args.prompt.substring(0, 100)}`
              ).catch(err => logger.error('Failed to send generated image to Telegram', { error: (err as Error).message }));
            }

            const imageBlock = imageGeneration.formatImageForChat(
              result.imageUrl,
              `Generated image: ${args.prompt.substring(0, 100)}${args.prompt.length > 100 ? '...' : ''}`
            );
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Image generated successfully.\n\n${imageBlock}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to generate image: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Image generation failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Image generation error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'generate_desktop_background') {
        // Desktop background generation tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Generate desktop background', { userId, promptLength: args.prompt?.length, style: args.style });
        try {
          const result = await backgroundService.generateBackground(
            userId,
            args.prompt,
            args.style || 'custom'
          );
          if (result.success && result.background) {
            // Optionally set as active (default true)
            const setActive = args.setActive !== false;
            if (setActive) {
              await backgroundService.setActiveBackground(userId, result.background.id);
            }
            const imageBlock = imageGeneration.formatImageForChat(
              result.background.imageUrl,
              `Desktop background: ${result.background.name}`
            );
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Desktop background generated successfully!${setActive ? ' It is now set as your active background.' : ' You can set it as active in Settings > Background.'}\n\n${imageBlock}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to generate background: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Background generation failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Background generation error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'research') {
        // Research agent tool - uses Claude CLI for in-depth research
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Research tool called', { userId, query: args.query?.substring(0, 100), depth: args.depth });
        try {
          const result = await researchAgent.executeResearch(args.query, userId, {
            depth: args.depth || 'thorough',
            saveToFile: args.save_to_file,
          });
          if (result.success) {
            let content = `**Research Summary:**\n${result.summary}\n\n**Details:**\n${result.details}`;
            if (result.savedFile) {
              content += `\n\n**Saved to:** ${result.savedFile}`;
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Research failed: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Research tool failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Research error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'load_context') {
        // Context loading tool - fetch session/intent context on demand
        const args = JSON.parse(toolCall.function.arguments || '{}');
        logger.info('Load context tool called', { userId, params: args });
        try {
          const result = await loadContextHandler.handleLoadContext(userId, args);
          const formatted = loadContextHandler.formatLoadContextResult(result);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: formatted,
          } as ChatMessage);
        } catch (error) {
          logger.error('Load context tool failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error loading context: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'correct_summary') {
        // Context correction tool - fix incorrect summaries
        const args = JSON.parse(toolCall.function.arguments || '{}');
        logger.info('Correct summary tool called', { userId, params: args });
        try {
          const result = await loadContextHandler.handleCorrectSummary(userId, args);
          const formatted = loadContextHandler.formatCorrectSummaryResult(result);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: formatted,
          } as ChatMessage);
        } catch (error) {
          logger.error('Correct summary tool failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error correcting summary: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name.startsWith('system_') ||
                 toolCall.function.name.startsWith('network_') ||
                 toolCall.function.name.startsWith('process_') ||
                 toolCall.function.name.startsWith('docker_') ||
                 toolCall.function.name.startsWith('service_') ||
                 toolCall.function.name.startsWith('logs_') ||
                 toolCall.function.name.startsWith('maintenance_')) {
        // System monitoring tools
        const args = JSON.parse(toolCall.function.arguments || '{}');
        logger.info('Sysmon tool called', { tool: toolCall.function.name, args });
        try {
          const result = await executeSysmonTool(toolCall.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result, null, 2),
          } as ChatMessage);
        } catch (error) {
          logger.error('Sysmon tool failed', { tool: toolCall.function.name, error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name.startsWith('mcp_')) {
        // MCP (Model Context Protocol) tools
        const parsed = mcpService.parseMcpToolName(toolCall.function.name);
        if (parsed) {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          logger.info('MCP tool called', { tool: toolCall.function.name, serverId: parsed.serverId, toolName: parsed.toolName, args });

          // Find the full server ID from loaded tools
          const mcpTool = mcpUserTools.find(t => t.serverId.startsWith(parsed.serverId) && t.name === parsed.toolName);
          if (mcpTool) {
            const result = await mcpService.executeTool(userId, mcpTool.serverId, parsed.toolName, args);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result.content,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'MCP tool not found or no longer available',
            } as ChatMessage);
          }
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Invalid MCP tool name format',
          } as ChatMessage);
        }
      }
    }

    // Monitor tool results for suspicious content before sending to LLM
    const hasSuspiciousContent = monitorToolResults(messages);
    if (hasSuspiciousContent) {
      logger.warn('Suspicious content detected in tool results before second completion', {
        sessionId,
        userId,
        messageCount: messages.length,
      });
    }

    // Get final response with tool results in context
    logger.info('Making second completion with tool results', { messageCount: messages.length });
    completion = await createChatCompletion({
      messages,
      provider: modelConfig.provider,
      model: modelConfig.model,
      loggingContext: {
        userId,
        sessionId,
        source: 'chat',
        nodeName: 'chat_tool_followup',
      },
    });
    logger.info('Second completion result', {
      contentLength: completion.content?.length || 0,
      contentPreview: completion.content?.substring(0, 100),
      finishReason: completion.finishReason,
    });
  }

  // Save assistant response
  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: completion.content,
    tokensUsed: completion.tokensUsed,
    inputTokens: completion.promptTokens,
    outputTokens: completion.completionTokens,
    cacheTokens: 0, // OpenAI-compatible providers don't have cache tokens
    model: modelConfig.model,
    provider: modelConfig.provider,
    searchResults,
  });

  // Store assistant message embedding (async)
  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, completion.content, 'assistant');

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, completion.content).then(({ enrichment }) => {
    memorycoreClient.recordChatInteraction(sessionId, 'response', completion.content, {
      model: modelConfig.model,
      provider: modelConfig.provider,
      tokensUsed: completion.tokensUsed,
    }, enrichment);
  }).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Process facts from conversation (async, every few messages)
  const totalMessages = rawHistory.length + 2; // +2 for this exchange
  if (totalMessages % 4 === 0) { // Every 4 messages
    const allMessages = [
      ...rawHistory.map(m => ({ id: m.id, role: m.role, content: m.content })),
      { id: userMessage.id, role: 'user', content: message },
      { id: assistantMessage.id, role: 'assistant', content: completion.content },
    ];
    memoryService.processConversationMemory(userId, sessionId, allMessages).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
    // Also learn preferences from conversation
    preferencesService.learnFromConversation(userId, sessionId, allMessages).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Trigger background summarization if threshold met (non-blocking)
  const messagesSinceSummary = await contextCompression.getMessageCountSinceSummary(sessionId);
  if (messagesSinceSummary >= backgroundSummarization.BACKGROUND_SUMMARY_THRESHOLD) {
    backgroundSummarization.triggerBackgroundSummarization(sessionId, userId);
  }

  // Update session title if this is the first message AND not a special session
  if (rawHistory.length === 0) {
    const session = await sessionService.getSession(sessionId, userId);
    // Don't overwrite special session titles like "Telegram"
    if (session && session.title === 'New Chat') {
      const title = await sessionService.generateSessionTitle([
        { role: 'user', content: message } as Message,
      ]);
      await sessionService.updateSession(sessionId, userId, { title });
    }
  }

  // Process message for intent updates (async, non-blocking)
  intentDetection.processMessageForIntents(
    userId,
    sessionId,
    message,
    completion.content,
    intentContext
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  return {
    messageId: assistantMessage.id,
    content: completion.content,
    tokensUsed: completion.tokensUsed,
    searchResults,
  };
}

// ==================== PROJECT HANDLING FUNCTIONS ====================

/**
 * Handle steering messages for an active project
 */
async function* handleProjectSteering(
  userId: string,
  sessionId: string,
  project: projectService.Project,
  message: string,
  startTime: number
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action'; content?: string; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics; action?: string; url?: string }> {
  const lowerMessage = message.toLowerCase();

  // Handle pause/stop commands
  if (/\b(stop|pause|wait|hold on)\b/i.test(lowerMessage)) {
    await projectService.updateProjectStatus(project.id, 'paused');
    const responseContent = `Got it! I've paused the project "${project.name}". Just say "continue" or "go ahead" when you're ready to resume.`;

    yield { type: 'content', content: responseContent };

    const assistantMessage = await sessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: responseContent,
    });

    yield {
      type: 'done',
      messageId: assistantMessage.id,
      tokensUsed: 0,
      metrics: {
        promptTokens: 0,
        completionTokens: 0,
        processingTimeMs: Date.now() - startTime,
        tokensPerSecond: 0,
        toolsUsed: ['project-steering'],
        model: 'internal',
      },
    };
    return;
  }

  // Handle continue/resume commands
  if (/\b(continue|go ahead|proceed|resume)\b/i.test(lowerMessage)) {
    await projectService.updateProjectStatus(project.id, 'building');
    yield { type: 'status', status: `Resuming project ${project.name}...` };

    // Continue building from current step
    yield* executeProjectBuild(userId, sessionId, project, startTime);
    return;
  }

  // Handle modification requests - pass to generator agent
  yield { type: 'status', status: 'Processing your modification request...' };

  // Use the project-generator agent to handle the modification
  const modificationPrompt = `
The user wants to modify the project "${project.name}".

Current project state:
- Status: ${project.status}
- Current step: ${project.currentStep}
- Plan: ${JSON.stringify(project.plan, null, 2)}

User's modification request: "${message}"

Generate the updated files based on this request. Use the format:
\`\`\`language:filename.ext
file content here
\`\`\`
`;

  let responseContent = '';
  for await (const event of agents.executeAgentStream('project-generator', userId, modificationPrompt)) {
    if (event.type === 'status') {
      yield { type: 'status', status: event.status };
    } else if (event.type === 'content') {
      responseContent += event.content;
      yield { type: 'content', content: event.content };
    }
  }

  // Parse and save any generated files
  const fileMatches = responseContent.matchAll(/```(\w+):([^\n]+)\n([\s\S]*?)```/g);
  const executableFiles: string[] = [];
  const executableExtensions = ['.py', '.js', '.sh'];

  for (const match of fileMatches) {
    const [, , filename, content] = match;
    const trimmedFilename = filename.trim();
    try {
      await projectService.writeProjectFile(
        project.id,
        userId,
        project.name,
        trimmedFilename,
        content.trim(),
        trimmedFilename.split('.').pop() || 'txt'
      );
      logger.info('Wrote modified project file', { projectId: project.id, filename: trimmedFilename });

      // Track executable files for potential execution
      if (executableExtensions.some(ext => trimmedFilename.endsWith(ext))) {
        executableFiles.push(trimmedFilename);
      }
    } catch (err) {
      logger.error('Failed to write modified project file', { error: (err as Error).message, filename: trimmedFilename });
    }
  }

  // AUTO-EXECUTE: If user asked to "run" or "execute" and we have executable files, run them
  const wantsExecution = /\b(run|execute|test|try)\b/i.test(lowerMessage);
  if (wantsExecution && executableFiles.length > 0) {
    yield { type: 'status', status: 'Running script...' };

    for (const filename of executableFiles) {
      try {
        // Read the file content from project and execute via sandbox
        const fileContent = await projectService.readProjectFile(project.id, userId, filename);
        if (fileContent) {
          const execResult = await sandbox.executeCode(fileContent, userId, sessionId);
          const executionOutput = `\n\n**Execution Output (${filename}):**\n\`\`\`\n${execResult.output || execResult.error || 'No output'}\n\`\`\``;
          responseContent += executionOutput;
          yield { type: 'content', content: executionOutput };
          logger.info('Executed project file', { projectId: project.id, filename, success: !execResult.error });
        }
      } catch (err) {
        const errorOutput = `\n\n**Execution Error (${filename}):** ${(err as Error).message}`;
        responseContent += errorOutput;
        yield { type: 'content', content: errorOutput };
        logger.error('Failed to execute project file', { error: (err as Error).message, filename });
      }
    }
  }

  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: responseContent,
  });

  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, responseContent, 'assistant');

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, responseContent).then(({ enrichment }) =>
    memorycoreClient.recordChatInteraction(sessionId, 'response', responseContent, undefined, enrichment)
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  yield {
    type: 'done',
    messageId: assistantMessage.id,
    tokensUsed: 0,
    metrics: {
      promptTokens: 0,
      completionTokens: 0,
      processingTimeMs: Date.now() - startTime,
      tokensPerSecond: 0,
      toolsUsed: ['project-steering', 'project-generator'],
      model: 'claude-cli',
    },
  };
}

/**
 * Handle user responses to project questions
 */
async function* handleProjectQuestionResponse(
  userId: string,
  sessionId: string,
  project: projectService.Project,
  message: string,
  startTime: number
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action'; content?: string; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics; action?: string; url?: string }> {
  // Save the answers
  await projectService.saveProjectAnswers(project.id, { userResponse: message });

  yield { type: 'status', status: 'Creating project plan...' };

  // Use project-planner agent to create the plan based on answers
  const planPrompt = `
The user answered your questions for the project. Now create a detailed step-by-step plan.

Project: ${project.name}
Description: ${project.description}
Type: ${project.type}

Questions that were asked:
${JSON.stringify(project.questions, null, 2)}

User's answers: "${message}"

Now create a detailed implementation plan. Output ONLY valid JSON in this format:
{
  "phase": "planning",
  "projectName": "${project.name}",
  "steps": [
    { "stepNumber": 1, "description": "...", "type": "generate_file", "filename": "...", "requiresApproval": false },
    ...
  ]
}

Step types: generate_file, generate_image, execute, preview
`;

  let planResponse = '';
  for await (const event of agents.executeAgentStream('project-planner', userId, planPrompt)) {
    if (event.type === 'status') {
      yield { type: 'status', status: event.status };
    } else if (event.type === 'content') {
      planResponse += event.content;
    }
  }

  // Parse the plan
  let plan: { steps: Array<{ stepNumber: number; description: string; type: string; filename?: string; requiresApproval: boolean }> } | null = null;
  try {
    // Extract JSON from response
    const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      plan = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    logger.error('Failed to parse project plan', { error: (err as Error).message, response: planResponse.substring(0, 500) });
  }

  if (!plan || !plan.steps) {
    const errorResponse = `I had trouble creating a plan for your project. Let me try a simpler approach.\n\nBased on your answers, I'll create a basic ${project.type} project. Would you like me to proceed with a standard structure?`;
    yield { type: 'content', content: errorResponse };

    const assistantMessage = await sessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: errorResponse,
    });

    yield {
      type: 'done',
      messageId: assistantMessage.id,
      tokensUsed: 0,
      metrics: {
        promptTokens: 0,
        completionTokens: 0,
        processingTimeMs: Date.now() - startTime,
        tokensPerSecond: 0,
        toolsUsed: ['project-planner'],
        model: 'claude-cli',
      },
    };
    return;
  }

  // Save the plan to the project
  const stepIdMap = new Map<number, string>();
  for (const step of plan.steps) {
    const stepResult = await dbQuery<any>(
      `INSERT INTO execution_steps
        (project_id, step_number, goal, action, artifact, status, requires_approval)
       VALUES ($1, $2, $3, $4, $5, 'ready', $6)
       RETURNING id`,
      [
        project.id,
        step.stepNumber,
        step.description,
        step.type === 'execute' ? 'run' : 'build',
        step.filename || null,
        step.requiresApproval,
      ]
    );
    stepIdMap.set(step.stepNumber, stepResult[0].id);
  }

  // Create linear dependencies for simplicity
  for (let i = 1; i < plan.steps.length; i++) {
    const stepId = stepIdMap.get(plan.steps[i].stepNumber);
    const prevStepId = stepIdMap.get(plan.steps[i-1].stepNumber);
    if (stepId && prevStepId) {
      await dbQuery(
        `INSERT INTO step_dependencies (step_id, depends_on_step_id)
         VALUES ($1, $2)`,
        [stepId, prevStepId]
      );
      // Mark step as blocked if it has dependencies
      await dbQuery(
        `UPDATE execution_steps SET status = 'blocked' WHERE id = $1`,
        [stepId]
      );
    }
  }

  // Update project status
  await dbQuery(
    `UPDATE execution_projects SET status = 'ready', total_steps = $1 WHERE id = $2`,
    [plan.steps.length, project.id]
  );

  // Show the plan to the user
  let planDisplay = `Great! Here's my plan for **${project.name}**:\n\n`;
  for (const step of plan.steps) {
    const icon = step.type === 'generate_image' ? '🎨' : step.type === 'generate_file' ? '📄' : step.type === 'execute' ? '▶️' : step.type === 'preview' ? '👁️' : '☐';
    planDisplay += `${icon} **Step ${step.stepNumber}:** ${step.description}\n`;
  }
  planDisplay += `\nReady to start building? Open the **Projects** app to execute the plan and watch progress!`;

  yield { type: 'content', content: planDisplay };

  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: planDisplay,
  });

  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, planDisplay, 'assistant');

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, planDisplay).then(({ enrichment }) =>
    memorycoreClient.recordChatInteraction(sessionId, 'response', planDisplay, undefined, enrichment)
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  yield {
    type: 'done',
    messageId: assistantMessage.id,
    tokensUsed: 0,
    metrics: {
      promptTokens: 0,
      completionTokens: 0,
      processingTimeMs: Date.now() - startTime,
      tokensPerSecond: 0,
      toolsUsed: ['project-planner'],
      model: 'claude-cli',
    },
  };
}

/**
 * Execute project build steps
 */
async function* executeProjectBuild(
  userId: string,
  sessionId: string,
  project: projectService.Project,
  startTime: number
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action'; content?: string; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics; action?: string; url?: string }> {
  // Refresh project to get latest state
  const currentProject = await projectService.getProject(project.id);
  if (!currentProject) {
    yield { type: 'content', content: 'Error: Project not found.' };
    return;
  }

  const steps = await projectService.getProjectSteps(project.id);
  if (!steps || steps.length === 0) {
    yield { type: 'content', content: 'No steps defined in the project plan. Please start over.' };
    return;
  }

  let responseContent = `Starting to build **${currentProject.name}**...\n\n`;
  yield { type: 'content', content: responseContent };

  // Process each pending step
  for (const step of steps) {
    if (step.status === 'completed') continue;

    // Check if project was paused
    const updatedProject = await projectService.getProject(project.id);
    if (updatedProject?.status === 'paused') {
      responseContent += `\n⏸️ Project paused at step ${step.stepNumber}. Say "continue" when ready.`;
      yield { type: 'content', content: `\n⏸️ Project paused at step ${step.stepNumber}. Say "continue" when ready.` };
      break;
    }

    yield { type: 'status', status: `Step ${step.stepNumber}: ${step.description}` };
    await projectService.updateStepStatus(project.id, step.stepNumber, 'active');

    try {
      if (step.stepType === 'generate_file') {
        // Generate file content using project-generator agent
        const generatePrompt = `
Generate the file "${step.filename || 'file'}" for project "${currentProject.name}".
Project type: ${currentProject.type}
Project description: ${currentProject.description}
Step description: ${step.description}

User preferences from answers: ${JSON.stringify(currentProject.answers)}

Generate ONLY the file content in this format:
\`\`\`${step.filename?.split('.').pop() || 'txt'}:${step.filename || 'file.txt'}
content here
\`\`\`
`;

        let fileContent = '';
        for await (const event of agents.executeAgentStream('project-generator', userId, generatePrompt)) {
          if (event.type === 'content') {
            fileContent += event.content;
          }
        }

        // Extract and save file
        const fileMatch = fileContent.match(/```\w+:([^\n]+)\n([\s\S]*?)```/);
        if (fileMatch) {
          const [, filename, content] = fileMatch;
          await projectService.writeProjectFile(
            project.id,
            userId,
            currentProject.name,
            filename.trim(),
            content.trim(),
            filename.split('.').pop() || 'txt'
          );
          responseContent += `✅ Created ${filename}\n`;
          yield { type: 'content', content: `✅ Created ${filename}\n` };
        }

        await projectService.updateStepStatus(project.id, step.stepNumber, 'completed', 'File generated successfully');

      } else if (step.stepType === 'generate_image') {
        // Generate image using image generation service
        const imagePrompt = step.description.replace(/^generate\s+(image|picture)\s+(for|of)\s+/i, '');
        const result = await imageGeneration.generateProjectImage(
          userId,
          projectService.getProjectDirectory(userId, currentProject.name),
          imagePrompt,
          step.filename
        );

        if (result.success) {
          responseContent += `🎨 Generated image: ${step.filename || 'image.png'}\n`;
          yield { type: 'content', content: `🎨 Generated image: ${step.filename || 'image.png'}\n` };
          await projectService.updateStepStatus(project.id, step.stepNumber, 'completed', result.imageUrl);
        } else {
          responseContent += `⚠️ Image generation failed: ${result.error}\n`;
          yield { type: 'content', content: `⚠️ Image generation failed: ${result.error}\n` };
          await projectService.updateStepStatus(project.id, step.stepNumber, 'completed', undefined, result.error);
        }

      } else if (step.stepType === 'preview') {
        // Generate preview using browser service
        // TODO: Integrate with browser.service.ts to capture screenshot of projectDir/index.html
        const projectDir = projectService.getProjectDirectory(userId, currentProject.name);

        // For now, just note that preview is available
        responseContent += `👁️ Preview ready at ${projectDir} - open the project files to view\n`;
        yield { type: 'content', content: `👁️ Preview ready - open the project files to view\n` };
        await projectService.updateStepStatus(project.id, step.stepNumber, 'completed', 'Preview available');
      }

    } catch (err) {
      const errorMsg = (err as Error).message;
      logger.error('Step execution failed', { projectId: project.id, stepNumber: step.stepNumber, error: errorMsg });
      responseContent += `❌ Step ${step.stepNumber} failed: ${errorMsg}\n`;
      yield { type: 'content', content: `❌ Step ${step.stepNumber} failed: ${errorMsg}\n` };
      await projectService.updateStepStatus(project.id, step.stepNumber, 'pending', undefined, errorMsg);
      break; // Stop on error
    }
  }

  // Check if all steps completed
  const finalSteps = await projectService.getProjectSteps(project.id);
  const allComplete = finalSteps.every(s => s.status === 'completed');

  if (allComplete) {
    await projectService.updateProjectStatus(project.id, 'complete');
    responseContent += `\n🎉 Project "${currentProject.name}" is complete! You can find the files in your workspace.`;
    yield { type: 'content', content: `\n🎉 Project "${currentProject.name}" is complete! You can find the files in your workspace.` };
  }

  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: responseContent,
  });

  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, responseContent, 'assistant');

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, responseContent).then(({ enrichment }) =>
    memorycoreClient.recordChatInteraction(sessionId, 'response', responseContent, undefined, enrichment)
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  yield {
    type: 'done',
    messageId: assistantMessage.id,
    tokensUsed: 0,
    metrics: {
      promptTokens: 0,
      completionTokens: 0,
      processingTimeMs: Date.now() - startTime,
      tokensPerSecond: 0,
      toolsUsed: ['project-build'],
      model: 'claude-cli',
    },
  };
}

/**
 * Handle new project creation request
 */
async function* handleProjectCreation(
  userId: string,
  sessionId: string,
  message: string,
  startTime: number
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action'; content?: string; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics; action?: string; url?: string }> {
  // Use project-planner agent to analyze the request and generate questions
  const analysisPrompt = `
The user wants to create a project. Analyze their request and generate 3-5 clarifying questions.

User's request: "${message}"

Output ONLY valid JSON in this format:
{
  "phase": "questioning",
  "projectName": "suggested-project-name",
  "description": "brief description of what the user wants",
  "type": "web|fullstack|python|node",
  "questions": [
    { "id": 1, "question": "What visual style do you prefer?", "category": "style", "required": true },
    { "id": 2, "question": "Which sections do you need?", "category": "features", "required": true },
    ...
  ]
}

Questions should cover: visual style, specific features, content requirements, any special functionality.
`;

  let analysisResponse = '';
  for await (const event of agents.executeAgentStream('project-planner', userId, analysisPrompt)) {
    if (event.type === 'status') {
      yield { type: 'status', status: event.status };
    } else if (event.type === 'content') {
      analysisResponse += event.content;
    }
  }

  // Parse the analysis
  let analysis: {
    projectName: string;
    description: string;
    type: 'web' | 'fullstack' | 'python' | 'node';
    questions: Array<{ id: number; question: string; category: string; required: boolean }>;
  } | null = null;

  try {
    const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    logger.error('Failed to parse project analysis', { error: (err as Error).message });
  }

  if (!analysis || !analysis.questions || analysis.questions.length === 0) {
    // Fallback: ask generic questions
    analysis = {
      projectName: 'new-project',
      description: message,
      type: 'web',
      questions: [
        { id: 1, question: 'What visual style would you like? (e.g., modern, minimal, colorful, professional)', category: 'style', required: true },
        { id: 2, question: 'What main sections or features do you need?', category: 'features', required: true },
        { id: 3, question: 'Should I generate placeholder images or will you provide your own?', category: 'content', required: true },
      ],
    };
  }

  // Create the project in the database (new system)
  const projectResult = await dbQuery<any>(
    `INSERT INTO execution_projects (user_id, session_id, name, description, project_type, status)
     VALUES ($1, $2, $3, $4, $5, 'paused')
     RETURNING *`,
    [userId, sessionId, analysis.projectName, analysis.description, analysis.type]
  );
  const project = projectResult[0];

  // Save the questions (we still use the old questions table for now or handle in memory)
  // For now, let's keep it simple and just update the status
  await dbQuery(
    `UPDATE execution_projects SET status = 'paused' WHERE id = $1`,
    [project.id]
  );

  // Format questions for display
  let responseContent = `I'd love to help you create **${analysis.projectName}**! Before I start, let me ask a few questions:\n\n`;
  for (const q of analysis.questions) {
    responseContent += `${q.id}. ${q.question}\n`;
  }
  responseContent += `\nPlease answer these questions so I can create exactly what you're looking for.`;

  yield { type: 'content', content: responseContent };

  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: responseContent,
  });

  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, responseContent, 'assistant');

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, responseContent).then(({ enrichment }) =>
    memorycoreClient.recordChatInteraction(sessionId, 'response', responseContent, undefined, enrichment)
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  yield {
    type: 'done',
    messageId: assistantMessage.id,
    tokensUsed: 0,
    metrics: {
      promptTokens: 0,
      completionTokens: 0,
      processingTimeMs: Date.now() - startTime,
      tokensPerSecond: 0,
      toolsUsed: ['project-planner'],
      model: 'claude-cli',
    },
  };
}

// ==================== END PROJECT HANDLING ====================

export interface StreamMetrics {
  promptTokens: number;
  completionTokens: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  toolsUsed: string[];
  model: string;
  // Layered agent breakdown
  llmBreakdown?: Array<{
    node: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens?: number;
    cost: number;
    durationMs?: number;
  }>;
  totalCost?: number;
  // Router-First Architecture provenance
  routeInfo?: {
    route: 'nano' | 'pro' | 'pro+tools';
    confidence: 'estimate' | 'verified';
    class: 'chat' | 'transform' | 'factual' | 'actionable';
  };
}

export async function* streamMessage(
  input: ChatInput
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action' | 'background_refresh' | 'reasoning' | 'video_action' | 'media_action' | 'canvas_artifact'; content?: string | any; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics; action?: string; url?: string; videos?: any[]; query?: string; items?: any[]; source?: string; artifactId?: string }> {
  const { sessionId, userId, message, mode, source = 'web', projectMode, thinkingMode, novaMode, documentIds } = input;

  // Initialize MemoryCore session for consolidation tracking
  // This enables episodic memory recording and NeuralSleep LNN processing
  await memorycoreClient.ensureSession(sessionId, userId);

  // Compute enrichment (embedding, sentiment, attention, centroid) before recording
  const { enrichment: smEnrichment } = await computeEnrichment(sessionId, message).catch(() => ({
    enrichment: {} as InteractionEnrichment, embedding: [] as number[],
  }));

  // Record enriched user message to MemoryCore (async, non-blocking)
  memorycoreClient.recordChatInteraction(sessionId, 'message', message, { mode, source }, smEnrichment).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Track session activity for automatic consolidation after inactivity
  sessionActivityService.recordActivity(sessionId, userId).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Router-First Architecture: Route decision before any processing
  let routerDecision: RouterDecision | null = null;
  if (config.router?.enabled) {
    try {
      const routerConfig = {
        enabled: config.router.enabled,
        classifierModel: config.router.classifierModel,
        classifierProvider: config.router.classifierProvider as 'anthropic' | 'google' | 'groq' | 'openai',
        classifierTimeoutMs: config.router.classifierTimeoutMs,
        rulesTimeoutMs: config.router.rulesTimeoutMs,
        fallbackRoute: config.router.fallbackRoute as 'nano' | 'pro' | 'pro+tools',
      };

      routerDecision = await router.route(message, { userId, sessionId, mode }, routerConfig);

      logger.info('Router-First decision', {
        userId,
        sessionId,
        route: routerDecision.route,
        class: routerDecision.class,
        risk: routerDecision.risk_if_wrong,
        source: routerDecision.decision_source,
        timeMs: routerDecision.decision_time_ms,
      });
    } catch (error) {
      logger.error('Router failed, continuing with default path', { error: (error as Error).message });
    }
  }

  // THINKING MODE: Override router decision to force 'pro' tier minimum
  // NOVA MODE: Override router decision to force 'nano' tier (fast responses)
  // Note: Thinking and Nova modes are mutually exclusive (enforced in frontend)
  if (thinkingMode && !novaMode && routerDecision) {
    // If router chose 'nano', upgrade to 'pro'
    if (routerDecision.route === 'nano') {
      logger.info('Thinking mode enabled - upgrading route from nano to pro (streaming)', {
        userId,
        sessionId,
        originalRoute: routerDecision.route,
      });
      routerDecision = {
        ...routerDecision,
        route: 'pro',
      };
    }
    // If 'pro' or 'pro+tools', keep as-is (already sufficient for thinking mode)
  } else if (novaMode && !thinkingMode && routerDecision) {
    // Nova mode: force fast 'nano' route for quick, energetic responses
    logger.info('Nova mode enabled - forcing nano route for fast responses (streaming)', {
      userId,
      sessionId,
      originalRoute: routerDecision.route,
    });
    routerDecision = {
      ...routerDecision,
      route: 'nano',
    };
  }

  // Feature flag: Use layered agent architecture if enabled
  // EXCEPTIONS that fall through to legacy (faster) path:
  // - Browser intents (need tool execution)
  // - Simple companion messages (5 LLM calls is overkill for casual chat)
  const isSmallTalk = abilities.isSmallTalk(message);
  const isSimpleCompanion = mode === 'companion' && abilities.isSimpleCompanionMessage(message);
  const skipLayeredAgent = isSmallTalk || isSimpleCompanion;
  
  logger.info('Stream message processing started', { 
    sessionId, 
    mode, 
    isSmallTalk, 
    isSimpleCompanion, 
    agentEngine: config.agentEngine,
    routerRoute: routerDecision?.route 
  });

  if (config.agentEngine === 'layered_v1' && !abilities.isBrowserIntent(message) && !skipLayeredAgent) {
    const startTime = Date.now();
    logger.info('Using layered agent for stream');

    // Save user message first
    const userMessage = await sessionService.addMessage({
      sessionId,
      role: 'user',
      content: message,
      tokensUsed: 0,
      source,
    });

    // Store user message memory - pass enrichment for valence/attention storage
    memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
      enrichment: { emotionalValence: smEnrichment.emotionalValence, attentionScore: smEnrichment.attentionScore },
    });

    let assistantContent = '';

    for await (const chunk of layeredAgent.streamLayeredAgent({
      sessionId,
      userId,
      message,
      mode,
      source,
    })) {
      if (chunk.type === 'status') {
        yield { type: 'status', status: chunk.content };
      } else if (chunk.type === 'content') {
        assistantContent += chunk.content || '';
        yield { type: 'content', content: chunk.content };
      } else if (chunk.type === 'done') {
        // Save assistant message
        const assistantMessage = await sessionService.addMessage({
          sessionId,
          role: 'assistant',
          content: assistantContent,
          tokensUsed: chunk.tokensUsed || 0,
          inputTokens: chunk.metrics?.promptTokens || 0,
          outputTokens: chunk.metrics?.completionTokens || 0,
          model: chunk.metrics?.model || 'layered-agent',
          provider: 'layered-agent',
          source,
        });

        // Store assistant message memory
        memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, assistantContent, 'assistant');

        const processingTimeMs = Date.now() - startTime;
        const tokensPerSecond = processingTimeMs > 0 && chunk.metrics?.completionTokens
          ? (chunk.metrics.completionTokens / (processingTimeMs / 1000))
          : 0;

        logger.info('Yielding done with metrics', {
          mode,
          hasMetrics: !!chunk.metrics,
          promptTokens: chunk.metrics?.promptTokens,
          completionTokens: chunk.metrics?.completionTokens,
        });

        yield {
          type: 'done',
          messageId: assistantMessage.id,
          tokensUsed: chunk.tokensUsed,
          metrics: chunk.metrics ? {
            promptTokens: chunk.metrics.promptTokens,
            completionTokens: chunk.metrics.completionTokens,
            processingTimeMs,
            tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
            toolsUsed: chunk.metrics.toolsUsed || [],
            model: chunk.metrics.model,
            llmBreakdown: chunk.metrics.llmBreakdown,
            totalCost: chunk.metrics.totalCost,
          } : undefined,
        };
      }
    }
    return;
  }

  const startTime = Date.now();
  const toolsUsed: string[] = [];

  // INTENT GATING: Use router decision (from above) or fall back to isSmallTalk detection
  // Router's nano route is equivalent to smalltalk (no tools, fast model)
  const isSmallTalkMessage = routerDecision
    ? routerDecision.route === 'nano'
    : abilities.isSmallTalk(message);
  const contextOptions = abilities.getContextOptions(message);

  if (!isSmallTalkMessage) {
    yield { type: 'status', status: 'Loading context...' };
  }

  // PROJECT HANDLING: Check if user has an active project and route accordingly
  // Project mode is opt-in - only activate when explicitly enabled
  const isProjectMode = projectMode === true;
  const activeProject = isProjectMode ? await projectService.getActiveProject(userId) : null;
  if (activeProject && !isSmallTalkMessage) {
    // Check if this is a steering message for the active project
    if (projectService.isSteeringMessage(message)) {
      logger.info('Detected steering message for active project', {
        projectId: activeProject.id,
        projectName: activeProject.name,
        message: message.substring(0, 100),
      });

      // Save user message
      const userMessage = await sessionService.addMessage({
        sessionId,
        role: 'user',
        content: message,
        source,
      });
      memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
        enrichment: { emotionalValence: smEnrichment.emotionalValence, attentionScore: smEnrichment.attentionScore },
      });

      // Handle steering based on project status
      yield { type: 'status', status: `Processing steering for ${activeProject.name}...` };

      // Route steering to appropriate handler
      yield* handleProjectSteering(userId, sessionId, activeProject, message, startTime);
      return;
    }

    // Check if project is waiting for input (questions answered)
    if (activeProject.status === 'questioning') {
      logger.info('Project is waiting for question answers', {
        projectId: activeProject.id,
        questionsCount: activeProject.questions?.length || 0,
      });

      // Save user message
      const userMessage = await sessionService.addMessage({
        sessionId,
        role: 'user',
        content: message,
        source,
      });
      memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
        enrichment: { emotionalValence: smEnrichment.emotionalValence, attentionScore: smEnrichment.attentionScore },
      });

      // Handle as answer to project questions
      yield { type: 'status', status: 'Processing your answers...' };
      yield* handleProjectQuestionResponse(userId, sessionId, activeProject, message, startTime);
      return;
    }
  }

  // PROJECT CREATION: Check if user wants to start a new project (only when project mode is enabled)
  if (isProjectMode && !isSmallTalkMessage && projectService.isProjectCreationIntent(message)) {
    logger.info('Detected project creation intent', { message: message.substring(0, 100) });

    // Save user message
    const userMessage = await sessionService.addMessage({
      sessionId,
      role: 'user',
      content: message,
      source,
    });
    memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
      enrichment: { emotionalValence: smEnrichment.emotionalValence, attentionScore: smEnrichment.attentionScore },
    });

    // Start project creation flow
    yield { type: 'status', status: 'Planning your project...' };
    yield* handleProjectCreation(userId, sessionId, message, startTime);
    return;
  }

  // Check if this task needs multi-agent orchestration (never for smalltalk)
  if (!isSmallTalkMessage && agents.needsOrchestration(message)) {
    logger.info('Detected orchestration-worthy task', { message: message.substring(0, 100) });

    // Save user message first
    const userMessage = await sessionService.addMessage({
      sessionId,
      role: 'user',
      content: message,
      source,
    });

    // Store user message embedding (async) - pass enrichment for valence/attention storage
    memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
      enrichment: { emotionalValence: smEnrichment.emotionalValence, attentionScore: smEnrichment.attentionScore },
    });

    // Check if message relates to a pending todo - if so, include full todo context
    // This prevents context loss when Luna decides to work on a todo
    let orchestrationContext: string | undefined;
    let relatedTodoId: string | undefined;
    let relatedTodoTitle: string | undefined;
    try {
      const pendingTodos = await tasksService.getTasks(userId, { status: 'pending', limit: 20 });
      const lowerMessage = message.toLowerCase();

      // Find todos that match the message (title or description overlap)
      const relatedTodo = pendingTodos.find(todo => {
        const titleWords = todo.title.toLowerCase().split(/\s+/);
        const descWords = (todo.description || '').toLowerCase().split(/\s+/);
        // Check if significant words from message appear in todo
        const messageWords = lowerMessage.split(/\s+/).filter(w => w.length > 3);
        const matchCount = messageWords.filter(w =>
          titleWords.some(tw => tw.includes(w) || w.includes(tw)) ||
          descWords.some(dw => dw.includes(w) || w.includes(dw))
        ).length;
        return matchCount >= 2; // At least 2 significant word matches
      });

      if (relatedTodo) {
        orchestrationContext = `This task is from a todo item:\n\nTitle: ${relatedTodo.title}\nDescription: ${relatedTodo.description || 'No description'}\nPriority: ${relatedTodo.priority}`;
        relatedTodoId = relatedTodo.id;
        relatedTodoTitle = relatedTodo.title;
        logger.info('Found related todo for orchestration', {
          todoId: relatedTodo.id,
          todoTitle: relatedTodo.title
        });
      }
    } catch (err) {
      logger.warn('Failed to check for related todos', { error: (err as Error).message });
    }

    // Execute orchestration with streaming status updates
    let orchestrationResult: agents.OrchestrationResult | null = null;

    for await (const event of agents.orchestrateTaskStream(userId, message, orchestrationContext)) {
      if (event.type === 'status') {
        yield { type: 'status', status: event.status };
      } else if (event.type === 'done') {
        orchestrationResult = event.result;
      }
    }

    if (!orchestrationResult) {
      orchestrationResult = { plan: '', results: [], synthesis: 'Orchestration failed unexpectedly', success: false };
    }

    // Build the response content
    let responseContent: string;
    if (orchestrationResult.success) {
      responseContent = orchestrationResult.synthesis;

      // If this was related to a todo, add notes and offer to mark complete
      if (relatedTodoId) {
        try {
          // Create a summary of what was done (first 500 chars of synthesis)
          const summaryNote = `[Orchestration completed ${new Date().toISOString().split('T')[0]}]\n${orchestrationResult.synthesis.substring(0, 500)}${orchestrationResult.synthesis.length > 500 ? '...' : ''}`;

          await tasksService.updateTask(userId, relatedTodoId, {
            description: summaryNote,
          });

          // Add a note to the response about the todo
          responseContent += `\n\n---\n**Todo Updated:** I've added notes to "${relatedTodoTitle}". Would you like me to mark it as complete, or is there more work to do on this task?`;

          logger.info('Updated related todo with orchestration results', {
            todoId: relatedTodoId,
            todoTitle: relatedTodoTitle
          });
        } catch (err) {
          logger.warn('Failed to update related todo', { error: (err as Error).message, todoId: relatedTodoId });
        }
      }
    } else {
      responseContent = `I encountered an issue while processing your request:\n\n${orchestrationResult.error || 'Unknown error'}\n\n`;
      if (orchestrationResult.results.length > 0) {
        responseContent += `**Partial Results:**\n`;
        for (const result of orchestrationResult.results) {
          responseContent += `\n### ${result.agentName}\n${result.result}\n`;
        }
      }
    }

    // Stream the response character by character for smooth display
    yield { type: 'status', status: 'Presenting results...' };
    const chunkSize = 20; // Characters per chunk for smoother streaming
    for (let i = 0; i < responseContent.length; i += chunkSize) {
      yield { type: 'content', content: responseContent.slice(i, i + chunkSize) };
    }

    // Save assistant response
    const assistantMessage = await sessionService.addMessage({
      sessionId,
      role: 'assistant',
      content: responseContent,
      tokensUsed: 0, // Orchestration doesn't track tokens the same way
      model: 'claude-cli',
    });

    // Store assistant message embedding (async)
    memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, responseContent, 'assistant');

    // Record enriched response to MemoryCore for consolidation (async, non-blocking)
    computeEnrichment(sessionId, responseContent).then(({ enrichment }) =>
      memorycoreClient.recordChatInteraction(sessionId, 'response', responseContent, undefined, enrichment)
    ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

    // Update session title if first message
    const history = await sessionService.getSessionMessages(sessionId, { limit: 1 });
    if (history.length <= 1) {
      const title = await sessionService.generateSessionTitle([
        { role: 'user', content: message } as Message,
      ]);
      await sessionService.updateSession(sessionId, userId, { title });
    }

    const processingTimeMs = Date.now() - startTime;
    yield {
      type: 'done',
      messageId: assistantMessage.id,
      tokensUsed: 0,
      metrics: {
        promptTokens: 0,
        completionTokens: 0,
        processingTimeMs,
        tokensPerSecond: 0,
        toolsUsed: ['orchestration'],
        model: 'claude-cli',
      },
    };
    return;
  }

  // OPTIMIZED: Run context loading in parallel, but skip heavy loads for smalltalk
  const [
    modelConfig,
    user,
    rawHistory,
    memoryContext,
    abilityContext,
    prefGuidelines,
    intentContext,
  ] = await Promise.all([
    // Get user's model configuration - use fast model for smalltalk
    getUserModelConfig(userId, isSmallTalkMessage ? 'smalltalk' : 'main_chat'),
    // Get user profile for personalization
    authService.getUserById(userId),
    // Get conversation history (higher limit for compression to work with)
    sessionService.getSessionMessages(sessionId, { limit: 50 }),
    // Build memory context - skip volatile parts for smalltalk, but load stable facts in companion mode
    isSmallTalkMessage
      ? (mode === 'companion' ? memoryService.buildStableMemoryOnly(userId) : Promise.resolve({ stable: { facts: '', learnings: '' }, volatile: { relevantHistory: '', conversationContext: '' } }))
      : memoryService.buildMemoryContext(userId, message, sessionId),
    // Build ability context - uses contextOptions for selective loading
    abilities.buildAbilityContext(userId, message, sessionId, contextOptions),
    // Get personalization preferences - lightweight, always load
    preferencesService.getResponseGuidelines(userId),
    // Get intent context - lightweight, always load (uses Redis cache)
    isSmallTalkMessage
      ? Promise.resolve({ activeIntents: [], suspendedIntents: [], recentlyResolved: [] })
      : intentContextService.getIntentContext(userId),
  ]);

  logger.info('Stream context loaded', { 
    provider: modelConfig.provider, 
    model: modelConfig.model,
    historyCount: rawHistory.length,
    isSmallTalkMessage
  });

  // Check if forced sync summarization is needed (context approaching limit)
  const modelInfo = (await import('../llm/types.js')).getModel(modelConfig.provider, modelConfig.model);
  const contextWindow = modelInfo?.contextWindow || 128000; // Default to 128k if unknown
  let historyForContext = rawHistory;

  if (await contextCompression.shouldForceSummarization(sessionId, rawHistory, contextWindow)) {
    logger.info('Forcing sync summarization before context build', { sessionId, messageCount: rawHistory.length });
    await contextCompression.updateRollingSummary(sessionId, userId);
    // Re-fetch history after summarization (now compressed)
    historyForContext = await sessionService.getSessionMessages(sessionId, { limit: 50 });
  }

  // Build compressed context from history
  // Use less aggressive compression for Telegram to preserve conversation flow
  const compressionConfig = source === 'telegram' ? {
    verbatimMessageCount: 12,        // Keep last 12 messages (6 exchanges) for Telegram
    semanticRetrievalCount: 8,       // Retrieve more relevant older messages
    summarizationThreshold: 15,      // Start summarizing later for Telegram
  } : undefined;

  const compressedCtx = await contextCompression.buildCompressedContext(
    sessionId,
    userId,
    message,
    historyForContext,
    compressionConfig
  );

  if (!isSmallTalkMessage) {
    yield { type: 'status', status: 'Recalling memories...' };
  }

  const userName = user?.displayName || undefined;
  const memoryPrompt = memoryService.formatMemoryForPrompt(memoryContext);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);
  const prefPrompt = preferencesService.formatGuidelinesForPrompt(prefGuidelines);
  const intentPrompt = intentContextService.formatIntentsForPrompt(intentContext);

  // Detect and learn from feedback signals
  const feedbackSignal = preferencesService.detectFeedbackSignals(message);
  if (feedbackSignal.type && feedbackSignal.confidence >= 0.6) {
    preferencesService.learnFromFeedback(userId, sessionId, feedbackSignal.type, message).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Detect ability intent and execute if confident
  const intent = abilities.detectAbilityIntent(message);
  let abilityActionResult: string | undefined;
  if (intent.confidence >= 0.8) {
    yield { type: 'status', status: `Executing ${intent.type} action...` };
    // Skip automatic task/knowledge creation in companion mode - Luna has tools to handle these
    const skipToolableIntents = mode === 'companion';
    const result = await abilities.executeAbilityAction(userId, sessionId, intent, message, { skipToolableIntents });
    if (result.handled && result.result) {
      abilityActionResult = `[Action Taken: ${intent.type}]\n${result.result}`;
    }
  }

  yield { type: 'status', status: '' };

  // Load MCP tools dynamically for this user (before building system prompt)
  const mcpUserTools = await mcpService.getAllUserTools(userId);

  // Session log: On first message, get recent sessions for context and create new log
  let sessionHistoryContext = '';
  if (rawHistory.length === 0) {
    // Get recent session logs for context continuity
    const recentLogs = await sessionLogService.getRecentSessionLogs(userId, 3);
    sessionHistoryContext = sessionLogService.formatLogsForContext(recentLogs);

    // Create new session log entry (async, don't block)
    sessionLogService.createSessionLog(userId, sessionId, mode).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Fetch canvas style rules for artifact generation
  let canvasStylePrompt = '';
  let canvasSessionPrompt = '';
  try {
    const canvasService = await import('../canvas/canvas.service.js');
    const styleRules = await canvasService.getStyleRules(userId, 5);
    canvasStylePrompt = canvasService.formatStyleRules(styleRules);
    const latestArtifactId = await canvasService.getLatestArtifactIdForSession(userId, sessionId);
    if (latestArtifactId) {
      canvasSessionPrompt = `ACTIVE CANVAS ARTIFACT ID: ${latestArtifactId}\nWhen editing an existing artifact, always use this exact UUID as artifactId for rewrite_artifact/update_highlighted unless the user explicitly gives a different UUID.`;
    }
    const promotedRules = await canvasService.consumePatternNotification(userId);
    if (promotedRules && promotedRules.length > 0) {
      canvasSessionPrompt += `\n[Style Update] Your editing patterns have been recognized and promoted to style rules:\n${promotedRules.map(r => `- ${r}`).join('\n')}`;
    }
  } catch (error) {
    // Silently fail if canvas service unavailable
  }

  // Combine all context
  const fullContext = [memoryPrompt, abilityPrompt, prefPrompt, intentPrompt, abilityActionResult, canvasStylePrompt, canvasSessionPrompt].filter(Boolean).join('\n\n');

  // Build messages array with MCP tool info and compressed context
  const mcpToolsForPrompt = mcpUserTools.map(t => ({
    name: t.name,
    serverName: t.serverName,
    description: t.description,
  }));
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildContextualPrompt(mode, {
        userName,
        memoryContext: fullContext,
        sessionHistory: sessionHistoryContext,
        conversationSummary: compressedCtx.systemPrefix,
        mcpTools: mcpToolsForPrompt,
        source,
        novaMode,
      }),
    },
  ];

  // Add semantically relevant older messages first (marked as earlier context)
  for (const relevant of compressedCtx.relevantMessages) {
    messages.push({
      role: relevant.role as 'user' | 'assistant',
      content: `[Earlier context] ${contextCompression.compressMessage({ content: relevant.content, role: relevant.role } as Message)}`,
    });
  }

  // Add recent messages (truncated for efficiency)
  for (const msg of compressedCtx.recentMessages) {
    messages.push({
      role: msg.role,
      content: contextCompression.compressMessage(msg),
    });
  }

  // Inject small attached documents inline; large ones are tool-accessible via search_documents
  const smDocContextBlock = documentIds && documentIds.length > 0
    ? await documents.getDocumentContextBlock(documentIds, userId)
    : '';
  const smEffectiveMessage = smDocContextBlock
    ? `${smDocContextBlock}\n\n${message}`
    : message;

  // Add current message (full, not compressed)
  messages.push({ role: 'user', content: smEffectiveMessage });

  // Save user message with optional attachments (raw message, no doc prefix)
  const userMessage = await sessionService.addMessage({
    sessionId,
    role: 'user',
    content: message,
    source,
  }, documentIds);

  // Store user message embedding (async) - pass enrichment for valence/attention storage
  memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user', {
    enrichment: { emotionalValence: smEnrichment.emotionalValence, attentionScore: smEnrichment.attentionScore },
  });

  // TOOL GATING: Router-First Architecture + Mode-based filtering
  // - nano route: No tools (fast, cheap responses)
  // - pro route: Optional tools (reasoning depth)
  // - pro+tools route: All tools available (verified answers)
  // - Companion mode: Conversational + Workspace tools (no sysmon/MCP)
  // - Assistant mode: Full sysadmin capabilities
  const mcpToolsForLLM = mcpService.formatMcpToolsForLLM(mcpUserTools.map(t => ({ ...t, serverId: t.serverId })));

  // Companion tools - conversational (includes workspace tools)
  const companionTools = [
    searchTool, youtubeSearchTool, localMediaSearchTool, localMediaPlayTool, mediaDownloadTool,
    browserVisualSearchTool, fetchUrlTool,
    sendEmailTool, checkEmailTool, readEmailTool, deleteEmailTool, replyEmailTool, markEmailReadTool,
    sendTelegramTool, sendFileToTelegramTool, searchDocumentsTool, suggestGoalTool,
    listTodosTool, createTodoTool, completeTodoTool, updateTodoTool,
    createCalendarEventTool, listCalendarEventsTool,
    sessionNoteTool, createReminderTool, listRemindersTool, cancelReminderTool,
    browserNavigateTool, browserScreenshotTool, browserClickTool, browserFillTool,
    browserExtractTool, browserWaitTool, browserCloseTool, browserRenderHtmlTool,
    generateImageTool, generateBackgroundTool, researchTool, delegateToAgentTool,
    loadContextTool, correctSummaryTool,
    workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool,
    generateArtifactTool, rewriteArtifactTool, updateHighlightedTool, saveArtifactFileTool,
    listArtifactsTool, loadArtifactTool, getArtifactDownloadLinkTool
  ];

  // Assistant tools - full sysadmin capabilities (sysmon, MCP)
  const assistantTools = [
    ...companionTools,
    ...sysmonTools,
    ...mcpToolsForLLM
  ];

  // Select tools based on mode
  const modeTools = mode === 'companion' ? companionTools : assistantTools;
  const availableTools = isSmallTalkMessage ? [] : modeTools;
  let searchResults: SearchResult[] | undefined;

  logger.info('Tool availability', {
    isSmallTalk: isSmallTalkMessage,
    toolsProvided: availableTools.length,
    routerRoute: routerDecision?.route || 'legacy',
    provider: modelConfig.provider,
    model: modelConfig.model
  });

  const initialCompletion = await createChatCompletion({
    messages,
    tools: availableTools.length > 0 ? availableTools : undefined,
    provider: modelConfig.provider,
    model: modelConfig.model,
    loggingContext: {
      userId,
      sessionId,
      source: 'chat',
      nodeName: 'chat_streaming_initial',
    },
  });

  if (initialCompletion.reasoning) {
    yield { type: 'reasoning', content: initialCompletion.reasoning };
  }

  logger.info('Initial completion result', {
    hasToolCalls: !!(initialCompletion.toolCalls && initialCompletion.toolCalls.length > 0),
    toolCallsCount: initialCompletion.toolCalls?.length || 0,
    finishReason: initialCompletion.finishReason,
  });

  // Handle tool calls using proper tool calling flow
  if (initialCompletion.toolCalls && initialCompletion.toolCalls.length > 0) {
    // Log what tools were called and track them
    const toolNames = initialCompletion.toolCalls.map(tc => tc.function.name);
    toolsUsed.push(...toolNames);
    logger.info('Tool calls received from LLM (stream)', { toolNames, count: toolNames.length });

    // Add assistant message with tool calls to conversation
    messages.push({
      role: 'assistant',
      content: initialCompletion.content || '',
      tool_calls: initialCompletion.toolCalls,
    } as ChatMessage);

    for (const toolCall of initialCompletion.toolCalls) {
      if (toolCall.function.name === 'web_search') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Searching: "${args.query}"\n` };
        searchResults = await searxng.search(args.query);
        logger.info('Search executed in stream', { query: args.query, results: searchResults?.length || 0 });

        // Add tool result to conversation
        const searchContext = searchResults && searchResults.length > 0
          ? formatSearchResultsForContext(searchResults)
          : 'No search results found.';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: searchContext,
        } as ChatMessage);
      } else if (toolCall.function.name === 'youtube_search') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Searching YouTube: "${args.query}"\n` };
        logger.info('YouTube search executing (stream)', { query: args.query, limit: args.limit });

        const results = await youtube.searchYouTube(args.query, args.limit || 3);

        if (results.videos.length > 0) {
          yield { type: 'video_action', videos: results.videos, query: results.query };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: youtube.formatYouTubeForPrompt(results),
        } as ChatMessage);
      } else if (toolCall.function.name === 'local_media_search') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Searching local media: "${args.query}"\n` };
        logger.info('Local media search executing (stream)', { query: args.query });

        const items = await localMedia.searchLocalMedia(args.query, args.limit || 5);

        if (items.length > 0) {
          yield { type: 'media_action', action: 'search', items, query: args.query, source: 'local' };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: localMedia.formatForPrompt(items, args.query),
        } as ChatMessage);
      } else if (toolCall.function.name === 'local_media_play') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Starting stream for: ${args.fileName}\n` };
        logger.info('Local media play executing (stream)', { fileId: args.fileId, fileName: args.fileName });

        const streamUrl = localMedia.getStreamUrl(args.fileId);

        // Signal frontend to play
        yield { 
          type: 'media_action', 
          action: 'play', 
          items: [{
            id: args.fileId,
            name: args.fileName,
            type: 'video', 
            streamUrl
          }], 
          query: args.fileName, 
          source: 'local' 
        };

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Started streaming "${args.fileName}". Playback will start in the media player.`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'media_download') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Downloading ${args.format}: "${args.title}"\n` };
        logger.info('Media download executing (stream)', { videoId: args.videoId, title: args.title, format: args.format });

        try {
          const job = args.format === 'audio'
            ? await ytdlp.downloadAudio(args.videoId, args.title)
            : await ytdlp.downloadVideo(args.videoId, args.title);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Download started (ID: ${job.id}). "${args.title}" is being downloaded as ${args.format}. It will appear in the local media library once complete.`,
          } as ChatMessage);
        } catch (dlError) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Download failed: ${(dlError as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_visual_search') {
        const args = JSON.parse(toolCall.function.arguments);
        const searchEngine = args.searchEngine || 'google_news';
        const searchUrl = browserScreencast.getSearchUrl(args.query, searchEngine);
        logger.info('Browser visual search (stream)', { query: args.query, searchEngine, searchUrl });

        yield { type: 'reasoning', content: `> Opening visual browser: "${args.query}"\n` };

        // Signal frontend to open browser window
        yield { type: 'browser_action', action: 'open', url: searchUrl };

        // Store pending URL for frontend to consume when browser window opens
        browserScreencast.setPendingVisualBrowse(userId, searchUrl);

        // Also do a text search to get content for the LLM to summarize
        yield { type: 'reasoning', content: '> Fetching search results for context...\n' };
        const searchResults = await searxng.search(args.query);
        const searchContext = searchResults && searchResults.length > 0
          ? formatSearchResultsForContext(searchResults)
          : 'No search results found.';

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Browser opened to ${searchUrl} for visual browsing.\n\nSearch results for context:\n${searchContext}`,
        } as ChatMessage);
      } else if (isArtifactTool(toolCall.function.name)) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        try {
          const result = await handleArtifactToolCall(toolCall.function.name, args, userId, sessionId, true);
          for (const chunk of result.chunks) {
            yield chunk;
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.toolResponse,
          } as ChatMessage);
        } catch (error) {
          logger.error(`Error in artifact tool ${toolCall.function.name} (stream):`, error);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'delegate_to_agent') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Invoking agent...\n` };
        logger.info('Delegating to agent in stream', { agent: args.agent, task: args.task?.substring(0, 100) });

        const result = await agents.executeAgentTask(userId, {
          agentName: args.agent,
          task: args.task,
          context: args.context,
        });

        yield { type: 'reasoning', content: `> Agent ${result.agentName} completed.\n` };
        logger.info('Agent completed in stream', { requestedAgent: args.agent, actualAgent: result.agentName, success: result.success, timeMs: result.executionTimeMs });

        // Add tool result to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: formatAgentResultForContext(result.agentName, result.result, result.success),
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_write') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Workspace write tool called (stream)', { userId, filename: args.filename, contentLength: args.content?.length });
        yield { type: 'reasoning', content: `> Saving file: ${args.filename}\n` };
        try {
          const file = await workspace.writeFile(userId, args.filename, args.content);
          logger.info('Workspace file written successfully (stream)', { userId, filename: args.filename, size: file.size });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `File "${args.filename}" saved successfully (${file.size} bytes)`,
          } as ChatMessage);
        } catch (error) {
          logger.error('Workspace write failed (stream)', { userId, filename: args.filename, error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error saving file: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'workspace_execute') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Executing script: ${args.filename}\n` };
        const result = await sandbox.executeWorkspaceFile(userId, args.filename, sessionId, args.args || []);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.success
            ? `Execution output:\n${result.output}`
            : `Execution error:\n${result.error}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_list') {
        yield { type: 'reasoning', content: '> Listing workspace files...\n' };
        const files = await workspace.listFiles(userId);
        const fileList = files.length > 0
          ? files.map(f => `- ${f.name} (${f.size} bytes, ${f.mimeType})`).join('\n')
          : 'No files in workspace';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Workspace files:\n${fileList}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_read') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Reading file: ${args.filename}\n` };
        try {
          const content = await workspace.readFile(userId, args.filename);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Contents of ${args.filename}:\n\`\`\`\n${content}\n\`\`\``,
          } as ChatMessage);
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error reading file: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'send_email') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Sending email to: ${args.to}\n` };
        logger.info('Luna sending email', { to: args.to, subject: args.subject });
        const result = await emailService.sendLunaEmail(
          [args.to],
          args.subject,
          args.body
        );
        if (result.success) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Email sent successfully to ${args.to}. Message ID: ${result.messageId}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to send email: ${result.error}${result.blockedRecipients ? ` (blocked: ${result.blockedRecipients.join(', ')})` : ''}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'check_email') {
        const args = JSON.parse(toolCall.function.arguments);
        const unreadOnly = args.unreadOnly !== false;
        yield { type: 'reasoning', content: '> Checking inbox...\n' };
        logger.info('Luna checking email (gated)', { unreadOnly });
        const { emails, quarantinedCount } = unreadOnly
          ? await emailService.getLunaUnreadEmailsGated()
          : await emailService.checkLunaInboxGated(10);
        if (emails.length > 0 || quarantinedCount > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Found ${emails.length} email(s):\n${emailService.formatGatedInboxForPrompt(emails, quarantinedCount)}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'No emails found in inbox.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'send_telegram') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Sending Telegram message...\n' };
        logger.info('Luna sending Telegram message', { userId });

        const connection = await telegramService.getTelegramConnection(userId);

        if (!connection || !connection.isActive) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Telegram is not connected for this user. Ask them to link their Telegram account in Settings.',
          } as ChatMessage);
        } else {
          try {
            await telegramService.sendTelegramMessage(connection.chatId, args.message, {
              parseMode: 'Markdown',
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Message sent successfully to Telegram.',
            } as ChatMessage);
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to send Telegram message: ${(error as Error).message}`,
            } as ChatMessage);
          }
        }
      } else if (toolCall.function.name === 'send_file_to_telegram') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Sending file to Telegram: ${args.filename}\n` };
        logger.info('Luna sending file to Telegram', { userId, filename: args.filename });

        const connection = await telegramService.getTelegramConnection(userId);

        if (!connection || !connection.isActive) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Telegram is not connected for this user.',
          } as ChatMessage);
        } else {
          try {
            const exists = await workspace.fileExists(userId, args.filename);
            if (!exists) {
               messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `File "${args.filename}" not found in workspace.`,
              } as ChatMessage);
            } else {
              const filePath = `${workspace.getUserWorkspacePath(userId)}/${args.filename}`;
              const success = await telegramService.sendTelegramDocument(
                connection.chatId,
                filePath,
                args.caption
              );
              
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: success 
                  ? 'File sent successfully to Telegram.' 
                  : 'Failed to send file to Telegram.',
              } as ChatMessage);
            }
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to send file: ${(error as Error).message}`,
            } as ChatMessage);
          }
        }
      } else if (toolCall.function.name === 'search_documents') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Searching documents for: "${args.query}"\n` };
        logger.info('Luna searching documents', { query: args.query });
        const chunks = await documents.searchDocuments(userId, args.query);
        if (chunks.length > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Found ${chunks.length} relevant document section(s):\n${documents.formatDocumentsForPrompt(chunks)}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'No matching content found in uploaded documents.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'suggest_goal') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna suggesting goal', { title: args.title, goalType: args.goalType });

        // Store the pending goal suggestion
        await questionsService.storePendingGoalSuggestion(userId, {
          title: args.title,
          description: args.description,
          goalType: args.goalType,
        });

        // Create a question for the user to confirm
        await questionsService.askQuestion(userId, sessionId, {
          question: `Would you like me to create a goal: "${args.title}"?${args.description ? ` (${args.description})` : ''}`,
          context: `Goal type: ${args.goalType}`,
          priority: 5,
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Goal suggestion "${args.title}" created. The user will see a notification to confirm or decline.`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'fetch_url') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna fetching URL', { url: args.url });
        try {
          const page = await webfetch.fetchPage(args.url);
          const formattedContent = webfetch.formatPageForContext(page, 6000);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Successfully fetched URL:\n${formattedContent}`,
          } as ChatMessage);
        } catch (error) {
          logger.error('URL fetch failed', { url: args.url, error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to fetch URL: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'list_todos') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Checking todo list...\n' };
        logger.info('Luna listing todos (stream)', { includeCompleted: args.includeCompleted });
        const todos = await tasksService.getTasks(userId, {
          status: args.includeCompleted ? undefined : 'pending',
          limit: 20,
        });
        const todoList = todos.length > 0
          ? todos.map(t => {
              let entry = `- [${t.id.slice(0, 8)}] ${t.title} (${t.status}, ${t.priority})`;
              if (t.dueAt) entry += ` - due: ${new Date(t.dueAt).toLocaleDateString()}`;
              if (t.description) entry += `\n  Notes: ${t.description}`;
              return entry;
            }).join('\n')
          : 'No todos found.';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Found ${todos.length} todo(s):\n${todoList}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'create_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: `> Creating todo: "${args.title}"\n` };
        logger.info('Luna creating todo (stream)', { title: args.title, dueDate: args.dueDate });
        const parsed = tasksService.parseTaskFromText(args.dueDate || '');
        // Calculate remindAt from dueAt and remindMinutesBefore
        let remindAt: Date | undefined;
        if (parsed.dueAt && args.remindMinutesBefore) {
          remindAt = new Date(parsed.dueAt.getTime() - args.remindMinutesBefore * 60 * 1000);
        }
        const todo = await tasksService.createTask(userId, {
          title: args.title,
          description: args.notes,
          priority: args.priority || 'medium',
          dueAt: parsed.dueAt,
          remindAt: remindAt,
          sourceSessionId: sessionId,
        });
        const dueStr = todo.dueAt ? ` - due: ${new Date(todo.dueAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}` : '';
        const remindStr = remindAt ? ` (reminder ${args.remindMinutesBefore} min before)` : '';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Created todo: "${todo.title}" [${todo.id.slice(0, 8)}]${dueStr}${remindStr}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'complete_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Completing todo...\n' };
        logger.info('Luna completing todo (stream)', { todoId: args.todoId, title: args.title });
        let todoId = args.todoId;

        // Support partial UUID matching (we show 8-char IDs in list_todos)
        const todos = await tasksService.getTasks(userId, { limit: 50 });
        if (todoId && todoId.length < 36) {
          // Partial ID - find matching todo
          const match = todos.find(t => t.id.startsWith(todoId));
          if (match) todoId = match.id;
        }
        if (!todoId && args.title) {
          const match = todos.find(t => t.title.toLowerCase().includes(args.title.toLowerCase()));
          if (match) todoId = match.id;
        }
        if (todoId) {
          const todo = await tasksService.updateTaskStatus(userId, todoId, 'completed');
          if (todo) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Marked todo "${todo.title}" as completed.`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Todo not found.',
            } as ChatMessage);
          }
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Could not find a matching todo. Use list_todos to see available todos.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'update_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Updating todo...\n' };
        logger.info('Luna updating todo (stream)', { todoId: args.todoId, title: args.title });
        let todoId = args.todoId;

        // Support partial UUID matching
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
          if (todo) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Updated todo "${todo.title}".${args.notes ? ` Notes: ${args.notes}` : ''}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Todo not found.',
            } as ChatMessage);
          }
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Could not find a matching todo. Use list_todos to see available todos.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'create_calendar_event') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna creating calendar event', { title: args.title, startTime: args.startTime });
        try {
          // Get user's timezone for proper time conversion
          let userTimezone = 'UTC';
          try {
            const userResult = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
            if (userResult.rows.length > 0) {
              const settings = userResult.rows[0].settings as { timezone?: string };
              userTimezone = settings.timezone || 'UTC';
            }
          } catch (error) {
            logger.warn('Failed to fetch user timezone for calendar event, using UTC', { error: (error as Error).message });
          }

          const parsed = tasksService.parseTaskFromText(args.startTime || '');
          let startAt = parsed.dueAt || new Date();

          // Convert from user's local time to UTC
          if (userTimezone !== 'UTC') {
            startAt = convertLocalTimeToUTC(startAt, userTimezone);
          }

          let endAt: Date;
          if (args.endTime) {
            const endParsed = tasksService.parseTaskFromText(args.endTime);
            endAt = endParsed.dueAt || new Date(startAt.getTime() + 60 * 60 * 1000);
            if (userTimezone !== 'UTC') {
              endAt = convertLocalTimeToUTC(endAt, userTimezone);
            }
          } else {
            endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // 1 hour default
          }
          const event = await calendarService.createEvent(userId, {
            title: args.title,
            description: args.description,
            startAt,
            endAt,
            location: args.location,
            isAllDay: args.isAllDay || false,
            reminderMinutes: args.reminderMinutes ?? 15, // Default to 15 minutes if not specified
          });
          const dateStr = new Date(event.startAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
          const reminderStr = event.reminderMinutes ? ` (reminder ${event.reminderMinutes} min before)` : '';
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Created calendar event: "${event.title}" on ${dateStr}${event.location ? ` @ ${event.location}` : ''}${reminderStr}`,
          } as ChatMessage);
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to create calendar event: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'list_calendar_events') {
        const args = JSON.parse(toolCall.function.arguments);
        const days = args.days || 7;
        const events = await calendarService.getUpcomingEvents(userId, { days, limit: 10 });
        const eventList = events.length > 0
          ? events.map(e => {
              const d = new Date(e.startAt);
              const dateStr = d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
              return `- ${e.title} (${dateStr})${e.location ? ` @ ${e.location}` : ''}`;
            }).join('\n')
          : 'No upcoming events.';
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Calendar events (next ${days} days):\n${eventList}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'session_note') {
        // Session note tool - appends notes to session log for future reference
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna adding session note', { sessionId, note: args.note });
        await sessionLogService.appendToSummary(sessionId, args.note);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: 'Note saved. It will appear in future session greetings.',
        } as ChatMessage);
      } else if (toolCall.function.name === 'create_reminder') {
        // Quick reminder tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna creating reminder', { sessionId, userId, message: args.message, delayMinutes: args.delay_minutes });
        try {
          const reminder = await reminderService.createReminder(userId, args.message, args.delay_minutes);
          const remindAt = reminder.remindAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Reminder set! I'll notify you via Telegram at ${remindAt} about: "${args.message}"`,
          } as ChatMessage);
        } catch (error) {
          logger.error('Failed to create reminder', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to create reminder: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'list_reminders') {
        // List reminders tool
        logger.info('Luna listing reminders', { sessionId, userId });
        try {
          const reminders = await reminderService.listReminders(userId);
          if (reminders.length === 0) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'No pending reminders.',
            } as ChatMessage);
          } else {
            const list = reminders.map(r => {
              const time = r.remindAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
              return `- [${r.id.slice(0, 8)}] at ${time}: "${r.message}"`;
            }).join('\n');
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Pending reminders:\n${list}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Failed to list reminders', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to list reminders: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'cancel_reminder') {
        // Cancel reminder tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Luna cancelling reminder', { sessionId, userId, reminderId: args.reminder_id });
        try {
          const cancelled = await reminderService.cancelReminder(userId, args.reminder_id);
          if (cancelled) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Reminder cancelled.',
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Reminder not found or already delivered.',
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Failed to cancel reminder', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Failed to cancel reminder: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (
        toolCall.function.name === 'browser_navigate' ||
        toolCall.function.name === 'browser_click' ||
        toolCall.function.name === 'browser_type' ||
        toolCall.function.name === 'browser_get_page_content'
      ) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const openUrl = typeof args.url === 'string' && args.url.length > 0
          ? args.url
          : getBrowserOpenUrl(userId);

        yield { type: 'reasoning', content: `> Browser: ${getBrowserToolStatusLine(toolCall.function.name, args)}\n` };
        yield { type: 'browser_action', action: 'open', url: openUrl };
        yield { type: 'browser_action', action: toolCall.function.name, url: openUrl };
        browserScreencast.setPendingVisualBrowse(userId, openUrl);

        logger.info('Shared browser tool (stream)', {
          userId,
          tool: toolCall.function.name,
          url: args.url,
          selector: args.selector,
        });

        try {
          const result = await executeSharedBrowserToolCall(userId, toolCall.function.name, args);
          if (result.openUrl && result.openUrl !== openUrl) {
            yield { type: 'browser_action', action: 'open', url: result.openUrl };
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.toolResponse,
          } as ChatMessage);
        } catch (error) {
          logger.error('Shared browser tool failed (stream)', {
            userId,
            tool: toolCall.function.name,
            error: (error as Error).message,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_screenshot') {
        // Browser screenshot tool - takes screenshot and saves to disk for display
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Browser: Taking screenshot...\n' };
        // Signal frontend to open browser window
        yield { type: 'browser_action', action: 'open', url: args.url };
        logger.info('Browser screenshot (stream)', { userId, url: args.url, fullPage: args.fullPage });
        try {
          const result = await browser.screenshot(userId, args.url, {
            fullPage: args.fullPage,
            selector: args.selector,
          });

          // If screenshot was captured, save it to disk and format for display
          if (result.success && result.screenshot) {
            const saveResult = await imageGeneration.saveScreenshot(
              userId,
              result.screenshot,
              result.pageUrl || args.url
            );

            if (saveResult.success && saveResult.imageUrl) {
              const caption = `Screenshot of ${result.pageTitle || result.pageUrl || args.url}`;
              const imageBlock = imageGeneration.formatImageForChat(saveResult.imageUrl, caption);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Screenshot captured successfully.\n\n${imageBlock}\n\nPage: ${result.pageUrl || args.url}\nTitle: ${result.pageTitle || 'N/A'}`,
              } as ChatMessage);
            } else {
              // Save failed - don't claim we have a displayable image
              logger.warn('Screenshot save failed (stream)', { userId, url: args.url, error: saveResult.error });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Screenshot was captured but could not be saved for display.\nPage visited: ${result.pageUrl || args.url}\nTitle: ${result.pageTitle || 'N/A'}`,
              } as ChatMessage);
            }
          } else {
            // Screenshot capture failed
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Screenshot failed: ${result.error || 'Unknown error'}\nPage: ${result.pageUrl || args.url}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Browser screenshot failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_fill') {
        // Browser fill tool
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Browser: Filling form...\n' };
        // Signal frontend to open browser window
        yield { type: 'browser_action', action: 'open', url: args.url };
        logger.info('Browser fill (stream)', { userId, url: args.url, selector: args.selector });
        try {
          const result = await browser.fill(userId, args.url, args.selector, args.value);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser fill failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_extract') {
        // Browser extract tool
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Browser: Extracting content...\n' };
        // Signal frontend to open browser window
        yield { type: 'browser_action', action: 'open', url: args.url };
        logger.info('Browser extract (stream)', { userId, url: args.url, selector: args.selector });
        try {
          const result = args.selector
            ? await browser.extractElements(userId, args.url, args.selector, args.limit)
            : await browser.getContent(userId, args.url);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser extract failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_wait') {
        // Browser wait tool
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Browser: Waiting for element...\n' };
        // Signal frontend to open browser window
        yield { type: 'browser_action', action: 'open', url: args.url };
        logger.info('Browser wait (stream)', { userId, url: args.url, selector: args.selector });
        try {
          const result = await browser.waitFor(userId, args.url, args.selector, args.timeout);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser wait failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_close') {
        // Browser close tool
        yield { type: 'reasoning', content: '> Browser: Closing...\n' };
        logger.info('Browser close', { userId });
        try {
          const result = await browser.closeBrowser(userId);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: browser.formatBrowserResultForPrompt(result),
          } as ChatMessage);
        } catch (error) {
          logger.error('Browser close failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'browser_render_html') {
        // Browser render HTML tool - renders HTML content and takes screenshot
        const args = JSON.parse(toolCall.function.arguments);
        // Decode HTML entities in case LLM encoded them
        const htmlContent = decodeHtmlEntities(args.html);
        const pageTitle = args.title || 'Luna HTML Page';
        logger.info('Browser render HTML', { userId, htmlLength: htmlContent.length, title: pageTitle });
        yield { type: 'reasoning', content: '> Rendering HTML page...\n' };
        try {
          const result = await browser.renderHtml(userId, htmlContent);

          // If screenshot was captured, save it to disk and format for display
          if (result.success && result.screenshot) {
            const saveResult = await imageGeneration.saveScreenshot(
              userId,
              result.screenshot,
              'rendered-html'
            );

            if (saveResult.success && saveResult.imageUrl) {
              const caption = pageTitle;
              const imageBlock = imageGeneration.formatImageForChat(saveResult.imageUrl, caption);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `HTML page rendered successfully.\n\n${imageBlock}\n\nTitle: ${pageTitle}`,
              } as ChatMessage);
            } else {
              // Save failed
              logger.warn('HTML render save failed', { userId, error: saveResult.error });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `HTML was rendered but the screenshot could not be saved for display.`,
              } as ChatMessage);
            }
          } else {
            // Render failed
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `HTML render failed: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Browser render HTML failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'generate_image') {
        // Image generation tool
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Generate image', { userId, promptLength: args.prompt?.length });
        try {
          const result = await imageGeneration.generateImage(userId, args.prompt);
          if (result.success && result.imageUrl) {
            
            // Send to Telegram if connected
            const connection = await telegramService.getTelegramConnection(userId);
            if (connection && connection.isActive && result.filePath) {
              telegramService.sendTelegramPhoto(
                connection.chatId,
                result.filePath,
                `Generated image: ${args.prompt.substring(0, 100)}`
              ).catch(err => logger.error('Failed to send generated image to Telegram', { error: (err as Error).message }));
            }

            const imageBlock = imageGeneration.formatImageForChat(
              result.imageUrl,
              `Generated image: ${args.prompt.substring(0, 100)}${args.prompt.length > 100 ? '...' : ''}`
            );
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Image generated successfully.\n\n${imageBlock}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to generate image: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Image generation failed', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Image generation error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'generate_desktop_background') {
        // Desktop background generation tool (streaming)
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'reasoning', content: '> Generating desktop background...\n' };
        logger.info('Generate desktop background (stream)', { userId, promptLength: args.prompt?.length, style: args.style });
        try {
          const result = await backgroundService.generateBackground(
            userId,
            args.prompt,
            args.style || 'custom'
          );
          if (result.success && result.background) {
            // Optionally set as active (default true)
            const setActive = args.setActive !== false;
            if (setActive) {
              await backgroundService.setActiveBackground(userId, result.background.id);
              // Signal frontend to refresh background
              yield { type: 'background_refresh' };
            }
            const imageBlock = imageGeneration.formatImageForChat(
              result.background.imageUrl,
              `Desktop background: ${result.background.name}`
            );
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Desktop background generated successfully!${setActive ? ' It is now set as your active background.' : ' You can set it as active in Settings > Background.'}\n\n${imageBlock}`,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to generate background: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Background generation failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Background generation error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'research') {
        // Research agent tool - uses Claude CLI for in-depth research (streaming)
        const args = JSON.parse(toolCall.function.arguments);
        const depthLabel = args.depth === 'quick' ? 'Quick research' : 'Deep research';
        yield { type: 'reasoning', content: `> ${depthLabel}: ${args.query?.substring(0, 50)}...\n` };
        logger.info('Research tool called (stream)', { userId, query: args.query?.substring(0, 100), depth: args.depth });
        try {
          const result = await researchAgent.executeResearch(args.query, userId, {
            depth: args.depth || 'thorough',
            saveToFile: args.save_to_file,
          });
          if (result.success) {
            let content = `**Research Summary:**\n${result.summary}\n\n**Details:**\n${result.details}`;
            if (result.savedFile) {
              content += `\n\n**Saved to:** ${result.savedFile}`;
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Research failed: ${result.error || 'Unknown error'}`,
            } as ChatMessage);
          }
        } catch (error) {
          logger.error('Research tool failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Research error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'load_context') {
        // Context loading tool - fetch session/intent context on demand
        const args = JSON.parse(toolCall.function.arguments || '{}');
        yield { type: 'reasoning', content: '> Loading additional context...\n' };
        logger.info('Load context tool called (stream)', { userId, params: args });
        try {
          const result = await loadContextHandler.handleLoadContext(userId, args);
          const formatted = loadContextHandler.formatLoadContextResult(result);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: formatted,
          } as ChatMessage);
        } catch (error) {
          logger.error('Load context tool failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error loading context: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'correct_summary') {
        // Context correction tool - fix incorrect summaries
        const args = JSON.parse(toolCall.function.arguments || '{}');
        yield { type: 'reasoning', content: '> Correcting context summary...\n' };
        logger.info('Correct summary tool called (stream)', { userId, params: args });
        try {
          const result = await loadContextHandler.handleCorrectSummary(userId, args);
          const formatted = loadContextHandler.formatCorrectSummaryResult(result);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: formatted,
          } as ChatMessage);
        } catch (error) {
          logger.error('Correct summary tool failed (stream)', { error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error correcting summary: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name.startsWith('system_') ||
                 toolCall.function.name.startsWith('network_') ||
                 toolCall.function.name.startsWith('process_') ||
                 toolCall.function.name.startsWith('docker_') ||
                 toolCall.function.name.startsWith('service_') ||
                 toolCall.function.name.startsWith('logs_') ||
                 toolCall.function.name.startsWith('maintenance_')) {
        // System monitoring tools
        const args = JSON.parse(toolCall.function.arguments || '{}');
        yield { type: 'reasoning', content: `> Checking ${toolCall.function.name.replace(/_/g, ' ')}...\n` };
        logger.info('Sysmon tool called (stream)', { tool: toolCall.function.name, args });
        try {
          const result = await executeSysmonTool(toolCall.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result, null, 2),
          } as ChatMessage);
        } catch (error) {
          logger.error('Sysmon tool failed (stream)', { tool: toolCall.function.name, error: (error as Error).message });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${(error as Error).message}`,
          } as ChatMessage);
        }
      } else if (toolCall.function.name.startsWith('mcp_')) {
        // MCP (Model Context Protocol) tools
        const parsed = mcpService.parseMcpToolName(toolCall.function.name);
        if (parsed) {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          yield { type: 'reasoning', content: `> Calling MCP tool: ${parsed.toolName}\n` };
          logger.info('MCP tool called (stream)', { tool: toolCall.function.name, serverId: parsed.serverId, toolName: parsed.toolName, args });

          const mcpTool = mcpUserTools.find(t => t.serverId.startsWith(parsed.serverId) && t.name === parsed.toolName);
          if (mcpTool) {
            const result = await mcpService.executeTool(userId, mcpTool.serverId, parsed.toolName, args);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result.content,
            } as ChatMessage);
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'MCP tool not found or no longer available',
            } as ChatMessage);
          }
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Invalid MCP tool name format',
          } as ChatMessage);
        }
      }
    }
  }

  yield { type: 'status', status: '' };

  // OPTIMIZED: Only make second LLM call if tools were used
  // If no tools were called, reuse the initial completion content
  let fullContent = '';
  let tokensUsed = 0;
  let promptTokens = initialCompletion.promptTokens || 0;
  let completionTokens = initialCompletion.completionTokens || 0;

  const toolsWereUsed = initialCompletion.toolCalls && initialCompletion.toolCalls.length > 0;

  if (toolsWereUsed) {
    // Tools were used - need to continue with tool results
    // Use a loop to handle multi-turn tool calling (e.g., search -> email -> agent -> memory)
    const MAX_TOOL_ROUNDS = 15;
    let toolRound = 0;

    while (toolRound < MAX_TOOL_ROUNDS) {
      toolRound++;

      // Make a non-streaming call with tools to check if more tool calls are needed
      const followUpCompletion = await createChatCompletion({
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
        provider: modelConfig.provider,
        model: modelConfig.model,
        loggingContext: {
          userId,
          sessionId,
          source: 'chat',
          nodeName: 'chat_streaming_followup',
        },
      });

      if (followUpCompletion.reasoning) {
        yield { type: 'reasoning', content: followUpCompletion.reasoning };
      }

      // If no more tool calls, stream the final response
      if (!followUpCompletion.toolCalls || followUpCompletion.toolCalls.length === 0) {
        // Stream the final content
        const finalContent = followUpCompletion.content || '';
        tokensUsed = followUpCompletion.tokensUsed || 0;
        promptTokens += followUpCompletion.promptTokens || 0;
        completionTokens += followUpCompletion.completionTokens || 0;

        const chunkSize = 20;
        for (let i = 0; i < finalContent.length; i += chunkSize) {
          fullContent += finalContent.slice(i, i + chunkSize);
          yield { type: 'content', content: finalContent.slice(i, i + chunkSize) };
        }
        break;
      }

      // More tool calls needed - execute them
      const additionalToolNames = followUpCompletion.toolCalls.map(tc => tc.function.name);
      toolsUsed.push(...additionalToolNames);
      logger.info('Additional tool calls in round', { round: toolRound, count: followUpCompletion.toolCalls.length });

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: followUpCompletion.content || '',
        tool_calls: followUpCompletion.toolCalls,
      } as ChatMessage);

      // Execute each tool call
      for (const toolCall of followUpCompletion.toolCalls) {
        if (toolCall.function.name === 'delegate_to_agent') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: 'Invoking agent...' };
          logger.info('Delegating to agent in follow-up', { agent: args.agent, task: args.task?.substring(0, 100) });

          const result = await agents.executeAgentTask(userId, {
            agentName: args.agent,
            task: args.task,
            context: args.context,
          });

          yield { type: 'status', status: `${result.agentName} agent completed` };
          logger.info('Agent completed in follow-up', { requestedAgent: args.agent, actualAgent: result.agentName, success: result.success });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: formatAgentResultForContext(result.agentName, result.result, result.success),
          } as ChatMessage);
        } else if (toolCall.function.name === 'web_search') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: `Searching: ${args.query}` };
          const results = await searxng.search(args.query);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: results && results.length > 0 ? formatSearchResultsForContext(results) : 'No search results found.',
          } as ChatMessage);
        } else if (toolCall.function.name === 'browser_visual_search') {
          const args = JSON.parse(toolCall.function.arguments);
          const searchEngine = args.searchEngine || 'google_news';
          const searchUrl = browserScreencast.getSearchUrl(args.query, searchEngine);
          logger.info('Browser visual search (follow-up)', { query: args.query, searchEngine, searchUrl });

          yield { type: 'status', status: `Opening browser to search: ${args.query}` };
          yield { type: 'browser_action', action: 'open', url: searchUrl };

          browserScreencast.setPendingVisualBrowse(userId, searchUrl);

          const searchResults = await searxng.search(args.query);
          const searchContext = searchResults && searchResults.length > 0
            ? formatSearchResultsForContext(searchResults)
            : 'No search results found.';

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Browser opened to ${searchUrl} for visual browsing.\n\nSearch results for context:\n${searchContext}`,
          } as ChatMessage);
        } else if (
          toolCall.function.name === 'browser_navigate' ||
          toolCall.function.name === 'browser_click' ||
          toolCall.function.name === 'browser_type' ||
          toolCall.function.name === 'browser_get_page_content'
        ) {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const openUrl = typeof args.url === 'string' && args.url.length > 0
            ? args.url
            : getBrowserOpenUrl(userId);

          yield { type: 'status', status: `Browser: ${getBrowserToolStatusLine(toolCall.function.name, args)}` };
          yield { type: 'browser_action', action: 'open', url: openUrl };
          yield { type: 'browser_action', action: toolCall.function.name, url: openUrl };
          browserScreencast.setPendingVisualBrowse(userId, openUrl);

          logger.info('Shared browser tool (follow-up)', {
            userId,
            tool: toolCall.function.name,
            url: args.url,
            selector: args.selector,
          });

          try {
            const result = await executeSharedBrowserToolCall(userId, toolCall.function.name, args);
            if (result.openUrl && result.openUrl !== openUrl) {
              yield { type: 'browser_action', action: 'open', url: result.openUrl };
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result.toolResponse,
            } as ChatMessage);
          } catch (error) {
            logger.error('Shared browser tool failed (follow-up)', {
              userId,
              tool: toolCall.function.name,
              error: (error as Error).message,
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Browser error: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name === 'send_email') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: `Sending email to ${args.to}...` };
          const result = await emailService.sendLunaEmail(args.to, args.subject, args.body);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.success ? `Email sent successfully. Message ID: ${result.messageId}` : `Failed: ${result.error}`,
          } as ChatMessage);
        } else if (toolCall.function.name === 'check_email') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: 'Checking inbox...' };
          const { emails, quarantinedCount } = args.unreadOnly !== false
            ? await emailService.getLunaUnreadEmailsGated()
            : await emailService.checkLunaInboxGated(10);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: emails.length > 0 || quarantinedCount > 0
              ? `Found ${emails.length} email(s):\n${emailService.formatGatedInboxForPrompt(emails, quarantinedCount)}`
              : 'No emails found.',
          } as ChatMessage);
          } else if (toolCall.function.name === 'read_email') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: 'Reading email...' };
          logger.info('Luna reading email (follow-up, gated)', { uid: args.uid });
          try {
            const email = await emailService.fetchEmailByUidGated(args.uid);
            if (email) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: emailService.formatGatedEmailForPrompt(email),
              } as ChatMessage);
            } else {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Email with UID ${args.uid} was quarantined for security review or not found.`,
              } as ChatMessage);
            }
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to read email: ${(error as Error).message}`,
            } as ChatMessage);
          }
          } else if (toolCall.function.name === 'reply_email') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: 'Sending reply...' };
          logger.info('Luna replying to email (follow-up)', { uid: args.uid });
          try {
            const result = await emailService.replyToEmail(args.uid, args.body);
            if (result.success) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Reply sent successfully. Message ID: ${result.messageId}`,
              } as ChatMessage);
            } else {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Failed to send reply: ${result.error}${result.blockedRecipients ? ` (blocked: ${result.blockedRecipients.join(', ')})` : ''}`,
              } as ChatMessage);
            }
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to send reply: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name === 'delete_email') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: 'Deleting email...' };
          logger.info('Luna deleting email (follow-up)', { uid: args.uid });
          try {
            const success = await emailService.deleteEmail(args.uid);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: success ? `Email with UID ${args.uid} has been deleted successfully.` : `Failed to delete email with UID ${args.uid}.`,
            } as ChatMessage);
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to delete email: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name === 'mark_email_read') {
          const args = JSON.parse(toolCall.function.arguments);
          yield { type: 'status', status: 'Updating email status...' };
          logger.info('Luna marking email read status (follow-up)', { uid: args.uid, isRead: args.isRead });
          try {
            const success = await emailService.markEmailRead(args.uid, args.isRead);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: success ? `Email with UID ${args.uid} has been marked as ${args.isRead ? 'read' : 'unread'}.` : `Failed to update read status for email with UID ${args.uid}.`,
            } as ChatMessage);
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Failed to mark email: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name === 'suggest_goal') {
          const args = JSON.parse(toolCall.function.arguments);
          logger.info('Luna suggesting goal (follow-up)', { title: args.title, goalType: args.goalType });

          await questionsService.storePendingGoalSuggestion(userId, {
            title: args.title,
            description: args.description,
            goalType: args.goalType,
          });

          await questionsService.askQuestion(userId, sessionId, {
            question: `Would you like me to create a goal: "${args.title}"?${args.description ? ` (${args.description})` : ''}`,
            context: `Goal type: ${args.goalType}`,
            priority: 5,
          });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Goal suggestion "${args.title}" created. The user will see a notification to confirm or decline.`,
          } as ChatMessage);
        } else if (toolCall.function.name.startsWith('system_') ||
                   toolCall.function.name.startsWith('network_') ||
                   toolCall.function.name.startsWith('process_') ||
                   toolCall.function.name.startsWith('docker_') ||
                   toolCall.function.name.startsWith('service_') ||
                   toolCall.function.name.startsWith('logs_') ||
                   toolCall.function.name.startsWith('maintenance_')) {
          // System monitoring tools in follow-up
          const args = JSON.parse(toolCall.function.arguments || '{}');
          yield { type: 'status', status: `Checking ${toolCall.function.name.replace(/_/g, ' ')}...` };
          logger.info('Sysmon tool called (follow-up)', { tool: toolCall.function.name, args });
          try {
            const result = await executeSysmonTool(toolCall.function.name, args);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result, null, 2),
            } as ChatMessage);
          } catch (error) {
            logger.error('Sysmon tool failed (follow-up)', { tool: toolCall.function.name, error: (error as Error).message });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name.startsWith('mcp_')) {
          // MCP (Model Context Protocol) tools in follow-up
          const parsed = mcpService.parseMcpToolName(toolCall.function.name);
          if (parsed) {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            yield { type: 'status', status: `Calling MCP tool ${parsed.toolName}...` };
            logger.info('MCP tool called (follow-up)', { tool: toolCall.function.name, serverId: parsed.serverId, toolName: parsed.toolName, args });

            const mcpTool = mcpUserTools.find(t => t.serverId.startsWith(parsed.serverId) && t.name === parsed.toolName);
            if (mcpTool) {
              const result = await mcpService.executeTool(userId, mcpTool.serverId, parsed.toolName, args);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result.content,
              } as ChatMessage);
            } else {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'MCP tool not found or no longer available',
              } as ChatMessage);
            }
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Invalid MCP tool name format',
            } as ChatMessage);
          }
        } else {
          // Generic handler for other tools
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Tool ${toolCall.function.name} executed.`,
          } as ChatMessage);
        }
      }
    }

    if (toolRound >= MAX_TOOL_ROUNDS) {
      logger.warn('Max tool rounds reached', { rounds: toolRound });
    }
  } else {
    // No tools - reuse initial completion (simulate streaming for smooth UX)
    fullContent = initialCompletion.content || '';
    tokensUsed = initialCompletion.tokensUsed;

    // Stream the content in chunks for smooth display
    const chunkSize = 20;
    for (let i = 0; i < fullContent.length; i += chunkSize) {
      yield { type: 'content', content: fullContent.slice(i, i + chunkSize) };
    }
  }

  // Save assistant response with router decision metadata
  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: fullContent,
    tokensUsed,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheTokens: 0, // OpenAI-compatible providers don't have cache tokens
    model: modelConfig.model,
    provider: modelConfig.provider,
    routeDecision: routerDecision || undefined,
  });

  // Store assistant message embedding (async)
  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, fullContent, 'assistant');

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, fullContent).then(({ enrichment }) =>
    memorycoreClient.recordChatInteraction(sessionId, 'response', fullContent, {
      model: modelConfig.model,
      provider: modelConfig.provider,
      tokensUsed,
    }, enrichment)
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Process facts from conversation (async, every few messages)
  const totalMessages = rawHistory.length + 2;
  if (totalMessages % 4 === 0) {
    const allMessages = [
      ...rawHistory.map(m => ({ id: m.id, role: m.role, content: m.content })),
      { id: userMessage.id, role: 'user', content: message },
      { id: assistantMessage.id, role: 'assistant', content: fullContent },
    ];
    memoryService.processConversationMemory(userId, sessionId, allMessages).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
    // Also learn preferences from conversation
    preferencesService.learnFromConversation(userId, sessionId, allMessages).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Trigger background summarization if threshold met (non-blocking)
  const messagesSinceSummary = await contextCompression.getMessageCountSinceSummary(sessionId);
  if (messagesSinceSummary >= backgroundSummarization.BACKGROUND_SUMMARY_THRESHOLD) {
    backgroundSummarization.triggerBackgroundSummarization(sessionId, userId);
  }

  // Update session title if first message
  if (rawHistory.length === 0) {
    const title = await sessionService.generateSessionTitle([
      { role: 'user', content: message } as Message,
    ]);
    await sessionService.updateSession(sessionId, userId, { title });
  }

  const processingTimeMs = Date.now() - startTime;
  const tokensPerSecond = processingTimeMs > 0 ? (completionTokens / (processingTimeMs / 1000)) : 0;

  // Update session log with tools used (for layered agent context continuity)
  const uniqueToolsUsed = [...new Set(toolsUsed)];
  if (uniqueToolsUsed.length > 0) {
    sessionLogService.updateSessionLog(sessionId, { toolsUsed: uniqueToolsUsed }).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));
  }

  // Process message for intent updates (async, non-blocking)
  intentDetection.processMessageForIntents(
    userId,
    sessionId,
    message,
    fullContent,
    intentContext
  ).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  yield {
    type: 'done',
    messageId: assistantMessage.id,
    tokensUsed,
    metrics: {
      promptTokens,
      completionTokens,
      processingTimeMs,
      tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
      toolsUsed: uniqueToolsUsed,
      model: modelConfig.model,
      // Router-First Architecture provenance
      routeInfo: routerDecision ? {
        route: routerDecision.route,
        confidence: routerDecision.confidence_required,
        class: routerDecision.class,
      } : undefined,
    },
  };
}

export default { processMessage, streamMessage };
