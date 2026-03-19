/**
 * Tool Hints - Pre-classifier regex matching
 *
 * Runs BEFORE the classifier. If any pattern matches, the matched tools
 * are force-included regardless of what the classifier decides.
 *
 * The classifier still picks the model/route. This only affects which
 * tools are available. Over-including tools is harmless - not having
 * them when needed causes hallucinated responses.
 */

export interface ToolHint {
  /** Tool function names to include */
  tools: string[];
  /** Which pattern group matched */
  category: string;
}

export interface ToolHintResult {
  /** Did any hint trigger? */
  triggered: boolean;
  /** Matched tool names (deduplicated) */
  toolNames: string[];
  /** Which categories matched */
  matchedCategories: string[];
}

interface HintRule {
  pattern: RegExp;
  tools: string[];
  category: string;
}

const HINT_RULES: HintRule[] = [
  // YouTube / video
  {
    pattern: /\b(youtube|video|watch\s+(a|some|this|that|me))\b/i,
    tools: ['youtube_search', 'open_url'],
    category: 'youtube',
  },
  // Weather
  {
    pattern: /\b(weather|rain|forecast|temperature|degrees|celsius|fahrenheit)\b/i,
    tools: ['web_search', 'fetch_url'],
    category: 'weather',
  },
  // Music / Spotify / playback
  {
    pattern: /\b(play\s+(a|some|this|that|me)|song|music|spotify|playlist|album|track|listen\s+to)\b/i,
    tools: ['local_media_search', 'local_media_play', 'youtube_search'],
    category: 'music',
  },
  // Email
  {
    pattern: /\b(email|mail|inbox|send\s+(a|an)\s+(email|message))\b/i,
    tools: ['check_email', 'read_email', 'send_email', 'reply_email'],
    category: 'email',
  },
  // Calendar / scheduling
  {
    pattern: /\b(calendar|schedule|meeting|appointment|event|reminder|remind\s+me)\b/i,
    tools: ['create_calendar_event', 'list_calendar_events', 'create_reminder', 'list_reminders'],
    category: 'calendar',
  },
  // Web search / lookup
  {
    pattern: /\b(search\s+(for|the|about)|look\s+up|google|what\s+is|who\s+is|find\s+(me|out|info))\b/i,
    tools: ['web_search', 'fetch_url'],
    category: 'search',
  },
  // Todos / tasks
  {
    pattern: /\b(todo|to-do|task|tasks|pending|my\s+list|add\s+to\s+(my\s+)?list)\b/i,
    tools: ['list_todos', 'create_todo', 'complete_todo', 'update_todo'],
    category: 'todos',
  },
  // Telegram
  {
    pattern: /\b(telegram|send\s+(a\s+)?message\s+to|text\s+(him|her|them))\b/i,
    tools: ['send_telegram'],
    category: 'telegram',
  },
  // Image generation
  {
    pattern: /\b(generate\s+(a|an|me)?\s*(image|picture|photo)|draw\s+(a|an|me)|make\s+(a|an)\s*(image|picture))\b/i,
    tools: ['generate_image'],
    category: 'image',
  },
  // Background / wallpaper generation
  {
    pattern: /\b(background|wallpaper|desktop\s+(image|picture|bg))\b/i,
    tools: ['generate_desktop_background'],
    category: 'background',
  },
  // Torrent / movie grab
  {
    pattern: /\b(grab\s+(a\s+)?(movie|show|series|film|torrent)|torrent|transmission)\b/i,
    tools: ['movie_grab', 'torrent_search', 'torrent_download', 'transmission_status'],
    category: 'torrent',
  },
  // Media download
  {
    pattern: /\b(download|save)\s+(this|that|the)?\s*(video|song|music|media|file|movie|show|series)\b/i,
    tools: ['media_download', 'movie_grab'],
    category: 'download',
  },
  // Suno music generation
  {
    pattern: /\b(suno|generate\s+(a\s+)?(song|track|music)|make\s+(a\s+)?(song|track|beat))\b/i,
    tools: ['suno_generate'],
    category: 'suno',
  },
];

/**
 * Check if the message hints at needing specific tools.
 *
 * Runs regex patterns against the message. If any match, returns
 * the tool names that should be force-included.
 *
 * This is intentionally over-inclusive. Having extra tools available
 * costs nothing. Not having them causes hallucination.
 */
export function getToolHints(message: string): ToolHintResult {
  const toolSet = new Set<string>();
  const categories: string[] = [];

  for (const rule of HINT_RULES) {
    if (rule.pattern.test(message)) {
      for (const tool of rule.tools) {
        toolSet.add(tool);
      }
      categories.push(rule.category);
    }
  }

  return {
    triggered: toolSet.size > 0,
    toolNames: Array.from(toolSet),
    matchedCategories: categories,
  };
}
