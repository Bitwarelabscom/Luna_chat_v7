import OpenAI from 'openai';

export const delegateToAgentTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'delegate_to_agent',
    description: `Delegate a specialized task to an expert agent. Available agents:
- researcher: Deep research, information gathering, fact-finding
- coder-claude: SENIOR ENGINEER - Use for HIGH COMPLEXITY: architecture, refactoring, debugging hard errors, security-critical code
- coder-gemini: RAPID PROTOTYPER - Use for HIGH VOLUME/SPEED: simple scripts, unit tests, log analysis, code explanations, boilerplate
- coder-codex: BALANCED CODER - Use for FAST PRACTICAL DELIVERY: focused patches, implementation with tests, concise code fixes
- writer: Creative writing, professional writing, editing, content creation
- analyst: Data analysis, calculations, statistics, insights
- planner: Task breakdown, project planning, organizing complex goals

CODING AGENT DECISION MATRIX:
| Task | Agent |
|------|-------|
| "Refactor the auth system" | coder-claude |
| "Debug this race condition" | coder-claude |
| "Review for security issues" | coder-claude |
| "Analyze this error log" | coder-gemini |
| "Write unit tests" | coder-gemini |
| "Create a simple utility script" | coder-gemini |
| "Explain what this code does" | coder-gemini |
| "Ship this practical bugfix quickly" | coder-codex |
| "Implement a focused patch with tests" | coder-codex |

Default: coder-claude for deep complexity, coder-gemini for high-volume generation, coder-codex for balanced practical patches.
The coding agents can execute code, create files/folders in the workspace, and persist work across sessions.`,
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: ['researcher', 'coder-claude', 'coder-gemini', 'coder-codex', 'writer', 'analyst', 'planner'],
          description: 'The specialist agent to delegate to',
        },
        task: {
          type: 'string',
          description: 'Clear description of what the agent should do',
        },
        context: {
          type: 'string',
          description: 'Optional additional context to help the agent',
        },
      },
      required: ['agent', 'task'],
    },
  },
};

export const sessionNoteTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'session_note',
    description: 'Add a note about this session for future reference. Use to record important context like user mood, key topics discussed, action items, or anything you want to remember for the next session. Notes appear in startup greetings.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'Brief note about the session (max 200 characters). Examples: "User feeling stressed about work", "Discussed vacation plans", "Follow up on project deadline"',
        },
      },
      required: ['note'],
    },
  },
};

export const sendTelegramTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'send_telegram',
    description: `Send a message to the user via Telegram. Use this when you want to send them a reminder, follow-up, or important information to their phone. Only works if the user has Telegram connected.`,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to send via Telegram',
        },
      },
      required: ['message'],
    },
  },
};

export const sendFileToTelegramTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'send_file_to_telegram',
    description: `Send a file from your workspace to the user via Telegram. Use this when you want to send a document, image, report, or any file you have created or saved.`,
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The name of the file in the workspace to send (e.g., "report.pdf", "image.png")',
        },
        caption: {
          type: 'string',
          description: 'Optional caption to send with the file',
        },
      },
      required: ['filename'],
    },
  },
};

export const suggestGoalTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'suggest_goal',
    description: `Suggest creating a goal when the user explicitly expresses a clear desire, intention, or aspiration. ONLY use when:
- User says "I want to...", "I'm planning to...", "I need to...", "I'd like to...", "My goal is to..."
- The intent is clear and actionable (not hypothetical or casual mention)
Do NOT use for casual mentions like "it would be nice" or hypothetical scenarios.
This will create a confirmation prompt for the user to approve.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short, clear goal title (e.g., "Learn Python", "Exercise 3x/week")',
        },
        description: {
          type: 'string',
          description: 'Optional longer description of the goal',
        },
        goalType: {
          type: 'string',
          enum: ['user_focused', 'self_improvement', 'relationship', 'research'],
          description: 'The type of goal: user_focused (helping user), self_improvement (personal growth), relationship (connection with user), research (learning topics)',
        },
      },
      required: ['title', 'goalType'],
    },
  },
};

// Context loading tool - fetch session/intent context on demand
export const loadContextTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'load_context',
    description: `Load context from previous sessions or intents. Use when:
- User says "continue where we left off", "what were we working on"
- User references past work: "that thing we discussed", "the bug we fixed"
- User asks about decisions: "what did we decide about X"
- You need more context about an ongoing task or goal`,
    parameters: {
      type: 'object',
      properties: {
        intent_id: {
          type: 'string',
          description: 'Specific intent ID to load (from breadcrumbs)',
        },
        session_id: {
          type: 'string',
          description: 'Specific session ID to load',
        },
        query: {
          type: 'string',
          description: 'Search query to find relevant context by keywords',
        },
        depth: {
          type: 'string',
          enum: ['brief', 'summary', 'detailed'],
          description: 'How much detail to load. Default: summary',
        },
      },
      required: [],
    },
  },
};

// Context correction tool - fix incorrect summaries
export const correctSummaryTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'correct_summary',
    description: `Correct an incorrect summary when user indicates stored context is wrong. Use when:
- User says "that's not what we decided"
- User says "actually, we tried X not Y"
- User corrects a stored decision, approach, or blocker`,
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['session', 'intent'],
          description: 'Type of summary to correct',
        },
        id: {
          type: 'string',
          description: 'ID of the session or intent to correct',
        },
        field: {
          type: 'string',
          enum: ['decision', 'approach', 'blocker', 'summary'],
          description: 'Which field to correct',
        },
        correction: {
          type: 'string',
          description: 'The correct value or information',
        },
      },
      required: ['type', 'id', 'field', 'correction'],
    },
  },
};

// Research agent tool - uses Claude CLI for in-depth research
export const researchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'research',
    description: `Conduct in-depth research using Gemini 3 Pro. Use this for complex questions that require thorough investigation, web research, code analysis, document processing, or data analysis. The research agent can search the web, analyze information, and provide detailed findings. Results can optionally be saved to the user's workspace. Use "quick" depth for simple lookups (1-2 min) or "thorough" for comprehensive analysis (5-10 min).`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The research question or topic to investigate thoroughly',
        },
        depth: {
          type: 'string',
          enum: ['quick', 'thorough'],
          description: 'Research depth - "quick" for simple lookups, "thorough" for comprehensive analysis. Default: thorough',
        },
        save_to_file: {
          type: 'string',
          description: 'Optional filename to save research results in workspace (e.g., "market-analysis.md"). File will be saved in the research/ folder.',
        },
      },
      required: ['query'],
    },
  },
};

export const n8nWebhookTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'n8n_webhook',
    description: 'Trigger an n8n workflow webhook to automate external actions. Use this when the task should be handed off to a configured n8n workflow.',
    parameters: {
      type: 'object',
      properties: {
        workflow_path: {
          type: 'string',
          description: 'Webhook path in n8n (for example: "luna-assistant" for /webhook/luna-assistant).',
        },
        payload: {
          type: 'object',
          description: 'JSON payload to send to the n8n workflow.',
        },
        use_test_webhook: {
          type: 'boolean',
          description: 'Set true to use /webhook-test during development. Default is false.',
        },
      },
      required: ['workflow_path'],
    },
  },
};
