import OpenAI from 'openai';

// Browser automation tools
export const browserNavigateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_navigate',
    description: `Navigate a browser to a URL. Use this when you need to visit a webpage for interactive browsing, form filling, or when fetch_url doesn't work (JavaScript-heavy sites, SPAs). Returns page title and URL on success.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to navigate to (must start with http:// or https://)',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'When to consider navigation complete. Default: domcontentloaded',
        },
      },
      required: ['url'],
    },
  },
};

export const browserScreenshotTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_screenshot',
    description: `Take a screenshot of a webpage. Use for visual analysis, debugging, or when you need to see what the page looks like. Returns a base64-encoded image.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to and screenshot',
        },
        fullPage: {
          type: 'boolean',
          description: 'If true, capture the entire scrollable page. Default: false (viewport only)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to screenshot a specific element instead of the page',
        },
      },
      required: ['url'],
    },
  },
};

export const browserClickTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_click',
    description: `Click an element on a webpage by CSS selector. Use for buttons, links, or any clickable element.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to first',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href*=signup]")',
        },
      },
      required: ['url', 'selector'],
    },
  },
};

export const browserFillTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_fill',
    description: `Fill a form field with text on a webpage. Clears existing content first. Use for input fields, textareas, and contenteditable elements.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to first',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the input field (e.g., "input[name=email]", "#username", "textarea.comment")',
        },
        value: {
          type: 'string',
          description: 'The text to fill into the field',
        },
      },
      required: ['url', 'selector', 'value'],
    },
  },
};

export const browserExtractTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_extract',
    description: `Extract content from a webpage. Returns page text, title, and links. Better than fetch_url for JavaScript-rendered content.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to and extract content from',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to extract specific elements. If not provided, extracts main page content.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return when using selector. Default: 10',
        },
      },
      required: ['url'],
    },
  },
};

export const browserWaitTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_wait',
    description: `Wait for an element to appear on a webpage. Use after navigation or actions that trigger page changes.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to first',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds. Default: 10000 (10 seconds)',
        },
      },
      required: ['url', 'selector'],
    },
  },
};

export const browserCloseTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_close',
    description: `Close the browser session. Use when done with browser automation to free resources.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const browserRenderHtmlTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_render_html',
    description: `Render HTML content and display it as a visual page. Use when you want to create and show the user a custom HTML page, visualization, chart, diagram, styled content, or any HTML-based visual. Perfect for creating interactive demonstrations, formatted reports, data visualizations, or presenting information in a visually appealing way. The HTML will be rendered in a browser and shown as an image to the user.`,
    parameters: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'Complete HTML content to render. Can include inline CSS and JavaScript. Should be a full HTML document with <html>, <head>, and <body> tags for best results.',
        },
        title: {
          type: 'string',
          description: 'Optional title for the page (will be shown in the caption)',
        },
      },
      required: ['html'],
    },
  },
};
