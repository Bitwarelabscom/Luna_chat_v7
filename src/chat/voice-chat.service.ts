/**
 * Voice Chat Service
 *
 * A separate chat service for Voice Luna - focused on fast, conversational responses.
 * NO access to user memories, personality, email, calendar, or heavy tools.
 *
 * This service bypasses the layered agent for ~3-5 second response times
 * (vs 30+ seconds with the layered agent).
 */

import {
  createChatCompletion,
  type ChatMessage,
} from '../llm/openai.client.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import { getVoicePrompt } from '../persona/voice.persona.js';
import { search as searxngSearch } from '../search/searxng.client.js';
import { fetchPage } from '../search/webfetch.service.js';
import { pool as db } from '../db/index.js';
import logger from '../utils/logger.js';

// Voice-specific tools - minimal set for fast responses
const webSearchTool = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for current information, news, facts, or answers to questions',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },
};

const fetchUrlTool = {
  type: 'function' as const,
  function: {
    name: 'fetch_url',
    description: 'Fetch and read content from a specific URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch content from',
        },
      },
      required: ['url'],
    },
  },
};

const voiceTools = [webSearchTool, fetchUrlTool];

export interface VoiceChatInput {
  sessionId: string;
  userId: string;
  message: string;
}

export interface VoiceChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
}

/**
 * Get or create a voice session for the user
 */
export async function getOrCreateVoiceSession(userId: string): Promise<string> {
  // Check for existing active session (from last 24 hours)
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM voice_sessions
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new session
  const result = await db.query<{ id: string }>(
    `INSERT INTO voice_sessions (id, user_id)
     VALUES (gen_random_uuid(), $1)
     RETURNING id`,
    [userId]
  );

  return result.rows[0].id;
}

/**
 * Get voice session messages
 */
export async function getSessionMessages(
  sessionId: string,
  limit = 10
): Promise<Array<{ role: string; content: string }>> {
  const result = await db.query<{ role: string; content: string }>(
    `SELECT role, content FROM voice_messages
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return result.rows.reverse();
}

/**
 * Add message to voice session
 */
async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO voice_messages (id, session_id, role, content)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING id`,
    [sessionId, role, content]
  );

  return result.rows[0].id;
}

/**
 * Get user name for personalization (optional)
 */
async function getUserName(userId: string): Promise<string | null> {
  try {
    const result = await db.query<{ display_name: string | null }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.display_name || null;
  } catch {
    return null;
  }
}

/**
 * Process a voice chat message
 *
 * This is the fast path - direct LLM call without layered agent
 */
export async function processMessage(input: VoiceChatInput): Promise<VoiceChatOutput> {
  const { sessionId, userId, message } = input;
  const startTime = Date.now();

  // Get model config (use fast model for voice)
  const modelConfig = await getUserModelConfig(userId, 'fast_llm');

  // Get user name for personalization
  const userName = await getUserName(userId);

  // Build system prompt
  const systemPrompt = getVoicePrompt({
    userName: userName || undefined,
  });

  // Get conversation history (only 10 messages for speed)
  const history = await getSessionMessages(sessionId, 10);

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add history
  for (const msg of history) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  // Save user message
  await addMessage(sessionId, 'user', message);

  // Call LLM with voice tools
  let completion = await createChatCompletion({
    messages,
    tools: voiceTools,
    provider: modelConfig.provider,
    model: modelConfig.model,
    maxTokens: 300, // Short responses for voice
    temperature: 0.7,
  });

  // Handle tool calls - max 2 iterations for speed
  let toolCallIterations = 0;
  const maxToolCallIterations = 2;

  while (completion.toolCalls && completion.toolCalls.length > 0 && toolCallIterations < maxToolCallIterations) {
    toolCallIterations++;

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls,
    } as ChatMessage);

    for (const toolCall of completion.toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      let toolResult: string;

      try {
        switch (toolCall.function.name) {
          case 'web_search': {
            const query = args.query as string;
            if (!query) {
              toolResult = 'Error: search query is required';
              break;
            }

            const searchResults = await searxngSearch(query, {
              engines: ['google', 'bing', 'duckduckgo'],
              categories: ['general', 'news'],
              maxResults: 3, // Only 3 for speed
            });

            if (searchResults.length === 0) {
              toolResult = `No results found for "${query}"`;
            } else {
              // Format concisely for voice
              toolResult = searchResults.map((r, i) =>
                `${i + 1}. ${r.title}: ${r.snippet || 'No description'}`
              ).join('\n');
            }
            break;
          }

          case 'fetch_url': {
            const url = args.url as string;
            if (!url) {
              toolResult = 'Error: URL is required';
              break;
            }

            try {
              const page = await fetchPage(url, { timeout: 5000 }); // 5s timeout for speed
              // Truncate content for voice context
              const truncatedContent = page.content.slice(0, 2000);
              toolResult = `Title: ${page.title || 'No title'}\n\nContent: ${truncatedContent}`;
            } catch (error) {
              toolResult = `Failed to fetch URL: ${(error as Error).message}`;
            }
            break;
          }

          default:
            toolResult = `Unknown tool: ${toolCall.function.name}`;
        }
      } catch (error) {
        logger.error('Voice tool error', {
          tool: toolCall.function.name,
          error: (error as Error).message,
        });
        toolResult = `Error: ${(error as Error).message}`;
      }

      // Add tool result to conversation
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      } as ChatMessage);
    }

    // Get response after tool execution
    completion = await createChatCompletion({
      messages,
      tools: voiceTools,
      provider: modelConfig.provider,
      model: modelConfig.model,
      maxTokens: 300,
      temperature: 0.7,
    });
  }

  // Handle empty response
  let responseContent = completion.content;
  if (!responseContent || responseContent.trim() === '') {
    logger.warn('Empty response from voice LLM', { sessionId, userId, toolCallIterations });
    responseContent = toolCallIterations > 0
      ? "I found some information but couldn't summarize it properly. Could you rephrase your question?"
      : "I'm not sure what to say to that. Could you try asking differently?";
  }

  // Save assistant response
  const assistantMessageId = await addMessage(sessionId, 'assistant', responseContent);

  const elapsed = Date.now() - startTime;
  logger.info('Voice message processed', {
    sessionId,
    userId,
    elapsed,
    toolCalls: toolCallIterations,
    tokens: completion.tokensUsed,
  });

  return {
    messageId: assistantMessageId,
    content: responseContent,
    tokensUsed: completion.tokensUsed || 0,
  };
}

/**
 * Delete a voice session and all its messages
 */
export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM voice_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
