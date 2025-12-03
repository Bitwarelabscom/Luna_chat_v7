import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export type NoteType = 'planning' | 'observation' | 'finding' | 'decision' | 'question' | 'summary';

export interface SessionNote {
  id: string;
  sessionId: string;
  userId: string;
  noteType: NoteType;
  title: string | null;
  content: string;
  phase: string | null;
  relatedGoalId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AddNoteInput {
  noteType: NoteType;
  content: string;
  title?: string;
  phase?: string;
  goalId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Note Management
// ============================================

export async function addNote(
  sessionId: string,
  userId: string,
  input: AddNoteInput
): Promise<SessionNote> {
  const result = await pool.query(
    `INSERT INTO autonomous_session_notes
     (session_id, user_id, note_type, title, content, phase, related_goal_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      sessionId,
      userId,
      input.noteType,
      input.title || null,
      input.content,
      input.phase || null,
      input.goalId || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create session note');
  }

  const note = mapNote(result.rows[0]);

  logger.debug('Session note added', {
    noteId: note.id,
    sessionId,
    noteType: input.noteType,
    phase: input.phase,
  });

  return note;
}

export async function getSessionNotes(
  sessionId: string,
  filters?: { noteType?: NoteType; phase?: string }
): Promise<SessionNote[]> {
  let sql = `SELECT * FROM autonomous_session_notes WHERE session_id = $1`;
  const params: (string | NoteType)[] = [sessionId];

  if (filters?.noteType) {
    params.push(filters.noteType);
    sql += ` AND note_type = $${params.length}`;
  }

  if (filters?.phase) {
    params.push(filters.phase);
    sql += ` AND phase = $${params.length}`;
  }

  sql += ` ORDER BY created_at ASC`;

  const result = await pool.query(sql, params);

  return result.rows.map(mapNote);
}

export async function getNote(
  noteId: string,
  userId: string
): Promise<SessionNote | null> {
  const result = await pool.query(
    `SELECT * FROM autonomous_session_notes WHERE id = $1 AND user_id = $2`,
    [noteId, userId]
  );

  return result.rows[0] ? mapNote(result.rows[0]) : null;
}

export async function deleteNote(
  noteId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM autonomous_session_notes WHERE id = $1 AND user_id = $2`,
    [noteId, userId]
  );

  return result.rowCount === 1;
}

export async function getRecentNotes(
  userId: string,
  limit = 10
): Promise<SessionNote[]> {
  const result = await pool.query(
    `SELECT asn.* FROM autonomous_session_notes asn
     JOIN autonomous_sessions s ON asn.session_id = s.id
     WHERE asn.user_id = $1
     ORDER BY asn.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(mapNote);
}

// ============================================
// Context Formatting
// ============================================

export async function formatNotesForContext(sessionId: string): Promise<string> {
  const notes = await getSessionNotes(sessionId);

  if (notes.length === 0) {
    return '';
  }

  const grouped: Record<NoteType, SessionNote[]> = {
    planning: [],
    observation: [],
    finding: [],
    decision: [],
    question: [],
    summary: [],
  };

  for (const note of notes) {
    grouped[note.noteType].push(note);
  }

  let text = '## Session Workspace Notes\n\n';

  if (grouped.planning.length > 0) {
    text += '### Planning Notes\n';
    for (const note of grouped.planning) {
      text += formatSingleNote(note);
    }
    text += '\n';
  }

  if (grouped.observation.length > 0) {
    text += '### Observations\n';
    for (const note of grouped.observation) {
      text += formatSingleNote(note);
    }
    text += '\n';
  }

  if (grouped.finding.length > 0) {
    text += '### Findings\n';
    for (const note of grouped.finding) {
      text += formatSingleNote(note);
    }
    text += '\n';
  }

  if (grouped.decision.length > 0) {
    text += '### Decisions Made\n';
    for (const note of grouped.decision) {
      text += formatSingleNote(note);
    }
    text += '\n';
  }

  if (grouped.question.length > 0) {
    text += '### Questions Noted\n';
    for (const note of grouped.question) {
      text += formatSingleNote(note);
    }
    text += '\n';
  }

  return text;
}

function formatSingleNote(note: SessionNote): string {
  let text = '';
  if (note.title) {
    text += `**${note.title}**`;
    if (note.phase) {
      text += ` (${note.phase} phase)`;
    }
    text += '\n';
  }
  text += `${note.content}\n\n`;
  return text;
}

export async function getSessionSummary(sessionId: string): Promise<string> {
  const summaryNotes = await getSessionNotes(sessionId, { noteType: 'summary' });

  if (summaryNotes.length > 0) {
    return summaryNotes[summaryNotes.length - 1].content;
  }

  const notes = await getSessionNotes(sessionId);

  if (notes.length === 0) {
    return 'No notes recorded in this session.';
  }

  const decisions = notes.filter(n => n.noteType === 'decision');
  const findings = notes.filter(n => n.noteType === 'finding');

  let summary = `Session recorded ${notes.length} notes.`;

  if (decisions.length > 0) {
    summary += ` Made ${decisions.length} decision(s).`;
  }

  if (findings.length > 0) {
    summary += ` Recorded ${findings.length} finding(s).`;
  }

  return summary;
}

// ============================================
// Helpers
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNote(row: any): SessionNote {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    noteType: row.note_type,
    title: row.title,
    content: row.content,
    phase: row.phase,
    relatedGoalId: row.related_goal_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

// ============================================
// Convenience functions for common note types
// ============================================

export async function addPlanningNote(
  sessionId: string,
  userId: string,
  content: string,
  phase?: string,
  title?: string
): Promise<SessionNote> {
  return addNote(sessionId, userId, {
    noteType: 'planning',
    content,
    phase,
    title,
  });
}

export async function addObservation(
  sessionId: string,
  userId: string,
  content: string,
  phase?: string
): Promise<SessionNote> {
  return addNote(sessionId, userId, {
    noteType: 'observation',
    content,
    phase,
  });
}

export async function addFinding(
  sessionId: string,
  userId: string,
  content: string,
  phase?: string,
  metadata?: Record<string, unknown>
): Promise<SessionNote> {
  return addNote(sessionId, userId, {
    noteType: 'finding',
    content,
    phase,
    metadata,
  });
}

export async function addDecision(
  sessionId: string,
  userId: string,
  content: string,
  phase?: string,
  goalId?: string
): Promise<SessionNote> {
  return addNote(sessionId, userId, {
    noteType: 'decision',
    content,
    phase,
    goalId,
  });
}

export async function addSessionSummary(
  sessionId: string,
  userId: string,
  content: string
): Promise<SessionNote> {
  return addNote(sessionId, userId, {
    noteType: 'summary',
    content,
    title: 'Session Summary',
  });
}
