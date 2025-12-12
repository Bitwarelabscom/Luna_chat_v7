-- Add source column to messages table to track where messages come from
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'web';

-- Add comment for documentation
COMMENT ON COLUMN messages.source IS 'Source of the message: web, telegram, api';
