-- Migration: Add support for ACTIVE tab functionality
-- Adds stop confirmation threshold setting and indexes for active trades queries

-- Add stop confirmation threshold to trading_settings
-- When > 0, require confirmation before stopping trades worth more than this amount
ALTER TABLE trading_settings
ADD COLUMN IF NOT EXISTS stop_confirmation_threshold_usd DECIMAL(20,2) DEFAULT 0;

-- Index for active trades query performance - open positions
CREATE INDEX IF NOT EXISTS idx_trades_active_positions
ON trades(user_id, status, closed_at) WHERE status = 'filled' AND closed_at IS NULL;

-- Index for pending orders lookup
CREATE INDEX IF NOT EXISTS idx_trades_pending_orders
ON trades(user_id, status) WHERE status IN ('pending', 'new');
