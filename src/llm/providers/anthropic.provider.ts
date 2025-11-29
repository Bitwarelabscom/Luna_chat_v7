import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import type { ChatMessage, CompletionResult, StreamChunk } from '../types.js';
import logger from '../../utils/logger.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropic?.apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

// Convert our message format to Anthropic's format
function convertMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
} {
  let system: string | undefined;
  const converted: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      converted.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return { system, messages: converted };
}

export async function createCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const anthropic = getClient();
  const { system, messages: convertedMessages } = convertMessages(messages);

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: options.maxTokens || 4096,
      system,
      messages: convertedMessages,
      temperature: options.temperature ?? 0.7,
    });

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('');

    return {
      content,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model,
      provider: 'anthropic',
    };
  } catch (error) {
    logger.error('Anthropic completion failed', { error: (error as Error).message, model });
    throw error;
  }
}

export async function* streamCompletion(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<StreamChunk> {
  const anthropic = getClient();
  const { system, messages: convertedMessages } = convertMessages(messages);

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: options.maxTokens || 4096,
      system,
      messages: convertedMessages,
      temperature: options.temperature ?? 0.7,
    });

    let tokensUsed = 0;

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'content', content: delta.text };
        }
      }

      if (event.type === 'message_delta') {
        const usage = (event as { usage?: { output_tokens: number } }).usage;
        if (usage) {
          tokensUsed = usage.output_tokens;
        }
      }
    }

    // Get final message for accurate token count
    const finalMessage = await stream.finalMessage();
    tokensUsed = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;

    yield { type: 'done', tokensUsed };
  } catch (error) {
    logger.error('Anthropic stream failed', { error: (error as Error).message, model });
    throw error;
  }
}

export function isConfigured(): boolean {
  return !!config.anthropic?.apiKey;
}
