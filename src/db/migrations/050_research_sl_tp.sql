-- Add Stop Loss and Take Profit settings for Research Mode signals
-- These settings control exit orders when executing research signals

ALTER TABLE research_settings
ADD COLUMN IF NOT EXISTS stop_loss_pct NUMERIC(5,2) DEFAULT 2.0,
ADD COLUMN IF NOT EXISTS take_profit_pct NUMERIC(5,2) DEFAULT 3.0,
ADD COLUMN IF NOT EXISTS take_profit_2_pct NUMERIC(5,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS trailing_stop_pct NUMERIC(5,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS position_size_usdt NUMERIC(12,2) DEFAULT 100.0;

-- Add comment for documentation
COMMENT ON COLUMN research_settings.stop_loss_pct IS 'Stop loss percentage below entry price (e.g. 2.0 = 2%)';
COMMENT ON COLUMN research_settings.take_profit_pct IS 'Take profit 1 percentage above entry price';
COMMENT ON COLUMN research_settings.take_profit_2_pct IS 'Optional take profit 2 percentage (for partial exits)';
COMMENT ON COLUMN research_settings.trailing_stop_pct IS 'Trailing stop percentage - if set, overrides fixed stop loss';
COMMENT ON COLUMN research_settings.position_size_usdt IS 'Position size in USDT for each trade';
