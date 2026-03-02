import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import { getDashboard } from './ceo.service.js';
import { listTasks } from './ceo-org.service.js';
import { DEPARTMENT_MAP, type DepartmentSlug } from '../persona/luna.persona.js';
import type { ChatMessage } from '../llm/types.js';
import logger from '../utils/logger.js';

// ============================================================
// Types
// ============================================================

export interface StaffSession {
  id: string;
  userId: string;
  departmentSlug: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  departmentSlug: string | null;
  content: string;
  createdAt: string;
}

// ============================================================
// Helpers
// ============================================================

function mapSessionRow(row: Record<string, unknown>): StaffSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    departmentSlug: row.department_slug as string,
    title: row.title as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessageRow(row: Record<string, unknown>): StaffMessage {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as StaffMessage['role'],
    departmentSlug: row.department_slug as string | null,
    content: row.content as string,
    createdAt: String(row.created_at),
  };
}

async function callStaffLlm(
  userId: string,
  messages: ChatMessage[],
  maxTokens = 1024
): Promise<string> {
  const config = await getBackgroundFeatureModelConfig(userId, 'ceo_org_execution');
  try {
    const result = await createCompletion(config.primary.provider, config.primary.model, messages, {
      temperature: 0.5,
      maxTokens,
    });
    return result.content;
  } catch (primaryErr) {
    logger.warn('Staff chat primary LLM failed, trying fallback', { error: (primaryErr as Error).message });
    const fallback = await createCompletion(config.fallback.provider, config.fallback.model, messages, {
      temperature: 0.5,
      maxTokens,
    });
    return fallback.content;
  }
}

async function buildDeptContext(userId: string, deptSlug: string): Promise<string> {
  const parts: string[] = [];

  try {
    const dashboard = await getDashboard(userId, 30);
    parts.push(`## Dashboard (30d)`);
    parts.push(`Expenses: $${dashboard.financial.expenseTotal.toFixed(2)}`);
    parts.push(`Income: $${dashboard.financial.incomeTotal.toFixed(2)}`);
    parts.push(`Saldo: $${dashboard.financial.saldo.toFixed(2)}`);
    parts.push(`Burn: $${dashboard.financial.projected30dBurnUsd.toFixed(2)}/30d`);
  } catch {
    // Dashboard optional
  }

  try {
    const tasks = await listTasks(userId, { department: deptSlug, status: 'pending' });
    if (tasks.length > 0) {
      parts.push(`\n## Pending Tasks (${deptSlug})`);
      for (const t of tasks.slice(0, 10)) {
        parts.push(`- [P${t.priority}] ${t.title}`);
      }
    }
  } catch {
    // Tasks optional
  }

  return parts.join('\n');
}

// ============================================================
// Session CRUD
// ============================================================

export async function getOrCreateStaffSession(
  userId: string,
  deptSlug: string
): Promise<StaffSession> {
  const result = await pool.query(
    `INSERT INTO ceo_staff_sessions (user_id, department_slug)
     VALUES ($1, $2)
     ON CONFLICT (user_id, department_slug) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [userId, deptSlug]
  );
  return mapSessionRow(result.rows[0] as Record<string, unknown>);
}

export async function getStaffMessages(sessionId: string, limit = 50): Promise<StaffMessage[]> {
  const result = await pool.query(
    `SELECT * FROM ceo_staff_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [sessionId, limit]
  );
  return (result.rows as Array<Record<string, unknown>>).map(mapMessageRow);
}

export async function clearStaffSession(sessionId: string): Promise<void> {
  await pool.query(`DELETE FROM ceo_staff_messages WHERE session_id = $1`, [sessionId]);
}

// ============================================================
// Individual Department Chat
// ============================================================

