import { query } from '../db/postgres.js';
import { redis } from '../db/redis.js';
import * as workspaceService from '../abilities/workspace.service.js';
import { classifyStepAction, type ApprovalClassification } from './approval-classifier.service.js';

type QueryResult = { rows: any[] };

// Type definitions
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
  redisExecutionKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ExecutionStep {
  id: string;
  projectId: string;
  stepNumber: number;
  goal: string;
  action: 'build' | 'modify' | 'run' | 'test' | 'deploy';
  artifact: string | null;
  agentName: string | null;
  agentContext: string | null;
  status: 'pending' | 'ready' | 'in_progress' | 'done' | 'failed' | 'blocked' | 'awaiting_approval';
  retryCount: number;
  maxRetries: number;
  output: string | null;
  errorMessage: string | null;
  requiresApproval: boolean;
  approvalReason: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  executionTimeMs: number | null;
}

export interface StepDependency {
  id: string;
  stepId: string;
  dependsOnStepId: string;
  dependencyType: 'requires' | 'optional' | 'conditional';
}

export interface ExecutionNode {
  step: ExecutionStep;
  dependencies: string[]; // step IDs this depends on
  dependents: string[]; // step IDs that depend on this
}

export interface ExecutionGraph {
  nodes: Map<string, ExecutionNode>;
  readySteps: string[]; // step IDs with all dependencies satisfied
}

export type ExecutionEventType =
  | 'execution_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'awaiting_approval'
  | 'approval_granted'
  | 'execution_paused'
  | 'execution_resumed'
  | 'execution_completed'
  | 'execution_failed';

export interface ExecutionEvent {
  type: ExecutionEventType;
  projectId: string;
  stepId?: string;
  stepNumber?: number;
  message: string;
  timestamp: Date;
  data?: any;
}

/**
 * Main orchestrator for executing project plans as DAGs
 */
export class PlannerOrchestrator {
  private projectId: string;
  private userId: string;
  private graph: ExecutionGraph | null = null;

  constructor(projectId: string, userId: string) {
    this.projectId = projectId;
    this.userId = userId;
  }

  /**
   * Main execution loop - executes steps in dependency order
   */
  async *execute(): AsyncGenerator<ExecutionEvent> {
    try {
      // Load project and build execution graph
      const project = await this.getProject();
      if (!project) {
        throw new Error('Project not found');
      }

      if (project.status === 'completed') {
        yield {
          type: 'execution_completed',
          projectId: this.projectId,
          message: 'Project already completed',
          timestamp: new Date(),
        };
        return;
      }

      // Mark as executing
      await this.updateProjectStatus('executing');
      yield {
        type: 'execution_started',
        projectId: this.projectId,
        message: `Starting execution of project: ${project.name}`,
        timestamp: new Date(),
      };

      // Build execution graph
      this.graph = await this.loadGraph();

      // Main execution loop
      while (true) {
        const readySteps = await this.getReadySteps();

        if (readySteps.length === 0) {
          // Check if we're waiting for approval
          const awaitingApproval = await this.hasAwaitingApproval();
          if (awaitingApproval) {
            yield {
              type: 'execution_paused',
              projectId: this.projectId,
              message: 'Execution paused - awaiting approval',
              timestamp: new Date(),
            };
            break; // Exit loop, will resume when approved
          }

          // Check if project is complete
          const isComplete = await this.isProjectComplete();
          if (isComplete) {
            await this.finalizeProject('completed');
            yield {
              type: 'execution_completed',
              projectId: this.projectId,
              message: 'All steps completed successfully',
              timestamp: new Date(),
            };
            break;
          }

          // No ready steps, not waiting, not complete = deadlock or failure
          const hasFailed = await this.hasFailedSteps();
          if (hasFailed) {
            await this.finalizeProject('failed');
            yield {
              type: 'execution_failed',
              projectId: this.projectId,
              message: 'Project failed - no more steps can execute',
              timestamp: new Date(),
            };
            break;
          }

          // Deadlock detection
          yield {
            type: 'execution_failed',
            projectId: this.projectId,
            message: 'Execution deadlock detected - no steps can proceed',
            timestamp: new Date(),
          };
          await this.finalizeProject('failed');
          break;
        }

        // Execute next ready step
        const nextStep = readySteps[0];
        yield* this.executeStep(nextStep);

        // Refresh graph after step completion
        this.graph = await this.loadGraph();
      }
    } catch (error: any) {
      yield {
        type: 'execution_failed',
        projectId: this.projectId,
        message: `Execution error: ${error.message}`,
        timestamp: new Date(),
        data: { error: error.stack },
      };
      await this.finalizeProject('failed');
    }
  }

