-- Migration 111: Add gossip discussion settings to autonomous_config
ALTER TABLE autonomous_config
  ADD COLUMN IF NOT EXISTS gossip_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gossip_interval_minutes INTEGER NOT NULL DEFAULT 240;
