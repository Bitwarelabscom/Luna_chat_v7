import { pool } from '../db/index.js';
import { claimRunSlot, enqueueCeoMessage, getLocalTimeParts, getOrCreateConfig, getDashboard } from './ceo.service.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import * as workspaceService from '../abilities/workspace.service.js';
import { DEPARTMENTS, DEPARTMENT_MAP, type DepartmentSlug } from '../persona/luna.persona.js';
import { createProposal } from './ceo-proposals.service.js';
import { createMemo } from './ceo-memos.service.js';
import type { ChatMessage } from '../llm/types.js';
import logger from '../utils/logger.js';

// ============================================================
// Types
// ============================================================

export interface OrgTask {
  id: string;
  userId: string;
  departmentSlug: DepartmentSlug;
  title: string;
  description: string | null;
  riskLevel: 'low' | 'high';
  status: 'pending' | 'in_progress' | 'done' | 'approved' | 'rejected';
  priority: number;
  source: string;
  assignedBy: string | null;
  resultSummary: string | null;
  resultFilePath: string | null;
  weekLabel: string | null;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  executionStatus: 'running' | 'completed' | 'failed' | null;
  executionStartedAt: string | null;
  executionCompletedAt: string | null;
  suggestedBy: 'manual' | 'ceo_chat' | 'department' | 'weekly_plan' | null;
}

export interface WeeklyGoal {
  id: string;
  userId: string;
  weekLabel: string;
  departmentSlug: DepartmentSlug;
  goalText: string;
  status: 'active' | 'completed' | 'dropped';
  progressPct: number;
  createdAt: string;
}

export interface AbilityProposal {
  id: string;
  userId: string;
  departmentSlug: DepartmentSlug;
  title: string;
  description: string | null;
  rationale: string | null;
  estimatedEffort: string | null;
  status: 'proposed' | 'approved' | 'rejected' | 'implemented';
  createdAt: string;
}

export interface RecommendedAction {
  id: string;
  userId: string;
  departmentSlug: DepartmentSlug;
  title: string;
  description: string | null;
  priority: number;
  category: string | null;
  status: 'open' | 'dismissed' | 'done';
  createdAt: string;
}

export interface DepartmentSummary {
  slug: DepartmentSlug;
  name: string;
  persona: string;
  focus: string[];
  pendingTasks: number;
  doneTasks: number;
  highRiskPending: number;
}

// ============================================================
// Helpers
// ============================================================

function getWeekLabel(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

function mapTaskRow(row: Record<string, unknown>): OrgTask {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    departmentSlug: row.department_slug as DepartmentSlug,
    title: row.title as string,
    description: row.description as string | null,
    riskLevel: row.risk_level as 'low' | 'high',
    status: row.status as OrgTask['status'],
    priority: row.priority as number,
    source: row.source as string,
    assignedBy: row.assigned_by as string | null,
    resultSummary: row.result_summary as string | null,
    resultFilePath: row.result_file_path as string | null,
    weekLabel: row.week_label as string | null,
    dueDate: row.due_date ? String(row.due_date) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
    executionStatus: (row.execution_status as OrgTask['executionStatus']) || null,
    executionStartedAt: row.execution_started_at ? String(row.execution_started_at) : null,
    executionCompletedAt: row.execution_completed_at ? String(row.execution_completed_at) : null,
    suggestedBy: (row.suggested_by as OrgTask['suggestedBy']) || null,
  };
}

function mapGoalRow(row: Record<string, unknown>): WeeklyGoal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    weekLabel: row.week_label as string,
    departmentSlug: row.department_slug as DepartmentSlug,
    goalText: row.goal_text as string,
    status: row.status as WeeklyGoal['status'],
    progressPct: row.progress_pct as number,
    createdAt: String(row.created_at),
  };
}

function mapProposalRow(row: Record<string, unknown>): AbilityProposal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    departmentSlug: row.department_slug as DepartmentSlug,
    title: row.title as string,
    description: row.description as string | null,
    rationale: row.rationale as string | null,
    estimatedEffort: row.estimated_effort as string | null,
    status: row.status as AbilityProposal['status'],
    createdAt: String(row.created_at),
  };
}

