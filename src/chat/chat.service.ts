import {
  createChatCompletion,
  searchTool,
  delegateToAgentTool,
  workspaceWriteTool,
  workspaceExecuteTool,
  workspaceListTool,
  workspaceReadTool,
  sendEmailTool,
  checkEmailTool,
  searchDocumentsTool,
  suggestGoalTool,
  fetchUrlTool,
  listTodosTool,
  createTodoTool,
  completeTodoTool,
  updateTodoTool,
  formatSearchResultsForContext,
  formatAgentResultForContext,
  type ChatMessage,
} from '../llm/openai.client.js';

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
import * as questionsService from '../autonomous/questions.service.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as searxng from '../search/searxng.client.js';
import * as webfetch from '../search/webfetch.service.js';
import * as agents from '../abilities/agents.service.js';
import * as workspace from '../abilities/workspace.service.js';
import * as sandbox from '../abilities/sandbox.service.js';
import * as emailService from '../abilities/email.service.js';
import * as documents from '../abilities/documents.service.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as memoryService from '../memory/memory.service.js';
import * as preferencesService from '../memory/preferences.service.js';
import * as abilities from '../abilities/orchestrator.js';
import { buildContextualPrompt } from '../persona/luna.persona.js';
import * as sessionService from './session.service.js';
import * as authService from '../auth/auth.service.js';
import logger from '../utils/logger.js';
import { sysmonTools, executeSysmonTool } from '../abilities/sysmon.service.js';
import * as mcpService from '../mcp/mcp.service.js';
import type { Message, SearchResult } from '../types/index.js';

export interface ChatInput {
  sessionId: string;
  userId: string;
  message: string;
  mode: 'assistant' | 'companion' | 'voice';
}

export interface ChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
  searchResults?: SearchResult[];
}

