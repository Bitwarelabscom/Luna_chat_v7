import OpenAI from 'openai';

// Workspace tools for file management and execution
export const workspaceWriteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_write',
    description: `Save a file to the user's persistent workspace. Useful for saving scripts, notes, data files, or code that the user might want to use again later. Supported file types: .py, .js, .ts, .sh, .json, .txt, .md, .csv, .xml, .yaml, .yml, .html, .css, .sql, .r, .ipynb`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to save (e.g., "analysis.py", "data.json", "notes.md")',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['filename', 'content'],
    },
  },
};

export const workspaceReadTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_read',
    description: `Read the contents of a file from the user's workspace.`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to read',
        },
      },
      required: ['filename'],
    },
  },
};

export const workspaceListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_list',
    description: `List all files in the user's workspace. Shows file names, sizes, and last modified dates.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const workspaceExecuteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_execute',
    description: `Execute a script file from the user's workspace in a sandboxed environment. Returns the output of the script. Supported: .py (Python), .js (JavaScript/Node.js), .sh (Shell)`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to execute (e.g., "analysis.py", "script.js")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional command-line arguments to pass to the script',
        },
      },
      required: ['filename'],
    },
  },
};
