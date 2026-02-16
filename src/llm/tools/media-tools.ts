import OpenAI from 'openai';

export const localMediaSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'local_media_search',
    description: 'Search for local media files (movies, shows, music) in the server /mnt/data/media directory. Use this when the user asks for local files. IMPORTANT: Search for broad terms like just the show name (e.g., "Shantaram") instead of specific episode numbers if a specific search fails.',
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
    description: 'Stream a local media file by its ID (base64 path). This opens the integrated media player and starts playback.',
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
