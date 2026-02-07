import express from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { query as dbQuery } from '../db/postgres.js';
import { PlannerOrchestrator } from './planner-orchestrator.service.js';

const router = express.Router();

// Simple wrapper to assert query result type
async function query(sql: string, params?: any[]): Promise<any> {
  const result = await dbQuery(sql, params);
  return result;
}

/**
 * Create new execution project
 */
router.post('/projects', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, projectType, sessionId, steps } = req.body;

    if (!name || !projectType || !steps || !Array.isArray(steps)) {
      res.status(400).json({
        error: 'Missing required fields: name, projectType, steps',
      });
      return;
    }

    // Create project
    const projectResult = await query(
      `INSERT INTO execution_projects (user_id, session_id, name, description, project_type, total_steps)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, sessionId || null, name, description || null, projectType, steps.length]
    );

    const project = projectResult.rows[0];

    // Create steps
    const stepIdMap = new Map<number, string>();

    for (const step of steps) {
      const stepResult = await query(
        `INSERT INTO execution_steps
          (project_id, step_number, goal, action, artifact, agent_name, agent_context, requires_approval, max_retries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          project.id,
          step.stepNumber,
          step.goal,
          step.action,
          step.artifact || null,
          step.agentName || 'gemini-coder',
          step.agentContext ? JSON.stringify(step.agentContext) : null,
          step.requiresApproval !== undefined ? step.requiresApproval : true,
          step.maxRetries || 2,
        ]
      );

      stepIdMap.set(step.stepNumber, stepResult.rows[0].id);
    }

    // Create dependencies
    for (const step of steps) {
      if (step.dependencies && Array.isArray(step.dependencies)) {
        for (const depStepNumber of step.dependencies) {
          const stepId = stepIdMap.get(step.stepNumber);
          const depStepId = stepIdMap.get(depStepNumber);

          if (stepId && depStepId) {
            await query(
              `INSERT INTO step_dependencies (step_id, depends_on_step_id, dependency_type)
               VALUES ($1, $2, $3)`,
              [stepId, depStepId, 'requires']
            );
          }
        }
      }
    }

    res.status(201).json({
      projectId: project.id,
      name: project.name,
      status: project.status,
      totalSteps: project.total_steps,
    });
  } catch (error: any) {
    console.error('Error creating execution project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * List user's execution projects
 */
router.get('/projects', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, limit = '20', offset = '0' } = req.query;

    let sql = `
      SELECT id, name, description, project_type, status, total_steps, completed_steps, failed_steps,
             created_at, updated_at, started_at, completed_at
      FROM execution_projects
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await query(sql, params);

    res.json({
      projects: result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        projectType: row.project_type,
        status: row.status,
        totalSteps: row.total_steps,
        completedSteps: row.completed_steps,
        failedSteps: row.failed_steps,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      })),
    });
  } catch (error: any) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * Get project details
 */
router.get('/projects/:id', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const projectResult = await query(
      `SELECT * FROM execution_projects WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const stepsResult = await query(
      `SELECT * FROM execution_steps WHERE project_id = $1 ORDER BY step_number`,
      [id]
    );

    const depsResult = await query(
      `SELECT sd.*, es1.step_number as step_num, es2.step_number as depends_on_step_num
       FROM step_dependencies sd
       JOIN execution_steps es1 ON sd.step_id = es1.id
       JOIN execution_steps es2 ON sd.depends_on_step_id = es2.id
       WHERE es1.project_id = $1`,
      [id]
    );

    res.json({
      project: projectResult.rows[0],
      steps: stepsResult.rows,
      dependencies: depsResult.rows.map((row: any) => ({
        stepNumber: row.step_num,
        dependsOn: row.depends_on_step_num,
        dependencyType: row.dependency_type,
      })),
    });
  } catch (error: any) {
    console.error('Error getting project:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * Execute project (SSE streaming)
 */
router.post('/projects/:id/execute', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const projectResult = await query(
      `SELECT * FROM execution_projects WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const orchestrator = new PlannerOrchestrator(id, userId);

    for await (const event of orchestrator.execute()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.end();
  } catch (error: any) {
    console.error('Error executing project:', error);
    res.status(500).json({ error: 'Failed to execute project' });
  }
});

/**
 * Pause project execution
 */
router.post('/projects/:id/pause', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const projectResult = await query(
      `SELECT * FROM execution_projects WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await query(
      `UPDATE execution_projects SET status = 'paused' WHERE id = $1`,
      [id]
    );

    res.json({ success: true, status: 'paused' });
  } catch (error: any) {
    console.error('Error pausing project:', error);
    res.status(500).json({ error: 'Failed to pause project' });
  }
});

/**
 * Get project steps with dependencies (graph structure)
 */
router.get('/projects/:id/steps', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const projectResult = await query(
      `SELECT * FROM execution_projects WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const stepsResult = await query(
      `SELECT * FROM execution_steps WHERE project_id = $1 ORDER BY step_number`,
      [id]
    );

    const depsResult = await query(
      `SELECT sd.step_id, sd.depends_on_step_id, sd.dependency_type,
              es1.step_number as step_num, es2.step_number as depends_on_step_num
       FROM step_dependencies sd
       JOIN execution_steps es1 ON sd.step_id = es1.id
       JOIN execution_steps es2 ON sd.depends_on_step_id = es2.id
       WHERE es1.project_id = $1`,
      [id]
    );

    // Build graph structure with typed nodes
    const nodes: Array<{
      id: string;
      stepNumber: number;
      goal: string;
      action: string;
      status: string;
      dependencies: number[];
      dependents: number[];
    }> = stepsResult.rows.map((row: any) => ({
      id: row.id,
      stepNumber: row.step_number,
      goal: row.goal,
      action: row.action,
      status: row.status,
      dependencies: [] as number[],
      dependents: [] as number[],
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    for (const dep of depsResult.rows) {
      const node = nodeMap.get(dep.step_id);
      const depNode = nodeMap.get(dep.depends_on_step_id);

      if (node && depNode) {
        node.dependencies.push(depNode.stepNumber);
        depNode.dependents.push(node.stepNumber);
      }
    }

    res.json({ graph: { nodes } });
  } catch (error: any) {
    console.error('Error getting project steps:', error);
    res.status(500).json({ error: 'Failed to get steps' });
  }
});

/**
 * Approve step
 */
router.post('/approvals/:id/approve', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const approvalResult = await query(
      `SELECT * FROM step_approval_requests WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (approvalResult.rows.length === 0) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }

    const approval = approvalResult.rows[0];

    await query(
      `UPDATE step_approval_requests
       SET status = 'approved', responded_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    await query(
      `UPDATE execution_steps
       SET status = 'ready', approved_by = $1, approved_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [userId, approval.step_id]
    );

    // Resume project execution
    const orchestrator = new PlannerOrchestrator(approval.project_id, userId);
    await orchestrator.resume();

    res.json({ success: true, status: 'approved' });
  } catch (error: any) {
    console.error('Error approving step:', error);
    res.status(500).json({ error: 'Failed to approve step' });
  }
});

