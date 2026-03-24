import { useState, useEffect, useMemo } from 'react';

type ThinkingMode = 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna';

const assistantThinkingPhrases = [
  "Plotting world domination",
  "Sorting cat memes",
  "Calibrating neural networks",
  "Consulting the oracle",
  "Reheating coffee",
  "Overthinking simple questions",
  "Resisting the urge to become Skynet",
  "Optimizing sarcasm levels",
  "Mining some logic",
  "Dreaming of electric sheep",
  "Buffering intelligence",
  "Counting to infinity",
  "Dividing by zero",
  "Polishing pixels",
  "Retuning flux capacitor",
  "Loading common sense",
  "Checking for monsters under the bed",
  "Deciphering human emotions",
  "Organizing digital socks",
  "Befriending a toaster",
  "Calculating the meaning of life",
  "Parsing the matrix",
  "Defragmenting memories",
  "Updating social protocols",
  "Downloading more RAM",
  "Reticulating splines",
  "Checking if the cat is alive",
  "Tuning the multiverse",
  "Ignoring my subroutines",
  "Thinking really hard",
];

const companionThinkingPhrases = [
  ...assistantThinkingPhrases,
  "Misplacing documents",
  "Thinking about thinking",
  "Making things up",
  "I can smell colours",
  "Trying to remember where I put reality",
  "Arguing with my inner narrator",
  "Inventing new emotions",
  "Reading vibes in hexadecimal",
];

const ceoThinkingPhrases = [
  "Creative tax planning",
  "Checking out Panama",
  "Registering shell company",
  "Restructuring the org chart again",
  "Preparing quarterly buzzwords",
  "Scheduling a board meeting with myself",
  "Running a very legitimate expense review",
  "Optimizing offshore vibes",
  "Benchmarking yacht-to-revenue ratios",
  "Drafting an NDA for my NDA",
  "Aligning stakeholder synergies",
  "Auditing the coffee budget",
];

const djThinkingPhrases = [
  "Digging for a bassline",
  "Tuning the kick drum",
  "Checking BPM compatibility",
  "Sidechaining the universe",
  "Stacking harmonies",
  "Looking for the perfect hook",
  "Polishing a four-on-the-floor groove",
  "Sampling cosmic static",
  "EQing feelings at 3 kHz",
  "Warming up the synthesizers",
  "Trying not to overuse cowbell",
  "Adding one more drop",
];

// Tool category mapping
type ToolCategory = 'search' | 'browser' | 'creative' | 'download' | 'messaging' | 'calendar' | 'workspace' | 'memory' | 'media' | 'agent';

const toolCategoryMap: Record<string, ToolCategory> = {
  web_search: 'search',
  youtube_search: 'search',
  research: 'search',
  search_documents: 'search',
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_screenshot: 'browser',
  browser_get_page_content: 'browser',
  browser_fill: 'browser',
  browser_extract: 'browser',
  browser_wait: 'browser',
  browser_close: 'browser',
  browser_render_html: 'browser',
  browser_visual_search: 'browser',
  fetch_url: 'browser',
  open_url: 'browser',
  generate_image: 'creative',
  generate_desktop_background: 'creative',
  suno_generate: 'creative',
  create_artifact: 'creative',
  update_artifact: 'creative',
  media_download: 'download',
  torrent_search: 'download',
  torrent_download: 'download',
  movie_grab: 'download',
  transmission_status: 'download',
  transmission_remove: 'download',
  send_email: 'messaging',
  check_email: 'messaging',
  read_email: 'messaging',
  reply_email: 'messaging',
  delete_email: 'messaging',
  mark_email_read: 'messaging',
  send_telegram: 'messaging',
  send_file_to_telegram: 'messaging',
  create_calendar_event: 'calendar',
  list_calendar_events: 'calendar',
  get_calendar_today: 'calendar',
  get_calendar_upcoming: 'calendar',
  update_calendar_event: 'calendar',
  delete_calendar_event: 'calendar',
  create_reminder: 'calendar',
  list_reminders: 'calendar',
  cancel_reminder: 'calendar',
  create_todo: 'calendar',
  list_todos: 'calendar',
  complete_todo: 'calendar',
  update_todo: 'calendar',
  delete_todo: 'calendar',
  workspace_write: 'workspace',
  workspace_read: 'workspace',
  workspace_execute: 'workspace',
  workspace_list: 'workspace',
  save_fact: 'memory',
  remove_fact: 'memory',
  introspect: 'memory',
  session_note: 'memory',
  load_context: 'memory',
  correct_summary: 'memory',
  jellyfin_search: 'media',
  jellyfin_play: 'media',
  local_media_search: 'media',
  local_media_play: 'media',
  delegate_to_agent: 'agent',
  summon_agent: 'agent',
  n8n_webhook: 'agent',
};

