// Core API infrastructure - shared by all domain modules

// In production (empty NEXT_PUBLIC_API_URL), API calls go through nginx at /api
// In development, API calls go directly to the backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '';

// Export prefix for static media URLs
export const getMediaUrl = (path: string): string => {
  if (!path) {
    return path;
  }

  // Absolute/data/blob URLs are already usable
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // When API_URL is empty, media is served from the same host
  if (!API_URL) {
    return `${API_PREFIX}${normalizedPath}`;
  }

  const normalizedApiUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
  return `${normalizedApiUrl}${API_PREFIX}${normalizedPath}`;
};

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function downloadApiFile(endpoint: string): Promise<{ blob: Blob; filename: string }> {
  let response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (response.status === 401) {
    const refreshed = await fetch(`${API_URL}${API_PREFIX}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken: null }),
    }).then(r => r.ok).catch(() => false);

    if (refreshed) {
      response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || 'Request failed', error.code);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const filename = filenameMatch?.[1] || 'download.txt';

  return { blob, filename };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  let response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });

  // Handle token refresh
  if (response.status === 401) {
    const refreshed = await fetch(`${API_URL}${API_PREFIX}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken: null }), // body ignored if cookie exists
    }).then(r => r.ok).catch(() => false);

    if (refreshed) {
      response = await fetch(`${API_URL}${API_PREFIX}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
        cache: 'no-store',
      });
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || 'Request failed', error.code);
  }

  // Handle 204 No Content (e.g., DELETE responses)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export { API_URL, API_PREFIX };
