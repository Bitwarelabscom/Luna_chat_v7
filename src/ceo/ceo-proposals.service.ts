import { pool } from '../db/index.js';
import { createTask, executeDepartmentTask } from './ceo-org.service.js';
import { DEPARTMENT_MAP, type DepartmentSlug } from '../persona/luna.persona.js';
import logger from '../utils/logger.js';

// ============================================================
// Types
// ============================================================

export interface CeoProposal {
  id: string;
  userId: string;
  proposalType: 'weekly_plan' | 'task' | 'goal' | 'action' | 'department_task';
  title: string;
  description: string | null;
  departmentSlug: string | null;
  priority: number;
  urgency: 'p1' | 'p2' | 'normal';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  payload: Record<string, unknown>;
  source: string;
  sessionId: string | null;
  telegramMessageId: number | null;
  expiresAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

// ============================================================
// Helpers
// ============================================================

function mapProposalRow(row: Record<string, unknown>): CeoProposal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    proposalType: row.proposal_type as CeoProposal['proposalType'],
    title: row.title as string,
    description: row.description as string | null,
    departmentSlug: row.department_slug as string | null,
    priority: row.priority as number,
    urgency: row.urgency as CeoProposal['urgency'],
    status: row.status as CeoProposal['status'],
    payload: (row.payload || {}) as Record<string, unknown>,
    source: row.source as string,
    sessionId: row.session_id as string | null,
    telegramMessageId: row.telegram_message_id ? Number(row.telegram_message_id) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    createdAt: String(row.created_at),
  };
}

// ============================================================
// CRUD
// ============================================================

export async function createProposal(
  userId: string,
  data: {
    proposalType: CeoProposal['proposalType'];
    title: string;
    description?: string;
    departmentSlug?: string;
    priority?: number;
    urgency?: CeoProposal['urgency'];
    payload?: Record<string, unknown>;
    source?: string;
    sessionId?: string;
  }
): Promise<CeoProposal> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const result = await pool.query(
    `INSERT INTO ceo_proposals (user_id, proposal_type, title, description, department_slug, priority, urgency, payload, source, session_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      userId,
      data.proposalType,
      data.title,
      data.description || null,
      data.departmentSlug || null,
      data.priority || 5,
      data.urgency || 'normal',
      JSON.stringify(data.payload || {}),
      data.source || 'manual',
      data.sessionId || null,
      expiresAt,
    ]
  );

  const proposal = mapProposalRow(result.rows[0] as Record<string, unknown>);

  // Send to Telegram if urgent - try CEO bot first, fall back to main bot
  if (proposal.urgency === 'p1' || proposal.urgency === 'p2') {
    try {
      let msgId: number | null = null;

      // Try dedicated CEO Telegram bot first
      try {
        const { sendProposalToCeoTelegram } = await import('../triggers/ceo-telegram.service.js');
        msgId = await sendProposalToCeoTelegram(userId, proposal);
      } catch {
        // CEO bot not available, fall through
      }

      // Fall back to main Telegram bot
      if (!msgId) {
        const { sendProposalToTelegram } = await import('../triggers/telegram.service.js');
        msgId = await sendProposalToTelegram(userId, proposal);
      }

      if (msgId) {
        await pool.query(
          `UPDATE ceo_proposals SET telegram_message_id = $1 WHERE id = $2`,
          [msgId, proposal.id]
        );
        proposal.telegramMessageId = msgId;
      }
    } catch (err) {
      logger.warn('Failed to send proposal to Telegram', { error: (err as Error).message });
    }
  }

  return proposal;
}

export async function listProposals(
  userId: string,
  filters?: { status?: string; urgency?: string; type?: string }
): Promise<CeoProposal[]> {
  const conditions = ['user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  if (filters?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters?.urgency) {
    conditions.push(`urgency = $${idx++}`);
    params.push(filters.urgency);
  }
  if (filters?.type) {
    conditions.push(`proposal_type = $${idx++}`);
    params.push(filters.type);
  }

  const result = await pool.query(
    `SELECT * FROM ceo_proposals WHERE ${conditions.join(' AND ')} ORDER BY
      CASE urgency WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 ELSE 2 END,
      priority DESC, created_at DESC
     LIMIT 100`,
    params
  );

  return (result.rows as Array<Record<string, unknown>>).map(mapProposalRow);
}

export async function getProposalCount(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM ceo_proposals WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  return Number((result.rows[0] as Record<string, unknown>).cnt) || 0;
}

export async function approveProposal(userId: string, proposalId: string): Promise<CeoProposal | null> {
  const result = await pool.query(
    `UPDATE ceo_proposals SET status = 'approved', decided_at = NOW()
     WHERE user_id = $1 AND id = $2 AND status = 'pending'
     RETURNING *`,
    [userId, proposalId]
  );

  if (result.rowCount === 0) return null;

  const proposal = mapProposalRow(result.rows[0] as Record<string, unknown>);

  // Execute the approved proposal
  try {
    await executeProposal(userId, proposal);
  } catch (err) {
    logger.error('Failed to execute approved proposal', {
      proposalId: proposal.id,
      type: proposal.proposalType,
      error: (err as Error).message,
    });
  }

  return proposal;
}

export async function rejectProposal(userId: string, proposalId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ceo_proposals SET status = 'rejected', decided_at = NOW()
     WHERE user_id = $1 AND id = $2 AND status = 'pending'`,
    [userId, proposalId]
  );
  return (result.rowCount || 0) > 0;
}

