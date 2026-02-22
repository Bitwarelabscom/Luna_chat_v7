-- Migration 076: Add more toggles to autonomous_config
ALTER TABLE autonomous_config
ADD COLUMN IF NOT EXISTS learning_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS rss_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS insights_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN DEFAULT true;