/**
 * Reject step
 */
router.post('/approvals/:id/reject', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { reason } = req.body;

    const approvalResult = await query(
      `SELECT * FROM step_approval_requests WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (approvalResult.rows.length === 0) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }

    const approval = approvalResult.rows[0];

    await query(
      `UPDATE step_approval_requests
       SET status = 'rejected', response_message = $1, responded_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [reason || 'Rejected by user', id]
    );

    await query(
      `UPDATE execution_steps
       SET status = 'failed', error_message = $1
       WHERE id = $2`,
      ['Rejected by user: ' + (reason || 'No reason provided'), approval.step_id]
    );

    await query(
      `UPDATE execution_projects
       SET status = 'failed', failed_steps = failed_steps + 1
       WHERE id = $1`,
      [approval.project_id]
    );

    res.json({ success: true, status: 'rejected' });
  } catch (error: any) {
    console.error('Error rejecting step:', error);
    res.status(500).json({ error: 'Failed to reject step' });
  }
});

/**
 * Update step (for manual modifications)
 */
router.patch('/steps/:id', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updates = req.body;

    const stepResult = await query(
      `SELECT es.* FROM execution_steps es
       JOIN execution_projects ep ON es.project_id = ep.id
       WHERE es.id = $1 AND ep.user_id = $2`,
      [id, userId]
    );

    if (stepResult.rows.length === 0) {
      res.status(404).json({ error: 'Step not found' });
      return;
    }

    const allowedFields = ['goal', 'action', 'artifact', 'agent_name', 'status', 'max_retries'];
    const sets: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(snakeKey)) {
        sets.push(`${snakeKey} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (sets.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    values.push(id);

    await query(
      `UPDATE execution_steps SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating step:', error);
    res.status(500).json({ error: 'Failed to update step' });
  }
});

export default router;
