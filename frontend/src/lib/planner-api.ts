import { api } from './api';

export interface ExecutionProject {
  id: string;
  userId: string;
  sessionId: string | null;
  name: string;
  description: string | null;
  projectType: string;
  status: 'ready' | 'executing' | 'paused' | 'completed' | 'failed';
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExecutionStep {
  id: string;
  stepNumber: number;
  goal: string;
  action: 'build' | 'modify' | 'run' | 'test' | 'deploy';
  artifact: string | null;
  agentName: string | null;
  status: 'pending' | 'ready' | 'in_progress' | 'done' | 'failed' | 'blocked' | 'awaiting_approval';
  retryCount: number;
  maxRetries: number;
  output: string | null;
  errorMessage: string | null;
  requiresApproval: boolean;
  approvedAt: string | null;
  executionTimeMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StepDependency {
  stepNumber: number;
  dependsOn: number;
  dependencyType: 'requires' | 'optional' | 'conditional';
}

export interface GraphNode {
  id: string;
  stepNumber: number;
  goal: string;
  action: string;
  status: string;
  dependencies: number[];
  dependents: number[];
}

export interface ExecutionEvent {
  type: string;
  projectId: string;
  stepId?: string;
  stepNumber?: number;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  projectType: string;
  sessionId?: string;
  steps: Array<{
    stepNumber: number;
    goal: string;
    action: 'build' | 'modify' | 'run' | 'test' | 'deploy';
    artifact?: string;
    agentName?: string;
    agentContext?: Record<string, unknown>;
    requiresApproval?: boolean;
    maxRetries?: number;
    dependencies?: number[];
  }>;
}

export interface CreateProjectResponse {
  projectId: string;
  name: string;
  status: string;
  totalSteps: number;
}

export interface GetProjectResponse {
  project: ExecutionProject;
  steps: ExecutionStep[];
  dependencies: StepDependency[];
}

export interface ListProjectsResponse {
  projects: ExecutionProject[];
}

export interface GetGraphResponse {
  graph: {
    nodes: GraphNode[];
  };
}

/**
 * Planner API client
 */
export const plannerApi = {
  async createProject(data: CreateProjectRequest): Promise<CreateProjectResponse> {
    return api<CreateProjectResponse>('/api/planner/projects', {
      method: 'POST',
      body: data,
    });
  },

  async listProjects(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListProjectsResponse> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());

    const qs = query.toString();
    return api<ListProjectsResponse>(`/api/planner/projects${qs ? `?${qs}` : ''}`);
  },

  async getProject(projectId: string): Promise<GetProjectResponse> {
    return api<GetProjectResponse>(`/api/planner/projects/${projectId}`);
  },

  async getGraph(projectId: string): Promise<GetGraphResponse> {
    return api<GetGraphResponse>(`/api/planner/projects/${projectId}/steps`);
  },

  executeProject(projectId: string): EventSource {
    return new EventSource(`/api/planner/projects/${projectId}/execute`);
  },

  async pauseProject(projectId: string): Promise<{ success: boolean; status: string }> {
    return api<{ success: boolean; status: string }>(`/api/planner/projects/${projectId}/pause`, {
      method: 'POST',
    });
  },

  async approveStep(approvalId: string): Promise<{ success: boolean; status: string }> {
    return api<{ success: boolean; status: string }>(`/api/planner/approvals/${approvalId}/approve`, {
      method: 'POST',
    });
  },

  async rejectStep(
    approvalId: string,
    reason?: string
  ): Promise<{ success: boolean; status: string }> {
    return api<{ success: boolean; status: string }>(`/api/planner/approvals/${approvalId}/reject`, {
      method: 'POST',
      body: { reason },
    });
  },

  async updateStep(
    stepId: string,
    updates: Partial<{
      goal: string;
      action: string;
      artifact: string;
      agentName: string;
      status: string;
      maxRetries: number;
    }>
  ): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(`/api/planner/steps/${stepId}`, {
      method: 'PATCH',
      body: updates,
    });
  },

  async deleteProject(projectId: string): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(`/api/planner/projects/${projectId}`, {
      method: 'DELETE',
    });
  },
};
