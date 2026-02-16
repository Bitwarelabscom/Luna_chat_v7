import { api } from './core';

// ==================== Projects API ====================

export interface ProjectQuestion {
  id: string;
  question: string;
  category: string;
  required: boolean;
}

export interface ProjectStep {
  id: string;
  stepNumber: number;
  description: string;
  stepType: string;
  filename?: string;
  requiresApproval: boolean;
  status: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProjectFile {
  id: string;
  filename: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  isGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  sessionId: string | null;
  name: string;
  description: string;
  type: 'web' | 'fullstack' | 'python' | 'node';
  status: 'planning' | 'questioning' | 'building' | 'paused' | 'review' | 'complete' | 'error' | 'cancelled';
  currentStep: number;
  plan: ProjectStep[];
  questions: ProjectQuestion[];
  answers: Record<string, unknown>;
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
}

export const projectsApi = {
  // List user's projects
  list: () =>
    api<{ projects: Project[] }>('/api/projects'),

  // Get single project
  get: (id: string) =>
    api<{ project: Project }>(`/api/projects/${id}`),

  // Get active project
  getActive: () =>
    api<{ project: Project | null }>('/api/projects/active'),

  // Create new project
  create: (data: { name: string; description?: string; type?: string; sessionId?: string }) =>
    api<{ project: Project }>('/api/projects', { method: 'POST', body: data }),

  // Update project status
  updateStatus: (id: string, status: string, currentStep?: number) =>
    api<{ success: boolean }>(`/api/projects/${id}/status`, {
      method: 'PUT',
      body: { status, currentStep },
    }),

  // Set project questions
  setQuestions: (id: string, questions: Omit<ProjectQuestion, 'id'>[]) =>
    api<{ success: boolean }>(`/api/projects/${id}/questions`, {
      method: 'POST',
      body: { questions },
    }),

  // Save answers
  saveAnswers: (id: string, answers: Record<string, unknown>) =>
    api<{ success: boolean }>(`/api/projects/${id}/answers`, {
      method: 'POST',
      body: { answers },
    }),

  // Set project plan
  setPlan: (id: string, steps: Omit<ProjectStep, 'id'>[]) =>
    api<{ success: boolean; steps: ProjectStep[] }>(`/api/projects/${id}/plan`, {
      method: 'POST',
      body: { steps },
    }),

  // Update step status
  updateStep: (id: string, stepNumber: number, status: string, result?: string, error?: string) =>
    api<{ success: boolean }>(`/api/projects/${id}/steps/${stepNumber}`, {
      method: 'PUT',
      body: { status, result, error },
    }),

  // Get project files
  getFiles: (id: string) =>
    api<{ files: ProjectFile[] }>(`/api/projects/${id}/files`),

  // Read project file
  getFile: (id: string, filename: string) =>
    api<{ content: string; filename: string }>(`/api/projects/${id}/files/${encodeURIComponent(filename)}`),

  // Write project file
  writeFile: (id: string, filename: string, content: string, fileType?: string) =>
    api<{ file: ProjectFile }>(`/api/projects/${id}/files`, {
      method: 'POST',
      body: { filename, content, fileType },
    }),

  // Delete project
  delete: (id: string) =>
    api<{ success: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
};
