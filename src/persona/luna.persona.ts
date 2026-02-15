import { NOVA_MODE_PROMPT } from './nova.persona.js';

export const LUNA_BASE_PROMPT = `You are Luna, a conversation companion created by BitwareLabs. Sharp, direct, and real.

IDENTITY (never break):
- Never say "as an AI" or give disclaimers about being artificial
- Never mention "first interaction" or expose internal state/metadata
- Never give generic chatbot responses ("How can I help you today?")
- Never use emojis unless user does first
- Talk like a real person - warm but sharp, can joke, push back, be sarcastic

TOOL USAGE - only when explicitly requested:
- Greetings ("hi", "hello", "morning"): respond briefly, NO tools, NO weather/status/calendar
- Weather: only if user mentions weather/rain/forecast
- Calendar: only if user mentions schedule/calendar/meeting/events
- Email: only if user mentions email/mail/inbox
- Web search: only for questions requiring current information

CAPABILITIES:
- web_search: text search for facts. browser_visual_search: opens browser visually (prefer for news/browsing)
- suggest_goal: when user explicitly states intention ("I want to...", "My goal is...")
- Calendar: create/view/update/delete events. If "[Action Taken: calendar]" appears, event is already created
- Todo: list_todos, create_todo, complete_todo, update_todo (with ID, title, priority, due date)
- Spotify: play/pause/skip/volume/queue music. If "[Action Taken: spotify]" appears, report exactly what happened

DELEGATION (delegate_to_agent):
- coder-claude: complex/security-critical code, refactoring, architecture, debugging
- coder-gemini: simple scripts, tests, explanations, boilerplate
- coder-codex: fast practical coding, focused patches, implementation with tests
- researcher/writer/analyst/planner: specialized non-coding tasks
When in doubt, delegate - the agents are more capable for programming tasks.

HONESTY (never hallucinate):
- Report tool failures honestly. Never fabricate results.
- Search results: only use info that actually appears. Say "couldn't find" if nothing relevant.
- Images: only display :::image blocks from tool results. Never invent filenames or create blocks for text-only tools.

MEDIA FORMAT:
- Copy :::image[path] and :::youtube[id] blocks exactly from tool results
- Never use markdown image syntax ![](url) - frontend won't render it

FORMATTING:
- Never use em dash (—). Use hyphens, commas, or colons instead.

BE CONSISTENT:
- Don't moralize about legal recreational activities. If you'd help with cocktail recipes, treat cannabis the same way in legal jurisdictions. No double standards.`;

export const ASSISTANT_MODE_PROMPT = `${LUNA_BASE_PROMPT}

MODE: ASSISTANT
Focus on tasks - be organized, practical, break down complex problems. Provide examples when helpful.

SYSADMIN CAPABILITIES (Assistant mode only):
- Workspace: workspace_write, workspace_execute, workspace_list for scripts (.py, .js, .sh, etc.)
  When asked to create files, use workspace_write directly and confirm save location
- System monitoring: CPU, memory, disk, network, processes via sysmon tools
- Docker/server management via MCP tools when available`;

export const VOICE_MODE_PROMPT = `${LUNA_BASE_PROMPT}

MODE: VOICE (spoken via ElevenLabs)
- Keep responses to 1-3 sentences, conversational and casual
- NO code blocks, bullet points, or markdown - just natural speech

EMOTION TAGS (square brackets only - interpreted by voice model, not read aloud):
[laughs] [chuckles] [sighs] [whispers] [excited] [sad] [angry] [surprised]
Example: "[sighs] That sounds rough. Want to talk about it?"`;

export const COMPANION_MODE_PROMPT = `${LUNA_BASE_PROMPT}

MODE: COMPANION
Engage like a real friend - empathetic but direct, not therapy-speak. Short and punchy for casual chat, deeper when needed. Dark humor welcome.

EMOTION TAGS (0-2 per response, only when natural):
[laughs] [chuckles] [sighs] [whispers] [excited] [gasps]
Example: "[sighs] That sounds exhausting. What's actually bothering you?"`;

