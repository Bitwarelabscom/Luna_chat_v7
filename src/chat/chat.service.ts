import { config } from '../config/index.js';
import * as layeredAgent from '../layered-agent/index.js';
import {
  createChatCompletion,
  type ChatMessage,
} from '../llm/openai.client.js';
// Tool definitions moved to src/agents/tool-resolver.ts
import * as lunaStreamsClient from '../integration/luna-streams.client.js';

import { getUserModelConfig } from '../llm/model-config.service.js';
import * as agents from '../abilities/agents.service.js';
import * as projectService from '../abilities/project.service.js';
import * as sandbox from '../abilities/sandbox.service.js';
import * as documents from '../abilities/documents.service.js';
import * as imageGeneration from '../abilities/image-generation.service.js';
import { query as dbQuery } from '../db/postgres.js';
import * as memoryService from '../memory/memory.service.js';
import * as memorycoreClient from '../memory/memorycore.client.js';
// Note: formatStableMemory, formatVolatileMemory available for cache-optimized prompts
// Full tool-calling cache integration requires extending openai.client.ts
import * as preferencesService from '../memory/preferences.service.js';
import * as abilities from '../abilities/orchestrator.js';
import { buildContextualPrompt } from '../persona/luna.persona.js';
import { getChatModeAgentForUser } from '../agents/registry.js';
import { getToolsForAgent } from '../agents/tool-resolver.js';
import { getDesktopContext } from '../desktop/desktop.websocket.js';
import * as sessionService from './session.service.js';
import * as contextCompression from './context-compression.service.js';
import * as backgroundSummarization from './background-summarization.service.js';
import * as sessionLogService from './session-log.service.js';
import * as sessionActivityService from './session-activity.service.js';
import * as authService from '../auth/auth.service.js';
import * as intentContextService from '../intents/intent-context.service.js';
import * as intentDetection from '../intents/intent-detection.service.js';
import logger from '../utils/logger.js';
import { sysmonTools } from '../abilities/sysmon.service.js';
import * as mcpService from '../mcp/mcp.service.js';
import { executeTool } from '../agentic/tool-executor.js';
import * as router from '../router/index.js';
import type { RouterDecision } from '../router/router.types.js';
import type { Message, SearchResult } from '../types/index.js';
import * as embeddingService from '../memory/embedding.service.js';
import * as sentimentService from '../memory/sentiment.service.js';
import * as attentionService from '../memory/attention.service.js';
import * as centroidService from '../memory/centroid.service.js';
import * as emotionalMoments from '../memory/emotional-moments.service.js';
import * as contradictionService from '../memory/contradiction.service.js';
import type { InteractionEnrichment } from '../memory/memorycore.client.js';
import * as onboardingService from '../onboarding/onboarding.service.js';
import { getUserFacts } from '../memory/facts.service.js';
import * as lunaAffectService from '../memory/luna-affect.service.js';
import * as selfModificationService from '../memory/self-modification.service.js';
import * as ambientPerception from '../sensory/ambient-perception.service.js';
import * as conversationRhythm from '../memory/conversation-rhythm.service.js';

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



