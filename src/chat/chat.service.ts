import {
  createChatCompletion,
  streamChatCompletion,
  searchTool,
  delegateToAgentTool,
  workspaceWriteTool,
  workspaceExecuteTool,
  workspaceListTool,
  workspaceReadTool,
  formatSearchResultsForContext,
  formatAgentResultForContext,
  type ChatMessage,
} from '../llm/openai.client.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as searxng from '../search/searxng.client.js';
import * as agents from '../abilities/agents.service.js';
import * as workspace from '../abilities/workspace.service.js';
import * as sandbox from '../abilities/sandbox.service.js';
import * as memoryService from '../memory/memory.service.js';
import * as abilities from '../abilities/orchestrator.js';
import { buildContextualPrompt } from '../persona/luna.persona.js';
import * as sessionService from './session.service.js';
import * as authService from '../auth/auth.service.js';
import logger from '../utils/logger.js';
import type { Message, SearchResult } from '../types/index.js';

export interface ChatInput {
  sessionId: string;
  userId: string;
  message: string;
  mode: 'assistant' | 'companion';
}

export interface ChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
  searchResults?: SearchResult[];
}

export async function processMessage(input: ChatInput): Promise<ChatOutput> {
  const { sessionId, userId, message, mode } = input;

  // Get user's model configuration for main chat
  const modelConfig = await getUserModelConfig(userId, 'main_chat');

  // Get user profile for personalization
  const user = await authService.getUserById(userId);
  const userName = user?.displayName || undefined;

  // Get conversation history
  const history = await sessionService.getSessionMessages(sessionId, { limit: 20 });

  // Build memory context (facts + semantic search)
  const memoryContext = await memoryService.buildMemoryContext(userId, message, sessionId);
  const memoryPrompt = memoryService.formatMemoryForPrompt(memoryContext);

  // Build ability context (tasks, calendar, knowledge, mood, etc.)
  const abilityContext = await abilities.buildAbilityContext(userId, message, sessionId);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);

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
  const fullContext = [memoryPrompt, abilityPrompt, abilityActionResult].filter(Boolean).join('\n\n');

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

  // First completion - check if tools are needed
  const availableTools = [searchTool, delegateToAgentTool, workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool];
  let searchResults: SearchResult[] | undefined;
  let agentResults: Array<{ agent: string; result: string; success: boolean }> = [];

  let completion = await createChatCompletion({
    messages,
    tools: availableTools,
    provider: modelConfig.provider,
    model: modelConfig.model,
  });

  // Handle tool calls using proper tool calling flow
  if (completion.toolCalls && completion.toolCalls.length > 0) {
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
        try {
          const file = await workspace.writeFile(userId, args.filename, args.content);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `File "${args.filename}" saved successfully (${file.size} bytes)`,
          } as ChatMessage);
        } catch (error) {
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

export async function* streamMessage(
  input: ChatInput
): AsyncGenerator<{ type: 'content' | 'done' | 'status'; content?: string; status?: string; messageId?: string; tokensUsed?: number }> {
  const { sessionId, userId, message, mode } = input;

  yield { type: 'status', status: 'Loading context...' };

  // Check if this task needs multi-agent orchestration
  if (agents.needsOrchestration(message)) {
    logger.info('Detected orchestration-worthy task', { message: message.substring(0, 100) });

    // Save user message first
    const userMessage = await sessionService.addMessage({
      sessionId,
      role: 'user',
      content: message,
    });

    // Store user message embedding (async)
    memoryService.processMessageMemory(userId, sessionId, userMessage.id, message, 'user');

    // Execute orchestration with streaming status updates
    let orchestrationResult: agents.OrchestrationResult | null = null;

    for await (const event of agents.orchestrateTaskStream(userId, message)) {
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

    yield { type: 'done', messageId: assistantMessage.id, tokensUsed: 0 };
    return;
  }

  // Get user's model configuration for main chat
  const modelConfig = await getUserModelConfig(userId, 'main_chat');

  // Get user profile for personalization
  const user = await authService.getUserById(userId);
  const userName = user?.displayName || undefined;

  // Get conversation history
  const history = await sessionService.getSessionMessages(sessionId, { limit: 20 });

  yield { type: 'status', status: 'Recalling memories...' };

  // Build memory context (facts + semantic search)
  const memoryContext = await memoryService.buildMemoryContext(userId, message, sessionId);
  const memoryPrompt = memoryService.formatMemoryForPrompt(memoryContext);

  // Build ability context (tasks, calendar, knowledge, mood, etc.)
  const abilityContext = await abilities.buildAbilityContext(userId, message, sessionId);
  const abilityPrompt = abilities.formatAbilityContextForPrompt(abilityContext);

  yield { type: 'status', status: 'Thinking...' };

  // Combine all context
  const fullContext = [memoryPrompt, abilityPrompt].filter(Boolean).join('\n\n');

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

  // First, check if tools are needed (non-streaming call with tools)
  const availableTools = [searchTool, delegateToAgentTool, workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool];
  let searchResults: SearchResult[] | undefined;

  const initialCompletion = await createChatCompletion({
    messages,
    tools: availableTools,
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
        yield { type: 'status', status: `Saving ${args.filename}...` };
        try {
          const file = await workspace.writeFile(userId, args.filename, args.content);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `File "${args.filename}" saved successfully (${file.size} bytes)`,
          } as ChatMessage);
        } catch (error) {
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
      }
    }
  }

  yield { type: 'status', status: 'Composing response...' };

  // Stream completion (with search results if any)
  let fullContent = '';
  let tokensUsed = 0;

  for await (const chunk of streamChatCompletion({
    messages,
    provider: modelConfig.provider,
    model: modelConfig.model,
  })) {
    if (chunk.content) {
      fullContent += chunk.content;
      yield { type: 'content', content: chunk.content };
    }
    if (chunk.done) {
      tokensUsed = chunk.tokensUsed || 0;
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
  }

  // Update session title if first message
  if (history.length === 0) {
    const title = await sessionService.generateSessionTitle([
      { role: 'user', content: message } as Message,
    ]);
    await sessionService.updateSession(sessionId, userId, { title });
  }

  yield { type: 'done', messageId: assistantMessage.id, tokensUsed };
}

export default { processMessage, streamMessage };
