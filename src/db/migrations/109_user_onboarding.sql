CREATE TABLE IF NOT EXISTS user_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'reviewing', 'completed')),
  current_phase INTEGER NOT NULL DEFAULT 1,
  current_section VARCHAR(50) DEFAULT 'identity',
  collected_data JSONB NOT NULL DEFAULT '{}',
  section_status JSONB NOT NULL DEFAULT '{}',
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  facts_committed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_user ON user_onboarding(user_id);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_status ON user_onboarding(status)
  WHERE status NOT IN ('completed');