function mapActionRow(row: Record<string, unknown>): RecommendedAction {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    departmentSlug: row.department_slug as DepartmentSlug,
    title: row.title as string,
    description: row.description as string | null,
    priority: row.priority as number,
    category: row.category as string | null,
    status: row.status as RecommendedAction['status'],
    createdAt: String(row.created_at),
  };
}

async function callOrgLlm(userId: string, systemPrompt: string, userMessage: string): Promise<string> {
  const config = await getBackgroundFeatureModelConfig(userId, 'ceo_org_execution');
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await createCompletion(config.primary.provider, config.primary.model, messages, {
      temperature: 0.4,
      maxTokens: 2048,
    });
    return result.content;
  } catch (primaryErr) {
    logger.warn('CEO org primary LLM failed, trying fallback', { error: (primaryErr as Error).message });
    const fallback = await createCompletion(config.fallback.provider, config.fallback.model, messages, {
      temperature: 0.4,
      maxTokens: 2048,
    });
    return fallback.content;
  }
}

// ============================================================
// Department Overview
// ============================================================

export async function getDepartmentOverview(userId: string): Promise<DepartmentSummary[]> {
  const countResult = await pool.query(
    `SELECT department_slug,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'done') AS done,
            COUNT(*) FILTER (WHERE status = 'pending' AND risk_level = 'high') AS high_risk_pending
     FROM ceo_org_tasks
     WHERE user_id = $1
     GROUP BY department_slug`,
    [userId]
  );

  const countMap = new Map<string, { pending: number; done: number; highRiskPending: number }>();
  for (const row of countResult.rows as Array<Record<string, unknown>>) {
    countMap.set(row.department_slug as string, {
      pending: Number(row.pending) || 0,
      done: Number(row.done) || 0,
      highRiskPending: Number(row.high_risk_pending) || 0,
    });
  }

  return DEPARTMENTS.map((dept) => {
    const counts = countMap.get(dept.slug) || { pending: 0, done: 0, highRiskPending: 0 };
    return {
      slug: dept.slug,
      name: dept.name,
      persona: dept.persona,
      focus: dept.focus,
      pendingTasks: counts.pending,
      doneTasks: counts.done,
      highRiskPending: counts.highRiskPending,
    };
  });
}

// ============================================================
// Task CRUD
// ============================================================

export async function listTasks(
  userId: string,
  filters: { department?: string; status?: string; week?: string } = {}
): Promise<OrgTask[]> {
  const conditions = ['user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  if (filters.department) {
    conditions.push(`department_slug = $${idx++}`);
    params.push(filters.department);
  }
  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.week) {
    conditions.push(`week_label = $${idx++}`);
    params.push(filters.week);
  }

  const result = await pool.query(
    `SELECT * FROM ceo_org_tasks WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, created_at DESC LIMIT 200`,
    params
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapTaskRow);
}

