import OpenAI from 'openai';

export const localMediaSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'local_media_search',
    description: 'Search for local media files (movies, shows, music) in the media library and torrent downloads directory. Use this when the user asks for local files or wants to play downloaded torrents. IMPORTANT: Search for broad terms like just the show name (e.g., "Shantaram") instead of specific episode numbers if a specific search fails.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query for local files (e.g., "Shantaram", "Rick Astley")',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
};

export const localMediaPlayTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'local_media_play',
    description: 'Stream a local media file by its ID (base64 path). This opens the integrated media player and starts playback. Works with any file in /mnt/data/media including torrent downloads - use transmission_status to get fileId for completed torrents, or local_media_search to find files by name.',
    parameters: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The ID of the local media file to play',
        },
        fileName: {
          type: 'string',
          description: 'The name of the file (for display)',
        },
      },
      required: ['fileId', 'fileName'],
    },
  },
};

export const mediaDownloadTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'media_download',
    description: 'Download a YouTube video or its audio to the local media library. Use when user wants to save/download a video or add music to their library.',
    parameters: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description: 'The YouTube video ID',
        },
        title: {
          type: 'string',
          description: 'The video title (used for filename)',
        },
        format: {
          type: 'string',
          enum: ['video', 'audio'],
          description: 'Download as video (mp4) or audio only (mp3)',
        },
      },
      required: ['videoId', 'title', 'format'],
    },
  },
};

// Image generation tool
export const generateImageTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: `Generate an image based on a text description using AI. Use when the user asks for an image, picture, illustration, artwork, or any visual to be created. Returns an image that will be displayed in chat.`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A detailed description of the image to generate. Be specific about style, colors, composition, and subjects.',
        },
      },
      required: ['prompt'],
    },
  },
};

// Prowlarr torrent search tool
export const torrentSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'torrent_search',
    description: 'Low-level torrent search via Prowlarr. Returns raw results with guid/indexerId for manual selection. Only use this when the user wants to BROWSE torrent results or pick a specific release themselves. For simply downloading a movie or show, use movie_grab instead - it handles search + selection + download automatically.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "The Bear S03", "Dune 2024 2160p")',
        },
      },
      required: ['query'],
    },
  },
};

// Prowlarr torrent grab/download tool
export const torrentDownloadTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'torrent_download',
    description: 'Low-level: send a specific torrent to Transmission by guid and indexerId (from torrent_search). Only use after torrent_search when the user picked a specific release. For simply downloading a movie or show by name, use movie_grab instead.',
    parameters: {
      type: 'object',
      properties: {
        guid: {
          type: 'string',
          description: 'The guid of the torrent result from torrent_search',
        },
        indexerId: {
          type: 'number',
          description: 'The indexerId of the torrent result from torrent_search',
        },
        title: {
          type: 'string',
          description: 'The title of the torrent (for logging)',
        },
      },
      required: ['guid', 'indexerId', 'title'],
    },
  },
};

// Transmission status tool
export const transmissionStatusTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'transmission_status',
    description: 'Get the current status of all torrents in Transmission. Shows download progress, speed, ETA, and status for each torrent. For completed torrents, also returns playable media files with fileId values that can be passed to local_media_play. Use when the user asks about downloads, wants to play a completed download, or check transfer status.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

// Transmission remove torrent tool
export const transmissionRemoveTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'transmission_remove',
    description: 'Remove a torrent from Transmission. Use transmission_status first to get the torrent ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'The Transmission torrent ID to remove',
        },
        deleteData: {
          type: 'boolean',
          description: 'Whether to also delete the downloaded data files. Default false.',
        },
      },
      required: ['id'],
    },
  },
};

// Movie grab tool - autonomous search + download via local 9b model
export const movieGrabTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'movie_grab',
    description: 'Autonomously find and download a movie or TV show torrent. Just provide the name and it handles searching and downloading automatically. Use when the user wants to download a movie, show, or series. Reports back with ok/failed status.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The movie or show name (e.g., "Dune Part Two", "The Bear Season 3", "Interstellar")',
        },
        preferences: {
          type: 'string',
          description: 'Optional quality/format preferences (e.g., "4K", "1080p", "with subtitles")',
        },
      },
      required: ['name'],
    },
  },
};

// Desktop background generation tool
export const generateBackgroundTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_desktop_background',
    description: `Generate a desktop background/wallpaper image for Luna's UI. Use when the user asks for a new background, wallpaper, or wants to change/customize their desktop background. The generated background will be saved and can be set as active.`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A description of the background to generate. Examples: "sunset over mountains", "abstract purple and blue gradients", "minimalist geometric pattern".',
        },
        style: {
          type: 'string',
          enum: ['abstract', 'nature', 'artistic', 'custom'],
          description: 'The style of background: abstract (gradients, shapes), nature (landscapes, scenery), artistic (illustrations, creative), or custom (user-defined).',
        },
        setActive: {
          type: 'boolean',
          description: 'Whether to immediately set this as the active desktop background. Default is true.',
        },
      },
      required: ['prompt'],
    },
  },
};
