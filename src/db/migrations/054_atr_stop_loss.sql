-- Add ATR-based stop-loss settings
ALTER TABLE trading_settings
ADD COLUMN IF NOT EXISTS use_atr_stop_loss BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS atr_multiplier DECIMAL(5,2) DEFAULT 1.5;

-- Comment on columns
COMMENT ON COLUMN trading_settings.use_atr_stop_loss IS 'Enable ATR-based dynamic stop-loss calculation';
COMMENT ON COLUMN trading_settings.atr_multiplier IS 'Multiplier for ATR value (e.g., 1.5 = 1.5x ATR below entry)';
