import { api, ApiError, API_URL, API_PREFIX } from './core';

// Workspace API
export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStats {
  totalFiles: number;
  totalSize: number;
  scripts: number;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  permissions: string;
  isDirectory: boolean;
  isExecutable: boolean;
  createdAt: string;
  modifiedAt: string;
  accessedAt: string;
}

export const workspaceApi = {
  listFiles: () =>
    api<WorkspaceFile[]>('/api/abilities/workspace'),

  getStats: () =>
    api<WorkspaceStats>('/api/abilities/workspace/stats'),

  getFile: (filename: string) =>
    api<{ content: string; filename: string }>(`/api/abilities/workspace/file/${encodeURIComponent(filename)}`),

  createFile: (filename: string, content: string) =>
    api<{ success: boolean; filename: string }>('/api/abilities/workspace', { method: 'POST', body: { filename, content } }),

  updateFile: (filename: string, content: string) =>
    api<WorkspaceFile>(`/api/abilities/workspace/file/${encodeURIComponent(filename)}`, { method: 'PUT', body: { content } }),

  deleteFile: (filename: string) =>
    api<{ success: boolean }>(`/api/abilities/workspace/file/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  renameFile: (oldFilename: string, newFilename: string) =>
    api<WorkspaceFile>('/api/abilities/workspace/rename', { method: 'POST', body: { oldFilename, newFilename } }),

  renameDirectory: (oldPath: string, newPath: string) =>
    api<{ success: boolean; filesUpdated: number }>('/api/abilities/workspace/rename-directory', { method: 'POST', body: { oldPath, newPath } }),

  createDirectory: (path: string) =>
    api<{ success: boolean; path: string }>('/api/abilities/workspace/mkdir', { method: 'POST', body: { path } }),

  deleteDirectory: (dirPath: string) =>
    api<{ success: boolean; deletedCount: number }>(`/api/abilities/workspace/directory/${encodeURIComponent(dirPath)}`, { method: 'DELETE' }),

  setPermissions: (filename: string, mode: string) =>
    api<FileInfo>('/api/abilities/workspace/chmod', { method: 'POST', body: { filename, mode } }),

  getFileInfo: (filename: string) =>
    api<FileInfo>(`/api/abilities/workspace/info/${encodeURIComponent(filename)}`),

  listDirectories: () =>
    api<string[]>('/api/abilities/workspace/directories'),
};

// Upload workspace file using FormData
export async function uploadWorkspaceFile(file: File): Promise<WorkspaceFile> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}${API_PREFIX}/api/abilities/workspace/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new ApiError(response.status, error.error || 'Upload failed');
  }

  return response.json();
}

// Documents API
export interface Document {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  chunksCount: number;
}

export const documentsApi = {
  list: () =>
    api<{ documents: Document[] }>('/api/abilities/documents'),

  delete: (id: string) =>
    api<{ success: boolean }>(`/api/abilities/documents/${id}`, { method: 'DELETE' }),

  // Upload requires FormData, handle separately
};

// Text file detection helper
export function isTextFile(mimeTypeOrFilename: string | null | undefined): boolean {
  if (!mimeTypeOrFilename) return false;
  const textMimeTypes = [
    'text/',
    'application/javascript',
    'application/typescript',
    'application/json',
    'application/xml',
    'application/x-yaml',
    'application/sql',
    'application/x-sh',
    'application/x-python',
  ];
  if (textMimeTypes.some(type => mimeTypeOrFilename.startsWith(type))) {
    return true;
  }
  const ext = mimeTypeOrFilename.split('.').pop()?.toLowerCase();
  const textExts = ['txt', 'md', 'markdown', 'mdown', 'mkdn', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'csv', 'sql', 'sh', 'py', 'r', 'ipynb'];
  return textExts.includes(ext || '');
}

// Editor bridge API
export const editorBridgeApi = {
  getWorkspaceMapping: (filename: string) =>
    api<{ documentId: string; documentName: string; isNew: boolean; initialContent?: string }>(
      `/api/editor/bridge/workspace/${encodeURIComponent(filename)}`
    ),

  getProjectMapping: (projectId: string, filename: string) =>
    api<{ documentId: string; documentName: string; isNew: boolean; initialContent?: string }>(
      `/api/editor/bridge/project/${projectId}/${encodeURIComponent(filename)}`
    ),

  syncToFile: (documentId: string) =>
    api<{ success: boolean }>(
      `/api/editor/bridge/sync/${encodeURIComponent(documentId)}`,
      { method: 'POST' }
    ),
};