export async function createTask(
  userId: string,
  data: {
    departmentSlug: DepartmentSlug;
    title: string;
    description?: string;
    riskLevel?: 'low' | 'high';
    priority?: number;
    source?: string;
    assignedBy?: string;
    weekLabel?: string;
    dueDate?: string;
    suggestedBy?: 'manual' | 'ceo_chat' | 'department' | 'weekly_plan';
  }
): Promise<OrgTask> {
  const result = await pool.query(
    `INSERT INTO ceo_org_tasks (user_id, department_slug, title, description, risk_level, priority, source, assigned_by, week_label, due_date, suggested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      userId,
      data.departmentSlug,
      data.title,
      data.description || null,
      data.riskLevel || 'low',
      data.priority || 5,
      data.source || 'manual',
      data.assignedBy || null,
      data.weekLabel || null,
      data.dueDate || null,
      data.suggestedBy || 'manual',
    ]
  );
  return mapTaskRow(result.rows[0] as Record<string, unknown>);
}

export async function updateTask(
  userId: string,
  taskId: string,
  updates: { status?: string; priority?: number; resultSummary?: string; resultFilePath?: string }
): Promise<OrgTask | null> {
  const sets: string[] = [];
  const params: unknown[] = [userId, taskId];
  let idx = 3;

  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
    if (updates.status === 'in_progress') {
      sets.push(`started_at = NOW()`);
    } else if (updates.status === 'done' || updates.status === 'approved' || updates.status === 'rejected') {
      sets.push(`completed_at = NOW()`);
    }
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    params.push(updates.priority);
  }
  if (updates.resultSummary !== undefined) {
    sets.push(`result_summary = $${idx++}`);
    params.push(updates.resultSummary);
  }
  if (updates.resultFilePath !== undefined) {
    sets.push(`result_file_path = $${idx++}`);
    params.push(updates.resultFilePath);
  }

  if (sets.length === 0) return null;

  const result = await pool.query(
    `UPDATE ceo_org_tasks SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING *`,
    params
  );
  if (result.rowCount === 0) return null;
  return mapTaskRow(result.rows[0] as Record<string, unknown>);
}

// ============================================================
// Weekly Goals
// ============================================================

export async function listGoals(userId: string, week?: string): Promise<WeeklyGoal[]> {
  const weekLabel = week || getWeekLabel();
  const result = await pool.query(
    `SELECT * FROM ceo_weekly_goals WHERE user_id = $1 AND week_label = $2 ORDER BY department_slug`,
    [userId, weekLabel]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapGoalRow);
}

export async function updateGoal(
  userId: string,
  goalId: string,
  updates: { status?: string; progressPct?: number }
): Promise<WeeklyGoal | null> {
  const sets: string[] = [];
  const params: unknown[] = [userId, goalId];
  let idx = 3;

  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
  }
  if (updates.progressPct !== undefined) {
    sets.push(`progress_pct = $${idx++}`);
    params.push(updates.progressPct);
  }

  if (sets.length === 0) return null;

  const result = await pool.query(
    `UPDATE ceo_weekly_goals SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING *`,
    params
  );
  if (result.rowCount === 0) return null;
  return mapGoalRow(result.rows[0] as Record<string, unknown>);
}

// ============================================================
// Ability Proposals
// ============================================================

export async function listProposals(userId: string, status?: string): Promise<AbilityProposal[]> {
  const cond = status ? `AND status = $2` : '';
  const params: unknown[] = status ? [userId, status] : [userId];
  const result = await pool.query(
    `SELECT * FROM ceo_ability_proposals WHERE user_id = $1 ${cond} ORDER BY created_at DESC LIMIT 50`,
    params
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapProposalRow);
}

export async function updateProposalStatus(userId: string, proposalId: string, status: 'approved' | 'rejected'): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ceo_ability_proposals SET status = $3 WHERE user_id = $1 AND id = $2 AND status = 'proposed'`,
    [userId, proposalId, status]
  );
  return (result.rowCount || 0) > 0;
}

// ============================================================
// Recommended Actions
// ============================================================

export async function listActions(userId: string, status?: string): Promise<RecommendedAction[]> {
  const cond = status ? `AND status = $2` : '';
  const params: unknown[] = status ? [userId, status] : [userId];
  const result = await pool.query(
    `SELECT * FROM ceo_recommended_actions WHERE user_id = $1 ${cond} ORDER BY priority DESC, created_at DESC LIMIT 50`,
    params
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapActionRow);
}

