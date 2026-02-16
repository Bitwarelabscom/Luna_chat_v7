import { api, API_PREFIX, downloadApiFile } from './core';

// ==================== Canvas API ====================

export interface CanvasArtifactContent {
  id: string;
  index: number;
  type: 'code' | 'text';
  title: string;
  language?: string;
  content: string;
  createdAt: string;
}

export interface CanvasArtifact {
  id: string;
  userId: string;
  sessionId: string | null;
  currentIndex: number;
  contents: CanvasArtifactContent[];
  createdAt: string;
  updatedAt: string;
}

export interface CanvasArtifactSummary {
  id: string;
  sessionId: string | null;
  currentIndex: number;
  title: string;
  type: 'code' | 'text';
  language?: string;
  updatedAt: string;
}

export interface CanvasArtifactFile {
  id: string;
  path: string;
  fileType: 'code' | 'text' | 'image' | 'asset';
  language?: string;
  storage: 'db' | 'fs';
  content?: string;
  fsPath?: string;
  mimeType?: string;
  sizeBytes?: number;
  updatedAt: string;
}

export interface CanvasSnapshot {
  versionIndex: number;
  createdAt: string;
  entryFile?: string;
}

export const canvasApi = {
  listArtifacts: (params?: { sessionId?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.sessionId) searchParams.set('sessionId', params.sessionId);
    if (typeof params?.limit === 'number') searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return api<CanvasArtifactSummary[]>(`/api/canvas/artifacts${query ? `?${query}` : ''}`);
  },

  getArtifact: (id: string) =>
    api<CanvasArtifact>(`/api/canvas/artifacts/${id}`),

  listFiles: (id: string, index?: number) =>
    api<CanvasArtifactFile[]>(`/api/canvas/artifacts/${id}/files${typeof index === 'number' ? `?index=${index}` : ''}`),

  saveFile: (id: string, path: string, content: string, language?: string) =>
    api<{ versionIndex: number }>(`/api/canvas/artifacts/${id}/files`, {
      method: 'POST',
      body: { path, content, language },
    }),

  listSnapshots: (id: string) =>
    api<CanvasSnapshot[]>(`/api/canvas/artifacts/${id}/snapshots`),

  generateImage: (
    id: string,
    prompt: string,
    options?: { filename?: string; autoInsert?: boolean }
  ) =>
    api<{ assetPath: string; versionIndex: number }>(`/api/canvas/artifacts/${id}/images/generate`, {
      method: 'POST',
      body: {
        prompt,
        filename: options?.filename,
        autoInsert: options?.autoInsert ?? true,
      },
    }),

  downloadArtifact: (id: string, index?: number) =>
    downloadApiFile(`/api/canvas/artifacts/${id}/download${typeof index === 'number' ? `?index=${index}` : ''}`),

  downloadProjectZip: (id: string, index?: number) =>
    downloadApiFile(`/api/canvas/artifacts/${id}/export.zip${typeof index === 'number' ? `?index=${index}` : ''}`),
};

export function canvasArtifactAssetBaseUrl(artifactId: string): string {
  // Must stay same-origin for iframe preview (avoids CORP/CORS issues on :3005 direct host)
  return `${API_PREFIX}/api/canvas/artifacts/${artifactId}/assets/`;
}
