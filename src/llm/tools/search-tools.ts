import OpenAI from 'openai';

export const searchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current information, news, or facts. Use when you need up-to-date information or when the user asks about recent events.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
      },
      required: ['query'],
    },
  },
};

export const browserVisualSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_visual_search',
    description: 'Search the web visually by opening the browser window for the user to watch in real-time. Use this for news, current events, or when the user wants to see you browsing. The browser window will open and show live navigation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
        searchEngine: {
          type: 'string',
          enum: ['google', 'google_news', 'bing'],
          description: 'Which search engine to use. Default is google_news for news queries.',
        },
      },
      required: ['query'],
    },
  },
};

export const youtubeSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'youtube_search',
    description: 'Search YouTube for videos. ALWAYS use this tool when the user mentions videos, YouTube, watching, or playing video content. Examples: "play me a video", "find a video about...", "show me a YouTube video", "search YouTube for...", "I want to watch...", "play something". This tool works and should be used for any video-related request.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query for YouTube videos',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default: 3, max: 5)',
        },
      },
      required: ['query'],
    },
  },
};

export const fetchUrlTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'fetch_url',
    description: `Fetch and read the content of a specific URL/webpage. Use when the user asks you to read, fetch, or get content from a specific URL. This retrieves the text content of the page for analysis.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to fetch (must start with http:// or https://)',
        },
      },
      required: ['url'],
    },
  },
};

export const searchDocumentsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_documents',
    description: `Search the user's uploaded documents (PDFs, text files) for relevant information. Use when the user asks about their documents, files, or wants to find information in their uploaded content.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant document content',
        },
      },
      required: ['query'],
    },
  },
};
