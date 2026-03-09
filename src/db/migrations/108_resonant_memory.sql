-- Resonant Memory System
-- Emotional moments: raw text preserved when VAD thresholds crossed
CREATE TABLE emotional_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id UUID,
  raw_text TEXT NOT NULL,
  moment_tag TEXT NOT NULL,
  valence FLOAT NOT NULL,
  arousal FLOAT NOT NULL,
  dominance FLOAT NOT NULL,
  context_topic TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_emotional_moments_user ON emotional_moments(user_id, created_at DESC);

-- Contradiction signals: when user states something contradicting a stored fact
CREATE TABLE contradiction_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  fact_key VARCHAR(100) NOT NULL,
  user_stated TEXT NOT NULL,
  stored_value TEXT NOT NULL,
  signal_type VARCHAR(20) NOT NULL DEFAULT 'misremember',
  surfaced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_contradiction_signals_unsurfaced
  ON contradiction_signals(session_id) WHERE surfaced = FALSE;

-- Behavioral observations: specific pattern shifts detected from enrichment data
CREATE TABLE behavioral_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  observation_type VARCHAR(50) NOT NULL,
  observation TEXT NOT NULL,
  evidence_summary TEXT,
  severity FLOAT DEFAULT 0.5,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  expired BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_behavioral_obs_active
  ON behavioral_observations(user_id, created_at DESC) WHERE expired = FALSE;