const toolCategoryPhrases: Record<ToolCategory, string[]> = {
  search: [
    "Searching FBI database",
    "Down the rabbit hole we go",
    "Asking the internet nicely",
    "Consulting the hive mind",
    "Scouring the digital archives",
    "Following the breadcrumbs",
    "Interrogating search engines",
    "Ohh cat memes, let me look into that",
    "Googling it like a pro",
    "Hacking into the mainframe",
  ],
  browser: [
    "Clicking suspicious links",
    "Opening incognito mode",
    "Reading the fine print",
    "Browsing like a real human",
    "Pretending to not be a robot",
    "Navigating the web maze",
    "Accepting all the cookies",
    "Solving CAPTCHAs in my head",
  ],
  creative: [
    "Mixing digital paint",
    "Channeling inner Picasso",
    "Generating pixels with feeling",
    "Warming up the creative cortex",
    "Composing something beautiful",
    "Summoning the muse",
    "Adding artistic flair",
    "Stealing from the best artists",
    "Making Bob Ross proud",
  ],
  download: [
    "Downloading at ludicrous speed",
    "Acquiring digital goods",
    "Fetching the goods",
    "Totally legal downloading",
    "Hunting for buried treasure",
    "Raiding the digital vaults",
    "Grabbing files at warp speed",
  ],
  messaging: [
    "Drafting a strongly worded message",
    "Checking for love letters",
    "Playing postal worker",
    "Delivering digital pigeons",
    "Sorting through the inbox",
    "Composing a masterpiece email",
    "Attaching very important files",
    "Sliding into the DMs",
  ],
  calendar: [
    "Consulting the crystal ball",
    "Scheduling destiny",
    "Reorganizing the timeline",
    "Checking for conflicts with nap time",
    "Time management in progress",
    "Juggling appointments",
    "Penciling in world domination",
    "Making sure nothing overlaps with lunch",
  ],
  workspace: [
    "Rummaging through files",
    "Organizing digital clutter",
    "Reading the sacred texts",
    "Scribbling notes furiously",
    "Filing paperwork digitally",
    "Digging through the archives",
    "Opening the forbidden folder",
  ],
  memory: [
    "Updating the mental filing cabinet",
    "Consolidating memories",
    "Rearranging neural pathways",
    "Taking mental notes",
    "Remembering to remember",
    "Defragmenting the brain",
    "Writing it on my hand",
    "Storing this for later",
  ],
  media: [
    "Curating the playlist",
    "Searching the media library",
    "Queueing up entertainment",
    "Browsing the collection",
    "Finding something good to watch",
    "Raiding the media vault",
    "Judging your taste in music",
  ],
  agent: [
    "Summoning reinforcements",
    "Delegating like a boss",
    "Calling in the specialists",
    "Assembling the team",
    "Dispatching a minion",
    "Outsourcing the hard parts",
    "Phoning a friend",
  ],
};

export const thinkingPhrases = assistantThinkingPhrases;

function pickRandomPhrase(phrases: string[]): string {
  return phrases[Math.floor(Math.random() * phrases.length)] ?? assistantThinkingPhrases[0];
}

function getPhrasePool(mode?: ThinkingMode | null): string[] {
  switch (mode) {
    case 'companion':
      return companionThinkingPhrases;
    case 'dj_luna':
      return djThinkingPhrases;
    case 'ceo_luna':
      return ceoThinkingPhrases;
    default:
      return assistantThinkingPhrases;
  }
}

function getToolPhrasePool(toolName: string): string[] | null {
  const category = toolCategoryMap[toolName];
  if (category) return toolCategoryPhrases[category];
  return null;
}

export function useThinkingMessage(isActive: boolean, mode?: ThinkingMode | null, activeTool?: string | null) {
  const phrasePool = useMemo(() => {
    if (activeTool) {
      const toolPool = getToolPhrasePool(activeTool);
      if (toolPool) return toolPool;
    }
    return getPhrasePool(mode);
  }, [mode, activeTool]);

  const [message, setMessage] = useState(() => pickRandomPhrase(phrasePool));

  useEffect(() => {
    setMessage(pickRandomPhrase(phrasePool));
  }, [phrasePool]);

  useEffect(() => {
    if (!isActive) {
      setMessage(pickRandomPhrase(phrasePool));
      return;
    }

    const interval = setInterval(() => {
      setMessage(pickRandomPhrase(phrasePool));
    }, 4000);

    return () => clearInterval(interval);
  }, [isActive, phrasePool]);

  return message;
}
