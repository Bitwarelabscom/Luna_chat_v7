import OpenAI from 'openai';

// Todo management tools
export const listTodosTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_todos',
    description: `List the user's todo items. Shows pending, in-progress, and optionally completed todos with their status, priority, due dates, and notes.`,
    parameters: {
      type: 'object',
      properties: {
        includeCompleted: {
          type: 'boolean',
          description: 'If true, include completed todos. Default: false (only active todos)',
        },
      },
      required: [],
    },
  },
};

export const createTodoTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_todo',
    description: `Create a new todo item for the user. Use when the user asks you to add something to their todo list, remind them about something, or when they mention a task they need to do. IMPORTANT: Extract ONLY the core task action for the title - do NOT include conversational phrases like "can you add a todo that..." or "remind me to...". The title should be the actual task like "buy coffee" or "call mom", NOT the user's full request.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The core task action only (e.g., "buy coffee", "call mom", "finish report"). Extract ONLY the actual task - do NOT include the user\'s conversational phrasing like "can you add...", "remind me to...", "i should...", etc.',
        },
        notes: {
          type: 'string',
          description: 'Optional notes or additional details about the todo',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Priority level. Default: medium',
        },
        dueDate: {
          type: 'string',
          description: 'Due date with optional time in ISO format (YYYY-MM-DDTHH:MM) or natural language like "today at 12:00", "tomorrow 3pm", "next week". Include time if user specifies it.',
        },
        remindMinutesBefore: {
          type: 'number',
          description: 'How many minutes before the due date/time to send a reminder notification. E.g., 60 for 1 hour before, 30 for 30 minutes before.',
        },
      },
      required: ['title'],
    },
  },
};

export const completeTodoTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'complete_todo',
    description: `Mark a todo item as completed. Use when the user says they finished a task, completed something, or asks you to check off an item.`,
    parameters: {
      type: 'object',
      properties: {
        todoId: {
          type: 'string',
          description: 'The ID of the todo to complete. Get this from list_todos first.',
        },
        title: {
          type: 'string',
          description: 'Alternative: the title/text of the todo to complete (will match partially)',
        },
      },
      required: [],
    },
  },
};

export const updateTodoTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_todo',
    description: `Update a todo item - add or modify notes, change priority, update due date, or change status. Use when the user wants to add details to a todo or modify it.`,
    parameters: {
      type: 'object',
      properties: {
        todoId: {
          type: 'string',
          description: 'The ID of the todo to update. Get this from list_todos first.',
        },
        title: {
          type: 'string',
          description: 'Alternative: the title/text of the todo to update (will match partially)',
        },
        notes: {
          type: 'string',
          description: 'New notes to set (replaces existing notes)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'New priority level',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'New status',
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format or natural language',
        },
      },
      required: [],
    },
  },
};

export const createCalendarEventTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_calendar_event',
    description: `Create a calendar event. Use when user explicitly asks to add something to their CALENDAR (not todo list). IMPORTANT: Extract ONLY the event title from the user's message - do NOT include conversational phrasing. A todo/task request should use create_todo instead, NOT this tool.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The event title only (e.g., "Coffee with Alex", "Doctor appointment", "Team meeting"). Extract ONLY the actual event name.',
        },
        description: {
          type: 'string',
          description: 'Optional description or notes for the event',
        },
        startTime: {
          type: 'string',
          description: 'Start date and time in ISO format (YYYY-MM-DDTHH:MM) or natural language like "today at 14:00", "tomorrow 3pm", "next Monday 10:00"',
        },
        endTime: {
          type: 'string',
          description: 'Optional end time. If not provided, defaults to 1 hour after start time.',
        },
        location: {
          type: 'string',
          description: 'Optional location for the event',
        },
        isAllDay: {
          type: 'boolean',
          description: 'Whether this is an all-day event (no specific time)',
        },
        reminderMinutes: {
          type: 'number',
          description: 'How many minutes before the event to send a reminder. Defaults to 15 if not specified. Examples: 15 for 15 minutes before, 60 for 1 hour before, 0 for reminder at event time. Omit or set to null for no reminder.',
        },
      },
      required: ['title', 'startTime'],
    },
  },
};

export const listCalendarEventsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_calendar_events',
    description: `List upcoming calendar events. Use when user asks what's on their calendar, their schedule, or upcoming events.`,
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many days ahead to look. Default: 7',
        },
      },
      required: [],
    },
  },
};

export const createReminderTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_reminder',
    description: 'Set a quick reminder to notify the user via Telegram after a specified time. Use when user says things like "remind me in X minutes about Y" or "set a reminder for...".',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'What to remind about (the reminder message)',
        },
        delay_minutes: {
          type: 'number',
          description: 'Number of minutes from now to send the reminder',
        },
      },
      required: ['message', 'delay_minutes'],
    },
  },
};

export const listRemindersTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_reminders',
    description: 'List all pending reminders for the user. Use when user asks "what reminders do I have?" or wants to see their upcoming reminders.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export const cancelReminderTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'cancel_reminder',
    description: 'Cancel a pending reminder by its ID. Use when user wants to cancel or remove a reminder.',
    parameters: {
      type: 'object',
      properties: {
        reminder_id: {
          type: 'string',
          description: 'The ID of the reminder to cancel',
        },
      },
      required: ['reminder_id'],
    },
  },
};