  /**
   * Execute a single step: build → execute → observe → update
   */
  private async *executeStep(step: ExecutionStep): AsyncGenerator<ExecutionEvent> {
    const startTime = Date.now();

    try {
      // Mark step as in progress
      await this.updateStepStatus(step.id, 'in_progress', { startedAt: new Date() });

      yield {
        type: 'step_started',
        projectId: this.projectId,
        stepId: step.id,
        stepNumber: step.stepNumber,
        message: `Starting step ${step.stepNumber}: ${step.goal}`,
        timestamp: new Date(),
      };

      // Check if approval required
      if (step.requiresApproval && !step.approvedAt) {
        const classification = await classifyStepAction(step);

        if (classification.requiresApproval) {
          // Create approval request
          const approvalId = await this.requestApproval(step, classification);

          yield {
            type: 'awaiting_approval',
            projectId: this.projectId,
            stepId: step.id,
            stepNumber: step.stepNumber,
            message: `Approval required: ${classification.reason}`,
            timestamp: new Date(),
            data: {
              approvalId,
              riskLevel: classification.riskLevel,
              changeType: classification.changeType,
              affectedFiles: classification.affectedFiles,
            },
          };

          await this.updateStepStatus(step.id, 'awaiting_approval');
          await this.pause();
          return; // Exit, will resume when approved
        }
      }

      // BUILD: Generate artifacts via agent
      await this.buildStepContext(step);

      // For now, use a placeholder - actual agent integration would go here
      // This would call gemini-coder or claude-coder via abilities/agents.service.ts
      const agentOutput = `Generated code for: ${step.goal}`;

      // Extract files from agent output
      const files = this.extractFilesFromOutput(agentOutput);

      // Save files to workspace
      for (const file of files) {
        await workspaceService.writeFile(
          this.userId,
          `projects/${this.projectId}/${file.path}`,
          file.content
        );

        // Record artifact
        await this.recordArtifact(step.id, 'source_file', file.path, file.content);
      }

      // EXECUTE: Run if action is 'run' or 'test'
      let executionResult: any = { success: true, output: agentOutput };
      if (step.action === 'run' || step.action === 'test') {
        if (step.artifact) {
          // Execute the artifact file
          executionResult = await this.executeArtifact(step.artifact);
          await this.recordArtifact(step.id, 'output', step.artifact, executionResult.output);
        }
      }

      // OBSERVE: Check if step succeeded
      if (!executionResult.success) {
        throw new Error(executionResult.error || 'Execution failed');
      }

      // UPDATE: Mark step as done
      const executionTimeMs = Date.now() - startTime;
      await this.markStepDone(step.id, {
        output: agentOutput,
        executionTimeMs,
        completedAt: new Date(),
      });

      yield {
        type: 'step_completed',
        projectId: this.projectId,
        stepId: step.id,
        stepNumber: step.stepNumber,
        message: `Completed step ${step.stepNumber}: ${step.goal}`,
        timestamp: new Date(),
        data: { executionTimeMs, filesCreated: files.length },
      };

      // Unlock dependent steps
      await this.unlockDependents(step.id);

    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;
      yield* this.handleStepFailure(step, error, executionTimeMs);
    }
  }

