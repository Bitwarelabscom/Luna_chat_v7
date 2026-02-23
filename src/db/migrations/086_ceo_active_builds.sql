-- CEO active build sessions table
CREATE TABLE ceo_active_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_num INTEGER NOT NULL,           -- short sequential #1, #2, #3 per user
  task_name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'done')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- when current active session began
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0, -- accumulated when paused/done
  last_checkin_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, build_num)
);

-- CEO build progress notes table
CREATE TABLE ceo_build_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id UUID NOT NULL REFERENCES ceo_active_builds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'checkin', -- 'checkin' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ceo_active_builds_user ON ceo_active_builds(user_id, status, created_at DESC);
CREATE INDEX idx_ceo_build_notes_build ON ceo_build_notes(build_id, created_at DESC);
