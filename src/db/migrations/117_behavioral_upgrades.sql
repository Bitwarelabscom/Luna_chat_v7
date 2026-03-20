-- Migration 117: Behavioral Upgrades
-- Adds user_routines (learned temporal/behavioral patterns) and user_active_focuses (multi-session goal tracking)

-- Learned temporal/behavioral patterns
CREATE TABLE IF NOT EXISTS user_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_type TEXT NOT NULL CHECK (routine_type IN ('temporal', 'sequential', 'contextual')),
  pattern_key TEXT NOT NULL,
  description TEXT NOT NULL,
  time_window_start TIME,
  time_window_end TIME,
  day_of_week INT[],
  confidence REAL NOT NULL DEFAULT 0.5,
  occurrence_count INT NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, pattern_key)
);

CREATE INDEX idx_user_routines_user_active ON user_routines (user_id, is_active);
CREATE INDEX idx_user_routines_time ON user_routines (user_id, time_window_start, time_window_end) WHERE is_active = true;

-- Multi-session goal/project tracking
CREATE TABLE IF NOT EXISTS user_active_focuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  focus_label TEXT NOT NULL,
  focus_type TEXT NOT NULL CHECK (focus_type IN ('project', 'plan', 'interest', 'goal')),
  confidence REAL NOT NULL DEFAULT 0.5,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mention_count INT NOT NULL DEFAULT 1,
  progress_notes TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'completed')),
  source_session_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_active_focuses_user_status ON user_active_focuses (user_id, status);
CREATE INDEX idx_user_active_focuses_last_seen ON user_active_focuses (user_id, last_seen_at DESC) WHERE status = 'active';
