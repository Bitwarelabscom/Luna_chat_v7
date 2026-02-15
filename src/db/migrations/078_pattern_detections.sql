-- Migration 078: Pattern Detections for Automatic Reflection
-- Track detected coding patterns before promotion to style rules

CREATE TABLE IF NOT EXISTS pattern_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  pattern_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  confidence FLOAT DEFAULT 0.0,
  examples JSONB DEFAULT '[]'::jsonb,
  promoted_to_rule BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient lookups by user and pattern type
CREATE INDEX idx_pattern_detections_user ON pattern_detections(user_id, pattern_type);

-- Index for finding patterns ready for promotion
CREATE INDEX idx_pattern_detections_promotion ON pattern_detections(user_id, promoted_to_rule, confidence);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pattern_detections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pattern_detections_updated_at
BEFORE UPDATE ON pattern_detections
FOR EACH ROW
EXECUTE FUNCTION update_pattern_detections_updated_at();
