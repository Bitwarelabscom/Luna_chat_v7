import { spawn } from 'child_process';
import { query, queryOne } from '../db/postgres.js';
import logger from '../utils/logger.js';

interface CreateRequest {
  id: string;
  user_id: string;
  idea_text: string;
  production_id: string | null;
  status: string;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

interface SongRow {
  track_number: number;
  title: string;
  status: string;
  file_path: string | null;
  duration_seconds: number | null;
}

export async function submitCreateRequest(userId: string, ideaText: string): Promise<{ requestId: string; status: string }> {
  // Rate limit: max 1 request per 10 minutes
  const recent = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM create_requests
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [userId]
  );

  if (recent && parseInt(recent.count, 10) >= 1) {
    throw new Error('Please wait at least 10 minutes between requests');
  }

  // Insert request
  const row = await queryOne<CreateRequest>(
    `INSERT INTO create_requests (user_id, idea_text, status)
     VALUES ($1, $2, 'pending')
     RETURNING *`,
    [userId, ideaText]
  );

  if (!row) {
    throw new Error('Failed to create request');
  }

  // Spawn Claude Code in background
  spawnClaudeCode(row.id, userId, ideaText).catch(err => {
    logger.error('Claude Code spawn failed', { requestId: row.id, error: (err as Error).message });
  });

  return { requestId: row.id, status: 'pending' };
}

async function spawnClaudeCode(requestId: string, userId: string, ideaText: string): Promise<void> {
  // Update status to processing
  await query(
    `UPDATE create_requests SET status = 'processing' WHERE id = $1`,
    [requestId]
  );

  const prompt = buildPrompt(requestId, userId, ideaText);

  try {
    const output = await runClaude(prompt);

    // Try to extract production_id from output
    const prodIdMatch = output.match(/PRODUCTION_ID=([0-9a-f-]{36})/i);
    const productionId = prodIdMatch ? prodIdMatch[1] : null;

    await query(
      `UPDATE create_requests
       SET status = 'completed', production_id = $1, completed_at = NOW()
       WHERE id = $2`,
      [productionId, requestId]
    );

    logger.info('Create request completed', { requestId, productionId });
  } catch (err) {
    const errorMessage = (err as Error).message.slice(0, 2000);
    await query(
      `UPDATE create_requests SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [errorMessage, requestId]
    );
    logger.error('Create request failed', { requestId, error: errorMessage });
  }
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
      '--model', 'claude-sonnet-4-6',
      '--allowedTools', 'Bash',
      '-p', prompt,
    ], {
      cwd: '/opt/lyric-luna',
      env: { ...process.env, HOME: '/root' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000, // 10 min max
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Claude exited with code ${code}: ${stderr.slice(0, 1000)}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

function buildPrompt(requestId: string, userId: string, ideaText: string): string {
  return `You are Lyric Luna. A friend has submitted a music creation request. Follow your CLAUDE.md instructions exactly.

REQUEST: "${ideaText}"

INSTRUCTIONS:
1. Parse the request to determine genre, theme, and number of songs (default to 5 if not specified)
2. Load the appropriate genre preset from styles/
3. Write the album - all songs, following every rule in CLAUDE.md
4. Save song files to the albums/ directory as specified
5. Insert the album into the database and approve it for Suno submission

For step 5, generate UUIDs and run the following SQL via bash:

USER_ID='${userId}'
PROD_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
ALBUM_ID=$(python3 -c "import uuid; print(uuid.uuid4())")

Then write a SQL file to /tmp/insert_album_${requestId}.sql with INSERT statements for:
- album_productions (status: 'planned')
- album_items
- album_songs (status: 'lyrics_approved', include full lyrics_text and style tags)

Execute with: docker exec -i luna-postgres psql -U luna -d luna_chat < /tmp/insert_album_${requestId}.sql

Then approve with:
curl -s -X POST http://10.0.0.2:3005/api/ceo/albums/$PROD_ID/approve -H "Content-Type: application/json" -H "x-user-id: 727e0045-3858-4e42-b81e-4d48d980a59d"

IMPORTANT: After the approve curl succeeds, print exactly this line so the system can track it:
PRODUCTION_ID=$PROD_ID

Do everything now. No questions. No confirmation needed.`;
}

export async function listRequests(userId: string): Promise<Array<{
  id: string;
  ideaText: string;
  status: string;
  productionId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  songCount?: number;
  completedSongs?: number;
}>> {
  const rows = await query<CreateRequest & { song_count: string; completed_songs: string }>(
    `SELECT cr.*,
       COALESCE(sc.song_count, 0) as song_count,
       COALESCE(sc.completed_songs, 0) as completed_songs
     FROM create_requests cr
     LEFT JOIN LATERAL (
       SELECT COUNT(*) as song_count,
              COUNT(*) FILTER (WHERE status = 'completed') as completed_songs
       FROM album_songs WHERE production_id = cr.production_id
     ) sc ON true
     WHERE cr.user_id = $1
     ORDER BY cr.created_at DESC
     LIMIT 20`,
    [userId]
  );

  return rows.map(r => ({
    id: r.id,
    ideaText: r.idea_text,
    status: r.status,
    productionId: r.production_id,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    songCount: parseInt(r.song_count, 10),
    completedSongs: parseInt(r.completed_songs, 10),
  }));
}

export async function getRequestDetail(userId: string, requestId: string): Promise<{
  id: string;
  ideaText: string;
  status: string;
  productionId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  songs: Array<{
    trackNumber: number;
    title: string;
    status: string;
    streamUrl: string | null;
    durationSeconds: number | null;
  }>;
} | null> {
  const row = await queryOne<CreateRequest>(
    `SELECT * FROM create_requests WHERE id = $1 AND user_id = $2`,
    [requestId, userId]
  );

  if (!row) return null;

  let songs: Array<{
    trackNumber: number;
    title: string;
    status: string;
    streamUrl: string | null;
    durationSeconds: number | null;
  }> = [];

  if (row.production_id) {
    const songRows = await query<SongRow>(
      `SELECT s.track_number, s.title, s.status, g.file_path, g.duration_seconds
       FROM album_songs s
       LEFT JOIN suno_generations g ON s.suno_generation_id = g.id
       WHERE s.production_id = $1
       ORDER BY s.track_number`,
      [row.production_id]
    );

    songs = songRows.map(s => ({
      trackNumber: s.track_number,
      title: s.title,
      status: s.status,
      streamUrl: s.file_path
        ? `/api/media/stream/${Buffer.from(s.file_path).toString('base64url')}`
        : null,
      durationSeconds: s.duration_seconds,
    }));
  }

  return {
    id: row.id,
    ideaText: row.idea_text,
    status: row.status,
    productionId: row.production_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    songs,
  };
}