  /**
   * Handle step failure with retry logic
   */
  private async *handleStepFailure(
    step: ExecutionStep,
    error: Error,
    executionTimeMs: number
  ): AsyncGenerator<ExecutionEvent> {
    const canRetry = step.retryCount < step.maxRetries;

    if (canRetry) {
      // Increment retry count, keep as ready
      await query(
        `UPDATE execution_steps
         SET retry_count = retry_count + 1,
             error_message = $1,
             status = 'ready',
             execution_time_ms = $2
         WHERE id = $3`,
        [error.message, executionTimeMs, step.id]
      );

      yield {
        type: 'step_failed',
        projectId: this.projectId,
        stepId: step.id,
        stepNumber: step.stepNumber,
        message: `Step ${step.stepNumber} failed, retrying (${step.retryCount + 1}/${step.maxRetries})`,
        timestamp: new Date(),
        data: { error: error.message, willRetry: true },
      };
    } else {
      // Max retries exceeded
      await query(
        `UPDATE execution_steps
         SET status = 'failed',
             error_message = $1,
             execution_time_ms = $2,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [error.message, executionTimeMs, step.id]
      );

      await query(
        `UPDATE execution_projects
         SET failed_steps = failed_steps + 1
         WHERE id = $1`,
        [this.projectId]
      );

      yield {
        type: 'step_failed',
        projectId: this.projectId,
        stepId: step.id,
        stepNumber: step.stepNumber,
        message: `Step ${step.stepNumber} failed permanently: ${error.message}`,
        timestamp: new Date(),
        data: { error: error.message, willRetry: false },
      };
    }
  }

  /**
   * Build execution graph from database
   */
  private async loadGraph(): Promise<ExecutionGraph> {
    const stepsResult = (await query(
      `SELECT * FROM execution_steps WHERE project_id = $1 ORDER BY step_number`,
      [this.projectId]
    )) as unknown as QueryResult;

    const depsResult = (await query(
      `SELECT * FROM step_dependencies sd
       WHERE sd.step_id IN (
         SELECT id FROM execution_steps WHERE project_id = $1
       )`,
      [this.projectId]
    )) as unknown as QueryResult;

    const nodes = new Map<string, ExecutionNode>();

    // Build nodes
    for (const row of stepsResult.rows) {
      const step = this.mapRowToStep(row);
      nodes.set(step.id, {
        step,
        dependencies: [],
        dependents: [],
      });
    }

    // Build edges
    for (const row of depsResult.rows) {
      const node = nodes.get(row.step_id);
      const depNode = nodes.get(row.depends_on_step_id);

      if (node && depNode) {
        node.dependencies.push(row.depends_on_step_id);
        depNode.dependents.push(row.step_id);
      }
    }

    return { nodes, readySteps: [] };
  }

  /**
   * Get steps ready to execute (all dependencies satisfied)
   */
  private async getReadySteps(): Promise<ExecutionStep[]> {
    if (!this.graph) {
      this.graph = await this.loadGraph();
    }

    const ready: ExecutionStep[] = [];

    // @ts-ignore - stepId used in loop but not in body (just for Map iteration)
    for (const [stepId, node] of this.graph.nodes) {
      const { step, dependencies } = node;

      // Skip if not in pending/ready state
      if (step.status !== 'pending' && step.status !== 'ready') {
        continue;
      }

      // Check all dependencies are satisfied
      const allDepsSatisfied = dependencies.every((depId) => {
        const depNode = this.graph!.nodes.get(depId);
        return depNode && depNode.step.status === 'done';
      });

      if (allDepsSatisfied) {
        ready.push(step);
      }
    }

    // Sort by step number
    return ready.sort((a, b) => a.stepNumber - b.stepNumber);
  }

  /**
   * Build context for agent execution
   */
  private async buildStepContext(step: ExecutionStep): Promise<any> {
    const project = await this.getProject();

    // Get previously completed steps output
    const prevSteps = (await query(
      `SELECT step_number, goal, artifact, output
       FROM execution_steps
       WHERE project_id = $1 AND step_number < $2 AND status = 'done'
       ORDER BY step_number`,
      [this.projectId, step.stepNumber]
    )) as unknown as QueryResult;

    return {
      projectName: project?.name,
      projectType: project?.projectType,
      projectDescription: project?.description,
      stepNumber: step.stepNumber,
      goal: step.goal,
      action: step.action,
      previousSteps: prevSteps.rows.map((r) => ({
        stepNumber: r.step_number,
        goal: r.goal,
        artifact: r.artifact,
        output: r.output,
      })),
      agentContext: step.agentContext ? JSON.parse(step.agentContext) : {},
    };
  }

  /**
   * Extract file blocks from agent output (```language:filename)
   */
  private extractFilesFromOutput(output: string): Array<{ path: string; content: string }> {
    const files: Array<{ path: string; content: string }> = [];
    const codeBlockRegex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;

    let match;
    while ((match = codeBlockRegex.exec(output)) !== null) {
      const [, , filename, content] = match;
      files.push({
        path: filename.trim(),
        content: content.trim(),
      });
    }

    return files;
  }

  /**
   * Execute an artifact file in sandbox
   */
  private async executeArtifact(_artifactPath: string): Promise<any> {
    try {
      // This would call sandbox service - placeholder for now
      // const result = await sandboxService.executeWorkspaceFile(this.userId, artifactPath);
      return { success: true, output: 'Execution successful' };
    } catch (error: any) {
      return { success: false, error: error.message, output: error.toString() };
    }
  }

  /**
   * Record artifact in database
   */
  private async recordArtifact(
    stepId: string,
    artifactType: string,
    artifactPath: string,
    content: string
  ): Promise<void> {
    const size = content.length;
    const path = artifactPath;
    await query(
      `INSERT INTO execution_artifacts (step_id, project_id, artifact_type, artifact_path, content, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [stepId, this.projectId, artifactType, path, content, size]
    );
  }

  /**
   * Create approval request
   */
  private async requestApproval(
    step: ExecutionStep,
    classification: ApprovalClassification
  ): Promise<string> {
    const result = (await query(
      `INSERT INTO step_approval_requests
        (step_id, project_id, user_id, action_description, risk_level, change_type, affected_files)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        step.id,
        this.projectId,
        this.userId,
        step.goal,
        classification.riskLevel,
        classification.changeType,
        classification.affectedFiles,
      ]
    )) as unknown as QueryResult;

    return result.rows[0].id;
  }

