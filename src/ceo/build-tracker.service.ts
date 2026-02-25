import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { enqueueCeoMessage } from './ceo.service.js';

export interface ActiveBuild {
  id: string;
  userId: string;
  buildNum: number;
  taskName: string;
  status: 'active' | 'paused' | 'done';
  startedAt: Date;
  sessionStartedAt: Date;
  pausedAt: Date | null;
  completedAt: Date | null;
  elapsedSeconds: number;
  lastCheckinAt: Date;
}

export interface BuildNote {
  id: string;
  buildId: string;
  userId: string;
  note: string;
  source: string;
  createdAt: Date;
}

export interface BuildWithNotes extends ActiveBuild {
  currentElapsedSeconds: number;
  notes: BuildNote[];
}

interface BuildRow {
  id: string;
  user_id: string;
  build_num: number;
  task_name: string;
  status: 'active' | 'paused' | 'done';
  started_at: string;
  session_started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number;
  last_checkin_at: string;
}

interface BuildNoteRow {
  id: string;
  build_id: string;
  user_id: string;
  note: string;
  source: string;
  created_at: string;
}

interface BuildWithNotesRow extends BuildRow {
  notes: unknown;
}

function rowToBuild(row: BuildRow): ActiveBuild {
  return {
    id: row.id,
    userId: row.user_id,
    buildNum: row.build_num,
    taskName: row.task_name,
    status: row.status,
    startedAt: new Date(row.started_at),
    sessionStartedAt: new Date(row.session_started_at),
    pausedAt: row.paused_at ? new Date(row.paused_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    elapsedSeconds: row.elapsed_seconds,
    lastCheckinAt: new Date(row.last_checkin_at),
  };
}

function rowToNote(row: BuildNoteRow): BuildNote {
  return {
    id: row.id,
    buildId: row.build_id,
    userId: row.user_id,
    note: row.note,
    source: row.source,
    createdAt: new Date(row.created_at),
  };
}

function parseNotes(raw: unknown): BuildNote[] {
  if (typeof raw === 'string') {
    try {
      return parseNotes(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => value as BuildNoteRow)
    .map(rowToNote)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Compute total elapsed seconds including current active session */
export function getCurrentElapsed(build: ActiveBuild): number {
  if (build.status === 'active') {
    return build.elapsedSeconds + Math.floor((Date.now() - build.sessionStartedAt.getTime()) / 1000);
  }
  return build.elapsedSeconds;
}

/** Format elapsed seconds as "2h 15min" or "45min" */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

async function getNextBuildNum(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(MAX(build_num), 0) + 1 AS next_num FROM ceo_active_builds WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0].next_num as number;
}

export async function startBuild(userId: string, taskName: string): Promise<ActiveBuild> {
  const buildNum = await getNextBuildNum(userId);
  const result = await pool.query(
    `INSERT INTO ceo_active_builds (user_id, build_num, task_name, status, started_at, session_started_at, last_checkin_at)
     VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW())
     RETURNING *`,
    [userId, buildNum, taskName.trim()]
  );
  logger.info('CEO build started', { userId, buildNum, taskName });
  return rowToBuild(result.rows[0] as BuildRow);
}

export async function pauseBuild(userId: string, buildNum: number): Promise<ActiveBuild | null> {
  const result = await pool.query(
    `UPDATE ceo_active_builds
     SET status = 'paused',
         paused_at = NOW(),
         elapsed_seconds = elapsed_seconds + EXTRACT(EPOCH FROM (NOW() - session_started_at))::INTEGER,
         session_started_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1 AND build_num = $2 AND status = 'active'
     RETURNING *`,
    [userId, buildNum]
  );
  if (result.rows.length === 0) return null;
  return rowToBuild(result.rows[0] as BuildRow);
}

export async function continueBuild(userId: string, buildNum: number): Promise<ActiveBuild | null> {
  const result = await pool.query(
    `UPDATE ceo_active_builds
     SET status = 'active',
         session_started_at = NOW(),
         paused_at = NULL,
         updated_at = NOW()
     WHERE user_id = $1 AND build_num = $2 AND status = 'paused'
     RETURNING *`,
    [userId, buildNum]
  );
  if (result.rows.length === 0) return null;
  return rowToBuild(result.rows[0] as BuildRow);
}

export async function doneBuild(userId: string, buildNum: number): Promise<ActiveBuild | null> {
  const result = await pool.query(
    `UPDATE ceo_active_builds
     SET status = 'done',
         completed_at = NOW(),
         elapsed_seconds = elapsed_seconds + CASE
           WHEN status = 'active' THEN EXTRACT(EPOCH FROM (NOW() - session_started_at))::INTEGER
           ELSE 0
         END,
         updated_at = NOW()
     WHERE user_id = $1 AND build_num = $2 AND status IN ('active', 'paused')
     RETURNING *`,
    [userId, buildNum]
  );
  if (result.rows.length === 0) return null;
  const build = rowToBuild(result.rows[0] as BuildRow);

  // Log completed build hours to CEO dashboard
  const hours = build.elapsedSeconds / 3600;
  if (hours > 0) {
    try {
      const { logBuild } = await import('./ceo.service.js');
      await logBuild(userId, {
        projectKey: build.taskName,
        hours: parseFloat(hours.toFixed(2)),
        item: `Build session #${build.buildNum}: ${build.taskName}`,
        stage: 'done',
      });
    } catch (err) {
      logger.warn('Failed to log completed build hours to CEO dashboard', { error: (err as Error).message });
    }
  }

  return build;
}

export async function listBuilds(userId: string): Promise<ActiveBuild[]> {
  const result = await pool.query(
    `SELECT * FROM ceo_active_builds
     WHERE user_id = $1 AND status IN ('active', 'paused')
     ORDER BY build_num DESC`,
    [userId]
  );
  return result.rows.map(r => rowToBuild(r as BuildRow));
}

export async function listBuildHistory(userId: string, limit = 50): Promise<BuildWithNotes[]> {
  const result = await pool.query(
    `SELECT
        b.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', n.id,
              'build_id', n.build_id,
              'user_id', n.user_id,
              'note', n.note,
              'source', n.source,
              'created_at', n.created_at
            ) ORDER BY n.created_at DESC
          ) FILTER (WHERE n.id IS NOT NULL),
          '[]'::json
        ) AS notes
     FROM ceo_active_builds b
     LEFT JOIN ceo_build_notes n
       ON n.build_id = b.id
     WHERE b.user_id = $1
     GROUP BY b.id
     ORDER BY
       CASE b.status
         WHEN 'active' THEN 0
         WHEN 'paused' THEN 1
         ELSE 2
       END,
       COALESCE(b.completed_at, b.updated_at, b.started_at) DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(200, limit))]
  );

  return result.rows.map((row) => {
    const build = rowToBuild(row as BuildWithNotesRow);
    return {
      ...build,
      currentElapsedSeconds: getCurrentElapsed(build),
      notes: parseNotes((row as BuildWithNotesRow).notes),
    };
  });
}

export async function getBuild(userId: string, buildNum: number): Promise<ActiveBuild | null> {
  const result = await pool.query(
    `SELECT * FROM ceo_active_builds WHERE user_id = $1 AND build_num = $2`,
    [userId, buildNum]
  );
  if (result.rows.length === 0) return null;
  return rowToBuild(result.rows[0] as BuildRow);
}

export async function addNote(buildId: string, userId: string, note: string, source = 'checkin'): Promise<void> {
  await pool.query(
    `INSERT INTO ceo_build_notes (build_id, user_id, note, source) VALUES ($1, $2, $3, $4)`,
    [buildId, userId, note.trim(), source]
  );
  logger.info('CEO build note added', { buildId, source });
}

/** Find active builds overdue for check-in (30+ minutes), enqueue check-in trigger, update last_checkin_at */
export async function processCheckins(): Promise<number> {
  const result = await pool.query(
    `SELECT * FROM ceo_active_builds
     WHERE status = 'active'
       AND last_checkin_at < NOW() - INTERVAL '30 minutes'`
  );

  if (result.rows.length === 0) return 0;

  let count = 0;
  for (const row of result.rows) {
    const build = rowToBuild(row as BuildRow);
    const elapsed = formatElapsed(getCurrentElapsed(build));
    const message = `[Build Check-in] Build #${build.buildNum} "${build.taskName}" has been running for ${elapsed}. How is it going? [build_id=${build.id}]`;

    try {
      await enqueueCeoMessage(build.userId, 'ceo_build_checkin', message, 5);

      await pool.query(
        `UPDATE ceo_active_builds SET last_checkin_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [build.id]
      );

      count++;
      logger.info('CEO build check-in enqueued', { buildId: build.id, buildNum: build.buildNum, userId: build.userId });
    } catch (err) {
      logger.error('Failed to enqueue build check-in', { error: (err as Error).message, buildId: build.id });
    }
  }

  return count;
}
