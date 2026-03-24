/**
 * Movie Grabber - autonomous torrent agent powered by OpenRouter
 *
 * Main chat calls this with just a movie name. The model autonomously:
 * 1. Searches Prowlarr for the best torrent
 * 2. Picks the best result (high seeders, good quality, reasonable size)
 * 3. Sends it to Transmission
 * 4. Reports back ok/failed
 */

import { config } from '../config/index.js';
import * as torrentService from './torrent.service.js';
import logger from '../utils/logger.js';
import OpenAI from 'openai';

const MODEL = 'qwen/qwen3-4b:free';
const MAX_STEPS = 6;

let openrouterClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openrouterClient) {
    openrouterClient = new OpenAI({
      apiKey: config.openrouter?.apiKey || '',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://luna-chat.bitwarelabs.com',
        'X-Title': 'Luna Chat',
      },
    });
  }
  return openrouterClient;
}

// Tools the model can use
const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'torrent_search',
      description: 'Search for torrents. Returns results with title, size, seeders, guid, and indexerId.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g. "Dune Part Two 2024 1080p", "The Bear S03")' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'torrent_download',
      description: 'Send a torrent to Transmission for download. Use guid and indexerId from torrent_search results.',
      parameters: {
        type: 'object',
        properties: {
          guid: { type: 'string', description: 'The guid from the search result' },
          indexerId: { type: 'number', description: 'The indexerId from the search result' },
          title: { type: 'string', description: 'Title for logging' },
        },
        required: ['guid', 'indexerId', 'title'],
      },
    },
  },
];

async function executeAgentTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'torrent_search') {
    const results = await torrentService.searchProwlarr(args.query as string);
    if (results.length === 0) return `No results found for "${args.query}".`;
    const top = results.slice(0, 10);
    return top.map((r, i) =>
      `${i + 1}. ${r.title} [${r.category}] - ${r.sizeHuman}, ${r.seeders} seeders | guid: ${r.guid} | indexerId: ${r.indexerId}`
    ).join('\n');
  }

  if (name === 'torrent_download') {
    await torrentService.grabTorrent(args.guid as string, args.indexerId as number);
    return `OK - "${args.title}" sent to Transmission.`;
  }

  return `Unknown tool: ${name}`;
}

export async function grabMovie(movieName: string, preferences?: string): Promise<{ ok: boolean; message: string }> {
  logger.info('Movie grabber starting', { movieName, preferences });

  const systemPrompt = `You are a torrent search agent. Your job is to find and download a movie/show the user wants.

STEPS:
1. Use torrent_search to find the content. Try adding quality terms like "1080p" or "2160p" for movies.
2. Pick the BEST result: prefer high seeders, 1080p/2160p quality, reasonable file size (1-8 GB for movies).
3. Use torrent_download with the guid and indexerId of your chosen result.
4. Report what you downloaded.

RULES:
- Do NOT ask the user for clarification. Just pick the best match.
- If first search has no good results, try a different search query.
- Prefer movie category results over other categories.
- Always pick a result with at least 5 seeders if possible.
- Pay attention to user preferences in parentheses (quality, codec, size constraints).
- After downloading, respond with a brief summary of what you grabbed.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: preferences ? `Download: ${movieName} (${preferences})` : `Download: ${movieName}` },
  ];

  let downloadedTitle = '';
  const client = getClient();

  for (let step = 0; step < MAX_STEPS; step++) {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: AGENT_TOOLS,
        temperature: 0.3,
      });
    } catch (err) {
      logger.error('Movie grabber LLM call failed', { step, error: (err as Error).message });
      return { ok: false, message: `LLM error: ${(err as Error).message}` };
    }

    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, message: 'LLM returned no choices.' };
    }

    const assistantMsg = choice.message;

    // If the model returned tool calls, execute them
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      messages.push(assistantMsg);

      for (const tc of assistantMsg.tool_calls) {
        const toolName = tc.function.name;
        const toolArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        logger.info('Movie grabber tool call', { step, tool: toolName, args: toolArgs });

        try {
          const result = await executeAgentTool(toolName, toolArgs);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });

          if (toolName === 'torrent_download' && result.startsWith('OK')) {
            downloadedTitle = (toolArgs.title as string) || movieName;
          }
        } catch (err) {
          const errMsg = (err as Error).message;
          logger.error('Movie grabber tool error', { tool: toolName, error: errMsg });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${errMsg}` });
        }
      }
      continue;
    }

    // No tool calls - model is done, return its final message
    const finalMessage = assistantMsg.content || '';
    logger.info('Movie grabber complete', { movieName, steps: step + 1, downloaded: !!downloadedTitle });

    if (downloadedTitle) {
      return { ok: true, message: finalMessage || `Downloaded: ${downloadedTitle}` };
    }

    // Model gave up without downloading
    return { ok: false, message: finalMessage || 'Could not find a suitable torrent.' };
  }

  // Hit max steps
  if (downloadedTitle) {
    return { ok: true, message: `Downloaded: ${downloadedTitle}` };
  }
  return { ok: false, message: 'Reached maximum steps without completing download.' };
}