  /**
   * Pause execution and save state to Redis
   */
  private async pause(): Promise<void> {
    const redisKey = `execution:state:${this.projectId}`;
    await redis.setex(redisKey, 86400, JSON.stringify({ paused: true })); // 24h TTL
    await this.updateProjectStatus('paused', { redisExecutionKey: redisKey });
  }

  /**
   * Resume execution from paused state
   */
  async resume(): Promise<void> {
    const redisKey = `execution:state:${this.projectId}`;
    await redis.del(redisKey);
    await this.updateProjectStatus('executing', { redisExecutionKey: null });
  }

  /**
   * Mark step as done and update counters
   */
  private async markStepDone(stepId: string, updates: any): Promise<void> {
    await query(
      `UPDATE execution_steps
       SET status = 'done',
           output = $1,
           execution_time_ms = $2,
           completed_at = $3
       WHERE id = $4`,
      [updates.output, updates.executionTimeMs, updates.completedAt, stepId]
    );

    await query(
      `UPDATE execution_projects
       SET completed_steps = completed_steps + 1
       WHERE id = $1`,
      [this.projectId]
    );
  }

  /**
   * Unlock steps that depended on this one
   */
  private async unlockDependents(stepId: string): Promise<void> {
    // Get steps that depend on this one
    const result = await query(
      `SELECT DISTINCT es.id
       FROM execution_steps es
       JOIN step_dependencies sd ON sd.step_id = es.id
       WHERE sd.depends_on_step_id = $1 AND es.status = 'blocked'`,
      [stepId]
    );

    // Check if each dependent can now be unblocked
    for (const row of (result as any).rows) {
      const allDepsSatisfied = await this.checkDependenciesSatisfied(row.id);
      if (allDepsSatisfied) {
        await this.updateStepStatus(row.id, 'ready');
      }
    }
  }

