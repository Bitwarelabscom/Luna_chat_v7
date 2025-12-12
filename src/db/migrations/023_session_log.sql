-- Session Log for cross-session continuity
-- Tracks session lifecycle and provides context for new sessions

CREATE TABLE IF NOT EXISTS session_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,

  -- Standard content
  mode VARCHAR(20),
  summary TEXT,                    -- 1-line summary (updated at end)
  mood VARCHAR(20),                -- positive/neutral/negative/mixed
  energy VARCHAR(20),              -- high/medium/low
  open_tasks_count INTEGER DEFAULT 0,

  -- Additional context
  topics TEXT[],                   -- Main topics discussed
  tools_used TEXT[],               -- Tools called during session
  message_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient retrieval of recent logs by user
CREATE INDEX IF NOT EXISTS idx_session_logs_user_started ON session_logs(user_id, started_at DESC);

-- Index for finding unfinalized logs (background job)
CREATE INDEX IF NOT EXISTS idx_session_logs_unfinalized ON session_logs(ended_at) WHERE ended_at IS NULL;

-- Comments
COMMENT ON TABLE session_logs IS 'Tracks session lifecycle for cross-session context continuity';
COMMENT ON COLUMN session_logs.summary IS 'Auto-generated 1-line summary of session when finalized';
COMMENT ON COLUMN session_logs.mood IS 'Detected user mood: positive/neutral/negative/mixed';
COMMENT ON COLUMN session_logs.energy IS 'Detected energy level: high/medium/low';
