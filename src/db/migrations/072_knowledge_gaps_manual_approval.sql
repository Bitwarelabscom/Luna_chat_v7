-- Add manual_approval_required column to knowledge_gaps
-- This allows rejected research to be flagged for manual review and potential embedding

ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS manual_approval_required BOOLEAN DEFAULT false;
