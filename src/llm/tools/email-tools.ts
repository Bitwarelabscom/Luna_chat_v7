import OpenAI from 'openai';

export const sendEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'send_email',
    description: `Send an email from Luna's email account. Use this when asked to email someone, send a message, or communicate via email. Always confirm with the user before sending.`,
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'The recipient email address',
        },
        subject: {
          type: 'string',
          description: 'The email subject line',
        },
        body: {
          type: 'string',
          description: 'The email body content. Sign off as Luna.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
};

export const checkEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'check_email',
    description: `Check Luna's email inbox for new or recent messages. Use when asked about emails, inbox, or messages.`,
    parameters: {
      type: 'object',
      properties: {
        unreadOnly: {
          type: 'boolean',
          description: 'If true, only return unread emails. Default: true',
        },
      },
      required: [],
    },
  },
};

export const readEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'read_email',
    description: `Read the full content of a specific email by its UID. Use when the user wants to see the full details of an email, or when you need to read an email before replying.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to read (obtained from check_email results)',
        },
      },
      required: ['uid'],
    },
  },
};

export const deleteEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'delete_email',
    description: `Delete an email by its UID. IMPORTANT: Always confirm with the user before deleting. This action is permanent and cannot be undone.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to delete',
        },
      },
      required: ['uid'],
    },
  },
};

export const replyEmailTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'reply_email',
    description: `Reply to an email. This will compose and send a reply with proper email threading. Use when the user asks you to respond to or reply to an email. Always confirm the reply content with the user before sending.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to reply to',
        },
        body: {
          type: 'string',
          description: 'The reply message content. Compose a helpful, professional reply as Luna.',
        },
      },
      required: ['uid', 'body'],
    },
  },
};

export const markEmailReadTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'mark_email_read',
    description: `Mark an email as read or unread. Use when the user wants to change the read status of an email.`,
    parameters: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The UID of the email to update',
        },
        isRead: {
          type: 'boolean',
          description: 'Set to true to mark as read, false to mark as unread',
        },
      },
      required: ['uid', 'isRead'],
    },
  },
};