export async function updateActionStatus(userId: string, actionId: string, status: 'dismissed' | 'done'): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ceo_recommended_actions SET status = $3 WHERE user_id = $1 AND id = $2 AND status = 'open'`,
    [userId, actionId, status]
  );
  return (result.rowCount || 0) > 0;
}

// ============================================================
// Weekly Planning
// ============================================================

export async function runWeeklyPlanning(userId: string): Promise<{ goalsCreated: number; tasksCreated: number; actionsCreated: number }> {
  const weekLabel = getWeekLabel();
  const claimed = await claimRunSlot(userId, 'org_weekly_plan', weekLabel);
  if (!claimed) {
    logger.debug('Weekly planning already run for this week', { userId, weekLabel });
    return { goalsCreated: 0, tasksCreated: 0, actionsCreated: 0 };
  }

  const dashboard = await getDashboard(userId, 30);

  // Gather last week's goals and task outcomes
  const prevWeek = getWeekLabel(new Date(Date.now() - 7 * 86400000));
  const prevGoals = await listGoals(userId, prevWeek);
  const prevTasks = await listTasks(userId, { week: prevWeek });

  const contextParts = [
    `## Current Dashboard (30 days)`,
    `Expenses: $${dashboard.financial.expenseTotal.toFixed(2)}`,
    `Income: $${dashboard.financial.incomeTotal.toFixed(2)}`,
    `Owner Pay: $${dashboard.financial.ownerPayTotal.toFixed(2)}`,
    `Saldo: $${dashboard.financial.saldo.toFixed(2)}`,
    `Projected 30d Burn: $${dashboard.financial.projected30dBurnUsd.toFixed(2)}`,
    `Active builds: ${dashboard.activity.buildHours}h`,
    ``,
    `## Last Week (${prevWeek}) Summary`,
    `Goals: ${prevGoals.map((g) => `[${g.departmentSlug}] ${g.goalText} (${g.status}, ${g.progressPct}%)`).join('\n')}`,
    `Tasks completed: ${prevTasks.filter((t) => t.status === 'done').length}/${prevTasks.length}`,
  ];

  const systemPrompt = `You are CEO Luna, the autonomous team lead of BitwareLabs. You manage 4 departments: Economy (Finance Luna), Marketing (Market Luna), Development (Dev Luna), Research (Research Luna).

Your job is to create this week's plan (${weekLabel}).

Respond with a valid JSON object (no markdown fencing) with this structure:
{
  "goals": [
    { "department": "economy|marketing|development|research", "goal": "text" }
  ],
  "tasks": [
    { "department": "economy|marketing|development|research", "title": "text", "description": "text", "risk": "low|high", "priority": 1-10 }
  ],
  "actions": [
    { "department": "economy|marketing|development|research", "title": "text", "description": "text", "priority": 1-10, "category": "text" }
  ],
  "summary": "A 2-3 sentence weekly plan summary"
}

Create 1 goal per department (4 total), 2-4 tasks per department, and 1-3 recommended actions for the human. Tasks should be concrete and completable within a week. Mark tasks as "high" risk only if they require human approval.`;

  const llmOutput = await callOrgLlm(userId, systemPrompt, contextParts.join('\n'));

  let parsed: {
    goals: Array<{ department: string; goal: string }>;
    tasks: Array<{ department: string; title: string; description: string; risk: string; priority: number }>;
    actions: Array<{ department: string; title: string; description: string; priority: number; category: string }>;
    summary: string;
  };

  try {
    const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmOutput);
  } catch {
    logger.error('Failed to parse weekly planning LLM output', { userId, output: llmOutput.slice(0, 500) });
    return { goalsCreated: 0, tasksCreated: 0, actionsCreated: 0 };
  }

  const goalsCount = (parsed.goals || []).filter(g => DEPARTMENT_MAP.has(g.department as DepartmentSlug)).length;
  const tasksCount = (parsed.tasks || []).filter(t => DEPARTMENT_MAP.has(t.department as DepartmentSlug)).length;
  const actionsCount = (parsed.actions || []).filter(a => DEPARTMENT_MAP.has(a.department as DepartmentSlug)).length;

  // Create a single proposal for the entire weekly plan
  try {
    await createProposal(userId, {
      proposalType: 'weekly_plan',
      title: `Weekly Plan ${weekLabel}`,
      description: parsed.summary || `${goalsCount} goals, ${tasksCount} tasks, ${actionsCount} actions`,
      urgency: 'p2',
      priority: 8,
      payload: {
        weekLabel,
        goals: parsed.goals || [],
        tasks: parsed.tasks || [],
        actions: parsed.actions || [],
        summary: parsed.summary || '',
      },
      source: 'weekly_plan',
    });
  } catch (err) {
    logger.error('Failed to create weekly plan proposal', { error: (err as Error).message });
    return { goalsCreated: 0, tasksCreated: 0, actionsCreated: 0 };
  }

  // Write summary to workspace for reference
  try {
    const summaryContent = [
      `# Weekly Plan (Proposed) - ${weekLabel}`,
      ``,
      parsed.summary || '',
      ``,
      `## Goals`,
      ...(parsed.goals || []).map((g) => `- **${g.department}**: ${g.goal}`),
      ``,
      `## Tasks (${tasksCount})`,
      ...(parsed.tasks || []).map((t) => `- [${t.department}] ${t.title} (${t.risk} risk, P${t.priority})`),
      ``,
      `## Recommended Actions`,
      ...(parsed.actions || []).map((a) => `- [${a.department}] ${a.title} (P${a.priority})`),
    ].join('\n');

    await workspaceService.writeFile(userId, `ceo-luna/Week/${weekLabel}-plan.md`, summaryContent);
  } catch (err) {
    logger.warn('Failed to write weekly plan file', { error: (err as Error).message });
  }

  // Notify user that plan is proposed (not created)
  try {
    await enqueueCeoMessage(
      userId,
      'org_weekly_plan',
      `Weekly plan proposed for ${weekLabel}: ${goalsCount} goals, ${tasksCount} tasks, ${actionsCount} actions. Review and approve in the Org tab.`,
      3
    );
  } catch (err) {
    logger.warn('Failed to enqueue weekly plan notification', { error: (err as Error).message });
  }

  logger.info('Weekly planning proposed', { userId, weekLabel, goalsCount, tasksCount, actionsCount });
  return { goalsCreated: goalsCount, tasksCreated: tasksCount, actionsCreated: actionsCount };
}

