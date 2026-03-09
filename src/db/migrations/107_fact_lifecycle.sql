-- Fact Lifecycle System
-- Adds lifecycle columns for supersession, temporary overrides, and expiry

-- Add lifecycle columns to user_facts
ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_status VARCHAR(20) DEFAULT 'active'
  CHECK (fact_status IN ('active', 'overridden', 'superseded', 'expired'));

ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_type VARCHAR(20) DEFAULT 'permanent'
  CHECK (fact_type IN ('permanent', 'default', 'temporary'));

ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS supersedes_id UUID REFERENCES user_facts(id) ON DELETE SET NULL;

ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS override_priority INTEGER DEFAULT 0;
-- 0 = permanent/default, 10 = correction, 20 = temporary override

-- Replace unique constraint with partial unique index (only active facts compete)
DROP INDEX IF EXISTS idx_user_facts_unique_intent;

CREATE UNIQUE INDEX idx_user_facts_unique_active
  ON user_facts (user_id, category, fact_key, COALESCE(intent_id, '00000000-0000-0000-0000-000000000000'::uuid), fact_type)
  WHERE fact_status = 'active';

-- Backfill existing facts
UPDATE user_facts SET fact_status = 'active', fact_type = 'permanent' WHERE fact_status IS NULL;

-- Indexes for lifecycle queries
CREATE INDEX IF NOT EXISTS idx_user_facts_status ON user_facts (fact_status);
CREATE INDEX IF NOT EXISTS idx_user_facts_valid_until ON user_facts (valid_until) WHERE valid_until IS NOT NULL AND fact_status = 'active';
CREATE INDEX IF NOT EXISTS idx_user_facts_supersedes ON user_facts (supersedes_id) WHERE supersedes_id IS NOT NULL;
