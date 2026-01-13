-- Auto Trading Fee Filter & Fixed USD Position Sizing
-- Adds minimum profit threshold and fixed USD position sizing to auto trading settings

-- Add new columns for fixed USD position sizing
ALTER TABLE auto_trading_settings
  ADD COLUMN IF NOT EXISTS min_position_usd DECIMAL(10,2) DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_position_usd DECIMAL(10,2) DEFAULT 70,
  ADD COLUMN IF NOT EXISTS min_profit_pct DECIMAL(5,2) DEFAULT 2.0;

-- Add comment explaining the columns
COMMENT ON COLUMN auto_trading_settings.min_position_usd IS 'Minimum position size in USD (overrides percentage if > 0)';
COMMENT ON COLUMN auto_trading_settings.max_position_usd IS 'Maximum position size in USD (overrides percentage if > 0)';
COMMENT ON COLUMN auto_trading_settings.min_profit_pct IS 'Minimum expected profit % to cover fees (default 2% to cover 0.8% round-trip fees)';

-- Fix any existing settings with overly aggressive position sizes (30% was a bug)
UPDATE auto_trading_settings
SET
  min_position_pct = 3,
  max_position_pct = 5,
  min_position_usd = 30,
  max_position_usd = 70,
  min_profit_pct = 2.0
WHERE min_position_pct >= 20 OR max_position_pct >= 20;