export async function processMessage(input: ChatInput): Promise<ChatOutput> {
  const { sessionId, userId, message, mode } = input;

  // INTENT GATING: Detect if this is smalltalk FIRST
  const isSmallTalkMessage = abilities.isSmallTalk(message);
  const contextOptions = abilities.getContextOptions(message);

  // OPTIMIZED: Run context loading in parallel, but skip heavy loads for smalltalk
  const [
    modelConfig,
    user,
    history,
    memoryContext,
    abilityContext,
    prefGuidelines,
  ] = await Promise.all([
    // Get user's model configuration for main chat
    getUserModelConfig(userId, 'main_chat'),
    // Get user profile for personalization
    authService.getUserById(userId),
    // Get conversation history
    sessionService.getSessionMessages(sessionId, { limit: 20 }),
    // Build memory context - skip for pure smalltalk
    isSmallTalkMessage ? Promise.resolve({ facts: '', relevantHistory: '', conversationContext: '', learnings: '' }) : memoryService.buildMemoryContext(userId, message, sessionId),
    // Build ability context - uses contextOptions for selective loading
    abilities.buildAbilityContext(userId, message, sessionId, contextOptions),
    // Get personalization preferences - lightweight, always load
    preferencesService.getResponseGuidelines(userId),
  ]);

  const userName = user?.displayName || undefined;
  const memoryPrompt = memoryService.formatMemoryForPrompt(memoryContext);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);
  const prefPrompt = preferencesService.formatGuidelinesForPrompt(prefGuidelines);

  // Detect and learn from feedback signals
  const feedbackSignal = preferencesService.detectFeedbackSignals(message);
  if (feedbackSignal.type && feedbackSignal.confidence >= 0.6) {
    preferencesService.learnFromFeedback(userId, sessionId, feedbackSignal.type, message).catch(() => {});
  }

  // Detect ability intent and execute if confident
  const intent = abilities.detectAbilityIntent(message);
  let abilityActionResult: string | undefined;
  if (intent.confidence >= 0.8) {
    const result = await abilities.executeAbilityAction(userId, sessionId, intent, message);
    if (result.handled && result.result) {
      abilityActionResult = `[Action Taken: ${intent.type}]\n${result.result}`;
    }
  }

  // Combine all context
  const fullContext = [memoryPrompt, abilityPrompt, prefPrompt, abilityActionResult].filter(Boolean).join('\n\n');

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: buildContextualPrompt(mode, { userName, memoryContext: fullContext }) },
  ];

  // Add history
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  // Save user message
  const userMessage = await sessionService.addMessage({
    sessionId,
    role: 'user',
    content: message,
  });

  // Store user message embedding (async)
  memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user');

  // TOOL GATING: For smalltalk, don't expose tools at all to prevent eager tool calling
  // Load MCP tools dynamically for this user
  const mcpUserTools = await mcpService.getAllUserTools(userId);
  const mcpToolsForLLM = mcpService.formatMcpToolsForLLM(mcpUserTools.map(t => ({ ...t, serverId: t.serverId })));
  const allTools = [searchTool, delegateToAgentTool, workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool, sendEmailTool, checkEmailTool, searchDocumentsTool, suggestGoalTool, fetchUrlTool, listTodosTool, createTodoTool, completeTodoTool, updateTodoTool, ...sysmonTools, ...mcpToolsForLLM];
  const availableTools = isSmallTalkMessage ? [] : allTools;
  let searchResults: SearchResult[] | undefined;
  let agentResults: Array<{ agent: string; result: string; success: boolean }> = [];

  let completion = await createChatCompletion({
    messages,
    tools: availableTools.length > 0 ? availableTools : undefined,
    provider: modelConfig.provider,
    model: modelConfig.model,
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
        logger.info('Luna checking email', { unreadOnly });
        const emails = unreadOnly
          ? await emailService.getLunaUnreadEmails()
          : await emailService.checkLunaInbox(10);
        if (emails.length > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Found ${emails.length} email(s):\n${emailService.formatLunaInboxForPrompt(emails)}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'No emails found in inbox.',
          } as ChatMessage);
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
        logger.info('Luna creating todo', { title: args.title });
        const parsed = tasksService.parseTaskFromText(args.dueDate || '');
        const todo = await tasksService.createTask(userId, {
          title: args.title,
          description: args.notes,
          priority: args.priority || 'medium',
          dueAt: parsed.dueAt,
          sourceSessionId: sessionId,
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Created todo: "${todo.title}" [${todo.id.slice(0, 8)}]${todo.dueAt ? ` - due: ${new Date(todo.dueAt).toLocaleDateString()}` : ''}`,
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

    // Get final response with tool results in context
    logger.info('Making second completion with tool results', { messageCount: messages.length });
    completion = await createChatCompletion({
      messages,
      provider: modelConfig.provider,
      model: modelConfig.model,
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
    model: modelConfig.model,
    searchResults,
  });

  // Store assistant message embedding (async)
  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, completion.content, 'assistant');

  // Process facts from conversation (async, every few messages)
  const totalMessages = history.length + 2; // +2 for this exchange
  if (totalMessages % 4 === 0) { // Every 4 messages
    const allMessages = [
      ...history.map(m => ({ id: m.id, role: m.role, content: m.content })),
      { id: userMessage.id, role: 'user', content: message },
      { id: assistantMessage.id, role: 'assistant', content: completion.content },
    ];
    memoryService.processConversationMemory(userId, sessionId, allMessages).catch(() => {});
    // Also learn preferences from conversation
    preferencesService.learnFromConversation(userId, sessionId, allMessages).catch(() => {});
  }

  // Update session title if this is the first message
  if (history.length === 0) {
    const title = await sessionService.generateSessionTitle([
      { role: 'user', content: message } as Message,
    ]);
    await sessionService.updateSession(sessionId, userId, { title });
  }

  return {
    messageId: assistantMessage.id,
    content: completion.content,
    tokensUsed: completion.tokensUsed,
    searchResults,
  };
}

export interface StreamMetrics {
  promptTokens: number;
  completionTokens: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  toolsUsed: string[];
  model: string;
}

export async function* streamMessage(
  input: ChatInput
): AsyncGenerator<{ type: 'content' | 'done' | 'status'; content?: string; status?: string; messageId?: string; tokensUsed?: number; metrics?: StreamMetrics }> {
  const { sessionId, userId, message, mode } = input;
  const startTime = Date.now();
  const toolsUsed: string[] = [];

  // INTENT GATING: Detect if this is smalltalk FIRST
  const isSmallTalkMessage = abilities.isSmallTalk(message);
  const contextOptions = abilities.getContextOptions(message);

  if (!isSmallTalkMessage) {
    yield { type: 'status', status: 'Loading context...' };
  }

  // Check if this task needs multi-agent orchestration (never for smalltalk)
  if (!isSmallTalkMessage && agents.needsOrchestration(message)) {
    logger.info('Detected orchestration-worthy task', { message: message.substring(0, 100) });

    // Save user message first
    const userMessage = await sessionService.addMessage({
      sessionId,
      role: 'user',
      content: message,
    });

    // Store user message embedding (async)
    memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user');

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
    history,
    memoryContext,
    abilityContext,
    prefGuidelines,
  ] = await Promise.all([
    // Get user's model configuration for main chat
    getUserModelConfig(userId, 'main_chat'),
    // Get user profile for personalization
    authService.getUserById(userId),
    // Get conversation history
    sessionService.getSessionMessages(sessionId, { limit: 20 }),
    // Build memory context - skip for pure smalltalk
    isSmallTalkMessage ? Promise.resolve({ facts: '', relevantHistory: '', conversationContext: '', learnings: '' }) : memoryService.buildMemoryContext(userId, message, sessionId),
    // Build ability context - uses contextOptions for selective loading
    abilities.buildAbilityContext(userId, message, sessionId, contextOptions),
    // Get personalization preferences - lightweight, always load
    preferencesService.getResponseGuidelines(userId),
  ]);

  if (!isSmallTalkMessage) {
    yield { type: 'status', status: 'Recalling memories...' };
  }

  const userName = user?.displayName || undefined;
  const memoryPrompt = memoryService.formatMemoryForPrompt(memoryContext);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);
  const prefPrompt = preferencesService.formatGuidelinesForPrompt(prefGuidelines);

  // Detect and learn from feedback signals
  const feedbackSignal = preferencesService.detectFeedbackSignals(message);
  if (feedbackSignal.type && feedbackSignal.confidence >= 0.6) {
    preferencesService.learnFromFeedback(userId, sessionId, feedbackSignal.type, message).catch(() => {});
  }

  // Detect ability intent and execute if confident
  const intent = abilities.detectAbilityIntent(message);
  let abilityActionResult: string | undefined;
  if (intent.confidence >= 0.8) {
    yield { type: 'status', status: `Executing ${intent.type} action...` };
    const result = await abilities.executeAbilityAction(userId, sessionId, intent, message);
    if (result.handled && result.result) {
      abilityActionResult = `[Action Taken: ${intent.type}]\n${result.result}`;
    }
  }

  yield { type: 'status', status: 'Thinking...' };

  // Combine all context
  const fullContext = [memoryPrompt, abilityPrompt, prefPrompt, abilityActionResult].filter(Boolean).join('\n\n');

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: buildContextualPrompt(mode, { userName, memoryContext: fullContext }) },
  ];

  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: message });

  // Save user message
  const userMessage = await sessionService.addMessage({
    sessionId,
    role: 'user',
    content: message,
  });

  // Store user message embedding (async)
  memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user');

  // TOOL GATING: For smalltalk, don't expose tools at all to prevent eager tool calling
  // For other messages, provide relevant tools
  // Load MCP tools dynamically for this user
  const mcpUserTools = await mcpService.getAllUserTools(userId);
  const mcpToolsForLLM = mcpService.formatMcpToolsForLLM(mcpUserTools.map(t => ({ ...t, serverId: t.serverId })));
  const allTools = [searchTool, delegateToAgentTool, workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool, sendEmailTool, checkEmailTool, searchDocumentsTool, suggestGoalTool, fetchUrlTool, listTodosTool, createTodoTool, completeTodoTool, updateTodoTool, ...sysmonTools, ...mcpToolsForLLM];
  const availableTools = isSmallTalkMessage ? [] : allTools;
  let searchResults: SearchResult[] | undefined;

  logger.debug('Tool availability', {
    isSmallTalk: isSmallTalkMessage,
    toolsProvided: availableTools.length,
    message: message.slice(0, 50),
  });

  const initialCompletion = await createChatCompletion({
    messages,
    tools: availableTools.length > 0 ? availableTools : undefined,
    provider: modelConfig.provider,
    model: modelConfig.model,
  });

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
        yield { type: 'status', status: `Searching: ${args.query}` };
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
      } else if (toolCall.function.name === 'delegate_to_agent') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'status', status: `Invoking ${args.agent} agent...` };
        logger.info('Delegating to agent in stream', { agent: args.agent, task: args.task?.substring(0, 100) });

        const result = await agents.executeAgentTask(userId, {
          agentName: args.agent,
          task: args.task,
          context: args.context,
        });

        yield { type: 'status', status: `${args.agent} agent completed` };
        logger.info('Agent completed in stream', { agent: args.agent, success: result.success, timeMs: result.executionTimeMs });

        // Add tool result to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: formatAgentResultForContext(args.agent, result.result, result.success),
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_write') {
        const args = JSON.parse(toolCall.function.arguments);
        logger.info('Workspace write tool called (stream)', { userId, filename: args.filename, contentLength: args.content?.length });
        yield { type: 'status', status: `Saving ${args.filename}...` };
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
        yield { type: 'status', status: `Executing ${args.filename}...` };
        const result = await sandbox.executeWorkspaceFile(userId, args.filename, sessionId, args.args || []);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.success
            ? `Execution output:\n${result.output}`
            : `Execution error:\n${result.error}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'workspace_list') {
        yield { type: 'status', status: 'Listing workspace files...' };
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
        yield { type: 'status', status: `Reading ${args.filename}...` };
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
        yield { type: 'status', status: `Sending email to ${args.to}...` };
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
        yield { type: 'status', status: 'Checking inbox...' };
        logger.info('Luna checking email', { unreadOnly });
        const emails = unreadOnly
          ? await emailService.getLunaUnreadEmails()
          : await emailService.checkLunaInbox(10);
        if (emails.length > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Found ${emails.length} email(s):\n${emailService.formatLunaInboxForPrompt(emails)}`,
          } as ChatMessage);
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'No emails found in inbox.',
          } as ChatMessage);
        }
      } else if (toolCall.function.name === 'search_documents') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'status', status: 'Searching documents...' };
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
        yield { type: 'status', status: 'Checking your todos...' };
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
        yield { type: 'status', status: 'Creating todo...' };
        logger.info('Luna creating todo (stream)', { title: args.title });
        const parsed = tasksService.parseTaskFromText(args.dueDate || '');
        const todo = await tasksService.createTask(userId, {
          title: args.title,
          description: args.notes,
          priority: args.priority || 'medium',
          dueAt: parsed.dueAt,
          sourceSessionId: sessionId,
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Created todo: "${todo.title}" [${todo.id.slice(0, 8)}]${todo.dueAt ? ` - due: ${new Date(todo.dueAt).toLocaleDateString()}` : ''}`,
        } as ChatMessage);
      } else if (toolCall.function.name === 'complete_todo') {
        const args = JSON.parse(toolCall.function.arguments);
        yield { type: 'status', status: 'Completing todo...' };
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
        yield { type: 'status', status: 'Updating todo...' };
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
      } else if (toolCall.function.name.startsWith('system_') ||
                 toolCall.function.name.startsWith('network_') ||
                 toolCall.function.name.startsWith('process_') ||
                 toolCall.function.name.startsWith('docker_') ||
                 toolCall.function.name.startsWith('service_') ||
                 toolCall.function.name.startsWith('logs_') ||
                 toolCall.function.name.startsWith('maintenance_')) {
        // System monitoring tools
        const args = JSON.parse(toolCall.function.arguments || '{}');
        yield { type: 'status', status: `Checking ${toolCall.function.name.replace(/_/g, ' ')}...` };
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
          yield { type: 'status', status: `Calling MCP tool ${parsed.toolName}...` };
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

  yield { type: 'status', status: 'Composing response...' };

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
      });

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
          yield { type: 'status', status: `Invoking ${args.agent} agent...` };
          logger.info('Delegating to agent in follow-up', { agent: args.agent, task: args.task?.substring(0, 100) });

          const result = await agents.executeAgentTask(userId, {
            agentName: args.agent,
            task: args.task,
            context: args.context,
          });

          yield { type: 'status', status: `${args.agent} agent completed` };
          logger.info('Agent completed in follow-up', { agent: args.agent, success: result.success });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: formatAgentResultForContext(args.agent, result.result, result.success),
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
          const emails = args.unreadOnly !== false
            ? await emailService.getLunaUnreadEmails()
            : await emailService.checkLunaInbox(10);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: emails.length > 0 ? `Found ${emails.length} email(s):\n${emailService.formatLunaInboxForPrompt(emails)}` : 'No emails found.',
          } as ChatMessage);
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

  // Save assistant response
  const assistantMessage = await sessionService.addMessage({
    sessionId,
    role: 'assistant',
    content: fullContent,
    tokensUsed,
    model: modelConfig.model,
  });

  // Store assistant message embedding (async)
  memoryService.processMessageMemory(userId, sessionId, assistantMessage.id, fullContent, 'assistant');

  // Process facts from conversation (async, every few messages)
  const totalMessages = history.length + 2;
  if (totalMessages % 4 === 0) {
    const allMessages = [
      ...history.map(m => ({ id: m.id, role: m.role, content: m.content })),
      { id: userMessage.id, role: 'user', content: message },
      { id: assistantMessage.id, role: 'assistant', content: fullContent },
    ];
    memoryService.processConversationMemory(userId, sessionId, allMessages).catch(() => {});
    // Also learn preferences from conversation
    preferencesService.learnFromConversation(userId, sessionId, allMessages).catch(() => {});
  }

  // Update session title if first message
  if (history.length === 0) {
    const title = await sessionService.generateSessionTitle([
      { role: 'user', content: message } as Message,
    ]);
    await sessionService.updateSession(sessionId, userId, { title });
  }

  const processingTimeMs = Date.now() - startTime;
  const tokensPerSecond = processingTimeMs > 0 ? (completionTokens / (processingTimeMs / 1000)) : 0;

  yield {
    type: 'done',
    messageId: assistantMessage.id,
    tokensUsed,
    metrics: {
      promptTokens,
      completionTokens,
      processingTimeMs,
      tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
      toolsUsed: [...new Set(toolsUsed)], // dedupe
      model: modelConfig.model,
    },
  };
}

export default { processMessage, streamMessage };
