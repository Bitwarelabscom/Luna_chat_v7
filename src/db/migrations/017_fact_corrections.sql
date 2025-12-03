-- Migration: Fact corrections history table
-- Tracks when users correct or delete facts Luna has learned

CREATE TABLE IF NOT EXISTS fact_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact_key VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  correction_type VARCHAR(50) NOT NULL,  -- 'delete' or 'update'
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying user's correction history
CREATE INDEX IF NOT EXISTS idx_fact_corrections_user ON fact_corrections(user_id);
CREATE INDEX IF NOT EXISTS idx_fact_corrections_user_created ON fact_corrections(user_id, created_at DESC);