export async function batchDecide(
  userId: string,
  decisions: Array<{ id: string; action: 'approve' | 'reject' }>
): Promise<{ approved: number; rejected: number }> {
  let approved = 0;
  let rejected = 0;

  for (const d of decisions) {
    if (d.action === 'approve') {
      const p = await approveProposal(userId, d.id);
      if (p) approved++;
    } else {
      const ok = await rejectProposal(userId, d.id);
      if (ok) rejected++;
    }
  }

  return { approved, rejected };
}

// ============================================================
// Execution
// ============================================================

async function executeProposal(userId: string, proposal: CeoProposal): Promise<void> {
  const payload = proposal.payload;

  switch (proposal.proposalType) {
    case 'weekly_plan': {
      // Payload has goals, tasks, actions arrays
      const goals = (payload.goals || []) as Array<{ department: string; goal: string }>;
      const tasks = (payload.tasks || []) as Array<{
        department: string; title: string; description: string; risk: string; priority: number;
      }>;
      const actions = (payload.actions || []) as Array<{
        department: string; title: string; description: string; priority: number; category: string;
      }>;
      const weekLabel = (payload.weekLabel as string) || getWeekLabel();

      for (const g of goals) {
        const dept = g.department as DepartmentSlug;
        if (!DEPARTMENT_MAP.has(dept)) continue;
        try {
          await pool.query(
            `INSERT INTO ceo_weekly_goals (user_id, week_label, department_slug, goal_text)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, week_label, department_slug) DO UPDATE SET goal_text = EXCLUDED.goal_text`,
            [userId, weekLabel, dept, g.goal]
          );
        } catch (err) {
          logger.warn('Failed to insert goal from proposal', { error: (err as Error).message });
        }
      }

      for (const t of tasks) {
        const dept = t.department as DepartmentSlug;
        if (!DEPARTMENT_MAP.has(dept)) continue;
        try {
          await createTask(userId, {
            departmentSlug: dept,
            title: t.title,
            description: t.description,
            riskLevel: t.risk === 'high' ? 'high' : 'low',
            priority: Math.min(10, Math.max(1, t.priority || 5)),
            source: 'weekly_plan',
            assignedBy: 'CEO Luna',
            weekLabel,
          });
        } catch (err) {
          logger.warn('Failed to insert task from proposal', { error: (err as Error).message });
        }
      }

      for (const a of actions) {
        const dept = a.department as DepartmentSlug;
        if (!DEPARTMENT_MAP.has(dept)) continue;
        try {
          await pool.query(
            `INSERT INTO ceo_recommended_actions (user_id, department_slug, title, description, priority, category)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, dept, a.title, a.description, Math.min(10, Math.max(1, a.priority || 5)), a.category || null]
          );
        } catch (err) {
          logger.warn('Failed to insert action from proposal', { error: (err as Error).message });
        }
      }

      logger.info('Executed weekly_plan proposal', {
        proposalId: proposal.id,
        goals: goals.length,
        tasks: tasks.length,
        actions: actions.length,
      });
      break;
    }

    case 'task': {
      const dept = (payload.departmentSlug || proposal.departmentSlug) as DepartmentSlug;
      if (!DEPARTMENT_MAP.has(dept)) break;
      await createTask(userId, {
        departmentSlug: dept,
        title: payload.title as string || proposal.title,
        description: (payload.description as string) || proposal.description || undefined,
        riskLevel: (payload.riskLevel as 'low' | 'high') || 'low',
        priority: (payload.priority as number) || proposal.priority,
        source: proposal.source,
        assignedBy: 'CEO Luna',
      });
      break;
    }

    case 'goal': {
      const dept = (payload.departmentSlug || proposal.departmentSlug) as DepartmentSlug;
      if (!DEPARTMENT_MAP.has(dept)) break;
      const weekLabel = (payload.weekLabel as string) || getWeekLabel();
      await pool.query(
        `INSERT INTO ceo_weekly_goals (user_id, week_label, department_slug, goal_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, week_label, department_slug) DO UPDATE SET goal_text = EXCLUDED.goal_text`,
        [userId, weekLabel, dept, payload.goalText as string || proposal.title]
      );
      break;
    }

    case 'action': {
      const dept = (payload.departmentSlug || proposal.departmentSlug) as DepartmentSlug;
      if (!DEPARTMENT_MAP.has(dept)) break;
      await pool.query(
        `INSERT INTO ceo_recommended_actions (user_id, department_slug, title, description, priority, category)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, dept, proposal.title, proposal.description, proposal.priority, (payload.category as string) || null]
      );
      break;
    }

    case 'department_task': {
      // Build an OrgTask-like object from the payload to execute
      const taskData = payload as Record<string, unknown>;
      const dept = (taskData.departmentSlug || proposal.departmentSlug) as DepartmentSlug;
      if (!DEPARTMENT_MAP.has(dept)) break;

      const task = await createTask(userId, {
        departmentSlug: dept,
        title: (taskData.title as string) || proposal.title,
        description: (taskData.description as string) || proposal.description || undefined,
        riskLevel: (taskData.riskLevel as 'low' | 'high') || 'low',
        priority: (taskData.priority as number) || proposal.priority,
        source: 'daily_check',
        assignedBy: 'CEO Luna',
      });

      await executeDepartmentTask(userId, task);
      break;
    }
  }
}

// ============================================================
// Expiry
// ============================================================

export async function expireStaleProposals(): Promise<number> {
  const result = await pool.query(
    `UPDATE ceo_proposals SET status = 'expired', decided_at = NOW()
     WHERE status = 'pending' AND expires_at < NOW()`
  );
  const count = result.rowCount || 0;
  if (count > 0) {
    logger.info('Expired stale proposals', { count });
  }
  return count;
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
