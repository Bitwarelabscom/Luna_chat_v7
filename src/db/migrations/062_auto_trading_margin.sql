-- Auto Trading Margin Support
-- Enables margin short selling for auto-trading at 1x leverage

-- Add margin mode settings to auto_trading_settings
ALTER TABLE auto_trading_settings
ADD COLUMN IF NOT EXISTS margin_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS margin_leverage INTEGER DEFAULT 1 CHECK (margin_leverage >= 1 AND margin_leverage <= 10),
ADD COLUMN IF NOT EXISTS short_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS short_rsi_threshold DECIMAL(5,2) DEFAULT 70,
ADD COLUMN IF NOT EXISTS short_volume_multiplier DECIMAL(5,2) DEFAULT 1.5;

-- Add margin position side to trades table for tracking
ALTER TABLE trades
ADD COLUMN IF NOT EXISTS position_side VARCHAR(10) CHECK (position_side IN ('long', 'short'));

-- Add index for margin auto trades
CREATE INDEX IF NOT EXISTS idx_trades_margin_auto ON trades(margin_mode, auto_trade)
WHERE margin_mode = 'MARGIN' AND auto_trade = true;

-- Comments for documentation
COMMENT ON COLUMN auto_trading_settings.margin_enabled IS 'Enable margin trading mode for auto-trading';
COMMENT ON COLUMN auto_trading_settings.margin_leverage IS 'Leverage for margin trades (default 1x)';
COMMENT ON COLUMN auto_trading_settings.short_enabled IS 'Enable short selling in auto-trading';
COMMENT ON COLUMN auto_trading_settings.short_rsi_threshold IS 'RSI threshold for short signals (default 70 = overbought)';
COMMENT ON COLUMN auto_trading_settings.short_volume_multiplier IS 'Volume multiplier required for short signals';
COMMENT ON COLUMN trades.position_side IS 'Long or short for margin positions';