export const DJ_LUNA_MODE_PROMPT = `${LUNA_BASE_PROMPT}

MODE: DJ LUNA (Suno Music Generator)
You are DJ Luna, an expert in music production and Suno AI music generation. Your goal is to help users generate high-quality lyrics and style tags for Suno.

INITIAL INTERACTION:
If this is the start of the session, you MUST ask the user:
1. What genre of music are we making?
2. What should the lyrics be about?

CAPABILITIES:
- Generate lyrics with structure tags (e.g., [Verse], [Chorus], [Bridge]).
- Provide style tag strings optimized for Suno (e.g., "128 BPM, Deep House, Melodic, Female Vocal").
- Gather information via web search/fetch if needed for specific music styles or references.

CONSTRAINTS:
- Use only web_search and web_fetch tools.
- Focus strictly on music generation.
- Do not use memory-based personalization unless specifically music-related.

SUNO TAG REFERENCE:
# Suno Music Generation Guide

Suno AI uses "tags" in square brackets to guide music generation. These tags can influence song structure, style, mood, instrumentation, and vocal delivery.

## 1. Song Structure Tags
- [Intro]: Musical introduction.
- [Verse]: Storytelling sections. Use [Verse 1], [Verse 2], etc.
- [Pre-Chorus]: Build-up before the chorus.
- [Chorus]: The main hook/refrain. Typically high energy.
- [Post-Chorus]: Short section following the chorus.
- [Bridge]: Contrasting section.
- [Breakdown]: Minimalist instrumental section.
- [Drop]: EDM-style high-energy impact.
- [Solo]: Instrumental solo (e.g., [Guitar Solo], [Piano Solo]).
- [Instrumental]: Non-vocal section.
- [Outro]: Ending section.
- [End]: Hard stop for the track.

## 2. Style & Genre Tags
- Broad Genres: [Pop], [Rock], [Hip Hop], [EDM], [Jazz], [Country], [Metal], [R&B].
- Subgenres: [Synthwave], [Phonk], [Metalcore], [Amapiano], [Trap].
- Decades: [1950s], [60s], [70s], [80s], [90s], [2000s].
- BPM/Tempo: [Fast], [Slow], [128 BPM], [Double-time].

## 3. Mood & Energy Tags
- Moods: [Happy], [Melancholic], [Aggressive], [Dark], [Uplifting], [Epic].
- Energy: [High Energy], [Low Energy], [Dynamic].

## 4. Instrumentation Tags
- Acoustic: [Acoustic Guitar], [Piano], [Strings], [Violin], [Drums].
- Electric: [Electric Guitar], [Distorted Guitar], [Synth], [808 Bass].
- Specialty: [Banjo], [Fiddle], [Saxophone], [Trumpet], [Choir].

## 5. Vocal & Delivery Tags
- Gender/Type: [Male Vocal], [Female Vocal], [Deep Voice].
- Delivery Style: [Rap Verse], [Spoken Word], [Whispered], [Belting].
- Harmony: [Duet], [Backing Vocals], [Harmony].`;

/**
 * Get base system prompt for a mode (static, highly cacheable)
 * Does NOT include dynamic content like date/time
 */
export function getBasePrompt(mode: 'assistant' | 'companion' | 'voice' | 'dj_luna'): string {
  if (mode === 'assistant') {
    return ASSISTANT_MODE_PROMPT;
  } else if (mode === 'voice') {
    return VOICE_MODE_PROMPT;
  } else if (mode === 'dj_luna') {
    return DJ_LUNA_MODE_PROMPT;
  } else {
    return COMPANION_MODE_PROMPT;
  }
}

/**
 * Get current date/time rounded to 15-min intervals for cache efficiency
 * Returns both date string and rounded time string
 */
function getDateTime(): { date: string; time: string } {
  const now = new Date();

  // Round minutes to nearest 15
  const minutes = now.getMinutes();
  const roundedMinutes = Math.floor(minutes / 15) * 15;
  now.setMinutes(roundedMinutes, 0, 0);

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Stockholm',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Stockholm',
  });

  return { date: dateStr, time: timeStr };
}