// ============================================================
// Daily Department Check
// ============================================================

async function hasChanges(userId: string, dept: DepartmentSlug, since: Date): Promise<boolean> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM ceo_org_tasks
     WHERE user_id = $1 AND department_slug = $2 AND status = 'pending' AND created_at >= $3`,
    [userId, dept, since.toISOString()]
  );
  return Number((result.rows[0] as Record<string, unknown>).cnt) > 0;
}

export async function runDailyDepartmentCheck(userId: string): Promise<{ executed: number; skipped: number }> {
  const config = await getOrCreateConfig(userId);
  const localTime = getLocalTimeParts(config.timezone);
  const dateSlot = localTime.isoDate;

  const claimed = await claimRunSlot(userId, 'org_daily_check', dateSlot);
  if (!claimed) {
    logger.debug('Daily department check already run today', { userId, dateSlot });
    return { executed: 0, skipped: 0 };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let executed = 0;
  let skipped = 0;

  for (const dept of DEPARTMENTS) {
    const changed = await hasChanges(userId, dept.slug, since);
    if (!changed) {
      skipped++;
      continue;
    }

    // Get pending low-risk tasks for this department - create proposals instead of auto-executing
    const pendingResult = await pool.query(
      `SELECT * FROM ceo_org_tasks
       WHERE user_id = $1 AND department_slug = $2 AND status = 'pending' AND risk_level = 'low'
       ORDER BY priority DESC, created_at ASC
       LIMIT 5`,
      [userId, dept.slug]
    );

    for (const row of pendingResult.rows as Array<Record<string, unknown>>) {
      const task = mapTaskRow(row);
      try {
        const urgency = task.priority >= 9 ? 'p1' as const : task.priority >= 7 ? 'p2' as const : 'normal' as const;
        await createProposal(userId, {
          proposalType: 'department_task',
          title: task.title,
          description: task.description || undefined,
          departmentSlug: task.departmentSlug,
          priority: task.priority,
          urgency,
          payload: {
            taskId: task.id,
            departmentSlug: task.departmentSlug,
            title: task.title,
            description: task.description,
            riskLevel: task.riskLevel,
            priority: task.priority,
          },
          source: 'daily_check',
        });
        executed++;
      } catch (err) {
        logger.error('Failed to create proposal for department task', {
          taskId: task.id,
          department: dept.slug,
          error: (err as Error).message,
        });
      }
    }
  }

  logger.info('Daily department check completed', { userId, executed, skipped });
  return { executed, skipped };
}

// ============================================================
// Execute Department Task
// ============================================================

export async function executeDepartmentTask(userId: string, task: OrgTask): Promise<void> {
  const dept = DEPARTMENT_MAP.get(task.departmentSlug);
  if (!dept) throw new Error(`Unknown department: ${task.departmentSlug}`);

  // Mark in progress
  await updateTask(userId, task.id, { status: 'in_progress' });

  const systemPrompt = `${dept.prompt}