export async function sendStaffMessage(
  userId: string,
  sessionId: string,
  message: string
): Promise<StaffMessage> {
  // Look up session to get department
  const sessionResult = await pool.query(
    `SELECT * FROM ceo_staff_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  if (sessionResult.rowCount === 0) throw new Error('Session not found');
  const session = mapSessionRow(sessionResult.rows[0] as Record<string, unknown>);
  const dept = DEPARTMENT_MAP.get(session.departmentSlug as DepartmentSlug);
  if (!dept) throw new Error(`Unknown department: ${session.departmentSlug}`);

  // Store user message
  await pool.query(
    `INSERT INTO ceo_staff_messages (session_id, role, department_slug, content) VALUES ($1, 'user', NULL, $2)`,
    [sessionId, message]
  );

  // Build conversation context
  const context = await buildDeptContext(userId, session.departmentSlug);
  const history = await getStaffMessages(sessionId, 20);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${dept.prompt}\n\nYou are speaking directly to the company owner in a staff chat. Be helpful, proactive, and share department-specific insights. Use data from the context below when relevant.\n\n${context}`,
    },
  ];

  // Add history as conversation
  for (const msg of history.slice(-20)) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  // Add current user message (already in history from the insert above, but ensure it's in the LLM context)
  if (history.length === 0 || history[history.length - 1]?.content !== message) {
    messages.push({ role: 'user', content: message });
  }

  const response = await callStaffLlm(userId, messages);

  // Store assistant response
  const assistantResult = await pool.query(
    `INSERT INTO ceo_staff_messages (session_id, role, department_slug, content) VALUES ($1, 'assistant', $2, $3) RETURNING *`,
    [sessionId, session.departmentSlug, response]
  );

  // Update session timestamp
  await pool.query(`UPDATE ceo_staff_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);

  return mapMessageRow(assistantResult.rows[0] as Record<string, unknown>);
}

// ============================================================
// Meeting Mode (Group Chat)
// ============================================================

export async function sendMeetingMessage(
  userId: string,
  sessionId: string,
  message: string
): Promise<StaffMessage[]> {
  // Verify session
  const sessionResult = await pool.query(
    `SELECT * FROM ceo_staff_sessions WHERE id = $1 AND user_id = $2 AND department_slug = 'meeting'`,
    [sessionId, userId]
  );
  if (sessionResult.rowCount === 0) throw new Error('Meeting session not found');

  // Store user message
  await pool.query(
    `INSERT INTO ceo_staff_messages (session_id, role, department_slug, content) VALUES ($1, 'user', NULL, $2)`,
    [sessionId, message]
  );

  const context = await buildDeptContext(userId, 'economy');

  // Step 1: Orchestration - CEO Luna decides which departments to involve
  const orchestrationMessages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are CEO Luna orchestrating a meeting. Analyze the user's request and decide which departments should weigh in. Available departments: economy (Finance Luna), marketing (Market Luna), development (Dev Luna), research (Research Luna).

Respond with ONLY a valid JSON object (no markdown):
{
  "departments": ["economy", "marketing"],
  "questions": {
    "economy": "What is the budget impact of this?",
    "marketing": "How does this affect our brand positioning?"
  },
  "intro": "Brief intro to the discussion topic"
}

Pick 1-3 departments most relevant to the request. Craft specific questions for each.`,
    },
    { role: 'user', content: message },
  ];

  const orchestrationRaw = await callStaffLlm(userId, orchestrationMessages, 512);

  let orchestration: {
    departments: string[];
    questions: Record<string, string>;
    intro: string;
  };

  try {
    const jsonMatch = orchestrationRaw.match(/\{[\s\S]*\}/);
    orchestration = JSON.parse(jsonMatch ? jsonMatch[0] : orchestrationRaw);
  } catch {
    // Fallback: involve economy and development
    orchestration = {
      departments: ['economy', 'development'],
      questions: {
        economy: message,
        development: message,
      },
      intro: 'Let me bring in the relevant departments.',
    };
  }

  const resultMessages: StaffMessage[] = [];

  // Store orchestration message
  const orchestrationInsert = await pool.query(
    `INSERT INTO ceo_staff_messages (session_id, role, department_slug, content) VALUES ($1, 'assistant', 'meeting', $2) RETURNING *`,
    [sessionId, orchestration.intro || 'Bringing in the team...']
  );
  resultMessages.push(mapMessageRow(orchestrationInsert.rows[0] as Record<string, unknown>));

  // Step 2: Department calls in parallel
  const validDepts = orchestration.departments.filter(d => DEPARTMENT_MAP.has(d as DepartmentSlug));
  const deptResponses = await Promise.all(
    validDepts.map(async (deptSlug) => {
      const dept = DEPARTMENT_MAP.get(deptSlug as DepartmentSlug)!;
      const question = orchestration.questions[deptSlug] || message;

      const deptMessages: ChatMessage[] = [
        {
          role: 'system',
          content: `${dept.prompt}\n\nYou are in a team meeting. The CEO has asked you a specific question. Answer concisely and with your department's perspective.\n\n${context}`,
        },
        { role: 'user', content: question },
      ];

      try {
        const response = await callStaffLlm(userId, deptMessages, 1024);
        return { deptSlug, response };
      } catch (err) {
        logger.warn('Meeting dept call failed', { dept: deptSlug, error: (err as Error).message });
        return { deptSlug, response: `[${dept.name} could not respond at this time]` };
      }
    })
  );

  // Store department responses
  for (const { deptSlug, response } of deptResponses) {
    const insert = await pool.query(
      `INSERT INTO ceo_staff_messages (session_id, role, department_slug, content) VALUES ($1, 'assistant', $2, $3) RETURNING *`,
      [sessionId, deptSlug, response]
    );
    resultMessages.push(mapMessageRow(insert.rows[0] as Record<string, unknown>));
  }

  // Step 3: Synthesis - CEO Luna combines responses
  const synthesisContext = deptResponses
    .map(({ deptSlug, response }) => {
      const dept = DEPARTMENT_MAP.get(deptSlug as DepartmentSlug);
      return `**${dept?.name || deptSlug}:**\n${response}`;
    })
    .join('\n\n');

  const synthesisMessages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are CEO Luna. You just ran a department meeting about the user's question. Synthesize the department responses into a clear recommendation with next steps. Be concise and actionable.`,
    },
    {
      role: 'user',
      content: `Original question: ${message}\n\nDepartment responses:\n${synthesisContext}`,
    },
  ];

  const synthesis = await callStaffLlm(userId, synthesisMessages, 1024);

  const synthesisInsert = await pool.query(
    `INSERT INTO ceo_staff_messages (session_id, role, department_slug, content) VALUES ($1, 'assistant', 'meeting', $2) RETURNING *`,
    [sessionId, synthesis]
  );
  resultMessages.push(mapMessageRow(synthesisInsert.rows[0] as Record<string, unknown>));

  // Update session timestamp
  await pool.query(`UPDATE ceo_staff_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);

  return resultMessages;
}
