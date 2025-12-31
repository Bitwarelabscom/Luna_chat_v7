-- Migration 047: TradeCore Integration
-- Description: Add columns for TradeCore engine integration

-- Add TradeCore state storage column to trading_bots
ALTER TABLE trading_bots
  ADD COLUMN IF NOT EXISTS tradecore_state JSONB,
  ADD COLUMN IF NOT EXISTS tradecore_managed BOOLEAN DEFAULT false;

-- Add TradeCore tracking columns to trades
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS tradecore_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false;

-- Index for efficient notification polling (partial index for pending notifications)
CREATE INDEX IF NOT EXISTS idx_trades_notification_pending
  ON trades(notification_sent)
  WHERE notification_sent = false AND tradecore_order_id IS NOT NULL;

-- Index for TradeCore managed bots
CREATE INDEX IF NOT EXISTS idx_trading_bots_tradecore
  ON trading_bots(tradecore_managed)
  WHERE tradecore_managed = true;

-- Update bot type check constraint to include all types
ALTER TABLE trading_bots DROP CONSTRAINT IF EXISTS trading_bots_type_check;
ALTER TABLE trading_bots ADD CONSTRAINT trading_bots_type_check
  CHECK (type IN ('grid', 'dca', 'rsi', 'ma_crossover', 'macd', 'breakout', 'mean_reversion', 'momentum', 'custom'));

-- Add comment for documentation
COMMENT ON COLUMN trading_bots.tradecore_state IS 'JSON state storage for TradeCore engine (grid levels, trailing stop state, etc.)';
COMMENT ON COLUMN trading_bots.tradecore_managed IS 'True if bot execution is managed by TradeCore engine';
COMMENT ON COLUMN trades.tradecore_order_id IS 'Internal order ID from TradeCore engine';
COMMENT ON COLUMN trades.notification_sent IS 'Whether Luna has sent notification for this TradeCore trade';