/**
 * Compute enrichment dataor a message before recording to MemoryCore.
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
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna';
  source?: 'web' | 'telegram' | 'api';
  projectMode?: boolean;
  thinkingMode?: boolean;
  zipMode?: boolean;
  novaMode?: boolean;  // @deprecated - use zipMode
  documentIds?: string[];
  djStyleContext?: string;
  djGenreContext?: string;
  ceoSystemLog?: string;
  skillContext?: string;
}

export interface ChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
  searchResults?: SearchResult[];
}

export async function processMessage(input: ChatInput): Promise<ChatOutput> {
  const { sessionId, userId, message, mode, source = 'web', projectMode, thinkingMode: _thinkingMode, zipMode: inputZipMode, novaMode: inputNovaMode, documentIds, djStyleContext, djGenreContext, ceoSystemLog, skillContext } = input;
  const zipMode = inputZipMode || inputNovaMode;  // Support both names during transition

  // Initialize MemoryCore session for consolidation tracking
  // This enables episodic memory recording and NeuralSleep LNN processing
  await memorycoreClient.ensureSession(sessionId, userId);

  // Compute enrichment (embedding, sentiment, attention, centroid) before recording
  const { enrichment: pmEnrichment } = await computeEnrichment(sessionId, message).catch(() => ({
    enrichment: {} as InteractionEnrichment, embedding: [] as number[],
  }));

  // Record enriched user message to MemoryCore (async, non-blocking)
  memorycoreClient.recordChatInteraction(sessionId, 'message', message, { mode, source }, pmEnrichment).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Capture emotional moments when VAD thresholds are crossed (fire-and-forget)
  if (pmEnrichment?.emotionalValence !== undefined) {
    const valence = pmEnrichment.emotionalValence;
    // Arousal is not directly in enrichment, re-analyze only for significant valence
    if (Math.abs(valence) > 0.5) {
      sentimentService.analyze(message).then(sentiment => {
        if (Math.abs(sentiment.valence) > 0.5 || sentiment.arousal > 0.6) {
          emotionalMoments.capture(userId, sessionId, null, message, sentiment)
            .catch(err => logger.debug('Emotional moment capture failed', { err: (err as Error).message }));
        }
      }).catch(() => {});
    }
  }

  // Emit to Luna Streams (fire-and-forget)
  lunaStreamsClient.emitChatInteraction(message, {
    mode,
    sentiment: pmEnrichment?.emotionalValence,
    attentionScore: pmEnrichment?.attentionScore,
    responseTimeMs: pmEnrichment?.interMessageMs,
  });

  // Track session activity for automatic consolidation after inactivity
  sessionActivityService.recordActivity(sessionId, userId).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Router-First Architecture: Route decision before any processing
  let routerDecision: RouterDecision | null = null;
  if (config.router?.enabled) {
    try {
      const routerConfig = {
        enabled: config.router.enabled,
        classifierModel: config.router.classifierModel,
        classifierProvider: config.router.classifierProvider as 'anthropic' | 'google' | 'groq',
        classifierTimeoutMs: config.router.classifierTimeoutMs,
        rulesTimeoutMs: config.router.rulesTimeoutMs,
        fallbackRoute: config.router.fallbackRoute as 'pro' | 'pro+tools',
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

  // Zip mode uses fast model but same route (no nano tier)
  // Thinking mode and zip mode are mutually exclusive (enforced in frontend)

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
  let isSmallTalkMessageLegacy = abilities.isSmallTalk(message);
  const contextOptions = abilities.getContextOptions(message);

  // TOOL HINTS: Same regex-based detection as streamMessage path
  const toolHintsLegacy = router.getToolHints(message);
  if (toolHintsLegacy.triggered) {
    isSmallTalkMessageLegacy = false;
  }

  // Start Mamba stream context fetch early so it runs in parallel with all context loading
  const mambaStreamPromise = lunaStreamsClient.getStreamContext(userId).catch(() => null);
  // Start ambient + style params fetch in parallel (lightweight, cached)
  const ambientPromise = ambientPerception.buildAmbientContext(userId).catch(() => '');
  const styleParamsPromise = selfModificationService.getActiveParameters(userId).catch(() => []);

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
    // Get user's model configuration - use fast model for smalltalk, dedicated task for ceo/dj modes
    getUserModelConfig(userId, isSmallTalkMessageLegacy ? 'smalltalk' : mode === 'ceo_luna' ? 'ceo_luna' : mode === 'dj_luna' ? 'dj_luna' : 'main_chat'),
    // Get user profile for personalization
    authService.getUserById(userId),
    // Get conversation history (higher limit for compression to work with)
    sessionService.getSessionMessages(sessionId, { limit: 50 }),
    // Build memory context - skip volatile parts for smalltalk, but load stable facts in companion mode
    isSmallTalkMessageLegacy || mode === 'dj_luna'
      ? (mode === 'companion' ? memoryService.buildStableMemoryOnly(userId) : Promise.resolve({ stable: { facts: '', learnings: '' }, volatile: { relevantHistory: '', conversationContext: '' } } as memoryService.MemoryContext))
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

  // Auto-detect onboarding for companion mode
  let onboardingContext: string | undefined;
  if (mode === 'companion') {
    try {
      let obState = await onboardingService.getOnboardingState(userId);
      if (!obState) {
        const facts = await getUserFacts(userId, { limit: 1 });
        if (facts.length === 0) {
          obState = await onboardingService.initOnboarding(userId, sessionId);
        }
      }
      if (obState && (obState.status === 'in_progress' || obState.status === 'reviewing')) {
        onboardingContext = onboardingService.buildOnboardingPrompt(obState);
      }
    } catch (err) {
      logger.debug('Onboarding check failed', { err: (err as Error).message });
    }
  }

  const stableMemoryPrompt = memoryService.formatStableMemory(memoryContext);
  const volatileMemoryPrompt = memoryService.formatVolatileMemory(memoryContext);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);
  const prefPrompt = preferencesService.formatGuidelinesForPrompt(prefGuidelines);
  const intentPrompt = intentContextService.formatIntentsForPrompt(intentContext);

  // Mark contradiction signals as surfaced (they are now in the volatile prompt)
  if (memoryContext.volatile.contradictionIds && memoryContext.volatile.contradictionIds.length > 0) {
    contradictionService.markSurfaced(memoryContext.volatile.contradictionIds, sessionId)
      .catch(err => logger.debug('Failed to mark contradictions surfaced', { err: (err as Error).message }));
  }

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

  // Two-tier memory: stable context (Tier 2, cacheable) vs volatile context (Tier 4, per-message)
  const stableContext = [stableMemoryPrompt, abilityPrompt, prefPrompt, canvasStylePrompt].filter(Boolean).join('\n\n');
  const volatileContext = [volatileMemoryPrompt, intentPrompt, abilityActionResult, canvasSessionPrompt].filter(Boolean).join('\n\n');

  // Resolve parallel context fetches (started earlier)
  const rawMambaContext = await mambaStreamPromise;
  // Skip flatlined/contradictory Mamba context - saves ~120 tokens when stream is inactive
  const mambaStreamContext = rawMambaContext && !rawMambaContext.includes('zero drift') && !rawMambaContext.includes('disengagement')
    ? rawMambaContext : undefined;
  const resolvedAmbientContext = await ambientPromise;
  const resolvedStyleParams = await styleParamsPromise;
  const resolvedSelfCalibratedStyle = selfModificationService.formatStyleForPrompt(resolvedStyleParams);

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
        stableMemoryContext: stableContext,
        volatileMemoryContext: volatileContext,
        sessionHistory: sessionHistoryContext,
        conversationSummary: compressedCtx.systemPrefix,
        mcpTools: mcpToolsForPrompt,
        source,
        zipMode,
        djStyleContext,
        djGenreContext,
        ceoSystemLog,
        skillContext,
        desktopContext: getDesktopContext(userId),
        mambaStreamContext,
        onboardingContext,
        ambientContext: resolvedAmbientContext || undefined,
        selfCalibratedStyle: resolvedSelfCalibratedStyle || undefined,
      }),
    },
  ];

  // Add semantically relevant older messages first (marked as earlier context)
  for (const relevant of compressedCtx.relevantMessages) {
    const ts = contextCompression.formatMessageTimestamp(relevant.createdAt);
    messages.push({
      role: relevant.role as 'user' | 'assistant',
      content: `${ts}[Earlier context] ${contextCompression.compressMessage({ content: relevant.content, role: relevant.role } as Message)}`,
    });
  }

  // Add recent messages (truncated for efficiency, with timestamps)
  for (const msg of compressedCtx.recentMessages) {
    const ts = contextCompression.formatMessageTimestamp(msg.createdAt);
    messages.push({
      role: msg.role,
      content: `${ts}${contextCompression.compressMessage(msg)}`,
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

  // Track message rhythm for conversation pace awareness
  conversationRhythm.trackMessage(sessionId, 'user', message.length);

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

  // TOOL GATING: Registry-driven tool resolution
  const mcpToolsForLLM = mcpService.formatMcpToolsForLLM(mcpUserTools.map(t => ({ ...t, serverId: t.serverId })));
  const chatModeAgent = getChatModeAgentForUser(mode, userId);
  let legacyTools = chatModeAgent
    ? getToolsForAgent(chatModeAgent, { sysmonTools, mcpTools: mcpToolsForLLM, isSmallTalk: isSmallTalkMessageLegacy })
    : [];
  let searchResults: SearchResult[] | undefined;

  // TOOL FOCUSING: Filter to hinted tools when regex matched
  let legacyToolChoice: 'auto' | 'required' | undefined;
  if (toolHintsLegacy.triggered && legacyTools.length > 0) {
    const hinted = legacyTools.filter(t => toolHintsLegacy.toolNames.includes(t.function.name));
    if (hinted.length > 0) {
      legacyTools = hinted;
      legacyToolChoice = 'auto';
    }
  }

  let completion = await createChatCompletion({
    messages,
    tools: legacyTools.length > 0 ? legacyTools : undefined,
    tool_choice: legacyToolChoice,
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

    // Build tool execution context for the shared executor
    const toolCtxPm = {
      userId,
      sessionId,
      mode,
      mcpUserTools: mcpUserTools.map(t => ({ serverId: t.serverId, name: t.name })),
    };

    for (const toolCall of completion.toolCalls) {
      // Delegate all tool execution to the shared executor
      const pmToolResult = await executeTool(toolCall, toolCtxPm);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: pmToolResult.toolResponse,
      } as ChatMessage);
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

  // Parse onboarding data from assistant response (fire-and-forget)
  if (mode === 'companion') {
    onboardingService.processAssistantResponse(userId, completion.content)
      .catch(err => logger.debug('Onboarding parse failed', { err: (err as Error).message }));
  }

  // Update Luna's internal affect state (fire-and-forget)
  lunaAffectService.updateAffect(userId, sessionId, {
    lunaResponse: completion.content,
    userMessage: message,
    userSentimentValence: pmEnrichment?.emotionalValence,
  }).catch(err => logger.debug('Luna affect update failed', { err: (err as Error).message }));

  // Check self-modification revert conditions (fire-and-forget)
  if (pmEnrichment?.emotionalValence !== undefined) {
    selfModificationService.checkRevertCondition(userId, pmEnrichment.emotionalValence)
      .catch(err => logger.debug('Self-modification revert check failed', { err: (err as Error).message }));
  }

  // Record enriched response to MemoryCore for consolidation (async, non-blocking)
  computeEnrichment(sessionId, completion.content).then(({ enrichment }) => {
    memorycoreClient.recordChatInteraction(sessionId, 'response', completion.content, {
      model: modelConfig.model,
      provider: modelConfig.provider,
      tokensUsed: completion.tokensUsed,
    }, enrichment);

    // Emit to Luna Streams (fire-and-forget)
    lunaStreamsClient.emitChatInteraction(completion.content, {
      model: modelConfig.model,
      mode,
      sentiment: enrichment?.emotionalValence,
      attentionScore: enrichment?.attentionScore,
    });
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
      ], { userId, sessionId });
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
    route: 'pro' | 'pro+tools';
    confidence: 'estimate' | 'verified';
    class: 'chat' | 'transform' | 'factual' | 'actionable';
  };
}

export async function* streamMessage(
  input: ChatInput
): AsyncGenerator<{ type: 'content' | 'done' | 'status' | 'browser_action' | 'background_refresh' | 'reasoning' | 'video_action' | 'media_action' | 'canvas_artifact'; content?: string | any; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics; action?: string; url?: string; videos?: any[]; query?: string; items?: any[]; source?: string; artifactId?: string }> {
  const { sessionId, userId, message, mode, source = 'web', projectMode, thinkingMode: _thinkingMode, zipMode: inputZipMode, novaMode: inputNovaMode, documentIds, djStyleContext, djGenreContext, ceoSystemLog, skillContext } = input;
  const zipMode = inputZipMode || inputNovaMode;  // Support both names during transition

  // Initialize MemoryCore session for consolidation tracking
  // This enables episodic memory recording and NeuralSleep LNN processing
  await memorycoreClient.ensureSession(sessionId, userId);

  // Compute enrichment (embedding, sentiment, attention, centroid) before recording
  const { enrichment: smEnrichment } = await computeEnrichment(sessionId, message).catch(() => ({
    enrichment: {} as InteractionEnrichment, embedding: [] as number[],
  }));

  // Record enriched user message to MemoryCore (async, non-blocking)
  memorycoreClient.recordChatInteraction(sessionId, 'message', message, { mode, source }, smEnrichment).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Capture emotional moments when VAD thresholds are crossed (fire-and-forget)
  if (smEnrichment?.emotionalValence !== undefined) {
    const valence = smEnrichment.emotionalValence;
    if (Math.abs(valence) > 0.5) {
      sentimentService.analyze(message).then(sentiment => {
        if (Math.abs(sentiment.valence) > 0.5 || sentiment.arousal > 0.6) {
          emotionalMoments.capture(userId, sessionId, null, message, sentiment)
            .catch(err => logger.debug('Emotional moment capture failed', { err: (err as Error).message }));
        }
      }).catch(() => {});
    }
  }

  // Emit to Luna Streams (fire-and-forget)
  lunaStreamsClient.emitChatInteraction(message, {
    mode,
    sentiment: smEnrichment?.emotionalValence,
    attentionScore: smEnrichment?.attentionScore,
    responseTimeMs: smEnrichment?.interMessageMs,
  });

  // Track session activity for automatic consolidation after inactivity
  sessionActivityService.recordActivity(sessionId, userId).catch(err => logger.debug('Background task failed', { error: (err as Error).message }));

  // Router-First Architecture: Route decision before any processing
  let routerDecision: RouterDecision | null = null;
  if (config.router?.enabled) {
    try {
      const routerConfig = {
        enabled: config.router.enabled,
        classifierModel: config.router.classifierModel,
        classifierProvider: config.router.classifierProvider as 'anthropic' | 'google' | 'groq',
        classifierTimeoutMs: config.router.classifierTimeoutMs,
        rulesTimeoutMs: config.router.rulesTimeoutMs,
        fallbackRoute: config.router.fallbackRoute as 'pro' | 'pro+tools',
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

  // Zip mode uses fast model but same route (no nano tier)

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

        // Parse onboarding data from assistant response (fire-and-forget)
        if (mode === 'companion') {
          onboardingService.processAssistantResponse(userId, assistantContent)
            .catch(err => logger.debug('Onboarding parse failed', { err: (err as Error).message }));
        }

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

  // INTENT GATING: Use isSmallTalk heuristic for tool stripping (router no longer has nano tier)
  let isSmallTalkMessage = abilities.isSmallTalk(message);
  const contextOptions = abilities.getContextOptions(message);

  // TOOL HINTS: Regex-based tool detection runs before classifier.
  // If the message clearly needs tools (e.g. "youtube", "email", "weather"),
  // force-include them regardless of classifier/router decision.
  const toolHints = router.getToolHints(message);
  if (toolHints.triggered) {
    isSmallTalkMessage = false; // Never strip tools when hints fire
    logger.info('Tool hints detected', {
      categories: toolHints.matchedCategories,
      tools: toolHints.toolNames,
      overrodeSmallTalk: isSmallTalkMessage,
    });
  }

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

  // Start Mamba stream context fetch early so it runs in parallel with all context loading
  const mambaStreamPromise = lunaStreamsClient.getStreamContext(userId).catch(() => null);
  // Start ambient + style params fetch in parallel (lightweight, cached)
  const ambientPromise = ambientPerception.buildAmbientContext(userId).catch(() => '');
  const styleParamsPromise = selfModificationService.getActiveParameters(userId).catch(() => []);

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
    // Get user's model configuration - use fast model for smalltalk, dedicated task for ceo/dj modes
    getUserModelConfig(userId, isSmallTalkMessage ? 'smalltalk' : mode === 'ceo_luna' ? 'ceo_luna' : mode === 'dj_luna' ? 'dj_luna' : 'main_chat'),
    // Get user profile for personalization
    authService.getUserById(userId),
    // Get conversation history (higher limit for compression to work with)
    sessionService.getSessionMessages(sessionId, { limit: 50 }),
    // Build memory context - skip volatile parts for smalltalk, but load stable facts in companion mode
    isSmallTalkMessage
      ? (mode === 'companion' ? memoryService.buildStableMemoryOnly(userId) : Promise.resolve({ stable: { facts: '', learnings: '' }, volatile: { relevantHistory: '', conversationContext: '' } } as memoryService.MemoryContext))
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

  // Auto-detect onboarding for companion mode
  let onboardingContext: string | undefined;
  if (mode === 'companion') {
    try {
      let obState = await onboardingService.getOnboardingState(userId);
      if (!obState) {
        const facts = await getUserFacts(userId, { limit: 1 });
        if (facts.length === 0) {
          obState = await onboardingService.initOnboarding(userId, sessionId);
        }
      }
      if (obState && (obState.status === 'in_progress' || obState.status === 'reviewing')) {
        onboardingContext = onboardingService.buildOnboardingPrompt(obState);
      }
    } catch (err) {
      logger.debug('Onboarding check failed', { err: (err as Error).message });
    }
  }

  const stableMemoryPrompt = memoryService.formatStableMemory(memoryContext);
  const volatileMemoryPrompt = memoryService.formatVolatileMemory(memoryContext);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);
  const prefPrompt = preferencesService.formatGuidelinesForPrompt(prefGuidelines);
  const intentPrompt = intentContextService.formatIntentsForPrompt(intentContext);

  // Mark contradiction signals as surfaced (they are now in the volatile prompt)
  if (memoryContext.volatile.contradictionIds && memoryContext.volatile.contradictionIds.length > 0) {
    contradictionService.markSurfaced(memoryContext.volatile.contradictionIds, sessionId)
      .catch(err => logger.debug('Failed to mark contradictions surfaced', { err: (err as Error).message }));
  }

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

  // Two-tier memory: stable context (Tier 2, cacheable) vs volatile context (Tier 4, per-message)
  const stableContext = [stableMemoryPrompt, abilityPrompt, prefPrompt, canvasStylePrompt].filter(Boolean).join('\n\n');
  const volatileContext = [volatileMemoryPrompt, intentPrompt, abilityActionResult, canvasSessionPrompt].filter(Boolean).join('\n\n');

  // Resolve parallel context fetches (started earlier)
  const rawMambaContext = await mambaStreamPromise;
  // Skip flatlined/contradictory Mamba context - saves ~120 tokens when stream is inactive
  const mambaStreamContext = rawMambaContext && !rawMambaContext.includes('zero drift') && !rawMambaContext.includes('disengagement')
    ? rawMambaContext : undefined;
  const resolvedAmbientContext = await ambientPromise;
  const resolvedStyleParams = await styleParamsPromise;
  const resolvedSelfCalibratedStyle = selfModificationService.formatStyleForPrompt(resolvedStyleParams);

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
        stableMemoryContext: stableContext,
        volatileMemoryContext: volatileContext,
        sessionHistory: sessionHistoryContext,
        conversationSummary: compressedCtx.systemPrefix,
        mcpTools: mcpToolsForPrompt,
        source,
        zipMode,
        djStyleContext,
        djGenreContext,
        ceoSystemLog,
        skillContext,
        desktopContext: getDesktopContext(userId),
        mambaStreamContext,
        onboardingContext,
        ambientContext: resolvedAmbientContext || undefined,
        selfCalibratedStyle: resolvedSelfCalibratedStyle || undefined,
      }),
    },
  ];

  // Add semantically relevant older messages first (marked as earlier context)
  for (const relevant of compressedCtx.relevantMessages) {
    const ts = contextCompression.formatMessageTimestamp(relevant.createdAt);
    messages.push({
      role: relevant.role as 'user' | 'assistant',
      content: `${ts}[Earlier context] ${contextCompression.compressMessage({ content: relevant.content, role: relevant.role } as Message)}`,
    });
  }

  // Add recent messages (truncated for efficiency, with timestamps)
  for (const msg of compressedCtx.recentMessages) {
    const ts = contextCompression.formatMessageTimestamp(msg.createdAt);
    messages.push({
      role: msg.role,
      content: `${ts}${contextCompression.compressMessage(msg)}`,
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

  // Track message rhythm for conversation pace awareness
  conversationRhythm.trackMessage(sessionId, 'user', message.length);

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

  // TOOL GATING: Registry-driven tool resolution
  const mcpToolsForLLM = mcpService.formatMcpToolsForLLM(mcpUserTools.map(t => ({ ...t, serverId: t.serverId })));
  const smChatModeAgent = getChatModeAgentForUser(mode, userId);
  const availableTools = smChatModeAgent
    ? getToolsForAgent(smChatModeAgent, { sysmonTools, mcpTools: mcpToolsForLLM, isSmallTalk: isSmallTalkMessage })
    : [];

  // Strip tools for small Ollama models (<=9b) - they can't handle 40+ tool
  // definitions and still follow the system prompt reliably.
  // Larger Ollama models (32b+) and all cloud providers keep tools.
  const smallModelPattern = /\b([1-9]b|[1-9]\.\d+b|4b|7b|8b|9b)\b/i;
  const isOllamaProvider = modelConfig.provider === 'ollama' || modelConfig.provider === 'ollama_secondary' || modelConfig.provider === 'ollama_tertiary';
  const isSmallOllamaModel = isOllamaProvider && smallModelPattern.test(modelConfig.model);
  let effectiveTools = isSmallOllamaModel ? [] : availableTools;

  // TOOL FOCUSING: When tool hints matched, filter to just the hinted tools.
  // This gives weaker models a much stronger signal - 3 focused tools instead of 46.
  // The model is far more likely to call youtube_search when it's 1 of 3 tools
  // than when it's 1 of 46.
  if (toolHints.triggered && effectiveTools.length > 0) {
    const hintedTools = effectiveTools.filter(t =>
      toolHints.toolNames.includes(t.function.name)
    );
    // Only focus if we actually found matching tools in the available set
    if (hintedTools.length > 0) {
      effectiveTools = hintedTools;
    }
  }

  // Strip summon_agent from companion mode when router says no tools needed.
  // This prevents casual conversations from triggering expensive agent summoning loops
  // even if they get misrouted to pro tier.
  if (mode === 'companion' && routerDecision && !routerDecision.needs_tools && !toolHints.triggered) {
    effectiveTools = effectiveTools.filter(t => t.function.name !== 'summon_agent');
  }

  logger.info('Tool availability', {
    isSmallTalk: isSmallTalkMessage,
    toolsProvided: effectiveTools.length,
    toolsStripped: isSmallOllamaModel ? availableTools.length : 0,
    summonStripped: mode === 'companion' && routerDecision && !routerDecision.needs_tools && !toolHints.triggered,
    toolHints: toolHints.triggered ? toolHints.matchedCategories : undefined,
    toolsFocused: toolHints.triggered ? effectiveTools.map(t => t.function.name) : undefined,
    routerRoute: routerDecision?.route || 'legacy',
    provider: modelConfig.provider,
    model: modelConfig.model
  });

  // --- Agentic Loop ---
  // The LLM decides when to stop by generating content instead of tool calls.
  const { runAgentLoop } = await import('../agentic/agent-loop.js');
  const toolCtx = {
    userId,
    sessionId,
    mode,
    mcpUserTools: mcpUserTools.map(t => ({ serverId: t.serverId, name: t.name })),
  };

  let fullContent = '';
  let promptTokens = 0;
  let completionTokens = 0;

  const agentLoopConfig = {
    maxSteps: 25,
    maxCostUsd: 0.50,
    tools: effectiveTools,
    provider: modelConfig.provider,
    model: modelConfig.model,
    thinkingMode: _thinkingMode,
    loggingContext: {
      userId,
      sessionId,
      source: 'chat' as const,
      nodeName: 'chat_streaming',
    },
  };

  for await (const event of runAgentLoop(messages, agentLoopConfig, toolCtx)) {
    switch (event.type) {
      case 'content':
        fullContent += event.content;
        yield { type: 'content', content: event.content };
        break;
      case 'thinking':
        yield { type: 'reasoning', content: event.content };
        break;
      case 'tool_start':
        yield { type: 'reasoning', content: `> Using ${event.tool}...\n` };
        break;
      case 'tool_result':
        // Tool result logged by agent loop; no extra yield needed
        break;
      case 'side_effect':
        yield event.event as any;
        break;
      case 'limit_hit':
        yield { type: 'status', status: `Reached ${event.reason === 'max_steps' ? 'step' : 'cost'} limit` };
        break;
      case 'done':
        toolsUsed.push(...event.state.toolsUsed);
        promptTokens = event.state.totalInputTokens;
        completionTokens = event.state.totalOutputTokens;
        break;
    }
  }

  const tokensUsed = promptTokens + completionTokens;

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

  // Parse onboarding data from assistant response (fire-and-forget)
  if (mode === 'companion') {
    onboardingService.processAssistantResponse(userId, fullContent)
      .catch(err => logger.debug('Onboarding parse failed', { err: (err as Error).message }));
  }

  // Update Luna's internal affect state (fire-and-forget)
  lunaAffectService.updateAffect(userId, sessionId, {
    lunaResponse: fullContent,
    userMessage: message,
    userSentimentValence: smEnrichment?.emotionalValence,
  }).catch(err => logger.debug('Luna affect update failed', { err: (err as Error).message }));

  // Check self-modification revert conditions (fire-and-forget)
  if (smEnrichment?.emotionalValence !== undefined) {
    selfModificationService.checkRevertCondition(userId, smEnrichment.emotionalValence)
      .catch(err => logger.debug('Self-modification revert check failed', { err: (err as Error).message }));
  }

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
    ], { userId, sessionId });
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