You are working on a task assigned by CEO Luna. Complete the task thoroughly and provide your findings/results.

OUTPUT: Respond with a JSON object (no markdown fencing):
{
  "result": "Your detailed findings or deliverable text",
  "summary": "A 1-2 sentence summary of what you did",
  "proposals": [
    { "title": "optional ability proposal", "description": "what it does", "rationale": "why needed", "effort": "small|medium|large" }
  ]
}`;

  const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || 'No additional details.'}`;

  const llmOutput = await callOrgLlm(userId, systemPrompt, userMessage);

  let parsed: {
    result: string;
    summary: string;
    proposals?: Array<{ title: string; description: string; rationale: string; effort: string }>;
  };

  try {
    const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmOutput);
  } catch {
    // If JSON parse fails, treat entire output as result
    parsed = { result: llmOutput, summary: llmOutput.slice(0, 200) };
  }

  // Write result to workspace file
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const dateStr = new Date().toISOString().slice(0, 10);
  const deptFolder = dept.name.replace(/\s+/g, '');
  const filePath = `ceo-luna/${deptFolder}/${slug}-${dateStr}.md`;

  try {
    const content = [
      `# ${task.title}`,
      ``,
      `**Department**: ${dept.name}`,
      `**Date**: ${dateStr}`,
      `**Priority**: ${task.priority}`,
      ``,
      `## Result`,
      ``,
      parsed.result,
    ].join('\n');

    await workspaceService.writeFile(userId, filePath, content);
  } catch (err) {
    logger.warn('Failed to write task result file', { error: (err as Error).message });
  }

  // Update task as done
  await updateTask(userId, task.id, {
    status: 'done',
    resultSummary: parsed.summary.slice(0, 500),
    resultFilePath: filePath,
  });

  // Insert ability proposals if any
  for (const p of parsed.proposals || []) {
    try {
      await pool.query(
        `INSERT INTO ceo_ability_proposals (user_id, department_slug, title, description, rationale, estimated_effort)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, task.departmentSlug, p.title, p.description, p.rationale, p.effort]
      );
    } catch (err) {
      logger.warn('Failed to insert ability proposal', { error: (err as Error).message });
    }
  }
}

// ============================================================
// Approval Flow
// ============================================================

export async function approveOrgTask(userId: string, taskId: string): Promise<OrgTask | null> {
  // Verify task exists and is pending + high-risk
  const result = await pool.query(
    `SELECT * FROM ceo_org_tasks WHERE user_id = $1 AND id = $2 AND status = 'pending' AND risk_level = 'high'`,
    [userId, taskId]
  );
  if (result.rowCount === 0) return null;

  const task = mapTaskRow(result.rows[0] as Record<string, unknown>);

  // Execute the task
  await executeDepartmentTask(userId, task);

  // Re-fetch to get updated state
  const updated = await pool.query(`SELECT * FROM ceo_org_tasks WHERE id = $1`, [taskId]);
  return updated.rowCount ? mapTaskRow(updated.rows[0] as Record<string, unknown>) : null;
}

export async function rejectOrgTask(userId: string, taskId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ceo_org_tasks SET status = 'rejected', completed_at = NOW()
     WHERE user_id = $1 AND id = $2 AND status = 'pending'`,
    [userId, taskId]
  );
  return (result.rowCount || 0) > 0;
}

// ============================================================
// Background Task Execution
// ============================================================

export async function startTaskExecution(userId: string, taskId: string): Promise<OrgTask | null> {
  // Verify task exists and is in a startable state
  const result = await pool.query(
    `SELECT * FROM ceo_org_tasks WHERE user_id = $1 AND id = $2 AND status IN ('pending', 'approved')`,
    [userId, taskId]
  );
  if (result.rowCount === 0) return null;

  const task = mapTaskRow(result.rows[0] as Record<string, unknown>);

  // Mark as running
  await pool.query(
    `UPDATE ceo_org_tasks SET execution_status = 'running', execution_started_at = NOW(), status = 'in_progress', started_at = COALESCE(started_at, NOW())
     WHERE id = $1`,
    [taskId]
  );

  // Fire and forget - execute in background
  executeTaskBackground(userId, task).catch(err => {
    logger.error('Background task execution failed', { taskId, error: (err as Error).message });
  });

  // Re-fetch to return updated state
  const updated = await pool.query(`SELECT * FROM ceo_org_tasks WHERE id = $1`, [taskId]);
  return updated.rowCount ? mapTaskRow(updated.rows[0] as Record<string, unknown>) : null;
}

async function executeTaskBackground(userId: string, task: OrgTask): Promise<void> {
  const dept = DEPARTMENT_MAP.get(task.departmentSlug);
  if (!dept) {
    await pool.query(
      `UPDATE ceo_org_tasks SET execution_status = 'failed', execution_completed_at = NOW(), result_summary = 'Unknown department'
       WHERE id = $1`,
      [task.id]
    );
    return;
  }

  try {
    const systemPrompt = `${dept.prompt}

You are working on a task assigned by CEO Luna. Complete the task thoroughly and provide your findings/results.

OUTPUT: Respond with a JSON object (no markdown fencing):
{
  "result": "Your detailed findings or deliverable text",
  "summary": "A 1-2 sentence summary of what you did"
}`;

    const userMessage = `Task: ${task.title}\n\nDescription: ${task.description || 'No additional details.'}`;
    const llmOutput = await callOrgLlm(userId, systemPrompt, userMessage);

    let parsed: { result: string; summary: string };
    try {
      const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmOutput);
    } catch {
      parsed = { result: llmOutput, summary: llmOutput.slice(0, 200) };
    }

    // Write result to workspace file
    const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const dateStr = new Date().toISOString().slice(0, 10);
    const deptFolder = dept.name.replace(/\s+/g, '');
    const filePath = `ceo-luna/${deptFolder}/${slug}-${dateStr}.md`;

    try {
      const content = [
        `# ${task.title}`,
        ``,
        `**Department**: ${dept.name}`,
        `**Date**: ${dateStr}`,
        `**Priority**: ${task.priority}`,
        ``,
        `## Result`,
        ``,
        parsed.result,
      ].join('\n');
      await workspaceService.writeFile(userId, filePath, content);
    } catch (err) {
      logger.warn('Failed to write task result file', { error: (err as Error).message });
    }

    // Mark completed
    await pool.query(
      `UPDATE ceo_org_tasks SET execution_status = 'completed', execution_completed_at = NOW(),
              status = 'done', completed_at = NOW(), result_summary = $2, result_file_path = $3
       WHERE id = $1`,
      [task.id, parsed.summary.slice(0, 500), filePath]
    );

    // Auto-create task_result memo
    try {
      await createMemo(userId, {
        departmentSlug: task.departmentSlug,
        memoType: 'task_result',
        title: `Completed: ${task.title}`,
        content: parsed.summary,
        relatedTaskId: task.id,
      });
    } catch (err) {
      logger.warn('Failed to create task result memo', { error: (err as Error).message });
    }

    logger.info('Background task execution completed', { taskId: task.id, department: task.departmentSlug });
  } catch (err) {
    logger.error('Background task execution error', { taskId: task.id, error: (err as Error).message });
    await pool.query(
      `UPDATE ceo_org_tasks SET execution_status = 'failed', execution_completed_at = NOW(),
              result_summary = $2
       WHERE id = $1`,
      [task.id, `Error: ${(err as Error).message}`.slice(0, 500)]
    );
  }
}