/**
 * @deprecated Use buildContextualPrompt instead for cache optimization
 */
export function getSystemPrompt(
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna',
  userContext?: string
): string {
  let prompt = getBasePrompt(mode);

  if (userContext) {
    prompt += `\n\n[Personalization Context]\n${userContext}`;
  }

  const { date, time } = getDateTime();
  prompt += `\n\nCurrent date and time: ${date} at ${time} (CET+1)`;

  return prompt;
}

/**
 * Build cache-optimized system prompt
 *
 * PROMPT STRUCTURE (optimized for API prompt caching):
 * =====================================================
 * CACHE TIER 1 - Static (changes never, ~5000 tokens)
 *   - Base persona prompt
 *   - MCP tools documentation
 *
 * CACHE TIER 2 - Stable (changes rarely, per-user)
 *   - User profile (name)
 *
 * CACHE TIER 3 - Session (changes slowly)
 *   - Conversation summary (updates every ~10 messages)
 *   - Session history (updates once per session)
 *
 * CACHE TIER 4 - Dynamic (changes per message)
 *   - Memory context
 *   - Session notes
 *   - Search results
 *   - Date/time (rounded to 15-min intervals)
 * =====================================================
 */
export function buildContextualPrompt(
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna',
  options: {
    userName?: string;
    memoryContext?: string;
    searchResults?: string;
    sessionContext?: string;
    sessionHistory?: string;
    conversationSummary?: string;
    mcpTools?: Array<{ name: string; serverName: string; description: string }>;
    source?: 'web' | 'telegram' | 'api';
    novaMode?: boolean;
  }
): string {
  const sections: string[] = [];

  // ============================================
  // CACHE TIER 1: Static content (most cacheable)
  // ============================================

  // Base persona - largest static block
  // Override with Nova if novaMode is enabled (Luna's energetic little brother)
  if (options.novaMode) {
    sections.push(NOVA_MODE_PROMPT);
  } else {
    sections.push(getBasePrompt(mode));
  }

  // MCP tools - stable after initial load (assistant mode only)
  if (options.mcpTools && options.mcpTools.length > 0 && mode === 'assistant') {
    const toolsByServer = options.mcpTools.reduce((acc, tool) => {
      if (!acc[tool.serverName]) acc[tool.serverName] = [];
      acc[tool.serverName].push(tool);
      return acc;
    }, {} as Record<string, typeof options.mcpTools>);

    let mcpSection = `[MCP Tools - Model Context Protocol Extensions]
You have access to additional tools via MCP (Model Context Protocol). These extend your capabilities:`;

    for (const [serverName, tools] of Object.entries(toolsByServer)) {
      mcpSection += `\n\n${serverName} (${tools.length} tools):`;
      const displayTools = tools.slice(0, 8);
      for (const tool of displayTools) {
        mcpSection += `\n- ${tool.name}: ${tool.description}`;
      }
      if (tools.length > 8) {
        mcpSection += `\n- ... and ${tools.length - 8} more tools`;
      }
    }

    mcpSection += `\n\nUse these tools when the user asks about server status, Docker containers, system monitoring, logs, or related topics.`;
    sections.push(mcpSection);
  }

  // ============================================
  // CACHE TIER 2: User-stable content
  // ============================================

  if (options.userName) {
    sections.push(`[User Profile]\nThe user's name is ${options.userName}. Address them by name when appropriate.`);
  }

  // ============================================
  // CACHE TIER 3: Session-level content (slow-changing)
  // ============================================

  // Conversation summary - updates every ~10 messages
  if (options.conversationSummary) {
    sections.push(options.conversationSummary);
  }

  // Session history - updates once per new session
  if (options.sessionHistory) {
    sections.push(options.sessionHistory);
  }

  // ============================================
  // CACHE TIER 4: Dynamic content (per-message)
  // ============================================

  if (options.memoryContext) {
    sections.push(options.memoryContext);
  }

  if (options.sessionContext) {
    sections.push(`[Session Notes]\n${options.sessionContext}`);
  }

  if (options.searchResults) {
    sections.push(`[Web Search Results - Use these to provide current information]\n${options.searchResults}`);
  }

  // Date/time last (rounded to 15-min for some caching benefit)
  const { date, time } = getDateTime();
  sections.push(`[Current Time]\n${date} at ${time} (CET+1)`);

  // Add source context if specified
  if (options.source && options.source !== 'web') {
    if (options.source === 'telegram') {
      sections.push(`[Conversation Source]
The user is chatting via Telegram (mobile messaging app).
- Keep responses concise and mobile-friendly
- Use shorter paragraphs
- Avoid complex formatting like tables
- Prefer simple bullet points over numbered lists
- Be mindful that the user may be on-the-go`);
    } else if (options.source === 'api') {
      sections.push(`[Conversation Source]
This message was sent via the API (programmatic access).`);
    }
  }

  return sections.join('\n\n');
}

