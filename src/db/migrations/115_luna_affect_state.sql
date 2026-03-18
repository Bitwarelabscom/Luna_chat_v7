-- Luna Cognitive Upgrades - Phase 1: Internal Emotional State
-- Migration 115: Luna's persistent affect/mood state

CREATE TABLE IF NOT EXISTS luna_affect_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  valence REAL NOT NULL DEFAULT 0.0,       -- -1.0 to 1.0 (negative to positive)
  arousal REAL NOT NULL DEFAULT 0.3,       -- 0.0 to 1.0 (calm to excited)
  curiosity REAL NOT NULL DEFAULT 0.5,     -- 0.0 to 1.0
  frustration REAL NOT NULL DEFAULT 0.0,   -- 0.0 to 1.0
  engagement REAL NOT NULL DEFAULT 0.5,    -- 0.0 to 1.0
  mood_label VARCHAR(64),                  -- e.g. "warmly curious", "quietly contemplative"
  mood_narrative TEXT,                     -- 1-2 sentence internal state description
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_luna_affect_user_updated
  ON luna_affect_state (user_id, updated_at DESC);
