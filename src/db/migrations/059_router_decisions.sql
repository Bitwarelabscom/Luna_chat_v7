-- Migration: Router-First Architecture
-- Stores routing decisions for analytics, debugging, and trust verification

-- Add routing metadata to messages table
-- route_decision stores the full router output as JSONB for flexibility
ALTER TABLE messages ADD COLUMN IF NOT EXISTS route_decision JSONB;

-- Example route_decision structure:
-- {
--   "class": "chat|transform|factual|actionable",
--   "needs_fresh_data": boolean,
--   "needs_tools": boolean,
--   "risk_if_wrong": "low|medium|high",
--   "confidence_required": "estimate|verified",
--   "route": "nano|pro|pro+tools",
--   "decision_source": "hard_rule|regex|keyword|classifier",
--   "decision_time_ms": number,
--   "matched_patterns": ["pattern1", "pattern2"]
-- }

-- Create GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_messages_route_decision
ON messages USING gin (route_decision);

-- Create index for filtering by route type (most common query)
CREATE INDEX IF NOT EXISTS idx_messages_route_type
ON messages ((route_decision->>'route'))
WHERE route_decision IS NOT NULL;

-- Create index for filtering by risk level (for monitoring)
CREATE INDEX IF NOT EXISTS idx_messages_route_risk
ON messages ((route_decision->>'risk_if_wrong'))
WHERE route_decision IS NOT NULL;

-- Create index for filtering by decision source (for classifier analysis)
CREATE INDEX IF NOT EXISTS idx_messages_route_source
ON messages ((route_decision->>'decision_source'))
WHERE route_decision IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN messages.route_decision IS 'Router-First Architecture decision metadata. Contains routing decision, risk assessment, and matched patterns for trust verification and analytics.';