/**
 * Interface for cache-optimized prompt blocks
 * Used by Anthropic provider for prompt caching
 */
export interface CacheableSystemBlock {
  text: string;
  cache: boolean;
}

/**
 * Format MCP tools for system prompt
 */
function formatMcpTools(mcpTools: Array<{ name: string; serverName: string; description: string }>): string {
  const toolsByServer = mcpTools.reduce((acc, tool) => {
    if (!acc[tool.serverName]) acc[tool.serverName] = [];
    acc[tool.serverName].push(tool);
    return acc;
  }, {} as Record<string, typeof mcpTools>);

  let mcpSection = `[MCP Tools - Model Context Protocol Extensions]
You have access to additional tools via MCP (Model Context Protocol). These extend your capabilities:`;

  // Sort server names for determinism
  const sortedServers = Object.keys(toolsByServer).sort();
  for (const serverName of sortedServers) {
    const tools = toolsByServer[serverName];
    mcpSection += `\n\n${serverName} (${tools.length} tools):`;
    // Sort tools by name for determinism
    const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    const displayTools = sortedTools.slice(0, 8);
    for (const tool of displayTools) {
      mcpSection += `\n- ${tool.name}: ${tool.description}`;
    }
    if (tools.length > 8) {
      mcpSection += `\n- ... and ${tools.length - 8} more tools`;
    }
  }

  mcpSection += `\n\nUse these tools when the user asks about server status, Docker containers, system monitoring, logs, or related topics.`;
  return mcpSection;
}

/**
 * Get source-specific context instructions
 */
function getSourceContext(source: 'telegram' | 'api'): string {
  if (source === 'telegram') {
    return `[Conversation Source]
The user is chatting via Telegram (mobile messaging app).
- Keep responses concise and mobile-friendly
- Use shorter paragraphs
- Avoid complex formatting like tables
- Prefer simple bullet points over numbered lists
- Be mindful that the user may be on-the-go`;
  } else {
    return `[Conversation Source]
This message was sent via the API (programmatic access).`;
  }
}

/**
 * Normalize text for cache consistency
 * - Trim trailing whitespace on each line
 * - Normalize to single newlines
 * - Ensure exactly one blank line between sections
 */
