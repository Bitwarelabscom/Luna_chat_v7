-- Migration: Add separate input/output/cache token tracking
-- This enables detailed token usage analysis and cost calculations

-- Add separate token columns to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cache_tokens INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider VARCHAR(50);

-- Create index for efficient daily/weekly/monthly queries
CREATE INDEX IF NOT EXISTS idx_messages_created_at_model ON messages(created_at, model);
CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider);

-- Backfill: Set existing tokens_used as output_tokens for assistant messages
-- (Since we only have total, assume it was output for assistant messages)
UPDATE messages
SET output_tokens = tokens_used
WHERE role = 'assistant' AND tokens_used > 0 AND output_tokens = 0;
