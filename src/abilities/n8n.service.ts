import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export interface ExecuteN8nWebhookOptions {
  useTestWebhook?: boolean;
  userId?: string;
  sessionId?: string;
}

export interface ExecuteN8nWebhookResult {
  success: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function getWebhookUrl(path: string, useTestWebhook: boolean): string {
  const baseUrl = useTestWebhook
    ? config.n8n.testWebhookBaseUrl
    : config.n8n.webhookBaseUrl;
  return `${normalizeBaseUrl(baseUrl)}/${normalizePath(path)}`;
}

export async function executeWebhook(
  path: string,
  payload: Record<string, unknown> = {},
  options: ExecuteN8nWebhookOptions = {}
): Promise<ExecuteN8nWebhookResult> {
  if (!config.n8n.enabled) {
    return {
      success: false,
      status: 503,
      error: 'n8n integration is disabled',
    };
  }

  if (!path || typeof path !== 'string') {
    return {
      success: false,
      status: 400,
      error: 'workflow path is required',
    };
  }

  const url = getWebhookUrl(path, options.useTestWebhook === true);
  const requestBody = {
    ...payload,
    _luna: {
      userId: options.userId,
      sessionId: options.sessionId,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.n8n.webhookAuthToken) {
      headers.Authorization = `Bearer ${config.n8n.webhookAuthToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: typeof data === 'string' ? data : `n8n webhook failed with status ${response.status}`,
        data,
      };
    }

    return {
      success: true,
      status: response.status,
      data,
    };
  } catch (error) {
    logger.error('n8n webhook execution failed', {
      path,
      url,
      error: (error as Error).message,
    });
    return {
      success: false,
      status: 500,
      error: (error as Error).message,
    };
  }
}

