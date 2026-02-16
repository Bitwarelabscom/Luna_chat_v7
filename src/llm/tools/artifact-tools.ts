import OpenAI from 'openai';

export const generateArtifactTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_artifact',
    description: 'Generate a new code or text artifact in the canvas. Use when creating code files, documents, or any substantial content the user wants to edit. Creates versioned, editable content that can be modified through quick actions or text selection.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['code', 'text'],
          description: 'Type of artifact: code for programming files, text for documents/markdown',
        },
        title: {
          type: 'string',
          description: 'Brief title for the artifact (max 5 words)',
        },
        language: {
          type: 'string',
          enum: ['typescript', 'javascript', 'python', 'html', 'css', 'markdown', 'json', 'sql', 'rust', 'cpp', 'java'],
          description: 'Programming language (required for type=code)',
        },
        content: {
          type: 'string',
          description: 'The full content of the artifact',
        },
      },
      required: ['type', 'title', 'content'],
    },
  },
};

export const rewriteArtifactTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'rewrite_artifact',
    description: 'Modify an existing artifact by creating a new version. Use when the user asks to edit, change, update, or improve an artifact. Creates a new version while preserving history.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'The ID of the artifact to modify',
        },
        title: {
          type: 'string',
          description: 'New title (optional, keeps existing if not provided)',
        },
        content: {
          type: 'string',
          description: 'The new content for this version',
        },
      },
      required: ['artifactId', 'content'],
    },
  },
};

export const updateHighlightedTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_highlighted',
    description: 'Update a selected portion of an artifact. Use when the user has selected text and asks to modify just that selection.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'The ID of the artifact',
        },
        startIndex: {
          type: 'number',
          description: 'Start position of the selected text',
        },
        endIndex: {
          type: 'number',
          description: 'End position of the selected text',
        },
        newContent: {
          type: 'string',
          description: 'The new content to replace the selection',
        },
      },
      required: ['artifactId', 'startIndex', 'endIndex', 'newContent'],
    },
  },
};

export const saveArtifactFileTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'save_artifact_file',
    description: 'Save or update a file in an existing artifact project (multi-file support). Use for adding/updating files like styles.css, script.js, additional html/json/txt files. Creates a new version snapshot.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'The ID of the artifact project',
        },
        path: {
          type: 'string',
          description: 'Project-relative file path, e.g. index.html, styles.css, js/app.js',
        },
        content: {
          type: 'string',
          description: 'The full file content',
        },
        language: {
          type: 'string',
          description: 'Optional language hint (html, css, javascript, json, markdown, etc.)',
        },
      },
      required: ['artifactId', 'path', 'content'],
    },
  },
};

export const listArtifactsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_artifacts',
    description: 'List recent canvas artifacts for the current user. Use this before loading or downloading older artifacts when artifact ID is unknown.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Optional session ID to scope artifacts to a specific chat session',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum artifacts to return (1-50)',
        },
      },
      required: [],
    },
  },
};

export const loadArtifactTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'load_artifact',
    description: 'Load an existing artifact (optionally a specific version) into canvas for viewing/editing.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'Artifact UUID to load',
        },
        index: {
          type: 'number',
          description: 'Optional version index to load. If omitted, loads current version.',
        },
      },
      required: ['artifactId'],
    },
  },
};

export const getArtifactDownloadLinkTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_artifact_download_link',
    description: 'Generate a direct download URL for an artifact version.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'Artifact UUID to download',
        },
        index: {
          type: 'number',
          description: 'Optional version index to download. If omitted, downloads current version.',
        },
      },
      required: ['artifactId'],
    },
  },
};