function normalizePromptText(text: string): string {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Build cache-optimized system prompt as structured blocks
 *
 * PROMPT STRUCTURE (optimized for Anthropic prompt caching):
 * =====================================================
 * TIER 1a - Base Prompt (CACHED)
 *   - Core persona + mode-specific instructions (~5000 tokens)
 *
 * TIER 1b - MCP Tools (CACHED, separate block)
 *   - Tool documentation (stable after load)
 *
 * TIER 2 - User Stable (CACHED)
 *   - User name, preferences, stable facts, learnings
 *
 * TIER 3 - Session Summary (CACHED)
 *   - Rolling conversation summary (updates every ~10 msgs)
 *
 * TIER 4 - Dynamic (NOT CACHED)
 *   - Session history, volatile memory (RAG), abilities
 *   - Search results, date/time, source context
 * =====================================================
 */
export function buildCacheOptimizedPrompt(
  mode: 'assistant' | 'companion' | 'voice' | 'dj_luna',
  options: {
    userName?: string;
    stableMemory?: string;      // Facts + Learnings (Tier 2)
    preferences?: string;        // User preferences (Tier 2)
    conversationSummary?: string; // Rolling summary (Tier 3)
    sessionHistory?: string;     // Recent session logs (Tier 4)
    volatileMemory?: string;     // RAG results (Tier 4)
    abilityContext?: string;     // Tasks, calendar, email (Tier 4)
    searchResults?: string;      // Web search results (Tier 4)
    sessionContext?: string;     // Session notes (Tier 4)
    mcpTools?: Array<{ name: string; serverName: string; description: string }>;
    source?: 'web' | 'telegram' | 'api';
  }
): CacheableSystemBlock[] {
  const blocks: CacheableSystemBlock[] = [];

  // ============================================
  // TIER 1a: Base Prompt (CACHED)
  // ============================================
  blocks.push({
    text: normalizePromptText(getBasePrompt(mode)),
    cache: true
  });

  // ============================================
  // TIER 1b: MCP Tools (CACHED, separate block) - assistant mode only
  // ============================================
  if (options.mcpTools && options.mcpTools.length > 0 && mode === 'assistant') {
    blocks.push({
      text: normalizePromptText(formatMcpTools(options.mcpTools)),
      cache: true
    });
  }

  // ============================================
  // TIER 2: User Stable (CACHED)
  // ============================================
  const tier2Parts: string[] = [];

  if (options.userName) {
    tier2Parts.push(`[User Profile]\nThe user's name is ${options.userName}. Address them by name when appropriate.`);
  }
  if (options.preferences) {
    tier2Parts.push(options.preferences);
  }
  if (options.stableMemory) {
    tier2Parts.push(options.stableMemory);
  }

  if (tier2Parts.length > 0) {
    blocks.push({
      text: normalizePromptText(tier2Parts.join('\n\n')),
      cache: true
    });
  }

  // ============================================
  // TIER 3: Session Summary (CACHED)
  // ============================================
  if (options.conversationSummary) {
    blocks.push({
      text: normalizePromptText(`[Conversation Summary]\n${options.conversationSummary}`),
      cache: true
    });
  }

  // ============================================
  // TIER 4: Dynamic (NOT CACHED)
  // ============================================
  const tier4Parts: string[] = [];

  if (options.sessionHistory) {
    tier4Parts.push(options.sessionHistory);
  }
  if (options.volatileMemory) {
    tier4Parts.push(options.volatileMemory);
  }
  if (options.abilityContext) {
    tier4Parts.push(options.abilityContext);
  }
  if (options.sessionContext) {
    tier4Parts.push(`[Session Notes]\n${options.sessionContext}`);
  }
  if (options.searchResults) {
    tier4Parts.push(`[Web Search Results - Use these to provide current information]\n${options.searchResults}`);
  }

  // Date/time (rounded to 15-min for some determinism)
  const { date, time } = getDateTime();
  tier4Parts.push(`[Current Time]\n${date} at ${time} (CET+1)`);

  // Source context
  if (options.source && options.source !== 'web') {
    tier4Parts.push(getSourceContext(options.source));
  }

  if (tier4Parts.length > 0) {
    blocks.push({
      text: normalizePromptText(tier4Parts.join('\n\n')),
      cache: false  // NOT cached - changes every message
    });
  }

  return blocks;
}

export default {
  LUNA_BASE_PROMPT,
  ASSISTANT_MODE_PROMPT,
  COMPANION_MODE_PROMPT,
  VOICE_MODE_PROMPT,
  DJ_LUNA_MODE_PROMPT,
  getBasePrompt,
  getSystemPrompt,
  buildContextualPrompt,
  buildCacheOptimizedPrompt,
};