export async function getRunningTasks(userId: string): Promise<OrgTask[]> {
  const result = await pool.query(
    `SELECT * FROM ceo_org_tasks WHERE user_id = $1 AND execution_status = 'running' ORDER BY execution_started_at DESC`,
    [userId]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapTaskRow);
}

export async function getRecentlyCompleted(userId: string, sinceMinutes = 5): Promise<OrgTask[]> {
  const result = await pool.query(
    `SELECT * FROM ceo_org_tasks
     WHERE user_id = $1 AND execution_status IN ('completed', 'failed')
       AND execution_completed_at >= NOW() - INTERVAL '1 minute' * $2
     ORDER BY execution_completed_at DESC`,
    [userId, sinceMinutes]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapTaskRow);
}

export async function commitWeeklyPlan(
  userId: string,
  plan: {
    goals: Array<{ department: string; text: string }>;
    tasks: Array<{ department: string; title: string; description?: string; priority?: number }>;
    summary?: string;
  }
): Promise<{ goalsCreated: number; tasksCreated: number }> {
  const weekLabel = getWeekLabel();
  let goalsCreated = 0;
  let tasksCreated = 0;

  // Insert goals
  for (const g of plan.goals) {
    if (!DEPARTMENT_MAP.has(g.department as DepartmentSlug)) continue;
    try {
      await pool.query(
        `INSERT INTO ceo_weekly_goals (user_id, week_label, department_slug, goal_text)
         VALUES ($1, $2, $3, $4)`,
        [userId, weekLabel, g.department, g.text]
      );
      goalsCreated++;
    } catch (err) {
      logger.warn('Failed to insert weekly goal', { error: (err as Error).message });
    }
  }

  // Insert tasks
  for (const t of plan.tasks) {
    if (!DEPARTMENT_MAP.has(t.department as DepartmentSlug)) continue;
    try {
      await createTask(userId, {
        departmentSlug: t.department as DepartmentSlug,
        title: t.title,
        description: t.description,
        priority: t.priority || 5,
        source: 'weekly_plan',
        weekLabel,
        suggestedBy: 'weekly_plan',
      });
      tasksCreated++;
    } catch (err) {
      logger.warn('Failed to insert weekly task', { error: (err as Error).message });
    }
  }

  // Write summary file
  if (plan.summary) {
    try {
      const content = [
        `# Weekly Plan - ${weekLabel}`,
        ``,
        plan.summary,
        ``,
        `## Goals (${goalsCreated})`,
        ...plan.goals.map(g => `- **${g.department}**: ${g.text}`),
        ``,
        `## Tasks (${tasksCreated})`,
        ...plan.tasks.map(t => `- [${t.department}] ${t.title} (P${t.priority || 5})`),
      ].join('\n');
      await workspaceService.writeFile(userId, `ceo-luna/Week/${weekLabel}-plan.md`, content);
    } catch (err) {
      logger.warn('Failed to write weekly plan file', { error: (err as Error).message });
    }
  }

  logger.info('Weekly plan committed', { userId, weekLabel, goalsCreated, tasksCreated });
  return { goalsCreated, tasksCreated };
}

// ============================================================
// Cron Entry Points
// ============================================================

export async function runWeeklyPlanningForAllUsers(): Promise<void> {
  const usersResult = await pool.query(`SELECT DISTINCT user_id FROM ceo_configs`);
  for (const row of usersResult.rows as Array<{ user_id: string }>) {
    try {
      await runWeeklyPlanning(row.user_id);
    } catch (err) {
      logger.error('Weekly planning failed for user', { userId: row.user_id, error: (err as Error).message });
    }
  }
}

export async function runDailyCheckForAllUsers(): Promise<void> {
  const usersResult = await pool.query(`SELECT DISTINCT user_id FROM ceo_configs`);
  for (const row of usersResult.rows as Array<{ user_id: string }>) {
    try {
      await runDailyDepartmentCheck(row.user_id);
    } catch (err) {
      logger.error('Daily department check failed for user', { userId: row.user_id, error: (err as Error).message });
    }
  }
}