  /**
   * Check if all dependencies for a step are satisfied
   */
  private async checkDependenciesSatisfied(stepId: string): Promise<boolean> {
    const result = (await query(
      `SELECT COUNT(*) as incomplete
       FROM step_dependencies sd
       JOIN execution_steps es ON es.id = sd.depends_on_step_id
       WHERE sd.step_id = $1 AND es.status != 'done'`,
      [stepId]
    )) as unknown as QueryResult;

    return parseInt(result.rows[0].incomplete) === 0;
  }

  /**
   * Finalize project execution
   */
  private async finalizeProject(status: 'completed' | 'failed'): Promise<void> {
    const redisKey = `execution:state:${this.projectId}`;
    await redis.del(redisKey);

    await query(
      `UPDATE execution_projects
       SET status = $1,
           completed_at = CURRENT_TIMESTAMP,
           redis_execution_key = NULL
       WHERE id = $2`,
      [status, this.projectId]
    );
  }

  /**
   * Helper methods
   */
  private async getProject(): Promise<ExecutionProject | null> {
    const result = (await query(
      `SELECT * FROM execution_projects WHERE id = $1`,
      [this.projectId]
    )) as unknown as QueryResult;

    if (result.rows.length === 0) return null;
    return this.mapRowToProject(result.rows[0]);
  }

  private async updateProjectStatus(status: string, updates: any = {}): Promise<void> {
    const sets = [`status = $1`];
    const values = [status, this.projectId];
    let paramIndex = 2;

    if (status === 'executing' && !updates.startedAt) {
      sets.push(`started_at = CURRENT_TIMESTAMP`);
    }

    if (updates.redisExecutionKey !== undefined) {
      sets.push(`redis_execution_key = $${++paramIndex}`);
      values.splice(paramIndex - 1, 0, updates.redisExecutionKey);
    }

    await query(
      `UPDATE execution_projects SET ${sets.join(', ')} WHERE id = $2`,
      values
    );
  }

  private async updateStepStatus(stepId: string, status: string, updates: any = {}): Promise<void> {
    const sets = [`status = $1`];
    const values = [status, stepId];
    let paramIndex = 2;

    if (updates.startedAt) {
      sets.push(`started_at = $${++paramIndex}`);
      values.splice(paramIndex - 1, 0, updates.startedAt);
    }

    await query(
      `UPDATE execution_steps SET ${sets.join(', ')} WHERE id = $2`,
      values
    );
  }

  private async hasAwaitingApproval(): Promise<boolean> {
    const result = (await query(
      `SELECT COUNT(*) as count FROM execution_steps
       WHERE project_id = $1 AND status = 'awaiting_approval'`,
      [this.projectId]
    )) as unknown as QueryResult;
    return parseInt(result.rows[0].count) > 0;
  }

  private async isProjectComplete(): Promise<boolean> {
    const result = (await query(
      `SELECT total_steps, completed_steps FROM execution_projects WHERE id = $1`,
      [this.projectId]
    )) as unknown as QueryResult;
    const { total_steps, completed_steps } = result.rows[0];
    return total_steps === completed_steps;
  }

  private async hasFailedSteps(): Promise<boolean> {
    const result = (await query(
      `SELECT failed_steps FROM execution_projects WHERE id = $1`,
      [this.projectId]
    )) as unknown as QueryResult;
    return result.rows[0].failed_steps > 0;
  }

  private mapRowToProject(row: any): ExecutionProject {
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      name: row.name,
      description: row.description,
      projectType: row.project_type,
      status: row.status,
      totalSteps: row.total_steps,
      completedSteps: row.completed_steps,
      failedSteps: row.failed_steps,
      redisExecutionKey: row.redis_execution_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  private mapRowToStep(row: any): ExecutionStep {
    return {
      id: row.id,
      projectId: row.project_id,
      stepNumber: row.step_number,
      goal: row.goal,
      action: row.action,
      artifact: row.artifact,
      agentName: row.agent_name,
      agentContext: row.agent_context,
      status: row.status,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      output: row.output,
      errorMessage: row.error_message,
      requiresApproval: row.requires_approval,
      approvalReason: row.approval_reason,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      executionTimeMs: row.execution_time_ms,
    };
  }
}
